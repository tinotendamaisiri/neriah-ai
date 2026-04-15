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


@classes_bp.get("/classes/<class_id>")
def get_class_detail(class_id: str):
    """Get a single class by ID. Accessible by teacher or student."""
    _, err = require_role(request, "teacher", "student")
    if err:
        return jsonify({"error": err}), 401

    cls = get_doc("classes", class_id)
    if not cls:
        return jsonify({"error": "Class not found"}), 404

    # Enrich with teacher's school name
    teacher = get_doc("teachers", cls.get("teacher_id", "")) if cls.get("teacher_id") else None
    school_name = ""
    if teacher:
        school_name = teacher.get("school_name") or teacher.get("name", "")

    return jsonify({
        **cls,
        "school_name": school_name,
    }), 200


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


def _classes_for_school_name(school_name: str) -> list[dict]:
    """
    Return classes whose teacher is at the given school.

    Avoids querying classes by school_id (requires a Firestore composite index
    that may not exist).  Instead we:
      1. Scan teachers whose school_name matches (exact, then case-insensitive).
      2. For each matching teacher fetch their classes by teacher_id — which uses
         the existing (teacher_id, created_at) composite index.
    """
    sn = school_name.strip()
    if not sn:
        return []

    # Exact match first (fast path)
    teachers = query("teachers", [("school_name", "==", sn)])

    # Case-insensitive fallback — scan all teachers and filter in Python.
    # Acceptable because there are O(hundreds) of teachers in this dataset.
    if not teachers:
        all_teachers = query("teachers", [])
        sn_lower = sn.lower()
        teachers = [
            t for t in all_teachers
            if (t.get("school_name") or t.get("school_id") or "").lower() == sn_lower
        ]

    if not teachers:
        return []

    # Fetch classes for each teacher using the existing composite index
    seen: set[str] = set()
    results: list[dict] = []
    for t in teachers:
        teacher_classes = query(
            "classes",
            [("teacher_id", "==", t["id"])],
            order_by="created_at",
        )
        for cls in teacher_classes:
            cid = cls.get("id", "")
            if cid not in seen:
                seen.add(cid)
                # Embed teacher name so the mobile UI doesn't need an extra fetch
                cls_out = {
                    "id": cid,
                    "name": cls.get("name", ""),
                    "education_level": cls.get("education_level", ""),
                    "subject": cls.get("subject"),
                    "teacher": {
                        "first_name": t.get("first_name") or "",
                        "surname":    t.get("surname")     or "",
                    },
                }
                results.append(cls_out)

    return results


@classes_bp.get("/classes/school/<school_id>")
def classes_by_school(school_id: str):
    """
    Public — list classes for a school by school_id.

    Resolves the school_id to a human-readable name, then delegates to the
    name-based helper (avoids a missing Firestore composite index on school_id).
    """
    logger.debug("[classes] GET /classes/school/%s", school_id)
    sid = (school_id or "").strip()
    if not sid:
        return jsonify({"error": "school_id is required"}), 400

    # Resolve school_id → school name using the seed list
    from functions.schools import _SEED_SCHOOLS
    seed = next((s for s in _SEED_SCHOOLS if s["id"] == sid), None)
    school_name = seed["name"] if seed else sid

    out = _classes_for_school_name(school_name)
    logger.info("[classes] Returning %d classes for school_id=%s", len(out), sid)
    return jsonify(out), 200


@classes_bp.get("/classes/by-school")
def classes_by_school_name():
    """
    Public — list classes for a school by school name (query param).
    Used by mobile and web student registration to show available classes.

    GET /api/classes/by-school?school=Chiredzi+High+School
    """
    school = (request.args.get("school") or "").strip()
    logger.debug("[classes] GET /classes/by-school school=%r", school)

    if not school:
        return jsonify({"error": "school query parameter is required"}), 400

    out = _classes_for_school_name(school)
    logger.info("[classes] /classes/by-school returning %d classes for school=%r", len(out), school)
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
