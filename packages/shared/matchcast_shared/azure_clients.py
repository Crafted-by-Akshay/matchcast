"""One factory per Azure service, all authenticated with Microsoft Entra ID.

No key or connection string is accepted anywhere here. In Azure the user-assigned managed
identity is used (its client ID is in `AZURE_CLIENT_ID`); locally `DefaultAzureCredential`
falls back to `az login`. Services import these factories instead of building clients.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from azure.identity import DefaultAzureCredential

FOUNDRY_SCOPE = "https://ai.azure.com/.default"


@lru_cache(maxsize=1)
def credential() -> DefaultAzureCredential:
    """The process-wide credential. Prefers the managed identity named by AZURE_CLIENT_ID."""
    client_id = os.environ.get("AZURE_CLIENT_ID") or None
    return DefaultAzureCredential(managed_identity_client_id=client_id)


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set")
    return value


def table_service_client(url: str | None = None) -> Any:
    from azure.data.tables import TableServiceClient

    endpoint = url or _require("STORAGE_TABLE_URL")
    return TableServiceClient(endpoint=endpoint, credential=credential())


def blob_service_client(url: str | None = None) -> Any:
    from azure.storage.blob import BlobServiceClient

    account_url = url or _require("STORAGE_BLOB_URL")
    return BlobServiceClient(account_url=account_url, credential=credential())


def eventhub_producer(fqdn: str | None = None, hub: str | None = None) -> Any:
    from azure.eventhub import EventHubProducerClient

    return EventHubProducerClient(
        fully_qualified_namespace=fqdn or _require("EVENTHUB_FQDN"),
        eventhub_name=hub or os.environ.get("EVENTHUB_NAME", "match-events"),
        credential=credential(),
    )


def eventhub_consumer(
    fqdn: str | None = None, hub: str | None = None, consumer_group: str = "$Default"
) -> Any:
    from azure.eventhub import EventHubConsumerClient

    return EventHubConsumerClient(
        fully_qualified_namespace=fqdn or _require("EVENTHUB_FQDN"),
        eventhub_name=hub or os.environ.get("EVENTHUB_NAME", "match-events"),
        consumer_group=consumer_group,
        credential=credential(),
    )


@lru_cache(maxsize=1)
def credential_aio() -> Any:
    """The async twin of ``credential()`` for the aio Event Hubs and Blob clients."""
    from azure.identity.aio import DefaultAzureCredential as AsyncCredential

    return AsyncCredential(managed_identity_client_id=os.environ.get("AZURE_CLIENT_ID") or None)


def eventhub_producer_aio(fqdn: str | None = None, hub: str | None = None) -> Any:
    from azure.eventhub.aio import EventHubProducerClient

    return EventHubProducerClient(
        fully_qualified_namespace=fqdn or _require("EVENTHUB_FQDN"),
        eventhub_name=hub or os.environ.get("EVENTHUB_NAME", "match-events"),
        credential=credential_aio(),
    )


def eventhub_consumer_aio(
    fqdn: str | None = None,
    hub: str | None = None,
    consumer_group: str = "$Default",
    checkpoint_container: str = "eh-checkpoints",
    blob_url: str | None = None,
) -> Any:
    """Consumer with checkpoints in Blob ``eh-checkpoints`` (ADR-0006: everything on $Default)."""
    from azure.eventhub.aio import EventHubConsumerClient
    from azure.eventhub.extensions.checkpointstoreblobaio import BlobCheckpointStore

    store = BlobCheckpointStore(
        blob_account_url=blob_url or _require("STORAGE_BLOB_URL"),
        container_name=checkpoint_container,
        credential=credential_aio(),
    )
    return EventHubConsumerClient(
        fully_qualified_namespace=fqdn or _require("EVENTHUB_FQDN"),
        eventhub_name=hub or os.environ.get("EVENTHUB_NAME", "match-events"),
        consumer_group=consumer_group,
        credential=credential_aio(),
        checkpoint_store=store,
    )


def foundry_token() -> None:
    """Obtain (and discard) a token for Azure AI. Raises if no credential works."""
    credential().get_token(FOUNDRY_SCOPE)
