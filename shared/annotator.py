"""
Pillow annotation pipeline — draws ticks, crosses, and scores onto the original
photo.

Visual contract (updated 2026-04-21):
  - Large verdict circles (80-120 px diameter, scaled to image size) so teachers
    and students can read the mark at a glance on a phone screen.
  - Thick glyph strokes (4-8 px) for the same reason.
  - Positioned near the right margin of the page (roughly 50-80 px from the
    edge) so the mark is visible without covering the student's handwriting.
  - Score bubble at bottom-right, with ~2x the previous font size.
  - Palette matches the mobile app:
       correct  → green  #22C55E
       partial  → amber  #F59E0B
       incorrect → red   #EF4444
    (Teal is intentionally NOT used for correctness — it's the brand colour
     and would read as "approved" rather than "right answer".)
"""

from __future__ import annotations

import io
import logging
from typing import Optional

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# ── Palette (matches mobile design system) ───────────────────────────────────
_TEAL = (13, 115, 119)        # Brand teal — reserved for app chrome.
_GREEN = (34, 197, 94)        # #22C55E — correct
_AMBER = (245, 158, 11)       # #F59E0B — partial
_RED = (239, 68, 68)          # #EF4444 — incorrect
_WHITE = (255, 255, 255)
_BLACK = (0, 0, 0)

# Verdict → (fill_colour, symbol)
_VERDICT_STYLE: dict[str, tuple] = {
    "correct":   (_GREEN, "✓"),
    "incorrect": (_RED,   "✗"),
    "partial":   (_AMBER, "−"),
}


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
    except OSError:
        return ImageFont.load_default()


def _circle_radius(image_height: int) -> int:
    """Scale the verdict-circle radius to image size. Target diameter
    80-120 px on a typical 3000-4000 px tall photo."""
    r = int(image_height * 0.014)       # ~100 px diameter on a 3500 px image
    return max(40, min(60, r))           # clamp to 80-120 px diameter


def _draw_glyph(draw: ImageDraw.ImageDraw, symbol: str, cx: int, cy: int, radius: int) -> None:
    """Draw a thick tick/cross/dash inside an already-rendered circle.

    Glyphs are drawn with lines rather than text because font glyphs look
    thin and inconsistent at 100 px diameter across platforms.
    """
    stroke = max(4, radius // 6)
    arm = int(radius * 0.55)

    if symbol == "✓":
        p1 = (cx - arm,             cy + int(arm * 0.15))
        p2 = (cx - int(arm * 0.2),  cy + int(arm * 0.75))
        p3 = (cx + arm,             cy - int(arm * 0.8))
        draw.line([p1, p2], fill=_WHITE, width=stroke)
        draw.line([p2, p3], fill=_WHITE, width=stroke)
    elif symbol == "✗":
        draw.line([(cx - arm, cy - arm), (cx + arm, cy + arm)], fill=_WHITE, width=stroke)
        draw.line([(cx + arm, cy - arm), (cx - arm, cy + arm)], fill=_WHITE, width=stroke)
    else:
        # Partial: horizontal dash.
        draw.line([(cx - arm, cy), (cx + arm, cy)], fill=_WHITE, width=stroke)


def annotate_image(
    image_bytes: bytes,
    verdicts: list[dict],
    bounding_boxes: Optional[list[dict]] = None,
) -> bytes:
    """
    Opens the original JPEG with Pillow and draws a large, legible verdict
    mark at the right margin of each question, plus a summary score bubble
    at the bottom-right.

    bounding_boxes: optional list from Document AI / OCR (word-level pixel coords).
    When absent, marks are placed in an evenly-spaced right-hand column.

    Returns annotated JPEG bytes (never written to disk).
    """
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        draw = ImageDraw.Draw(image, "RGBA")
        width, height = image.size

        radius = _circle_radius(height)
        # Right margin: centre sits 50-80 px from the page edge depending
        # on image size.
        margin_x = width - max(70, radius + 20)

        font_qlabel = _load_font(max(20, int(radius * 0.55)))
        # Score bubble fonts — roughly 2× the pre-2026-04 sizes.
        font_score_big = _load_font(max(54, int(height * 0.035)))
        font_score_sub = _load_font(max(28, int(height * 0.018)))

        # ── Per-verdict marks at right margin ────────────────────────────────
        row_step = radius * 2 + 24
        first_y = radius + 24
        available_h = max(0, height - first_y - radius - 40)
        n = max(len(verdicts), 1)
        if n * row_step > available_h:
            row_step = max(radius * 2 + 6, available_h // n)

        for i, verdict in enumerate(verdicts):
            v_type = verdict.get("verdict", "incorrect")
            colour, symbol = _VERDICT_STYLE.get(v_type, (_RED, "✗"))
            awarded = float(verdict.get("awarded_marks", 0))
            max_m = float(verdict.get("max_marks", 1))
            q_num = verdict.get("question_number", i + 1)

            # Prefer Document AI y-coord so the mark sits next to the student's
            # actual answer. X is always right-margin so we never paint over
            # handwriting.
            cy: int
            if bounding_boxes:
                bb_y = _bounding_box_y(bounding_boxes, q_num, height)
                cy = bb_y if bb_y is not None else first_y + i * row_step
            else:
                cy = first_y + i * row_step
            cx = margin_x

            # Circle
            draw.ellipse(
                [(cx - radius, cy - radius), (cx + radius, cy + radius)],
                fill=(*colour, 235),
                outline=_WHITE,
                width=max(2, radius // 16),
            )
            _draw_glyph(draw, symbol, cx, cy, radius)

            # "Q1: 3/5" label below each circle
            label = f"Q{q_num}: {awarded:.0f}/{max_m:.0f}"
            lw = draw.textlength(label, font=font_qlabel) if hasattr(draw, "textlength") else len(label) * 12
            draw.text((cx - lw / 2, cy + radius + 4), label, font=font_qlabel, fill=colour)

        # ── Summary score bubble (bottom-right, ~2× previous size) ───────────
        total_awarded = sum(float(v.get("awarded_marks", 0)) for v in verdicts)
        total_max = sum(float(v.get("max_marks", 1)) for v in verdicts)
        pct = (total_awarded / total_max * 100) if total_max else 0

        score_text = f"{total_awarded:.0f}/{total_max:.0f}"
        pct_text = f"{pct:.0f}%"

        big_size = font_score_big.size if hasattr(font_score_big, "size") else 54
        sub_size = font_score_sub.size if hasattr(font_score_sub, "size") else 28
        sw = draw.textlength(score_text, font=font_score_big) if hasattr(draw, "textlength") else len(score_text) * 30
        pw = draw.textlength(pct_text,   font=font_score_sub) if hasattr(draw, "textlength") else len(pct_text)   * 18

        bubble_w = int(max(sw, pw) + 60)
        bubble_h = int(big_size + sub_size * 1.2 + 30)
        bx2 = width - 30
        by2 = height - 30
        bx1 = bx2 - bubble_w
        by1 = by2 - bubble_h

        bubble_colour = _GREEN if pct >= 75 else (_AMBER if pct >= 50 else _RED)
        draw.rounded_rectangle(
            [(bx1, by1), (bx2, by2)],
            radius=18,
            fill=(*bubble_colour, 230),
            outline=_WHITE,
            width=3,
        )
        draw.text(
            (bx1 + (bubble_w - sw) / 2, by1 + 12),
            score_text,
            font=font_score_big,
            fill=_WHITE,
        )
        draw.text(
            (bx1 + (bubble_w - pw) / 2, by1 + 12 + big_size + 4),
            pct_text,
            font=font_score_sub,
            fill=_WHITE,
        )

        output = io.BytesIO()
        image.save(output, format="JPEG", quality=88)
        return output.getvalue()

    except Exception:
        logger.exception("annotate_image failed — returning original bytes")
        return image_bytes


def _bounding_box_y(
    bounding_boxes: list[dict],
    question_number: int,
    img_height: int,
) -> Optional[int]:
    """Return just the y-coord of the matching question marker. We always use
    the right margin for x so verdict circles don't land on top of the
    student's handwriting."""
    for page in bounding_boxes:
        for word in page.get("words", []):
            if word.get("text", "").lower().strip("().:") == str(question_number):
                y = word.get("y", 0) * img_height
                return int(y)
    return None


def annotate_pages(pages: list[bytes], verdicts: list[dict]) -> list[bytes]:
    """Annotate each page with only the verdicts that apply to it.

    Multi-page sibling of annotate_image. Filters `verdicts` by `page_index`
    and delegates to annotate_image per page, so the existing tick/cross/
    score-bubble rendering is reused unchanged.

    `page_index` defaults to 0 when missing on a verdict — that way a
    single-page submission works even if Gemma forgot to emit the field.

    Returns a list of annotated JPEG bytes, same order + length as `pages`.
    Pages with no matching verdicts still get annotated (just without per-
    question marks), preserving the summary score bubble.
    """
    annotated: list[bytes] = []
    for i, page_bytes in enumerate(pages):
        page_verdicts = [
            v for v in verdicts
            if int(v.get("page_index", 0)) == i
        ]
        annotated.append(annotate_image(page_bytes, page_verdicts))
    return annotated
