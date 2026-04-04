"""Answer key management endpoints."""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.firestore_client import delete_doc, get_doc, query, upsert
from shared.gemma_client import generate_marking_scheme
from shared.models import AnswerKey

logger = logging.getLogger(__name__)
answer_keys_bp = Blueprint("answer_keys", __name__)


def _teacher_owns_class(teacher_id: str, class_id: str) -> bool:
    cls = get_doc("classes", class_id)
    return bool(cls and cls.get("teacher_id") == teacher_id)


@answer_keys_bp.get("/answer-keys")
def list_answer_keys():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    class_id = request.args.get("class_id", "").strip()
    if not class_id:
        return jsonify({"error": "class_id query param is required"}), 400

    if not _teacher_owns_class(teacher_id, class_id):
        return jsonify({"error": "forbidden"}), 403

    results = query("answer_keys", [("class_id", "==", class_id)], order_by="created_at")
    return jsonify(results), 200


@answer_keys_bp.post("/answer-keys")
def create_answer_key():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    class_id = (body.get("class_id") or "").strip()
    title = (body.get("title") or "").strip()
    education_level = (body.get("education_level") or "").strip()

    if not class_id or not title or not education_level:
        return jsonify({"error": "class_id, title, and education_level are required"}), 400

    if not _teacher_owns_class(teacher_id, class_id):
        return jsonify({"error": "forbidden"}), 403

    questions_raw = body.get("questions")
    question_paper_text = body.get("question_paper_text", "")

    # Auto-generate scheme if no questions provided but question paper text given
    if not questions_raw and question_paper_text:
        generated = generate_marking_scheme(question_paper_text, education_level)
        questions_raw = generated.get("questions", [])
        if not title or title == "Auto-generated scheme":
            title = generated.get("title", title)

    if not questions_raw:
        return jsonify({"error": "questions or question_paper_text is required"}), 400

    total_marks = sum(float(q.get("marks", 0)) for q in questions_raw)
    key = AnswerKey(
        class_id=class_id,
        teacher_id=teacher_id,
        title=title,
        education_level=education_level,
        questions=questions_raw,
        total_marks=total_marks,
    )
    upsert("answer_keys", key.id, key.model_dump())
    return jsonify(key.model_dump()), 201


@answer_keys_bp.put("/answer-keys/<key_id>")
def update_answer_key(key_id: str):
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    key = get_doc("answer_keys", key_id)
    if not key:
        return jsonify({"error": "Answer key not found"}), 404
    if key["teacher_id"] != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    body = request.get_json(silent=True) or {}
    allowed = {"title", "questions"}
    updates = {k: v for k, v in body.items() if k in allowed}

    if "questions" in updates:
        updates["total_marks"] = sum(float(q.get("marks", 0)) for q in updates["questions"])

    if not updates:
        return jsonify({"error": "No updatable fields"}), 400

    upsert("answer_keys", key_id, updates)
    return jsonify({**key, **updates}), 200


@answer_keys_bp.delete("/answer-keys/<key_id>")
def delete_answer_key(key_id: str):
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    key = get_doc("answer_keys", key_id)
    if not key:
        return jsonify({"error": "Answer key not found"}), 404
    if key["teacher_id"] != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    delete_doc("answer_keys", key_id)
    return jsonify({"message": "deleted"}), 200
