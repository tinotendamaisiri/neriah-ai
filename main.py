"""
Neriah GCP — Cloud Functions entry point.

All routes are registered on a single Flask app and dispatched via the
Functions Framework HTTP trigger (one function deployment).

Local dev:
    functions-framework --target neriah --debug

Deploy:
    gcloud functions deploy neriah \
        --gen2 --runtime python311 --trigger-http \
        --allow-unauthenticated --entry-point neriah \
        --set-env-vars GCP_PROJECT_ID=...,APP_JWT_SECRET=...,...
"""

from __future__ import annotations

import logging
import os

import functions_framework
from flask import Flask, jsonify, request as flask_request

from functions.analytics import analytics_bp
from functions.answer_keys import answer_keys_bp, homework_bp
from functions.auth import auth_bp
from functions.classes import classes_bp
from functions.curriculum import curriculum_bp
from functions.mark import mark_bp
from functions.push import push_bp
from functions.schools import schools_bp
from functions.students import students_bp
from functions.submissions import submissions_bp
from functions.suggestions import suggestions_bp
from functions.teacher_assistant import teacher_assistant_bp
from functions.tutor import tutor_bp
from functions.whatsapp import whatsapp_bp

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.DEBUG if os.getenv("ENVIRONMENT", "dev") == "dev" else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ─── Flask app ────────────────────────────────────────────────────────────────

app = Flask(__name__)

# ─── CORS ─────────────────────────────────────────────────────────────────────
# Allow requests from the web dashboard and the demo site only.
# Mobile clients (React Native) do not use CORS, so they are unaffected.
# Wildcard (*) is intentionally not used — only known origins are allowed.

_ALLOWED_ORIGINS = {
    "https://neriah.ai",
    "https://www.neriah.ai",
    "https://neriah.africa",
    "https://www.neriah.africa",
    "http://localhost:3000",   # local Next.js dev
    "http://localhost:5173",   # local Vite dev
}


@app.after_request
def add_cors_headers(response):
    origin = flask_request.headers.get("Origin", "")
    if origin in _ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, Authorization, X-Requested-With"
        )
        response.headers["Access-Control-Allow-Methods"] = (
            "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        )
        response.headers["Vary"] = "Origin"
    return response


@app.route("/api/<path:path>", methods=["OPTIONS"])
@app.route("/api", methods=["OPTIONS"])
def handle_preflight(path=""):
    """Handle CORS preflight requests."""
    response = app.make_default_options_response()
    origin = flask_request.headers.get("Origin", "")
    if origin in _ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, Authorization, X-Requested-With"
        )
        response.headers["Access-Control-Allow-Methods"] = (
            "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        )
        response.headers["Access-Control-Max-Age"] = "3600"
        response.headers["Vary"] = "Origin"
    return response


_API = "/api"
app.register_blueprint(auth_bp,        url_prefix=_API)
app.register_blueprint(classes_bp,     url_prefix=_API)
app.register_blueprint(students_bp,    url_prefix=_API)
app.register_blueprint(answer_keys_bp, url_prefix=_API)
app.register_blueprint(homework_bp,    url_prefix=_API)
app.register_blueprint(submissions_bp, url_prefix=_API)
app.register_blueprint(mark_bp,        url_prefix=_API)
app.register_blueprint(push_bp,        url_prefix=_API)
app.register_blueprint(schools_bp,     url_prefix=_API)
app.register_blueprint(suggestions_bp, url_prefix=_API)
app.register_blueprint(teacher_assistant_bp, url_prefix=_API)
app.register_blueprint(tutor_bp,       url_prefix=_API)
app.register_blueprint(whatsapp_bp,    url_prefix=_API)
app.register_blueprint(analytics_bp,   url_prefix=_API)
app.register_blueprint(curriculum_bp,  url_prefix=_API)


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "project": "neriah-gcp"}), 200


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    logger.exception("Unhandled 500")
    return jsonify({"error": "Neriah is having trouble right now. Please try again in a moment."}), 500


@app.errorhandler(Exception)
def unhandled_exception(e):
    logger.exception("Unhandled exception: %s", e)
    return jsonify({"error": "Neriah is having trouble right now. Please try again in a moment."}), 500


# ─── Functions Framework entry point ─────────────────────────────────────────

@functions_framework.http
def neriah(request):
    """GCP Cloud Functions HTTP entry point."""
    with app.request_context(request.environ):
        return app.full_dispatch_request()


# ─── Local dev runner ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=True)
