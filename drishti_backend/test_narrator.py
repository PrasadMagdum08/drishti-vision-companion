import asyncio
import websockets
import json
import os

# CONFIGURATION
SERVER_URL = "ws://127.0.0.1:8000/ws/vision/stream/"
TEST_IMAGE = "test.jpg"  # Make sure this file exists!

async def test_narrator():
    print(f"🔄 Connecting to {SERVER_URL}...")
    
    async with websockets.connect(SERVER_URL) as websocket:
        # 1. Read Server Hello
        response = await websocket.recv()
        print(f"✅ Server Says: {response}")

        # 2. Load Image
        if not os.path.exists(TEST_IMAGE):
            print(f"❌ Error: {TEST_IMAGE} not found. Please put a photo in this folder.")
            return

        with open(TEST_IMAGE, "rb") as f:
            image_bytes = f.read()

        # 3. Send Image (Reflex Mode)
        print("📤 Sending Image Frame (Simulating Video)...")
        await websocket.send(image_bytes)
        
        # Read the immediate 'Obstacle Alert' (YOLO)
        reflex_response = await websocket.recv()
        print(f"\n⚡ FAST BRAIN (YOLO): {reflex_response}")

        # 4. Trigger Narrator (Simulate User asking "What is in front?")
        print("\n🗣️ User asks: 'Describe the scene'")
        command = json.dumps({"action": "describe"})
        await websocket.send(command)

        # 5. Read Description (BLIP)
        print("⏳ Waiting for Narrator (BLIP)...")
        description_response = await websocket.recv()
        print(f"\n📖 SLOW BRAIN (BLIP): {description_response}")

if __name__ == "__main__":
    asyncio.run(test_narrator())