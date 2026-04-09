"""
Student submission management — teacher-side endpoints.

GET   /api/submissions                        — list submissions by homework_id or class_id
POST  /api/submissions/<sub_id>/approve       — approve a graded submission (visible to student)
PATCH /api/submissions/<sub_id>/override      — override score and/or feedback
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.firestore_client import get_doc, query, upsert
from shared.training_data import collect_training_sample

logger = logging.getLogger(__name__)
submissions_bp = Blueprint("submissions", __name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── GET /api/submissions ───────────────────────────────────────────────────────

@submissions_bp.get("/submissions")
def list_submissions():
    """
    List student submissions for a homework or class.

    Query params:
      homework_id   — filter by specific answer key (aliases: answer_key_id)
      class_id      — filter by class (returns all homework submissions in class)
      status        — optional: "pending" | "grading" | "graded" | "approved" | "error"

    Returns each submission enriched with student_name and answer_key_title.
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    homework_id = (
        request.args.get("homework_id")
        or request.args.get("answer_key_id")
        or ""
    ).strip()
    class_id = (request.args.get("class_id") or "").strip()
    status_filter = (request.args.get("status") or "").strip() or None

    if not homework_id and not class_id:
        return jsonify({"error": "homework_id or class_id is required"}), 400

    # Authorisation: teacher must own the homework or class
    if homework_id:
        hw = get_doc("answer_keys", homework_id)
        if not hw:
            return jsonify({"error": "Homework not found"}), 404
        if hw.get("teacher_id") != teacher_id:
            return jsonify({"error": "forbidden"}), 403
        filters = [("answer_key_id", "==", homework_id)]
    else:
        cls = get_doc("classes", class_id)
        if not cls:
            return jsonify({"error": "Class not found"}), 404
        if cls.get("teacher_id") != teacher_id:
            return jsonify({"error": "forbidden"}), 403
        filters = [("class_id", "==", class_id)]

    if status_filter:
        filters.append(("status", "==", status_filter))

    subs = query(
        "student_submissions",
        filters,
        order_by="submitted_at",
        direction="ASCENDING",
    )

    # Enrich with student names and answer key titles (with simple caches)
    student_cache: dict[str, dict | None] = {}
    ak_cache: dict[str, dict | None] = {}

    for sub in subs:
        # Student name
        sid = sub.get("student_id", "")
        if sid not in student_cache:
            student_cache[sid] = get_doc("students", sid)
        student = student_cache[sid]
        if student:
            sub["student_name"] = (
                f"{student.get('first_name', '')} {student.get('surname', '')}".strip()
            )
        else:
            sub.setdefault("student_name", "Unknown")

        # Answer key title
        ak_id = sub.get("answer_key_id", "")
        if ak_id and not sub.get("answer_key_title"):
            if ak_id not in ak_cache:
                ak_cache[ak_id] = get_doc("answer_keys", ak_id)
            ak = ak_cache.get(ak_id)
            if ak:
                sub["answer_key_title"] = ak.get("title") or ak.get("subject") or ""

        # Ensure source field is present
        sub.setdefault("source", "student_submission")

    return jsonify(subs), 200


# ── POST /api/submissions/<sub_id>/approve ────────────────────────────────────

@submissions_bp.post("/submissions/<sub_id>/approve")
def approve_submission(sub_id: str):
    """
    Approve a graded submission, making the annotated result visible to the student.

    Sets status → "approved", approved_at, approved_by.
    Also sets approved=True on the linked Mark document.
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    sub = get_doc("student_submissions", sub_id)
    if not sub:
        return jsonify({"error": "Submission not found"}), 404

    # Verify teacher owns this homework
    hw = get_doc("answer_keys", sub.get("answer_key_id", ""))
    if not hw or hw.get("teacher_id") != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    if sub.get("status") != "graded":
        return jsonify({
            "error": f"Only graded submissions can be approved (current status: {sub.get('status')})"
        }), 400

    now = _now_iso()
    upsert("student_submissions", sub_id, {
        "status": "approved",
        "approved_at": now,
        "approved_by": teacher_id,
    })

    # Make mark visible to student
    mark_id = sub.get("mark_id")
    if mark_id:
        upsert("marks", mark_id, {"approved": True, "approved_at": now})

    # Collect training pair asynchronously (fire and forget — never blocks response)
    approved_sub = {**sub, "status": "approved", "approved_at": now}
    collect_training_sample(approved_sub, teacher_id)

    return jsonify({"message": "approved", "submission_id": sub_id}), 200


# ── PATCH /api/submissions/<sub_id>/override ──────────────────────────────────

@submissions_bp.patch("/submissions/<sub_id>/override")
def override_submission(sub_id: str):
    """
    Teacher override: update score and/or feedback on a graded submission.

    Body:
      score    — required — new score (float)
      feedback — optional — teacher comment to show the student

    Preserves the original AI score in ai_score, sets teacher_override: true.
    Also updates the linked Mark document.
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    sub = get_doc("student_submissions", sub_id)
    if not sub:
        return jsonify({"error": "Submission not found"}), 404

    hw = get_doc("answer_keys", sub.get("answer_key_id", ""))
    if not hw or hw.get("teacher_id") != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    body = request.get_json(silent=True) or {}
    raw_score = body.get("score")
    feedback = body.get("feedback")

    if raw_score is None:
        return jsonify({"error": "score is required"}), 400

    try:
        new_score = float(raw_score)
    except (TypeError, ValueError):
        return jsonify({"error": "score must be a number"}), 400

    if new_score < 0:
        return jsonify({"error": "score cannot be negative"}), 400

    max_score = float(sub.get("max_score") or 1)

    if new_score > max_score:
        return jsonify({"error": f"score cannot exceed max_score ({max_score})"}), 400
    percentage = round(new_score / max_score * 100, 1) if max_score else 0.0

    now = _now_iso()
    sub_updates: dict = {
        "score": new_score,
        "percentage": percentage,
        "teacher_override": True,
        "teacher_override_at": now,
        "ai_score": sub.get("score"),  # preserve original AI score
    }
    if feedback is not None:
        sub_updates["overall_feedback"] = feedback.strip()

    upsert("student_submissions", sub_id, sub_updates)

    # Mirror on Mark document
    mark_id = sub.get("mark_id")
    if mark_id:
        mark_updates: dict = {
            "score": new_score,
            "percentage": percentage,
            "manually_edited": True,
        }
        if feedback is not None:
            mark_updates["overall_feedback"] = feedback.strip()
        upsert("marks", mark_id, mark_updates)

    # Collect training pair with overridden grade (fire and forget)
    overridden_sub = {**sub, **sub_updates}
    collect_training_sample(overridden_sub, teacher_id)

    return jsonify({
        "message": "override saved",
        "submission_id": sub_id,
        "score": new_score,
        "percentage": percentage,
    }), 200
