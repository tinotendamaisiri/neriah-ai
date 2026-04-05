"""Firestore CRUD helpers — replaces cosmos_client.py from the Azure build."""

from __future__ import annotations

import logging
from typing import Optional

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from shared.config import settings

logger = logging.getLogger(__name__)

_db: Optional[firestore.Client] = None


def get_db() -> firestore.Client:
    global _db
    if _db is None:
        _db = firestore.Client(
            project=settings.GCP_PROJECT_ID,
            database=settings.FIRESTORE_DATABASE,
        )
    return _db


def upsert(collection: str, doc_id: str, data: dict) -> dict:
    """Create or merge-update a document. Returns the data dict."""
    get_db().collection(collection).document(doc_id).set(data, merge=True)
    return data


def get_doc(collection: str, doc_id: str) -> Optional[dict]:
    snap = get_db().collection(collection).document(doc_id).get()
    return snap.to_dict() if snap.exists else None


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
    return [doc.to_dict() for doc in ref.stream()]


def query_single(collection: str, filters: list[tuple]) -> Optional[dict]:
    results = query(collection, filters, limit=1)
    return results[0] if results else None


def increment_field(collection: str, doc_id: str, field: str, delta: int = 1) -> None:
    get_db().collection(collection).document(doc_id).update(
        {field: firestore.Increment(delta)}
    )
