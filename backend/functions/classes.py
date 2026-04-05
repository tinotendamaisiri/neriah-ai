# functions/classes.py
# Teacher class management.
#
# GET    /api/classes              — list teacher's classes (teacher JWT)
# POST   /api/classes              — create a class (teacher JWT)
# PUT    /api/classes/{class_id}   — update a class (teacher JWT)
# DELETE /api/classes/{class_id}   — delete a class (teacher JWT)
# GET    /api/classes/join/{code}  — look up class info by join code (no auth)
# POST   /api/classes/join         — verify student belongs to class (student JWT)

from __future__ import annotations

import json
import logging
import random
import string
from typing import Optional

import azure.functions as func

from shared.auth import require_role
from shared.cosmos_client import delete_item, query_items, upsert_item
from shared.models import Class, EducationLevel

logger = logging.getLogger(__name__)


def _ok(body, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(body, default=str), status_code=status, mimetype="application/json"
    )


def _err(message: str, status: int = 400) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({"error": message}), status_code=status, mimetype="application/json"
    )


# ── GET / POST /api/classes ───────────────────────────────────────────────────

async def handle_classes(req: func.HttpRequest) -> func.HttpResponse:
    """Route GET → list, POST → create."""
    if req.method == "GET":
        return await _list_classes(req)
    return await _create_class(req)


async def _list_classes(req: func.HttpRequest) -> func.HttpResponse:
    try:
        user = require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    results = await query_items(
        container_name="classes",
        query="SELECT * FROM c WHERE c.teacher_id = @teacher_id ORDER BY c.created_at DESC",
        parameters=[{"name": "@teacher_id", "value": user["id"]}],
        partition_key=user["id"],
    )
    return _ok(results)


async def _create_class(req: func.HttpRequest) -> func.HttpResponse:
    try:
        user = require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    try:
        body = req.get_json()
        join_code = await _generate_unique_join_code()
        new_class = Class(
            teacher_id=user["id"],
            name=body["name"],
            education_level=EducationLevel(body["education_level"]),
            join_code=join_code,
            subject=body.get("subject"),
            grade=body.get("grade"),
            share_analytics=body.get("share_analytics", False),
            share_rank=body.get("share_rank", False),
        )
        await upsert_item("classes", new_class.model_dump(mode="json"))
        return _ok(new_class.model_dump(mode="json"), status=201)
    except (KeyError, ValueError) as exc:
        return _err(f"Invalid request: {exc}")


# ── PUT /api/classes/{class_id} ───────────────────────────────────────────────

async def handle_class_update(req: func.HttpRequest) -> func.HttpResponse:
    """Update mutable fields on a class.

    PUT /api/classes/{class_id}
    Requires: Authorization: Bearer <teacher_jwt>
    Body (all optional): { name, subject, grade, share_analytics, share_rank }
    """
    try:
        user = require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    class_id: str = req.route_params.get("class_id", "").strip()
    if not class_id:
        return _err("class_id is required in the URL path")

    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    results = await query_items(
        "classes",
        "SELECT * FROM c WHERE c.id = @id AND c.teacher_id = @tid",
        [{"name": "@id", "value": class_id}, {"name": "@tid", "value": user["id"]}],
        partition_key=user["id"],
    )
    if not results:
        return _err("Class not found.", status=404)

    class_doc = results[0]

    for field in ("name", "subject", "grade", "share_analytics", "share_rank"):
        if field in body:
            class_doc[field] = body[field]

    await upsert_item("classes", class_doc)
    return _ok(class_doc)


# ── DELETE /api/classes/{class_id} ───────────────────────────────────────────

async def handle_class_delete(req: func.HttpRequest) -> func.HttpResponse:
    """Delete a class.

    DELETE /api/classes/{class_id}
    Requires: Authorization: Bearer <teacher_jwt>
    """
    try:
        user = require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    class_id: str = req.route_params.get("class_id", "").strip()
    if not class_id:
        return _err("class_id is required in the URL path")

    results = await query_items(
        "classes",
        "SELECT c.id FROM c WHERE c.id = @id AND c.teacher_id = @tid",
        [{"name": "@id", "value": class_id}, {"name": "@tid", "value": user["id"]}],
        partition_key=user["id"],
    )
    if not results:
        return _err("Class not found.", status=404)

    await delete_item("classes", class_id, user["id"])
    return _ok({"success": True, "message": "Class deleted."})


# ── GET /api/classes/join/{code} ──────────────────────────────────────────────

async def handle_class_join_info(req: func.HttpRequest) -> func.HttpResponse:
    """Look up class info by join code — no auth required.

    GET /api/classes/join/{code}
    Response 200: { id, name, subject, education_level, teacher: { first_name, surname } }
    """
    code: str = req.route_params.get("code", "").strip().upper()
    if not code:
        return _err("code is required in the URL path")

    results = await query_items(
        "classes",
        "SELECT * FROM c WHERE c.join_code = @code",
        [{"name": "@code", "value": code}],
    )
    if not results:
        return _err("Class not found. Please check the code.", status=404)

    cls = results[0]

    teacher: dict = {}
    if cls.get("teacher_id"):
        t_results = await query_items(
            "teachers",
            "SELECT c.first_name, c.surname FROM c WHERE c.id = @id",
            [{"name": "@id", "value": cls["teacher_id"]}],
        )
        teacher = t_results[0] if t_results else {}

    return _ok({
        "id": cls["id"],
        "name": cls.get("name", ""),
        "subject": cls.get("subject"),
        "education_level": cls.get("education_level"),
        "teacher": {
            "first_name": teacher.get("first_name", ""),
            "surname": teacher.get("surname", ""),
        },
    })


# ── POST /api/classes/join ────────────────────────────────────────────────────

async def handle_class_join(req: func.HttpRequest) -> func.HttpResponse:
    """Confirm a student is enrolled in the class identified by join code.

    POST /api/classes/join
    Requires: Authorization: Bearer <student_jwt>
    Body: { "class_join_code": "A7B3K2", "student_id": "uuid" }

    Returns 200 if the student is already in this class (idempotent).
    Returns 409 if the student belongs to a different class.

    Note: class_id is the Cosmos partition key and cannot be changed after
    student creation. Use POST /api/auth/student/register to enrol a new student.
    """
    try:
        user = require_role(req, "student")
    except ValueError as exc:
        return _err(str(exc), status=401)

    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    join_code: str = (body.get("class_join_code") or "").strip().upper()
    student_id: str = (body.get("student_id") or "").strip()

    if not join_code:
        return _err("class_join_code is required")
    if not student_id:
        return _err("student_id is required")
    if student_id != user["id"]:
        return _err("student_id does not match authenticated user.", status=403)

    class_results = await query_items(
        "classes",
        "SELECT c.id, c.name FROM c WHERE c.join_code = @code",
        [{"name": "@code", "value": join_code}],
    )
    if not class_results:
        return _err("Invalid class code. Please check the code and try again.")

    cls = class_results[0]

    student_results = await query_items(
        "students",
        "SELECT c.id, c.class_id FROM c WHERE c.id = @id",
        [{"name": "@id", "value": student_id}],
    )
    if not student_results:
        return _err("Student not found.", status=404)

    student_class_id = student_results[0].get("class_id", "")

    if student_class_id == cls["id"]:
        return _ok({"class_id": cls["id"], "class_name": cls.get("name", "")})

    return _err(
        "You are already enrolled in a different class. "
        "Contact your teacher to be moved.",
        status=409,
    )


# ── GET /api/classes/school/{school_id} ──────────────────────────────────────

async def handle_classes_by_school(req: func.HttpRequest) -> func.HttpResponse:
    """Return all classes belonging to teachers at a given school — no auth required.

    GET /api/classes/school/{school_id}
    Response 200: [ { id, name, education_level, subject, teacher: { first_name, surname } } ]
    """
    school_id: str = req.route_params.get("school_id", "").strip()
    if not school_id:
        return _err("school_id is required in the URL path")

    # Find all teachers at this school (cross-partition — school_id is not the partition key)
    teacher_results = await query_items(
        "teachers",
        "SELECT c.id, c.first_name, c.surname FROM c WHERE c.school_id = @school_id",
        [{"name": "@school_id", "value": school_id}],
    )
    if not teacher_results:
        return _ok([])

    classes: list[dict] = []
    for teacher in teacher_results:
        cls_list = await query_items(
            "classes",
            "SELECT * FROM c WHERE c.teacher_id = @tid ORDER BY c.name ASC",
            [{"name": "@tid", "value": teacher["id"]}],
            partition_key=teacher["id"],
        )
        for cls in cls_list:
            classes.append({
                "id": cls["id"],
                "name": cls.get("name", ""),
                "education_level": cls.get("education_level", ""),
                "subject": cls.get("subject"),
                "teacher": {
                    "first_name": teacher.get("first_name", ""),
                    "surname": teacher.get("surname", ""),
                },
            })

    # Sort by name for consistent display
    classes.sort(key=lambda c: c["name"])
    return _ok(classes)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _generate_unique_join_code(max_attempts: int = 5) -> str:
    chars = string.ascii_uppercase + string.digits
    code = ""
    for _ in range(max_attempts):
        code = "".join(random.choices(chars, k=6))
        existing = await query_items(
            container_name="classes",
            query="SELECT c.id FROM c WHERE c.join_code = @code",
            parameters=[{"name": "@code", "value": code}],
        )
        if not existing:
            return code
    logger.warning("_generate_unique_join_code: exhausted %d attempts, using last code", max_attempts)
    return code
