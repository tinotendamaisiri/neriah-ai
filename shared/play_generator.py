"""
Neriah Play — multiple-choice question generator.

Generates a bank of 70-100 unique MCQs from arbitrary source content (notes,
chapter excerpts, syllabus topics) by repeatedly prompting cloud Gemma 4
via the existing Vertex AI MaaS client (`shared.gemma_client._vertex_chat_completions`).

Pipeline:
  1. Request a batch of N=25 fresh questions in JSON, telling the model
     which prompts have already been covered so it can produce distinct ones.
  2. Parse the JSON, run dedup against:
       - normalised-prompt hash (lowercased, punctuation stripped, whitespace collapsed)
       - semantic similarity via shared.embeddings.get_embedding (cosine ≥ 0.85 → reject)
  3. Validate every question (prompt ≤ 80 chars truncated to nearest word,
     options ≤ 25 chars truncated likewise, exactly 4 options).
  4. Position-randomise the ``correct`` index across the final bank so each
     of A/B/C/D appears roughly 25% of the time — prevents pattern-matchers
     from cheesing the answer position.
  5. Stop when ≥ ``target`` unique questions or 3 consecutive batches yield
     < 5 new uniques.

Logs ``play.generation.batch.success`` / ``.failed`` per batch so the admin
dashboard can see how the generator is performing.

The on-device path (Gemma 4 E2B running in LiteRT-LM on the mobile device)
is intentionally not implemented here — the mobile client owns that
codepath. ``use_on_device=True`` is reserved for forward-compat and raises
``NotImplementedError`` on the backend.
"""

from __future__ import annotations

import json
import logging
import math
import random
import re
from typing import Optional, Sequence

from shared.embeddings import get_embedding
from shared.gemma_client import _vertex_chat_completions
from shared.models import PlayQuestion
from shared.observability import log_event

logger = logging.getLogger(__name__)


# ─── Tunables ─────────────────────────────────────────────────────────────────

_BATCH_SIZE = 30               # 30 keeps each call comfortably under max_tokens
_MAX_BATCHES = 20              # hard upper bound on Gemma calls per generation
_LOW_YIELD_BATCHES_BEFORE_ESCALATE = 3
_ZERO_YIELD_BATCHES_BEFORE_STOP = 4
_LOW_YIELD_THRESHOLD = 5       # fewer than this many uniques per batch = "low yield"
_SEMANTIC_DUP_COSINE = 0.85    # cosine ≥ threshold → treated as a duplicate

_GEMMA_MAX_TOKENS = 6144

_PROMPT_MAX_CHARS = 80
_OPTION_MAX_CHARS = 25

# Escalation tiers driving the generator prompt. We climb tiers when the
# previous tier stops yielding fresh questions; tier 0 is "stay grounded
# in the student's notes", tier 2 is "produce review questions on the
# topic / level alone". The strictness contract — every lesson lands at
# the target count — depends on the highest tier being able to fill any
# gap.
_TIER_GROUNDED = 0
_TIER_EXPAND = 1
_TIER_FUNDAMENTALS = 2


# ─── Public API ───────────────────────────────────────────────────────────────

def generate_lesson_questions(
    source_content: str,
    target: int = 100,
    minimum: int = 70,
    existing_questions: Optional[list[PlayQuestion]] = None,
    use_on_device: bool = False,
    topic_hint: Optional[str] = None,
    auto_expand: bool = True,
) -> tuple[list[PlayQuestion], int, bool]:
    """Generate a bank of ``target`` unique MCQs from ``source_content``.

    When the source content is sparse and Gemma starts producing low-yield
    batches before reaching ``target``, the generator automatically switches
    to broader-topic mode and keeps batching using ``topic_hint`` (title /
    subject / level) as the anchor. The student is no longer prompted to
    "expand" — one POST always returns a full lesson.

    Args:
        source_content:     Free-form study material the questions cover.
        target:             Goal size of the bank. Defaults to 100.
        minimum:            Legacy parameter — the route handler used to
                            flip ``is_draft`` below this. Kept in the
                            signature for back-compat; no longer affects
                            generation since auto-expand fills any gap.
        existing_questions: Already-saved questions (e.g. on /expand and
                            /append calls). New questions are dedup'd
                            against these too.
        use_on_device:      Reserved for mobile clients that run Gemma 4
                            E2B locally via LiteRT-LM. Always raises
                            ``NotImplementedError`` on the backend.
        topic_hint:         Free-form anchor (e.g. "Photosynthesis · Science
                            · Form 3") used to seed broader-topic batches
                            when the user's source content is exhausted.
        auto_expand:        When True (default), low-yield batches trigger
                            broader-topic generation rather than stopping.

    Returns:
        ``(questions, count, was_expanded)``. ``was_expanded`` is True iff
        broader-topic batches contributed at least one question.
    """
    if use_on_device:
        raise NotImplementedError(
            "on-device generation runs on the mobile client, not the backend"
        )

    source_content = (source_content or "").strip()
    if not source_content:
        return [], 0, False

    accumulated: list[PlayQuestion] = list(existing_questions or [])

    # Pre-compute prompt fingerprints + embeddings for dedup. Embedding
    # failures degrade gracefully — exact-match dedup still applies.
    seen_hashes: set[str] = set()
    seen_embeddings: list[list[float]] = []
    for q in accumulated:
        h = _normalised_hash(q.prompt)
        if h:
            seen_hashes.add(h)
        emb = get_embedding(q.prompt) or []
        if emb:
            seen_embeddings.append(emb)

    consecutive_low_yield = 0
    consecutive_zero_yield = 0
    batch_n = 0
    tier = _TIER_GROUNDED
    accumulated_count_when_expand_started: Optional[int] = None

    while batch_n < _MAX_BATCHES and len(accumulated) < target:
        batch_n += 1
        # Always ask for at least the full batch size — undersizing the
        # request lets dedup eat us back below target on the last batch.
        request_n = max(_BATCH_SIZE, target - len(accumulated))

        try:
            raw = _ask_gemma_for_batch(
                source_content=source_content,
                already_covered_prompts=[q.prompt for q in accumulated],
                requested=request_n,
                topic_hint=topic_hint,
                tier=tier,
            )
        except Exception as exc:
            logger.exception("[play] batch %d Gemma call failed", batch_n)
            log_event(
                "play.generation.batch.failed",
                "error",
                payload={
                    "batch_n": batch_n,
                    "requested": request_n,
                    "total_so_far": len(accumulated),
                    "error_type": type(exc).__name__,
                    "tier": tier,
                },
                surface="play",
            )
            consecutive_zero_yield += 1
            consecutive_low_yield += 1
            if consecutive_zero_yield >= _ZERO_YIELD_BATCHES_BEFORE_STOP:
                # Repeated hard failures — the model is unreachable. Stop
                # rather than burn the rest of the batch budget.
                break
            continue

        parsed = _parse_questions_json(raw)
        validation_rejects = 0
        dedup_rejects = 0
        added_this_batch = 0

        for raw_q in parsed:
            try:
                q = _coerce_and_validate(raw_q)
            except ValueError:
                validation_rejects += 1
                continue
            if q is None:
                validation_rejects += 1
                continue

            h = _normalised_hash(q.prompt)
            if not h or h in seen_hashes:
                dedup_rejects += 1
                continue

            # Semantic dup check. Soft-fail: if the embedding service is
            # unhealthy we still accept the question rather than block the
            # generator entirely.
            emb = get_embedding(q.prompt) or []
            if emb and any(
                _cosine(emb, prev) >= _SEMANTIC_DUP_COSINE
                for prev in seen_embeddings
            ):
                dedup_rejects += 1
                continue

            seen_hashes.add(h)
            if emb:
                seen_embeddings.append(emb)
            accumulated.append(q)
            added_this_batch += 1

            if len(accumulated) >= target:
                break

        log_event(
            "play.generation.batch.success",
            "info",
            payload={
                "batch_n": batch_n,
                "requested": request_n,
                "parsed": len(parsed),
                "kept": added_this_batch,
                "total_so_far": len(accumulated),
                "dedup_rejects": dedup_rejects,
                "validation_rejects": validation_rejects,
                "tier": tier,
            },
            surface="play",
        )

        if added_this_batch == 0:
            consecutive_zero_yield += 1
        else:
            consecutive_zero_yield = 0

        if added_this_batch < _LOW_YIELD_THRESHOLD:
            consecutive_low_yield += 1
        else:
            consecutive_low_yield = 0

        # Tier escalation. Climb a tier whenever the current one stalls
        # *and* we still need more questions to hit the target. This is
        # what makes "always 100" workable: notes-grounded → broader topic
        # → fundamentals of the subject at the level. The fundamentals
        # tier is open-ended and should never run out of material.
        if (
            consecutive_low_yield >= _LOW_YIELD_BATCHES_BEFORE_ESCALATE
            and len(accumulated) < target
        ):
            if auto_expand and tier < _TIER_FUNDAMENTALS:
                tier += 1
                if tier == _TIER_EXPAND and accumulated_count_when_expand_started is None:
                    accumulated_count_when_expand_started = len(accumulated)
                consecutive_low_yield = 0
                log_event(
                    "play.generation.tier_escalate",
                    "info",
                    payload={
                        "batch_n": batch_n,
                        "to_tier": tier,
                        "have": len(accumulated),
                        "target": target,
                    },
                    surface="play",
                )
                continue
            # Already at the highest tier and still stalling — only stop
            # when the model is producing literally zero, otherwise keep
            # squeezing batches until the budget is exhausted.
            if consecutive_zero_yield >= _ZERO_YIELD_BATCHES_BEFORE_STOP:
                logger.info(
                    "[play] stopping at top tier after %d batches: %d zero-yield rounds (have %d)",
                    batch_n, consecutive_zero_yield, len(accumulated),
                )
                break

    # Trim to target if we overshot, then position-randomise the
    # correct-answer index so it's roughly uniform over A/B/C/D.
    if len(accumulated) > target:
        accumulated = accumulated[:target]

    randomised = _position_randomise(accumulated)
    _ = minimum  # passed in by callers; auto-expand makes the draft flag
                 # almost always False — kept for back-compat callers.
    was_expanded = (
        accumulated_count_when_expand_started is not None
        and len(accumulated) > accumulated_count_when_expand_started
    )
    return randomised, len(randomised), was_expanded


# ─── Gemma prompt construction ────────────────────────────────────────────────

def _ask_gemma_for_batch(
    *,
    source_content: str,
    already_covered_prompts: Sequence[str],
    requested: int,
    topic_hint: Optional[str] = None,
    tier: int = _TIER_GROUNDED,
) -> str:
    """Build the Gemma 4 prompt and return the raw assistant text.

    ``tier`` controls scope:
      0 (grounded)     — questions strictly from the supplied notes.
      1 (expand)       — broader related concepts of the same topic.
      2 (fundamentals) — open-ended review at the student's level using
                         topic_hint as the anchor; the notes are kept for
                         flavour but no longer constrain the questions.

    Higher tiers are how we keep the contract that one /play/lessons POST
    always returns 100 questions even when the source notes are thin.
    """
    # Truncate the already-covered list aggressively — we only need enough
    # context for the model to avoid the most-recent overlap. Sending the
    # full 90-prompt list every time wastes context tokens and isn't
    # measurably better than the last 30.
    recent = list(already_covered_prompts[-30:])
    covered_block = (
        "\n".join(f"- {p}" for p in recent)
        if recent else "(none yet — this is the first batch)"
    )

    anchor = (topic_hint or "").strip() or "the same topic as the study material"

    system = (
        "You are an expert quiz writer for the Neriah Play game. "
        "You produce high-quality, age-appropriate multiple-choice "
        "questions from study material. Output JSON only — no markdown, "
        "no commentary."
    )

    if tier >= _TIER_FUNDAMENTALS:
        scope_block = (
            f"You MUST produce exactly {requested} fresh review questions on "
            f"the topic: {anchor}. Cover core definitions, worked examples, "
            f"applications, and common misconceptions a student at this level "
            f"would meet. The notes below are kept only as flavour — do not "
            f"limit yourself to them. Do not jump above the implied level."
        )
    elif tier >= _TIER_EXPAND:
        scope_block = (
            f"The student's notes below have been exhausted. Generate questions "
            f"covering broader related concepts, real-world applications, and "
            f"common misconceptions for the topic: {anchor}. Stay within the "
            f"educational level implied by the notes — do not jump grades."
        )
    else:
        scope_block = (
            "Generate questions strictly grounded in the study material below. "
            "Do not introduce facts that aren't supported by the notes."
        )

    user = f"""Generate {requested} fresh multiple-choice questions.

{scope_block}

REQUIREMENTS:
- Output EXACTLY {requested} questions — never fewer.
- Each question's "prompt" MUST be 80 characters or fewer.
- Each option in "options" MUST be 25 characters or fewer.
- Provide EXACTLY 4 options per question.
- "correct" is the zero-based index (0, 1, 2, or 3) of the right option in the options list.
- Each question must be DISTINCT from the "already covered" list below — no rewording, no near-duplicates.
- Vary difficulty and topic; avoid trivia about names that aren't in the source.

OUTPUT FORMAT (raw JSON, no fences):
[
  {{"prompt": "...", "options": ["...", "...", "...", "..."], "correct": 0}},
  ...
]

ALREADY COVERED (do not repeat or paraphrase):
{covered_block}

STUDY MATERIAL:
{source_content}
"""

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    # 30 questions at ~120 tokens each + JSON overhead → 6 KB room.
    return _vertex_chat_completions(messages, max_tokens=_GEMMA_MAX_TOKENS, temperature=0.7)


def _parse_questions_json(raw: str) -> list[dict]:
    """Tolerant JSON extractor — accepts the array wrapped in optional code
    fences, with optional preamble text, etc. Returns [] on failure."""
    if not raw:
        return []
    text = raw.strip()
    # Strip ``` / ```json fences.
    text = re.sub(r"^```(?:json)?\s*", "", text)
    if text.endswith("```"):
        text = text[:-3].strip()

    # Try direct parse first.
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return [d for d in data if isinstance(d, dict)]
        if isinstance(data, dict) and isinstance(data.get("questions"), list):
            return [d for d in data["questions"] if isinstance(d, dict)]
    except (json.JSONDecodeError, ValueError):
        pass

    # Fallback — extract the first JSON array we can find.
    start = text.find("[")
    end = text.rfind("]")
    if 0 <= start < end:
        try:
            data = json.loads(text[start: end + 1])
            if isinstance(data, list):
                return [d for d in data if isinstance(d, dict)]
        except (json.JSONDecodeError, ValueError):
            pass

    logger.warning("[play] could not parse Gemma batch as JSON: %.200s", raw)
    return []


# ─── Validation + truncation ──────────────────────────────────────────────────

def _coerce_and_validate(raw_q: dict) -> Optional[PlayQuestion]:
    """Best-effort coerce a raw dict into a PlayQuestion.

    - Truncates over-long prompt / options to the limit at the nearest
      word break (with ellipsis suffix) before validation runs.
    - Normalises ``correct`` to an int in [0, 3].
    - Returns None when the row is unusable (not 4 options, missing keys,
      etc.) so the caller can drop it.
    """
    prompt = raw_q.get("prompt")
    options = raw_q.get("options")
    correct = raw_q.get("correct")

    if not isinstance(prompt, str) or not isinstance(options, list):
        return None
    if len(options) != 4:
        return None

    prompt = _truncate_to_words(prompt.strip(), _PROMPT_MAX_CHARS)
    if not prompt:
        return None

    cleaned_options: list[str] = []
    for opt in options:
        if not isinstance(opt, str):
            return None
        truncated = _truncate_to_words(opt.strip(), _OPTION_MAX_CHARS)
        if not truncated:
            return None
        cleaned_options.append(truncated)

    try:
        correct_int = int(correct)
    except (TypeError, ValueError):
        return None
    if correct_int < 0 or correct_int > 3:
        return None

    try:
        return PlayQuestion(
            prompt=prompt,
            options=cleaned_options,
            correct=correct_int,
        )
    except Exception:
        return None


def _truncate_to_words(text: str, max_chars: int) -> str:
    """Truncate ``text`` to at most ``max_chars`` characters, preferring a
    word boundary and appending an ellipsis when truncation happens.

    We use the unicode ellipsis "…" (1 char) so the suffix counts as one
    char against the cap.
    """
    if text is None:
        return ""
    text = text.strip()
    if len(text) <= max_chars:
        return text
    # Reserve one char for the ellipsis.
    cap = max_chars - 1
    if cap <= 0:
        return text[:max_chars]
    cut = text[:cap]
    space = cut.rfind(" ")
    # Only word-break when the break is reasonably close to the end —
    # otherwise we'd chop off most of a long single token.
    if space >= max(1, int(cap * 0.5)):
        cut = cut[:space]
    return cut.rstrip() + "…"


# ─── Dedup helpers ────────────────────────────────────────────────────────────

_PUNCT_RE = re.compile(r"[^\w\s]+", flags=re.UNICODE)


def _normalised_hash(prompt: str) -> str:
    """Lowercase + strip punctuation + collapse whitespace.

    Returns the canonical form (used as a hash key directly — sets dedupe
    on equality, no need for an extra hash function call).
    """
    if not prompt:
        return ""
    s = prompt.lower()
    s = _PUNCT_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity between two equal-length float sequences. Returns
    0.0 on length mismatch or zero-magnitude vectors so callers can use
    a simple ``>=`` threshold check without special-casing."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


# ─── Position randomisation ──────────────────────────────────────────────────

def _position_randomise(questions: list[PlayQuestion]) -> list[PlayQuestion]:
    """Shuffle the ``correct`` slot across the bank so A/B/C/D each appear
    roughly 25% of the time. Mutates a fresh copy — input is not changed.

    Strategy: build a list of target positions [0,1,2,3] cycled enough to
    cover every question, shuffle it, then for each question move the
    correct option into the target slot.
    """
    n = len(questions)
    if n == 0:
        return []

    rng = random.Random()
    targets: list[int] = [i % 4 for i in range(n)]
    rng.shuffle(targets)

    out: list[PlayQuestion] = []
    for q, target_pos in zip(questions, targets):
        if q.correct == target_pos:
            out.append(q)
            continue
        new_options = list(q.options)
        # Swap so the originally-correct answer ends up at ``target_pos``.
        new_options[q.correct], new_options[target_pos] = (
            new_options[target_pos],
            new_options[q.correct],
        )
        try:
            out.append(PlayQuestion(
                prompt=q.prompt,
                options=new_options,
                correct=target_pos,
            ))
        except Exception:
            # If the swap somehow produced an invalid row (shouldn't —
            # length is preserved), keep the original.
            out.append(q)
    return out
