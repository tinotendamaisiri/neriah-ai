"""
Pillow annotation pipeline — draws ticks, crosses, and scores onto the original
photo. 
"""

from __future__ import annotations

import io
import logging
from typing import Optional

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# Brand colours
_TEAL = (13, 115, 119)
_GREEN = (34, 197, 94)
_RED = (239, 68, 68)
_ORANGE = (249, 115, 22)
_WHITE = (255, 255, 255)
_BLACK = (0, 0, 0)

# Verdict → (fill_colour, symbol)
_VERDICT_STYLE: dict[str, tuple] = {
    "correct": (_GREEN, "✓"),
    "incorrect": (_RED, "✗"),
    "partial": (_ORANGE, "~"),
}


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
    except OSError:
        return ImageFont.load_default()


def annotate_image(
    image_bytes: bytes,
    verdicts: list[dict],
    bounding_boxes: Optional[list[dict]] = None,
) -> bytes:
    """
    Opens the original JPEG with Pillow and draws:
      - Correct  → green filled circle + white tick, score in right margin
      - Incorrect → red filled circle + white cross
      - Partial   → orange underline, partial score

    bounding_boxes: optional list from Document AI / OCR (word-level pixel coords).
    When absent, symbols are placed in a right-hand score column.

    Returns annotated JPEG bytes (never written to disk).
    """
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        draw = ImageDraw.Draw(image, "RGBA")
        width, height = image.size

        font_large = _load_font(28)
        font_medium = _load_font(20)
        font_small = _load_font(16)

        # Score header bar
        header_h = 44
        draw.rectangle([(0, 0), (width, header_h)], fill=(*_TEAL, 230))
        total_awarded = sum(float(v.get("awarded_marks", 0)) for v in verdicts)
        total_max = sum(float(v.get("max_marks", 1)) for v in verdicts)
        pct = (total_awarded / total_max * 100) if total_max else 0
        header_text = f"Score: {total_awarded:.0f}/{total_max:.0f}  ({pct:.0f}%)"
        draw.text((12, 10), header_text, font=font_large, fill=_WHITE)

        # Right margin column for per-question scores
        margin_x = max(width - 110, width - int(width * 0.15))
        row_h = max(40, (height - header_h - 20) // max(len(verdicts), 1))

        for i, verdict in enumerate(verdicts):
            v_type = verdict.get("verdict", "incorrect")
            colour, symbol = _VERDICT_STYLE.get(v_type, (_RED, "✗"))
            awarded = float(verdict.get("awarded_marks", 0))
            max_m = float(verdict.get("max_marks", 1))

            # Try to place symbol at bounding box location
            placed = False
            if bounding_boxes:
                bb = _find_bounding_box(bounding_boxes, verdict.get("question_number", i + 1), width, height)
                if bb:
                    cx, cy = bb
                    r = 16
                    draw.ellipse([(cx - r, cy - r), (cx + r, cy + r)], fill=(*colour, 210))
                    draw.text((cx - 8, cy - 10), symbol, font=font_medium, fill=_WHITE)
                    placed = True

            # Right-margin score badge (always drawn)
            badge_y = header_h + 10 + i * row_h
            badge_x = margin_x
            badge_w, badge_h = 95, 30
            draw.rounded_rectangle(
                [(badge_x, badge_y), (badge_x + badge_w, badge_y + badge_h)],
                radius=8,
                fill=(*colour, 200),
            )
            score_text = f"Q{verdict.get('question_number', i+1)}: {awarded:.0f}/{max_m:.0f}"
            draw.text((badge_x + 6, badge_y + 6), score_text, font=font_small, fill=_WHITE)

            # If no bounding box, put symbol just left of the margin
            if not placed:
                sym_x = margin_x - 35
                sym_y = badge_y
                r = 14
                draw.ellipse(
                    [(sym_x - r, sym_y - r), (sym_x + r, sym_y + r)],
                    fill=(*colour, 200),
                )
                draw.text((sym_x - 8, sym_y - 10), symbol, font=font_medium, fill=_WHITE)

        output = io.BytesIO()
        image.save(output, format="JPEG", quality=88)
        return output.getvalue()

    except Exception:
        logger.exception("annotate_image failed — returning original bytes")
        return image_bytes


def _find_bounding_box(
    bounding_boxes: list[dict],
    question_number: int,
    img_width: int,
    img_height: int,
) -> Optional[tuple[int, int]]:
    """
    Looks for a word that looks like a question marker (e.g. "1.", "Q1", "(1)").
    Returns pixel (cx, cy) or None.
    """
    markers = {
        f"{question_number}.",
        f"q{question_number}",
        f"({question_number})",
        str(question_number),
    }
    for page in bounding_boxes:
        for word in page.get("words", []):
            if word.get("text", "").lower().strip("().:") in {str(question_number)}:
                x = word.get("x", 0) * img_width
                y = word.get("y", 0) * img_height
                return int(x), int(y)
    return None
