from django.db import models

class VisualMemory(models.Model):
    """
    Stores permanent records of what the AI has seen.
    Example: "Saw a red bottle on the kitchen table."
    """
    timestamp = models.DateTimeField(auto_now_add=True)
    description = models.TextField()
    # In the future, we can add 'embedding' here for pgvector search
    # embedding = VectorField(dimensions=768) 

    def __str__(self):
        return f"[{self.timestamp.strftime('%H:%M')}] {self.description[:50]}..."

    class Meta:
        ordering = ['-timestamp'] # Newest first