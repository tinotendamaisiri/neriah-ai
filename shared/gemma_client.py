"""
Gemma 4 inference client — Ollama (local) and Vertex AI (cloud) backends.

Backend selection via INFERENCE_BACKEND env var:
  "ollama"  — local Ollama server (default)
  "vertex"  — Vertex AI dedicated endpoint (VERTEX_ENDPOINT_ID required)

Ollama model routing:
  Simple / student queries         →  OLLAMA_MODEL_STUDENT  (gemma4:e2b)
  Teacher grading / complex tasks  →  OLLAMA_MODEL_TEACHER  (gemma4:latest)
  Cloud-equivalent local model     →  OLLAMA_MODEL_CLOUD    (gemma4:26b-a4b-it-q4_K_M)

Vertex AI model:
  gemma-4-26b-a4b-it on a dedicated endpoint (VERTEX_ENDPOINT_ID)

All five function signatures and JSON output schemas are backend-agnostic.
All functions return safe fallback values on error and never raise.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache

import ollama
from google import genai
from google.genai import types

from shared.config import settings

logger = logging.getLogger(__name__)


# ─── Lazy client factories ────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _ollama_client() -> ollama.Client:
    return ollama.Client(host=settings.OLLAMA_BASE_URL)


@lru_cache(maxsize=1)
def _vertex_client() -> genai.Client:
    return genai.Client(
        vertexai=True,
        project=settings.GCP_PROJECT_ID,
        location=settings.GCP_REGION,
    )


# ─── Backend dispatch ─────────────────────────────────────────────────────────

def _generate(
    prompt: str,
    image_bytes: bytes | None = None,
    complexity: str = "complex",   # "simple" | "complex"
) -> str:
    """
    Route to Ollama or Vertex AI based on INFERENCE_BACKEND.
    Returns raw model text. Raises on error (callers catch).
    """
    if settings.INFERENCE_BACKEND == "vertex":
        return _vertex_generate(prompt, image_bytes)
    return _ollama_generate(prompt, image_bytes, complexity)


def _ollama_generate(
    prompt: str,
    image_bytes: bytes | None = None,
    complexity: str = "complex",
) -> str:
    model = settings.OLLAMA_MODEL_STUDENT if complexity == "simple" else settings.OLLAMA_MODEL_TEACHER
    message: dict = {"role": "user", "content": prompt}
    if image_bytes is not None:
        message["images"] = [image_bytes]
    response = _ollama_client().chat(model=model, messages=[message])
    return response.message.content


def _vertex_generate(prompt: str, image_bytes: bytes | None = None) -> str:
    endpoint = (
        settings.VERTEX_ENDPOINT_ID
        if settings.VERTEX_ENDPOINT_ID
        else settings.VERTEX_MODEL_ID
    )
    parts: list = []
    if image_bytes is not None:
        parts.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))
    parts.append(prompt)
    response = _vertex_client().models.generate_content(
        model=endpoint,
        contents=parts,
        config=types.GenerateContentConfig(
            temperature=settings.VERTEX_TEMPERATURE,
            max_output_tokens=settings.VERTEX_MAX_OUTPUT_TOKENS,
        ),
    )
    return response.text


# ─── JSON helpers ─────────────────────────────────────────────────────────────

def _parse_json(raw: str, fallback):
    """Strip markdown fences and parse JSON. Returns fallback on failure. Never raises."""
    try:
        text = raw.strip()
        if text.startswith("```"):
            lines = text.splitlines()
            start = 1
            end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
            text = "\n".join(lines[start:end])
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
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

def grade_submission(image_bytes: bytes, answer_key: dict, education_level: str) -> list[dict]:
    """
    Reads handwriting directly from the image and grades in one multimodal call.
    No separate OCR step. Returns list of GradingVerdict dicts. Never raises.
    """
    _FALLBACK: list[dict] = []
    questions_json = json.dumps(answer_key.get("questions", []), indent=2)
    prompt = f"""You are an expert teacher marking a student's handwritten work at {education_level} level.
Grading intensity: {_intensity(education_level)}.

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


# ─── 3. Generate marking scheme ───────────────────────────────────────────────

def generate_marking_scheme(question_paper_text: str, education_level: str) -> dict:
    """
    Auto-generates an answer key from a question paper (plain text).
    Returns {"title": str, "total_marks": int, "questions": [...]}. Never raises.
    """
    _FALLBACK: dict = {"title": "Auto-generated scheme", "total_marks": 0, "questions": []}
    prompt = f"""You are an expert {education_level} teacher.
Grading standard: {_intensity(education_level)}.

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


# ─── 4. Grade document (tertiary text-based submissions) ─────────────────────

def grade_document(extracted_text: str, rubric: dict, education_level: str) -> list[dict]:
    """
    Grades a tertiary submission (text extracted from PDF/DOCX) against a rubric.
    Returns list of criterion verdict dicts. Never raises.
    """
    _FALLBACK: list[dict] = []
    rubric_json = json.dumps(rubric.get("criteria", []), indent=2)
    prompt = f"""You are a {education_level} lecturer assessing a student submission.

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
