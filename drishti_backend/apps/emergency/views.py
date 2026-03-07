from rest_framework import generics, permissions, status
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.authentication import TokenAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
import random

from .models import EmergencyContact
from .serializers import EmergencyContactSerializer


class EmergencyContactView(generics.ListCreateAPIView):
    serializer_class = EmergencyContactSerializer
    authentication_classes = [TokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return EmergencyContact.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


@api_view(['POST'])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def process_voice_command(request):
    user_command = request.data.get('command', '').lower()

    if not user_command:
        return Response({"response": "I didn't hear anything."})

    response_text = "I am not sure how to help with that yet."

    if "where am i" in user_command or "location" in user_command:
        response_text = "Fetching your current location."
    elif "what is in front" in user_command or "describe" in user_command:
        response_text = "Please point your camera forward and tap to activate vision."
    elif "take me to" in user_command:
        destination = user_command.replace("take me to", "").strip()
        response_text = f"Calculating the safest walking route to {destination}."
    elif "help" in user_command or "emergency" in user_command or "sos" in user_command:
        contact = EmergencyContact.objects.filter(
            user=request.user,
            is_primary=True
        ).first()
        if contact:
            print(f"SOS ALERT: Notifying {contact.name} at {contact.phone_number}")
            response_text = f"Alerting {contact.name} immediately. Stay calm, help is coming."
        else:
            response_text = "Sending alert, but no emergency contacts are saved."
    elif "hello" in user_command or "hi" in user_command:
        greetings = ["Hello! Drishti is ready.", "Hi there. How can I guide you?", "Drishti is online."]
        response_text = random.choice(greetings)

    return Response({"command_received": user_command, "response": response_text})
