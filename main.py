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
from flask import Flask, jsonify

from functions.analytics import analytics_bp
from functions.answer_keys import answer_keys_bp
from functions.auth import auth_bp
from functions.classes import classes_bp
from functions.mark import mark_bp
from functions.students import students_bp
from functions.whatsapp import whatsapp_bp

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.DEBUG if os.getenv("ENVIRONMENT", "dev") == "dev" else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ─── Flask app ────────────────────────────────────────────────────────────────

app = Flask(__name__)

_API = "/api"
app.register_blueprint(auth_bp,        url_prefix=_API)
app.register_blueprint(classes_bp,     url_prefix=_API)
app.register_blueprint(students_bp,    url_prefix=_API)
app.register_blueprint(answer_keys_bp, url_prefix=_API)
app.register_blueprint(mark_bp,        url_prefix=_API)
app.register_blueprint(whatsapp_bp,    url_prefix=_API)
app.register_blueprint(analytics_bp,   url_prefix=_API)


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
    return jsonify({"error": "internal server error"}), 500


# ─── Functions Framework entry point ─────────────────────────────────────────

@functions_framework.http
def neriah(request):
    """GCP Cloud Functions HTTP entry point."""
    with app.request_context(request.environ):
        return app.full_dispatch_request()


# ─── Local dev runner ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=True)
