"""Cloud Storage helpers — replaces blob_client.py from the Azure build."""

from __future__ import annotations

import logging
from typing import Optional

from google.cloud import storage

from shared.config import settings

logger = logging.getLogger(__name__)

_client: Optional[storage.Client] = None


def get_client() -> storage.Client:
    global _client
    if _client is None:
        _client = storage.Client(project=settings.GCP_PROJECT_ID)
    return _client


def upload_bytes(
    bucket_name: str,
    blob_name: str,
    data: bytes,
    content_type: str = "image/jpeg",
    public: bool = True,
) -> str:
    """Upload bytes to a bucket. Returns the public URL."""
    client = get_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    blob.upload_from_string(data, content_type=content_type)
    if public:
        blob.make_public()
    return blob.public_url


def download_bytes(bucket_name: str, blob_name: str) -> bytes:
    client = get_client()
    return client.bucket(bucket_name).blob(blob_name).download_as_bytes()


def delete_blob(bucket_name: str, blob_name: str) -> None:
    client = get_client()
    blob = client.bucket(bucket_name).blob(blob_name)
    if blob.exists():
        blob.delete()


def blob_exists(bucket_name: str, blob_name: str) -> bool:
    return get_client().bucket(bucket_name).blob(blob_name).exists()
