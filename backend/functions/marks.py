# functions/marks.py
# Teacher mark management endpoint.
#
# PUT /api/marks/{mark_id} — update score, feedback, approve

from __future__ import annotations

import json
import logging
from datetime import datetime

import azure.functions as func

from shared.auth import require_auth, require_role
from shared.cosmos_client import get_item, query_items, upsert_item
from shared.push_client import send_push_notification

logger = logging.getLogger(__name__)


def _ok(body: dict, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(body, default=str), status_code=status, mimetype="application/json"
    )


def _err(message: str, status: int = 400) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({"error": message}), status_code=status, mimetype="application/json"
    )


# ── GET /api/marks/{mark_id} ─────────────────────────────────────────────────

async def handle_mark_get(req: func.HttpRequest) -> func.HttpResponse:
    """Return a single mark document by ID.

    GET /api/marks/{mark_id}

    Accepts teacher JWT (for grading review) or student JWT (for feedback view).
    Student may only fetch their own marks.
    """
    try:
        user = require_auth(req)
    except ValueError as exc:
        return _err(str(exc), status=401)

    mark_id: str = req.route_params.get("mark_id", "").strip()
    if not mark_id:
        return _err("mark_id is required in the URL path")

    results = await query_items(
        "marks",
        "SELECT * FROM c WHERE c.id = @id",
        [{"name": "@id", "value": mark_id}],
    )
    if not results:
        return _err("Mark not found.", status=404)

    mark_doc = results[0]

    # Students may only see their own approved marks
    if user.get("role") == "student":
        if mark_doc.get("student_id") != user["id"]:
            return _err("Not authorised.", status=403)
        if not mark_doc.get("approved", False):
            return _err("Mark not yet released.", status=403)

    return _ok(mark_doc)


# ── POST /api/marks/approve-bulk ─────────────────────────────────────────────

async def handle_marks_approve_bulk(req: func.HttpRequest) -> func.HttpResponse:
    """Approve multiple marks in a single call.

    POST /api/marks/approve-bulk

    Request headers: Authorization: Bearer <teacher_jwt>

    Request body:
        { "mark_ids": ["id1", "id2", ...] }

    Marks that are already approved are skipped (idempotent).
    Push notifications are sent to students for newly approved marks.
    Response 200: { "approved_count": n, "skipped_count": n }
    """
    try:
        user = require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    mark_ids: list = body.get("mark_ids", [])
    if not mark_ids or not isinstance(mark_ids, list):
        return _err("mark_ids must be a non-empty list")

    approved_count = 0
    skipped_count = 0
    now = datetime.utcnow().isoformat()

    for mark_id in mark_ids:
        try:
            results = await query_items(
                "marks",
                "SELECT * FROM c WHERE c.id = @id",
                [{"name": "@id", "value": mark_id}],
            )
            if not results:
                skipped_count += 1
                continue

            mark_doc = results[0]
            was_approved = mark_doc.get("approved", False)

            if was_approved:
                skipped_count += 1
                continue

            mark_doc["approved"] = True
            mark_doc["approved_at"] = now

            score = mark_doc.get("score", 0)
            max_score = mark_doc.get("max_score", 0)
            mark_doc["percentage"] = round(score / max_score * 100, 1) if max_score > 0 else 0.0

            await upsert_item("marks", mark_doc)
            approved_count += 1

            # Push notification
            try:
                student_id = mark_doc.get("student_id", "")
                class_id = mark_doc.get("class_id")
                student_doc = None
                if class_id and student_id:
                    try:
                        student_doc = await get_item("students", student_id, class_id)
                    except Exception:
                        pass
                if not student_doc:
                    sr = await query_items(
                        "students",
                        "SELECT * FROM c WHERE c.id = @id",
                        [{"name": "@id", "value": student_id}],
                    )
                    student_doc = sr[0] if sr else None

                push_token = (student_doc or {}).get("push_token")
                if push_token:
                    ak_results = await query_items(
                        "answer_keys",
                        "SELECT c.title, c.subject FROM c WHERE c.id = @id",
                        [{"name": "@id", "value": mark_doc.get("answer_key_id", "")}],
                    )
                    ak_title = ""
                    if ak_results:
                        ak = ak_results[0]
                        ak_title = ak.get("title") or ak.get("subject", "assignment")
                    await send_push_notification(
                        push_token,
                        title="Grade received",
                        body=f"{ak_title}: {score}/{max_score}",
                        data={"mark_id": mark_id},
                    )
            except Exception as exc:
                logger.warning("approve_bulk: push notify failed for %s: %s", mark_id, exc)

        except Exception as exc:
            logger.warning("approve_bulk: failed to approve mark %s: %s", mark_id, exc)
            skipped_count += 1

    return _ok({"approved_count": approved_count, "skipped_count": skipped_count})


# ── PUT /api/marks/{mark_id} ──────────────────────────────────────────────────

async def handle_mark_update(req: func.HttpRequest) -> func.HttpResponse:
    """Teacher reviews and optionally approves a student submission.

    PUT /api/marks/{mark_id}

    Request headers: Authorization: Bearer <teacher_jwt>

    Request body (all fields optional — only provided fields are updated):
        {
          "score":      17.0,
          "max_score":  20.0,
          "feedback":   "Good effort on questions 1–15.",
          "approved":   true
        }

    Response 200: updated mark document

    Side effect: if approved changes to true, a push notification is sent
    to the student (if they have a push_token registered).
    """
    try:
        user = require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    mark_id: str = req.route_params.get("mark_id", "").strip()
    if not mark_id:
        return _err("mark_id is required in the URL path")

    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    # Load mark — cross-partition since we only have mark_id
    results = await query_items(
        "marks",
        "SELECT * FROM c WHERE c.id = @id",
        [{"name": "@id", "value": mark_id}],
    )
    if not results:
        return _err("Mark not found.", status=404)

    mark_doc: dict = results[0]

    was_approved: bool = mark_doc.get("approved", False)

    # Apply updates — only fields present in body are changed
    if "score" in body:
        mark_doc["score"] = float(body["score"])
    if "max_score" in body:
        mark_doc["max_score"] = float(body["max_score"])
    if "feedback" in body:
        mark_doc["feedback"] = body["feedback"]
    if "approved" in body:
        mark_doc["approved"] = bool(body["approved"])
    # Per-question verdicts with per-question feedback (teacher edits)
    if "verdicts" in body:
        mark_doc["verdicts"] = body["verdicts"]
        # Recompute total from edited per-question marks
        try:
            mark_doc["score"] = sum(float(v.get("awarded_marks", 0)) for v in body["verdicts"])
            mark_doc["max_score"] = sum(float(v.get("max_marks", 0)) for v in body["verdicts"])
        except (TypeError, ValueError):
            pass
    # Overall feedback stored separately from per-question feedback
    if "overall_feedback" in body:
        mark_doc["feedback"] = body["overall_feedback"]
    if "manually_edited" in body:
        mark_doc["manually_edited"] = bool(body["manually_edited"])

    # Recompute percentage whenever score/max_score are set
    score = mark_doc.get("score", 0)
    max_score = mark_doc.get("max_score", 0)
    mark_doc["percentage"] = round(score / max_score * 100, 1) if max_score > 0 else 0.0

    # Stamp approved_at when approval changes to True
    now_approved: bool = mark_doc.get("approved", False)
    if now_approved and not was_approved:
        mark_doc["approved_at"] = datetime.utcnow().isoformat()

    await upsert_item("marks", mark_doc)

    # Push notification to student when newly approved
    if now_approved and not was_approved:
        try:
            student_id = mark_doc.get("student_id", "")
            class_id = mark_doc.get("class_id")
            student_doc = None
            if class_id and student_id:
                try:
                    student_doc = await get_item("students", student_id, class_id)
                except Exception:
                    pass
            if not student_doc:
                sr = await query_items(
                    "students",
                    "SELECT * FROM c WHERE c.id = @id",
                    [{"name": "@id", "value": student_id}],
                )
                student_doc = sr[0] if sr else None

            push_token = (student_doc or {}).get("push_token")
            if push_token:
                ak_results = await query_items(
                    "answer_keys",
                    "SELECT c.title, c.subject FROM c WHERE c.id = @id",
                    [{"name": "@id", "value": mark_doc.get("answer_key_id", "")}],
                )
                ak_title = ""
                if ak_results:
                    ak = ak_results[0]
                    ak_title = ak.get("title") or ak.get("subject", "assignment")
                await send_push_notification(
                    push_token,
                    title="Grade received",
                    body=f"{ak_title}: {score}/{max_score}",
                    data={"mark_id": mark_id},
                )
        except Exception as exc:
            logger.warning("mark_update: push notify student failed: %s", exc)

    return _ok(mark_doc)
