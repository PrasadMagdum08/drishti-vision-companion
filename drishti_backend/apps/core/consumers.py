"""
consumers.py — Drishti WebSocket Consumer v2

Guardian module v2:
- No stability buffer
- No rotation cap
- 1.5s alert cycle always speaking
- Velocity-aware: "Fast bike, right" for approaching objects
- "Clear" when path is empty
- Debug mode: annotated frames sent back to DebugScreen
- Voice pipeline with cancel-same / queue-different logic
"""

import json
import asyncio
import base64
import tempfile
import os
import time
import whisper
import cv2
import numpy as np
from channels.generic.websocket import AsyncWebsocketConsumer
from guardian.engine import ai_engine
from guardian.annotator import annotate_frame, frame_to_base64
from vision.engine import hybrid_brain
from reader.engine import text_reader
from companion.engine import face_engine

stt_model = whisper.load_model("tiny")

# ─── Config ───────────────────────────────────────────────────────────────────
GUARDIAN_TOP_N       = 3      # top N objects announced per cycle
TTS_SENTENCE_GAP     = 0.6    # gap between sentences in one cycle (seconds)
VOICE_MUTE_SECONDS   = 5      # Guardian muted after voice response


# ─── Module-level helpers (used by debug mode) ───────────────────────────────
def _get_sector_from_box(box, frame_w: float) -> str:
    x1, y1, x2, y2 = box
    center_x = (x1 + x2) / 2
    if center_x < frame_w * 0.30:  return "left"
    if center_x > frame_w * 0.70:  return "right"
    return "ahead"

def _height_to_distance(height_ratio: float) -> str:
    if height_ratio >= 0.75: return "0.5m"
    if height_ratio >= 0.55: return "1m"
    if height_ratio >= 0.40: return "1.5m"
    if height_ratio >= 0.28: return "2m"
    if height_ratio >= 0.20: return "3m"
    return "4m"


# ══════════════════════════════════════════════════════════════════════════════
class VisionConsumer(AsyncWebsocketConsumer):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.last_frame       = None
        self.last_frame_dims  = (480, 480)
        self.is_processing_voice = False
        self.frame_lock       = asyncio.Lock()
        self._fps_timestamps: list[float] = []

        # Voice task management
        self.current_voice_task:   asyncio.Task | None = None
        self.current_voice_action: str | None          = None
        self.voice_queue:          list[dict]          = []

    # ──────────────────────────────────────────────────────────────────────────
    async def connect(self):
        print("⚡ Vision Stream Connected")
        await self.accept()
        await self.send(text_data=json.dumps({
            "status": "connected",
            "message": "Drishti Guardian v2 Ready"
        }))

    async def disconnect(self, close_code):
        print("🔌 Vision Stream Disconnected")
        if self.current_voice_task and not self.current_voice_task.done():
            self.current_voice_task.cancel()

    # ──────────────────────────────────────────────────────────────────────────
    # FRAME RESIZE
    # ──────────────────────────────────────────────────────────────────────────
    def _resize_frame(self, base64_data: str, max_dim: int = 480):
        try:
            if "," in base64_data:
                base64_data = base64_data.split(",")[1]
            img_bytes = base64.b64decode(base64_data)
            nparr     = np.frombuffer(img_bytes, np.uint8)
            img       = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return base64_data, 480, 480
            h, w = img.shape[:2]
            if max(h, w) <= max_dim:
                _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])
                return base64.b64encode(buf.tobytes()).decode(), w, h
            scale      = max_dim / max(h, w)
            nw, nh     = int(w * scale), int(h * scale)
            resized    = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
            _, buf     = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 70])
            return base64.b64encode(buf.tobytes()).decode(), nw, nh
        except Exception as e:
            print(f"Frame resize error: {e}")
            return base64_data, 480, 480

    # ──────────────────────────────────────────────────────────────────────────
    # MAIN RECEIVE
    # ──────────────────────────────────────────────────────────────────────────
    async def receive(self, text_data=None, bytes_data=None):
        if not text_data or len(text_data) < 10:
            return
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        msg_type = data.get("type")

        # ══════════════════════════════════════════════════════════════════════
        # MODULE 1 — GUARDIAN v2
        # ══════════════════════════════════════════════════════════════════════
        if msg_type == "video_frame":
            raw_frame  = data.get("data", "")
            debug_mode = data.get("debug", False)   # DebugScreen sends debug:true

            if raw_frame:
                if "," in raw_frame:
                    raw_frame = raw_frame.split(",")[1]
                resized, fw, fh = self._resize_frame(raw_frame)
                async with self.frame_lock:
                    self.last_frame      = resized
                    self.last_frame_dims = (fw, fh)

            if self.is_processing_voice:
                return

            async with self.frame_lock:
                current_frame = self.last_frame
                fw, fh        = self.last_frame_dims

            if not current_frame:
                return

            try:
                # Track FPS
                now_t = time.time()
                self._fps_timestamps.append(now_t)
                self._fps_timestamps = [t for t in self._fps_timestamps if now_t - t <= 1.0]
                current_fps = len(self._fps_timestamps)

                # Run Guardian inference
                alert_objects = await asyncio.to_thread(
                    ai_engine.process_frame, current_frame
                )

                # ── Debug mode: annotate frame and echo back to DebugScreen ──
                if debug_mode:
                    debug_dets = []
                    for tid, track in ai_engine.tracker.tracks.items():
                        debug_dets.append({
                            "box":      track["box"],
                            "label":    track["label"],
                            "dist_str": _height_to_distance(track["height_ratio"]),
                            "is_fast":  track["is_fast"],
                            "track_id": tid,
                            "sector":   _get_sector_from_box(track["box"], fw),
                            "priority": 0,
                        })

                    # Decode current frame, draw annotations, re-encode
                    img_bytes = base64.b64decode(current_frame)
                    nparr     = np.frombuffer(img_bytes, np.uint8)
                    img       = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                    if img is not None:
                        annotated     = annotate_frame(
                            img, debug_dets,
                            fps=current_fps,
                            track_count=len(ai_engine.tracker.tracks)
                        )
                        annotated_b64 = frame_to_base64(annotated)
                        last_alert_text = (
                            alert_objects[0]["alert"] if alert_objects else ""
                        )
                        await self.send(text_data=json.dumps({
                            "type":        "debug_frame",
                            "frame":       annotated_b64,
                            "detections":  debug_dets,
                            "fps":         current_fps,
                            "track_count": len(ai_engine.tracker.tracks),
                            "last_alert":  last_alert_text,
                        }))

                # ── Normal mode: send obstacle alerts ────────────────────────
                if not alert_objects:
                    return

                top_alerts = alert_objects[:GUARDIAN_TOP_N]
                for alert_obj in top_alerts:
                    await self.send(text_data=json.dumps({
                        "type":  "obstacle",
                        "alert": alert_obj["alert"],
                        "fast":  alert_obj.get("is_fast", False),
                    }))
                    if len(top_alerts) > 1:
                        await asyncio.sleep(TTS_SENTENCE_GAP)

            except Exception as e:
                print(f"Guardian error: {e}")
            return

        # ══════════════════════════════════════════════════════════════════════
        # VOICE PIPELINE
        # ══════════════════════════════════════════════════════════════════════
        if msg_type == "audio_command":
            print("🎙️ Voice command received...")
            base64_audio = data.get("data")
            if not base64_audio:
                return

            # STT first — need action type before cancel/queue decision
            try:
                with tempfile.NamedTemporaryFile(delete=False, suffix=".m4a") as tmp:
                    tmp.write(base64.b64decode(base64_audio))
                    tmp_path = tmp.name

                result    = await asyncio.to_thread(stt_model.transcribe, tmp_path)
                user_text = result["text"].strip().lower()
                os.remove(tmp_path)
                print(f"🗣️ User: {user_text}")

                wc = len(user_text.split())
                if wc > 12 or wc < 1 or len(user_text.strip()) < 2:
                    print("Whisper filter — ignoring")
                    return

            except Exception as e:
                print(f"STT error: {e}")
                return

            new_action = self.map_voice_to_action(user_text)

            # Cancel same-type, queue different-type
            if self.current_voice_task and not self.current_voice_task.done():
                if new_action == self.current_voice_action:
                    print(f"Same action '{new_action}' — cancelling old")
                    self.current_voice_task.cancel()
                    try:
                        await self.current_voice_task
                    except asyncio.CancelledError:
                        pass
                    self.is_processing_voice = False
                else:
                    print(f"Different action '{new_action}' — queuing")
                    self.voice_queue.append({
                        "user_text": user_text,
                        "action":    new_action
                    })
                    return

            async with self.frame_lock:
                fresh_frame = self.last_frame

            self.current_voice_action = new_action
            self.current_voice_task   = asyncio.create_task(
                self._process_voice(user_text, new_action, fresh_frame)
            )

    # ──────────────────────────────────────────────────────────────────────────
    # VOICE PROCESSOR
    # ──────────────────────────────────────────────────────────────────────────
    async def _process_voice(
        self,
        user_text: str,
        action:    str | None,
        frame:     str | None
    ):
        self.is_processing_voice = True
        try:
            await self.send(text_data=json.dumps({
                "type": "description",
                "text": "Analyzing."
            }))

            if not frame:
                await self.send(text_data=json.dumps({
                    "type": "description",
                    "text": "No camera frame yet. Please wait."
                }))
                return

            if action == "read_text":
                print("📖 Reader Module...")
                text_content = await asyncio.to_thread(text_reader.read_text, frame)
                if (text_content
                        and len(text_content.strip()) >= 3
                        and any(c.isalpha() for c in text_content)):
                    answer = f"It says: {text_content}"
                else:
                    answer = "No clear text visible. Move closer and hold steady."

            elif action == "analyze_face":
                print("👤 Companion Module...")
                result = await asyncio.to_thread(face_engine.recognize_known_person, frame)
                if result and not result.startswith("I"):
                    answer = result
                else:
                    answer = await asyncio.to_thread(
                        hybrid_brain.ask_brain, frame,
                        "Describe the person in front of me in one sentence."
                    )

            elif action == "describe":
                print("🔍 Vision Module — describe...")
                answer = await asyncio.to_thread(
                    hybrid_brain.ask_brain, frame,
                    "Describe the scene in front of this blind person in one sentence."
                )

            else:
                print(f"🔍 Vision Module — question: {user_text}")
                answer = await asyncio.to_thread(
                    hybrid_brain.ask_brain, frame, user_text
                )

            await self.send(text_data=json.dumps({
                "type":     "description",
                "text":     answer,
                "priority": True       # frontend uses this to skip obstacle queue
            }))

            print(f"🔇 Guardian muted {VOICE_MUTE_SECONDS}s")
            await asyncio.sleep(VOICE_MUTE_SECONDS)

        except asyncio.CancelledError:
            print(f"Voice task cancelled ({action})")
            raise   # must re-raise

        except Exception as e:
            print(f"Voice error: {e}")
            await self.send(text_data=json.dumps({
                "type": "description",
                "text": "I had trouble with that. Please try again."
            }))

        finally:
            self.is_processing_voice  = False
            self.current_voice_action = None
            print("🔊 Guardian resumed")

            # Process next queued request if any
            if self.voice_queue:
                next_req = self.voice_queue.pop(0)
                async with self.frame_lock:
                    fresh_frame = self.last_frame
                self.current_voice_action = next_req["action"]
                self.current_voice_task   = asyncio.create_task(
                    self._process_voice(
                        next_req["user_text"],
                        next_req["action"],
                        fresh_frame
                    )
                )

    # ──────────────────────────────────────────────────────────────────────────
    # VOICE ROUTING
    # ──────────────────────────────────────────────────────────────────────────
    def map_voice_to_action(self, text: str) -> str | None:
        t = text.lower()
        if any(w in t for w in ["who is", "who are", "recognize", "face"]):
            return "analyze_face"
        if any(w in t for w in ["read", "what does it say", "sign", "label", "text", "written"]):
            return "read_text"
        if any(w in t for w in [
            "describe", "see", "look", "what is", "what's", "around",
            "in front", "ahead", "scene", "surroundings", "explain",
            "tell me", "what do", "nearby", "where", "how many",
            "is there", "are there"
        ]):
            return "describe"
        return None