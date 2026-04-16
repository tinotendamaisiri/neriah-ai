"""
Vector database service — stores and retrieves text+embedding documents.

Collections
-----------
  rag_syllabuses       — curriculum document chunks (ZIMSEC, Cambridge, etc.)
  rag_grading_examples — teacher-verified grading pairs

Backend: Firestore native vector search via find_nearest().
Requires a vector index per collection — create with:

    python scripts/create_vector_indexes.py

If the index does not exist, find_nearest() raises and RAG degrades gracefully
(grading continues without context — never blocks).

All public functions:
  store_document(collection, doc_id, text, metadata)
  search_similar(collection, query_text, filters, top_k) -> list[dict]
  search_with_user_context(collection, query_text, user_context, top_k) -> list[dict]
  delete_collection(collection)

All functions are synchronous and never raise — errors are logged and
empty results are returned so grading always proceeds.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from shared.embeddings import get_embedding

logger = logging.getLogger(__name__)

# Firestore collection names
_FS_COLLECTIONS = {
    "syllabuses":       "rag_syllabuses",
    "grading_examples": "rag_grading_examples",
}


def _fs_collection(logical_name: str) -> str:
    """Map logical collection name to Firestore collection name."""
    return _FS_COLLECTIONS.get(logical_name, f"rag_{logical_name}")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Public API ────────────────────────────────────────────────────────────────

def store_document(
    collection: str,
    doc_id: str,
    text: str,
    metadata: Optional[dict] = None,
) -> None:
    """
    Embed *text* and store in Firestore with the vector.

    metadata should include: country, curriculum, subject, education_level,
    and any other searchable fields.
    """
    if not text or not text.strip():
        logger.warning("[vector_db] store_document called with empty text (id=%s)", doc_id)
        return

    embedding = get_embedding(text)
    if not embedding:
        logger.warning("[vector_db] Embedding failed for doc %s — not stored", doc_id)
        return

    meta = metadata or {}

    try:
        from shared.firestore_client import get_db  # noqa: PLC0415

        fs_col = _fs_collection(collection)

        try:
            from google.cloud.firestore_v1.vector import Vector  # noqa: PLC0415
            embedding_field = Vector(embedding)
        except ImportError:
            embedding_field = embedding  # plain list fallback

        get_db().collection(fs_col).document(doc_id).set({
            "id":         doc_id,
            "text":       text,
            "embedding":  embedding_field,
            "metadata":   meta,
            "created_at": _now_iso(),
        })
    except Exception:
        logger.exception("[vector_db] Firestore store failed for doc %s", doc_id)


def search_similar(
    collection: str,
    query_text: str,
    filters: Optional[dict] = None,
    top_k: int = 5,
) -> list[dict]:
    """
    Find the top_k most similar documents to *query_text*.

    filters: optional dict of metadata equality filters,
             e.g. {"curriculum": "ZIMSEC", "subject": "Mathematics"}

    Returns list of {"text": str, "metadata": dict, "score": float}.
    Returns [] on any error — grading always continues without RAG context.
    """
    if not query_text or not query_text.strip():
        return []

    query_embedding = get_embedding(query_text)
    if not query_embedding:
        return []

    return _firestore_search(collection, query_embedding, filters, top_k)


def _firestore_search(
    collection: str,
    query_embedding: list[float],
    filters: Optional[dict],
    top_k: int,
) -> list[dict]:
    try:
        from google.cloud.firestore_v1.base_vector_query import DistanceMeasure  # noqa: PLC0415
        from google.cloud.firestore_v1.vector import Vector  # noqa: PLC0415
        from shared.firestore_client import get_db  # noqa: PLC0415

        fs_col = _fs_collection(collection)
        query = get_db().collection(fs_col).find_nearest(
            vector_field="embedding",
            query_vector=Vector(query_embedding),
            distance_measure=DistanceMeasure.COSINE,
            limit=top_k,
        )
        results = []
        for snap in query.stream():
            d = snap.to_dict()
            meta = d.get("metadata") or {}
            # Apply metadata filters in Python (Firestore vector query can't filter yet)
            if filters:
                if not all(meta.get(k) == v for k, v in filters.items()):
                    continue
            results.append({
                "text":     d.get("text", ""),
                "metadata": meta,
                "score":    0.0,
            })
        return results
    except Exception as exc:
        exc_msg = str(exc).lower()
        if "index" in exc_msg or "find_nearest" in exc_msg:
            logger.warning(
                "[vector_db] Firestore vector index not ready for '%s'. "
                "Run scripts/create_vector_indexes.py to create it.",
                collection,
            )
        else:
            logger.warning(
                "[vector_db] Firestore vector search failed for '%s': %s",
                collection, exc,
            )
        return []


def delete_collection(collection: str) -> None:
    """Delete all documents in *collection* from Firestore."""
    try:
        from shared.firestore_client import get_db  # noqa: PLC0415
        fs_col = _fs_collection(collection)
        db = get_db()
        batch_size = 400
        while True:
            docs = list(db.collection(fs_col).limit(batch_size).stream())
            if not docs:
                break
            batch = db.batch()
            for doc in docs:
                batch.delete(doc.reference)
            batch.commit()
        logger.info("[vector_db] Deleted Firestore collection %s", fs_col)
    except Exception:
        logger.exception("[vector_db] Firestore collection delete failed for %s", collection)


def search_with_user_context(
    collection: str,
    query_text: str,
    user_context: dict,
    top_k: int = 5,
) -> list[dict]:
    """
    Convenience wrapper: build metadata filters from *user_context* and call
    search_similar.

    user_context keys used as filters (when present and non-empty):
      curriculum, subject, education_level, country
    """
    filters: dict[str, str] = {}
    for key in ("curriculum", "subject", "education_level", "country"):
        val = user_context.get(key, "")
        if val:
            filters[key] = val

    return search_similar(collection, query_text, filters=filters or None, top_k=top_k)
