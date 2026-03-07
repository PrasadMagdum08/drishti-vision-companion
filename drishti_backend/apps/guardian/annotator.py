"""
guardian/annotator.py

Draws debug annotations on frames when debug=true is sent from frontend.
Called only when DebugScreen is active — zero overhead in production.

Annotations:
- Bounding boxes colored by tier
- Label + distance + confidence
- "FAST" badge for approaching objects  
- Sector boundary lines (30% / 70%)
- Track ID in corner of each box
"""

import cv2
import numpy as np
import base64

# ─── Tier Colors (BGR for OpenCV) ─────────────────────────────────────────────
COLOR_VEHICLE  = (0,  100, 255)   # orange-red
COLOR_FAST     = (0,  0,   255)   # pure red
COLOR_PERSON   = (0,  215, 255)   # gold
COLOR_HAZARD   = (0,  165, 255)   # orange
COLOR_DEFAULT  = (0,  255, 150)   # green
COLOR_SECTOR   = (255, 255, 255)  # white for sector lines

VEHICLE_CLASSES = {"car", "motorcycle", "bus", "truck", "bicycle", "scooter", "motorbike"}
PERSON_CLASSES  = {"person", "people"}
HAZARD_CLASSES  = {"pothole", "stairs", "step", "curb", "fire hydrant"}


def _get_color(label: str, is_fast: bool):
    if is_fast:               return COLOR_FAST
    if label in VEHICLE_CLASSES: return COLOR_VEHICLE
    if label in PERSON_CLASSES:  return COLOR_PERSON
    if label in HAZARD_CLASSES:  return COLOR_HAZARD
    return COLOR_DEFAULT


def annotate_frame(
    img: np.ndarray,
    detections: list[dict],
    fps: float = 0.0,
    track_count: int = 0,
) -> np.ndarray:
    """
    Draw all debug annotations on img (in-place copy).
    detections: list of dicts from guardian engine with box, label, etc.
    """
    out = img.copy()
    h, w = out.shape[:2]

    # ── Sector boundary lines ────────────────────────────────────────────────
    left_x  = int(w * 0.30)
    right_x = int(w * 0.70)

    cv2.line(out, (left_x, 0), (left_x, h), (255, 255, 255, 80), 1, cv2.LINE_AA)
    cv2.line(out, (right_x, 0), (right_x, h), (255, 255, 255, 80), 1, cv2.LINE_AA)

    # Sector labels at bottom
    cv2.putText(out, "LEFT",   (8, h - 8),          cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200,200,200), 1, cv2.LINE_AA)
    cv2.putText(out, "CENTER", (left_x + 8, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200,200,200), 1, cv2.LINE_AA)
    cv2.putText(out, "RIGHT",  (right_x + 8, h - 8),cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200,200,200), 1, cv2.LINE_AA)

    # ── Per-detection boxes ──────────────────────────────────────────────────
    for det in detections:
        x1, y1, x2, y2 = [int(v) for v in det["box"]]
        label    = det["label"]
        dist_str = det.get("dist_str", "")
        is_fast  = det.get("is_fast", False)
        track_id = det.get("track_id", "?")
        priority = det.get("priority", 0)
        sector   = det.get("sector", "")

        color = _get_color(label, is_fast)
        thickness = 3 if is_fast else 2

        # Bounding box
        cv2.rectangle(out, (x1, y1), (x2, y2), color, thickness)

        # Label text: "person | 2m | T42"
        display = f"{label} | {dist_str} | #{track_id}"
        if is_fast:
            display = f"FAST {label} | {dist_str} | #{track_id}"

        # Background pill for label
        (tw, th), _ = cv2.getTextSize(display, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
        label_y = max(y1 - 4, th + 4)
        cv2.rectangle(
            out,
            (x1, label_y - th - 4),
            (x1 + tw + 6, label_y + 2),
            color, -1
        )
        cv2.putText(
            out, display,
            (x1 + 3, label_y - 2),
            cv2.FONT_HERSHEY_SIMPLEX, 0.42,
            (0, 0, 0), 1, cv2.LINE_AA
        )

        # Priority score in corner of box (small)
        cv2.putText(
            out, f"P{int(priority)}",
            (x2 - 40, y2 - 4),
            cv2.FONT_HERSHEY_SIMPLEX, 0.35,
            color, 1, cv2.LINE_AA
        )

        # Velocity arrow for fast objects
        if is_fast:
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2
            # Arrow pointing toward camera (downward = approaching)
            cv2.arrowedLine(
                out,
                (cx, cy - 20),
                (cx, cy + 20),
                COLOR_FAST, 2, cv2.LINE_AA, tipLength=0.4
            )

    # ── HUD: FPS + track count ───────────────────────────────────────────────
    hud = f"FPS:{fps:.1f}  Tracks:{track_count}  Objs:{len(detections)}"
    cv2.rectangle(out, (0, 0), (len(hud) * 8 + 10, 22), (0, 0, 0), -1)
    cv2.putText(out, hud, (5, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 0), 1, cv2.LINE_AA)

    return out


def frame_to_base64(img: np.ndarray) -> str:
    """Encode annotated frame to base64 JPEG for WebSocket send."""
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 75])
    return base64.b64encode(buf.tobytes()).decode("utf-8")