# Drishti - Vision for the Blind

Drishti is a real-time assistive technology platform that acts as a "digital eye" for visually impaired users. It uses a mobile app to stream live video to an AI backend, which analyzes the feed and provides auditory feedback about the environment.

## Project Structure

The project is a monorepo containing the mobile application and the AI backend.

```
drishti_v0.1/
├── DrishtiApp/         # React Native mobile application
└── drishti_backend/    # Django AI backend
```

---

### `drishti_backend`

This directory contains the Django backend responsible for all AI processing.

| File | Description |
| :--- | :--- |
| `manage.py` | The command-line utility for Django project management (running the server, migrations, etc.). |
| `drishti_backend/settings.py` | Contains all the settings for the Django project, including installed apps, database configuration, and middleware. |
| `drishti_backend/asgi.py` | The entry-point for the ASGI server (Daphne), which enables WebSocket support for real-time communication. |
| `apps/core/consumers.py` | Handles the WebSocket logic, receiving video/audio streams from the app and sending back AI-generated responses. |
| `apps/vision/engine.py` | The core AI engine. It integrates models like YOLO, Gemini, and FaceNet to process incoming data. |
| `requirements.txt` | A list of all Python dependencies required for the backend. |
| `docker-compose.yml` | Defines the services for running the PostgreSQL database required by Django. |

---

### `DrishtiApp`

This directory contains the React Native mobile application that the user interacts with.

| File | Description |
| :--- | :--- |
| `App.tsx` | The main entry point of the application. It handles permissions, navigation, and initial setup. |
| `package.json` | Lists all the JavaScript dependencies (e.g., React, Expo, Vision Camera) and defines scripts for running the app. |
| `src/features/vision/CameraStream.tsx` | The component responsible for rendering the live camera feed and streaming it to the backend via WebSocket. |
| `src/core/store/useStore.ts` | The global state management setup using Zustand. It manages the WebSocket connection and application state. |
| `src/core/permissions/PermissionManager.ts` | A utility module to request and verify necessary device permissions (Camera, Microphone). |
| `src/features/voice/useVoice.ts` | A custom hook that integrates with the device's voice recognition and text-to-speech (TTS) capabilities. |

---

## How to Run the Project

The project requires running both the backend server and the mobile application simultaneously.

### 1. Backend Setup

First, navigate to the backend directory:
`cd drishti_backend`

#### For GPU-Based Laptops (NVIDIA)

This is the recommended setup for optimal performance.

1.  **Install Dependencies:**
    *   Ensure you have Python 3.10+ and CUDA 12.1 installed.
    *   Create a virtual environment and install the required packages. The `requirements.txt` is pre-configured for GPU support.
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    pip install -r requirements.txt
    ```

2.  **Start the Database:**
    *   Make sure Docker Desktop is running.
    ```bash
    docker-compose up -d --build
    ```

3.  **Run Migrations & Start Server:**
    ```bash
    python manage.py migrate
    daphne -b 0.0.0.0 -p 8000 drishti_backend.asgi:application
    ```

#### For CPU-Based Laptops

The AI models will run much slower, but the application will still be functional.

1.  **Install Dependencies:**
    *   The key difference is installing the CPU-only version of PyTorch.
    *   Create a virtual environment.
    ```bash
    python -m venv venv
    source venv/bin/activate # On Windows: venv\Scripts\activate
    ```
    *   Install PyTorch for CPU first, then the rest of the requirements.
    ```bash
    # Install CPU-only PyTorch
    pip install torch torchvision torchaudio
    # Install the rest of the packages
    pip install -r requirements.txt
    ```
    *Note: If you encounter errors, you may need to remove the `torchaudio` line from `requirements.txt` before running the second pip command.*

2.  **Start the Database & Server:**
    *   Follow the same steps as the GPU setup for running the database and starting the server.
    ```bash
    docker-compose up -d --build
    python manage.py migrate
    daphne -b 0.0.0.0 -p 8000 drishti_backend.asgi:application
    ```

### 2. Mobile App Setup

In a new terminal, navigate to the app directory:
`cd DrishtiApp`

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Run the App:**
    *   Connect a physical device or start an Android/iOS emulator.
    ```bash
    # Start the Expo development server
    npm start
    ```
    *   From the Expo menu that opens in your browser or terminal, select 'a' to run on Android or 'i' to run on iOS.
