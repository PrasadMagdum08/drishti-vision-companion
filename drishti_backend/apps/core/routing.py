from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # The URL route: ws://127.0.0.1:8000/ws/vision/stream/
    re_path(r'ws/vision/stream/$', consumers.VisionConsumer.as_asgi()),
]