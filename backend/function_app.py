from __future__ import annotations

import json
import logging

import azure.functions as func

from functions.answer_keys import handle_answer_keys
from functions.analytics import handle_analytics
from functions.classes import handle_classes
from functions.email_webhook import handle_email_webhook
from functions.mark import MarkingRequest, run_marking
from functions.students import handle_students
from functions.submissions import handle_submissions, handle_submission_approve
from functions.whatsapp_webhook import handle_verification, handle_webhook

logger = logging.getLogger(__name__)

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


@app.route(route="whatsapp", methods=["GET"])
async def whatsapp_verify(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_verification(req)


@app.route(route="whatsapp", methods=["POST"])
async def whatsapp_webhook(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_webhook(req)


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
        return func.HttpResponse(json.dumps({"error": f"Invalid request: {exc}"}), status_code=400, mimetype="application/json")
    try:
        result = await run_marking(request)
        return func.HttpResponse(result.model_dump_json(), status_code=200, mimetype="application/json")
    except Exception as exc:
        logger.exception("mark pipeline error: %s", exc)
        return func.HttpResponse(json.dumps({"error": "Internal server error"}), status_code=500, mimetype="application/json")


@app.route(route="classes", methods=["GET", "POST"])
async def classes(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_classes(req)


@app.route(route="students", methods=["GET", "POST"])
async def students(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_students(req)


@app.route(route="answer-keys", methods=["GET", "POST"])
async def answer_keys(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_answer_keys(req)


@app.route(route="analytics", methods=["GET"])
async def analytics(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_analytics(req)


@app.route(route="submissions", methods=["GET", "POST"])
async def submissions(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_submissions(req)


@app.route(route="submissions/{submission_id}/approve", methods=["POST"])
async def submission_approve(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_submission_approve(req)


@app.route(route="email-webhook", methods=["POST"])
async def email_webhook(req: func.HttpRequest) -> func.HttpResponse:
    return await handle_email_webhook(req)
