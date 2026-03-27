# functions/students.py
# GET  /api/students?class_id=...  — list all students in a class
# POST /api/students               — add a student to a class

from __future__ import annotations

import logging

import azure.functions as func

from shared.cosmos_client import query_items, upsert_item
from shared.models import Student

logger = logging.getLogger(__name__)

bp = func.Blueprint()


async def handle_students(req: func.HttpRequest) -> func.HttpResponse:
    """Public async handler — called from function_app.py @app.route decorator."""
    return students(req)


@bp.route(route="students", methods=["GET", "POST"])
def students(req: func.HttpRequest) -> func.HttpResponse:
    """
    GET:  Returns all students in a class. Query param: class_id (required).
    POST: Adds a new student to a class. Body: { class_id: str, name: str, register_number?: str }
    """
    # TODO: extract teacher_id from JWT and verify they own the requested class
    if req.method == "GET":
        return _list_students(req)
    return _create_student(req)


def _list_students(req: func.HttpRequest) -> func.HttpResponse:
    """Return all students in a class, ordered by register_number or name."""
    # TODO: validate class_id param is present and non-empty
    # TODO: verify teacher owns this class before returning data
    import json
    class_id = req.params.get("class_id")
    if not class_id:
        return func.HttpResponse('{"error": "class_id query param required"}', status_code=400, mimetype="application/json")

    results = query_items(
        container_name="students",
        query="SELECT * FROM c WHERE c.class_id = @class_id",
        parameters=[{"name": "@class_id", "value": class_id}],
        partition_key=class_id,
    )
    return func.HttpResponse(json.dumps(results), status_code=200, mimetype="application/json")


def _create_student(req: func.HttpRequest) -> func.HttpResponse:
    """Add a single student to a class."""
    # TODO: validate body fields
    # TODO: check for duplicate register_number within the class
    # TODO: add student.id to the parent Class.student_ids list in Cosmos
    try:
        body = req.get_json()
        student = Student(
            class_id=body["class_id"],
            name=body["name"],
            register_number=body.get("register_number"),
        )
        upsert_item("students", student.model_dump())
        return func.HttpResponse(student.model_dump_json(), status_code=201, mimetype="application/json")
    except (KeyError, ValueError) as e:
        return func.HttpResponse(f'{{"error": "Invalid request: {e}"}}', status_code=400, mimetype="application/json")
