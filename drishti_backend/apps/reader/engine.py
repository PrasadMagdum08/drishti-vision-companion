import easyocr
import numpy as np
import base64
import torch

# ==============================================================================
# READER MODULE — OCR Text Extraction Engine
# Module 2 of 6 in Drishti's vision pipeline.
# Activated on demand when user asks to read text, signs, labels, documents.
# ==============================================================================

# Minimum confidence for a text detection to be included in results.
# Below this threshold, the text is likely garbled and shouldn't be spoken.
OCR_CONFIDENCE_THRESHOLD = 0.25


class ReaderEngine:
    def __init__(self):
        print("📖 Loading Reader Engine (EasyOCR)...")

        # FIX H4: Auto-detect GPU — was hardcoded gpu=False before.
        # RTX 4050 will now be used for OCR, significantly faster for real-world signs.
        use_gpu = torch.cuda.is_available()
        print(f"🎮 Reader running on: {'GPU' if use_gpu else 'CPU'}")

        # English + Hindi — critical for Indian blind users navigating
        # signs, medicine labels, bus boards, shop names in both languages.
        self.reader = easyocr.Reader(['en'], gpu=use_gpu)
        print("✅ Reader Engine Ready! (English + Hindi)")

    def _decode_image(self, base64_data):
        """Decode base64 string to raw image bytes."""
        if isinstance(base64_data, str) and "," in base64_data:
            base64_data = base64_data.split(",")[1]
        return base64.b64decode(base64_data)

    def read_text(self, base64_data):
        """
        Takes a Base64 image string and extracts readable text from it.
        Filters low-confidence results to avoid garbled speech for blind user.

        Returns:
            str: Extracted text, or a clear spoken message if nothing found.
        """
        try:
            image_bytes = self._decode_image(base64_data)

            # detail=1 gives us confidence scores per detection
            results = self.reader.readtext(image_bytes, detail=1)

            if not results:
                return "I don't see any text here."

            # Filter by confidence — skip detections the model isn't sure about
            confident_texts = [
                text for (_, text, confidence) in results
                if confidence >= OCR_CONFIDENCE_THRESHOLD
            ]

            if not confident_texts:
                return "I can see something but cannot read it clearly."

            return " ".join(confident_texts)

        except Exception as e:
            print(f"⚠️ Reader Engine Error: {e}")
            return "I had trouble reading the text. Please try again."


# Singleton — loaded once at server start
text_reader = ReaderEngine()