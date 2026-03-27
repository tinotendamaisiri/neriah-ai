# shared/openai_client.py
# Azure OpenAI Service wrapper — three responsibilities:
#   1. check_image_quality     — GPT-4o-mini vision quality gate (WhatsApp pre-flight only)
#   2. grade_submission        — compare OCR text against answer key, return per-question verdicts
#   3. generate_marking_scheme — produce a full answer key from raw question paper text
#
# Uses openai.AsyncAzureOpenAI. All public functions are async.

from __future__ import annotations

import base64
import json
import logging
from typing import Any

from openai import AsyncAzureOpenAI

from .config import settings
from .models import (
    AnswerKey, CriterionVerdict, GradingVerdict, GradingVerdictEnum,
    ImageQualityResult, Question, Rubric, RubricCriterion,
)

logger = logging.getLogger(__name__)

# ── Lazy singleton client ─────────────────────────────────────────────────────
# Initialised on first call. In production, swap api_key for an
# azure.identity.aio.DefaultAzureCredential() token provider.

_client: AsyncAzureOpenAI | None = None
_gpt4o_client: AsyncAzureOpenAI | None = None


def _get_client() -> AsyncAzureOpenAI:
    """Return the module-level AsyncAzureOpenAI client, creating it on first call."""
    global _client
    if _client is None:
        _client = AsyncAzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_key,
            api_version="2024-02-01",
        )
    return _client


def _get_gpt4o_client() -> AsyncAzureOpenAI:
    """Return the GPT-4o singleton client, creating it on first call."""
    global _gpt4o_client
    if _gpt4o_client is None:
        _gpt4o_client = AsyncAzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_key,
            api_version="2024-02-01",
        )
    return _gpt4o_client


# ── 1. Image quality gate ─────────────────────────────────────────────────────

_QUALITY_SYSTEM_PROMPT = (
    "You are a document image quality checker for a homework marking system.\n"
    "Assess whether the image is clear enough for OCR text extraction.\n"
    "Respond ONLY with valid JSON matching this schema exactly:\n"
    '{"pass_check": boolean, "reason": string, "suggestion": string}\n'
    "reason must be one of: low_light, blurry, page_not_in_frame, glare_or_shadow, "
    "rotated, not_a_document, ok\n"
    "suggestion must be a friendly one-sentence instruction to the teacher in plain English.\n"
    "If pass_check is true, set reason to ok and suggestion to an empty string."
)

_QUALITY_FALLBACK = ImageQualityResult(
    pass_check=False,
    reason="parse_error",
    suggestion="Could not assess image quality. Please retake the photo and try again.",
)


async def check_image_quality(image_bytes: bytes) -> ImageQualityResult:
    """Send image to GPT-4o-mini vision to assess whether it is clear enough for OCR.

    Called ONLY from the WhatsApp pipeline before OCR. The App handles quality
    client-side via the camera frame guide, so this gate is WhatsApp-only.

    Args:
        image_bytes: Raw JPEG bytes of the inbound WhatsApp image.

    Returns:
        ImageQualityResult with pass_check, reason code, and teacher-facing suggestion.
    """
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    client = _get_client()

    response = await client.chat.completions.create(
        model=settings.azure_openai_deployment,
        max_tokens=1000,
        messages=[
            {"role": "system", "content": _QUALITY_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                    },
                    {
                        "type": "text",
                        "text": "Assess this image and respond with the JSON schema described.",
                    },
                ],
            },
        ],
    )

    raw = response.choices[0].message.content or ""
    try:
        data = json.loads(raw)
        result = ImageQualityResult(**data)
    except (json.JSONDecodeError, TypeError, ValueError):
        logger.warning("check_image_quality: failed to parse response: %r", raw)
        return _QUALITY_FALLBACK

    logger.info(
        "check_image_quality: pass=%s reason=%s", result.pass_check, result.reason
    )
    return result


# ── 2. Answer grading ─────────────────────────────────────────────────────────

_GRADING_SYSTEM_PROMPT = (
    "You are an expert homework marker for African schools.\n"
    "Grade the student's answers against the provided answer key.\n"
    "Education level: {education_level}\n"
    "Apply marking intensity appropriate to this level — be lenient for lower grades, "
    "strict for tertiary.\n"
    "Respond ONLY with valid JSON: a list of objects each matching:\n"
    '{{"question_number": int, "verdict": "correct"|"incorrect"|"partial", '
    '"awarded_marks": float, "feedback": string|null}}\n'
    "Do not include any text outside the JSON array."
)


async def grade_submission(
    ocr_text: str,
    answer_key: AnswerKey,
    education_level: str,
) -> list[GradingVerdict]:
    """Compare OCR-extracted student answers against a stored answer key.

    Grading strictness is calibrated to education_level:
        - grade_1–3  : very lenient (accept spelling variants, partial handwriting)
        - form_1–6   : standard secondary strictness
        - tertiary   : domain-rigorous, precise terminology expected

    Args:
        ocr_text:        Full text extracted from the student's page by Azure Document Intelligence.
        answer_key:      Stored AnswerKey containing questions and correct answers.
        education_level: String from EducationLevel enum, e.g. "grade_4" or "form_2".

    Returns:
        One GradingVerdict per question. Missing questions receive verdict=incorrect, marks=0.
    """
    client = _get_client()
    system_prompt = _GRADING_SYSTEM_PROMPT.format(education_level=education_level)
    user_message = (
        f"ANSWER KEY:\n{answer_key.model_dump_json()}\n\n"
        f"STUDENT ANSWERS (OCR extracted):\n{ocr_text}"
    )

    response = await client.chat.completions.create(
        model=settings.azure_openai_deployment,
        max_tokens=2000,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    )

    raw = response.choices[0].message.content or ""
    verdicts = _parse_grading_response(raw, answer_key)

    total_awarded = sum(v.awarded_marks for v in verdicts)
    total_max = sum(q.max_marks for q in answer_key.questions)
    logger.info(
        "grade_submission: score=%.1f/%.1f education_level=%s",
        total_awarded, total_max, education_level,
    )
    return verdicts


def _parse_grading_response(
    raw: str, answer_key: AnswerKey
) -> list[GradingVerdict]:
    """Parse the JSON array from the grading response.

    Fills in missing questions with verdict=incorrect, awarded_marks=0.
    Returns all-zero verdicts for every question on any parse failure.
    """
    question_numbers = {q.number for q in answer_key.questions}

    try:
        data: list[dict[str, Any]] = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("Expected a JSON array")
        verdicts = [GradingVerdict(**item) for item in data]
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        logger.error("grade_submission: failed to parse response (%s): %r", exc, raw)
        return [
            GradingVerdict(
                question_number=q.number,
                verdict=GradingVerdictEnum.INCORRECT,
                awarded_marks=0.0,
                feedback="Grading error — could not parse response",
            )
            for q in answer_key.questions
        ]

    # Fill in any questions the model missed
    returned_numbers = {v.question_number for v in verdicts}
    for q in answer_key.questions:
        if q.number not in returned_numbers:
            logger.warning(
                "grade_submission: no verdict returned for question %d — marking as not attempted",
                q.number,
            )
            verdicts.append(
                GradingVerdict(
                    question_number=q.number,
                    verdict=GradingVerdictEnum.INCORRECT,
                    awarded_marks=0.0,
                    feedback="Not attempted",
                )
            )

    return sorted(verdicts, key=lambda v: v.question_number)


# ── 3. Marking scheme generation ──────────────────────────────────────────────

_SCHEME_SYSTEM_PROMPT = (
    "You are a curriculum-aligned marking scheme generator for African schools.\n"
    "Generate a complete marking scheme for the question paper provided.\n"
    "Education level: {education_level}\n"
    "Respond ONLY with valid JSON: a list of objects each matching:\n"
    '{{"number": int, "correct_answer": string, "max_marks": float, '
    '"marking_notes": string|null}}\n'
    "Assign marks proportionally. Do not include any text outside the JSON array."
)


async def generate_marking_scheme(
    question_paper_text: str,
    education_level: str,
) -> list[Question]:
    """Auto-generate an answer key from OCR-extracted question paper text.

    Called when a teacher sends a question paper photo and requests auto-generation.
    The teacher reviews and confirms the result before it is stored as an AnswerKey.

    Args:
        question_paper_text: Full text of the question paper extracted via OCR.
        education_level:     String from EducationLevel enum — used to calibrate mark allocation.

    Returns:
        List of Question objects. Empty list on parse failure.
    """
    client = _get_client()
    system_prompt = _SCHEME_SYSTEM_PROMPT.format(education_level=education_level)

    response = await client.chat.completions.create(
        model=settings.azure_openai_deployment,
        max_tokens=1500,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question_paper_text},
        ],
    )

    raw = response.choices[0].message.content or ""
    try:
        data: list[dict[str, Any]] = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("Expected a JSON array")
        questions = [Question(**item) for item in data]
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        logger.error(
            "generate_marking_scheme: failed to parse response (%s): %r", exc, raw
        )
        return []

    logger.info(
        "generate_marking_scheme: generated %d questions for education_level=%s",
        len(questions), education_level,
    )
    return questions


# ── 4. Document grading (tertiary) ────────────────────────────────────────────

_GRADE_DOCUMENT_SYSTEM_PROMPT = (
    "You are an expert academic assessor for African tertiary institutions.\n"
    "Grade the student submission against the provided rubric.\n"
    "Education level: {education_level}\n"
    "Apply rigorous academic standards appropriate for tertiary assessment.\n"
    "Also flag if the submission appears formulaic, templated, or suspiciously\n"
    "generic — this may indicate AI generation or plagiarism.\n"
    "Respond ONLY with valid JSON object:\n"
    "{{\n"
    '  "verdicts": [\n'
    "    {{\n"
    '      "criterion_number": int,\n'
    '      "criterion_name": string,\n'
    '      "awarded_marks": float,\n'
    '      "max_marks": float,\n'
    '      "feedback": string,\n'
    '      "band": "distinction"|"merit"|"pass"|"fail"\n'
    "    }}\n"
    "  ],\n"
    '  "plagiarism_flag": boolean,\n'
    '  "plagiarism_note": string\n'
    "}}\n"
    "Do not include any text outside the JSON object."
)

_MAX_DOCUMENT_CHARS = 12000


async def grade_document(
    extracted_text: str,
    rubric: Rubric,
    education_level: str,
) -> tuple[list[CriterionVerdict], bool]:
    """Grade a tertiary student document submission against a rubric using GPT-4o.

    Args:
        extracted_text:  Full text extracted from the student's document.
        rubric:          Rubric containing criteria and band descriptors.
        education_level: Education level string, e.g. "tertiary".

    Returns:
        (verdicts, plagiarism_flag) — one CriterionVerdict per rubric criterion.
    """
    if len(extracted_text) > _MAX_DOCUMENT_CHARS:
        original_len = len(extracted_text)
        extracted_text = (
            extracted_text[:_MAX_DOCUMENT_CHARS]
            + f"\n\n[DOCUMENT TRUNCATED — {original_len} total chars]"
        )

    client = _get_gpt4o_client()
    system_prompt = _GRADE_DOCUMENT_SYSTEM_PROMPT.format(education_level=education_level)
    user_message = f"RUBRIC:\n{rubric.model_dump_json()}\n\nSTUDENT SUBMISSION:\n{extracted_text}"

    response = await client.chat.completions.create(
        model=settings.azure_openai_deployment_gpt4o,
        max_tokens=4000,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    )

    raw = response.choices[0].message.content or ""
    criterion_numbers = {c.number for c in rubric.criteria}

    try:
        data = json.loads(raw)
        verdicts = [CriterionVerdict(**v) for v in data["verdicts"]]
        plagiarism_flag: bool = data["plagiarism_flag"]
    except (json.JSONDecodeError, TypeError, ValueError, KeyError) as exc:
        logger.error("grade_document: failed to parse response (%s): %r", exc, raw)
        return (
            [
                CriterionVerdict(
                    criterion_number=c.number,
                    criterion_name=c.name,
                    awarded_marks=0.0,
                    max_marks=c.max_marks,
                    feedback="Grading error — could not parse response",
                    band="fail",
                )
                for c in rubric.criteria
            ],
            False,
        )

    # Fill in any criteria the model missed
    returned_numbers = {v.criterion_number for v in verdicts}
    for c in rubric.criteria:
        if c.number not in returned_numbers:
            logger.warning(
                "grade_document: no verdict for criterion %d (%s) — marking as not assessed",
                c.number, c.name,
            )
            verdicts.append(
                CriterionVerdict(
                    criterion_number=c.number,
                    criterion_name=c.name,
                    awarded_marks=0.0,
                    max_marks=c.max_marks,
                    feedback="Not assessed — criterion not found in response",
                    band="fail",
                )
            )

    total_score = sum(v.awarded_marks for v in verdicts)
    max_score = sum(c.max_marks for c in rubric.criteria)
    logger.info(
        "grade_document: score=%.1f/%.1f plagiarism_flag=%s education_level=%s",
        total_score, max_score, plagiarism_flag, education_level,
    )
    return sorted(verdicts, key=lambda v: v.criterion_number), plagiarism_flag


# ── 5. Rubric generation (tertiary) ──────────────────────────────────────────

_GENERATE_RUBRIC_SYSTEM_PROMPT = (
    "You are a curriculum-aligned rubric designer for African tertiary institutions.\n"
    "Generate a marking rubric for the assignment brief provided.\n"
    "Education level: {education_level}\n"
    "Number of criteria: {num_criteria}\n"
    "Total marks must sum to 100.\n"
    "Respond ONLY with valid JSON: a list of objects each matching:\n"
    "{{\n"
    '  "number": int,\n'
    '  "name": string,\n'
    '  "description": string,\n'
    '  "max_marks": float,\n'
    '  "band_descriptors": {{\n'
    '    "distinction": string,\n'
    '    "merit": string,\n'
    '    "pass": string,\n'
    '    "fail": string\n'
    "  }}\n"
    "}}\n"
    "Do not include any text outside the JSON array."
)


async def generate_rubric(
    assignment_brief: str,
    education_level: str,
    num_criteria: int = 5,
) -> list[RubricCriterion]:
    """Auto-generate a marking rubric from an assignment brief using GPT-4o.

    Args:
        assignment_brief: Raw text of the assignment brief.
        education_level:  Education level string, e.g. "tertiary".
        num_criteria:     Number of rubric criteria to generate (default 5).

    Returns:
        List of RubricCriterion objects. Empty list on parse failure.
    """
    client = _get_gpt4o_client()
    system_prompt = _GENERATE_RUBRIC_SYSTEM_PROMPT.format(
        education_level=education_level,
        num_criteria=num_criteria,
    )

    response = await client.chat.completions.create(
        model=settings.azure_openai_deployment_gpt4o,
        max_tokens=2000,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": assignment_brief},
        ],
    )

    raw = response.choices[0].message.content or ""
    try:
        data: list[dict[str, Any]] = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("Expected a JSON array")
        criteria = [RubricCriterion(**item) for item in data]
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        logger.error("generate_rubric: failed to parse response (%s): %r", exc, raw)
        return []

    total_marks = sum(c.max_marks for c in criteria)
    if not (98 <= total_marks <= 102):
        logger.warning(
            "generate_rubric: total marks %.1f is outside expected 98–102 range",
            total_marks,
        )

    logger.info(
        "generate_rubric: generated %d criteria, total_marks=%.1f education_level=%s",
        len(criteria), total_marks, education_level,
    )
    return criteria
