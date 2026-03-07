import asyncio
import websockets
import cv2
import json

# 1. Load a dummy image to send (Create a black image if you don't have one)
# Or easier: We send a blank "black" frame just to test the pipeline.
# If you have a real image (e.g., 'test.jpg'), put it in this folder.

async def test_vision_stream():
    uri = "ws://127.0.0.1:8000/ws/vision/stream/"
    
    print(f"🔄 Connecting to Drishti Backend at {uri}...")
    
    async with websockets.connect(uri) as websocket:
        # Wait for welcome message
        welcome = await websocket.recv()
        print(f"✅ Server Says: {welcome}")

        # Create a fake image frame (Gray box)
        # In real life, this comes from the camera
        img = cv2.imread("test.jpg") 
        if img is None:
            # Create a blank image if no file exists
            import numpy as np
            img = np.zeros((640, 640, 3), dtype=np.uint8)
            cv2.putText(img, "TEST", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

        # Encode as JPEG (Simulate Camera Stream)
        _, buffer = cv2.imencode('.jpg', img)
        bytes_data = buffer.tobytes()

        print("📤 Sending Video Frame...")
        await websocket.send(bytes_data)

        # Wait for AI Response
        response = await websocket.recv()
        data = json.loads(response)
        
        print("\n🔍 AI ANALYSIS RESULT:")
        print(json.dumps(data, indent=2))

if __name__ == "__main__":
    asyncio.run(test_vision_stream())