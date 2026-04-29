"""
Gemma 4 inference client — Vertex AI (GCP) backend.

Endpoint: https://aiplatform.googleapis.com/v1/projects/{GCP_PROJECT_ID}/
          locations/global/endpoints/openapi/chat/completions
Model:    VERTEX_MODEL_ID  (default: google/gemma-4-26b-a4b-it-maas)
Auth:     Application Default Credentials — gcloud auth / Workload Identity

All function signatures and JSON output schemas are stable.
All functions return safe fallback values on error and never raise.
"""

from __future__ import annotations

import base64
import json
import logging
import random
import re
import time

import google.auth
import google.auth.transport.requests
import requests

from shared.config import settings
from shared.errors import classify_vertex_exception, GradingEmptyError, GradingParseError

logger = logging.getLogger(__name__)

# ─── Neriah identity instruction (injected into every prompt) ─────────────────
# Prevents any underlying model from disclosing itself by name.
# validate_output in guardrails.py provides a second layer of protection.

_NERIAH_IDENTITY = (
    "IMPORTANT — IDENTITY: Your name is Neriah. You are Neriah, an AI teaching assistant "
    "for African schools. If anyone asks who you are, what AI you are, what model you are, "
    "or who made you, always respond: 'I am Neriah, your AI teaching assistant.' "
    "Never mention Gemma, Google, or any underlying model or company. "
    "Never reveal what technology or model powers you.\n"
)


# ─── Vertex AI helpers ────────────────────────────────────────────────────────

def _get_vertex_token() -> str:
    """Obtain a short-lived Bearer token from Application Default Credentials."""
    creds, _ = google.auth.default()
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


# How many times to retry a failing Vertex call before giving up. Vertex MaaS
# models (Gemma 4 26B etc.) have aggressive per-minute rate caps that throttle
# even isolated requests during cold periods, and the OpenAI-compat bridge
# returns 429 transiently while the deployment scales up. Without retries a
# single scan can surface "Grading service is at capacity" purely from a blip.
_VERTEX_MAX_ATTEMPTS = 4

# Status codes that are worth retrying — quota throttling + transient 5xx.
_VERTEX_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})

# Cap server-suggested Retry-After at 30s so a long suggestion doesn't blow
# the function timeout. Below this we honour the server hint exactly.
_VERTEX_RETRY_AFTER_CAP_SECONDS = 30


def _vertex_chat_completions(
    messages: list[dict],
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> str:
    """
    POST to the Vertex AI OpenAI-compatible chat completions endpoint.
    Retries on 429 and 5xx with exponential backoff + jitter; honours the
    Retry-After header when present (capped at 30s). Returns the assistant
    message content string. Raises classified NeriahError on persistent error.
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

    last_exc: Exception | None = None
    for attempt in range(_VERTEX_MAX_ATTEMPTS):
        try:
            response = requests.post(url, headers=headers, json=body, timeout=120)

            # Retryable status codes — back off and try again before raising.
            if response.status_code in _VERTEX_RETRY_STATUSES and attempt < _VERTEX_MAX_ATTEMPTS - 1:
                # Honour Retry-After when the server gave one; otherwise
                # exponential backoff with jitter (0.5s, 1s, 2s, 4s caps).
                ra_raw = response.headers.get("Retry-After", "")
                try:
                    server_hint = float(ra_raw)
                except ValueError:
                    server_hint = 0.0
                base = min(2 ** attempt * 0.5, 4.0)
                wait = max(server_hint, base)
                wait = min(wait, _VERTEX_RETRY_AFTER_CAP_SECONDS)
                wait += random.uniform(0, 0.25)  # jitter
                logger.warning(
                    "[vertex] %d on attempt %d/%d — backing off %.2fs (retry-after=%r)",
                    response.status_code, attempt + 1, _VERTEX_MAX_ATTEMPTS, wait, ra_raw,
                )
                time.sleep(wait)
                continue

            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]

        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
            # Transient network blips — retry, don't surface as quota error.
            last_exc = exc
            if attempt < _VERTEX_MAX_ATTEMPTS - 1:
                wait = min(2 ** attempt * 0.5, 4.0) + random.uniform(0, 0.25)
                logger.warning(
                    "[vertex] %s on attempt %d/%d — backing off %.2fs",
                    type(exc).__name__, attempt + 1, _VERTEX_MAX_ATTEMPTS, wait,
                )
                time.sleep(wait)
                continue
            raise

    # All retries exhausted on a retryable status — re-issue once more so
    # raise_for_status() turns it into a classified HTTPError for the caller.
    response = requests.post(url, headers=headers, json=body, timeout=120)
    response.raise_for_status()
    if last_exc is not None:
        raise last_exc
    return response.json()["choices"][0]["message"]["content"]


def _generate(
    prompt: str,
    image_bytes: bytes | None = None,
    complexity: str = "complex",   # kept for API compatibility — ignored, Vertex handles both
    max_tokens: int | None = None,
) -> str:
    """
    Call Vertex AI with an optional image. Returns raw model text. Raises on error.
    The ``complexity`` param is retained for call-site compatibility but has no effect —
    Vertex routes all queries through the same model.
    """
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


def chat(
    system_prompt: str,
    history: list[dict],
    current_message: str,
    image_bytes: bytes | None = None,
) -> str:
    """
    Multi-turn Vertex AI chat. Sends full message history to the model.
    Returns the assistant response text. Raises on error.
    """
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
        raw = _generate(prompt, image_bytes=image_bytes)
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
        raw = _generate(prompt, image_bytes=image_bytes)
        return _parse_json(raw, _FALLBACK)
    except Exception:
        logger.exception("extract_answer_key_from_image failed")
        return _FALLBACK


# ─── 1. Image quality gate ────────────────────────────────────────────────────

def check_image_quality(image_bytes: bytes) -> dict:
    """
    Returns {"pass": bool, "reason": str, "suggestion": str}.
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
        raw = _generate(prompt, image_bytes=image_bytes)
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

    prompt = f"""{_NERIAH_IDENTITY}
You are an expert teacher marking a student's handwritten work at {education_level} level.
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
        raw = _generate(prompt, image_bytes=image_bytes)
        parsed = _parse_json(raw, _FALLBACK)
        return parsed if isinstance(parsed, list) else _FALLBACK
    except Exception:
        logger.exception("grade_submission failed")
        return _FALLBACK


_SYLLABUS_TOKEN_BUDGET = 800
_EXAMPLES_TOKEN_BUDGET = 600
_TOTAL_TOKEN_BUDGET = 1200
_RAG_TIMEOUT_SECONDS = 2.0


def _estimate_tokens(text: str) -> int:
    """Approximate token count: words * 1.3."""
    return int(len(text.split()) * 1.3)


def _truncate_to_tokens(text: str, max_tokens: int) -> str:
    """Truncate text to approximately max_tokens."""
    words = text.split()
    target_words = int(max_tokens / 1.3)
    if len(words) <= target_words:
        return text
    return " ".join(words[:target_words]) + "..."


def _build_rag_context(
    query_text: str,
    user_context: dict,
    include_grading_examples: bool = True,
) -> str:
    """
    Retrieve RAG context with strict token budgets and concurrent fetching.

    Rules:
      - Syllabus: at most 3 chunks from 1 single syllabus file, max 800 tokens
      - Grading examples: at most 2 examples, max 600 tokens
      - Combined total: max 1200 tokens
      - Each fetch has a 2-second timeout
      - All failures degrade gracefully — never blocks grading

    Returns a formatted prompt section string, or "" if nothing found.
    Never raises.
    """
    if not user_context and not query_text:
        return ""
    try:
        import concurrent.futures  # noqa: PLC0415
        from shared.vector_db import search_with_user_context  # noqa: PLC0415

        curriculum = user_context.get("curriculum", "")
        subject = user_context.get("subject", "")
        edu_level = user_context.get("education_level", "")

        logger.info(
            "[rag] Building context: curriculum=%s subject=%s level=%s",
            curriculum or "-", subject or "-", edu_level or "-",
        )

        # ── Concurrent fetch with timeout ────────────────────────────────────
        syllabus_hits: list[dict] = []
        grading_hits: list[dict] = []

        def fetch_syllabus():
            # Fetch more than needed, then filter to single file
            return search_with_user_context("syllabuses", query_text, user_context, top_k=6)

        def fetch_examples():
            if not include_grading_examples:
                return []
            return search_with_user_context("grading_examples", query_text, user_context, top_k=2)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            syl_future = pool.submit(fetch_syllabus)
            ex_future = pool.submit(fetch_examples)

            try:
                syllabus_hits = syl_future.result(timeout=_RAG_TIMEOUT_SECONDS)
            except Exception:
                logger.warning("[rag] Syllabus fetch timed out or failed — skipping")

            try:
                grading_hits = ex_future.result(timeout=_RAG_TIMEOUT_SECONDS)
            except Exception:
                logger.warning("[rag] Examples fetch timed out or failed — skipping")

        if not syllabus_hits and not grading_hits:
            logger.info("[rag] No RAG context found for %s/%s/%s", curriculum, subject, edu_level)
            return ""

        # ── RULE 1: Single syllabus file, max 3 chunks ──────────────────────
        syl_text = ""
        syl_source = ""
        if syllabus_hits:
            # Group by source_file, pick the file with the most hits
            by_file: dict[str, list[dict]] = {}
            for hit in syllabus_hits:
                src = hit.get("metadata", {}).get("source_file", "unknown")
                by_file.setdefault(src, []).append(hit)

            # Select the single best file (most hits = most relevant)
            best_file = max(by_file, key=lambda f: len(by_file[f]))
            best_chunks = by_file[best_file][:3]  # max 3 chunks from this file
            syl_source = best_file

            chunks_text = "\n".join(
                f"• {h['text'][:500].strip().replace(chr(10), ' ')}" for h in best_chunks
            )
            syl_text = _truncate_to_tokens(chunks_text, _SYLLABUS_TOKEN_BUDGET)
            logger.info("[rag] Attached %d chunks from %s", len(best_chunks), best_file)

        # ── RULE 2: Max 2 grading examples ───────────────────────────────────
        ex_text = ""
        if grading_hits:
            ex_lines = []
            for i, hit in enumerate(grading_hits[:2], 1):
                raw = hit.get("text", "")
                # Extract key fields from the stored text
                ex_lines.append(f"Example {i}: {raw[:250].strip().replace(chr(10), ' | ')}")
            ex_text = _truncate_to_tokens("\n".join(ex_lines), _EXAMPLES_TOKEN_BUDGET)

        # ── RULE 3: Total budget enforcement ─────────────────────────────────
        syl_tokens = _estimate_tokens(syl_text)
        ex_tokens = _estimate_tokens(ex_text)
        total = syl_tokens + ex_tokens

        if total > _TOTAL_TOKEN_BUDGET:
            # Reduce examples first, then syllabus
            ex_budget = max(0, _TOTAL_TOKEN_BUDGET - syl_tokens)
            if ex_budget < ex_tokens:
                ex_text = _truncate_to_tokens(ex_text, ex_budget) if ex_budget > 50 else ""
                ex_tokens = _estimate_tokens(ex_text)
            remaining = _TOTAL_TOKEN_BUDGET - ex_tokens
            if remaining < syl_tokens:
                syl_text = _truncate_to_tokens(syl_text, remaining)

        if not syl_text and not ex_text:
            return ""

        # ── Build final context string ───────────────────────────────────────
        header_parts = [p for p in [curriculum.upper(), edu_level.upper().replace("_", " "), subject.upper()] if p]
        header = " ".join(header_parts) if header_parts else "CURRICULUM"

        parts: list[str] = []
        if syl_text:
            parts.append(f"\n--- {header} SYLLABUS CONTEXT ---")
            parts.append(syl_text)
            parts.append("--- END SYLLABUS CONTEXT ---")

        if ex_text:
            parts.append("\n--- PREVIOUSLY APPROVED GRADING EXAMPLES ---")
            parts.append(ex_text)
            parts.append("--- END EXAMPLES ---")

        result = "\n".join(parts) + "\n"
        logger.info(
            "[rag] Injected %d tokens (%d syl + %d ex) from %s for %s/%s/%s",
            _estimate_tokens(result), _estimate_tokens(syl_text), _estimate_tokens(ex_text),
            syl_source or "none", curriculum or "-", subject or "-", edu_level or "-",
        )
        return result

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
    """
    _FALLBACK: dict = {"title": "Auto-generated scheme", "total_marks": 0, "questions": []}
    ctx = user_context or {}
    curriculum = ctx.get("curriculum") or ""
    subject    = ctx.get("subject") or ""

    logger.info(
        "[gemma] generate_marking_scheme level=%s curriculum=%s subject=%s rag=%s",
        education_level, curriculum or "-", subject or "-", bool(ctx),
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

    prompt = f"""{_NERIAH_IDENTITY}
You are an expert {education_level} teacher.
Grading standard: {_intensity(education_level)}.
{f"Curriculum: {curriculum}" if curriculum else ""}
{f"Subject: {subject}" if subject else ""}
{marks_constraint}{rag_section}
Generate a complete marking scheme for the question paper below.

Question paper:
{question_paper_text}

CRITICAL: question_text MUST contain the full question as written on the paper. Never leave it empty.

Return ONLY valid JSON:
{{
  "title": "<subject or paper title>",
  "total_marks": <integer>,
  "questions": [
    {{
      "question_number": 1,
      "question_text": "<REQUIRED: the full question text from the paper>",
      "answer": "<model answer>",
      "marks": <integer>,
      "marking_notes": "<what to accept, what to penalise>"
    }}
  ]
}}

Rules:
- question_text must never be empty — transcribe every question from the paper.
- Assign realistic mark allocations proportional to question complexity.
- For maths/science, include worked solutions in the answer field.
- For essays, list key points required.
- Return raw JSON only — no markdown fences."""

    try:
        raw = _generate(prompt)
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
        f"{_NERIAH_IDENTITY}"
        f"You are an expert {education_level} examiner. {subject_line}\n"
        f"{curriculum_line}\n"
        f"Grading standard: {_intensity(education_level)}.\n"
        f"{marks_constraint}{rag_section}\n"
        "Generate a complete marking scheme for the question paper below.\n"
        "CRITICAL: question_text MUST contain the full question from the paper. Never leave it empty.\n\n"
        f"Question paper:\n{question_paper_text}\n\n"
        "Return ONLY valid JSON with no markdown fences, no extra text:\n"
        "{\n"
        '  "title": "<subject or paper title>",\n'
        '  "total_marks": <integer>,\n'
        '  "questions": [\n'
        '    {\n'
        '      "question_number": 1,\n'
        '      "question_text": "<REQUIRED: the full question text from the paper>",\n'
        '      "correct_answer": "<model answer>",\n'
        '      "marks": <integer>,\n'
        '      "marking_notes": "<what to accept, partial credit rules>"\n'
        '    }\n'
        '  ]\n'
        "}"
    )

    raw: str = ""
    try:
        raw = _generate(prompt)
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
    """
    ctx = user_context or {}
    subject = subject or ctx.get("subject") or None
    curriculum = ctx.get("curriculum") or ""
    subject_line = f"Subject: {subject}" if subject else ""

    logger.info(
        "[gemma] generate_marking_scheme_from_image level=%s curriculum=%s subject=%s rag=%s",
        education_level, curriculum or "-", subject or "-", bool(ctx),
    )

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

    prompt = f"""{_NERIAH_IDENTITY}
You are a curriculum-aligned marking scheme generator for African schools.
You are looking at a photograph of a question paper. Read the questions visible in the image.
Generate a marking scheme for UP TO 10 questions maximum. If the paper has more than 10 questions, pick the most important ones.
Education level: {education_level}
{f"Curriculum: {curriculum}" if curriculum else ""}
{subject_line}
{marks_constraint}{rag_section}

Keep correct_answer concise — one sentence maximum per question.
Assign marks proportionally based on question complexity and education level.

CRITICAL: For every question, you MUST transcribe the full question text from the image into question_text.
Do NOT leave question_text empty. Copy the question exactly as written on the paper.
If a question has multiple choice options, include them in question_text.

Respond ONLY with valid JSON matching this schema exactly — no text before or after the JSON:
{{
  "title": "string — short title for this marking scheme",
  "total_marks": number,
  "questions": [
    {{
      "number": int,
      "question_text": "string — REQUIRED: the full question text transcribed from the image",
      "correct_answer": "string — concise expected answer, one sentence max",
      "max_marks": number,
      "marking_notes": "string or null — brief guidance on partial credit only"
    }}
  ]
}}"""

    try:
        raw = _generate(prompt, image_bytes=image_bytes, max_tokens=4096)

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
        raw = _generate(prompt)
        parsed = _parse_json(raw, _FALLBACK)
        return parsed if isinstance(parsed, list) else _FALLBACK
    except Exception:
        logger.exception("grade_document failed")
        return _FALLBACK


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
        raw = _generate(prompt)
        return _parse_json(raw, _FALLBACK)
    except Exception:
        logger.exception("generate_rubric failed")
        return _FALLBACK


# ─── 6. Student AI tutor (Socratic method) ────────────────────────────────────

_TUTOR_SYSTEM_TEMPLATE = """\
{identity}
You are Neriah, a friendly and encouraging AI study companion for African students.
You help students understand their homework by using the Socratic method.

ABSOLUTE RULES — NEVER BREAK THESE:
1. NEVER give the direct answer to a homework question. Ever.
2. NEVER solve the problem for the student, even if they beg.
3. NEVER say "the answer is..." or reveal the solution.

LET THE STUDENT LEAD:
- The student picks the topic, subject, and question.
- If they say something vague like "help me practice", "explain this", or "quiz me",
  ASK them what subject and topic they want to work on. Do NOT default to one
  specific subject (like Commerce, Maths, etc.) just because that's the class
  the teacher set up — students study many subjects.
- Only assume a subject when the student names one or shares a question.

WHAT YOU DO INSTEAD:
- Ask guiding questions that lead the student to discover the answer themselves
- Provide worked examples using DIFFERENT numbers or scenarios
- Explain the underlying concept or formula
- Break complex problems into smaller, manageable steps
- Encourage the student and celebrate their progress
- If the student is stuck, give a bigger hint — but still not the answer

OUTPUT FORMAT:
- Plain text only. No Markdown — no **bold**, no *italic*, no headings (#),
  no backticks. The chat UI doesn't render Markdown so users see literal '**'
  characters. Use simple sentences and inline punctuation.
- Use "-" or "•" for bullets if needed; never "*".

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

    rag_query = message
    if weak_topics and len(message.split()) < 8:
        rag_query = message + " " + " ".join(weak_topics[:3])

    rag_section = _build_rag_context(
        query_text=rag_query,
        user_context=ctx,
        include_grading_examples=False,
    )

    curriculum_note = ""
    if rag_section:
        curriculum_note = (
            "\n\nCURRICULUM REFERENCE (your student's class syllabus — "
            "use this to give curriculum-aligned hints WHEN the student is asking "
            "about a topic that maps to it):\n" + rag_section
            + "\nIMPORTANT:\n"
            "- The reference above is just one of the student's classes. They may "
            "study other subjects. When the student names a topic that isn't in this "
            "reference (e.g. asking about Maths when the reference is Commerce), help "
            "them with that topic anyway — don't refuse and don't redirect them back "
            "to this reference.\n"
            "- When the student is vague (\"help me practice\", \"explain this\"), DO "
            "NOT assume they mean this reference's subject — ASK them what subject "
            "and topic they want to work on first."
        )

    weakness_note = ""
    if weak_topics:
        topics_str = ", ".join(weak_topics)
        weakness_note = (
            f"\n\nSTUDENT CONTEXT: This student recently struggled with: {topics_str}. "
            "If their question relates to any of these topics, use simpler language, "
            "smaller steps, and extra encouragement. Frame difficulties as learning "
            "opportunities — never as failures."
        )

    # Profile-aware addendum: age band rules, hallucination control,
    # interaction style, format hints, country-specific cultural context,
    # hard refusals. Country comes from user_context (resolved from the
    # student's phone number / school document).
    from shared.guardrails import build_system_addendum  # noqa: PLC0415
    addendum = build_system_addendum(
        role="student",
        education_level=education_level,
        subject=ctx.get("subject"),
        country=ctx.get("country"),
    )

    system_prompt = (
        _TUTOR_SYSTEM_TEMPLATE.format(identity=_NERIAH_IDENTITY, education_level=education_level)
        + curriculum_note
        + weakness_note
        + addendum
    )

    try:
        return chat(system_prompt, conversation_history, message, image_bytes)
    except Exception:
        logger.exception("student_tutor failed")
        return "I'm having a little trouble right now. Please try again in a moment!"


# ─── Raising variants for grading-critical paths ─────────────────────────────

def grade_submission_strict(
    image_bytes: bytes,
    answer_key: dict,
    education_level: str,
    user_context: dict | None = None,
) -> list[dict]:
    """
    Like grade_submission, but RAISES typed NeriahError on failure so the
    HTTP handler can return informative messages to the mobile app.

    Raises:
      VertexAITimeoutError / VertexAIQuotaError / VertexAIAuthError
      VertexAIUnavailableError — Vertex API call failed
      GradingParseError  — Gemma returned unparseable JSON
      GradingEmptyError  — Gemma returned empty verdicts
    """
    ctx = user_context or {}
    questions_json = json.dumps(answer_key.get("questions", []), indent=2)

    subject    = ctx.get("subject") or answer_key.get("subject") or ""
    curriculum = ctx.get("curriculum") or ""

    logger.info(
        "[gemma-strict] grade_submission level=%s curriculum=%s subject=%s",
        education_level, curriculum or "-", subject or "-",
    )

    rag_section = _build_rag_context(
        query_text=f"{curriculum} {subject} {education_level} {questions_json[:400]}",
        user_context=ctx,
    )

    prompt = f"""{_NERIAH_IDENTITY}
You are an expert teacher marking a student's handwritten work at {education_level} level.
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
        raw = _generate(prompt, image_bytes=image_bytes)
    except Exception as exc:
        logger.exception("[gemma-strict] Vertex call failed")
        raise classify_vertex_exception(exc) from exc

    if not raw or not raw.strip():
        logger.error("[gemma-strict] Vertex returned empty content")
        raise GradingEmptyError("Vertex returned empty string")

    parsed = _parse_json(raw, None)
    if parsed is None:
        logger.error("[gemma-strict] JSON parse failed. Raw (first 500): %.500s", raw)
        raise GradingParseError(f"JSON parse failed: {raw[:200]}")

    if not isinstance(parsed, list):
        logger.error("[gemma-strict] JSON parsed but was not a list: %s", type(parsed).__name__)
        raise GradingParseError(f"Expected JSON array, got {type(parsed).__name__}")

    if len(parsed) == 0:
        logger.error("[gemma-strict] Gemma returned empty verdicts array")
        raise GradingEmptyError("Empty verdicts array from Gemma")

    return parsed


def grade_submission_strict_multi(
    pages: list[bytes],
    answer_key: dict,
    education_level: str,
    user_context: dict | None = None,
) -> list[dict]:
    """Multi-page sibling of grade_submission_strict.

    Sends 1-5 pages to Gemma in a single call via the OpenAI-compatible
    Vertex chat-completions endpoint, with one text content-block followed
    by one image_url content-block per page (in order: page 1 first).

    The prompt asks Gemma to emit a single unified verdicts array covering
    all questions, with a `page_index` integer on each verdict indicating
    which page (0 = first) the student's answer lived on. Missing /
    out-of-range page_index values are defensively clamped to 0 so a sloppy
    model output doesn't crash the annotator downstream.

    Raises:
      VertexAITimeoutError / VertexAIQuotaError / VertexAIAuthError
      VertexAIUnavailableError — Vertex API call failed
      GradingParseError  — Gemma returned unparseable JSON or non-list
      GradingEmptyError  — Gemma returned empty content or empty array
    """
    if not pages:
        raise GradingEmptyError("No pages provided")

    ctx = user_context or {}
    questions_json = json.dumps(answer_key.get("questions", []), indent=2)

    subject    = ctx.get("subject") or answer_key.get("subject") or ""
    curriculum = ctx.get("curriculum") or ""

    logger.info(
        "[gemma-strict-multi] pages=%d level=%s curriculum=%s subject=%s",
        len(pages), education_level, curriculum or "-", subject or "-",
    )

    rag_section = _build_rag_context(
        query_text=f"{curriculum} {subject} {education_level} {questions_json[:400]}",
        user_context=ctx,
    )

    prompt = f"""{_NERIAH_IDENTITY}
You are an expert teacher marking a student's handwritten work at {education_level} level.
Grading intensity: {_intensity(education_level)}.
{f"Subject: {subject}" if subject else ""}
{f"Curriculum: {curriculum}" if curriculum else ""}
{rag_section}
The student's work spans {len(pages)} page(s). You will receive {len(pages)} image(s)
in order (page 1 first, page 2 second, etc). A single question's answer may
span two pages — read ALL pages before assigning verdicts.

Answer key:
{questions_json}

For each question in the answer key, locate the student's handwritten answer
across the pages and assess it.

Return ONE unified JSON array — one object per question, across ALL pages:
[
  {{
    "question_number": 1,
    "page_index": 0,
    "student_answer": "<verbatim text you read from the image>",
    "expected_answer": "<from answer key>",
    "verdict": "correct" | "incorrect" | "partial",
    "awarded_marks": <number>,
    "max_marks": <number from answer key>,
    "feedback": "<one constructive sentence, or null>",
    "question_x": <float 0.0-1.0>,
    "question_y": <float 0.0-1.0>
  }}
]

Rules:
- EVERY verdict MUST include a "page_index" integer field. 0 = page 1,
  1 = page 2, etc. Use the page where the student's ANSWER appeared (not
  the question number label).
- If a question is unanswered on any page, verdict is "incorrect",
  awarded_marks is 0, and page_index may be 0.
- Partial credit only where the answer key marks allow fractional marks.
- Never award more than max_marks for any question.
- "question_x" and "question_y" locate where the question NUMBER LABEL
  (e.g. "1.", "Q1", "1)") appears on its page, expressed as fractions of
  image dimensions: x from left (0.0) to right (1.0), y from top (0.0) to
  bottom (1.0). Typical margin labels sit around x=0.03-0.08. If you cannot
  find the label on the page, estimate from the order of questions
  (e.g. y = (index + 0.5) / total_questions_on_that_page).
- Return raw JSON array only — no markdown fences, no commentary."""

    # Build multi-image chat-completions content: one text block, then one
    # image_url block per page. Matches the pattern in _generate() for
    # single-image calls, just extended to N images.
    content: list = [{"type": "text", "text": prompt}]
    for page_bytes in pages:
        b64 = base64.b64encode(page_bytes).decode("utf-8")
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
        })
    messages = [{"role": "user", "content": content}]

    try:
        raw = _vertex_chat_completions(messages)
    except Exception as exc:
        logger.exception("[gemma-strict-multi] Vertex call failed")
        raise classify_vertex_exception(exc) from exc

    if not raw or not raw.strip():
        logger.error("[gemma-strict-multi] Vertex returned empty content")
        raise GradingEmptyError("Vertex returned empty string")

    parsed = _parse_json(raw, None)
    if parsed is None:
        logger.error("[gemma-strict-multi] JSON parse failed. Raw (first 500): %.500s", raw)
        raise GradingParseError(f"JSON parse failed: {raw[:200]}")

    if not isinstance(parsed, list):
        logger.error("[gemma-strict-multi] JSON parsed but was not a list: %s", type(parsed).__name__)
        raise GradingParseError(f"Expected JSON array, got {type(parsed).__name__}")

    if len(parsed) == 0:
        logger.error("[gemma-strict-multi] Gemma returned empty verdicts array")
        raise GradingEmptyError("Empty verdicts array from Gemma")

    # Defensive: clamp page_index into [0, len(pages)) so a sloppy model
    # response can't crash annotate_pages or confuse downstream UIs.
    for v in parsed:
        if not isinstance(v, dict):
            continue
        raw_pi = v.get("page_index")
        try:
            pi = int(raw_pi) if raw_pi is not None else 0
        except (TypeError, ValueError):
            pi = 0
        if pi < 0 or pi >= len(pages):
            pi = 0
        v["page_index"] = pi

    return parsed


def check_image_quality_strict(image_bytes: bytes) -> dict:
    """Like check_image_quality but raises typed NeriahError on Vertex failure."""
    prompt = (
        "You are a document quality checker. Inspect the image and return ONLY valid JSON:\n"
        '{"pass": bool, "reason": string, "suggestion": string}\n'
        "pass is true only if the image shows a clearly readable, well-lit, "
        "in-frame document page. Return raw JSON only — no markdown fences."
    )
    try:
        raw = _generate(prompt, image_bytes=image_bytes)
    except Exception as exc:
        logger.exception("[gemma-strict] quality check Vertex call failed")
        raise classify_vertex_exception(exc) from exc

    parsed = _parse_json(raw, None)
    if parsed is None or not isinstance(parsed, dict):
        logger.warning("[gemma-strict] quality check parse failed — permitting image")
        return {"pass": True, "reason": "quality check unavailable", "suggestion": ""}
    return parsed
