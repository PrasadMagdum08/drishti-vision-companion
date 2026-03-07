# Users Module Documentation

## Purpose
The Users App handles Authentication, Authorization, and User Profiles. It ensures that data (like Saved Faces or Location History) is isolated per user.

## Implementation Details

### 1. Custom User Model (`models.py`)
We extend the standard Django AbstractUser to add accessibility-specific fields.
- **Model**: `User`
- **Fields**:
  - `phone_number`: For SMS alerts (SOS feature).
  - `emergency_contact`: A number to call if a fall is detected.
  - `voice_preference`: 'Male'/'Female'/'Fast'/'Slow' settings for the TTS engine.

### 2. Authentication (`views.py`)
- **Protocol**: Token-based Authentication (DRF Auth Token).
- **Endpoints**:
  - `POST /api/auth/login/`: Returns a permanent Token for the mobile app.
  - `POST /api/auth/register/`: Creates a new account.
  - `POST /api/auth/profile/`: Updates emergency contacts.

### 3. Serializers (`serializers.py`)
- **UserSerializer**: Handles secure password hashing and profile updates.
- **ProfileSerializer**: Exposes only safe public fields to the frontend.

## Security
- **Permissions**: All API endpoints in other apps (Vision, Navigation) are locked behind `IsAuthenticated`.
- **Isolation**: Queries are filtered by `request.user` so User A cannot see User B's "Saved Faces."