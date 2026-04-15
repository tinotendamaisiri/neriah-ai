"""Firestore CRUD helpers — replaces cosmos_client.py from the Azure build."""

from __future__ import annotations

import logging
import os
from typing import Optional

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from shared.config import settings

logger = logging.getLogger(__name__)

_db: Optional[firestore.Client] = None


def get_db() -> firestore.Client:
    global _db
    if _db is None:
        # Use FIRESTORE_DATABASE env var if explicitly set.
        # Safety: if NERIAH_ENV=demo and FIRESTORE_DATABASE is absent from the
        # environment (not just defaulted by pydantic), auto-default to "demo"
        # so a misconfigured deploy can't accidentally write to production.
        # To opt the demo function into (default), set FIRESTORE_DATABASE=(default)
        # explicitly in the function's environment variables.
        from shared.config import is_demo
        db_name = settings.FIRESTORE_DATABASE
        if is_demo() and os.getenv("FIRESTORE_DATABASE") is None:
            db_name = "demo"
            logger.warning(
                "NERIAH_ENV=demo but FIRESTORE_DATABASE not set — defaulting to 'demo'. "
                "Set FIRESTORE_DATABASE=(default) in function env vars to use the default database."
            )
        _db = firestore.Client(
            project=settings.GCP_PROJECT_ID,
            database=db_name,
        )
        logger.info("Firestore client initialised: project=%s database=%s", settings.GCP_PROJECT_ID, db_name)
    return _db


def upsert(collection: str, doc_id: str, data: dict) -> dict:
    """Create or merge-update a document. Returns the data dict."""
    get_db().collection(collection).document(doc_id).set(data, merge=True)
    return data


def get_doc(collection: str, doc_id: str) -> Optional[dict]:
    snap = get_db().collection(collection).document(doc_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict()
    data.setdefault("id", snap.id)  # inject Firestore doc ID if not stored as field
    return data


def delete_doc(collection: str, doc_id: str) -> None:
    get_db().collection(collection).document(doc_id).delete()


def query(
    collection: str,
    filters: list[tuple],
    limit: Optional[int] = None,
    order_by: Optional[str] = None,
    direction: str = "ASCENDING",
) -> list[dict]:
    """
    filters: list of (field, operator, value) tuples.
    Operators: "==", "<", "<=", ">", ">=", "array_contains", "in".
    """
    ref = get_db().collection(collection)
    for field, op, value in filters:
        ref = ref.where(filter=FieldFilter(field, op, value))
    if order_by:
        # Use string literals — compatible across all google-cloud-firestore versions
        dir_ = "ASCENDING" if direction == "ASCENDING" else "DESCENDING"
        ref = ref.order_by(order_by, direction=dir_)
    if limit:
        ref = ref.limit(limit)
    results = []
    for doc in ref.stream():
        data = doc.to_dict()
        data.setdefault("id", doc.id)  # inject Firestore doc ID if not stored as field
        results.append(data)
    return results


def query_single(collection: str, filters: list[tuple]) -> Optional[dict]:
    results = query(collection, filters, limit=1)
    return results[0] if results else None


def increment_field(collection: str, doc_id: str, field: str, delta: int = 1) -> None:
    get_db().collection(collection).document(doc_id).update(
        {field: firestore.Increment(delta)}
    )
