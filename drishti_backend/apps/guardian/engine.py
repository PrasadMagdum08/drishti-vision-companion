"""
guardian/engine.py — Drishti Guardian Module v2.1

Tuning update based on real-world testing:
- Distance gate: only objects ≤ 2m are announced (no more distant furniture spam)
- No "Clear" announcement — silent when path is empty
- Tiered cycle timing:
    vehicles / fast objects → 0.8s  (react fast to traffic)
    people                  → 1.2s  (moderate urgency)
    hazards / furniture     → 2.5s  (slow furniture churn)
"""

import cv2
import numpy as np
import base64
import time
from ultralytics import YOLO

# ─── Model ────────────────────────────────────────────────────────────────────
MODEL_PATH = "yolov8s.pt"
CONFIDENCE_THRESHOLD = 0.45     # higher = fewer false positives on street
MIN_HEIGHT_RATIO = 0.12         # ignore tiny/distant objects
FRAME_W = 480
FRAME_H = 480

# ─── Tracking ─────────────────────────────────────────────────────────────────
# Object tracked across frames to detect velocity
TRACKER_MAX_AGE_FRAMES = 4      # drop object if not seen for 4 frames
APPROACH_GROWTH_THRESHOLD = 0.18  # bbox grew 18% → "Fast"
PASS_SHRINK_THRESHOLD = -0.15   # bbox shrunk 15% → object passing/leaving

# ─── Distance Gate ────────────────────────────────────────────────────────────
# Objects farther than this are tracked silently but never announced.
# Keeps Guardian focused on immediate hazards, not background furniture.
ALERT_MAX_DISTANCE_M = 2.0      # only announce objects <= 2 meters away

# ─── Tiered Cycle Timing ──────────────────────────────────────────────────────
# Faster cycle for dangerous objects, slower for low-priority clutter.
CYCLE_VEHICLE_S   = 0.8         # vehicles and fast-approaching objects
CYCLE_PERSON_S    = 1.2         # people blocking path
CYCLE_FURNITURE_S = 2.5         # hazards, furniture, general objects
# No "Clear" announcement — system stays silent when path is empty

# ─── Priority Tiers ───────────────────────────────────────────────────────────
# Tier 1 — Vehicles (always highest priority, interrupt)
VEHICLE_CLASSES = {
    "car", "motorcycle", "bus", "truck", "bicycle",
    "auto", "rickshaw", "scooter", "motorbike"
}

# Tier 2 — People and large blocking objects
PERSON_CLASSES = {"person", "people"}

# Tier 3 — Environmental hazards
HAZARD_CLASSES = {
    "pothole", "stairs", "step", "curb",
    "fire hydrant", "stop sign", "bench"
}

# All other detected objects → Tier 4 (awareness)

# ─── Distance Buckets (chest-mount calibrated) ────────────────────────────────
def _height_to_distance(height_ratio: float) -> str:
    """
    Calibrated for chest-mount at ~1.2m height, portrait frame.
    Returns human-readable distance string.
    """
    if height_ratio >= 0.75:   return "0.5 meters"
    if height_ratio >= 0.55:   return "1 meter"
    if height_ratio >= 0.40:   return "1.5 meters"
    if height_ratio >= 0.28:   return "2 meters"
    if height_ratio >= 0.20:   return "3 meters"
    return "4 meters"

def _height_to_meters(height_ratio: float) -> float:
    if height_ratio >= 0.75:   return 0.5
    if height_ratio >= 0.55:   return 1.0
    if height_ratio >= 0.40:   return 1.5
    if height_ratio >= 0.28:   return 2.0
    if height_ratio >= 0.20:   return 3.0
    return 4.0

# ─── Sector ───────────────────────────────────────────────────────────────────
def _get_sector(center_x: float, frame_w: float) -> str:
    if center_x < frame_w * 0.30:   return "left"
    if center_x > frame_w * 0.70:   return "right"
    return "ahead"

# ─── Alert Builder ────────────────────────────────────────────────────────────
def _build_alert(label: str, sector: str, dist_str: str, is_fast: bool) -> str:
    """
    Compressed Siri-style alert language.
    Examples:
      "Fast bike, right"
      "Person ahead, 2 meters"
      "Car ahead, 1 meter"
      "Bench on your left"
    """
    prefix = "Fast " if is_fast else ""
    if sector == "ahead":
        return f"{prefix}{label} ahead, {dist_str}"
    elif sector == "left":
        if is_fast:
            return f"Fast {label}, left"
        return f"{label} on your left, {dist_str}"
    else:
        if is_fast:
            return f"Fast {label}, right"
        return f"{label} on your right, {dist_str}"

# ─── Priority Score ───────────────────────────────────────────────────────────
def _priority_score(label: str, dist_m: float, sector: str, is_fast: bool) -> float:
    """
    Higher score = more urgent = spoken first.
    Factors: tier, distance, velocity, sector (ahead most dangerous)
    """
    # Base tier score
    if label in VEHICLE_CLASSES:       tier = 1000
    elif label in PERSON_CLASSES:      tier = 500
    elif label in HAZARD_CLASSES:      tier = 400
    else:                              tier = 200

    # Distance score (closer = higher)
    dist_score = max(0, (5.0 - dist_m) * 100)

    # Velocity bonus
    velocity_bonus = 300 if is_fast else 0

    # Sector bonus (ahead most dangerous)
    sector_bonus = 150 if sector == "ahead" else 0

    return tier + dist_score + velocity_bonus + sector_bonus


# ══════════════════════════════════════════════════════════════════════════════
# OBJECT TRACKER
# Tracks objects across frames to detect approach velocity.
# Uses simple IoU-based matching — no deep sort needed at this scale.
# ══════════════════════════════════════════════════════════════════════════════
class ObjectTracker:
    def __init__(self):
        self.tracks: dict[int, dict] = {}   # track_id → track state
        self.next_id = 0
        self.frame_count = 0

    def _iou(self, box_a, box_b) -> float:
        ax1, ay1, ax2, ay2 = box_a
        bx1, by1, bx2, by2 = box_b
        ix1 = max(ax1, bx1); iy1 = max(ay1, by1)
        ix2 = min(ax2, bx2); iy2 = min(ay2, by2)
        if ix2 <= ix1 or iy2 <= iy1:
            return 0.0
        inter = (ix2 - ix1) * (iy2 - iy1)
        area_a = (ax2 - ax1) * (ay2 - ay1)
        area_b = (bx2 - bx1) * (by2 - by1)
        return inter / (area_a + area_b - inter + 1e-6)

    def update(self, detections: list[dict]) -> list[dict]:
        """
        Match new detections to existing tracks.
        Returns enriched detections with velocity info.
        """
        self.frame_count += 1
        matched_track_ids = set()
        enriched = []

        for det in detections:
            box = det["box"]
            label = det["label"]
            height_ratio = det["height_ratio"]

            best_iou = 0.25     # minimum IoU to consider a match
            best_id = None

            for tid, track in self.tracks.items():
                if track["label"] != label:
                    continue
                iou = self._iou(box, track["box"])
                if iou > best_iou:
                    best_iou = iou
                    best_id = tid

            if best_id is not None:
                # Matched existing track — compute velocity
                track = self.tracks[best_id]
                prev_h_ratio = track["height_ratio"]
                growth = (height_ratio - prev_h_ratio) / max(prev_h_ratio, 0.01)

                is_fast = growth > APPROACH_GROWTH_THRESHOLD
                is_leaving = growth < PASS_SHRINK_THRESHOLD

                # Update track
                track["box"] = box
                track["height_ratio"] = height_ratio
                track["last_seen"] = self.frame_count
                track["is_fast"] = is_fast
                track["is_leaving"] = is_leaving
                matched_track_ids.add(best_id)

                det["track_id"] = best_id
                det["is_fast"] = is_fast
                det["is_leaving"] = is_leaving

            else:
                # New object — create track
                tid = self.next_id
                self.next_id += 1
                self.tracks[tid] = {
                    "label": label,
                    "box": box,
                    "height_ratio": height_ratio,
                    "last_seen": self.frame_count,
                    "is_fast": False,
                    "is_leaving": False,
                }
                det["track_id"] = tid
                det["is_fast"] = False
                det["is_leaving"] = False

            enriched.append(det)

        # Age out tracks not seen recently
        dead = [
            tid for tid, t in self.tracks.items()
            if self.frame_count - t["last_seen"] > TRACKER_MAX_AGE_FRAMES
            and tid not in matched_track_ids
        ]
        for tid in dead:
            del self.tracks[tid]

        return enriched


# ══════════════════════════════════════════════════════════════════════════════
# GUARDIAN ENGINE
# ══════════════════════════════════════════════════════════════════════════════
class GuardianEngine:
    def __init__(self):
        print("🛡️ Loading Guardian Engine v2 (YOLOv8s)...")
        self.model = YOLO(MODEL_PATH)
        self.tracker = ObjectTracker()

        # Per-tier last-spoke timestamps — each tier has its own cooldown
        self.last_vehicle_time  = 0.0
        self.last_person_time   = 0.0
        self.last_furniture_time = 0.0
        self.last_alert_text = ""

        device = "cuda"
        try:
            import torch
            if not torch.cuda.is_available():
                device = "cpu"
        except Exception:
            device = "cpu"

        self.model.to(device)
        print(f"✅ Guardian Engine v2 Ready on {device.upper()}")

    def _decode_frame(self, base64_data: str):
        if "," in base64_data:
            base64_data = base64_data.split(",")[1]
        img_bytes = base64.b64decode(base64_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img

    def process_frame(self, base64_data: str) -> list[dict] | None:
        """
        Run YOLO on frame, track objects, return alert text or None.

        Returns:
            str  — alert to speak
            ""   — nothing to say this cycle (timer not elapsed)
            None — no detections and no clear needed
        """
        now = time.time()

        try:
            img = self._decode_frame(base64_data)
            if img is None:
                return None

            h, w = img.shape[:2]
            results = self.model(
                img,
                imgsz=480,
                conf=CONFIDENCE_THRESHOLD,
                verbose=False
            )

        except Exception as e:
            print(f"Guardian inference error: {e}")
            return None

        # ── Parse detections ─────────────────────────────────────────────────
        raw_detections = []
        for result in results:
            for box in result.boxes:
                x1, y1, x2, y2 = map(float, box.xyxy[0])
                label = result.names[int(box.cls[0])].lower()
                height_ratio = (y2 - y1) / h
                center_x = (x1 + x2) / 2

                if height_ratio < MIN_HEIGHT_RATIO:
                    continue

                raw_detections.append({
                    "label": label,
                    "box": (x1, y1, x2, y2),
                    "height_ratio": height_ratio,
                    "center_x": center_x,
                    "frame_w": w,
                    "frame_h": h,
                })

        # ── Track objects across frames ──────────────────────────────────────
        tracked = self.tracker.update(raw_detections)

        # ── Filter leaving objects (already passed user) ─────────────────────
        active = [d for d in tracked if not d.get("is_leaving", False)]

        # ── Distance gate: only objects <= 2m get announced ──────────────────
        # Objects beyond 2m are still tracked (so velocity is computed when
        # they approach) but never spoken — prevents furniture/background spam.
        in_range = [
            d for d in active
            if _height_to_meters(d["height_ratio"]) <= ALERT_MAX_DISTANCE_M
        ]

        if not in_range:
            return None     # nothing close enough to speak — stay silent

        # ── Build alert objects with priority scores ──────────────────────────
        alert_objects = []
        for det in in_range:
            label        = det["label"]
            sector       = _get_sector(det["center_x"], det["frame_w"])
            height_ratio = det["height_ratio"]
            dist_str     = _height_to_distance(height_ratio)
            dist_m       = _height_to_meters(height_ratio)
            is_fast      = det.get("is_fast", False)

            # Determine tier for cycle timing
            if label in VEHICLE_CLASSES or is_fast:
                tier       = "vehicle"
                cycle_s    = CYCLE_VEHICLE_S
                last_spoke = self.last_vehicle_time
            elif label in PERSON_CLASSES:
                tier       = "person"
                cycle_s    = CYCLE_PERSON_S
                last_spoke = self.last_person_time
            else:
                tier       = "furniture"
                cycle_s    = CYCLE_FURNITURE_S
                last_spoke = self.last_furniture_time

            # Only add this object if its tier's cooldown has elapsed
            if (now - last_spoke) < cycle_s:
                continue

            alert_text = _build_alert(label, sector, dist_str, is_fast)
            score      = _priority_score(label, dist_m, sector, is_fast)

            alert_objects.append({
                "alert":    alert_text,
                "priority": score,
                "is_fast":  is_fast,
                "label":    label,
                "sector":   sector,
                "dist_m":   dist_m,
                "tier":     tier,
            })

        if not alert_objects:
            return None     # all tiers on cooldown

        # Sort by priority descending
        alert_objects.sort(key=lambda x: x["priority"], reverse=True)

        # Update the last-spoke timestamp for whichever tier fires
        for obj in alert_objects:
            t = obj["tier"]
            if t == "vehicle":  self.last_vehicle_time   = now
            elif t == "person": self.last_person_time    = now
            else:               self.last_furniture_time = now

        return alert_objects


# Singleton
ai_engine = GuardianEngine()