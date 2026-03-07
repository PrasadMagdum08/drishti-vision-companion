"""
Drishti — Voice Pipeline End-to-End Test
=========================================
Tests the complete voice chain:
  Audio file → base64 → WebSocket → Whisper STT → 
  map_voice_to_action() → AI Module → Response → TTS-ready text

Usage:
    python test_voice_pipeline.py

Make sure Daphne is running:
    daphne -b 127.0.0.1 -p 8000 drishti_backend.asgi:application
"""

import asyncio
import websockets
import json
import base64
import cv2
import numpy as np
import time
import os

SERVER_URL = "ws://127.0.0.1:8000/ws/vision/stream/"
TEST_IMAGE  = "test.jpg"

# Audio test cases — maps to each module
VOICE_TESTS = [
    {
        "name":           "READER MODULE — 'Read the text'",
        "audio_file":     "test_read.m4a",
        "expected_action": "read_text",
        "module":          "reader",
    },
    {
        "name":           "VISION MODULE — 'Describe what you see'",
        "audio_file":     "test_describe.m4a",
        "expected_action": "describe",
        "module":          "vision",
    },
    {
        "name":           "VISION MODULE — 'What is in front of me'",
        "audio_file":     "test_question.m4a",
        "expected_action": "describe or None→brain",
        "module":          "vision",
    },
]

results = []


# ── Helpers ──────────────────────────────────────────────────────────────────

def load_image_as_base64(path):
    """Load test image and encode as base64."""
    if os.path.exists(path):
        img = cv2.imread(path)
    else:
        print(f"  ⚠️ No test image found — creating synthetic frame")
        img = np.ones((640, 640, 3), dtype=np.uint8) * 180
        cv2.putText(img, "EXIT", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 2, (0,0,0), 4)
        cv2.putText(img, "CAUTION AHEAD", (50, 400), cv2.FONT_HERSHEY_SIMPLEX, 1, (0,0,200), 3)

    # Compress frame — simulate mobile camera quality
    _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 40])
    return base64.b64encode(buffer.tobytes()).decode('utf-8')


def load_audio_as_base64(path):
    """Load audio file and encode as base64."""
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')


async def send_frame(websocket, base64_frame):
    """Send a video frame to establish last_frame on server."""
    await websocket.send(json.dumps({
        "type": "video_frame",
        "data": base64_frame
    }))


async def wait_for_description(websocket, timeout=45):
    """
    Wait for a description response from the server.
    Filters out obstacle alerts and interim 'Analyzing' messages.
    Returns the final AI answer or None on timeout.
    """
    start = time.time()
    interim_received = False

    while time.time() - start < timeout:
        try:
            raw = await asyncio.wait_for(websocket.recv(), timeout=5.0)
            data = json.loads(raw)
            msg_type = data.get("type")
            text = data.get("text", "") or data.get("alert", "")

            if msg_type == "obstacle":
                print(f"    [Guardian] {text}")
                continue

            if msg_type == "description":
                if "Analyzing" in text:
                    print(f"    [Server] {text}")
                    interim_received = True
                    continue
                # This is the real AI answer
                return text

        except asyncio.TimeoutError:
            if interim_received:
                # Server is processing — keep waiting
                print("    ⏳ Still processing...")
                continue
            break
        except Exception as e:
            print(f"    ⚠️ Receive error: {e}")
            break

    return None


# ── Main Test Runner ──────────────────────────────────────────────────────────

async def run_voice_test(test_case, base64_frame):
    """Run a single voice pipeline test."""
    print(f"\n{'='*60}")
    print(f"TEST — {test_case['name']}")
    print(f"{'='*60}")
    print(f"  Audio file:      {test_case['audio_file']}")
    print(f"  Expected action: {test_case['expected_action']}")

    if not os.path.exists(test_case['audio_file']):
        print(f"  ❌ SKIP — Audio file not found: {test_case['audio_file']}")
        results.append({"test": test_case['name'], "status": "SKIP", "response": None})
        return

    try:
        async with websockets.connect(SERVER_URL) as websocket:
            # Step 1: Receive handshake
            handshake = await asyncio.wait_for(websocket.recv(), timeout=5.0)
            handshake_data = json.loads(handshake)
            if handshake_data.get("status") != "connected":
                print(f"  ❌ FAIL — Bad handshake: {handshake_data}")
                results.append({"test": test_case['name'], "status": "FAIL", "response": None})
                return
            print(f"  ✅ Connected to server")

            # Step 2: Send video frame to seed last_frame
            await send_frame(websocket, base64_frame)
            print(f"  📸 Video frame sent (seeding last_frame)")
            await asyncio.sleep(0.5)

            # Step 3: Send audio command
            print(f"  🎙️ Sending audio command...")
            audio_b64 = load_audio_as_base64(test_case['audio_file'])
            audio_size_kb = len(audio_b64) * 3 / 4 / 1024
            print(f"  📦 Audio size: {audio_size_kb:.1f} KB")

            await websocket.send(json.dumps({
                "type": "audio_command",
                "data": audio_b64
            }))

            # Step 4: Wait for Whisper + AI response
            print(f"  ⏳ Waiting for Whisper transcription + AI response...")
            start_time = time.time()
            response = await wait_for_description(websocket, timeout=60)
            elapsed = round(time.time() - start_time, 1)

            if response:
                print(f"\n  {'─'*50}")
                print(f"  🤖 AI RESPONSE ({elapsed}s): {response}")
                print(f"  {'─'*50}")
                print(f"  ✅ PASS — Voice pipeline working end-to-end")
                results.append({
                    "test": test_case['name'],
                    "status": "PASS",
                    "response": response,
                    "time_seconds": elapsed
                })
            else:
                print(f"  ❌ FAIL — No response received within timeout")
                results.append({
                    "test": test_case['name'],
                    "status": "FAIL",
                    "response": None,
                    "time_seconds": elapsed
                })

    except Exception as e:
        print(f"  ❌ FAIL — Exception: {e}")
        results.append({"test": test_case['name'], "status": "FAIL", "response": str(e)})


async def main():
    print("\n" + "🎙️ " * 20)
    print("  DRISHTI — VOICE PIPELINE END-TO-END TEST")
    print("🎙️ " * 20)
    print(f"\n  Server:  {SERVER_URL}")
    print(f"  Time:    {time.strftime('%Y-%m-%d %H:%M:%S')}")

    # Load test image once
    print(f"\n📸 Loading test image...")
    base64_frame = load_image_as_base64(TEST_IMAGE)
    compressed_kb = len(base64_frame) * 3 / 4 / 1024
    print(f"  Frame size: {compressed_kb:.1f} KB (compressed for real-time)")

    # Run each voice test sequentially
    # Sequential is important — server needs 5s Smart Silence between each
    for test_case in VOICE_TESTS:
        await run_voice_test(test_case, base64_frame)
        print(f"\n  ⏸️  Waiting 8s (Smart Silence cooldown)...")
        await asyncio.sleep(8)

    # ── Final Report ──────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("  VOICE PIPELINE TEST RESULTS")
    print(f"{'='*60}")

    all_passed = True
    for r in results:
        icon = "✅" if r['status'] == "PASS" else "❌" if r['status'] == "FAIL" else "⚠️"
        time_str = f" ({r.get('time_seconds', '?')}s)" if r.get('time_seconds') else ""
        print(f"  {icon} {r['status']}{time_str}")
        print(f"     {r['test']}")
        if r.get('response') and r['status'] == 'PASS':
            print(f"     → \"{r['response']}\"")
        print()
        if r['status'] != 'PASS':
            all_passed = False

    print(f"{'='*60}")
    if all_passed:
        print("  🎉 VOICE PIPELINE FULLY OPERATIONAL")
        print("  Every module receiving voice commands correctly.")
    else:
        print("  ⚠️  Some tests failed — check server logs above")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())