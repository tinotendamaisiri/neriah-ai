"""
scripts/backfill_class_id.py
Backfill the 'class_id' field on Mark documents that were created before
class_id denormalization was added to the marking pipeline.

Usage:
    python scripts/backfill_class_id.py            # live run
    python scripts/backfill_class_id.py --dry-run  # log only, no writes

Logic:
  For each Mark without a class_id:
    1. Look up the AnswerKey by answer_key_id → get class_id
    2. Update the Mark document with class_id
  This makes GET /api/analytics/class/{class_id} fast by enabling partition
  queries instead of full cross-partition scans.

Performance note:
  AnswerKey lookups are cross-partition (answer_key_id is not partition key).
  Results are cached per answer_key_id to avoid redundant RU spend.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))

from azure.cosmos import CosmosClient  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("backfill_class_id")


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill class_id on Mark documents")
    parser.add_argument("--dry-run", action="store_true", help="Log changes without writing")
    args = parser.parse_args()

    cosmos_endpoint = os.environ.get("AZURE_COSMOS_ENDPOINT")
    cosmos_key = os.environ.get("AZURE_COSMOS_KEY")
    db_name = os.environ.get("AZURE_COSMOS_DATABASE", "neriah")

    if not cosmos_endpoint or not cosmos_key:
        logger.error(
            "AZURE_COSMOS_ENDPOINT and AZURE_COSMOS_KEY must be set in environment or backend/.env"
        )
        sys.exit(1)

    mode = "DRY RUN" if args.dry_run else "LIVE"
    logger.info("=== backfill_class_id [%s] ===", mode)

    client = CosmosClient(cosmos_endpoint, cosmos_key)
    db = client.get_database_client(db_name)
    marks_container = db.get_container_client("marks")
    answer_keys_container = db.get_container_client("answer_keys")

    # Find all marks missing class_id
    query = "SELECT * FROM c WHERE NOT IS_DEFINED(c.class_id) OR c.class_id = null"
    marks = list(marks_container.query_items(query=query, enable_cross_partition_query=True))

    if not marks:
        logger.info("No marks need backfilling.")
        return

    logger.info("Found %d mark(s) without class_id.", len(marks))

    # Cache: answer_key_id → class_id
    ak_cache: dict[str, str | None] = {}
    updated = 0
    skipped = 0

    for mark in marks:
        mark_id = mark.get("id")
        ak_id = mark.get("answer_key_id")
        student_id = mark.get("student_id")  # partition key for marks container

        if not ak_id:
            logger.warning("  Mark id=%s has no answer_key_id — skipping.", mark_id)
            skipped += 1
            continue

        # Resolve class_id from answer key (with cache)
        if ak_id not in ak_cache:
            ak_results = list(answer_keys_container.query_items(
                query="SELECT c.class_id FROM c WHERE c.id = @id",
                parameters=[{"name": "@id", "value": ak_id}],
                enable_cross_partition_query=True,
            ))
            ak_cache[ak_id] = ak_results[0]["class_id"] if ak_results else None

        class_id = ak_cache[ak_id]

        if not class_id:
            logger.warning(
                "  Mark id=%s: answer_key %s not found — skipping.", mark_id, ak_id
            )
            skipped += 1
            continue

        logger.info(
            "  Mark id=%s student=%s → class_id=%s", mark_id, student_id, class_id
        )

        if not args.dry_run:
            mark["class_id"] = class_id
            marks_container.upsert_item(mark)
            updated += 1
        else:
            updated += 1  # count as "would update"

    logger.info(
        "=== Done: %s %d mark(s), skipped %d ===",
        "Would update" if args.dry_run else "Updated",
        updated,
        skipped,
    )


if __name__ == "__main__":
    main()
