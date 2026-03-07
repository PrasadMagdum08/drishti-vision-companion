import cv2
import numpy as np
import os
import uuid
import base64
import cloudinary
import cloudinary.uploader
from dotenv import load_dotenv

load_dotenv()

# ==============================================================================
# COMPANION MODULE — Face Recognition Engine
# Module 4 of 6 in Drishti's vision pipeline.
# Activated on demand when user asks "who is this?" or "do I know this person?"
#
# FIX H5: Replaced OpenCV matchTemplate with LBPH (Local Binary Pattern Histogram).
# matchTemplate only worked if the person was at the same angle/lighting as saved photo.
# LBPH is specifically designed for face recognition and handles:
#   - Different lighting conditions
#   - Slight head rotation
#   - Glasses and minor appearance changes
#
# FIX U5: Silent None returns replaced with explicit TTS-friendly messages.
# Blind user now always gets audio feedback — no more silent failures.
# ==============================================================================

# Cloudinary config for cloud backup of saved faces
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True
)

# LBPH confidence threshold — lower score = better match (it's a distance metric)
# Scores below this threshold are considered a confirmed match.
LBPH_CONFIDENCE_THRESHOLD = 80.0

# Local face database path
FACE_DB_PATH = "media/faces"
FACE_LABELS_PATH = "media/faces/labels.txt"


class CompanionEngine:
    def __init__(self):
        print("Loading Companion Engine (Face Recognition)...")

        # Haar cascade for face detection
        cv2_base_dir = os.path.dirname(os.path.abspath(cv2.__file__))
        haar_model = os.path.join(cv2_base_dir, 'data/haarcascade_frontalface_default.xml')
        self.face_cascade = cv2.CascadeClassifier(haar_model)

        # FIX H5: LBPH recognizer — built for face recognition, not template matching
        self.recognizer = cv2.face.LBPHFaceRecognizer_create()

        # Label map: numeric ID → person name
        self.label_map = {}

        # Setup storage directories
        os.makedirs(FACE_DB_PATH, exist_ok=True)

        # Load existing face model if available
        self._load_recognizer()
        print("Companion Engine Ready!")

    def _load_recognizer(self):
        """Load trained LBPH model and label map from disk if they exist."""
        model_path = os.path.join(FACE_DB_PATH, "lbph_model.yml")
        if os.path.exists(model_path) and os.path.exists(FACE_LABELS_PATH):
            try:
                self.recognizer.read(model_path)
                with open(FACE_LABELS_PATH, 'r') as f:
                    for line in f:
                        parts = line.strip().split(":")
                        if len(parts) == 2:
                            self.label_map[int(parts[0])] = parts[1]
                print(f"Loaded {len(self.label_map)} known faces from model.")
            except Exception as e:
                print(f"Could not load face model: {e}")

    def _save_recognizer(self):
        """Persist LBPH model and label map to disk."""
        model_path = os.path.join(FACE_DB_PATH, "lbph_model.yml")
        self.recognizer.save(model_path)
        with open(FACE_LABELS_PATH, 'w') as f:
            for label_id, name in self.label_map.items():
                f.write(f"{label_id}:{name}\n")

    def _base64_to_cv2(self, base64_data):
        """Convert Base64 string to OpenCV BGR image."""
        try:
            if isinstance(base64_data, str) and "," in base64_data:
                base64_data = base64_data.split(",")[1]
            img_bytes = base64.b64decode(base64_data)
            nparr = np.frombuffer(img_bytes, np.uint8)
            return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:
            print(f"Companion image decode error: {e}")
            return None

    def _detect_face(self, gray_img):
        """Detect faces and return the largest one as (x, y, w, h) or None."""
        faces = self.face_cascade.detectMultiScale(
            gray_img,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(60, 60)  # Ignore tiny faces — must be reasonably close
        )
        if len(faces) == 0:
            return None
        # Return largest face by area
        return max(faces, key=lambda f: f[2] * f[3])

    def save_face(self, base64_data, name):
        """
        Saves a new person's face to the LBPH model.
        Backs up the original photo to Cloudinary.

        Returns:
            str: TTS-friendly confirmation or error message
        """
        try:
            img = self._base64_to_cv2(base64_data)
            if img is None:
                return "I could not process the image."

            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            face = self._detect_face(gray)

            if face is None:
                return "I don't see a face clearly. Please point the camera directly at the person's face."

            (x, y, w, h) = face
            face_roi = cv2.resize(gray[y:y+h, x:x+w], (200, 200))

            # Assign numeric label for LBPH
            existing_names = list(self.label_map.values())
            if name in existing_names:
                label_id = [k for k, v in self.label_map.items() if v == name][0]
            else:
                label_id = len(self.label_map)
                self.label_map[label_id] = name

            # Train/update the recognizer
            self.recognizer.update([face_roi], np.array([label_id]))
            self._save_recognizer()

            # Cloud backup
            try:
                if isinstance(base64_data, str) and "," in base64_data:
                    clean_b64 = base64_data.split(",")[1]
                else:
                    clean_b64 = base64_data

                img_bytes = base64.b64decode(clean_b64)
                unique_id = uuid.uuid4().hex[:6]
                cloudinary.uploader.upload(
                    img_bytes,
                    folder="drishti/faces",
                    public_id=f"{name}_{unique_id}",
                    tags=["drishti", name]
                )
                print(f"Cloud backup successful for: {name}")
            except Exception as e:
                print(f"Cloud backup failed (non-critical): {e}")

            return f"I have memorized {name}. I will recognize them next time."

        except Exception as e:
            print(f"save_face error: {e}")
            return "I had trouble saving this face. Please try again."

    def recognize_known_person(self, base64_data):
        """
        Attempts to recognize a known person using LBPH.

        Returns:
            str: Person's name if recognized, or a spoken message if not.
        FIX U5: Never returns silent None — always returns speakable feedback.
        """
        try:
            if not self.label_map:
                return "I don't have any saved faces yet. Ask me to remember someone first."

            img = self._base64_to_cv2(base64_data)
            if img is None:
                return "I could not process the camera image."

            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            face = self._detect_face(gray)

            if face is None:
                return "I don't see a face clearly in front of me."

            (x, y, w, h) = face
            face_roi = cv2.resize(gray[y:y+h, x:x+w], (200, 200))

            label_id, confidence = self.recognizer.predict(face_roi)
            print(f"Recognition confidence score: {confidence} (lower is better)")

            # FIX H5: LBPH confidence — lower score means better match
            if confidence < LBPH_CONFIDENCE_THRESHOLD:
                name = self.label_map.get(label_id, "someone")
                return f"This is {name}."
            else:
                return "I don't recognize this person."

        except Exception as e:
            print(f"recognize_known_person error: {e}")
            return "I had trouble with face recognition."

    def analyze_stranger(self, base64_data):
        """
        Describes an unknown person using the Vision Module (Gemini/Moondream).
        FIX: Removed BLIP dependency — now routes to vision/engine.py hybrid brain.

        Note: This method is called from consumers.py which imports hybrid_brain.
        We return a signal here and let the consumer handle the VLM call
        to avoid circular imports between companion and vision modules.
        """
        try:
            img = self._base64_to_cv2(base64_data)
            if img is None:
                return None  # Signal to consumer to use VLM with full frame

            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            face = self._detect_face(gray)

            if face is None:
                return "I don't see a face clearly."

            return None  # Signal: face detected, let VLM describe them

        except Exception as e:
            print(f"analyze_stranger error: {e}")
            return None


# Singleton
face_engine = CompanionEngine()