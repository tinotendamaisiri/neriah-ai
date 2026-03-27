# shared/blob_client.py
# All Azure Blob Storage operations for Neriah.
# Handles uploading raw scans, uploading annotated images, generating SAS URLs,
# downloading blobs, and deleting blobs.
# Uses azure.storage.blob.aio (async SDK). All public functions are async.

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import BlobSasPermissions, ContentSettings, generate_blob_sas
from azure.storage.blob.aio import BlobServiceClient

from .config import settings

logger = logging.getLogger(__name__)

# ── Lazy singleton client ─────────────────────────────────────────────────────
# Initialised on first call, not at import time — keeps the module importable
# without credentials and avoids creating connections during cold-start module scan.
# In production, replace credential=settings.azure_storage_key with
# DefaultAzureCredential() and use user-delegation SAS instead of account-key SAS.

_service: BlobServiceClient | None = None


def _get_service() -> BlobServiceClient:
    """Return the module-level BlobServiceClient, creating it on first call."""
    global _service
    if _service is None:
        account_url = (
            f"https://{settings.azure_storage_account}.blob.core.windows.net"
        )
        _service = BlobServiceClient(
            account_url=account_url,
            credential=settings.azure_storage_key,
        )
    return _service


# ── Public functions ──────────────────────────────────────────────────────────

async def upload_scan(image_bytes: bytes, filename: str) -> str:
    """Upload a raw scanned image to the scans container.

    Args:
        image_bytes: JPEG image bytes.
        filename:    Blob name in the form "{teacher_id}/{class_id}/{student_id}/{uuid}.jpg".
                     Caller is responsible for constructing this path.

    Returns:
        The blob name (not a URL). Call generate_sas_url() to get a shareable link.
    """
    container = settings.azure_storage_container_scans
    logger.debug("upload_scan container=%s blob=%s bytes=%d", container, filename, len(image_bytes))
    await _upload_bytes(container, filename, image_bytes)
    return filename


async def upload_marked(image_bytes: bytes, filename: str) -> str:
    """Upload an annotated image to the marked container.

    Args:
        image_bytes: JPEG image bytes (Pillow-annotated).
        filename:    Blob name in the form "{teacher_id}/{class_id}/{student_id}/{uuid}.jpg".

    Returns:
        The blob name (not a URL). Call generate_sas_url() to get a shareable link.
    """
    container = settings.azure_storage_container_marked
    logger.debug("upload_marked container=%s blob=%s bytes=%d", container, filename, len(image_bytes))
    await _upload_bytes(container, filename, image_bytes)
    return filename


def generate_sas_url(container_name: str, blob_name: str, expiry_hours: int = 24) -> str:
    """Generate a read-only SAS URL for a blob.

    This function is synchronous — generate_blob_sas() performs only local
    HMAC signing using the account key; no network call is made.

    Args:
        container_name: Container the blob lives in.
        blob_name:      Full blob path within the container.
        expiry_hours:   How many hours from now the URL should remain valid. Default 24.

    Returns:
        Full HTTPS SAS URL string.
    """
    expiry = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
    logger.debug(
        "generate_sas_url container=%s blob=%s expiry_hours=%d",
        container_name, blob_name, expiry_hours,
    )
    sas_token = generate_blob_sas(
        account_name=settings.azure_storage_account,
        container_name=container_name,
        blob_name=blob_name,
        account_key=settings.azure_storage_key,
        permission=BlobSasPermissions(read=True),
        expiry=expiry,
    )
    return (
        f"https://{settings.azure_storage_account}.blob.core.windows.net"
        f"/{container_name}/{blob_name}?{sas_token}"
    )


async def download_blob(container_name: str, blob_name: str) -> bytes:
    """Download a blob and return its raw bytes.

    Used when re-processing or re-annotating an existing scan.

    Raises:
        ResourceNotFoundError: if the blob does not exist.
    """
    logger.debug("download_blob container=%s blob=%s", container_name, blob_name)
    service = _get_service()
    blob_client = service.get_blob_client(container=container_name, blob=blob_name)
    stream = await blob_client.download_blob()
    return await stream.readall()


async def delete_blob(container_name: str, blob_name: str) -> None:
    """Delete a blob. Logs a warning instead of raising if the blob does not exist.

    Args:
        container_name: Container the blob lives in.
        blob_name:      Full blob path within the container.
    """
    logger.debug("delete_blob container=%s blob=%s", container_name, blob_name)
    service = _get_service()
    blob_client = service.get_blob_client(container=container_name, blob=blob_name)
    try:
        await blob_client.delete_blob()
    except ResourceNotFoundError:
        logger.warning(
            "delete_blob: blob not found, skipping — container=%s blob=%s",
            container_name, blob_name,
        )


async def upload_bytes(
    file_bytes: bytes,
    blob_name: str,
    container_name: str,
    content_type: str = "application/octet-stream",
) -> str:
    """Upload raw bytes to any container with the specified content type.

    Args:
        file_bytes:     Raw bytes to upload.
        blob_name:      Full blob path within the container.
        container_name: Target container name.
        content_type:   MIME type for the blob. Default: application/octet-stream.

    Returns:
        The blob name.
    """
    logger.debug(
        "upload_bytes container=%s blob=%s bytes=%d content_type=%s",
        container_name, blob_name, len(file_bytes), content_type,
    )
    await _upload_bytes(container_name, blob_name, file_bytes, content_type=content_type)
    return blob_name


# ── Private helpers ───────────────────────────────────────────────────────────

async def _upload_bytes(
    container: str,
    blob_name: str,
    data: bytes,
    content_type: str = "image/jpeg",
) -> None:
    """Upload raw bytes to a container with the given content type."""
    service = _get_service()
    blob_client = service.get_blob_client(container=container, blob=blob_name)
    await blob_client.upload_blob(
        data,
        overwrite=True,
        content_settings=ContentSettings(content_type=content_type),
    )
