"""Class management endpoints."""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.firestore_client import delete_doc, get_doc, query, query_single, upsert
from shared.models import Class

logger = logging.getLogger(__name__)
classes_bp = Blueprint("classes", __name__)


@classes_bp.get("/classes")
def list_classes():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    results = query("classes", [("teacher_id", "==", teacher_id)], order_by="created_at")
    return jsonify(results), 200


@classes_bp.post("/classes")
def create_class():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    education_level = (body.get("education_level") or "").strip()
    curriculum = (body.get("curriculum") or "zimsec").strip().lower()
    if curriculum not in ("zimsec", "cambridge"):
        curriculum = "zimsec"

    if not name or not education_level:
        return jsonify({"error": "name and education_level are required"}), 400

    cls = Class(teacher_id=teacher_id, name=name, education_level=education_level, curriculum=curriculum)
    upsert("classes", cls.id, cls.model_dump())
    return jsonify(cls.model_dump()), 201


@classes_bp.put("/classes/<class_id>")
def update_class(class_id: str):
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    cls = get_doc("classes", class_id)
    if not cls:
        return jsonify({"error": "Class not found"}), 404
    if cls["teacher_id"] != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    body = request.get_json(silent=True) or {}
    allowed = {"name", "education_level", "curriculum"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        return jsonify({"error": "No updatable fields provided"}), 400

    upsert("classes", class_id, updates)
    return jsonify({**cls, **updates}), 200


@classes_bp.delete("/classes/<class_id>")
def delete_class(class_id: str):
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    cls = get_doc("classes", class_id)
    if not cls:
        return jsonify({"error": "Class not found"}), 404
    if cls["teacher_id"] != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    delete_doc("classes", class_id)
    return jsonify({"message": "deleted"}), 200


@classes_bp.get("/classes/join/<code>")
def class_join_info(code: str):
    cls = query_single("classes", [("join_code", "==", code.upper())])
    if not cls:
        return jsonify({"error": "Invalid join code"}), 404
    return jsonify({"id": cls["id"], "name": cls["name"], "education_level": cls["education_level"]}), 200


@classes_bp.post("/classes/join")
def class_join():
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    code = (body.get("join_code") or "").strip().upper()

    cls = query_single("classes", [("join_code", "==", code)])
    if not cls:
        return jsonify({"error": "Invalid join code"}), 404

    # Update student's class_id
    upsert("students", student_id, {"class_id": cls["id"]})
    upsert("classes", cls["id"], {"student_count": cls.get("student_count", 0) + 1})
    return jsonify({"message": "joined", "class": cls}), 200
