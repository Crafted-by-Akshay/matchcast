"""The live pipeline between the api edge and the match workflow (F1; ADR-0005, ADR-0006).

``MATCHCAST_PIPELINE`` picks how ``POST /v1/matches/{id}/events`` reaches the workflow:

* ``direct`` (default): the route validates and runs the workflow in the request, as in the
  browser prototype and in every test.
* ``eventhubs``: the route validates, publishes to the ``match-events`` hub with the stream key as
  partition key, and answers 202 once the hub has the events (a publish failure is a 503 and the
  browser sends the same batch again). A consumer inside this process reads the hub on ``$Default``
  with Blob checkpoints and runs the workflow. The reducer drops events it has seen, so a retried
  batch or a redelivery changes nothing.
* ``memory``: the same two halves joined by an in-process queue, to exercise the pipeline code
  without a hub (local runs, tests).

A match this process has no workflow for (the api restarted) is rebuilt from the stored roster, so
the consumer resumes from the checkpoint instead of dropping events.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

from matchcast_contracts import ContractError
from matchcast_worker.eventhubs import EventHubsPublisher, EventHubsSource, MemoryBus, Publisher

if TYPE_CHECKING:
    from app.matches import Registry

log = logging.getLogger("matchcast.pipeline")

MODES = ("direct", "memory", "eventhubs")


def pipeline_mode() -> str:
    mode = os.environ.get("MATCHCAST_PIPELINE", "direct")
    if mode not in MODES:
        raise ValueError(f"MATCHCAST_PIPELINE must be one of {', '.join(MODES)}, not {mode!r}")
    return mode


class Pipeline:
    def __init__(self, registry: Registry, publisher: Publisher, source: Any) -> None:
        self.registry = registry
        self.publisher = publisher
        self._source = source

    @classmethod
    def build(cls, registry: Registry, mode: str | None = None) -> Pipeline | None:
        mode = mode or pipeline_mode()
        if mode == "direct":
            return None
        if mode == "memory":
            bus = MemoryBus()
            return cls(registry, bus, bus)
        from matchcast_shared import azure_clients

        publisher = EventHubsPublisher(azure_clients.eventhub_producer_aio())
        return cls(registry, publisher, EventHubsSource(azure_clients.eventhub_consumer_aio()))

    async def publish(self, sk: str, events: list[dict[str, Any]]) -> None:
        await self.publisher.publish(sk, events)

    async def handle(self, events: list[dict[str, Any]]) -> None:
        """Consumer side: group a hub batch by match, keep order, run each match's workflow."""
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for event in events:
            stream = event.get("stream", {})
            groups.setdefault(
                (stream.get("session_id", ""), stream.get("match_id", "")), []
            ).append(event)
        for (session_id, match_id), batch in groups.items():
            try:
                flow = await self.registry.flow_for(session_id, match_id)
                await flow.ingest(batch)
            except (
                ContractError
            ) as error:  # the edge validates, so this is a stale or foreign event
                log.warning("dropping %d events of %s: %s", len(batch), match_id, error)
            except LookupError:
                log.warning("dropping %d events of unknown match %s", len(batch), match_id)

    @asynccontextmanager
    async def running(self) -> AsyncIterator[None]:
        task = asyncio.create_task(self._source.run(self.handle), name="match-events-consumer")
        try:
            yield
        finally:
            if hasattr(self._source, "close"):
                await self._source.close()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await self.publisher.close()
