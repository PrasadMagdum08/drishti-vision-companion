import cv2
import numpy as np
import base64
from ultralytics import YOLO
import torch

MODEL_PATH = 'yolov8s.pt'  # FIX 4: small model, better than nano

DEFAULT_CONFIDENCE = 0.55

RISK_CONFIDENCE_THRESHOLDS = {
    "person": 0.45, "bicycle": 0.45, "car": 0.40,
    "motorcycle": 0.40, "bus": 0.40, "truck": 0.40,
    "dog": 0.45, "stairs": 0.45,
    "chair": 0.55, "dining table": 0.55, "bench": 0.55,
    "potted plant": 0.55, "fire hydrant": 0.50, "stop sign": 0.50,
    "tv": 0.65, "laptop": 0.65, "bottle": 0.70, "cup": 0.75, "book": 0.75,
}

RISK_PRIORITY = {
    "person": 10, "car": 9, "motorcycle": 9, "bus": 9, "truck": 9,
    "bicycle": 8, "dog": 7, "stairs": 7,
    "fire hydrant": 5, "stop sign": 5,
    "chair": 4, "dining table": 4, "bench": 3, "potted plant": 2,
}

def _estimate_distance(height_ratio):
    # FIX 5: Calibrated for chest-mount ~1.2m height, portrait mode
    if height_ratio >= 0.80: return 0.5
    elif height_ratio >= 0.60: return 1.0
    elif height_ratio >= 0.45: return 1.5
    elif height_ratio >= 0.35: return 2.0
    elif height_ratio >= 0.28: return 2.5
    elif height_ratio >= 0.22: return 3.0
    elif height_ratio >= 0.20: return 4.0
    else: return None  # Too far, skip

class GuardianEngine:
    def __init__(self):
        print("🛡️ Loading Guardian Engine (YOLOv8s)...")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"🎮 Guardian running on: {self.device.upper()}")
        self.model = YOLO(MODEL_PATH)
        self.model.to(self.device)
        print("✅ Guardian Engine Ready!")

    def _decode_frame(self, base64_data):
        if "," in base64_data:
            base64_data = base64_data.split(",")[1]
        img_bytes = base64.b64decode(base64_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Could not decode image.")
        return img

    def process_frame(self, base64_data):
        try:
            img = self._decode_frame(base64_data)
        except Exception as e:
            print(f"Guardian decode error: {e}")
            return []

        h, w = img.shape[:2]

        try:
            results = self.model(img, verbose=False)
        except Exception as e:
            print(f"Guardian inference error: {e}")
            return []

        detections = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                class_name = self.model.names[cls_id]
                conf = float(box.conf[0])
                threshold = RISK_CONFIDENCE_THRESHOLDS.get(class_name, DEFAULT_CONFIDENCE)
                if conf < threshold:
                    continue
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                height_ratio = (y2 - y1) / h
                if height_ratio < 0.20:  # FIX 3: was 0.15
                    continue
                dist_m = _estimate_distance(height_ratio)
                if dist_m is None:
                    continue
                detections.append({
                    "object": class_name,
                    "confidence": round(conf, 2),
                    "box": [x1, y1, x2, y2],
                    "risk": RISK_PRIORITY.get(class_name, 1),
                    "dist_m": dist_m,
                    "frame_w": w,
                    "frame_h": h,
                })

        detections.sort(key=lambda x: x["risk"], reverse=True)
        return detections

ai_engine = GuardianEngine()