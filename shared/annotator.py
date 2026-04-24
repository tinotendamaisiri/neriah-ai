"""
Pillow annotation pipeline — draws per-question verdict symbols and a summary
score bubble onto the original photo.

Visual contract (updated 2026-04-23):
  - Verdict mark is a plain Unicode symbol rendered large on the page (no
    filled circle behind it any more — Gemma now returns per-question
    coordinates, so the symbol lands near the actual question label rather
    than parked in a right-margin column).
       correct  → ✓ green   #22C55E
       incorrect → ✗ red     #EF4444
       partial  → ~ amber   #F59E0B
  - Position comes from each verdict's `question_x` / `question_y` fields
    (fractions of image dimensions, 0.0-1.0). Missing/invalid values fall
    back to evenly-spaced left margin. All coords clamped to [0.05, 0.95]
    so symbols never bleed off the page edge.
  - Score bubble still lives bottom-right — unchanged.
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

# Verdict → (colour, Unicode symbol). The symbol is drawn directly as text
# (no circle background) at the coordinate Gemma returned.
_VERDICT_STYLE: dict[str, tuple] = {
    "correct":   (_GREEN, "✓"),
    "incorrect": (_RED,   "✗"),
    "partial":   (_AMBER, "~"),
}


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
    except OSError:
        return ImageFont.load_default()


def _resolve_verdict_position(
    verdict: dict,
    index: int,
    total: int,
    width: int,
    height: int,
) -> tuple[int, int]:
    """Resolve (cx, cy) pixel coordinates for where a verdict symbol lands.

    Prefers `question_x` / `question_y` from the verdict dict — both are
    fractions of image dimensions (0.0-1.0). Missing, non-numeric, or
    out-of-sensible-range values fall back to evenly-spaced left margin
    (x = 0.05, y = (index + 0.5) / total).

    Both coords are clamped to [0.05, 0.95] so symbols never bleed off the
    page edge regardless of what the model returned.
    """
    n = max(total, 1)

    qx_raw = verdict.get("question_x")
    try:
        qx = float(qx_raw) if qx_raw is not None else 0.05
    except (TypeError, ValueError):
        qx = 0.05

    qy_raw = verdict.get("question_y")
    try:
        qy = float(qy_raw) if qy_raw is not None else (index + 0.5) / n
    except (TypeError, ValueError):
        qy = (index + 0.5) / n

    qx = max(0.05, min(0.95, qx))
    qy = max(0.05, min(0.95, qy))
    return int(qx * width), int(qy * height)


def annotate_image(
    image_bytes: bytes,
    verdicts: list[dict],
    bounding_boxes: Optional[list[dict]] = None,  # retained for backward-compat; no longer consulted
) -> bytes:
    """
    Opens the original JPEG with Pillow and draws a Unicode verdict symbol
    at the coordinates Gemma returned for each question, plus a summary
    score bubble at the bottom-right.

    `bounding_boxes` is kept in the signature for backward compat with the
    legacy OCR pipeline but is no longer read — positioning comes from each
    verdict's `question_x` / `question_y` fields.

    Returns annotated JPEG bytes (never written to disk).
    """
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        draw = ImageDraw.Draw(image, "RGBA")
        width, height = image.size

        # Symbol: ~4% of image height, floor of 40 px so it stays legible
        # even on small preview renders.
        symbol_size = max(40, int(height * 0.04))
        font_symbol = _load_font(symbol_size)
        font_qlabel = _load_font(max(20, int(symbol_size * 0.5)))
        # Score bubble fonts — unchanged from the previous version.
        font_score_big = _load_font(max(54, int(height * 0.035)))
        font_score_sub = _load_font(max(28, int(height * 0.018)))

        total = max(len(verdicts), 1)

        for i, verdict in enumerate(verdicts):
            v_type = verdict.get("verdict", "incorrect")
            colour, symbol = _VERDICT_STYLE.get(v_type, (_RED, "✗"))
            awarded = float(verdict.get("awarded_marks", 0))
            max_m = float(verdict.get("max_marks", 1))
            q_num = verdict.get("question_number", i + 1)

            cx, cy = _resolve_verdict_position(verdict, i, total, width, height)

            # Centre the glyph at (cx, cy). textbbox returns (l, t, r, b) in
            # font units; using it for centring handles glyphs with vertical
            # offset (✓ sits higher than ✗ in some fonts).
            try:
                bbox = draw.textbbox((0, 0), symbol, font=font_symbol)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
            except Exception:
                tw = th = symbol_size

            draw.text(
                (cx - tw // 2, cy - th // 2),
                symbol,
                font=font_symbol,
                fill=colour,
            )

            # "Q1: 3/5" label below the symbol
            label = f"Q{q_num}: {awarded:.0f}/{max_m:.0f}"
            try:
                lw = draw.textlength(label, font=font_qlabel)
            except AttributeError:
                lw = len(label) * 12
            draw.text(
                (cx - lw / 2, cy + th // 2 + 4),
                label,
                font=font_qlabel,
                fill=colour,
            )

        # ── Summary score bubble (bottom-right) ─────────────────────────────
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


def annotate_pages(pages: list[bytes], verdicts: list[dict]) -> list[bytes]:
    """Annotate each page with only the verdicts that apply to it.

    Multi-page sibling of annotate_image. Filters `verdicts` by `page_index`
    and delegates to annotate_image per page, so the same per-question
    symbol + score-bubble rendering is reused unchanged.

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
