"""
Training data collection — fired asynchronously on every teacher approval.

Copies verified grading pairs to gs://neriah-training-data so they can be used
to fine-tune and evaluate the grading model.

Directory layout in the training bucket:
  {school_id}/{class_id}/{submission_id}/
    image.jpg              — original student submission photo
    marking_scheme.json    — answer key used for grading
    ai_grade.json          — Gemma 4 raw grading output
    teacher_grade.json     — final approved/overridden grade
    metadata.json          — subject, level, school, class, source, timestamps

Design constraints:
  - Never blocks the HTTP response — runs in a daemon thread.
  - Fails silently: all exceptions are logged, never re-raised.
  - Skipped when COLLECT_TRAINING_DATA=false, NERIAH_ENV=demo,
    or teacher.training_data_consent is False.
  - No student names are written — only IDs.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from urllib.parse import urlparse

from shared.config import is_demo, settings
from shared.firestore_client import get_doc

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _upload_json(bucket_name: str, blob_path: str, data: dict) -> None:
    from shared.gcs_client import upload_bytes
    payload = json.dumps(data, indent=2, default=str).encode("utf-8")
    upload_bytes(bucket_name, blob_path, payload,
                 content_type="application/json", public=False)


def _parse_gcs_url(url: str) -> tuple[str, str] | None:
    """
    Extract (bucket, blob_name) from a GCS public or signed URL.
    Handles:
      https://storage.googleapis.com/{bucket}/{blob}
      https://storage.cloud.google.com/{bucket}/{blob}
      gs://{bucket}/{blob}
    """
    if not url:
        return None
    if url.startswith("gs://"):
        rest = url[5:]
        bucket, _, blob = rest.partition("/")
        return (bucket, blob) if blob else None
    parsed = urlparse(url)
    if "storage" in parsed.netloc and "google" in parsed.netloc:
        # path = /{bucket}/{blob...}
        parts = parsed.path.lstrip("/").split("/", 1)
        if len(parts) == 2:
            return parts[0], parts[1]
    return None


def _copy_image(src_url: str, dst_bucket: str, dst_blob: str) -> None:
    """Server-side GCS copy when source is in GCS; HTTP fallback otherwise."""
    parsed = _parse_gcs_url(src_url)
    if parsed:
        src_bucket_name, src_blob_name = parsed
        from shared.gcs_client import get_client
        gcs = get_client()
        src_blob_obj = gcs.bucket(src_bucket_name).blob(src_blob_name)
        dst_bucket_obj = gcs.bucket(dst_bucket)
        # copy_blob handles large objects via rewrite automatically
        gcs.bucket(src_bucket_name).copy_blob(
            src_blob_obj, dst_bucket_obj, new_name=dst_blob
        )
    else:
        # HTTP fallback for non-GCS URLs
        import urllib.request
        with urllib.request.urlopen(src_url, timeout=30) as resp:
            data = resp.read()
        from shared.gcs_client import upload_bytes
        upload_bytes(dst_bucket, dst_blob, data,
                     content_type="image/jpeg", public=False)


# ── Core collection logic (runs in background thread) ─────────────────────────

def _do_collect(
    sub: dict,
    mark: dict,
    answer_key: dict,
    class_doc: dict,
    school_doc: dict | None,
) -> None:
    """Builds and uploads all training files. All exceptions are caught here."""
    try:
        bucket = settings.GCS_BUCKET_TRAINING

        submission_id = sub.get("id") or sub.get("submission_id") or "unknown"
        school_id  = sub.get("school_id") or class_doc.get("school_id") or "unknown"
        class_id   = sub.get("class_id") or "unknown"
        student_id = sub.get("student_id") or "unknown"
        hw_id      = sub.get("answer_key_id") or "unknown"
        prefix     = f"{school_id}/{class_id}/{submission_id}"

        teacher_override = bool(sub.get("teacher_override", False))

        # ── metadata.json ────────────────────────────────────────────────────
        _upload_json(bucket, f"{prefix}/metadata.json", {
            "submission_id": submission_id,
            "student_id":    student_id,      # no name — ID only
            "school_id":     school_id,
            "class_id":      class_id,
            "homework_id":   hw_id,
            "subject":       answer_key.get("subject") or class_doc.get("subject") or "",
            "education_level": (
                answer_key.get("education_level")
                or class_doc.get("education_level") or ""
            ),
            "curriculum":    class_doc.get("curriculum") or "",
            "class_name":    class_doc.get("name") or "",
            "school_name":   (school_doc or {}).get("name") or "",
            "approved_at":   _now_iso(),
            "teacher_override": teacher_override,
            "source":        sub.get("source") or "app",
            "collector_version": "1.0",
        })

        # ── marking_scheme.json ──────────────────────────────────────────────
        _upload_json(bucket, f"{prefix}/marking_scheme.json", {
            "answer_key_id":   hw_id,
            "title":           answer_key.get("title") or "",
            "subject":         answer_key.get("subject") or "",
            "education_level": answer_key.get("education_level") or "",
            "total_marks":     answer_key.get("total_marks") or 0,
            "questions":       answer_key.get("questions") or [],
        })

        # ── ai_grade.json ────────────────────────────────────────────────────
        # Use ai_score if teacher overrode, otherwise use current score on mark.
        ai_raw_score = float(
            sub.get("ai_score")
            if teacher_override and sub.get("ai_score") is not None
            else (mark.get("score") or sub.get("score") or 0)
        )
        _upload_json(bucket, f"{prefix}/ai_grade.json", {
            "total_score":    ai_raw_score,
            "max_score":      float(mark.get("max_score") or sub.get("max_score") or 0),
            "grading_model":  mark.get("grading_model") or "gemma4",
            "verdicts":       mark.get("verdicts") or [],
            "overall_feedback": mark.get("overall_feedback") or "",
        })

        # ── teacher_grade.json ───────────────────────────────────────────────
        final_score = float(sub.get("score") or mark.get("score") or 0)
        max_score   = float(sub.get("max_score") or mark.get("max_score") or 1)
        _upload_json(bucket, f"{prefix}/teacher_grade.json", {
            "total_score":      final_score,
            "max_score":        max_score,
            "percentage":       round(final_score / max_score * 100, 1) if max_score else 0.0,
            "teacher_override": teacher_override,
            "original_ai_score": ai_raw_score,
            "feedback":         (
                sub.get("overall_feedback")
                or mark.get("overall_feedback") or ""
            ),
        })

        # ── image.jpg ────────────────────────────────────────────────────────
        image_url = (
            sub.get("submission_image_url")
            or sub.get("image_url")
            or sub.get("original_image_url")
            or sub.get("file_url")
        )
        if image_url:
            _copy_image(image_url, bucket, f"{prefix}/image.jpg")
        else:
            logger.warning(
                "[training] Submission %s has no original image URL — "
                "training sample saved without image.",
                submission_id,
            )

        logger.info(
            "[training] Collected sample: %s/%s  teacher_override=%s",
            bucket, prefix, teacher_override,
        )

        # ── vector DB (RAG grading examples) ─────────────────────────────────
        _store_grading_vector(sub, mark, answer_key, class_doc, teacher_override)

    except Exception:
        logger.exception(
            "[training] Failed to collect training sample for submission %s",
            sub.get("id") or sub.get("submission_id"),
        )


# ── Vector DB — RAG grading examples ──────────────────────────────────────────

def _store_grading_vector(
    sub: dict,
    mark: dict,
    answer_key: dict,
    class_doc: dict,
    teacher_override: bool,
) -> None:
    """
    Store each graded question as a vector DB document in the 'grading_examples'
    collection so future grading calls can retrieve similar verified decisions.

    One document per verdict (not per submission) to maximise retrieval granularity.
    No student names or identifying information — IDs only.
    Fails silently — never interrupts the parent thread.
    """
    try:
        from shared.vector_db import store_document  # noqa: PLC0415

        submission_id = sub.get("id") or sub.get("submission_id") or "unknown"
        subject       = answer_key.get("subject") or class_doc.get("subject") or ""
        edu_level     = answer_key.get("education_level") or class_doc.get("education_level") or ""
        curriculum    = class_doc.get("curriculum") or ""
        school_id     = sub.get("school_id") or class_doc.get("school_id") or ""
        final_score   = float(sub.get("score") or mark.get("score") or 0)
        max_score     = float(sub.get("max_score") or mark.get("max_score") or 1)

        verdicts: list[dict] = mark.get("verdicts") or []
        questions: list[dict] = answer_key.get("questions") or []

        # Build a lookup of question text from the answer key
        q_lookup: dict[int, dict] = {
            q.get("number") or q.get("question_number", 0): q
            for q in questions
        }

        for v in verdicts:
            q_num      = v.get("question_number", 0)
            verdict    = v.get("verdict", "")
            awarded    = float(v.get("awarded_marks", 0))
            q_max      = float(v.get("max_marks", 0))
            feedback   = v.get("feedback") or ""
            student_ans = v.get("student_answer") or ""
            q_info     = q_lookup.get(q_num, {})
            q_text     = q_info.get("question_text") or q_info.get("correct_answer", "")
            correct_ans = q_info.get("correct_answer") or q_info.get("answer") or ""

            text = (
                f"Subject: {subject}\n"
                f"Education Level: {edu_level}\n"
                f"Curriculum: {curriculum}\n"
                f"Question: {q_text}\n"
                f"Correct Answer: {correct_ans}\n"
                f"Student Answer: {student_ans}\n"
                f"Verdict: {verdict}\n"
                f"Score: {awarded}/{q_max}\n"
                f"Teacher Feedback: {feedback}\n"
                f"Teacher Override: {teacher_override}"
            )

            doc_id = f"{submission_id}-q{q_num}"
            metadata = {
                "subject":         subject,
                "education_level": edu_level,
                "curriculum":      curriculum,
                "school_id":       school_id,
                "verdict":         verdict,
                "teacher_override": teacher_override,
                "submission_id":   submission_id,
                "approved_at":     _now_iso(),
            }
            store_document("grading_examples", doc_id, text, metadata)

        logger.info(
            "[training] Stored %d grading vector(s) for submission %s",
            len(verdicts), submission_id,
        )
    except Exception:
        logger.exception(
            "[training] Failed to store grading vectors for submission %s",
            sub.get("id") or sub.get("submission_id"),
        )


# ── Public API ─────────────────────────────────────────────────────────────────

def collect_training_sample(sub: dict, teacher_id: str) -> None:
    """
    Schedule async training data collection for an approved submission.

    Called immediately after a teacher approves or overrides a grade.
    Returns instantly — all I/O happens in a background daemon thread.

    Guards (any failure → silent skip):
      - COLLECT_TRAINING_DATA must be True
      - NERIAH_ENV must not be "demo"
      - teacher.training_data_consent must be True (default)
    """
    if not settings.COLLECT_TRAINING_DATA:
        return
    if is_demo():
        return

    # Consent check — default True if field absent (existing teachers)
    teacher_doc = get_doc("teachers", teacher_id)
    if teacher_doc and teacher_doc.get("training_data_consent") is False:
        return

    # Gather linked documents synchronously (fast — single Firestore reads)
    mark_id = sub.get("mark_id")
    mark = (get_doc("marks", mark_id) or {}) if mark_id else {}

    answer_key_id = sub.get("answer_key_id") or ""
    answer_key = (get_doc("answer_keys", answer_key_id) or {}) if answer_key_id else {}

    class_id = sub.get("class_id") or ""
    class_doc = (get_doc("classes", class_id) or {}) if class_id else {}

    school_id = sub.get("school_id") or class_doc.get("school_id") or ""
    school_doc = get_doc("schools", school_id) if school_id else None

    # Fire-and-forget
    thread = threading.Thread(
        target=_do_collect,
        args=(sub, mark, answer_key, class_doc, school_doc),
        daemon=True,
        name=f"training-{sub.get('id', 'unknown')[:8]}",
    )
    thread.start()
