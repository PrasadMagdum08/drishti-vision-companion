import os
import django
import sys
from pathlib import Path

# Setup path so Django can find our apps/ folder
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, os.path.join(BASE_DIR, 'apps'))

# Initialize Django settings
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'drishti_backend.settings')
django.setup()

# Import Channels routing (must happen AFTER django.setup())
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
import core.routing  # FIX: Updated from vision.routing → core.routing

# Traffic controller — HTTP and WebSocket
application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": AuthMiddlewareStack(
        URLRouter(
            core.routing.websocket_urlpatterns
        )
    ),
})