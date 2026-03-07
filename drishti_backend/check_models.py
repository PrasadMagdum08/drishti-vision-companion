import google.generativeai as genai
import os
from dotenv import load_dotenv

# Load your key
load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("❌ Error: GEMINI_API_KEY not found in .env")
else:
    print(f"🔑 Authenticating with Key: {api_key[:10]}...")
    genai.configure(api_key=api_key)

    print("\n📋 Asking Google for available models...")
    try:
        found_any = False
        for m in genai.list_models():
            # We only want models that can "See" (generateContent)
            if 'generateContent' in m.supported_generation_methods:
                print(f"✅ ACTIVE MODEL: {m.name}")
                found_any = True
        
        if not found_any:
            print("⚠️ No standard text/vision models found. Check your API Key plan.")
            
    except Exception as e:
        print(f"❌ Connection Error: {e}")