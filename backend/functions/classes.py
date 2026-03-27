# functions/classes.py
# GET  /api/classes  — list all classes for the authenticated teacher
# POST /api/classes  — create a new class

from __future__ import annotations

import logging

import azure.functions as func

from shared.cosmos_client import query_items, upsert_item
from shared.models import Class, EducationLevel

logger = logging.getLogger(__name__)

bp = func.Blueprint()


async def handle_classes(req: func.HttpRequest) -> func.HttpResponse:
    """Public async handler — called from function_app.py @app.route decorator."""
    return classes(req)


@bp.route(route="classes", methods=["GET", "POST"])
def classes(req: func.HttpRequest) -> func.HttpResponse:
    """
    GET:  Returns all classes owned by the authenticated teacher.
    POST: Creates a new class. Body: { name: str, education_level: str }
    """
    # TODO: extract teacher_id from validated JWT bearer token
    teacher_id = _get_teacher_id(req)
    if not teacher_id:
        return func.HttpResponse('{"error": "Unauthorized"}', status_code=401, mimetype="application/json")

    if req.method == "GET":
        return _list_classes(teacher_id)
    return _create_class(req, teacher_id)


def _list_classes(teacher_id: str) -> func.HttpResponse:
    """Return all classes for a teacher, ordered by created_at descending."""
    # TODO: implement query — SELECT * FROM c WHERE c.teacher_id = @teacher_id
    # TODO: order by c.created_at DESC
    results = query_items(
        container_name="classes",
        query="SELECT * FROM c WHERE c.teacher_id = @teacher_id",
        parameters=[{"name": "@teacher_id", "value": teacher_id}],
        partition_key=teacher_id,
    )
    import json
    return func.HttpResponse(json.dumps(results), status_code=200, mimetype="application/json")


def _create_class(req: func.HttpRequest, teacher_id: str) -> func.HttpResponse:
    """Create a new Class document in Cosmos."""
    # TODO: parse and validate request body
    # TODO: validate education_level is a valid EducationLevel enum value
    # TODO: create Class model, upsert to Cosmos, return 201 with the new document
    import json
    try:
        body = req.get_json()
        new_class = Class(
            teacher_id=teacher_id,
            name=body["name"],
            education_level=EducationLevel(body["education_level"]),
        )
        upsert_item("classes", new_class.model_dump())
        return func.HttpResponse(
            new_class.model_dump_json(),
            status_code=201,
            mimetype="application/json",
        )
    except (KeyError, ValueError) as e:
        return func.HttpResponse(
            f'{{"error": "Invalid request: {e}"}}',
            status_code=400,
            mimetype="application/json",
        )


def _get_teacher_id(req: func.HttpRequest) -> str | None:
    """Extract and validate teacher_id from JWT in Authorization header."""
    # TODO: implement JWT validation using APP_JWT_SECRET
    # TODO: return None if token is missing, expired, or invalid
    return req.headers.get("X-Teacher-Id")  # placeholder — replace with real JWT validation
