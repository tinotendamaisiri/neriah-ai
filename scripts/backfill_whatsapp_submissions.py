"""
scripts/backfill_whatsapp_submissions.py

Create the missing student_submissions row for every Mark whose source is
"student_whatsapp" but has no companion row in student_submissions.

Background: until 2026-05-03, functions/whatsapp.py:_handle_student_submission
called upsert("marks", ...) but never wrote a companion student_submissions
row. The Results tab and the teacher review queue both query
student_submissions, so WhatsApp grades existed as orphan Mark documents
that no list query ever returned. The handler is now fixed for new
submissions; this script repairs the historical data.

Usage:
    python scripts/backfill_whatsapp_submissions.py            # live run
    python scripts/backfill_whatsapp_submissions.py --dry-run  # log only

Requires:
    GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`
    GCP_PROJECT_ID set in .env (or environment)
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import uuid

# Make the repo root importable so we reuse the same Firestore client the
# Cloud Function uses — single source of truth, no risk of writing to a
# different DB id by accident.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from shared.firestore_client import query, upsert  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("backfill_whatsapp_submissions")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create missing student_submissions rows for WhatsApp Mark documents."
    )
    parser.add_argument("--dry-run", action="store_true", help="Log changes without writing.")
    args = parser.parse_args()

    mode = "DRY RUN" if args.dry_run else "LIVE"
    logger.info("=== backfill_whatsapp_submissions [%s] ===", mode)

    marks = query("marks", [("source", "==", "student_whatsapp")])
    if not marks:
        logger.info("No student_whatsapp marks found. Nothing to backfill.")
        return

    logger.info("Found %d student_whatsapp mark(s).", len(marks))

    created = 0
    skipped_existing = 0
    skipped_invalid = 0

    for mark in marks:
        mark_id = mark.get("id") or mark.get("mark_id")
        if not mark_id:
            logger.warning("  Mark with no id field — skipping: %s", mark)
            skipped_invalid += 1
            continue

        existing = query("student_submissions", [("mark_id", "==", mark_id)])
        if existing:
            skipped_existing += 1
            continue

        student_id = mark.get("student_id") or ""
        class_id = mark.get("class_id") or ""
        answer_key_id = mark.get("answer_key_id") or ""
        if not (student_id and class_id and answer_key_id):
            logger.warning(
                "  Mark %s missing student/class/answer_key — skipping.", mark_id,
            )
            skipped_invalid += 1
            continue

        approved = bool(mark.get("approved"))
        # Use the Mark's timestamp as both submitted_at and graded_at since
        # that's the only timestamp we have. If the mark was already
        # approved, mirror that into the submission row + approved_at so
        # the student sees the row as graded immediately.
        ts = mark.get("timestamp") or ""
        annotated_urls = mark.get("annotated_urls") or []
        marked_image_url = mark.get("marked_image_url")
        image_urls = list(annotated_urls) or ([marked_image_url] if marked_image_url else [])

        sub_id = f"sub_{uuid.uuid4().hex[:12]}"
        row = {
            "id": sub_id,
            "student_id": student_id,
            "class_id": class_id,
            "answer_key_id": answer_key_id,
            "teacher_id": mark.get("teacher_id", ""),
            "mark_id": mark_id,
            "status": "approved" if approved else "graded",
            "source": "student_whatsapp",
            "image_urls": image_urls,
            "submitted_at": ts,
            "graded_at": ts,
            "score": mark.get("score", 0),
            "max_score": mark.get("max_score", 0),
            "percentage": mark.get("percentage", 0),
        }
        if approved:
            row["approved_at"] = ts

        logger.info(
            "  %s sub=%s mark=%s student=%s class=%s ak=%s status=%s",
            "Would write" if args.dry_run else "Writing",
            sub_id, mark_id, student_id, class_id, answer_key_id, row["status"],
        )

        if not args.dry_run:
            upsert("student_submissions", sub_id, row)
        created += 1

    logger.info(
        "=== Done: %s %d row(s); skipped %d existing, %d invalid ===",
        "Would create" if args.dry_run else "Created",
        created, skipped_existing, skipped_invalid,
    )


if __name__ == "__main__":
    main()
