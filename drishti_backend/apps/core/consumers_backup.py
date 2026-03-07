import json
import asyncio
import base64
import tempfile
import os
import whisper
import cv2
import numpy as np
from channels.generic.websocket import AsyncWebsocketConsumer
from guardian.engine import ai_engine
from vision.engine import hybrid_brain
from reader.engine import text_reader
from companion.engine import face_engine

stt_model = whisper.load_model("tiny")

class VisionConsumer(AsyncWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.last_frame = None
        self.last_frame_dims = (480, 480)   # (width, height) — updated per frame
        self.is_processing_voice = False
        self.last_alert_sent = None
        self.frame_lock = asyncio.Lock()

    async def connect(self):
        print("Vision Stream Connected")
        await self.accept()
        await self.send(text_data=json.dumps({
            "status": "connected",
            "message": "Drishti Multi-Vision Ready"
        }))

    async def disconnect(self, close_code):
        print("Vision Stream Disconnected")

    # ==================================================================
    # FRAME RESIZE HELPER
    # FIX 1: Now returns (base64, width, height) so spatial math uses
    # actual frame dimensions instead of assumed 480x480.
    # Portrait phone frames are typically 270x480, not 480x480.
    # ==================================================================
    def _resize_frame(self, base64_data, max_dim=480):
        try:
            if isinstance(base64_data, str) and "," in base64_data:
                base64_data = base64_data.split(",")[1]
            img_bytes = base64.b64decode(base64_data)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return base64_data, 480, 480

            h, w = img.shape[:2]

            if max(h, w) <= max_dim:
                _, buffer = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 60])
                return base64.b64encode(buffer.tobytes()).decode("utf-8"), w, h

            scale = max_dim / max(h, w)
            new_w, new_h = int(w * scale), int(h * scale)
            resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
            _, buffer = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 60])
            return base64.b64encode(buffer.tobytes()).decode("utf-8"), new_w, new_h

        except Exception as e:
            print(f"Frame resize error: {e}")
            return base64_data, 480, 480

    # ==================================================================
    # MAIN RECEIVE HANDLER
    # ==================================================================
    async def receive(self, text_data=None, bytes_data=None):
        if not text_data or len(text_data) < 10:
            return
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        msg_type = data.get("type")

        # ==============================================================
        # MODULE 1 -- GUARDIAN: Real-time obstacle detection
        # ==============================================================
        if msg_type == "video_frame":
            raw_frame = data.get("data")
            if raw_frame:
                if "," in raw_frame:
                    raw_frame = raw_frame.split(",")[1]
                resized_frame, frame_w, frame_h = self._resize_frame(raw_frame)
                async with self.frame_lock:
                    self.last_frame = resized_frame
                    self.last_frame_dims = (frame_w, frame_h)

            if not self.is_processing_voice:
                async with self.frame_lock:
                    current_frame = self.last_frame
                    current_dims = self.last_frame_dims

                if current_frame:
                    try:
                        detections = await asyncio.to_thread(
                            ai_engine.process_frame, current_frame
                        )
                        alert = self.calculate_safety_alert(detections, current_dims)
                        if alert:
                            await self.send(text_data=json.dumps({
                                "type": "obstacle",
                                "alert": alert
                            }))
                    except Exception as e:
                        print(f"Guardian error: {e}")
            return

        # ==============================================================
        # VOICE PIPELINE
        # ==============================================================
        if msg_type == "audio_command":
            self.is_processing_voice = True
            print("Processing voice command...")
            try:
                await self.send(text_data=json.dumps({
                    "type": "description",
                    "text": "Analyzing your command."
                }))

                base64_audio = data.get("data")
                if not base64_audio:
                    raise ValueError("No audio data received")

                with tempfile.NamedTemporaryFile(delete=False, suffix=".m4a") as temp:
                    temp.write(base64.b64decode(base64_audio))
                    temp_path = temp.name

                result = await asyncio.to_thread(stt_model.transcribe, temp_path)
                user_text = result["text"].strip().lower()
                os.remove(temp_path)
                print(f"User said: {user_text}")

                # Whisper hallucination filter
                word_count = len(user_text.split())
                if word_count > 12:
                    print(f"Whisper hallucination ({word_count} words) — ignoring")
                    await self.send(text_data=json.dumps({
                        "type": "description",
                        "text": "Sorry, I did not catch that. Please try again."
                    }))
                    return
                if word_count < 1 or len(user_text.strip()) < 2:
                    print("Whisper too short — ignoring")
                    return

                action = self.map_voice_to_action(user_text)

                async with self.frame_lock:
                    current_frame = self.last_frame

                if not current_frame:
                    await self.send(text_data=json.dumps({
                        "type": "description",
                        "text": "I don't have a camera frame yet. Please wait a moment."
                    }))
                    return

                if action == "read_text":
                    print("Reader Module activated...")
                    text_content = await asyncio.to_thread(
                        text_reader.read_text, current_frame
                    )
                    # FIX 3: OCR garbage filter
                    # Reject single chars, pure numbers, punctuation-only results
                    if (text_content
                            and len(text_content.strip()) >= 3
                            and any(c.isalpha() for c in text_content)):
                        answer = f"It says: {text_content}"
                    else:
                        answer = "I cannot read the text clearly. Please move closer and hold the camera steady."

                elif action == "analyze_face":
                    print("Companion Module activated...")
                    recognition_result = await asyncio.to_thread(
                        face_engine.recognize_known_person, current_frame
                    )
                    if recognition_result and not recognition_result.startswith("I"):
                        answer = recognition_result
                    else:
                        answer = await asyncio.to_thread(
                            hybrid_brain.ask_brain, current_frame,
                            "Describe the person in front of me in one sentence."
                        )

                elif action == "describe":
                    print("Vision Module -- scene description")
                    answer = await asyncio.to_thread(
                        hybrid_brain.ask_brain, current_frame,
                        "Describe the scene in front of this blind person in one sentence."
                    )

                else:
                    print(f"Vision Module -- question: {user_text}")
                    answer = await asyncio.to_thread(
                        hybrid_brain.ask_brain, current_frame, user_text
                    )

                await self.send(text_data=json.dumps({
                    "type": "description",
                    "text": answer
                }))

                print("YOLO muted for 5 seconds")
                await asyncio.sleep(5)

            except Exception as e:
                print(f"Voice pipeline error: {e}")
                await self.send(text_data=json.dumps({
                    "type": "description",
                    "text": "I had trouble processing that. Please try again."
                }))
            finally:
                self.is_processing_voice = False
                print("YOLO alerts resumed")

    # ==================================================================
    # FIX 2: VOICE ROUTING — expanded keyword list
    # Added: explain, show, tell, nearby, front, where, is there, are there
    # Catches common Whisper mis-transcriptions of "describe" and "explain"
    # ==================================================================
    def map_voice_to_action(self, text):
        t = text.lower()

        if any(w in t for w in ["who is", "who are", "recognize", "do i know", "face"]):
            return "analyze_face"

        if any(w in t for w in ["read", "what does it say", "book", "paper", "sign", "label", "text", "write", "written"]):
            return "read_text"

        if any(w in t for w in [
            "describe", "see", "look", "what is", "what's", "around",
            "in front", "ahead", "scene", "surroundings", "explain",
            "show", "tell me", "what do", "nearby", "front", "where",
            "how many", "is there", "are there"
        ]):
            return "describe"

        return None

    # ==================================================================
    # FIX 1: SPATIAL ALERT — uses actual frame_dims, not hardcoded 480x480
    # Portrait frames (270x480): left third = x < 90, right = x > 180
    # Landscape frames (480x270): left third = x < 160, right = x > 320
    # Height ratio still uses frame_h for distance estimation
    # ==================================================================
    def calculate_safety_alert(self, detections, frame_dims=(480, 480)):
        if not detections:
            return None

        # Use frame dims from detection if available, else fallback
        frame_w = detections[0].get("frame_w", frame_dims[0])
        frame_h = detections[0].get("frame_h", frame_dims[1])

        sectors = {"left": [], "center": [], "right": []}

        for obj in detections:
            x_min, y_min, x_max, y_max = obj["box"]
            center_x = (x_min + x_max) / 2
            dist_m = obj.get("dist_m", 2.0)
            label = obj["object"]

            # FIX 1: Sector boundaries based on real frame_w (portrait aware)
            # Center zone is wider (40%) — reduces left/right misclassification
            left_boundary  = frame_w * 0.30   # was frame_w/3 = 33%
            right_boundary = frame_w * 0.70   # was 2*frame_w/3 = 67%

            if center_x < left_boundary:
                sectors["left"].append((label, dist_m, obj["risk"]))
            elif center_x > right_boundary:
                sectors["right"].append((label, dist_m, obj["risk"]))
            else:
                sectors["center"].append((label, dist_m, obj["risk"]))

        # Build alert text — most dangerous per sector first
        alert_parts = []
        if sectors["center"]:
            l, d, _ = sectors["center"][0]
            alert_parts.append(f"{l} ahead, {d} meters")
        if sectors["left"]:
            l, d, _ = sectors["left"][0]
            alert_parts.append(f"{l} on your left")
        if sectors["right"]:
            l, d, _ = sectors["right"][0]
            alert_parts.append(f"{l} on your right")

        if not alert_parts:
            return None

        new_alert = ", ".join(alert_parts)

        # FIX 2: Suppress duplicate alerts — exact match dedup
        if self.last_alert_sent == new_alert:
            return None

        self.last_alert_sent = new_alert
        return new_alert