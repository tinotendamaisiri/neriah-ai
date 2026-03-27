# functions/answer_keys.py
# GET  /api/answer-keys?class_id=...  — list answer keys for a class
# POST /api/answer-keys               — create or auto-generate an answer key

from __future__ import annotations

import logging

import azure.functions as func

from shared.cosmos_client import query_items, upsert_item
from shared.models import AnswerKey, Question
from shared.openai_client import generate_marking_scheme

logger = logging.getLogger(__name__)

bp = func.Blueprint()


async def handle_answer_keys(req: func.HttpRequest) -> func.HttpResponse:
    """Public async handler — called from function_app.py @app.route decorator."""
    return answer_keys(req)


@bp.route(route="answer-keys", methods=["GET", "POST"])
def answer_keys(req: func.HttpRequest) -> func.HttpResponse:
    """
    GET:  Returns all answer keys for a class.
    POST: Creates an answer key — either from supplied questions or auto-generated.
          Body: { class_id, subject, questions?: [...], auto_generate?: bool, question_paper_text?: str, education_level?: str }
    """
    # TODO: extract teacher_id from JWT, verify class ownership
    if req.method == "GET":
        return _list_answer_keys(req)
    return _create_answer_key(req)


def _list_answer_keys(req: func.HttpRequest) -> func.HttpResponse:
    """Return all answer keys for a class."""
    import json
    class_id = req.params.get("class_id")
    if not class_id:
        return func.HttpResponse('{"error": "class_id query param required"}', status_code=400, mimetype="application/json")

    # TODO: also return question count and generated flag for each key
    results = query_items(
        container_name="answer_keys",
        query="SELECT * FROM c WHERE c.class_id = @class_id",
        parameters=[{"name": "@class_id", "value": class_id}],
        partition_key=class_id,
    )
    return func.HttpResponse(json.dumps(results), status_code=200, mimetype="application/json")


def _create_answer_key(req: func.HttpRequest) -> func.HttpResponse:
    """Create an answer key — manual or auto-generated."""
    # TODO: if auto_generate=True, call generate_marking_scheme() with question_paper_text
    # TODO: if questions provided, validate each Question model
    # TODO: return the created AnswerKey document with generated=True/False flag
    try:
        body = req.get_json()
        class_id = body["class_id"]
        subject = body["subject"]
        auto_generate = body.get("auto_generate", False)

        if auto_generate:
            question_paper_text = body.get("question_paper_text", "")
            education_level = body.get("education_level", "grade_7")
            if not question_paper_text:
                return func.HttpResponse('{"error": "question_paper_text required for auto_generate"}', status_code=400, mimetype="application/json")
            # TODO: call generate_marking_scheme and await teacher confirmation before storing
            questions = generate_marking_scheme(question_paper_text, education_level)
            generated = True
        else:
            raw_questions = body.get("questions", [])
            questions = [Question(**q) for q in raw_questions]
            generated = False

        answer_key = AnswerKey(
            class_id=class_id,
            subject=subject,
            questions=questions,
            generated=generated,
        )
        upsert_item("answer_keys", answer_key.model_dump())
        return func.HttpResponse(answer_key.model_dump_json(), status_code=201, mimetype="application/json")

    except (KeyError, ValueError) as e:
        return func.HttpResponse(f'{{"error": "Invalid request: {e}"}}', status_code=400, mimetype="application/json")
