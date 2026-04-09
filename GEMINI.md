# Drishti - Vision for the Blind

Drishti is a real-time assistive technology platform that acts as a "digital eye" for visually impaired users. It uses a mobile app to stream live video to an AI backend, which analyzes the feed and provides auditory feedback about the environment.

## Project Overview

The project is a monorepo consisting of:
- **`drishti_backend`**: A Django-based AI backend using WebSockets (Django Channels) for real-time processing and Hybrid Intelligence.
- **`DrishtiApp`**: A React Native (Expo) mobile application for capturing camera streams and providing voice-based interactions.

### Core Architecture (6-Module System)

The system is organized into specialized modules coordinated by `apps/core/consumers.py`:

1.  **Guardian (`apps/guardian`)**: 
    - **Model**: YOLOv8s.
    - **Function**: Real-time obstacle detection and tracking.
    - **Logic**: IoU-based object tracking, velocity estimation ("Fast" alerts), and distance calibration for chest-mount usage.
2.  **Reader (`apps/reader`)**: 
    - **Local Engine**: EasyOCR (English/Hindi support).
    - **Cloud/Hybrid**: Florence-2 or Gemini for document summarization.
3.  **Vision (`apps/vision`)**: 
    - **Hybrid Brain**: Primary Cloud (Gemini 2.5 Flash), Local Failover (Moondream2 for scene analysis, Florence-2 for OCR).
    - **Logic**: Automatic connectivity monitoring (checks 8.8.8.8) to switch between cloud and edge experts.
4.  **Companion (`apps/companion`)**: 
    - **Engine**: LBPH (Local Binary Pattern Histograms) for robust facial recognition.
    - **Backup**: Cloudinary for face photo storage.
5.  **Emergency (`apps/emergency`)**: 
    - **Function**: SOS management and emergency contact logic.
6.  **Navigator (`apps/navigator`)**: 
    - **Function**: Haversine-based geofencing and saved location management.

## Technology Stack

### Backend (Python/Django)
- **Framework**: Django 6.0, Django Channels (WebSockets), DRF.
- **AI Models**: 
    - **Vision**: YOLOv8s, EasyOCR, Moondream2, Florence-2, Gemini 2.5 Flash.
    - **Speech**: OpenAI Whisper (STT) for processing audio commands.
- **Database**: PostgreSQL with `pgvector` for memory and embeddings.
- **Real-Time**: Daphne (ASGI server), In-Memory/Redis Channel Layers.

### Frontend (React Native/Expo)
- **Framework**: Expo 54, React Native 0.81.
- **Navigation**: Voice-driven navigation (`useVoiceNavigator.ts`).
- **Interaction**: 
    - **Wake Word**: Picovoice Porcupine ("Hey Vision").
    - **TTS**: `react-native-tts`.
    - **Gestures**: Single-tap for voice command/snapshot, double-tap for mode toggles.
- **State**: Zustand (`useStore.ts`) for managing WebSocket status and alerts.

## Building and Running

### Backend Setup
1. **Environment**: Python 3.10+, CUDA 12.1 (recommended for Moondream2/Florence-2).
2. **Setup**:
   ```bash
   cd drishti_backend
   python -m venv venv
   source venv/Scripts/activate
   pip install -r requirements.txt
   ```
3. **Configuration**: Create `.env` with `GEMINI_API_KEY`, `CLOUDINARY_URL`, etc.
4. **Services**: `docker-compose up -d` (PostgreSQL/pgvector).
5. **Run**: `daphne -b 0.0.0.0 -p 8000 drishti_backend.asgi:application`

### Mobile App Setup
1. **Setup**:
   ```bash
   cd DrishtiApp
   npm install
   ```
2. **Config**: Update `MACHINE_IP` in `src/config.ts`.
3. **Run**: `npx expo start` (Use 'a' for Android, 'i' for iOS).

## Development Conventions

- **Hybrid Failover**: AI logic should always prefer `hybrid_brain.ask_brain` to ensure offline resilience.
- **WebSocket Protocol**:
    - `video_frame`: Standard stream for Guardian.
    - `audio_command`: Voice-trigger or snapshots for high-level reasoning.
    - `nav_command`: Feedback from backend to trigger frontend screen transitions.
- **Surgical Changes**: Update `VisionConsumer` in `apps/core/consumers.py` to route new voice intents to backend engines.
