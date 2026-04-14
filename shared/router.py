"""
AI inference router — shared by all backend AI endpoints.

Every AI request (grading, tutoring, scheme generation) must call
``route_ai_request()`` before dispatching to ``gemma_client``.

The backend always runs in the cloud, so this always returns ``AIRoute.CLOUD``.
The abstraction exists so the routing contract is explicit and the branching
point is ready if on-device inference is ever added to Cloud Run workers.

Usage:
    from shared.router import route_ai_request, AIRoute

    route = route_ai_request()
    # route is always AIRoute.CLOUD — call gemma_client below
    result = gemma_client.grade_submission(image_bytes, answer_key, level)
"""

from __future__ import annotations

import logging
from enum import Enum

logger = logging.getLogger(__name__)


class AIRoute(str, Enum):
    """Possible inference destinations for an AI request."""

    CLOUD = "cloud"         # Vertex AI / Gemma 4 26B (production) or Ollama (dev)
    ON_DEVICE = "on-device" # LiteRT E4B/E2B running on the client device (mobile only)
    UNAVAILABLE = "unavailable"  # No connectivity and no loaded model


class AIRequestType(str, Enum):
    """Semantic type of AI operation being requested."""

    GRADING = "grading"    # Grade student answers against an answer key
    TUTORING = "tutoring"  # Socratic tutoring turn for a student
    SCHEME = "scheme"      # Generate a marking scheme from a question paper


def route_ai_request(
    request_type: AIRequestType | None = None,
) -> AIRoute:
    """
    Backend routing decision for AI inference.

    The server is always online and always the cloud — returns
    ``AIRoute.CLOUD`` unconditionally. The ``request_type`` parameter
    is accepted for interface parity with the mobile router but has no
    effect on the result.

    Args:
        request_type: Optional — the kind of AI operation. Logged only.

    Returns:
        ``AIRoute.CLOUD`` always.
    """
    logger.debug(
        "[router] route_ai_request type=%s → %s",
        request_type.value if request_type else "unspecified",
        AIRoute.CLOUD.value,
    )
    return AIRoute.CLOUD
