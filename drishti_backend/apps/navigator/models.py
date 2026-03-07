from django.db import models
from django.contrib.auth.models import User
import math

# ==============================================================================
# NAVIGATOR MODULE — Location & Navigation Data Models
# Module 6 of 6 in Drishti's vision pipeline.
# Stores saved locations and provides geofencing utilities.
# ==============================================================================


class SavedLocation(models.Model):
    """
    A named location saved by a blind user.
    Examples: "Home", "Doctor's clinic", "Bus stop 14", "Mom's house"
    """
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='saved_locations'
    )
    name = models.CharField(max_length=100)
    latitude = models.FloatField()
    longitude = models.FloatField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} ({self.latitude}, {self.longitude})"

    def distance_to(self, lat, lng):
        """
        Calculate distance in meters from this location to given coordinates.
        Uses Haversine formula — accurate for short distances.
        Used for geofencing: "Have I arrived at my destination?"
        """
        R = 6371000  # Earth radius in meters

        lat1, lon1 = math.radians(self.latitude), math.radians(self.longitude)
        lat2, lon2 = math.radians(lat), math.radians(lng)

        dlat = lat2 - lat1
        dlon = lon2 - lon1

        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

        return R * c  # Distance in meters