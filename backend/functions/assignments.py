# functions/assignments.py
# GET /api/assignments — student-facing: list open assignments for a class

from __future__ import annotations

import json
import logging

import azure.functions as func

from shared.auth import require_role
from shared.cosmos_client import query_items

logger = logging.getLogger(__name__)


async def handle_assignments(req: func.HttpRequest) -> func.HttpResponse:
    """GET /api/assignments?class_id=...

    Returns all AnswerKey documents for the class where open_for_submission=true.
    Each entry is enriched with has_pending_submission (True if this student
    already has an unapproved mark against this answer key).

    Requires: Authorization: Bearer <student_jwt>
    Query params: class_id (required)
    """
    try:
        user = require_role(req, "student")
    except ValueError as exc:
        return func.HttpResponse(
            json.dumps({"error": str(exc)}),
            status_code=401,
            mimetype="application/json",
        )

    class_id = req.params.get("class_id")
    if not class_id:
        return func.HttpResponse(
            '{"error": "class_id query param required"}',
            status_code=400,
            mimetype="application/json",
        )

    student_id: str = user["id"]

    # Load all open answer keys for this class — partition-scoped (fast)
    open_keys = await query_items(
        container_name="answer_keys",
        query="SELECT * FROM c WHERE c.class_id = @cid AND c.open_for_submission = true",
        parameters=[{"name": "@cid", "value": class_id}],
        partition_key=class_id,
    )

    if not open_keys:
        return func.HttpResponse("[]", status_code=200, mimetype="application/json")

    # Load pending (unapproved) student submissions in one partition-scoped query
    pending_marks = await query_items(
        container_name="marks",
        query=(
            "SELECT c.answer_key_id FROM c "
            "WHERE c.student_id = @sid "
            "AND c.source = 'student_submission' "
            "AND (NOT IS_DEFINED(c.approved) OR c.approved = false)"
        ),
        parameters=[{"name": "@sid", "value": student_id}],
        partition_key=student_id,
    )
    pending_ids: set[str] = {m["answer_key_id"] for m in pending_marks}

    assignments = []
    for ak in open_keys:
        assignments.append({
            "id": ak["id"],
            "title": ak.get("title") or ak.get("subject", ""),
            "subject": ak.get("subject", ""),
            "total_marks": ak.get("total_marks"),
            "education_level": ak.get("education_level"),
            "created_at": ak.get("created_at"),
            "has_pending_submission": ak["id"] in pending_ids,
        })

    return func.HttpResponse(
        json.dumps(assignments, default=str),
        status_code=200,
        mimetype="application/json",
    )
