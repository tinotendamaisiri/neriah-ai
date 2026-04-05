"""
Batch grading Cloud Run Job.

Reads ANSWER_KEY_ID from environment, fetches all pending student submissions
for that answer key, grades each one against the answer key, writes marks to
Firestore, and sends the teacher a push notification when done.

Run locally:
    ANSWER_KEY_ID=<id> python -m functions.batch_grading
"""

from __future__ import annotations

import logging
import os
import sys
import uuid

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


def main() -> None:
    answer_key_id = os.environ.get("ANSWER_KEY_ID", "").strip()
    if not answer_key_id:
        logger.error("ANSWER_KEY_ID env var is required")
        sys.exit(1)

    # Import here so GCP credentials are loaded after env is set
    from shared.annotator import annotate_image
    from shared.config import settings
    from shared.firestore_client import get_doc, query, upsert
    from shared.gcs_client import download_bytes, upload_bytes
    from shared.gemma_client import grade_submission
    from shared.models import GradingVerdict, Mark
    from functions.push import send_teacher_notification

    logger.info("Batch grading started — answer_key_id=%s", answer_key_id)

    # ── Load answer key ───────────────────────────────────────────────────────
    answer_key = get_doc("answer_keys", answer_key_id)
    if not answer_key:
        logger.error("Answer key %s not found — aborting", answer_key_id)
        sys.exit(1)

    teacher_id = answer_key["teacher_id"]
    class_id = answer_key["class_id"]

    class_doc = get_doc("classes", class_id)
    education_level = answer_key.get("education_level") or (
        class_doc.get("education_level") if class_doc else "Form 4"
    )

    # ── Fetch pending submissions ─────────────────────────────────────────────
    submissions = query("student_submissions", [
        ("answer_key_id", "==", answer_key_id),
        ("status", "==", "pending"),
    ])

    logger.info("Found %d pending submission(s) to grade", len(submissions))
    graded = 0
    errors = 0

    for sub in submissions:
        sub_id = sub.get("id") or sub.get("submission_id")
        student_id = sub.get("student_id", "")
        image_urls: list[str] = sub.get("image_urls") or []

        if not image_urls:
            logger.warning("Submission %s has no images — skipping", sub_id)
            upsert("student_submissions", sub_id, {"status": "error", "error": "no images"})
            errors += 1
            continue

        try:
            # Use the first image page as the primary grading image
            # (multi-page: concatenate verdicts from each page — MVP uses page 1)
            primary_url = image_urls[0]

            # Download image from GCS
            # GCS URL format: gs://bucket/path  OR  https://storage.googleapis.com/bucket/path
            image_bytes = _download_image(primary_url, settings)

            # Grade
            raw_verdicts = grade_submission(image_bytes, answer_key, education_level)
            verdicts = [GradingVerdict(**v) for v in raw_verdicts if isinstance(v, dict)]
            score = sum(v.awarded_marks for v in verdicts)
            max_score = sum(v.max_marks for v in verdicts) or float(answer_key.get("total_marks", 1))
            percentage = round(score / max_score * 100, 1) if max_score else 0.0

            # Annotate
            verdicts_dicts = [v.model_dump() for v in verdicts]
            annotated_bytes = annotate_image(image_bytes, verdicts_dicts, None)

            # Upload annotated image
            blob_name = f"{student_id}/{uuid.uuid4()}.jpg"
            marked_url = upload_bytes(settings.GCS_BUCKET_MARKED, blob_name, annotated_bytes)

            # Write mark
            mark_doc = Mark(
                student_id=student_id,
                class_id=class_id,
                answer_key_id=answer_key_id,
                teacher_id=teacher_id,
                score=score,
                max_score=max_score,
                percentage=percentage,
                verdicts=verdicts,
                marked_image_url=marked_url,
                source="student_submission",
                approved=False,  # teacher review required
            )
            upsert("marks", mark_doc.id, mark_doc.model_dump())

            # Mark submission as graded
            upsert("student_submissions", sub_id, {
                "status": "graded",
                "mark_id": mark_doc.id,
                "score": score,
                "max_score": max_score,
                "percentage": percentage,
                "marked_image_url": marked_url,
            })

            graded += 1
            logger.info("Graded submission %s — %.1f%%", sub_id, percentage)

        except Exception:
            logger.exception("Failed to grade submission %s", sub_id)
            upsert("student_submissions", sub_id, {"status": "error"})
            errors += 1

    # ── Notify teacher ────────────────────────────────────────────────────────
    homework_title = answer_key.get("title", "Homework")
    body = f"{graded} submission(s) graded. {errors} error(s)." if errors else f"All {graded} submission(s) graded."
    send_teacher_notification(
        teacher_id=teacher_id,
        title=f"Grading complete — {homework_title}",
        body=body,
    )

    logger.info("Batch grading complete — graded=%d errors=%d", graded, errors)


def _download_image(url: str, settings) -> bytes:
    """Download image bytes from a GCS URL (gs:// or https://storage.googleapis.com)."""
    if url.startswith("gs://"):
        # gs://bucket/path
        from google.cloud import storage
        parts = url[5:].split("/", 1)
        bucket_name, blob_path = parts[0], parts[1]
        client = storage.Client(project=settings.GCP_PROJECT_ID)
        bucket = client.bucket(bucket_name)
        return bucket.blob(blob_path).download_as_bytes()
    else:
        # https:// — use requests with ADC token
        import google.auth
        import google.auth.transport.requests
        import requests as http
        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        auth_req = google.auth.transport.requests.Request()
        creds.refresh(auth_req)
        resp = http.get(url, headers={"Authorization": f"Bearer {creds.token}"}, timeout=30)
        resp.raise_for_status()
        return resp.content


if __name__ == "__main__":
    main()
