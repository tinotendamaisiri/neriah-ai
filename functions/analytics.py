"""Analytics endpoint — per-class and per-student stats."""

from __future__ import annotations

import logging
from collections import defaultdict

from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.firestore_client import get_doc, query

logger = logging.getLogger(__name__)
analytics_bp = Blueprint("analytics", __name__)


@analytics_bp.get("/analytics")
def analytics():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    class_id = request.args.get("class_id", "").strip()
    if not class_id:
        return jsonify({"error": "class_id query param is required"}), 400

    cls = get_doc("classes", class_id)
    if not cls or cls.get("teacher_id") != teacher_id:
        return jsonify({"error": "forbidden or not found"}), 403

    students = query("students", [("class_id", "==", class_id)])
    student_map = {s["id"]: s for s in students}

    marks = query("marks", [("class_id", "==", class_id)], order_by="timestamp")

    # Aggregate per-student
    per_student: dict[str, dict] = defaultdict(lambda: {"marks": [], "scores": [], "percentages": []})
    for m in marks:
        sid = m["student_id"]
        per_student[sid]["marks"].append(m)
        per_student[sid]["scores"].append(m.get("score", 0))
        per_student[sid]["percentages"].append(m.get("percentage", 0))

    student_summaries = []
    all_percentages = []
    for sid, data in per_student.items():
        pcts = data["percentages"]
        avg = round(sum(pcts) / len(pcts), 1) if pcts else 0.0
        all_percentages.extend(pcts)
        student_summaries.append({
            "student_id": sid,
            "name": _student_name(student_map.get(sid, {})),
            "submissions": len(data["marks"]),
            "average_percentage": avg,
            "latest_percentage": pcts[-1] if pcts else None,
        })

    class_average = (
        round(sum(all_percentages) / len(all_percentages), 1) if all_percentages else None
    )
    passing = sum(1 for p in all_percentages if p >= 50)
    pass_rate = round(passing / len(all_percentages) * 100, 1) if all_percentages else None

    return jsonify({
        "class_id": class_id,
        "class_name": cls["name"],
        "education_level": cls.get("education_level"),
        "student_count": len(students),
        "total_submissions": len(marks),
        "class_average_percentage": class_average,
        "pass_rate_percentage": pass_rate,
        "students": student_summaries,
    }), 200


def _student_name(student: dict) -> str:
    if not student:
        return "Unknown"
    return f"{student.get('first_name', '')} {student.get('surname', '')}".strip()
