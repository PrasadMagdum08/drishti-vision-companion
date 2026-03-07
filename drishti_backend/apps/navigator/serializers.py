from rest_framework import serializers
from .models import SavedLocation


class SavedLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedLocation
        fields = ['id', 'name', 'latitude', 'longitude', 'created_at']
        read_only_fields = ['id', 'created_at']