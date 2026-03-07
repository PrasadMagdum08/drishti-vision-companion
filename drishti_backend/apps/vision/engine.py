import os
import torch
from google import genai
from google.genai import types
from transformers import AutoModelForCausalLM, AutoTokenizer
from PIL import Image
import io
import socket
import base64
import threading
import time

from dotenv import load_dotenv
load_dotenv()

# Gemini system prompt — strict one-sentence spatial response
DRISHTI_SYSTEM_PROMPT = (
    "You are Drishti, a navigation assistant for a blind person. "
    "RULES: "
    "1. Reply in EXACTLY ONE sentence. Never two. Never three. "
    "2. Start directly with the key information — no greetings, no preamble. "
    "3. Prioritize: hazards first, then people, then objects, then text. "
    "4. Use distance and direction: ahead, left, right, 1 meter, 2 meters. "
    "5. NEVER use: I can see, I notice, In this image, As a guide, Let me. "
    "6. NEVER give advice or instructions unless asked. Just describe facts. "
    "Good: Four people walking ahead on a sidewalk, cars parked on the left. "
    "Good: EXIT sign on the wall directly ahead. "
    "Good: A person standing one meter in front of you. "
    "Bad: I can see a group of four people including a man in a blue jacket. "
    "Bad: As a guide for a blind person I will help you navigate the sidewalk. "
)

# Moondream local prompt — same strict rules, simplified for smaller model
# MOONDREAM_PROMPT_TEMPLATE = (
#     "You are helping a blind person navigate. "
#     "Answer in EXACTLY ONE short sentence. "
#     "State only the most important thing: nearest hazard, person, or object with direction. "
#     "No greetings. No advice. No filler words. Just the key fact. "
#     "Question: {question}"
# )

# Moondream revision 2024-08-26 ONLY handles short bare questions.
# Any instruction text causes it to answer the instructions, not the image.
# Keep questions under 10 words — no preamble, no persona, no rules.
MOONDREAM_DESCRIBE_QUESTION = "What is directly in front of this person?"
MOONDREAM_DEFAULT_QUESTION   = "What is the most important object in this scene?"

CONNECTIVITY_CHECK_INTERVAL = 30


class VisionEngine:
    def __init__(self):
        print("Initializing Vision Engine (Hybrid Brain)...")

        self._is_online = False
        self._connectivity_lock = threading.Lock()
        self._start_connectivity_monitor()

        # Cloud Brain: Gemini (new google.genai SDK)
        self.gemini_client = None
        self.api_key = os.getenv("GEMINI_API_KEY")
        if self.api_key:
            self.gemini_client = genai.Client(api_key=self.api_key)
            print("Cloud Brain (Gemini 1.5 Flash): Ready")
        else:
            print("Cloud Brain: Disabled - GEMINI_API_KEY not found in .env")

        # Local Brain: lazy-loaded only when Gemini fails
        self.local_model = None
        self.tokenizer = None
        self._local_model_loading = False
        self._local_model_lock = threading.Lock()
        print("Local Brain (Moondream2): Standby — pre-warming in background thread")
        # Pre-warm Moondream in background so it is ready before Gemini fails.
        # Runs on CPU thread — no VRAM conflict with YOLO.
        # By the time user makes first voice request, Moondream will be loaded.
        threading.Thread(target=self._load_local_model_now, daemon=True).start()

    def _load_local_model_now(self):
        with self._local_model_lock:
            if self.local_model is not None or self._local_model_loading:
                return
            self._local_model_loading = True
        try:
            print("Gemini failed — loading Moondream2 fallback...")
            model_id = "vikhyatk/moondream2"
            revision = "2024-08-26"
            self.local_model = AutoModelForCausalLM.from_pretrained(
                model_id, trust_remote_code=True, revision=revision
            ).to(device="cuda" if torch.cuda.is_available() else "cpu", dtype=torch.float16 if torch.cuda.is_available() else torch.float32)
            self.tokenizer = AutoTokenizer.from_pretrained(model_id, revision=revision)
            device_used = "CUDA" if torch.cuda.is_available() else "CPU"
            print(f"Local Brain (Moondream2): Ready on {device_used}")
        except Exception as e:
            print(f"Local Brain failed to load: {e}")
            self.local_model = None
        finally:
            self._local_model_loading = False

    def _start_connectivity_monitor(self):
        def monitor():
            while True:
                try:
                    socket.create_connection(("8.8.8.8", 53), timeout=2)
                    online = True
                except OSError:
                    online = False
                with self._connectivity_lock:
                    self._is_online = online
                time.sleep(CONNECTIVITY_CHECK_INTERVAL)
        thread = threading.Thread(target=monitor, daemon=True)
        thread.start()
        print("Connectivity monitor started (checks every 30s)")

    def _is_internet_available(self):
        with self._connectivity_lock:
            return self._is_online

    def _base64_to_pil(self, base64_data):
        if isinstance(base64_data, str) and "," in base64_data:
            base64_data = base64_data.split(",")[1]
        img_bytes = base64.b64decode(base64_data)
        return Image.open(io.BytesIO(img_bytes)).convert('RGB')

    def _pil_to_bytes(self, image):
        """Convert PIL image to bytes for new Gemini SDK."""
        buffer = io.BytesIO()
        image.save(buffer, format='JPEG')
        return buffer.getvalue()

    def ask_brain(self, base64_data, user_question):
        try:
            image = self._base64_to_pil(base64_data)
        except Exception as e:
            print(f"Vision Engine image decode error: {e}")
            return "I had trouble processing the camera image."

        full_prompt = f"{DRISHTI_SYSTEM_PROMPT}\nUser Question: {user_question}"

        # A. Cloud Brain (Gemini) — new google.genai SDK
        if self.gemini_client and self._is_internet_available():
            try:
                print(f"Gemini answering: {user_question}")
                image_bytes = self._pil_to_bytes(image)
                response = self.gemini_client.models.generate_content(
                    model="models/gemini-2.0-flash-lite",
                    contents=[
                        full_prompt,
                        types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
                    ]
                )
                return response.text.replace("\n", " ").strip()
            except Exception as e:
                print(f"Gemini failed ({e}) - triggering Moondream2 lazy load")
                self._load_local_model_now()

        # B. Local Brain (Moondream2)
        if self.local_model:
            try:
                print(f"Moondream answering: {user_question}")
                image_embeds = self.local_model.encode_image(image)

                # FIX: Moondream 2024-08-26 fails on long prompts.
                # Map user intent to a bare short question the model can handle.
                user_lower = user_question.lower()
                if any(w in user_lower for w in [
                    "describe", "see", "look", "what is", "what's",
                    "scene", "front", "ahead", "around", "surroundings",
                    "explain", "show", "tell"
                ]):
                    moondream_q = MOONDREAM_DESCRIBE_QUESTION
                elif any(w in user_lower for w in ["read", "text", "sign", "label", "say"]):
                    moondream_q = "What text is visible in this image?"
                elif any(w in user_lower for w in ["who", "person", "face"]):
                    moondream_q = "Who is in this image?"
                else:
                    # For open questions, strip all instruction text
                    # Keep only the core noun/verb — max 8 words
                    words = user_question.strip().split()
                    moondream_q = " ".join(words[:8]) + "?"

                answer = self.local_model.answer_question(
                    image_embeds, moondream_q, self.tokenizer
                )
                cleaned = answer.replace("\n", " ").strip()

                # Sanity filter — Moondream sometimes returns single word/char garbage
                if len(cleaned) < 5 or cleaned.lower() in ["yes", "no", "1", "0", "true", "false", ""]:
                    return "I can see the scene but cannot describe it clearly right now."

                return cleaned

            except Exception as e:
                print(f"Moondream failed: {e}")
                return "I had trouble analyzing the scene."

        return "I am offline and cannot analyze the scene right now."


# Singleton
hybrid_brain = VisionEngine()
