# shared/cosmos_client.py
# Single interface between all Azure Functions and Cosmos DB.
# All public functions are async — use with `await` from async function handlers.
# Uses azure.cosmos.aio (async SDK). One module-level client instance is shared
# across the lifetime of the Function host process.

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from azure.cosmos.aio import CosmosClient
from azure.cosmos.aio import ContainerProxy
from azure.cosmos.exceptions import CosmosResourceNotFoundError

from .config import settings

logger = logging.getLogger(__name__)

DATABASE_NAME = "neriah"

CONTAINER_NAMES = frozenset({
    "teachers",
    "classes",
    "students",
    "answer_keys",
    "marks",
    "sessions",
    "rubrics",
    "submissions",
    "submission_codes",
})

# ── Module-level client (lazy singleton) ─────────────────────────────────────
# Initialized on first use, not at import time — avoids requiring credentials
# to be present at module load (important for testing and cold-start diagnostics).
# The async CosmosClient from azure.cosmos.aio manages its own internal connection
# pool; one instance shared across all invocations is the recommended pattern.
# In production, swap `credential=settings.azure_cosmos_key` for a
# `DefaultAzureCredential()` instance (managed identity — no key in env).

_client: CosmosClient | None = None


def _get_client() -> CosmosClient:
    """Return the module-level CosmosClient, creating it on first call."""
    global _client
    if _client is None:
        _client = CosmosClient(
            url=settings.azure_cosmos_endpoint,
            credential=settings.azure_cosmos_key,
        )
    return _client


def get_container(name: str) -> ContainerProxy:
    """Return the ContainerProxy for the given container name.
    Proxy objects are lightweight — no network call is made here.
    """
    return _get_client().get_database_client(DATABASE_NAME).get_container_client(name)


# ── Generic CRUD ──────────────────────────────────────────────────────────────

async def upsert_item(container_name: str, item: dict[str, Any]) -> dict[str, Any]:
    """Create or replace a document. Returns the saved document as returned by Cosmos.

    Raises:
        CosmosHttpResponseError: on any SDK-level error (auth, throttle, etc.)
    """
    container = get_container(container_name)
    logger.debug("upsert_item container=%s id=%s", container_name, item.get("id"))
    result = await container.upsert_item(item)
    return result


async def get_item(container_name: str, item_id: str, partition_key: str) -> dict[str, Any]:
    """Fetch a single document by id and partition key.

    Raises:
        CosmosResourceNotFoundError: if the document does not exist.
    """
    container = get_container(container_name)
    logger.debug("get_item container=%s id=%s pk=%s", container_name, item_id, partition_key)
    result = await container.read_item(item=item_id, partition_key=partition_key)
    return result


async def delete_item(container_name: str, item_id: str, partition_key: str) -> None:
    """Delete a document by id and partition key.

    Raises:
        CosmosResourceNotFoundError: if the document does not exist.
    """
    container = get_container(container_name)
    logger.debug("delete_item container=%s id=%s pk=%s", container_name, item_id, partition_key)
    await container.delete_item(item=item_id, partition_key=partition_key)


async def query_items(
    container_name: str,
    query: str,
    parameters: list[dict[str, Any]] | None = None,
    partition_key: str | None = None,
) -> list[dict[str, Any]]:
    """Run a parameterised SQL query against a container.

    Args:
        container_name: target container.
        query:          Cosmos SQL string, e.g. "SELECT * FROM c WHERE c.phone = @phone".
        parameters:     list of {"name": "@param", "value": value} dicts.
        partition_key:  if provided, scopes the query to a single partition (cheaper).
                        If None, enables cross-partition query.

    Returns:
        List of matching documents. Empty list if no results.
    """
    container = get_container(container_name)
    logger.debug(
        "query_items container=%s cross_partition=%s query=%r",
        container_name,
        partition_key is None,
        query,
    )

    kwargs: dict[str, Any] = {
        "query": query,
        "parameters": parameters or [],
        "enable_cross_partition_query": partition_key is None,
    }
    if partition_key is not None:
        kwargs["partition_key"] = partition_key

    results: list[dict[str, Any]] = []
    async for item in container.query_items(**kwargs):
        results.append(item)
    return results


# ── Session shortcuts ─────────────────────────────────────────────────────────

async def get_session(phone: str) -> dict[str, Any] | None:
    """Fetch the WhatsApp session document for a phone number.
    Uses phone as both document id and partition key (see CLAUDE.md Section 4).

    Returns:
        Session dict, or None if no session exists for this phone number.
    """
    logger.debug("get_session phone=%s", phone)
    try:
        return await get_item("sessions", phone, phone)
    except CosmosResourceNotFoundError:
        return None


async def save_session(session: dict[str, Any]) -> dict[str, Any]:
    """Upsert a WhatsApp session document.
    Stamps updated_at with the current UTC time before writing.

    Returns:
        The saved session document as returned by Cosmos.
    """
    session["updated_at"] = datetime.utcnow().isoformat()
    logger.debug("save_session phone=%s state=%s", session.get("phone"), session.get("state"))
    return await upsert_item("sessions", session)


# ── Teacher shortcuts ─────────────────────────────────────────────────────────

async def get_teacher_by_phone(phone: str) -> dict[str, Any] | None:
    """Fetch a teacher document by phone number.
    Scopes the query to the phone partition for a single-partition read.

    Returns:
        Teacher dict, or None if no teacher with that phone exists.
    """
    logger.debug("get_teacher_by_phone phone=%s", phone)
    results = await query_items(
        container_name="teachers",
        query="SELECT * FROM c WHERE c.phone = @phone",
        parameters=[{"name": "@phone", "value": phone}],
        partition_key=phone,
    )
    return results[0] if results else None
