from rest_framework import generics, permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.authentication import TokenAuthentication
from rest_framework.response import Response

from .models import SavedLocation
from .serializers import SavedLocationSerializer

# Arrival threshold in meters — within this distance = "you have arrived"
ARRIVAL_THRESHOLD_METERS = 30


# ==============================================================================
# List all saved locations + Create a new one
# GET  /api/navigator/locations/
# POST /api/navigator/locations/
# ==============================================================================

class LocationListCreateView(generics.ListCreateAPIView):
    """
    GET: Returns all saved locations for the logged-in blind user.
    POST: Saves a new named location (e.g., "Home", "Bus stop").
    """
    serializer_class = SavedLocationSerializer
    authentication_classes = [TokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return SavedLocation.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


# ==============================================================================
# Retrieve + Delete a specific saved location
# GET    /api/navigator/locations/<id>/
# DELETE /api/navigator/locations/<id>/
# ==============================================================================

class LocationDetailView(generics.RetrieveDestroyAPIView):
    """
    GET: Retrieve a specific saved location by ID.
    DELETE: Remove a saved location the blind user no longer needs.
    """
    serializer_class = SavedLocationSerializer
    authentication_classes = [TokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return SavedLocation.objects.filter(user=self.request.user)


# ==============================================================================
# Geofencing — "Have I arrived at my destination?"
# POST /api/navigator/check-arrival/
# Body: { "location_id": 3, "current_lat": 18.52, "current_lng": 73.85 }
# ==============================================================================

@api_view(['POST'])
@authentication_classes([TokenAuthentication])
@permission_classes([permissions.IsAuthenticated])
def check_arrival(request):
    """
    Checks if the blind user has arrived at a saved destination.
    Called periodically by the frontend during active navigation.

    Returns a TTS-ready spoken message so the app can announce arrival.
    """
    location_id = request.data.get('location_id')
    current_lat = request.data.get('current_lat')
    current_lng = request.data.get('current_lng')

    if not all([location_id, current_lat, current_lng]):
        return Response(
            {"error": "location_id, current_lat, and current_lng are required."},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        destination = SavedLocation.objects.get(
            id=location_id,
            user=request.user
        )
    except SavedLocation.DoesNotExist:
        return Response(
            {"error": "Location not found."},
            status=status.HTTP_404_NOT_FOUND
        )

    distance = destination.distance_to(float(current_lat), float(current_lng))
    arrived = distance <= ARRIVAL_THRESHOLD_METERS

    # TTS-ready response — frontend speaks this directly
    if arrived:
        message = f"You have arrived at {destination.name}."
    else:
        distance_text = (
            f"{int(distance)} meters" if distance < 1000
            else f"{round(distance/1000, 1)} kilometers"
        )
        message = f"You are {distance_text} away from {destination.name}."

    return Response({
        "arrived": arrived,
        "distance_meters": round(distance, 1),
        "message": message,
        "destination": destination.name,
    })