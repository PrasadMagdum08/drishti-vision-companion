import speech_recognition as sr
import json
import requests

# This simulates the "Wake Word" and command capture
def listen_and_act():
    recognizer = sr.Recognizer()
    mic = sr.Microphone()

    print("👂 Listening for 'Hey Drishti'...")
    with mic as source:
        recognizer.adjust_for_ambient_noise(source)
        audio = recognizer.listen(source)

    try:
        # Convert Speech to Text
        command = recognizer.recognize_google(audio).lower()
        print(f"🗣️ You said: {command}")

        if "drishti" in command:
            # Extract the actual command after the wake word
            clean_command = command.replace("drishti", "").strip()
            print(f"🚀 Triggering Action: {clean_command}")
            
            # Here we simulate sending it to your backend
            # In a real test, we would send this via WebSocket
            payload = {"type": "voice_command", "text": clean_command}
            print(f"📡 Sending to Backend: {json.dumps(payload)}")
        else:
            print("😴 Wake word not heard.")

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    while True:
        listen_and_act()