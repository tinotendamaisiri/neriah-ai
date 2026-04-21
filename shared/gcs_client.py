"""Cloud Storage helpers."""

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
    public: bool = False,
) -> str:
    """Upload bytes to a bucket.

    Returns the public URL when public=True (bucket must have allUsers reader).
    Returns a GCS URI (gs://bucket/blob) when public=False — use
    generate_signed_url() to produce a time-limited URL for client delivery.
    """
    client = get_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    blob.upload_from_string(data, content_type=content_type)
    if public:
        blob.make_public()
        return blob.public_url
    return f"gs://{bucket_name}/{blob_name}"


def generate_signed_url(
    bucket_name: str,
    blob_name: str,
    expiry_minutes: int = 60,
) -> str:
    """Generate a V4 signed URL for a private GCS blob.

    The URL is valid for expiry_minutes (default 60). Use for delivering
    marked-image URLs to API clients and WhatsApp messages.
    Returns the GCS URI on failure so callers always get a non-empty string.
    """
    import datetime as _dt  # noqa: PLC0415
    try:
        import google.auth  # noqa: PLC0415
        from google.auth.transport.requests import Request  # noqa: PLC0415

        client = get_client()
        blob = client.bucket(bucket_name).blob(blob_name)

        # On Cloud Functions we use compute-engine credentials, which have no
        # private key. Use IAM-based signing via the service account email.
        credentials, _ = google.auth.default()
        if not credentials.valid:
            credentials.refresh(Request())

        sa_email = getattr(credentials, "service_account_email", None)
        if sa_email is None or sa_email == "default":
            # Fall back to the metadata-server value for GCE creds
            import requests as _requests  # noqa: PLC0415
            sa_email = _requests.get(
                "http://metadata.google.internal/computeMetadata/v1/"
                "instance/service-accounts/default/email",
                headers={"Metadata-Flavor": "Google"},
                timeout=2,
            ).text.strip()

        return blob.generate_signed_url(
            expiration=_dt.timedelta(minutes=expiry_minutes),
            method="GET",
            version="v4",
            service_account_email=sa_email,
            access_token=credentials.token,
        )
    except Exception:
        logger.exception("[gcs] generate_signed_url failed for %s/%s", bucket_name, blob_name)
        # Re-raise so the caller can translate to a typed error.
        raise


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
