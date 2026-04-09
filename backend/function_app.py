from __future__ import annotations

import json
import logging

import azure.functions as func

# Auth
from functions.auth import (
    handle_auth_login,
    handle_auth_me,
    handle_auth_recover,
    handle_auth_register,
    handle_auth_resend_otp,
    handle_auth_verify,
    handle_auth_pin_set,
    handle_auth_pin_verify,
    handle_auth_pin_delete,
)
from functions.student_auth import (
    handle_student_activate,
    handle_student_lookup,
    handle_student_self_register,
)

# Classes
from functions.classes import (
    handle_class_delete,
    handle_class_join,
    handle_class_join_info,
    handle_class_update,
    handle_classes,
    handle_classes_by_school,
)

# Students
from functions.students import (
    handle_student_delete,
    handle_student_update,
    handle_students,
    handle_students_batch,
)

# Answer keys
from functions.answer_keys import (
    handle_answer_key_delete,
    handle_answer_key_update,
    handle_answer_keys,
)

# Marks
from functions.marks import handle_mark_get, handle_mark_update, handle_marks_approve_bulk
from functions.mark import MarkingRequest, run_marking

# Student-facing endpoints
from functions.assignments import handle_assignments
from functions.student_submissions import (
    handle_student_marks_list,
    handle_student_submission_create,
    handle_student_submission_delete,
    handle_student_submissions_list,
)

# Push notifications
from functions.push import handle_push_register

# Other existing endpoints
from functions.analytics import (
    handle_analytics,
    handle_class_analytics,
    handle_classes_analytics,
    handle_student_analytics,
    handle_teacher_analytics,
    handle_student_class_analytics,
)
from functions.email_webhook import handle_email_webhook
from functions.email_inbound import handle_email_inbound
from functions.submissions import handle_submission_approve, handle_submissions
from functions.whatsapp_webhook import handle_verification, handle_webhook
from functions.schools import handle_schools

logger = logging.getLogger(__name__)

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


# ── WhatsApp ──────────────────────────────────────────────────────────────────

@app.route(route="schools", methods=["GET"])
async def schools(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_schools(req)


@app.route(route="whatsapp", methods=["GET"])
async def whatsapp_verify(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_verification(req)


@app.route(route="whatsapp", methods=["POST"])
async def whatsapp_webhook(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_webhook(req)


# ── Teacher auth ──────────────────────────────────────────────────────────────

@app.route(route="auth/register", methods=["POST"])
async def auth_register(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_auth_register(req)


@app.route(route="auth/login", methods=["POST"])
async def auth_login(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_auth_login(req)


@app.route(route="auth/verify", methods=["POST"])
async def auth_verify(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_auth_verify(req)


@app.route(route="auth/resend-otp", methods=["POST"])
async def auth_resend_otp(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_auth_resend_otp(req)


@app.route(route="auth/me", methods=["GET"])
async def auth_me(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_auth_me(req)


@app.route(route="auth/recover", methods=["POST"])
async def auth_recover(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_auth_recover(req)


@app.route(route="auth/pin/set", methods=["POST"])
async def auth_pin_set(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_auth_pin_set(req)


@app.route(route="auth/pin/verify", methods=["POST"])
async def auth_pin_verify(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_auth_pin_verify(req)


@app.route(route="auth/pin", methods=["DELETE"])
async def auth_pin_delete(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_auth_pin_delete(req)


# ── Student auth ──────────────────────────────────────────────────────────────

@app.route(route="auth/student/lookup", methods=["POST"])
async def auth_student_lookup(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_student_lookup(req)


@app.route(route="auth/student/activate", methods=["POST"])
async def auth_student_activate(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_student_activate(req)


@app.route(route="auth/student/register", methods=["POST"])
async def auth_student_register(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_student_self_register(req)


# ── Push notifications ────────────────────────────────────────────────────────

@app.route(route="push/register", methods=["POST"])
async def push_register(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_push_register(req)


# ── Classes ───────────────────────────────────────────────────────────────────

@app.route(route="classes", methods=["GET", "POST"])
async def classes(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_classes(req)


@app.route(route="classes/{class_id}", methods=["PUT"])
async def class_update(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_class_update(req)


@app.route(route="classes/{class_id}", methods=["DELETE"])
async def class_delete(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_class_delete(req)


@app.route(route="classes/join/{code}", methods=["GET"])
async def class_join_info(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_class_join_info(req)


@app.route(route="classes/join", methods=["POST"])
async def class_join(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_class_join(req)


@app.route(route="classes/school/{school_id}", methods=["GET"])
async def classes_by_school(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_classes_by_school(req)


# ── Students ──────────────────────────────────────────────────────────────────

@app.route(route="students", methods=["GET", "POST"])
async def students(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_students(req)


@app.route(route="students/batch", methods=["POST"])
async def students_batch(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_students_batch(req)


@app.route(route="students/{student_id}", methods=["PUT"])
async def student_update(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_student_update(req)


@app.route(route="students/{student_id}", methods=["DELETE"])
async def student_delete(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_student_delete(req)


# ── Answer keys ───────────────────────────────────────────────────────────────

@app.route(route="answer-keys", methods=["GET", "POST"])
async def answer_keys(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_answer_keys(req)


@app.route(route="answer-keys/{answer_key_id}", methods=["PUT"])
async def answer_key_update(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_answer_key_update(req)


@app.route(route="answer-keys/{answer_key_id}", methods=["DELETE"])
async def answer_key_delete(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_answer_key_delete(req)


# ── Marking (teacher scan) ────────────────────────────────────────────────────

@app.route(route="mark", methods=["POST"])
async def mark(req: func.HttpRequest) -> func.HttpResponse:
    try:
        files = req.files
        form = req.form
        image_bytes = files["image"].read() if "image" in files else req.get_body()
        request = MarkingRequest(
            teacher_id=form["teacher_id"],
            student_id=form["student_id"],
            class_id=form["class_id"],
            answer_key_id=form["answer_key_id"],
            education_level=form["education_level"],
            image_bytes=image_bytes,
            source=form.get("source", "app"),
        )
    except (KeyError, ValueError) as exc:
        return func.HttpResponse(
            json.dumps({"error": f"Invalid request: {exc}"}),
            status_code=400,
            mimetype="application/json",
        )
    try:
        result = await run_marking(request)
        return func.HttpResponse(result.model_dump_json(), status_code=200, mimetype="application/json")
    except Exception as exc:
        logger.exception("mark pipeline error: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Internal server error"}),
            status_code=500,
            mimetype="application/json",
        )


# ── Marks (teacher review + student feedback) ─────────────────────────────────

@app.route(route="marks/{mark_id}", methods=["GET"])
async def mark_get(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_mark_get(req)


@app.route(route="marks/{mark_id}", methods=["PUT"])
async def mark_update(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_mark_update(req)


@app.route(route="marks/approve-bulk", methods=["POST"])
async def marks_approve_bulk(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_marks_approve_bulk(req)


# ── Student assignments & submissions ─────────────────────────────────────────

@app.route(route="assignments", methods=["GET"])
async def assignments(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_assignments(req)


@app.route(route="submissions/student", methods=["POST"])
async def student_submission_create(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_student_submission_create(req)


@app.route(route="submissions/student/{id}", methods=["GET"])
async def student_submissions_list(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_student_submissions_list(req)


@app.route(route="submissions/student/{id}", methods=["DELETE"])
async def student_submission_delete(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_student_submission_delete(req)


@app.route(route="marks/student/{student_id}", methods=["GET"])
async def student_marks_list(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_student_marks_list(req)


# ── Analytics ─────────────────────────────────────────────────────────────────

@app.route(route="analytics/classes", methods=["GET"])
async def analytics_classes(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_classes_analytics(req)


@app.route(route="analytics", methods=["GET"])
async def analytics(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_analytics(req)


@app.route(route="analytics/class/{class_id}", methods=["GET"])
async def analytics_class(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_class_analytics(req, req.route_params["class_id"])


@app.route(route="analytics/student/{student_id}", methods=["GET"])
async def analytics_student(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_student_analytics(req, req.route_params["student_id"])


@app.route(route="analytics/teacher/{teacher_id}", methods=["GET"])
async def analytics_teacher(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_teacher_analytics(req, req.route_params["teacher_id"])


@app.route(route="analytics/student-class/{class_id}", methods=["GET"])
async def analytics_student_class(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_student_class_analytics(req, req.route_params["class_id"])


# ── Tertiary submissions ──────────────────────────────────────────────────────

@app.route(route="submissions", methods=["GET", "POST"])
async def submissions(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_submissions(req)


@app.route(route="submissions/{submission_id}/approve", methods=["POST"])
async def submission_approve(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_submission_approve(req)


# ── Email webhook ─────────────────────────────────────────────────────────────

@app.route(route="email-webhook", methods=["POST"])
async def email_webhook(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_email_webhook(req)


# ── Email inbound (SendGrid Inbound Parse — student homework via email) ────────

@app.route(route="email/inbound", methods=["POST"])
async def email_inbound(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_email_inbound(req)
