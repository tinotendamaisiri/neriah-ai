#!/usr/bin/env python3
"""
Index syllabus PDFs into Firestore rag_syllabuses collection.

Discovers all PDFs in syllabuses/ directory, extracts text, chunks it,
embeds each chunk via shared/embeddings.py, and stores in Firestore.

Usage:
    python scripts/index_syllabuses.py [--dry-run] [--force]

Env vars:
    GCP_PROJECT_ID       — Google Cloud project (read by shared.config)
    INFERENCE_BACKEND     — "vertex" (prod) or omit for local embeddings
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
import re
import sys
import time
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

SYLLABUSES_DIR = Path(__file__).resolve().parent.parent / "syllabuses"
CHUNK_SIZE = 500       # approximate tokens (chars / 4)
CHUNK_OVERLAP = 50     # overlap tokens
CHARS_PER_TOKEN = 4    # rough estimate

# ── Filename parser ───────────────────────────────────────────────────────────

_LEVEL_PATTERNS = {
    "Primary":  "primary",
    "OLevel":   "o_level",
    "O_Level":  "o_level",
    "ALevel":   "a_level",
    "A_Level":  "a_level",
    "Form1":    "form_1",
    "Form2":    "form_2",
    "Form3":    "form_3",
    "Form4":    "form_4",
    "Forms14":  "form_1_to_4",
}


def parse_filename(filename: str) -> dict:
    """
    Extract subject and education_level from a syllabus filename.
    Format: SYLLABUS_<Subject>_<Level>_<Country>.pdf
    """
    stem = Path(filename).stem  # remove .pdf
    parts = stem.split("_")

    # Remove "SYLLABUS" prefix
    if parts and parts[0].upper() == "SYLLABUS":
        parts = parts[1:]

    # Last part is usually country
    country = parts[-1] if parts else "Unknown"
    parts = parts[:-1]  # remove country

    # Find education level by matching known patterns
    education_level = ""
    level_idx = -1
    for i, part in enumerate(parts):
        for pattern, level in _LEVEL_PATTERNS.items():
            if pattern.lower() in part.lower():
                education_level = level
                level_idx = i
                break
        if education_level:
            break

    # Everything before the level part is the subject
    if level_idx > 0:
        subject = " ".join(parts[:level_idx])
    elif level_idx == 0:
        subject = " ".join(parts[1:]) if len(parts) > 1 else "General"
    else:
        subject = " ".join(parts) if parts else "Unknown"

    # Clean up subject: split camelCase
    subject = re.sub(r"([a-z])([A-Z])", r"\1 \2", subject)
    # Remove parenthesized numbers like (1), (2)
    subject = re.sub(r"\(\d+\)", "", subject).strip()

    return {
        "subject": subject,
        "education_level": education_level or "general",
        "country": country,
        "curriculum": "ZIMSEC" if country.lower() == "zimbabwe" else country,
    }


# ── Text chunking ─────────────────────────────────────────────────────────────

def chunk_text(text: str, chunk_chars: int, overlap_chars: int) -> list[str]:
    """Split text into overlapping chunks at sentence boundaries."""
    if not text.strip():
        return []

    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for sentence in sentences:
        slen = len(sentence)
        if current_len + slen > chunk_chars and current:
            chunks.append(" ".join(current))
            # Keep overlap
            overlap_text = " ".join(current)
            keep = overlap_text[-overlap_chars:] if len(overlap_text) > overlap_chars else overlap_text
            current = [keep]
            current_len = len(keep)
        current.append(sentence)
        current_len += slen

    if current:
        chunks.append(" ".join(current))

    return [c.strip() for c in chunks if c.strip()]


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Index syllabus PDFs into Firestore")
    parser.add_argument("--dry-run", action="store_true", help="Parse and chunk but don't store")
    parser.add_argument("--force", action="store_true", help="Re-index files even if already indexed")
    args = parser.parse_args()

    if not SYLLABUSES_DIR.exists():
        logger.error("Syllabuses directory not found: %s", SYLLABUSES_DIR)
        sys.exit(1)

    pdfs = sorted(SYLLABUSES_DIR.glob("*.pdf"))
    if not pdfs:
        logger.error("No PDF files found in %s", SYLLABUSES_DIR)
        sys.exit(1)

    logger.info("Found %d PDF files in %s", len(pdfs), SYLLABUSES_DIR)

    # Import after path setup
    from shared.vector_db import store_document
    from shared.firestore_client import query

    # Check which files are already indexed
    existing_files: set[str] = set()
    if not args.force:
        try:
            docs = query("rag_syllabuses", [])
            existing_files = {d.get("metadata", {}).get("source_file", "") for d in docs}
            if existing_files:
                logger.info("Already indexed: %d files — will skip", len(existing_files))
        except Exception:
            pass

    total_chunks = 0
    total_skipped = 0

    for pdf_path in pdfs:
        filename = pdf_path.name

        if filename in existing_files and not args.force:
            logger.info("  SKIP %s (already indexed)", filename)
            total_skipped += 1
            continue

        # Parse metadata from filename
        meta = parse_filename(filename)
        logger.info("  FILE %s → subject=%s level=%s curriculum=%s",
                     filename, meta["subject"], meta["education_level"], meta["curriculum"])

        # Extract text
        try:
            import pdfplumber
            text = ""
            with pdfplumber.open(pdf_path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text() or ""
                    text += page_text + "\n"
        except Exception as e:
            logger.error("    Failed to extract text: %s", e)
            continue

        if not text.strip():
            logger.warning("    Empty text — skipping")
            continue

        # Chunk
        chunk_chars = CHUNK_SIZE * CHARS_PER_TOKEN
        overlap_chars = CHUNK_OVERLAP * CHARS_PER_TOKEN
        chunks = chunk_text(text, chunk_chars, overlap_chars)
        logger.info("    Extracted %d chars → %d chunks", len(text), len(chunks))

        if args.dry_run:
            total_chunks += len(chunks)
            continue

        # Store each chunk
        for i, chunk in enumerate(chunks):
            doc_id = f"{hashlib.md5(filename.encode()).hexdigest()[:8]}-{i:04d}"
            chunk_meta = {
                **meta,
                "source_file": filename,
                "chunk_index": i,
            }

            try:
                store_document("syllabuses", doc_id, chunk, chunk_meta)
            except Exception as e:
                logger.error("    Chunk %d failed: %s", i, e)
                continue

            total_chunks += 1

            # Small delay to avoid rate limiting on embedding API
            if (i + 1) % 10 == 0:
                time.sleep(0.5)

        logger.info("    Stored %d chunks for %s", len(chunks), filename)

    logger.info("")
    logger.info("Done. %d chunks indexed, %d files skipped.", total_chunks, total_skipped)
    if args.dry_run:
        logger.info("(dry run — nothing was stored)")


if __name__ == "__main__":
    main()
