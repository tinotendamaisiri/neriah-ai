"""
Text embedding wrapper.

Production (non-demo):
    Vertex AI text-embedding-005 — 768-dimensional embeddings.
    Requires google-cloud-aiplatform (already in requirements.txt).

Demo (NERIAH_ENV=demo):
    sentence-transformers all-MiniLM-L6-v2 — 384-dimensional embeddings.
    Runs on CPU, no external service required.
    Model is ~80 MB and is downloaded once then cached to ~/.cache/torch/.

Usage:
    from shared.embeddings import get_embedding, embedding_dim

Both functions never raise — return [] / 0 on error.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from shared.config import is_demo, settings

logger = logging.getLogger(__name__)

VERTEX_EMBEDDING_DIM = 768
LOCAL_EMBEDDING_DIM  = 384


def _use_vertex() -> bool:
    """True in production (non-demo). Demo uses local sentence-transformers."""
    return not is_demo()


@lru_cache(maxsize=1)
def _local_model():
    """Load sentence-transformers model once. Import is deferred to avoid adding
    ~200 ms of import overhead when the model is not needed."""
    from sentence_transformers import SentenceTransformer  # noqa: PLC0415
    logger.info("[embeddings] Loading sentence-transformers all-MiniLM-L6-v2")
    return SentenceTransformer("all-MiniLM-L6-v2")


def get_embedding(text: str) -> list[float]:
    """
    Generate an embedding vector for *text*.

    Returns a list[float]:
      - 768 floats in production (Vertex AI text-embedding-005)
      - 384 floats in demo mode (sentence-transformers all-MiniLM-L6-v2)

    Returns [] on any failure — callers must handle this gracefully and not
    store a document or query the vector DB when the embedding is empty.
    """
    if not text or not text.strip():
        return []
    try:
        if _use_vertex():
            return _vertex_embed(text.strip())
        return _local_embed(text.strip())
    except Exception:
        logger.exception("[embeddings] get_embedding failed for text: %.80s", text)
        return []


def embedding_dim() -> int:
    """Return the expected embedding dimension for the current backend."""
    return VERTEX_EMBEDDING_DIM if _use_vertex() else LOCAL_EMBEDDING_DIM


# ── Backend implementations ───────────────────────────────────────────────────

def _vertex_embed(text: str) -> list[float]:
    import vertexai  # noqa: PLC0415
    from vertexai.language_models import TextEmbeddingModel  # noqa: PLC0415

    vertexai.init(project=settings.GCP_PROJECT_ID, location=settings.GCP_REGION)
    model = TextEmbeddingModel.from_pretrained("text-embedding-005")
    results = model.get_embeddings([text])
    return list(results[0].values)


def _local_embed(text: str) -> list[float]:
    return _local_model().encode(text, show_progress_bar=False).tolist()
