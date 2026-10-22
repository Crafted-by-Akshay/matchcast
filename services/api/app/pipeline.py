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

With ``MATCHCAST_STATE_WRITER=reducer`` (ADR-0017) the consumer first runs the batch through the
state reducer, which then owns ``matchstate``, and hands the workflow the events the reducer
applied plus the duplicates it dropped (the workflow dedupes them itself, and a redelivery after a
crash between the two still reaches it). Only events held behind a gap wait.

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
from matchcast_worker.reducer import stream_key
from matchcast_worker.repo import MemoryStateRepo, StateRepo, process_applied

if TYPE_CHECKING:
    from app.matches import Registry

log = logging.getLogger("matchcast.pipeline")

MODES = ("direct", "memory", "eventhubs")


def pipeline_mode() -> str:
    mode = os.environ.get("MATCHCAST_PIPELINE", "direct")
    if mode not in MODES:
        raise ValueError(f"MATCHCAST_PIPELINE must be one of {', '.join(MODES)}, not {mode!r}")
    return mode


def _state_repo() -> StateRepo | None:
    """The reducer's repository when it owns ``matchstate``, else None (the workflow writes)."""
    writer = os.environ.get("MATCHCAST_STATE_WRITER", "workflow")
    if writer == "workflow":
        return None
    if writer != "reducer":
        raise ValueError(f"MATCHCAST_STATE_WRITER must be workflow or reducer, not {writer!r}")
    if os.environ.get("MATCHCAST_STORE", "memory") == "table":
        from matchcast_shared import azure_clients
        from matchcast_worker.table_repo import TableStateRepo

        return TableStateRepo(azure_clients.table_service_client())
    return MemoryStateRepo()


class _Staged:
    """Reducer writes held back until the workflow has taken the events (ADR-0017): the reducer
    save is not the commit point, so a failed ingest leaves the table as it was and the redelivered
    batch finds any held event still held."""

    def __init__(self, repo: StateRepo) -> None:
        self._repo = repo
        self._latest: dict[str, Any] = {}
        self._saves: list[tuple[str, Any]] = []

    def get(self, sk: str) -> Any:
        state = self._latest.get(sk)
        return state.model_copy(deep=True) if state else self._repo.get(sk)

    def save(self, sk: str, state: Any) -> None:
        self._latest[sk] = state.model_copy(deep=True)
        self._saves.append((sk, self._latest[sk]))

    def flush(self) -> None:
        for sk, state in self._saves:
            self._repo.save(sk, state)
        self._saves.clear()


def _key(event: dict[str, Any]) -> tuple[str, int]:
    return event["event_id"], event.get("revision", 0)


class Pipeline:
    def __init__(
        self,
        registry: Registry,
        publisher: Publisher,
        source: Any,
        state_repo: StateRepo | None = None,
    ) -> None:
        self.registry = registry
        self.publisher = publisher
        self._source = source
        self.state_repo = state_repo
        self._locks: dict[str, asyncio.Lock] = {}

    @classmethod
    def build(cls, registry: Registry, mode: str | None = None) -> Pipeline | None:
        mode = mode or pipeline_mode()
        if mode == "direct":
            return None
        repo = _state_repo()
        if mode == "memory":
            bus = MemoryBus()
            return cls(registry, bus, bus, repo)
        from matchcast_shared import azure_clients

        publisher = EventHubsPublisher(azure_clients.eventhub_producer_aio())
        source = EventHubsSource(azure_clients.eventhub_consumer_aio())
        return cls(registry, publisher, source, repo)

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
        from app.matches import Problem

        for (session_id, match_id), batch in groups.items():
            try:
                flow = await self.registry.flow_for(session_id, match_id)
            except (Problem, LookupError):
                log.warning("dropping %d events of unknown match %s", len(batch), match_id)
                continue
            if self.state_repo is not None:
                await self._handle_reduced(flow, match_id, batch)
                continue
            try:
                await flow.ingest(batch)
            except ContractError as error:
                # The edge validates, so this is a stale or foreign event. Ingest is all or
                # nothing, so keep the valid events by trying them one at a time.
                log.warning("batch of %s rejected (%s); retrying event by event", match_id, error)
                for event in batch:
                    try:
                        await flow.ingest([event])
                    except ContractError as single:
                        log.warning("dropping event of %s: %s", match_id, single)

    def _reduce(self, staged: _Staged, batch: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Run valid events through the reducer; return what the workflow should see, in order."""
        before: dict[str, int] = {}
        for event in batch:
            sk = stream_key(event)
            if sk not in before:
                state = staged.get(sk)
                before[sk] = state.max_sequence if state else 0
        _, applied = process_applied(staged, batch)
        out = {_key(e): e for e in applied}
        for event in batch:  # a duplicate: the workflow dedupes it, and a replay must reach it
            if event["stream_sequence"] <= before[stream_key(event)]:
                out.setdefault(_key(event), event)
        return sorted(out.values(), key=lambda e: e["stream_sequence"])

    async def _handle_reduced(self, flow: Any, match_id: str, batch: list[dict[str, Any]]) -> None:
        """ADR-0017: validate each event, reduce, give the workflow the result, then commit."""
        valid = []
        for event in batch:
            try:
                flow.validate_batch([event])
                if not isinstance(event["stream_sequence"], int):
                    raise TypeError("stream_sequence must be an integer")
                valid.append(event)
            except (ContractError, KeyError, TypeError) as error:
                log.warning("dropping event of %s: %s", match_id, error)
        if not valid:
            return
        lock = self._locks.setdefault(flow.sk, asyncio.Lock())
        async with lock:
            staged = _Staged(self.state_repo)  # type: ignore[arg-type]
            out = await asyncio.to_thread(self._reduce, staged, valid)
            if out:
                await flow.ingest(out)
            await asyncio.to_thread(staged.flush)

    async def _supervise(self) -> None:
        """Run the consumer, and start it again after a failure (RBAC still propagating, a
        missing checkpoint container, a transport error) instead of dying silently."""
        delay = 1.0
        while True:
            try:
                await self._source.run(self.handle)
                return
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - keep consuming whatever the transport throws
                log.exception("event consumer stopped; restarting in %.0f s", delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30.0)

    @asynccontextmanager
    async def running(self) -> AsyncIterator[None]:
        task = asyncio.create_task(self._supervise(), name="match-events-consumer")
        try:
            yield
        finally:
            if hasattr(self._source, "close"):
                await self._source.close()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await self.publisher.close()
