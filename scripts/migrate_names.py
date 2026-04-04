"""
scripts/migrate_names.py
One-time migration: split the legacy single 'name' field into 'first_name' + 'surname'
for existing Teacher and Student records in Cosmos DB.

Usage:
    python scripts/migrate_names.py            # live run
    python scripts/migrate_names.py --dry-run  # log only, no writes

Logic:
  - For each doc that has 'name' but NOT 'first_name':
      - Split on first space:  everything before → first_name,  everything after → surname
      - If only one word:      first_name = name,  surname = ""  (flagged in log)
  - The old 'name' field is KEPT for safety (can be removed in a follow-up cleanup).

Partition key notes:
  - teachers container:  partition key = /phone   → query by phone, upsert with phone as pk
  - students container:  partition key = /class_id → cross-partition query, upsert with class_id
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

# Ensure the backend package root is on sys.path when run from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))

from azure.cosmos import CosmosClient  # noqa: E402  (after sys.path manipulation)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("migrate_names")


def _split_name(name: str) -> tuple[str, str]:
    """Split a full name string into (first_name, surname)."""
    parts = name.strip().split(None, 1)
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1]


def migrate_container(
    container,
    partition_key_field: str,
    dry_run: bool,
) -> tuple[int, int]:
    """
    Iterate over all documents in a Cosmos container and migrate any that
    have a 'name' field but no 'first_name'.

    Returns (migrated_count, flagged_count).
    """
    migrated = 0
    flagged = 0

    query = "SELECT * FROM c WHERE IS_DEFINED(c.name) AND NOT IS_DEFINED(c.first_name)"
    items = list(container.query_items(query=query, enable_cross_partition_query=True))

    if not items:
        logger.info("  No documents need migration.")
        return 0, 0

    logger.info("  Found %d document(s) to migrate.", len(items))

    for doc in items:
        raw_name: str = doc.get("name", "").strip()
        if not raw_name:
            logger.warning("  Skipping doc id=%s — 'name' field is empty.", doc.get("id"))
            continue

        first_name, surname = _split_name(raw_name)
        single_word = surname == ""

        if single_word:
            flagged += 1
            logger.warning(
                "  FLAGGED id=%s: single-word name '%s' → first_name='%s', surname='' — manual review needed.",
                doc.get("id"), raw_name, first_name,
            )
        else:
            logger.info(
                "  Migrating id=%s: '%s' → '%s' + '%s'",
                doc.get("id"), raw_name, first_name, surname,
            )

        if not dry_run:
            doc["first_name"] = first_name
            doc["surname"] = surname
            # Keep 'name' for safety — remove in a follow-up cleanup
            pk_value = doc.get(partition_key_field)
            container.upsert_item(doc)
            migrated += 1
        else:
            migrated += 1  # count as "would migrate" in dry-run

    return migrated, flagged


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate name → first_name + surname")
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
    logger.info("=== migrate_names [%s] ===", mode)

    client = CosmosClient(cosmos_endpoint, cosmos_key)
    db = client.get_database_client(db_name)

    for container_name, pk_field in [("teachers", "phone"), ("students", "class_id")]:
        logger.info("--- Container: %s (pk=/%s) ---", container_name, pk_field)
        container = db.get_container_client(container_name)
        migrated, flagged = migrate_container(container, pk_field, args.dry_run)
        logger.info(
            "  %s %d document(s) migrated, %d flagged for manual review.",
            "Would have" if args.dry_run else "Successfully",
            migrated,
            flagged,
        )

    logger.info("=== Done ===")


if __name__ == "__main__":
    main()
