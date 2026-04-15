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

    # Fetch teacher's school_id so the class can be found via /classes/school/<school_id>
    teacher_doc = get_doc("teachers", teacher_id)
    school_id = (teacher_doc or {}).get("school_id") or None

    cls = Class(teacher_id=teacher_id, name=name, education_level=education_level,
                curriculum=curriculum, school_id=school_id)
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


@classes_bp.get("/classes/school/<school_id>")
def classes_by_school(school_id: str):
    """Public — list classes for a school so students can pick one at registration."""
    logger.debug("[classes] GET /classes/school/%s", school_id)
    if not school_id or not school_id.strip():
        return jsonify({"error": "school_id is required"}), 400

    sid = school_id.strip()
    # No order_by here — composite index (school_id, created_at) may not exist.
    # Sort in Python after fetching.
    results = query("classes", [("school_id", "==", sid)])

    if not results:
        # Fallback: find teachers at this school, then fetch their classes.
        # This covers classes created before school_id was stamped on the class document.
        teachers_at_school = query("teachers", [("school_id", "==", sid)])
        for t in teachers_at_school:
            teacher_classes = query("classes", [("teacher_id", "==", t["id"])])
            results.extend(teacher_classes)

    if not results:
        logger.info("[classes] No classes found for school_id=%s", sid)
        return jsonify([]), 200

    # Deduplicate (a class might appear twice if school_id field was already set)
    seen: set[str] = set()
    unique: list[dict] = []
    for c in results:
        cid = c.get("id", "")
        if cid not in seen:
            seen.add(cid)
            unique.append(c)
    results = sorted(unique, key=lambda c: c.get("created_at", ""))

    # Attach teacher name to each class so the mobile UI can display it
    teacher_cache: dict[str, dict | None] = {}
    out = []
    for cls in results:
        teacher_id = cls.get("teacher_id", "")
        if teacher_id not in teacher_cache:
            teacher_cache[teacher_id] = get_doc("teachers", teacher_id) if teacher_id else None
        teacher = teacher_cache[teacher_id]
        out.append({
            "id": cls["id"],
            "name": cls.get("name", ""),
            "education_level": cls.get("education_level", ""),
            "subject": cls.get("subject"),
            "teacher": {
                "first_name": teacher.get("first_name") or teacher.get("name", "").split()[0] if teacher else "",
                "surname": teacher.get("surname") or (teacher.get("name", "").split()[-1] if teacher and " " in teacher.get("name", "") else "") if teacher else "",
            },
        })
    logger.info("[classes] Returning %d classes for school_id=%s", len(out), school_id)
    return jsonify(out), 200


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
