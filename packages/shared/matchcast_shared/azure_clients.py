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


def foundry_token() -> None:
    """Obtain (and discard) a token for Azure AI. Raises if no credential works."""
    credential().get_token(FOUNDRY_SCOPE)
