# shared/annotator.py
# Pillow annotation pipeline — draws grading markup onto student exercise book photos.
# Pure CPU/memory work; no external API calls, no async.
# Called from mark.py after grading; result is uploaded to Azure Blob Storage.

from __future__ import annotations

import io
import logging
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .models import AnswerRegion, GradingVerdict, GradingVerdictEnum

logger = logging.getLogger(__name__)

# ── Colour constants ──────────────────────────────────────────────────────────

CORRECT_GREEN  = (34, 197, 94)
INCORRECT_RED  = (239, 68, 68)
PARTIAL_ORANGE = (249, 115, 22)
TEXT_WHITE     = (255, 255, 255)
TEXT_DARK      = (30, 30, 30)

# ── Layout constants ──────────────────────────────────────────────────────────

CIRCLE_RADIUS      = 14       # px — filled badge radius
UNDERLINE_THICKNESS = 3       # px
RIGHT_MARGIN_X_OFFSET = 60    # px from right edge for score labels
BANNER_HEIGHT      = 40       # px — score summary bar at image bottom
FONT_SIZE_SYMBOL   = 16       # pt — tick/cross glyph inside circle
FONT_SIZE_MARGIN   = 15       # pt — score label in right margin
FONT_SIZE_BANNER   = 18       # pt — score summary banner

# ── Font loading (module-level, loaded once) ──────────────────────────────────

_FONT_PATH = Path(__file__).parent / "fonts" / "DejaVuSans-Bold.ttf"


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load DejaVuSans-Bold at the requested point size.
    Falls back to Pillow's built-in bitmap font if the TTF is missing.
    """
    if _FONT_PATH.exists():
        try:
            return ImageFont.truetype(str(_FONT_PATH), size)
        except (IOError, OSError) as exc:
            logger.warning("annotator: could not load font %s (%s) — using default", _FONT_PATH, exc)
    else:
        logger.warning("annotator: font not found at %s — using Pillow default font", _FONT_PATH)
    return ImageFont.load_default()


# Load fonts once at module import — avoids repeated file I/O per image
_font_symbol = _load_font(FONT_SIZE_SYMBOL)
_font_margin = _load_font(FONT_SIZE_MARGIN)
_font_banner = _load_font(FONT_SIZE_BANNER)


# ── Public function ───────────────────────────────────────────────────────────

def annotate_image(
    image_bytes: bytes,
    regions: list[AnswerRegion],
    verdicts: list[GradingVerdict],
) -> bytes:
    """Draw grading markup onto the original photo and return annotated JPEG bytes.

    For each GradingVerdict:
        CORRECT  — green filled circle + ✓ glyph left of region, "+{marks}" in right margin
        INCORRECT — red filled circle + ✗ glyph left of region, "0" in right margin
        PARTIAL  — orange underline beneath region, "{marks}/{assumed_max}" in right margin

    Adds a score summary banner at the bottom of the image.
    The original image_bytes is not modified — a copy is opened.

    Args:
        image_bytes: Raw JPEG bytes of the original scan.
        regions:     List of AnswerRegion from ocr_client.group_answer_regions().
        verdicts:    List of GradingVerdict from openai_client.grade_submission().

    Returns:
        Annotated JPEG bytes at quality=92.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    draw = ImageDraw.Draw(img)

    verdict_map = _build_verdict_map(regions, verdicts)

    for question_number, (region, verdict) in verdict_map.items():
        cx = int(region.x - CIRCLE_RADIUS - 4)          # left of region, with small gap
        cy = int(region.y + region.height / 2)           # vertical centre of region
        margin_x = img.width - RIGHT_MARGIN_X_OFFSET
        margin_y = int(region.y + region.height / 2) - FONT_SIZE_MARGIN // 2

        if verdict.verdict == GradingVerdictEnum.CORRECT:
            _draw_circle_with_symbol(draw, cx, cy, CIRCLE_RADIUS, CORRECT_GREEN, "✓")
            _draw_margin_label(draw, margin_x, margin_y, f"+{verdict.awarded_marks:g}", CORRECT_GREEN)

        elif verdict.verdict == GradingVerdictEnum.INCORRECT:
            _draw_circle_with_symbol(draw, cx, cy, CIRCLE_RADIUS, INCORRECT_RED, "✗")
            _draw_margin_label(draw, margin_x, margin_y, "0", INCORRECT_RED)

        elif verdict.verdict == GradingVerdictEnum.PARTIAL:
            # Underline: full width of the answer region, 3px thick
            underline_y = int(region.y + region.height + 2)
            draw.line(
                [(int(region.x), underline_y), (int(region.x + region.width), underline_y)],
                fill=PARTIAL_ORANGE,
                width=UNDERLINE_THICKNESS,
            )
            # Estimate max marks for this question: awarded is what was given;
            # assume the question was worth 1.0 if we only have awarded_marks
            assumed_max = max(verdict.awarded_marks, 1.0)
            _draw_margin_label(
                draw, margin_x, margin_y,
                f"{verdict.awarded_marks:g}/{assumed_max:g}",
                PARTIAL_ORANGE,
            )

    _draw_score_banner(draw, img.width, img.height, verdicts)

    logger.info(
        "annotate_image: size=%dx%d verdicts=%d",
        img.width, img.height, len(verdicts),
    )

    output = io.BytesIO()
    img.save(output, format="JPEG", quality=92)
    return output.getvalue()


# ── Drawing helpers ───────────────────────────────────────────────────────────

def _draw_circle_with_symbol(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    radius: int,
    fill_colour: tuple,
    symbol: str,
) -> None:
    """Draw a filled circle at (cx, cy) then centre the symbol glyph inside it in white."""
    cx_i, cy_i = int(cx), int(cy)
    draw.ellipse(
        [(cx_i - radius, cy_i - radius), (cx_i + radius, cy_i + radius)],
        fill=fill_colour,
    )
    # Use textbbox to measure the glyph and centre it precisely inside the circle
    bbox = draw.textbbox((0, 0), symbol, font=_font_symbol)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    text_x = cx_i - text_w // 2
    text_y = cy_i - text_h // 2
    draw.text((text_x, text_y), symbol, font=_font_symbol, fill=TEXT_WHITE)


def _draw_margin_label(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    label: str,
    colour: tuple,
) -> None:
    """Draw a score label at (x, y) in the given colour using the margin font."""
    draw.text((x, y), label, font=_font_margin, fill=colour)


def _draw_score_banner(
    draw: ImageDraw.ImageDraw,
    img_width: int,
    img_height: int,
    verdicts: list[GradingVerdict],
) -> None:
    """Draw a filled dark banner at the bottom of the image with the total score."""
    total_score = sum(v.awarded_marks for v in verdicts)

    # Estimate total_max: for correct verdicts use awarded_marks (which equals max),
    # for incorrect/partial assume 1.0 per question (best we can do without the answer key here)
    total_max = sum(
        v.awarded_marks if v.verdict == GradingVerdictEnum.CORRECT else 1.0
        for v in verdicts
    )

    banner_y0 = img_height - BANNER_HEIGHT
    banner_y1 = img_height
    draw.rectangle([(0, banner_y0), (img_width, banner_y1)], fill=TEXT_DARK)

    label = f"Score: {total_score:g} / {total_max:g}"
    bbox = draw.textbbox((0, 0), label, font=_font_banner)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    text_x = (img_width - text_w) // 2
    text_y = banner_y0 + (BANNER_HEIGHT - text_h) // 2
    draw.text((text_x, text_y), label, font=_font_banner, fill=TEXT_WHITE)


# ── Verdict map helper ────────────────────────────────────────────────────────

def _build_verdict_map(
    regions: list[AnswerRegion],
    verdicts: list[GradingVerdict],
) -> dict[int, tuple[AnswerRegion, GradingVerdict]]:
    """Build a dict keyed by question_number → (AnswerRegion, GradingVerdict).

    Only includes questions that have BOTH a region and a verdict.
    Logs a warning for any verdict whose question_number has no matching region.

    Args:
        regions:  Output of ocr_client.group_answer_regions().
        verdicts: Output of openai_client.grade_submission().

    Returns:
        Dict keyed by question_number. Iteration order matches insertion (dict preserves order).
    """
    region_by_number = {r.question_number: r for r in regions}
    result: dict[int, tuple[AnswerRegion, GradingVerdict]] = {}

    for verdict in verdicts:
        region = region_by_number.get(verdict.question_number)
        if region is None:
            logger.warning(
                "annotator: no region found for question %d — skipping annotation",
                verdict.question_number,
            )
            continue
        result[verdict.question_number] = (region, verdict)

    return result
