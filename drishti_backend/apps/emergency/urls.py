from django.urls import path
from . import views

urlpatterns = [
    path('contacts/', views.EmergencyContactView.as_view(), name='contact-list'),
    path('voice/', views.process_voice_command, name='voice-command'),
]
