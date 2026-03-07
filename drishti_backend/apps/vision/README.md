# Vision Module Documentation

## Purpose
The Vision App is the core intelligence engine of Drishti. It handles image processing, AI inference, and decision-making logic.

## Key Components

### 1. Consumers (`consumers.py`)
The WebSocket entry point handling all real-time communication.
- **Protocol**: Receives binary (video frames) and text (JSON commands).
- **Kill Switch**: Intercepts "Stop", "Quiet", or "Cut" commands immediately to silence audio.
- **Memory Buffer**: Maintains a short-term context list and interfaces with the long-term database.
- **Routing**: Directs requests to the appropriate engine (OCR, Face, or Hybrid Brain).

### 2. Hybrid Intelligence (`vision_intel.py`)
Implements the failover logic between Cloud and Local AI.
- **Primary**: Google Gemini 2.5/2.0 Flash (via API).
- **Failover**: Moondream2 (Local RTX GPU) via Hugging Face Transformers.
- **Logic**: If the Cloud API returns 404, 429, or 500, the system automatically routes the query to the local model seamlessly.

### 3. Object Detection (`yolo_utils.py`)
- **Model**: YOLOv8 Nano (`yolov8n.pt`).
- **Function**: Processes every frame to find obstacles (people, cars, chairs).
- **Safety**: Calculates relative distance based on bounding box height to issue proximity alerts.

### 4. Face Recognition (`face_engine.py`)
- **Library**: FaceNet / `face_recognition`.
- **Function**: Compares detected faces against `media/faces/` directory.
- **Features**: 
  - `recognize_known_person`: Returns name if match found.
  - `save_face`: Embeds and saves new faces to disk.
  - `analyze_stranger`: Estimates age/gender if face is unknown.

### 5. Narrator (`narrator.py`)
- **Model**: Salesforce BLIP (Bootstrapping Language-Image Pre-training).
- **Function**: Provides rapid, generic image captioning for the "Describe" button.

### 6. Memory Models (`models.py`)
- **VisualMemory**: A PostgreSQL table storing timestamped descriptions of what the AI has seen. Used for answering "Where are my keys?" type questions.

## Execution Flow
1. **Frame Received** -> Processed by YOLO (Async Thread).
2. **User Command** ("What is this?") -> Sent to `VisionConsumer`.
3. **Context Check** -> Retrieval of last 3 events from `VisualMemory`.
4. **AI Query** -> Sent to `hybrid_brain`.
   - Try Gemini -> Success? Return.
   - Fail? -> Load Moondream -> Return.
5. **Response** -> Saved to DB -> Sent to Client via WebSocket.