# shared/ocr_client.py
# Azure AI Document Intelligence wrapper.
# Extracts text AND word-level bounding boxes from photos of student exercise books.
# Bounding boxes feed directly into annotator.py so marks are drawn in the right place.
#
# Uses azure-ai-documentintelligence async client. All public functions are async.

from __future__ import annotations

import logging

from azure.ai.documentintelligence.aio import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeDocumentRequest
from azure.core.credentials import AzureKeyCredential

from .config import settings
from .models import AnswerKey, AnswerRegion, BoundingBox, WordBound

logger = logging.getLogger(__name__)

# ── Lazy singleton client ─────────────────────────────────────────────────────
# Initialised on first call. In production, replace AzureKeyCredential with
# azure.identity.aio.DefaultAzureCredential() for managed identity auth.

_client: DocumentIntelligenceClient | None = None


def _get_client() -> DocumentIntelligenceClient:
    """Return the module-level async DocumentIntelligenceClient, creating it on first call."""
    global _client
    if _client is None:
        _client = DocumentIntelligenceClient(
            endpoint=settings.azure_doc_intelligence_endpoint,
            credential=AzureKeyCredential(settings.azure_doc_intelligence_key),
        )
    return _client


# ── Public functions ──────────────────────────────────────────────────────────

async def analyse_image(image_bytes: bytes) -> tuple[str, BoundingBox]:
    """Send image bytes to Document Intelligence (prebuilt-read model).

    prebuilt-read is optimised for dense printed and handwritten text — ideal
    for student exercise books.

    Args:
        image_bytes: Raw JPEG/PNG bytes of the page photo.

    Returns:
        full_text:    All detected words joined with spaces, in reading order.
                      Used as the input to grade_submission() in openai_client.py.
        bounding_box: Word-level pixel coordinates for every detected word on page 1.
                      Used by annotator.py to position tick/cross marks.

    Raises:
        HttpResponseError: on any Document Intelligence API error (auth, quota, etc.)
    """
    client = _get_client()

    poller = await client.begin_analyze_document(
        model_id="prebuilt-read",
        body=AnalyzeDocumentRequest(bytes_source=image_bytes),
    )
    result = await poller.result()

    if not result.pages:
        logger.warning("analyse_image: Document Intelligence returned no pages")
        return ("", BoundingBox(page=1, words=[]))

    page = result.pages[0]
    words = page.words or []

    word_bounds: list[WordBound] = []
    for word in words:
        poly = word.polygon or []
        if len(poly) < 6:
            # Malformed polygon — skip rather than crash
            logger.debug("analyse_image: skipping word %r with short polygon %r", word.content, poly)
            continue
        # polygon layout: [x0,y0, x1,y1, x2,y2, x3,y3] clockwise from top-left
        # x0,y0 = top-left   x2,y2 = bottom-right
        x = poly[0]
        y = poly[1]
        width = poly[4] - poly[0]
        height = poly[5] - poly[1]
        word_bounds.append(WordBound(text=word.content, x=x, y=y, width=width, height=height))

    full_text = " ".join(wb.text for wb in word_bounds)

    logger.info(
        "analyse_image: extracted %d words, %d characters",
        len(word_bounds), len(full_text),
    )

    return (full_text, BoundingBox(page=1, words=word_bounds))


async def group_answer_regions(
    bounding_box: BoundingBox,
    answer_key: AnswerKey,
) -> list[AnswerRegion]:
    """Group WordBounds into one AnswerRegion per question using horizontal band heuristic.

    Questions are assumed to appear top-to-bottom in the same order as in the answer key.
    The page is divided into N equal horizontal bands where N = len(answer_key.questions).
    Each word is assigned to the band whose y-range contains its top-left y coordinate.

    Args:
        bounding_box: Output of analyse_image() — all words with pixel coordinates.
        answer_key:   The stored answer key whose question count determines band count.

    Returns:
        List of AnswerRegion objects, one per non-empty band, sorted by question_number.
        Empty list if bounding_box.words is empty.
    """
    if not bounding_box.words:
        return []

    num_questions = len(answer_key.questions)
    if num_questions == 0:
        return []

    words = bounding_box.words

    # Estimate page height from the lowest word bottom edge, plus 5 % padding
    max_y_bottom = max(w.y + w.height for w in words)
    page_height = max_y_bottom * 1.05

    band_height = page_height / num_questions

    # Bucket words into bands indexed 0 … num_questions-1
    bands: dict[int, list[WordBound]] = {i: [] for i in range(num_questions)}
    for word in words:
        band_index = int(word.y / band_height)
        # Clamp to valid range in case of floating-point overshoot
        band_index = min(band_index, num_questions - 1)
        bands[band_index].append(word)

    regions: list[AnswerRegion] = []
    for band_index, band_words in bands.items():
        if not band_words:
            continue  # skip empty bands, keep question_number correct via band_index

        question_number = band_index + 1

        min_x = min(w.x for w in band_words)
        min_y = min(w.y for w in band_words)
        max_x = max(w.x + w.width for w in band_words)
        max_y = max(w.y + w.height for w in band_words)

        regions.append(AnswerRegion(
            question_number=question_number,
            words=band_words,
            x=min_x,
            y=min_y,
            width=max_x - min_x,
            height=max_y - min_y,
            page=1,
        ))

    regions.sort(key=lambda r: r.question_number)

    logger.debug(
        "group_answer_regions: produced %d regions from %d words across %d questions",
        len(regions), len(words), num_questions,
    )

    return regions
