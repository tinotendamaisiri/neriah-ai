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
from shared.observability import instrument_route
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
@instrument_route("submissions.list", "submissions")
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
@instrument_route("submissions.approve", "submissions")
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

    # Notify student that their grade is ready. Dispatched by source so
    # each channel gets the right reply: app push (always), WhatsApp
    # image (STUDENT_WHATSAPP), Resend email (EMAIL_SUBMISSION). The
    # WhatsApp/email paths used to fire inline at submission time, before
    # the teacher had even seen the grade — moved here so all channels
    # honour the "teacher approves first" policy uniformly.
    student_id = sub.get("student_id", "")
    if student_id:
        _dispatch_student_reply(
            student_id=student_id,
            mark_id=mark_id,
            hw=hw,
            sub=sub,
        )

    return jsonify({"message": "approved", "submission_id": sub_id}), 200


def _dispatch_student_reply(
    *,
    student_id: str,
    mark_id: str | None,
    hw: dict,
    sub: dict,
) -> None:
    """Fan out the post-approval reply across every channel the student
    is reachable on. Each branch is best-effort — one failing channel
    must not block the others or the approval flow itself."""
    hw_title = hw.get("title") or hw.get("subject") or "Homework"
    score = sub.get("score", 0)
    max_score = sub.get("max_score", 0)

    # 1. App push.
    try:
        from functions.push import send_student_notification
        send_student_notification(
            student_id,
            "Grade Ready",
            f"Your {hw_title} has been graded: {score}/{max_score}",
            {"screen": "StudentResults", "mark_id": mark_id},
        )
    except Exception:
        logger.warning("dispatch: app push failed for student %s (non-fatal)", student_id)

    _dispatch_student_reply_secondary_channels(
        student_id=student_id, mark_id=mark_id, hw=hw, sub=sub,
    )


def _dispatch_student_reply_secondary_channels(
    *,
    student_id: str,
    mark_id: str | None,
    hw: dict,
    sub: dict,
) -> None:
    """WhatsApp + email branches only. Bulk-approve uses this directly
    (without the push) because the bulk handler emits a single summary
    push covering all approved homework, not one push per submission."""
    hw_title = hw.get("title") or hw.get("subject") or "Homework"
    score = sub.get("score", 0)
    max_score = sub.get("max_score", 0)

    if not mark_id:
        return
    mark = get_doc("marks", mark_id)
    if not mark:
        return
    student = get_doc("students", student_id)
    if not student:
        return

    source = mark.get("source", "")

    # 2. WhatsApp reply — fires only for STUDENT_WHATSAPP marks. The
    #    student's phone is the canonical address; we previously sent
    #    the marked image inline from whatsapp.py before approval, which
    #    leaked AI grades to students before the teacher could intervene.
    if source == "student_whatsapp":
        try:
            from shared.whatsapp_client import send_image
            phone = student.get("phone")
            annotated_urls = mark.get("annotated_urls") or []
            marked_url = annotated_urls[0] if annotated_urls else mark.get("marked_image_url")
            if phone and marked_url:
                pct = mark.get("percentage", 0)
                caption = f"{hw_title}: {score}/{max_score} ({int(round(pct))}%)"
                send_image(phone, marked_url, caption)
        except Exception:
            logger.warning("dispatch: WhatsApp send failed for student %s (non-fatal)", student_id)

    # 3. Email reply — fires only for EMAIL_SUBMISSION marks. Pulls the
    #    annotated page bytes straight from the marked-images bucket
    #    (deterministic blob path: {mark_id}/annotated_{i}.jpg) so we
    #    can attach them directly rather than send a link the student
    #    has to click.
    if source == "email_submission":
        try:
            from shared.email_client import send_grade_reply
            from shared.gcs_client import download_bytes

            email_addr = student.get("email")
            if not email_addr:
                return
            annotated_urls = mark.get("annotated_urls") or []
            page_count = mark.get("page_count", len(annotated_urls)) or 1

            attachments: list[tuple[str, bytes, str]] = []
            for i in range(page_count):
                blob = f"{mark_id}/annotated_{i}.jpg"
                try:
                    data = download_bytes(settings.GCS_BUCKET_MARKED, blob)
                except Exception:
                    logger.warning(
                        "dispatch: missing annotated blob %s/%s — skipping page %d",
                        settings.GCS_BUCKET_MARKED, blob, i,
                    )
                    continue
                attachments.append((f"page_{i + 1}.jpg", data, "image/jpeg"))

            student_full = f"{student.get('first_name','')} {student.get('surname','')}".strip()
            send_grade_reply(
                student_email=email_addr,
                student_name=student_full or "Student",
                score=score,
                max_score=max_score,
                percentage=mark.get("percentage", 0),
                verdicts=mark.get("verdicts") or [],
                annotated_pages=attachments,
                answer_key_title=hw_title,
            )
        except Exception:
            logger.warning("dispatch: email send failed for student %s (non-fatal)", student_id)


# ── POST /api/submissions/approve-bulk ───────────────────────────────────────

@submissions_bp.post("/submissions/approve-bulk")
@instrument_route("submissions.approve_bulk", "submissions")
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

        # WhatsApp + email replies, per submission. We fan out per-sub
        # rather than one summary so the student gets the actual graded
        # image attached for each homework — same UX as one-by-one
        # approval. Loops in graded_at ascending order so the most
        # recent grade arrives last.
        for sub in sorted_subs:
            hw = sub.get("_hw") or {}
            _dispatch_student_reply_secondary_channels(
                student_id=student_id,
                mark_id=sub.get("mark_id"),
                hw=hw,
                sub=sub,
            )

    approved_count = sum(len(v) for v in approved_by_student.values())
    return jsonify({
        "approved": approved_count,
        "skipped": skipped,
        "errors": errors,
    }), 200


# ── PATCH /api/submissions/<sub_id>/override ──────────────────────────────────

@submissions_bp.patch("/submissions/<sub_id>/override")
@instrument_route("submissions.override", "submissions")
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
@instrument_route("submissions.delete", "submissions")
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
@instrument_route("marks.delete_cascade", "submissions")
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
@instrument_route("assignments.list", "submissions")
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

    status_filter = request.args.get("status", "open").strip().lower()
    logger.info(
        "[assignments] student=%s class_id=%s status_filter=%s",
        student_id, class_id, status_filter,
    )

    keys = query("answer_keys", [("class_id", "==", class_id)], order_by="created_at")

    # Diagnostic: surface every answer-key state we found so a missing-count
    # report can be debugged from the function logs without re-querying Firestore.
    status_counts: dict[str, int] = {}
    for k in keys:
        status_counts[k.get("status") or "<none>"] = status_counts.get(k.get("status") or "<none>", 0) + 1
    logger.info(
        "[assignments] class_id=%s total_keys=%d statuses=%s",
        class_id, len(keys), status_counts,
    )

    # Check which answer keys this student has already submitted to
    student_subs = query("student_submissions", [
        ("student_id", "==", student_id),
        ("class_id", "==", class_id),
    ])
    submitted_key_ids = {s.get("answer_key_id") for s in student_subs}

    out = []
    skipped_by_reason: dict[str, int] = {}
    for k in keys:
        key_status = (k.get("status") or "").lower()

        # Always skip "draft" — these are teacher work-in-progress that hasn't
        # been published yet. Including them would leak unfinished work.
        if key_status == "draft":
            skipped_by_reason["draft"] = skipped_by_reason.get("draft", 0) + 1
            continue

        # Filter by open_for_submission ONLY when caller asked for "open".
        # status=all should return everything else (including pending_setup
        # so the student can see "Coming soon" homeworks the teacher has
        # announced but not yet finished setting up).
        if status_filter == "open" and not k.get("open_for_submission", False):
            skipped_by_reason["closed_or_unopened"] = skipped_by_reason.get("closed_or_unopened", 0) + 1
            continue

        out.append({
            "id": k["id"],
            "title": k.get("title", "Untitled"),
            "subject": k.get("subject"),
            "total_marks": k.get("total_marks", 0),
            "education_level": k.get("education_level"),
            "due_date": k.get("due_date"),
            "open_for_submission": bool(k.get("open_for_submission", False)),
            # Surface the answer-key lifecycle state so the client can render
            # an appropriate badge: pending_setup → "Coming soon",
            # closed → "Closed", open → submit button.
            "status": k.get("status"),
            "created_at": k.get("created_at", ""),
            "has_pending_submission": k["id"] in submitted_key_ids,
        })

    # Most recent first
    out.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    logger.info(
        "[assignments] returning %d/%d for class_id=%s skipped=%s",
        len(out), len(keys), class_id, skipped_by_reason,
    )
    return jsonify(out), 200


# ── POST /api/submissions/student ────────────────────────────────────────────

@submissions_bp.post("/submissions/student")
@instrument_route("submissions.student_create", "submissions")
def student_create_submission():
    """
    Student-channel submission. Mobile uploads pages via multipart with
    fields: student_id, class_id, answer_key_id, source, images[].

    Mirrors the email_poller pipeline so the App channel produces the
    same Mark + student_submissions shape as the WhatsApp/email channels:
    grade immediately on intake; teacher must approve before the student
    sees the result. Without this row the Results tab is permanently
    empty for app-submitted homework.
    """
    student_id_jwt, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    student_id = (request.form.get("student_id") or "").strip()
    class_id = (request.form.get("class_id") or "").strip()
    answer_key_id = (request.form.get("answer_key_id") or "").strip()

    if student_id and student_id != student_id_jwt:
        return jsonify({"error": "forbidden"}), 403
    student_id = student_id or student_id_jwt

    if not class_id or not answer_key_id:
        return jsonify({"error": "class_id and answer_key_id are required"}), 400

    student = get_doc("students", student_id)
    if not student:
        return jsonify({"error": "Student not found"}), 404

    answer_key = get_doc("answer_keys", answer_key_id)
    if not answer_key:
        return jsonify({"error": "Answer key not found"}), 404
    if answer_key.get("class_id") != class_id:
        return jsonify({"error": "Answer key does not belong to this class"}), 400
    if not answer_key.get("open_for_submission", False):
        return jsonify({"error": "This homework is not currently accepting submissions."}), 400
    if not answer_key.get("questions"):
        return jsonify({"error": "Marking scheme not ready — please ask your teacher."}), 400

    # One active submission per (student, answer_key). Mobile shows a
    # "Withdraw and resubmit" UI on 409.
    existing = query("student_submissions", [
        ("student_id", "==", student_id),
        ("answer_key_id", "==", answer_key_id),
    ]) or []
    if existing:
        return jsonify({
            "error": "You already have a submission for this assignment. Withdraw it first to resubmit."
        }), 409

    files = request.files.getlist("images")
    if not files:
        return jsonify({"error": "No pages attached"}), 400
    if len(files) > 5:
        return jsonify({"error": "You can submit between 1 and 5 pages."}), 400

    pages_bytes: list[bytes] = []
    for f in files:
        data = f.read()
        if data:
            pages_bytes.append(data)
    if not pages_bytes:
        return jsonify({"error": "No pages attached"}), 400

    from shared.orientation import normalize_to_upright
    pages_bytes = [normalize_to_upright(p) for p in pages_bytes]

    from shared.gemma_client import (
        check_image_quality_strict,
        grade_submission_strict_multi,
    )
    try:
        quality = check_image_quality_strict(pages_bytes[0])
    except Exception:
        quality = None
    if quality is not None and not quality.get("pass", True):
        return jsonify({
            "error": quality.get("suggestion") or quality.get("reason")
                     or "First page is unreadable. Please retake the photo."
        }), 422

    education_level = answer_key.get("education_level") or "Form 4"
    try:
        raw_verdicts = grade_submission_strict_multi(
            pages_bytes, answer_key, education_level,
        )
    except Exception:
        logger.exception(
            "student-app: grading failed for student=%s ak=%s",
            student_id, answer_key_id,
        )
        return jsonify({
            "error": "Grading temporarily failed. Please try again in a few minutes."
        }), 503

    # Cap awarded marks against the answer key + drop hallucinated questions.
    questions = answer_key.get("questions", []) or []
    max_per_q: dict[int, float] = {}
    for q in questions:
        try:
            qn = int(q.get("question_number"))
            max_per_q[qn] = float(q.get("marks", 0) or 0)
        except (TypeError, ValueError):
            continue
    total_max = float(answer_key.get("total_marks") or sum(max_per_q.values()) or 1)

    cleaned: list[dict] = []
    for v in raw_verdicts:
        if not isinstance(v, dict):
            continue
        try:
            qn = int(v.get("question_number"))
        except (TypeError, ValueError):
            continue
        if qn not in max_per_q:
            continue
        cap = max_per_q[qn]
        try:
            awarded = max(0.0, min(float(v.get("awarded_marks", 0) or 0), cap))
        except (TypeError, ValueError):
            awarded = 0.0
        v["awarded_marks"] = awarded
        v["max_marks"] = cap
        v["page_index"] = int(v.get("page_index", 0) or 0)
        cleaned.append(v)
    cleaned.sort(key=lambda v: int(v["question_number"]))

    score = min(sum(v["awarded_marks"] for v in cleaned), total_max)
    percentage = round(score / total_max * 100, 1) if total_max else 0.0

    from shared.annotator import annotate_pages
    from shared.gcs_client import generate_signed_url, upload_bytes
    from shared.models import GradingVerdict, Mark, MarkSource

    verdicts_pydantic = [GradingVerdict(**v) for v in cleaned]
    annotated_pages = annotate_pages(pages_bytes, cleaned)

    import uuid as _uuid
    mark_id = str(_uuid.uuid4())
    page_urls: list[str] = []
    annotated_urls: list[str] = []
    for i, page_bytes in enumerate(pages_bytes):
        orig_blob = f"submissions/{student_id}/{mark_id}/page_{i}.jpg"
        upload_bytes(settings.GCS_BUCKET_SUBMISSIONS, orig_blob, page_bytes, public=False)
        page_urls.append(generate_signed_url(
            settings.GCS_BUCKET_SUBMISSIONS, orig_blob, expiry_minutes=60 * 24 * 7,
        ))
    for i, ann_bytes in enumerate(annotated_pages):
        ann_blob = f"{mark_id}/annotated_{i}.jpg"
        upload_bytes(settings.GCS_BUCKET_MARKED, ann_blob, ann_bytes, public=False)
        annotated_urls.append(generate_signed_url(
            settings.GCS_BUCKET_MARKED, ann_blob, expiry_minutes=60 * 24 * 7,
        ))

    mark = Mark(
        id=mark_id,
        student_id=student_id,
        class_id=class_id,
        answer_key_id=answer_key_id,
        teacher_id=answer_key.get("teacher_id", ""),
        score=score,
        max_score=total_max,
        percentage=percentage,
        verdicts=verdicts_pydantic,
        marked_image_url=annotated_urls[0] if annotated_urls else None,
        source=MarkSource.STUDENT_SUBMISSION,
        approved=False,
        page_count=len(pages_bytes),
        page_urls=page_urls,
        annotated_urls=annotated_urls,
    )
    upsert("marks", mark.id, mark.model_dump())

    sub_id = f"sub_{_uuid.uuid4().hex[:12]}"
    now = _now_iso()
    upsert("student_submissions", sub_id, {
        "id": sub_id,
        "student_id": student_id,
        "class_id": class_id,
        "answer_key_id": answer_key_id,
        "teacher_id": answer_key.get("teacher_id", ""),
        "mark_id": mark.id,
        "status": "graded",
        "source": MarkSource.STUDENT_SUBMISSION,
        "image_urls": list(annotated_urls),
        "submitted_at": now,
        "graded_at": now,
        "score": score,
        "max_score": total_max,
        "percentage": percentage,
    })

    return jsonify({"mark_id": mark.id}), 200


# ── GET /api/submissions/student/<student_id> ────────────────────────────────

@submissions_bp.get("/submissions/student/<student_id>")
@instrument_route("submissions.student_list", "submissions")
def student_submissions_list(student_id: str):
    """
    Student fetches their own submissions (pending + approved) for the
    Results tab. Only the calling student may read their own list.

    Status mapping (backend → FE): teacher must approve before a student
    sees a grade, so only backend `approved` rows surface as `graded`;
    everything else (pending, grading, graded[unapproved], error) is
    rendered as `pending` so the student can still see and optionally
    withdraw it.
    """
    req_student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    if req_student_id != student_id:
        return jsonify({"error": "forbidden"}), 403

    # Wrap in try/except so a missing index (or any other Firestore hiccup)
    # on student_submissions does NOT take down the whole Results screen —
    # the synthesised entries from approved_marks below are enough on their
    # own to populate the screen with graded work. A 500 here was returning
    # an empty Results tab even when the student had real graded marks.
    try:
        subs = query(
            "student_submissions",
            [("student_id", "==", student_id)],
            order_by="submitted_at",
            direction="DESCENDING",
        )
    except Exception:
        logger.warning(
            "submissions.student_list: student_submissions query failed for %s — "
            "falling back to approved-marks only",
            student_id,
            exc_info=True,
        )
        subs = []

    # Also pull every approved mark for this student. The student_submissions
    # collection only has companion rows for the channels that explicitly
    # write them (App, WhatsApp via the recently-added upsert, email_poller).
    # Teacher-scan marks (`/api/mark` POST) and any pre-existing approved
    # marks have no `student_submissions` row, so the Results tab would show
    # them as missing even though the Home tab "Recent Feedback" surfaces
    # them via `/marks/student/{id}`. Merging here keeps both views in sync
    # without changing the writers.
    approved_marks = query(
        "marks",
        [("student_id", "==", student_id), ("approved", "==", True)],
        order_by="timestamp",
        direction="DESCENDING",
    )

    ak_cache: dict[str, dict | None] = {}
    mark_cache: dict[str, dict | None] = {}
    out: list[dict] = []
    seen_mark_ids: set[str] = set()

    for sub in subs:
        backend_status = (sub.get("status") or "").lower()
        fe_status = "graded" if backend_status == "approved" else "pending"

        ak_id = sub.get("answer_key_id", "")
        if ak_id and ak_id not in ak_cache:
            ak_cache[ak_id] = get_doc("answer_keys", ak_id)
        ak = ak_cache.get(ak_id) or {}
        title = ak.get("title") or ak.get("subject") or "Submission"

        sub_mark_id = sub.get("mark_id", "")
        if sub_mark_id:
            seen_mark_ids.add(sub_mark_id)

        item: dict = {
            "mark_id": sub_mark_id,
            "answer_key_id": ak_id,
            "answer_key_title": title,
            "status": fe_status,
            "submitted_at": sub.get("submitted_at", ""),
        }

        if fe_status == "graded":
            if sub_mark_id and sub_mark_id not in mark_cache:
                mark_cache[sub_mark_id] = get_doc("marks", sub_mark_id)
            mark = mark_cache.get(sub_mark_id) or {}
            item["graded_at"] = sub.get("approved_at") or sub.get("graded_at")
            item["score"] = mark.get("score", sub.get("score", 0))
            item["max_score"] = mark.get("max_score", sub.get("max_score", 0))
            pct = mark.get("percentage", sub.get("percentage"))
            if pct is not None:
                item["percentage"] = pct
            marked_url = mark.get("marked_image_url")
            if not marked_url:
                annotated = mark.get("annotated_urls") or []
                if annotated:
                    marked_url = annotated[0]
            if marked_url:
                item["marked_image_url"] = marked_url

        out.append(item)

    # Synthesize a "graded" entry for every approved mark that isn't already
    # represented by a student_submissions row.
    for mark in approved_marks:
        mid = mark.get("id") or mark.get("mark_id") or ""
        if not mid or mid in seen_mark_ids:
            continue
        ak_id = mark.get("answer_key_id", "")
        if ak_id and ak_id not in ak_cache:
            ak_cache[ak_id] = get_doc("answer_keys", ak_id)
        ak = ak_cache.get(ak_id) or {}
        title = ak.get("title") or ak.get("subject") or "Submission"
        item = {
            "mark_id": mid,
            "answer_key_id": ak_id,
            "answer_key_title": title,
            "status": "graded",
            "submitted_at": mark.get("timestamp", ""),
            "graded_at": mark.get("approved_at") or mark.get("timestamp", ""),
            "score": mark.get("score", 0),
            "max_score": mark.get("max_score", 0),
        }
        pct = mark.get("percentage")
        if pct is not None:
            item["percentage"] = pct
        marked_url = mark.get("marked_image_url")
        if not marked_url:
            annotated = mark.get("annotated_urls") or []
            if annotated:
                marked_url = annotated[0]
        if marked_url:
            item["marked_image_url"] = marked_url
        out.append(item)

    # Sort merged list newest-first by whichever timestamp is present.
    out.sort(key=lambda r: r.get("submitted_at") or "", reverse=True)

    return jsonify(out), 200


# ── DELETE /api/submissions/student/<mark_id> ────────────────────────────────

@submissions_bp.delete("/submissions/student/<mark_id>")
@instrument_route("submissions.student_withdraw", "submissions")
def student_withdraw_submission(mark_id: str):
    """
    Student withdraws their own pending submission, keyed by mark_id
    (the FE only carries the mark_id at this point). Cascade-deletes the
    student_submissions row + linked mark via the shared helper.

    Refuses if the teacher has already approved the grade — at that
    point the student has feedback and withdrawal is no longer valid.
    """
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    rows = query("student_submissions", [("mark_id", "==", mark_id)])
    if not rows:
        return jsonify({"error": "Submission not found"}), 404
    sub = rows[0]

    if sub.get("student_id") != student_id:
        return jsonify({"error": "forbidden"}), 403

    if (sub.get("status") or "").lower() == "approved":
        return jsonify({"error": "Already graded — cannot withdraw"}), 403

    sub_with_id = {**sub, "id": sub.get("id")}
    cascades = _cascade_delete_submission(
        sub_with_id, sub.get("teacher_id", "") or f"student:{student_id}",
    )
    return jsonify({"deleted": True, "mark_id": mark_id, "cascades": cascades}), 200
