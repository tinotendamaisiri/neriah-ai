# functions/analytics.py
# GET /api/analytics?class_id=...   — class-level stats (average, distribution)
# GET /api/analytics?student_id=... — per-student mark history
#
# MVP: out of scope — these stubs exist so the blueprint registers and imports cleanly.

from __future__ import annotations

import logging

import azure.functions as func

from shared.cosmos_client import query_items

logger = logging.getLogger(__name__)

bp = func.Blueprint()


async def handle_analytics(req: func.HttpRequest) -> func.HttpResponse:
    """Public async handler — called from function_app.py @app.route decorator."""
    return analytics(req)


@bp.route(route="analytics", methods=["GET"])
def analytics(req: func.HttpRequest) -> func.HttpResponse:
    """
    Returns analytics aggregated from the marks container.
    Query params (one required):
        - class_id:   return class-level stats (average score, score distribution, top/bottom students)
        - student_id: return mark history for a single student (scores over time, per-subject breakdown)
    """
    # TODO: implement class-level analytics
    # TODO: implement per-student analytics
    # TODO: add caching — analytics are expensive to recompute on every request (consider Cosmos materialized views or a nightly aggregation function)

    class_id = req.params.get("class_id")
    student_id = req.params.get("student_id")

    if class_id:
        return _class_analytics(class_id)
    if student_id:
        return _student_analytics(student_id)

    return func.HttpResponse(
        '{"error": "Provide class_id or student_id query param"}',
        status_code=400,
        mimetype="application/json",
    )


def _class_analytics(class_id: str) -> func.HttpResponse:
    """
    Aggregate mark data for all students in a class.
    Returns: average_score, max_score, min_score, score_distribution (bucketed), student_summaries
    """
    # TODO: query all students in class, then all marks for those students
    # TODO: compute aggregate stats
    # TODO: MVP out of scope — return placeholder
    return func.HttpResponse(
        '{"message": "Class analytics not yet implemented (MVP out of scope)"}',
        status_code=200,
        mimetype="application/json",
    )


def _student_analytics(student_id: str) -> func.HttpResponse:
    """
    Return mark history for a single student across all answer keys.
    Returns: list of marks ordered by timestamp, trend line data
    """
    # TODO: query marks container for all marks WHERE student_id = @student_id
    # TODO: join with answer_keys to include subject names
    # TODO: MVP out of scope — return placeholder
    marks = query_items(
        container_name="marks",
        query="SELECT * FROM c WHERE c.student_id = @student_id ORDER BY c.timestamp DESC",
        parameters=[{"name": "@student_id", "value": student_id}],
        partition_key=student_id,
    )
    import json
    return func.HttpResponse(json.dumps({"marks": marks}), status_code=200, mimetype="application/json")
