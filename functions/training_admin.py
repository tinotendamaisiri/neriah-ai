"""
Admin viewer for the training-data archive.

Browses gs://neriah-training-data — populated by
shared/training_data.collect_training_sample on every teacher approval —
and returns a signed-URL list of recent samples for the admin dashboard.

Auth: same Bearer ADMIN_API_KEY pattern as functions/events.py.
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta

from flask import Blueprint, jsonify, request

from shared.config import settings
from shared.gcs_client import generate_signed_url, get_client
from shared.observability import instrument_route

logger = logging.getLogger(__name__)
training_admin_bp = Blueprint("training_admin", __name__)


def _admin_authorized() -> bool:
    expected = settings.ADMIN_API_KEY
    if not expected:
        return False
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return False
    return auth_header[len("Bearer "):] == expected


def _list_samples(limit: int) -> list[dict]:
    """
    List up to `limit` most recent training samples in the archive.

    Each sample is one approved submission, identified by the folder
    `{school_id}/{class_id}/{submission_id}/` written by
    collect_training_sample. We pull the metadata.json + image.jpg and
    return signed URLs so the dashboard can preview thumbnails without
    making the bucket public.
    """
    bucket_name = settings.GCS_BUCKET_TRAINING
    client = get_client()
    bucket = client.bucket(bucket_name)

    # We want every metadata.json blob — one per approved submission.
    # Sort by blob.updated DESC (newest first) and cap at `limit` so a
    # large archive doesn't blow up the listing call.
    metadata_blobs = sorted(
        (b for b in bucket.list_blobs() if b.name.endswith("/metadata.json")),
        key=lambda b: b.updated,
        reverse=True,
    )[:limit]

    samples: list[dict] = []
    for meta_blob in metadata_blobs:
        # Folder = path up to (but not including) "/metadata.json"
        folder = meta_blob.name[: -len("metadata.json")]
        try:
            meta = json.loads(meta_blob.download_as_bytes().decode("utf-8"))
        except Exception:
            logger.warning("training_admin: failed to parse %s", meta_blob.name)
            meta = {}

        # Submission folders look like {school_id}/{class_id}/{sub_id}/
        parts = folder.rstrip("/").split("/")
        sub_id = parts[-1] if parts else ""
        class_id = parts[-2] if len(parts) >= 2 else ""
        school_id = parts[-3] if len(parts) >= 3 else ""

        image_blob_name = f"{folder}image.jpg"
        image_url = None
        if bucket.blob(image_blob_name).exists():
            try:
                image_url = generate_signed_url(
                    bucket_name=bucket_name,
                    blob_name=image_blob_name,
                    expiration=timedelta(hours=1),
                )
            except Exception:
                logger.warning(
                    "training_admin: signed URL failed for %s", image_blob_name,
                    exc_info=True,
                )

        samples.append({
            "submission_id": sub_id,
            "class_id": class_id,
            "school_id": school_id,
            "subject": meta.get("subject"),
            "education_level": meta.get("education_level"),
            "school_name": meta.get("school_name"),
            "source": meta.get("source"),
            "ai_score": meta.get("ai_score"),
            "teacher_score": meta.get("teacher_score"),
            "max_score": meta.get("max_score"),
            "approved_at": meta.get("approved_at"),
            "image_url": image_url,
            "folder": folder,
        })

    return samples


@training_admin_bp.get("/admin/training/list")
@instrument_route("training_admin.list", "training")
def training_list():
    if not _admin_authorized():
        return jsonify({"error": "unauthorized"}), 401

    try:
        limit = max(1, min(int(request.args.get("limit", 50)), 200))
    except ValueError:
        limit = 50

    try:
        samples = _list_samples(limit)
    except Exception:
        logger.exception("training_admin.list failed")
        return jsonify({"error": "list failed"}), 500

    return jsonify({"samples": samples, "count": len(samples)}), 200


@training_admin_bp.get("/admin/training/stats")
@instrument_route("training_admin.stats", "training")
def training_stats():
    """Aggregate counts for the admin dashboard summary card."""
    if not _admin_authorized():
        return jsonify({"error": "unauthorized"}), 401

    try:
        bucket = get_client().bucket(settings.GCS_BUCKET_TRAINING)
        sample_count = 0
        bytes_total = 0
        for blob in bucket.list_blobs():
            if blob.name.endswith("/metadata.json"):
                sample_count += 1
            bytes_total += blob.size or 0
    except Exception:
        logger.exception("training_admin.stats failed")
        return jsonify({"error": "stats failed"}), 500

    return jsonify({
        "samples": sample_count,
        "bytes_total": bytes_total,
        "bucket": settings.GCS_BUCKET_TRAINING,
    }), 200
