"""
Vector database service — stores and retrieves text+embedding documents.

Collections
-----------
  rag_syllabuses       — curriculum document chunks (ZIMSEC, Cambridge, etc.)
  rag_grading_examples — teacher-verified grading pairs

Backends
--------
  Production:
    Firestore native vector search via find_nearest().
    Requires a vector index per collection — create with:

        gcloud firestore indexes composite create \\
          --project=neriah-ai-492302 \\
          --collection-group=rag_syllabuses \\
          --query-scope=COLLECTION \\
          --field-config field-path=embedding,vector-config='{"dimension":768,"flat":{}}'

        gcloud firestore indexes composite create \\
          --project=neriah-ai-492302 \\
          --collection-group=rag_grading_examples \\
          --query-scope=COLLECTION \\
          --field-config field-path=embedding,vector-config='{"dimension":768,"flat":{}}'

    If the index does not exist, find_nearest() raises and RAG degrades gracefully
    (grading continues without context — never blocks).

  Demo (NERIAH_ENV=demo):
    ChromaDB EphemeralClient (in-memory).
    Warmed from Firestore on first access so demo-seeded data is available.
    Cleared on demo reset.

All public functions:
  store_document(collection, doc_id, text, metadata)
  search_similar(collection, query_text, filters, top_k) -> list[dict]
  delete_collection(collection)
  clear_chroma_cache()

All functions are synchronous and never raise — errors are logged and
empty results are returned so grading always proceeds.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from shared.config import is_demo
from shared.embeddings import get_embedding

logger = logging.getLogger(__name__)

# Firestore collection names
_FS_COLLECTIONS = {
    "syllabuses":        "rag_syllabuses",
    "grading_examples":  "rag_grading_examples",
}


def _fs_collection(logical_name: str) -> str:
    """Map logical collection name to Firestore collection name."""
    return _FS_COLLECTIONS.get(logical_name, f"rag_{logical_name}")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _use_firestore_vectors() -> bool:
    return not is_demo()


# ── ChromaDB cache (demo / local only) ────────────────────────────────────────

class _ChromaCache:
    """
    Lazy, per-process ChromaDB cache.

    On first search for a collection, loads all documents from Firestore into
    an in-memory ChromaDB collection.  Subsequent searches hit ChromaDB only.
    Cleared on demo reset via clear_chroma_cache().
    """

    def __init__(self) -> None:
        self._client = None
        self._loaded: set[str] = set()

    def client(self):
        if self._client is None:
            import chromadb  # noqa: PLC0415
            self._client = chromadb.EphemeralClient()
        return self._client

    def get_collection(self, name: str):
        return self.client().get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},
        )

    def ensure_warmed(self, logical_name: str) -> None:
        """Load Firestore documents into ChromaDB if not already done."""
        if logical_name in self._loaded:
            return
        self._loaded.add(logical_name)  # mark before loading to avoid re-entrant calls

        from shared.firestore_client import get_db  # noqa: PLC0415
        try:
            col = self.get_collection(logical_name)
            fs_col = _fs_collection(logical_name)
            docs = list(get_db().collection(fs_col).stream())
            if not docs:
                logger.debug("[vector_db] ChromaDB warm-up: no docs in %s", fs_col)
                return
            ids, embeddings, documents, metadatas = [], [], [], []
            for snap in docs:
                d = snap.to_dict()
                raw = d.get("embedding")
                if hasattr(raw, "values"):
                    emb = list(raw.values)
                elif isinstance(raw, (list, tuple)):
                    emb = list(raw)
                else:
                    continue  # skip malformed
                if not emb:
                    continue
                ids.append(snap.id)
                embeddings.append(emb)
                documents.append(d.get("text", ""))
                metadatas.append(d.get("metadata") or {})

            if ids:
                col.upsert(ids=ids, embeddings=embeddings,
                           documents=documents, metadatas=metadatas)
                logger.info("[vector_db] ChromaDB warmed: %d docs from %s", len(ids), fs_col)
        except Exception:
            logger.exception("[vector_db] ChromaDB warm-up failed for %s", logical_name)
            self._loaded.discard(logical_name)  # allow retry on next call

    def clear(self) -> None:
        """Wipe all in-memory collections. Called on demo reset."""
        try:
            if self._client is not None:
                import chromadb  # noqa: PLC0415
                self._client = chromadb.EphemeralClient()
            self._loaded.clear()
            logger.info("[vector_db] ChromaDB cache cleared")
        except Exception:
            logger.exception("[vector_db] ChromaDB clear failed")


_chroma = _ChromaCache()


# ── Public API ─────────────────────────────────────────────────────────────────

def store_document(
    collection: str,
    doc_id: str,
    text: str,
    metadata: Optional[dict] = None,
) -> None:
    """
    Embed *text* and store in the vector DB.

    Also stores the embedding in Firestore so it survives cold starts and
    can warm the ChromaDB cache on the next invocation.

    metadata should include: country, curriculum, subject, education_level,
    doc_type, and any other searchable fields.
    """
    if not text or not text.strip():
        logger.warning("[vector_db] store_document called with empty text (id=%s)", doc_id)
        return

    embedding = get_embedding(text)
    if not embedding:
        logger.warning("[vector_db] Embedding failed for doc %s — not stored", doc_id)
        return

    meta = metadata or {}

    # ── Firestore (all environments) ─────────────────────────────────────────
    try:
        from shared.firestore_client import get_db  # noqa: PLC0415
        fs_col = _fs_collection(collection)

        if _use_firestore_vectors():
            from google.cloud.firestore_v1.vector import Vector  # noqa: PLC0415
            embedding_field = Vector(embedding)
        else:
            embedding_field = embedding  # plain list for demo/local

        get_db().collection(fs_col).document(doc_id).set({
            "id":         doc_id,
            "text":       text,
            "embedding":  embedding_field,
            "metadata":   meta,
            "created_at": _now_iso(),
        })
    except Exception:
        logger.exception("[vector_db] Firestore store failed for doc %s", doc_id)
        # Still try to store in ChromaDB if available
        if not _use_firestore_vectors():
            _chroma_upsert(collection, doc_id, text, embedding, meta)
        return

    # ── ChromaDB (demo / local — keep in sync for same-instance queries) ──────
    if not _use_firestore_vectors():
        # Mark as already loaded so warm-up doesn't undo our insert
        _chroma._loaded.add(collection)
        _chroma_upsert(collection, doc_id, text, embedding, meta)


def _chroma_upsert(
    collection: str, doc_id: str, text: str,
    embedding: list[float], metadata: dict,
) -> None:
    try:
        col = _chroma.get_collection(collection)
        col.upsert(
            ids=[doc_id],
            embeddings=[embedding],
            documents=[text],
            metadatas=[metadata],
        )
    except Exception:
        logger.exception("[vector_db] ChromaDB upsert failed for doc %s", doc_id)


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

    if _use_firestore_vectors():
        results = _firestore_search(collection, query_embedding, filters, top_k)
        if results:
            return results
        # Firestore vector search failed or returned nothing — fall back to ChromaDB
        logger.debug("[vector_db] Firestore returned no results for '%s', trying ChromaDB fallback", collection)
    return _chroma_search(collection, query_embedding, filters, top_k)


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
                "score":    0.0,  # distance not exposed in stream()
            })
        return results
    except Exception:
        logger.warning(
            "[vector_db] Firestore vector search failed for collection '%s'. "
            "Ensure vector index exists. Grading continues without RAG context.",
            collection,
        )
        return []


def _chroma_search(
    collection: str,
    query_embedding: list[float],
    filters: Optional[dict],
    top_k: int,
) -> list[dict]:
    try:
        _chroma.ensure_warmed(collection)
        col = _chroma.get_collection(collection)

        where_clause = None
        if filters:
            if len(filters) == 1:
                k, v = next(iter(filters.items()))
                where_clause = {k: v}
            else:
                where_clause = {"$and": [{k: {"$eq": v}} for k, v in filters.items()]}

        kwargs: dict = {
            "query_embeddings": [query_embedding],
            "n_results": min(top_k, max(col.count(), 1)),
        }
        if where_clause:
            kwargs["where"] = where_clause

        results = col.query(**kwargs)
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        dists = results.get("distances", [[]])[0]

        return [
            {"text": doc, "metadata": meta, "score": float(dist)}
            for doc, meta, dist in zip(docs, metas, dists)
        ]
    except Exception:
        logger.exception("[vector_db] ChromaDB search failed for collection '%s'", collection)
        return []


def delete_collection(collection: str) -> None:
    """
    Delete all documents in *collection* from both Firestore and ChromaDB.
    Used by demo reset to wipe RAG state.
    """
    # Firestore
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

    # ChromaDB
    try:
        if not _use_firestore_vectors():
            cli = _chroma.client()
            try:
                cli.delete_collection(collection)
            except Exception:
                pass  # collection may not exist yet
            _chroma._loaded.discard(collection)
    except Exception:
        logger.exception("[vector_db] ChromaDB collection delete failed for %s", collection)


def clear_chroma_cache() -> None:
    """Wipe the in-memory ChromaDB cache. Called on demo reset."""
    _chroma.clear()


def search_with_user_context(
    collection: str,
    query_text: str,
    user_context: dict,
    top_k: int = 5,
) -> list[dict]:
    """
    Convenience wrapper: build metadata filters from *user_context* and call
    search_similar().

    user_context keys used as filters (all optional):
        curriculum, subject, education_level, country

    Filters degrade gracefully: if a field is missing or None it is omitted,
    so a teacher with no curriculum set still gets results.

    Returns [] on any failure — never raises.
    """
    filters: dict = {}
    for key in ("curriculum", "subject", "education_level", "country"):
        val = user_context.get(key)
        if val:
            filters[key] = val

    return search_similar(collection, query_text, filters=filters or None, top_k=top_k)
