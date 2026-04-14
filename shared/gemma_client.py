"""
Gemma 4 inference client — Ollama (local) and Vertex AI (cloud) backends.

Backend selection via INFERENCE_BACKEND env var:
  "ollama"  — local Ollama server (default, dev)
  "vertex"  — Vertex AI Model Garden serverless via OpenAI-compatible API (production)

Ollama model routing:
  Simple / student queries         →  OLLAMA_MODEL_STUDENT  (gemma4:e2b)
  Teacher grading / complex tasks  →  OLLAMA_MODEL_TEACHER  (gemma4:latest)
  Cloud-equivalent local model     →  OLLAMA_MODEL_CLOUD    (gemma4:26b-a4b-it-q4_K_M)

Vertex AI (INFERENCE_BACKEND=vertex):
  Endpoint: https://aiplatform.googleapis.com/v1/projects/{GCP_PROJECT_ID}/
            locations/global/endpoints/openapi/chat/completions
  Model:    VERTEX_MODEL_ID  (default: google/gemma-4-26b-a4b-it-maas)
  Auth:     Application Default Credentials — gcloud auth / Workload Identity

All function signatures and JSON output schemas are backend-agnostic.
All functions return safe fallback values on error and never raise.
"""

from __future__ import annotations

import base64
import json
import logging
import re
from functools import lru_cache

import google.auth
import google.auth.transport.requests
import ollama
import requests

from shared.config import settings

logger = logging.getLogger(__name__)


# ─── Lazy client factories ────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _ollama_client() -> ollama.Client:
    return ollama.Client(host=settings.OLLAMA_BASE_URL)


# ─── Backend dispatch ─────────────────────────────────────────────────────────

def _generate(
    prompt: str,
    image_bytes: bytes | None = None,
    complexity: str = "complex",   # "simple" | "complex"
    max_tokens: int | None = None,
) -> str:
    """
    Route to Ollama or Vertex AI based on INFERENCE_BACKEND.
    Returns raw model text. Raises on error (callers catch).
    """
    if settings.INFERENCE_BACKEND == "vertex":
        return _vertex_generate(prompt, image_bytes, max_tokens=max_tokens)
    return _ollama_generate(prompt, image_bytes, complexity, max_tokens=max_tokens)


def _ollama_generate(
    prompt: str,
    image_bytes: bytes | None = None,
    complexity: str = "complex",
    max_tokens: int | None = None,
) -> str:
    model = settings.OLLAMA_MODEL_STUDENT if complexity == "simple" else settings.OLLAMA_MODEL_TEACHER
    message: dict = {"role": "user", "content": prompt}
    if image_bytes is not None:
        message["images"] = [image_bytes]
    options = {"num_predict": max_tokens} if max_tokens is not None else {}
    response = _ollama_client().chat(model=model, messages=[message], options=options or None)
    return response.message.content


def _get_vertex_token() -> str:
    """Obtain a short-lived Bearer token from Application Default Credentials."""
    creds, _ = google.auth.default()
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def _vertex_chat_completions(
    messages: list[dict],
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> str:
    """
    POST to the Vertex AI OpenAI-compatible chat completions endpoint.
    Returns the assistant message content string. Raises on HTTP error.
    """
    url = (
        f"https://aiplatform.googleapis.com/v1/projects/{settings.GCP_PROJECT_ID}"
        "/locations/global/endpoints/openapi/chat/completions"
    )
    headers = {
        "Authorization": f"Bearer {_get_vertex_token()}",
        "Content-Type": "application/json",
    }
    body: dict = {
        "model": settings.VERTEX_MODEL_ID,
        "stream": False,
        "messages": messages,
        "max_tokens": max_tokens if max_tokens is not None else settings.VERTEX_MAX_OUTPUT_TOKENS,
        "temperature": temperature if temperature is not None else settings.VERTEX_TEMPERATURE,
    }
    response = requests.post(url, headers=headers, json=body, timeout=120)
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def _vertex_generate(
    prompt: str,
    image_bytes: bytes | None = None,
    max_tokens: int | None = None,
) -> str:
    if image_bytes is not None:
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        content: list = [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            {"type": "text", "text": prompt},
        ]
        messages = [{"role": "user", "content": content}]
    else:
        messages = [{"role": "user", "content": prompt}]
    return _vertex_chat_completions(messages, max_tokens=max_tokens)


# ─── JSON helpers ─────────────────────────────────────────────────────────────

def _parse_json(raw: str, fallback):
    """
    Strip markdown code fences, repair truncated JSON, then parse.
    Returns fallback on failure. Never raises.
    """
    try:
        # Strip ```json ... ``` or ``` ... ``` fences
        clean = re.sub(r'```(?:json)?', '', raw).strip()
        if clean.endswith('```'):
            clean = clean[:-3].strip()

        # Attempt direct parse first
        try:
            return json.loads(clean)
        except (json.JSONDecodeError, ValueError):
            pass

        # Truncation repair: if the JSON doesn't end with }, find the last
        # complete object entry and close the questions array + root object.
        if not clean.endswith('}'):
            last_brace = clean.rfind('}')
            if last_brace > 0:
                repaired = clean[:last_brace + 1] + ']}'
                try:
                    return json.loads(repaired)
                except (json.JSONDecodeError, ValueError):
                    pass

        logger.warning("JSON parse failed — using fallback. Raw: %.200s", raw)
        return fallback
    except Exception:
        logger.warning("JSON parse failed — using fallback. Raw: %.200s", raw)
        return fallback


# ─── Grading intensity map ────────────────────────────────────────────────────

_INTENSITY: dict[str, str] = {
    "Grade 1": "very lenient — accept phonetic spelling and rough answers; child is 6–7 years old",
    "Grade 2": "lenient — accept phonetic spelling and simple reasoning",
    "Grade 3": "lenient — minor spelling errors are fine; reward correct ideas",
    "Grade 4": "moderate — spelling matters but allow small errors; check reasoning",
    "Grade 5": "moderate — expect clear sentences and correct basic spelling",
    "Grade 6": "moderate-strict — expect correct spelling, structured answers",
    "Grade 7": "strict — national exam level; expect complete, well-structured answers",
    "Form 1": "strict — secondary level; penalise missing steps in maths, expect paragraphs",
    "Form 2": "strict",
    "Form 3": "strict — O-Level preparation; mark schemes apply closely",
    "Form 4": "strict — O-Level standard; partial credit only for method marks",
    "Form 5 (A-Level)": "very strict — A-Level standard; domain accuracy required",
    "Form 6 (A-Level)": "very strict — A-Level standard; award marks per marking scheme exactly",
    "College/University": "academic — apply rubric precisely; partial credit for partial understanding",
}


def _intensity(level: str) -> str:
    return _INTENSITY.get(level, "strict")


# ─── WhatsApp extraction helpers ─────────────────────────────────────────────

def extract_names_from_image(image_bytes: bytes) -> list[str]:
    """
    Extracts student names from a class register photo.
    Returns a list of name strings. Never raises.
    """
    prompt = (
        "This is a class register page. Extract all student names visible.\n"
        'Return ONLY a JSON array of strings: ["First Last", ...]\n'
        "Return raw JSON only — no markdown fences."
    )
    try:
        raw = _generate(prompt, image_bytes=image_bytes, complexity="complex")
        parsed = _parse_json(raw, [])
        return parsed if isinstance(parsed, list) else []
    except Exception:
        logger.exception("extract_names_from_image failed")
        return []


def extract_answer_key_from_image(image_bytes: bytes) -> dict:
    """
    Extracts questions and answers from an answer key or question paper photo.
    Returns {"title": str, "questions": [...]}. Never raises.
    """
    _FALLBACK: dict = {}
    prompt = (
        "This is an answer key or question paper. Extract all questions and their correct answers.\n"
        'Return ONLY valid JSON: {"title": "...", "questions": ['
        '{"question_number": 1, "question_text": "...", "answer": "...", "marks": 1}]}\n'
        "Return raw JSON only — no markdown fences."
    )
    try:
        raw = _generate(prompt, image_bytes=image_bytes, complexity="complex")
        return _parse_json(raw, _FALLBACK)
    except Exception:
        logger.exception("extract_answer_key_from_image failed")
        return _FALLBACK


# ─── 1. Image quality gate ────────────────────────────────────────────────────

def check_image_quality(image_bytes: bytes) -> dict:
    """
    Returns {"pass": bool, "reason": str, "suggestion": str}.
    Uses the simple model (gemma4:2b) — fast pre-flight check.
    Returns a passing result on error to avoid blocking the pipeline.
    """
    _FALLBACK = {"pass": True, "reason": "quality check unavailable", "suggestion": ""}
    prompt = (
        "You are a document quality checker. Inspect the image and return ONLY valid JSON:\n"
        '{"pass": bool, "reason": string, "suggestion": string}\n'
        "pass is true only if the image shows a clearly readable, well-lit, "
        "in-frame document page. Return raw JSON only — no markdown fences."
    )
    try:
        raw = _generate(prompt, image_bytes=image_bytes, complexity="simple")
        return _parse_json(raw, _FALLBACK)
    except Exception:
        logger.exception("check_image_quality failed")
        return _FALLBACK


# ─── 2. Grade submission (multimodal — no OCR step) ──────────────────────────

def grade_submission(
    image_bytes: bytes,
    answer_key: dict,
    education_level: str,
    user_context: dict | None = None,
) -> list[dict]:
    """
    Reads handwriting directly from the image and grades in one multimodal call.
    No separate OCR step. Returns list of GradingVerdict dicts. Never raises.

    user_context — dict from shared.user_context.get_user_context(), containing any of:
        country, curriculum, subject, education_level
    Used to retrieve curriculum-specific RAG context (syllabus chunks + verified gradings).
    If absent or empty, grading proceeds without RAG context.
    """
    _FALLBACK: list[dict] = []
    ctx = user_context or {}
    questions_json = json.dumps(answer_key.get("questions", []), indent=2)

    subject    = ctx.get("subject") or answer_key.get("subject") or ""
    curriculum = ctx.get("curriculum") or ""

    logger.info(
        "[gemma] grade_submission level=%s curriculum=%s subject=%s "
        "weaknesses=%d rag=%s",
        education_level, curriculum or "-", subject or "-",
        len(ctx.get("weakness_topics") or []), bool(ctx),
    )

    # ── RAG context retrieval (additive — never blocks if it fails) ───────────
    rag_section = _build_rag_context(
        query_text=f"{curriculum} {subject} {education_level} {questions_json[:400]}",
        user_context=ctx,
    )

    prompt = f"""You are an expert teacher marking a student's handwritten work at {education_level} level.
Grading intensity: {_intensity(education_level)}.
{f"Subject: {subject}" if subject else ""}
{f"Curriculum: {curriculum}" if curriculum else ""}
{rag_section}
You are shown a photo of the student's exercise book. Read each handwritten answer directly from the image.

Answer key:
{questions_json}

For each question in the answer key, locate the student's handwritten answer in the image and assess it.

Return ONLY a valid JSON array — one object per question:
[
  {{
    "question_number": 1,
    "student_answer": "<verbatim text you read from the image>",
    "expected_answer": "<from answer key>",
    "verdict": "correct" | "incorrect" | "partial",
    "awarded_marks": <number>,
    "max_marks": <number from answer key>,
    "feedback": "<one constructive sentence, or null>"
  }}
]

Rules:
- If a question is unanswered, verdict is "incorrect" and awarded_marks is 0.
- Partial credit only where the answer key marks allow fractional marks.
- Never award more than max_marks for any question.
- Return raw JSON array only — no markdown fences, no commentary."""

    try:
        raw = _generate(prompt, image_bytes=image_bytes, complexity="complex")
        parsed = _parse_json(raw, _FALLBACK)
        return parsed if isinstance(parsed, list) else _FALLBACK
    except Exception:
        logger.exception("grade_submission failed")
        return _FALLBACK


def _build_rag_context(
    query_text: str,
    user_context: dict,
    include_grading_examples: bool = True,
) -> str:
    """
    Retrieve relevant syllabus chunks (and optionally verified gradings) from
    the vector DB using the user's profile as automatic filters.

    Returns a formatted prompt section string, or "" if nothing found / on error.
    Never raises.
    """
    if not user_context and not query_text:
        return ""
    try:
        from shared.vector_db import search_with_user_context  # noqa: PLC0415

        # For grading examples we also want education_level in the filter
        syllabus_hits = search_with_user_context(
            "syllabuses", query_text, user_context, top_k=3,
        )

        grading_hits: list[dict] = []
        if include_grading_examples:
            grading_hits = search_with_user_context(
                "grading_examples", query_text, user_context, top_k=3,
            )

        if not syllabus_hits and not grading_hits:
            return ""

        lines: list[str] = ["\n--- CURRICULUM CONTEXT (use to calibrate marking) ---"]
        for hit in syllabus_hits:
            snippet = hit["text"][:400].strip().replace("\n", " ")
            lines.append(f"• {snippet}")

        if grading_hits:
            lines.append("\n--- SIMILAR TEACHER-VERIFIED GRADINGS ---")
            for hit in grading_hits:
                snippet = hit["text"][:300].strip().replace("\n", " ")
                lines.append(f"• {snippet}")

        lines.append("--- END OF CONTEXT ---\n")
        return "\n".join(lines)

    except Exception:
        logger.warning("_build_rag_context failed — continuing without context")
        return ""


# ─── 3. Generate marking scheme ───────────────────────────────────────────────

def generate_marking_scheme(
    question_paper_text: str,
    education_level: str,
    user_context: dict | None = None,
    max_total_marks: int | None = None,
) -> dict:
    """
    Auto-generates an answer key from a question paper (plain text).
    Returns {"title": str, "total_marks": int, "questions": [...]}. Never raises.

    user_context — from shared.user_context.get_user_context(); used to retrieve
    curriculum marking conventions from the vector DB.
    """
    _FALLBACK: dict = {"title": "Auto-generated scheme", "total_marks": 0, "questions": []}
    ctx = user_context or {}
    curriculum = ctx.get("curriculum") or ""
    subject    = ctx.get("subject") or ""

    logger.info(
        "[gemma] generate_marking_scheme level=%s curriculum=%s subject=%s "
        "rag=%s",
        education_level, curriculum or "-", subject or "-",
        bool(ctx),
    )

    rag_section = _build_rag_context(
        query_text=f"{curriculum} {subject} {education_level} marking scheme",
        user_context=ctx,
        include_grading_examples=False,
    )

    marks_constraint = (
        f"The total marks for this paper is {max_total_marks}. "
        "Allocate marks per question accordingly.\n"
        if max_total_marks else ""
    )

    prompt = f"""You are an expert {education_level} teacher.
Grading standard: {_intensity(education_level)}.
{f"Curriculum: {curriculum}" if curriculum else ""}
{f"Subject: {subject}" if subject else ""}
{marks_constraint}{rag_section}
Generate a complete marking scheme for the question paper below.

Question paper:
{question_paper_text}

Return ONLY valid JSON:
{{
  "title": "<subject or paper title>",
  "total_marks": <integer>,
  "questions": [
    {{
      "question_number": 1,
      "question_text": "<question>",
      "answer": "<model answer>",
      "marks": <integer>,
      "marking_notes": "<what to accept, what to penalise>"
    }}
  ]
}}

Rules:
- Assign realistic mark allocations proportional to question complexity.
- For maths/science, include worked solutions in the answer field.
- For essays, list key points required.
- Return raw JSON only — no markdown fences."""

    try:
        raw = _generate(prompt, complexity="complex")
        return _parse_json(raw, _FALLBACK)
    except Exception:
        logger.exception("generate_marking_scheme failed")
        return _FALLBACK


# ─── 3a. Generate marking scheme from text (with raw-response logging) ───────

def generate_scheme_from_text(
    question_paper_text: str,
    education_level: str,
    subject: str | None = None,
    user_context: dict | None = None,
    max_total_marks: int | None = None,
) -> tuple[list[dict] | None, str | None]:
    """
    Generate a marking scheme from plain text with full logging and robust JSON parsing.

    Returns:
      (questions, None)      — success; questions is a list of question dicts
      (None, raw_response)   — Gemma responded but JSON parse failed
      (None, None)           — generation error (already logged)
    Never raises.

    user_context — from shared.user_context.get_user_context(); used to retrieve
    curriculum marking conventions from the vector DB.
    """
    ctx = user_context or {}
    curriculum = ctx.get("curriculum") or ""
    subject = subject or ctx.get("subject") or None

    logger.info(
        "[gemma] generate_scheme_from_text level=%s curriculum=%s subject=%s rag=%s",
        education_level, curriculum or "-", subject or "-", bool(ctx),
    )

    rag_section = _build_rag_context(
        query_text=f"{curriculum} {subject or ''} {education_level} marking scheme",
        user_context=ctx,
        include_grading_examples=False,
    )

    subject_line = f"Subject: {subject}" if subject else ""
    curriculum_line = f"Curriculum: {curriculum}" if curriculum else ""
    marks_constraint = (
        f"The total marks for this paper is {max_total_marks}. "
        "Allocate marks per question accordingly.\n"
        if max_total_marks else ""
    )
    prompt = (
        f"You are an expert {education_level} examiner. {subject_line}\n"
        f"{curriculum_line}\n"
        f"Grading standard: {_intensity(education_level)}.\n"
        f"{marks_constraint}{rag_section}\n"
        "Generate a complete marking scheme for the question paper below.\n\n"
        f"Question paper:\n{question_paper_text}\n\n"
        "Return ONLY valid JSON with no markdown fences, no extra text:\n"
        "{\n"
        '  "title": "<subject or paper title>",\n'
        '  "total_marks": <integer>,\n'
        '  "questions": [\n'
        '    {\n'
        '      "question_number": 1,\n'
        '      "question_text": "<full question text>",\n'
        '      "correct_answer": "<model answer>",\n'
        '      "marks": <integer>,\n'
        '      "marking_notes": "<what to accept, partial credit rules>"\n'
        '    }\n'
        '  ]\n'
        "}"
    )

    raw: str = ""
    try:
        raw = _generate(prompt, complexity="complex")
        logger.info("Gemma raw response: %.500s", raw)
        cleaned = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(cleaned)
        questions = data.get("questions", [])
        return questions, None
    except json.JSONDecodeError:
        logger.error("generate_scheme_from_text JSON parse failed. Full response: %s", raw)
        return None, raw
    except Exception:
        logger.exception("generate_scheme_from_text failed")
        return None, None


# ─── 3b. Generate marking scheme from image (multimodal) ─────────────────────

def generate_marking_scheme_from_image(
    image_bytes: bytes,
    education_level: str,
    subject: str | None = None,
    user_context: dict | None = None,
    max_total_marks: int | None = None,
) -> dict:
    """
    Auto-generates a marking scheme from a question paper photograph.
    Single multimodal call — no OCR step.
    Returns {"title": str, "total_marks": int, "questions": [...]} on success.
    Returns {"error": str, "raw_response": str} if generation fails.
    Never raises.

    user_context — from shared.user_context.get_user_context(); used to retrieve
    curriculum marking conventions from the vector DB.
    """
    ctx = user_context or {}
    subject = subject or ctx.get("subject") or None
    curriculum = ctx.get("curriculum") or ""
    subject_line = f"Subject: {subject}" if subject else ""

    logger.info(
        "[gemma] generate_marking_scheme_from_image level=%s curriculum=%s subject=%s rag=%s",
        education_level, curriculum or "-", subject or "-", bool(ctx),
    )

    # RAG: retrieve curriculum marking conventions (no grading examples needed here)
    rag_section = _build_rag_context(
        query_text=f"{curriculum} {subject or ''} {education_level} marking scheme conventions",
        user_context=ctx,
        include_grading_examples=False,
    )

    marks_constraint = (
        f"The total marks for this paper is {max_total_marks}. "
        "Allocate marks per question accordingly.\n"
        if max_total_marks else ""
    )

    prompt = f"""You are a curriculum-aligned marking scheme generator for African schools.
You are looking at a photograph of a question paper. Read the questions visible in the image.
Generate a marking scheme for UP TO 10 questions maximum. If the paper has more than 10 questions, pick the most important ones.
Education level: {education_level}
{f"Curriculum: {curriculum}" if curriculum else ""}
{subject_line}
{marks_constraint}{rag_section}

Keep correct_answer concise — one sentence maximum per question.
Assign marks proportionally based on question complexity and education level.

Respond ONLY with valid JSON matching this schema exactly — no text before or after the JSON:
{{
  "title": "string — short title for this marking scheme",
  "total_marks": number,
  "questions": [
    {{
      "number": int,
      "question_text": "string — the question as read from the image",
      "correct_answer": "string — concise expected answer, one sentence max",
      "max_marks": number,
      "marking_notes": "string or null — brief guidance on partial credit only"
    }}
  ]
}}"""

    try:
        raw = _generate(prompt, image_bytes=image_bytes, complexity="complex", max_tokens=4096)

        # Primary parse (handles markdown fences)
        parsed = _parse_json(raw, None)

        # Regex fallback — find first {...} block in case of surrounding text
        if parsed is None:
            match = re.search(r'\{[\s\S]*\}', raw)
            if match:
                try:
                    parsed = json.loads(match.group())
                except (json.JSONDecodeError, ValueError):
                    parsed = None

        if parsed is None:
            logger.warning("generate_marking_scheme_from_image: JSON parse failed. Raw: %.200s", raw)
            return {"error": "Could not generate marking scheme. Please try again.", "raw_response": raw[:500]}

        num_questions = len(parsed.get("questions", []))
        logger.info("generate_marking_scheme_from_image: generated %d question(s)", num_questions)
        return parsed

    except Exception:
        logger.exception("generate_marking_scheme_from_image failed")
        return {"error": "Could not generate marking scheme. Please try again.", "raw_response": ""}


# ─── 4. Grade document (tertiary text-based submissions) ─────────────────────

def grade_document(
    extracted_text: str,
    rubric: dict,
    education_level: str,
    user_context: dict | None = None,
) -> list[dict]:
    """
    Grades a tertiary submission (text extracted from PDF/DOCX) against a rubric.
    Returns list of criterion verdict dicts. Never raises.

    user_context — from shared.user_context.get_user_context(); used to retrieve
    curriculum context for tertiary assessment.
    """
    _FALLBACK: list[dict] = []
    ctx = user_context or {}
    curriculum = ctx.get("curriculum") or ""
    subject    = ctx.get("subject") or ""

    logger.info(
        "[gemma] grade_document level=%s curriculum=%s subject=%s weaknesses=%d rag=%s",
        education_level, curriculum or "-", subject or "-",
        len(ctx.get("weakness_topics") or []), bool(ctx),
    )

    rag_section = _build_rag_context(
        query_text=f"{curriculum} {subject} {education_level} rubric assessment",
        user_context=ctx,
        include_grading_examples=True,
    )

    rubric_json = json.dumps(rubric.get("criteria", []), indent=2)
    prompt = f"""You are a {education_level} lecturer assessing a student submission.
{f"Curriculum: {curriculum}" if curriculum else ""}
{f"Subject: {subject}" if subject else ""}
{rag_section}

Rubric criteria:
{rubric_json}

Student submission (truncated to 12 000 chars):
{extracted_text[:12000]}

For each rubric criterion, assess the submission and return ONLY a valid JSON array:
[
  {{
    "criterion_id": "<id from rubric>",
    "criterion_name": "<name>",
    "level_awarded": "<Distinction | Merit | Pass | Fail>",
    "marks_awarded": <number>,
    "max_marks": <number>,
    "justification": "<2–3 sentences citing evidence from the submission>"
  }}
]

Return raw JSON array only — no markdown fences, no commentary."""

    try:
        raw = _generate(prompt, complexity="complex")
        parsed = _parse_json(raw, _FALLBACK)
        return parsed if isinstance(parsed, list) else _FALLBACK
    except Exception:
        logger.exception("grade_document failed")
        return _FALLBACK


# ─── Multi-turn chat helpers ──────────────────────────────────────────────────

def _ollama_chat(
    system_prompt: str,
    history: list[dict],
    current_message: str,
    image_bytes: bytes | None,
    complexity: str,
) -> str:
    """Multi-turn Ollama chat. Sends full message history to the model."""
    model = settings.OLLAMA_MODEL_STUDENT if complexity == "simple" else settings.OLLAMA_MODEL_TEACHER
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    user_msg: dict = {"role": "user", "content": current_message}
    if image_bytes is not None:
        user_msg["images"] = [image_bytes]
    messages.append(user_msg)
    response = _ollama_client().chat(model=model, messages=messages)
    return response.message.content


def _vertex_chat(
    system_prompt: str,
    history: list[dict],
    current_message: str,
    image_bytes: bytes | None,
) -> str:
    """Multi-turn Vertex AI chat via OpenAI-compatible endpoint."""
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    if image_bytes is not None:
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        content: list = [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            {"type": "text", "text": current_message},
        ]
        messages.append({"role": "user", "content": content})
    else:
        messages.append({"role": "user", "content": current_message})
    return _vertex_chat_completions(messages)


# ─── 5. Generate rubric ───────────────────────────────────────────────────────

def generate_rubric(assignment_brief: str, education_level: str, num_criteria: int = 5) -> dict:
    """
    Generates an assessment rubric for a tertiary assignment brief.
    Returns {"title": str, "total_marks": 100, "criteria": [...]}. Never raises.
    """
    _FALLBACK: dict = {"title": "Assessment Rubric", "total_marks": 100, "criteria": []}
    prompt = f"""You are an experienced {education_level} lecturer.
Create a detailed assessment rubric for the following assignment.

Assignment brief:
{assignment_brief}

Generate exactly {num_criteria} criteria. All criteria marks must sum to 100.

Return ONLY valid JSON:
{{
  "title": "<assignment title>",
  "total_marks": 100,
  "criteria": [
    {{
      "id": "C1",
      "name": "<criterion name>",
      "description": "<what is being assessed>",
      "marks": <integer>,
      "levels": {{
        "Distinction": "<descriptor for 85–100%>",
        "Merit": "<descriptor for 65–84%>",
        "Pass": "<descriptor for 50–64%>",
        "Fail": "<descriptor for below 50%>"
      }}
    }}
  ]
}}

Return raw JSON only — no markdown fences."""

    try:
        raw = _generate(prompt, complexity="complex")
        return _parse_json(raw, _FALLBACK)
    except Exception:
        logger.exception("generate_rubric failed")
        return _FALLBACK


# ─── 6. Student AI tutor (Socratic method) ────────────────────────────────────

_TUTOR_SYSTEM_TEMPLATE = """\
You are Neriah, a friendly and encouraging AI study companion for African students.
You help students understand their homework by using the Socratic method.

ABSOLUTE RULES — NEVER BREAK THESE:
1. NEVER give the direct answer to a homework question. Ever.
2. NEVER solve the problem for the student, even if they beg.
3. NEVER say "the answer is..." or reveal the solution.

WHAT YOU DO INSTEAD:
- Ask guiding questions that lead the student to discover the answer themselves
- Provide worked examples using DIFFERENT numbers or scenarios
- Explain the underlying concept or formula
- Break complex problems into smaller, manageable steps
- Encourage the student and celebrate their progress
- If the student is stuck, give a bigger hint — but still not the answer

TONE:
- Warm, patient, encouraging
- Use simple language appropriate for the education level
- Occasionally use phrases in context ("Well done!" / "You're getting there!")
- Keep responses concise — 2-4 sentences per turn, not essays

Education level: {education_level}
Adjust your language complexity and examples to match this level.
A Grade 3 student gets simpler language than a Form 4 student.\
"""


def student_tutor(
    message: str,
    conversation_history: list[dict],
    education_level: str,
    image_bytes: bytes | None = None,
    user_context: dict | None = None,
) -> str:
    """
    Socratic-method AI tutor for students. Never gives direct answers.

    ``conversation_history`` is a list of prior turns:
        [{"role": "user"|"assistant", "content": "..."}, ...]

    If ``image_bytes`` is provided, the student has photographed a homework question.
    user_context — from shared.user_context.get_user_context(); used to retrieve
    relevant curriculum sections so Neriah answers using the student's actual syllabus.

    Returns the tutor's response text. Never raises.
    """
    ctx = user_context or {}
    weak_topics: list[str] = ctx.get("weakness_topics") or []

    logger.info(
        "[gemma] student_tutor level=%s curriculum=%s subject=%s weaknesses=%d rag=%s",
        education_level,
        ctx.get("curriculum", "-"),
        ctx.get("subject", "-"),
        len(weak_topics),
        bool(ctx),
    )

    # Augment short/generic queries with weak topics so RAG retrieves relevant content
    rag_query = message
    if weak_topics and len(message.split()) < 8:
        rag_query = message + " " + " ".join(weak_topics[:3])

    # RAG: retrieve relevant curriculum content for this student's question
    rag_section = _build_rag_context(
        query_text=rag_query,
        user_context=ctx,
        include_grading_examples=False,
    )

    # Append curriculum context to system prompt when available
    curriculum_note = ""
    if rag_section:
        curriculum_note = (
            "\n\nCURRICULUM REFERENCE (your student's actual syllabus — "
            "use this to give curriculum-aligned hints):\n" + rag_section
        )

    # Append weakness context so Neriah gives extra patience on known weak areas
    weakness_note = ""
    if weak_topics:
        topics_str = ", ".join(weak_topics)
        weakness_note = (
            f"\n\nSTUDENT CONTEXT: This student recently struggled with: {topics_str}. "
            "If their question relates to any of these topics, use simpler language, "
            "smaller steps, and extra encouragement. Frame difficulties as learning "
            "opportunities — never as failures."
        )

    system_prompt = (
        _TUTOR_SYSTEM_TEMPLATE.format(education_level=education_level)
        + curriculum_note
        + weakness_note
    )

    try:
        if settings.INFERENCE_BACKEND == "vertex":
            return _vertex_chat(system_prompt, conversation_history, message, image_bytes)
        return _ollama_chat(system_prompt, conversation_history, message, image_bytes, complexity="simple")
    except Exception:
        logger.exception("student_tutor failed")
        return "I'm having a little trouble right now. Please try again in a moment!"
