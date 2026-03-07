# Core Module Documentation

## Purpose
The Core App is the central configuration hub for Drishti. It manages global settings, base database models, and the WebSocket routing infrastructure. It does not handle business logic (like vision or navigation) but provides the utilities that allow those apps to function.

## Implementation Details

### 1. Global Configuration (`apps.py`)
- **AppConfig**: Registers the core signal handlers and system-wide checks on startup.

### 2. Base Models (`models.py`)
Provides abstract classes that other apps inherit to ensure consistency.
- **TimeStampedModel**: An abstract base class that adds `created_at` and `updated_at` fields to all inheriting models (VisionMemory, UserProfile, etc.).

### 3. Management Commands
Custom scripts for system maintenance.
- `python manage.py clear_cache`: Wipes the Redis/In-Memory cache.
- `python manage.py system_check`: Verifies GPU availability and database connections.

### 4. WebSocket Routing (`routing.py`)
This app defines the master routing table for Django Channels.
- **Protocol**: `ws://<ip>:8000/ws/<app_name>/stream/`
- **Router**: Dispatches connection requests to `VisionConsumer` (in Vision app) or `VoiceConsumer` (future implementation).

## Kill Switch Logic
The core "Emergency Stop" logic is shared here.
- **Signal**: `stop_audio`
- **Trigger**: Whenever the backend detects words like "Stop", "Quiet", or "Cut", a high-priority JSON packet is broadcast to all active channels to silence the frontend TTS immediately.