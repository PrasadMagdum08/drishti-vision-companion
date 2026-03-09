import asyncio
import websockets
import json
import os

# CONFIGURATION
SERVER_URL = "ws://127.0.0.1:8000/ws/vision/stream/"
TEST_IMAGE = "test.jpg"  # Make sure this file exists!

async def test_jarvis_interaction():
    print(f"🔌 Connecting to Drishti Brain at {SERVER_URL}...")
    
    async with websockets.connect(SERVER_URL) as websocket:
        print("✅ Connected!")
        
        # 1. Receive Initial Status
        response = await websocket.recv()
        print(f"📩 Server says: {response}")

        # 2. Simulate Sending a Camera Frame (The "Eyes")
        if os.path.exists(TEST_IMAGE):
            print(f"📸 Sending video frame: {TEST_IMAGE}...")
            with open(TEST_IMAGE, "rb") as image_file:
                image_data = image_file.read()
                await websocket.send(image_data)
        else:
            print(f"❌ Error: {TEST_IMAGE} not found. Please put a jpg file in this folder.")
            return

        # 3. Wait a moment for server to process frame
        await asyncio.sleep(0.5)

        # 4. Simulate Sending a Voice Command (The "Ears")
        command = "Describe this scene in detail."
        print(f"🗣️ Sending Voice Command: '{command}'")
        
        voice_payload = {
            "type": "voice_command",
            "text": command
        }
        await websocket.send(json.dumps(voice_payload))

        # 5. Listen for the AI Response
        print("⏳ Waiting for AI to think...")
        while True:
            response = await websocket.recv()
            data = json.loads(response)
            
            # Filter for the answer
            if data.get("type") == "description":
                print("\n" + "="*40)
                print(f"🤖 JARVIS ANSWER: {data.get('text')}")
                print("="*40 + "\n")
                break
            elif data.get("type") == "info":
                print(f"ℹ️ Status: {data.get('text')}")

if __name__ == "__main__":
    # Run the test
    try:
        asyncio.run(test_jarvis_interaction())
    except Exception as e:
        print(f"❌ Connection Error: {e}")
        print("Make sure 'daphne' is running in another terminal!")
        