import os
import torch
from google import genai
from google.genai import types
from google.genai.errors import APIError
from transformers import AutoModelForCausalLM, AutoTokenizer, AutoProcessor
from PIL import Image
import io
import socket
import base64
import threading
import time

from dotenv import load_dotenv
load_dotenv()

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

MOONDREAM_DESCRIBE_QUESTION = "What is directly in front of this person?"
CONNECTIVITY_CHECK_INTERVAL = 30

class VisionEngine:
    def __init__(self):
        print("Initializing Vision Engine (Hybrid Brain)...")

        self._is_online = False
        self._connectivity_lock = threading.Lock()
        self._start_connectivity_monitor()

        self.gemini_client = None
        self.api_key = os.getenv("GEMINI_API_KEY")
        if self.api_key:
            self.gemini_client = genai.Client(api_key=self.api_key)
            print("Cloud Brain (Gemini 2.5 Flash): Ready")
        else:
            print("Cloud Brain: Disabled - GEMINI_API_KEY not found in .env")

        self.md_model = None
        self.md_tokenizer = None
        self.fl_model = None
        self.fl_processor = None
        
        self._local_models_loading = False
        self._local_models_lock = threading.Lock()
        
        print("Local Brains: Standby — pre-warming Moondream & Florence in background...")
        threading.Thread(target=self._load_local_models_now, daemon=True).start()

    def _load_local_models_now(self):
        with self._local_models_lock:
            if (self.md_model is not None and self.fl_model is not None) or self._local_models_loading:
                return
            self._local_models_loading = True
            
        try:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            dtype = torch.float16 if torch.cuda.is_available() else torch.float32

            if self.md_model is None:
                print("Loading Edge Expert 1: Moondream2 (Scene Analysis)...")
                md_id = "vikhyatk/moondream2"
                md_rev = "2024-08-26"
                self.md_model = AutoModelForCausalLM.from_pretrained(
                    md_id, trust_remote_code=True, revision=md_rev
                ).to(device=device, dtype=dtype)
                self.md_tokenizer = AutoTokenizer.from_pretrained(md_id, revision=md_rev)
                print(f"✅ Moondream2 Ready on {device}")

            if self.fl_model is None:
                print("Loading Edge Expert 2: Florence-2 (OCR)...")
                fl_id = "microsoft/Florence-2-base-ft"
                self.fl_processor = AutoProcessor.from_pretrained(fl_id, trust_remote_code=True)
                self.fl_model = AutoModelForCausalLM.from_pretrained(
                    fl_id, trust_remote_code=True, torch_dtype=dtype
                ).to(device)
                print(f"✅ Florence-2 Ready on {device}")

        except Exception as e:
            print(f"Local Brains failed to load: {e}")
        finally:
            self._local_models_loading = False

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
        buffer = io.BytesIO()
        image.save(buffer, format='JPEG')
        return buffer.getvalue()

    def ask_brain(self, base64_data, user_question, force_ocr=False):
        try:
            image = self._base64_to_pil(base64_data)
        except Exception as e:
            print(f"Vision Engine image decode error: {e}")
            return "I had trouble processing the camera image."

        full_prompt = f"{DRISHTI_SYSTEM_PROMPT}\nUser Question: {user_question}"
        
        if self.gemini_client and self._is_internet_available():
            try:
                image_bytes = self._pil_to_bytes(image)
                response = self.gemini_client.models.generate_content(
                    model="models/gemini-2.5-flash-lite",
                    contents=[
                        full_prompt,
                        types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
                    ]
                )
                final_text = response.text.replace("\n", " ").strip()
                
                print("\n" + "═"*60)
                print(f"🗣️  USER REQUEST : {user_question}")
                print(f"☁️  ROUTED TO    : Gemini 2.5 Flash (Cloud)")
                print(f"📄 RAW RESPONSE : {final_text}")
                print("═"*60 + "\n")
                
                return final_text
            except APIError as e:
                # Catch Gemini rate limits gracefully
                if "429" in str(e):
                    print(f"\n⚠️ Gemini API Rate Limit Reached! Falling back to Edge Models...\n")
                else:
                    print(f"\n⚠️ Gemini API Error ({e}) - Triggering Fallback...\n")
                self._load_local_models_now()
            except Exception as e:
                print(f"\n⚠️ Gemini failed ({e}) - Triggering Edge Expert Fallback Router...\n")
                self._load_local_models_now()

        # Fallback Check: If models are still pre-warming in background thread, don't crash
        if self._local_models_loading:
            return "Cloud models are busy and local models are still loading. Please wait a moment."

        user_lower = user_question.lower()
        is_ocr_task = force_ocr or any(w in user_lower for w in [
            "read", "text", "sign", "label", "say", "summarize", "document", 
            "written", "words", "page", "letter", "alphabet", "book"
        ])

        if is_ocr_task and self.fl_model and self.fl_processor:
            try:
                # Florence-2 extract raw text (it does not summarize natively, but it's the best local OCR)
                task_prompt = "<OCR>"
                device = "cuda" if torch.cuda.is_available() else "cpu"
                inputs = self.fl_processor(text=task_prompt, images=image, return_tensors="pt").to(
                    device, torch.float16 if device == "cuda" else torch.float32
                )

                with torch.no_grad():
                    generated_ids = self.fl_model.generate(
                        input_ids=inputs["input_ids"],
                        pixel_values=inputs["pixel_values"],
                        max_new_tokens=1024,
                        num_beams=3,
                        do_sample=False
                    )
                
                generated_text = self.fl_processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
                parsed_answer = self.fl_processor.post_process_generation(generated_text, task=task_prompt, image_size=(image.width, image.height))
                
                if device == "cuda":
                    torch.cuda.empty_cache()

                raw_text = parsed_answer[task_prompt].replace("\n", " ").strip()
                final_text = f"It says: {raw_text}" if len(raw_text) >= 2 else "There is no clear text visible in this image."
                
                print("\n" + "═"*60)
                print(f"🗣️  USER REQUEST : {user_question}")
                print(f"📖 ROUTED TO    : Florence-2 (Edge OCR)")
                print(f"📄 RAW RESPONSE : {raw_text}")
                print("═"*60 + "\n")

                return final_text

            except Exception as e:
                print(f"Florence-2 failed: {e}")
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                return "I had trouble reading the text locally."

        elif self.md_model and self.md_tokenizer:
            try:
                image_embeds = self.md_model.encode_image(image)

                if any(w in user_lower for w in ["describe", "see", "look", "what is", "what's", "scene", "front", "ahead", "around", "surroundings", "explain", "show", "tell"]):
                    moondream_q = MOONDREAM_DESCRIBE_QUESTION
                elif any(w in user_lower for w in ["who", "person", "face"]):
                    moondream_q = "Who is in this image?"
                else:
                    moondream_q = user_question.strip()

                answer = self.md_model.answer_question(
                    image_embeds, moondream_q, self.md_tokenizer
                )
                raw_text = answer.replace("\n", " ").strip()
                
                print("\n" + "═"*60)
                print(f"🗣️  USER REQUEST : {user_question}")
                print(f"👁️  ROUTED TO    : Moondream2 (Edge Vision)")
                print(f"🎯 PROMPT USED  : {moondream_q}")
                print(f"📄 RAW RESPONSE : {raw_text}")
                print("═"*60 + "\n")

                if len(raw_text) < 5 or raw_text.lower() in ["yes", "no", "1", "0", "true", "false", ""]:
                    return "I can see the scene but cannot describe it clearly right now."

                return raw_text

            except Exception as e:
                print(f"Moondream failed: {e}")
                return "I had trouble analyzing the scene locally."

        return "I am offline and local models are currently unavailable."

# Singleton
hybrid_brain = VisionEngine()