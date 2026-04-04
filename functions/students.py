"""Student management endpoints."""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.firestore_client import delete_doc, get_doc, query, upsert
from shared.models import Student

logger = logging.getLogger(__name__)
students_bp = Blueprint("students", __name__)


def _teacher_owns_class(teacher_id: str, class_id: str) -> bool:
    from shared.firestore_client import get_doc as _get
    cls = _get("classes", class_id)
    return bool(cls and cls.get("teacher_id") == teacher_id)


@students_bp.get("/students")
def list_students():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    class_id = request.args.get("class_id", "").strip()
    if not class_id:
        return jsonify({"error": "class_id query param is required"}), 400

    if not _teacher_owns_class(teacher_id, class_id):
        return jsonify({"error": "forbidden"}), 403

    results = query("students", [("class_id", "==", class_id)], order_by="created_at")
    return jsonify(results), 200


@students_bp.post("/students")
def create_student():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    class_id = (body.get("class_id") or "").strip()
    first_name = (body.get("first_name") or "").strip()
    surname = (body.get("surname") or "").strip()

    if not class_id or not first_name or not surname:
        return jsonify({"error": "class_id, first_name, and surname are required"}), 400

    if not _teacher_owns_class(teacher_id, class_id):
        return jsonify({"error": "forbidden"}), 403

    student = Student(
        class_id=class_id,
        first_name=first_name,
        surname=surname,
        register_number=body.get("register_number"),
        phone=body.get("phone"),
    )
    upsert("students", student.id, student.model_dump())

    # Increment class student count
    cls = get_doc("classes", class_id)
    if cls:
        upsert("classes", class_id, {"student_count": cls.get("student_count", 0) + 1})

    return jsonify(student.model_dump()), 201


@students_bp.post("/students/batch")
def create_students_batch():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    class_id = (body.get("class_id") or "").strip()
    names: list[str] = body.get("names", [])

    if not class_id or not names:
        return jsonify({"error": "class_id and names are required"}), 400

    if not _teacher_owns_class(teacher_id, class_id):
        return jsonify({"error": "forbidden"}), 403

    created = []
    for raw_name in names:
        parts = str(raw_name).strip().split(None, 1)
        first = parts[0] if parts else raw_name
        sur = parts[1] if len(parts) > 1 else ""
        student = Student(class_id=class_id, first_name=first, surname=sur)
        upsert("students", student.id, student.model_dump())
        created.append(student.model_dump())

    cls = get_doc("classes", class_id)
    if cls:
        upsert("classes", class_id, {"student_count": cls.get("student_count", 0) + len(created)})

    return jsonify({"created": len(created), "students": created}), 201


@students_bp.put("/students/<student_id>")
def update_student(student_id: str):
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    student = get_doc("students", student_id)
    if not student:
        return jsonify({"error": "Student not found"}), 404
    if not _teacher_owns_class(teacher_id, student["class_id"]):
        return jsonify({"error": "forbidden"}), 403

    body = request.get_json(silent=True) or {}
    allowed = {"first_name", "surname", "register_number", "phone"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        return jsonify({"error": "No updatable fields"}), 400

    upsert("students", student_id, updates)
    return jsonify({**student, **updates}), 200


@students_bp.delete("/students/<student_id>")
def delete_student(student_id: str):
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    student = get_doc("students", student_id)
    if not student:
        return jsonify({"error": "Student not found"}), 404
    if not _teacher_owns_class(teacher_id, student["class_id"]):
        return jsonify({"error": "forbidden"}), 403

    delete_doc("students", student_id)

    cls = get_doc("classes", student["class_id"])
    if cls and cls.get("student_count", 0) > 0:
        upsert("classes", student["class_id"], {"student_count": cls["student_count"] - 1})

    return jsonify({"message": "deleted"}), 200
