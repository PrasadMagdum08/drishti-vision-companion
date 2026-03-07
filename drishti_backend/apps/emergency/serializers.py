from django.contrib.auth.models import User
from rest_framework import serializers
from .models import EmergencyContact  # <--- Import the new model

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'password']
        extra_kwargs = {'password': {'write_only': True}}

    def create(self, validated_data):
        user = User.objects.create_user(**validated_data)
        return user

# --- NEW ADDITION ---
class EmergencyContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmergencyContact
        fields = ['id', 'name', 'phone_number', 'is_primary']