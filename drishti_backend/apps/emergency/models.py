from django.db import models
from django.contrib.auth.models import User

# This acts as the "Emergency Contact List"
class EmergencyContact(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='emergency_contacts')
    name = models.CharField(max_length=100)  # e.g., "Mom"
    phone_number = models.CharField(max_length=15) # e.g., "+919876543210"
    is_primary = models.BooleanField(default=False) # The first person to call

    def __str__(self):
        return f"{self.name} ({self.phone_number})"