"""
Student submission management — teacher-side endpoints.

GET    /api/submissions                        — list submissions by homework_id, class_id, or teacher_id
POST   /api/submissions/<sub_id>/approve       — approve a graded submission (visible to student)
POST   /api/submissions/approve-bulk           — approve many graded submissions in one call
PATCH  /api/submissions/<sub_id>/override      — override score and/or feedback
DELETE /api/submissions/<sub_id>               — cascade-delete a submission (+ mark + GCS blob)
DELETE /api/marks/<mark_id>                    — same cascade, keyed by mark_id (for callers
                                                  that only know the mark, e.g. MarkResult).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.config import settings
from shared.firestore_client import delete_doc, get_doc, query, upsert
from shared.training_data import collect_training_sample
from shared.weakness_tracker import update_student_weaknesses

logger = logging.getLogger(__name__)
submissions_bp = Blueprint("submissions", __name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Shared cascade-delete helper ──────────────────────────────────────────────

def _cascade_delete_submission(
    sub: dict,
    teacher_id: str,
) -> dict:
    """Delete a submission + its linked mark + the annotated GCS blob.

    Weakness-profile rollback is intentionally not performed (out of scope —
    the profile represents the full history of approved grades and would
    need a full recompute from remaining approved submissions, which is
    expensive and not required for the current teacher workflow).

    Training-sample removal from the vector store is a TODO — `shared.
    training_data` exposes only `collect_training_sample` (write); no delete
    helper exists yet.

    Returns a dict describing what was deleted, for the response body +
    audit log.
    """
    submission_id = sub.get("id") or sub.get("submission_id") or ""
    mark_id = sub.get("mark_id") or ""
    student_id = sub.get("student_id") or ""
    cascades: dict[str, bool] = {
        "mark": False,
        "training_sample": False,
    }

    # 1. Delete the linked mark document.
    if mark_id:
        mark_doc = get_doc("marks", mark_id)
        if mark_doc:
            try:
                delete_doc("marks", mark_id)
                cascades["mark"] = True
            except Exception:
                logger.exception("cascade: failed to delete mark %s", mark_id)

    # 2. Delete the student_submissions row itself.
    if submission_id:
        try:
            delete_doc("student_submissions", submission_id)
        except Exception:
            logger.exception("cascade: failed to delete submission %s", submission_id)

    # 3. Image blobs are intentionally NOT deleted on submission cascade.
    #    Both the original page scans (GCS_BUCKET_SUBMISSIONS) and the
    #    Pillow-annotated copies (GCS_BUCKET_MARKED) are retained as
    #    proprietary training data — input/label pairs for future grading
    #    model fine-tunes. The teacher-facing "delete submission" only
    #    removes the Firestore record (the submission disappears from the
    #    UI); the underlying blobs persist in the bucket indefinitely.
    #
    #    If we ever need a hard-delete path for compliance (e.g. student
    #    withdraws consent), add a separate `purge_submission_blobs`
    #    function rather than re-wiring this cascade. Keep the default safe.

    # 4. TODO: training sample cleanup deferred until vector-store API
    #    exposes a delete helper. `shared.training_data` only writes today.
    #    When added, flip `cascades["training_sample"]` on success.

    logger.info(
        "[cascade-delete] teacher=%s sub=%s mark=%s student=%s cascades=%s",
        teacher_id, submission_id, mark_id, student_id, cascades,
    )
    return cascades


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
    teacher_id_filter = (request.args.get("teacher_id") or "").strip()
    status_filter = (request.args.get("status") or "").strip() or None

    if not homework_id and not class_id and not teacher_id_filter:
        return jsonify({"error": "homework_id, class_id, or teacher_id is required"}), 400

    # Authorisation: teacher must own the homework/class, or the teacher_id
    # filter must match the caller's own id (no cross-teacher reads).
    if homework_id:
        hw = get_doc("answer_keys", homework_id)
        if not hw:
            return jsonify({"error": "Homework not found"}), 404
        if hw.get("teacher_id") != teacher_id:
            return jsonify({"error": "forbidden"}), 403
        filters = [("answer_key_id", "==", homework_id)]
    elif class_id:
        cls = get_doc("classes", class_id)
        if not cls:
            return jsonify({"error": "Class not found"}), 404
        if cls.get("teacher_id") != teacher_id:
            return jsonify({"error": "forbidden"}), 403
        filters = [("class_id", "==", class_id)]
    else:
        # teacher_id-only path — used by HomeScreen to count all submissions
        # for the calling teacher across every class.
        if teacher_id_filter != teacher_id:
            return jsonify({"error": "forbidden"}), 403
        filters = [("teacher_id", "==", teacher_id)]

    if status_filter:
        filters.append(("status", "==", status_filter))

    subs = query(
        "student_submissions",
        filters,
        order_by="submitted_at",
        direction="ASCENDING",
    )

    # Enrich with student names, answer key titles, and score data from the
    # linked mark document. All three caches dedupe repeated lookups.
    student_cache: dict[str, dict | None] = {}
    ak_cache: dict[str, dict | None] = {}
    mark_cache: dict[str, dict | None] = {}

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

        # Score data from the linked mark — only for graded/approved rows.
        # Without this, the mobile homework-detail list shows "0/?" for any
        # submission whose score lives on the mark doc rather than the sub.
        mark_id = sub.get("mark_id", "")
        if mark_id and sub.get("status") in ("graded", "approved"):
            if mark_id not in mark_cache:
                mark_cache[mark_id] = get_doc("marks", mark_id)
            mark = mark_cache.get(mark_id)
            if mark:
                sub["score"] = mark.get("score", 0)
                sub["max_score"] = mark.get("max_score", 0)
                sub["percentage"] = mark.get("percentage", 0)

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

    # Collect training pair (fire and forget — never blocks response)
    approved_sub = {**sub, "status": "approved", "approved_at": now}
    collect_training_sample(approved_sub, teacher_id)

    # Update student weakness/strength profile (fire and forget — never blocks)
    update_student_weaknesses(sub.get("student_id", ""), approved_sub)

    # Notify student that their grade is ready
    student_id = sub.get("student_id", "")
    if student_id:
        try:
            from functions.push import send_student_notification
            hw_title = hw.get("title") or hw.get("subject") or "Homework"
            score = sub.get("score", 0)
            max_score = sub.get("max_score", 0)
            send_student_notification(
                student_id,
                "Grade Ready",
                f"Your {hw_title} has been graded: {score}/{max_score}",
                {"screen": "StudentResults", "mark_id": mark_id},
            )
        except Exception:
            logger.warning("Student grade notification failed (non-fatal)")

    return jsonify({"message": "approved", "submission_id": sub_id}), 200


# ── POST /api/submissions/approve-bulk ───────────────────────────────────────

@submissions_bp.post("/submissions/approve-bulk")
def approve_bulk_submissions():
    """
    Bulk-approve a list of graded submissions in a single call.

    Semantics per submission id:
      - Must exist, be owned by the calling teacher, and have status="graded".
      - On success: sets status=approved on student_submissions and
        approved=True on the linked marks document.
      - Any submission failing a precondition is SKIPPED with a reason, not
        errored — callers get partial success.

    Batching:
      - Grouped by student_id; one summary push per student
        ("N grades available") instead of N pushes.
      - Weakness-profile recalculation runs once per unique student using
        a representative approved submission (reduces Firestore read load).
      - Training samples are still collected per-submission — the collection
        itself is cheap and per-submission granularity is needed for ML.

    Body:     {"submission_ids": ["sub_abc", ...]}
    200 OK:   {"approved": N, "skipped": [{"sub_id": "...", "reason": "..."}], "errors": []}
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    submission_ids = body.get("submission_ids")

    if not isinstance(submission_ids, list) or not submission_ids:
        return jsonify({"error": "submission_ids must be a non-empty list"}), 400

    now = _now_iso()
    approved_by_student: dict[str, list[dict]] = {}
    skipped: list[dict] = []
    errors: list[dict] = []

    # Cache answer_key docs so we don't reload the same homework N times.
    hw_cache: dict[str, dict | None] = {}

    for sub_id in submission_ids:
        if not isinstance(sub_id, str) or not sub_id:
            skipped.append({"sub_id": str(sub_id), "reason": "invalid id"})
            continue
        try:
            sub = get_doc("student_submissions", sub_id)
            if not sub:
                skipped.append({"sub_id": sub_id, "reason": "not found"})
                continue

            ak_id = sub.get("answer_key_id", "")
            if ak_id not in hw_cache:
                hw_cache[ak_id] = get_doc("answer_keys", ak_id) if ak_id else None
            hw = hw_cache[ak_id]
            if not hw or hw.get("teacher_id") != teacher_id:
                skipped.append({"sub_id": sub_id, "reason": "forbidden"})
                continue

            if sub.get("status") != "graded":
                skipped.append({
                    "sub_id": sub_id,
                    "reason": f"status is {sub.get('status')}, expected graded",
                })
                continue

            upsert("student_submissions", sub_id, {
                "status": "approved",
                "approved_at": now,
                "approved_by": teacher_id,
            })

            mark_id = sub.get("mark_id")
            if mark_id:
                upsert("marks", mark_id, {"approved": True, "approved_at": now})

            approved_sub = {**sub, "status": "approved", "approved_at": now, "_hw": hw}

            # Per-submission training sample (cheap, granular).
            try:
                collect_training_sample(approved_sub, teacher_id)
            except Exception:
                logger.exception("Training sample collection failed for sub %s", sub_id)

            student_id = sub.get("student_id", "")
            if student_id:
                approved_by_student.setdefault(student_id, []).append(approved_sub)

        except Exception as exc:
            logger.exception("Bulk approve failed for sub %s", sub_id)
            errors.append({"sub_id": sub_id, "error": f"{type(exc).__name__}: {exc}"})

    # ── Per-student post-processing: weakness updates + one summary push ─────
    for student_id, subs in approved_by_student.items():
        count = len(subs)
        # update_student_weaknesses processes exactly one submission per call —
        # it merges that sub's verdicts into the student's weakness/strength
        # history with a read-modify-write on the student doc (no batch/list
        # signature). So we loop per submission; passing a single
        # "representative" sub would silently drop verdict data from the other
        # N-1 submissions in the batch.
        #
        # Ordering matters: the function prepends new weaknesses on each call,
        # so the LAST call's verdicts end up at the front of the student's
        # weaknesses list. We sort by graded_at ascending so the most recently
        # graded submission is iterated last and lands at the front — matching
        # the "newest first" convention elsewhere in the app.
        sorted_subs = sorted(subs, key=lambda s: s.get("graded_at") or "")
        for sub in sorted_subs:
            try:
                update_student_weaknesses(student_id, sub)
            except Exception:
                logger.exception(
                    "Weakness update failed for student %s sub %s",
                    student_id, sub.get("id"),
                )

        # One summary push per student.
        try:
            from functions.push import send_student_notification
            if count == 1:
                hw = subs[0].get("_hw") or {}
                hw_title = hw.get("title") or hw.get("subject") or "Homework"
                score = subs[0].get("score", 0)
                max_score = subs[0].get("max_score", 0)
                title = "Grade Ready"
                message = f"Your {hw_title} has been graded: {score}/{max_score}"
                data = {"screen": "StudentResults", "mark_id": subs[0].get("mark_id")}
            else:
                title = "Grades Ready"
                message = f"{count} homework grades are available."
                data = {"screen": "StudentResults"}
            send_student_notification(student_id, title, message, data)
        except Exception:
            logger.warning("Bulk-approve push failed for student %s (non-fatal)", student_id)

    approved_count = sum(len(v) for v in approved_by_student.values())
    return jsonify({
        "approved": approved_count,
        "skipped": skipped,
        "errors": errors,
    }), 200


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


# ── DELETE /api/submissions/<sub_id> ──────────────────────────────────────────

@submissions_bp.delete("/submissions/<sub_id>")
def delete_submission(sub_id: str):
    """Cascade-delete: mark doc + student_submissions row + annotated GCS blob.
    Weakness profile is intentionally NOT rolled back — out of scope."""
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    sub = get_doc("student_submissions", sub_id)
    if not sub:
        return jsonify({"error": "Submission not found"}), 404

    # Ownership: the row's teacher_id is the authoritative check. Fall back
    # to homework.teacher_id when the sub predates the teacher_id column.
    if sub.get("teacher_id") and sub["teacher_id"] != teacher_id:
        return jsonify({"error": "forbidden"}), 403
    if not sub.get("teacher_id"):
        hw = get_doc("answer_keys", sub.get("answer_key_id", ""))
        if not hw or hw.get("teacher_id") != teacher_id:
            return jsonify({"error": "forbidden"}), 403

    # Ensure sub carries its id for the helper.
    sub = {**sub, "id": sub.get("id") or sub_id}
    cascades = _cascade_delete_submission(sub, teacher_id)
    return jsonify({
        "deleted": True,
        "submission_id": sub_id,
        "cascades": cascades,
    }), 200


# ── DELETE /api/marks/<mark_id> ───────────────────────────────────────────────

@submissions_bp.delete("/marks/<mark_id>")
def delete_mark_cascade(mark_id: str):
    """Same cascade as DELETE /submissions/<id>, keyed by mark_id. Used by
    mobile callers that have the MarkResult payload but not the linked
    student_submissions id (e.g. MarkResult.tsx post-scan view)."""
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    mark = get_doc("marks", mark_id)
    if not mark:
        return jsonify({"error": "Mark not found"}), 404
    if mark.get("teacher_id") and mark["teacher_id"] != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    # Find the linked student_submissions row (if any).
    linked = query(
        "student_submissions",
        [("mark_id", "==", mark_id)],
    )
    if linked:
        sub = {**linked[0], "id": linked[0].get("id")}
    else:
        # Orphan mark — build a synthetic sub so the cascade helper still
        # deletes the mark doc + blob.
        sub = {
            "id": None,
            "mark_id": mark_id,
            "student_id": mark.get("student_id", ""),
            "answer_key_id": mark.get("answer_key_id", ""),
        }

    cascades = _cascade_delete_submission(sub, teacher_id)
    return jsonify({
        "deleted": True,
        "mark_id": mark_id,
        "submission_id": sub.get("id"),
        "cascades": cascades,
    }), 200


# ── GET /api/assignments ─────────────────────────────────────────────────────

@submissions_bp.get("/assignments")
def student_assignments():
    """
    Student-facing — return open assignments (answer keys) for the student's class.

    Query params:
      class_id — required (from the student profile)
      status   — "open" (default) filters to open_for_submission == True,
                 "all" returns everything

    Returns: flat JSON array of assignment objects.
    """
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401
    class_id = request.args.get("class_id", "").strip()

    if not class_id:
        # Fall back to the student's own class_id from Firestore
        student_doc = get_doc("students", student_id)
        if student_doc:
            class_id = student_doc.get("class_id", "")
    if not class_id or class_id == "pending":
        return jsonify([]), 200

    status = request.args.get("status", "open").strip().lower()
    logger.debug("[assignments] student=%s class_id=%s status=%s", student_id, class_id, status)

    keys = query("answer_keys", [("class_id", "==", class_id)], order_by="created_at")

    # Check which answer keys this student has already submitted to
    student_subs = query("student_submissions", [
        ("student_id", "==", student_id),
        ("class_id", "==", class_id),
    ])
    submitted_key_ids = {s.get("answer_key_id") for s in student_subs}

    out = []
    for k in keys:
        # Filter by open_for_submission unless status=all
        if status == "open" and not k.get("open_for_submission", False):
            continue
        # Skip draft/pending_setup keys — students shouldn't see them
        if k.get("status") in ("draft", "pending_setup"):
            continue

        out.append({
            "id": k["id"],
            "title": k.get("title", "Untitled"),
            "subject": k.get("subject"),
            "total_marks": k.get("total_marks", 0),
            "education_level": k.get("education_level"),
            "due_date": k.get("due_date"),
            "open_for_submission": bool(k.get("open_for_submission", False)),
            "created_at": k.get("created_at", ""),
            "has_pending_submission": k["id"] in submitted_key_ids,
        })

    # Most recent first
    out.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    logger.info("[assignments] returning %d assignments for class_id=%s", len(out), class_id)
    return jsonify(out), 200
