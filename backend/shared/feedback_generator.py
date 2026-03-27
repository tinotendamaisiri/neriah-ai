# shared/feedback_generator.py
# Generates a structured academic feedback PDF for tertiary student submissions.
# Synchronous — pure CPU work, no async needed.
# All reportlab imports are lazy (inside generate_feedback_pdf) to keep cold-start fast.

from __future__ import annotations

import io
import logging
from datetime import date
from typing import Any

from .models import CriterionVerdict

logger = logging.getLogger(__name__)


def _overall_band(percentage: float) -> str:
    if percentage >= 75:
        return "Distinction"
    if percentage >= 60:
        return "Merit"
    if percentage >= 50:
        return "Pass"
    return "Fail"


# ── Main function ─────────────────────────────────────────────────────────────

def generate_feedback_pdf(
    student_name: str,
    assignment_name: str,
    submission_code: str,
    verdicts: list[CriterionVerdict],
    total_score: float,
    max_score: float,
    plagiarism_flag: bool = False,
    lecturer_name: str = "Lecturer",
    institution_name: str = "Neriah Assessment",
) -> bytes:
    """Generate a structured academic feedback PDF for a tertiary student submission.

    Returns the PDF as bytes. Does not write to disk.
    """
    # Lazy imports — heavy packages, deferred to avoid slowing down cold-start
    from reportlab.lib.colors import HexColor, white  # noqa: PLC0415
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT  # noqa: PLC0415
    from reportlab.lib.pagesizes import A4  # noqa: PLC0415
    from reportlab.lib.styles import ParagraphStyle  # noqa: PLC0415
    from reportlab.lib.units import cm  # noqa: PLC0415
    from reportlab.platypus import (  # noqa: PLC0415
        HRFlowable,
        KeepTogether,
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    # ── Colour constants ──────────────────────────────────────────────────────

    DARK_HEX  = HexColor("#1a1a2e")
    GREEN_HEX = HexColor("#1a7a4a")
    LIGHT_HEX = HexColor("#f0f7f4")
    MID_HEX   = HexColor("#d4ece0")
    GRAY_HEX  = HexColor("#888888")
    WHITE_HEX = white
    RED_HEX   = HexColor("#dc2626")
    AMBER_HEX = HexColor("#d97706")

    BAND_COLOURS: dict[str, Any] = {
        "distinction": GREEN_HEX,
        "merit":       HexColor("#2563eb"),
        "pass":        AMBER_HEX,
        "fail":        RED_HEX,
    }

    def _band_colour(band: str) -> Any:
        return BAND_COLOURS.get(band.lower(), GRAY_HEX)

    # ── Paragraph styles ──────────────────────────────────────────────────────

    def _build_styles() -> dict[str, ParagraphStyle]:
        styles: dict[str, ParagraphStyle] = {}
        styles["neriah_header_title"] = ParagraphStyle(
            "neriah_header_title",
            fontName="Helvetica-Bold",
            fontSize=28,
            textColor=GREEN_HEX,
            alignment=TA_LEFT,
        )
        styles["neriah_header_sub"] = ParagraphStyle(
            "neriah_header_sub",
            fontName="Helvetica",
            fontSize=11,
            textColor=WHITE_HEX,
            alignment=TA_RIGHT,
        )
        styles["info_label"] = ParagraphStyle(
            "info_label",
            fontName="Helvetica-Bold",
            fontSize=9,
            textColor=GRAY_HEX,
        )
        styles["info_value"] = ParagraphStyle(
            "info_value",
            fontName="Helvetica",
            fontSize=10,
            textColor=DARK_HEX,
        )
        styles["score_main"] = ParagraphStyle(
            "score_main",
            fontName="Helvetica-Bold",
            fontSize=36,
            textColor=WHITE_HEX,
            alignment=TA_CENTER,
        )
        styles["score_sub"] = ParagraphStyle(
            "score_sub",
            fontName="Helvetica",
            fontSize=11,
            textColor=MID_HEX,
            alignment=TA_CENTER,
        )
        styles["section_heading"] = ParagraphStyle(
            "section_heading",
            fontName="Helvetica-Bold",
            fontSize=13,
            textColor=GREEN_HEX,
            spaceBefore=12,
            spaceAfter=4,
        )
        styles["score_line"] = ParagraphStyle(
            "score_line",
            fontName="Helvetica-Bold",
            fontSize=10,
            spaceAfter=6,
        )
        styles["feedback_body"] = ParagraphStyle(
            "feedback_body",
            fontName="Helvetica",
            fontSize=10,
            textColor=DARK_HEX,
            alignment=TA_JUSTIFY,
            leading=15,
        )
        styles["reviewer_text"] = ParagraphStyle(
            "reviewer_text",
            fontName="Helvetica",
            fontSize=9,
            textColor=GRAY_HEX,
            spaceAfter=4,
        )
        styles["disclaimer"] = ParagraphStyle(
            "disclaimer",
            fontName="Helvetica-Oblique",
            fontSize=8,
            textColor=GRAY_HEX,
            alignment=TA_CENTER,
            spaceBefore=8,
        )
        styles["warning_text"] = ParagraphStyle(
            "warning_text",
            fontName="Helvetica-Bold",
            fontSize=10,
            textColor=RED_HEX,
            alignment=TA_CENTER,
        )
        styles["table_header"] = ParagraphStyle(
            "table_header",
            fontName="Helvetica-Bold",
            fontSize=9,
            textColor=WHITE_HEX,
            alignment=TA_CENTER,
        )
        styles["table_cell"] = ParagraphStyle(
            "table_cell",
            fontName="Helvetica",
            fontSize=9,
            textColor=DARK_HEX,
            alignment=TA_CENTER,
        )
        styles["table_cell_left"] = ParagraphStyle(
            "table_cell_left",
            fontName="Helvetica",
            fontSize=9,
            textColor=DARK_HEX,
            alignment=TA_LEFT,
        )
        return styles

    # ── Build document ────────────────────────────────────────────────────────

    buf = io.BytesIO()
    margin = 2 * cm
    page_width = A4[0] - 2 * margin

    styles = _build_styles()

    # Footer rendered on every page via canvas callback
    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(GRAY_HEX)
        canvas.drawString(margin, 1.2 * cm, f"{student_name}  |  {assignment_name}")
        canvas.drawRightString(A4[0] - margin, 1.2 * cm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=margin,
        rightMargin=margin,
        topMargin=margin,
        bottomMargin=2.5 * cm,
    )

    story: list[Any] = []

    # ── 1. Header banner ──────────────────────────────────────────────────────

    header_table = Table(
        [[
            Paragraph("NERIAH", styles["neriah_header_title"]),
            Paragraph("Academic Feedback Report", styles["neriah_header_sub"]),
        ]],
        colWidths=[page_width * 0.5, page_width * 0.5],
    )
    header_table.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), DARK_HEX),
        ("TOPPADDING",    (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
        ("LEFTPADDING",   (0, 0), (0, -1),  12),
        ("RIGHTPADDING",  (-1, 0), (-1, -1), 12),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 0.4 * cm))

    # ── 2. Student info block ─────────────────────────────────────────────────

    today = date.today().strftime("%d %B %Y")
    col_w = page_width / 4
    info_table = Table(
        [
            [
                Paragraph("STUDENT",          styles["info_label"]),
                Paragraph(student_name,        styles["info_value"]),
                Paragraph("SUBMISSION CODE",   styles["info_label"]),
                Paragraph(submission_code,     styles["info_value"]),
            ],
            [
                Paragraph("ASSIGNMENT",        styles["info_label"]),
                Paragraph(assignment_name,     styles["info_value"]),
                Paragraph("DATE",              styles["info_label"]),
                Paragraph(today,               styles["info_value"]),
            ],
        ],
        colWidths=[col_w] * 4,
    )
    info_table.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), LIGHT_HEX),
        ("BOX",           (0, 0), (-1, -1), 0.5, MID_HEX),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 0.4 * cm))

    # ── 3. Plagiarism warning (conditional) ───────────────────────────────────

    if plagiarism_flag:
        warn_table = Table(
            [[Paragraph(
                "⚠ Similarity Alert: This submission has been flagged for similarity review. "
                "The lecturer has been notified.",
                styles["warning_text"],
            )]],
            colWidths=[page_width],
        )
        warn_table.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), HexColor("#fef2f2")),
            ("BOX",           (0, 0), (-1, -1), 1.5, RED_HEX),
            ("TOPPADDING",    (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("LEFTPADDING",   (0, 0), (-1, -1), 12),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
        ]))
        story.append(warn_table)
        story.append(Spacer(1, 0.4 * cm))

    # ── 4. Overall score banner ───────────────────────────────────────────────

    percentage = round((total_score / max_score * 100) if max_score > 0 else 0.0, 1)
    overall_band = _overall_band(percentage)

    score_table = Table(
        [
            [Paragraph(f"{total_score} / {max_score}", styles["score_main"])],
            [Paragraph(
                f"Overall Score  |  {percentage}%  |  {overall_band}",
                styles["score_sub"],
            )],
        ],
        colWidths=[page_width],
    )
    score_table.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), DARK_HEX),
        ("TOPPADDING",    (0, 0), (0, 0),   18),
        ("BOTTOMPADDING", (0, 0), (0, 0),   4),
        ("TOPPADDING",    (0, 1), (0, 1),   0),
        ("BOTTOMPADDING", (0, 1), (0, 1),   18),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
    ]))
    story.append(score_table)
    story.append(Spacer(1, 0.5 * cm))

    # ── 5. Rubric scorecard table ─────────────────────────────────────────────

    col_widths = [5 * cm, 2.5 * cm, 2.5 * cm, 2.5 * cm, 2 * cm]

    scorecard_data: list[list[Any]] = [[
        Paragraph("Criterion",  styles["table_header"]),
        Paragraph("Max Marks",  styles["table_header"]),
        Paragraph("Awarded",    styles["table_header"]),
        Paragraph("Band",       styles["table_header"]),
        Paragraph("%",          styles["table_header"]),
    ]]
    for v in verdicts:
        pct = round(v.awarded_marks / v.max_marks * 100, 1) if v.max_marks > 0 else 0.0
        scorecard_data.append([
            Paragraph(v.criterion_name,        styles["table_cell_left"]),
            Paragraph(str(v.max_marks),        styles["table_cell"]),
            Paragraph(str(v.awarded_marks),    styles["table_cell"]),
            Paragraph(v.band.capitalize(),     styles["table_cell"]),
            Paragraph(f"{pct}%",               styles["table_cell"]),
        ])

    scorecard_style: list[Any] = [
        ("BACKGROUND",    (0, 0), (-1, 0),  DARK_HEX),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
        ("GRID",          (0, 0), (-1, -1), 0.25, MID_HEX),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]
    for i, v in enumerate(verdicts):
        row = i + 1
        bg = LIGHT_HEX if row % 2 == 0 else WHITE_HEX
        scorecard_style += [
            ("BACKGROUND", (0, row), (2, row),  bg),
            ("BACKGROUND", (4, row), (4, row),  bg),
            ("BACKGROUND", (3, row), (3, row),  _band_colour(v.band)),
            ("TEXTCOLOR",  (3, row), (3, row),  WHITE_HEX),
            ("FONTNAME",   (3, row), (3, row),  "Helvetica-Bold"),
        ]

    scorecard_table = Table(scorecard_data, colWidths=col_widths)
    scorecard_table.setStyle(TableStyle(scorecard_style))
    story.append(scorecard_table)

    # ── PAGE 2+ — Per-criterion feedback ─────────────────────────────────────

    story.append(PageBreak())

    for v in verdicts:
        pct = round(v.awarded_marks / v.max_marks * 100, 1) if v.max_marks > 0 else 0.0
        score_style = ParagraphStyle(
            f"score_{v.criterion_number}",
            parent=styles["score_line"],
            textColor=_band_colour(v.band),
        )
        section = KeepTogether([
            Paragraph(
                f"{v.criterion_number}. {v.criterion_name}",
                styles["section_heading"],
            ),
            HRFlowable(width="100%", thickness=1, color=MID_HEX, spaceAfter=6),
            Paragraph(
                f"Awarded: {v.awarded_marks} / {v.max_marks} ({v.band.capitalize()})",
                score_style,
            ),
            Paragraph(v.feedback, styles["feedback_body"]),
            Spacer(1, 0.5 * cm),
        ])
        story.append(section)

    # ── Reviewer sign-off ─────────────────────────────────────────────────────

    story.append(HRFlowable(
        width="100%", thickness=0.5, color=MID_HEX, spaceBefore=12, spaceAfter=12,
    ))
    story.append(Paragraph(f"Reviewed by: {lecturer_name}", styles["reviewer_text"]))
    story.append(Paragraph(f"Institution: {institution_name}", styles["reviewer_text"]))
    story.append(Paragraph(
        "This feedback was generated with AI assistance and reviewed by your lecturer before release.",
        styles["disclaimer"],
    ))

    # ── Build ─────────────────────────────────────────────────────────────────

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)

    pdf_bytes = buf.getvalue()
    logger.info(
        "generate_feedback_pdf: student=%r assignment=%r bytes=%d",
        student_name,
        assignment_name,
        len(pdf_bytes),
    )
    return pdf_bytes
