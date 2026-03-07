# Drishti Backend - AI Assistant for the Visually Impaired

## Project Overview
Drishti is a real-time assistive technology platform designed to act as a "digital eye" for blind users. It processes live video streams from a mobile device, detects obstacles, recognizes faces, reads text, and provides intelligent answers using a Hybrid AI architecture (Cloud + Local Edge AI).

## System Architecture
1. **Hybrid Brain**: Uses Google Gemini (Cloud) for complex reasoning and Moondream2 (Local GPU) for offline failover.
2. **Visual Cortex**:
   - **YOLOv8**: Real-time obstacle detection (80 classes).
   - **FaceNet**: Facial recognition and known person identification.
   - **EasyOCR**: Text extraction from scenes.
   - **BLIP**: Fast scene captioning.
3. **Episodic Memory**: PostgreSQL database stores conversation history and visual events for context retrieval.
4. **Real-Time Layer**: Django Channels (WebSockets) streams video and audio data with low latency.

## Prerequisites
- Python 3.10+
- Docker Desktop (for PostgreSQL/pgvector database)
- NVIDIA GPU (Recommended) with CUDA 12.x for Local AI
- Google Gemini API Key

## Installation

1. **Clone and Setup Virtual Environment**
   python -m venv venv
   source venv/Scripts/activate  # Windows: venv\Scripts\activate
   pip install -r requirements.txt

2. **Environment Configuration**
   Create a .env file in the root directory:
   GEMINI_API_KEY=your_api_key_here
   DEBUG=True

3. **Database Setup**
   Ensure Docker Desktop is running.
   docker start drishti_db
   python manage.py migrate

## Running the Server
Use Daphne to serve the ASGI application for WebSocket support.

daphne -b 0.0.0.0 -p 8000 drishti_backend.asgi:application

## Testing Suites

### 1. Connection & Logic Test (Simulation)
Simulates a mobile client sending an image and a voice command.
python test_app_simulation.py

### 2. Cloud Model Verification
Checks which Gemini models are available for your API key.
python check_models.py

### 3. Visual Dashboard (Debug)
Open the following file in a browser to view the camera stream and AI logs:
./drishti_dashboard.html

## Project Structure
- **apps/vision/**: Core AI logic (YOLO, Gemini, Moondream, FaceNet).
- **apps/core/**: System configuration and base utilities.
- **drishti_backend/**: Django settings and ASGI routing.
- **media/faces/**: Storage for known face embeddings.