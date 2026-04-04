# functions/students.py
# Teacher student management.
#
# GET    /api/students?class_id=... — list students in a class (teacher JWT)
# POST   /api/students              — add a student (teacher JWT)
# PUT    /api/students/{id}         — update a student (teacher JWT)
# DELETE /api/students/{id}         — delete a student (teacher JWT)
# POST   /api/students/batch        — bulk-add students to a class (teacher JWT)

from __future__ import annotations

import json
import logging
from typing import Optional

import azure.functions as func

from shared.auth import require_role
from shared.cosmos_client import delete_item, query_items, upsert_item
from shared.models import Student

logger = logging.getLogger(__name__)


def _ok(body, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(body, default=str), status_code=status, mimetype="application/json"
    )


def _err(message: str, status: int = 400) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({"error": message}), status_code=status, mimetype="application/json"
    )


# ── GET / POST /api/students ──────────────────────────────────────────────────

async def handle_students(req: func.HttpRequest) -> func.HttpResponse:
    """Route GET → list, POST → create."""
    if req.method == "GET":
        return await _list_students(req)
    return await _create_student(req)


async def _list_students(req: func.HttpRequest) -> func.HttpResponse:
    try:
        require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    class_id = req.params.get("class_id")
    if not class_id:
        return _err("class_id query param required")

    results = await query_items(
        container_name="students",
        query="SELECT * FROM c WHERE c.class_id = @class_id",
        parameters=[{"name": "@class_id", "value": class_id}],
        partition_key=class_id,
    )
    return _ok(results)


async def _create_student(req: func.HttpRequest) -> func.HttpResponse:
    try:
        require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    try:
        body = req.get_json()
        student = Student(
            class_id=body["class_id"],
            first_name=body["first_name"],
            surname=body["surname"],
            phone=body.get("phone"),
            register_number=body.get("register_number"),
        )
        await upsert_item("students", student.model_dump(mode="json"))
        return _ok(student.model_dump(mode="json"), status=201)
    except (KeyError, ValueError) as exc:
        return _err(f"Invalid request: {exc}")


# ── PUT /api/students/{id} ────────────────────────────────────────────────────

async def handle_student_update(req: func.HttpRequest) -> func.HttpResponse:
    """Update mutable fields on a student document.

    PUT /api/students/{student_id}
    Requires: Authorization: Bearer <teacher_jwt>
    Body (all optional): { first_name, surname, phone, register_number }

    Note: class_id cannot be changed (Cosmos partition key).
    """
    try:
        require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    student_id: str = req.route_params.get("student_id", "").strip()
    if not student_id:
        return _err("student_id is required in the URL path")

    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    # Cross-partition lookup — we don't know class_id from the URL
    results = await query_items(
        "students",
        "SELECT * FROM c WHERE c.id = @id",
        [{"name": "@id", "value": student_id}],
    )
    if not results:
        return _err("Student not found.", status=404)

    student_doc = results[0]

    for field in ("first_name", "surname", "phone", "register_number"):
        if field in body:
            student_doc[field] = body[field]

    await upsert_item("students", student_doc)
    return _ok(student_doc)


# ── DELETE /api/students/{id} ─────────────────────────────────────────────────

async def handle_student_delete(req: func.HttpRequest) -> func.HttpResponse:
    """Delete a student document.

    DELETE /api/students/{student_id}
    Requires: Authorization: Bearer <teacher_jwt>
    """
    try:
        require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    student_id: str = req.route_params.get("student_id", "").strip()
    if not student_id:
        return _err("student_id is required in the URL path")

    results = await query_items(
        "students",
        "SELECT c.id, c.class_id FROM c WHERE c.id = @id",
        [{"name": "@id", "value": student_id}],
    )
    if not results:
        return _err("Student not found.", status=404)

    doc = results[0]
    await delete_item("students", doc["id"], doc["class_id"])
    return _ok({"success": True, "message": "Student deleted."})


# ── POST /api/students/batch ──────────────────────────────────────────────────

async def handle_students_batch(req: func.HttpRequest) -> func.HttpResponse:
    """Bulk-create students for a class.

    POST /api/students/batch
    Requires: Authorization: Bearer <teacher_jwt>

    Body:
        {
          "class_id": "uuid",
          "students": [
            { "first_name": "Tendai", "surname": "Moyo", "register_number": "01", "phone": "+263..." },
            ...
          ]
        }

    Response 201:
        { "created": [ <student_doc>, ... ], "errors": [ { "index": n, "error": "..." }, ... ] }

    Partial success is allowed — valid entries are saved even if some fail.
    """
    try:
        require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    class_id: str = (body.get("class_id") or "").strip()
    raw_students: list = body.get("students", [])

    if not class_id:
        return _err("class_id is required")
    if not isinstance(raw_students, list) or not raw_students:
        return _err("students must be a non-empty list")

    created = []
    errors = []

    for idx, s in enumerate(raw_students):
        try:
            student = Student(
                class_id=class_id,
                first_name=s["first_name"],
                surname=s["surname"],
                phone=s.get("phone"),
                register_number=s.get("register_number"),
            )
            await upsert_item("students", student.model_dump(mode="json"))
            created.append(student.model_dump(mode="json"))
        except (KeyError, ValueError) as exc:
            errors.append({"index": idx, "error": str(exc)})
        except Exception as exc:
            logger.error("handle_students_batch: row %d failed: %s", idx, exc)
            errors.append({"index": idx, "error": "Internal error saving student"})

    status_code = 201 if created else 400
    return _ok({"created": created, "errors": errors}, status=status_code)
