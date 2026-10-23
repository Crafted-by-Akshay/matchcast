"""Event Hubs transport for the match stream (DAT-1, DAT-2; F1; ADR-0005, ADR-0006).

Publishing and consuming are kept apart from what is done with an event, so the same handler runs
behind a real hub, behind ``MemoryBus`` in tests and in the api's ``memory`` pipeline mode.

* ``EventHubsPublisher.publish(sk, events)`` sends one batch with the stream key as partition key,
  so one match stays in order. It raises when the hub does not accept the events.
* ``EventHubsSource.run(handler)`` receives batches on ``$Default`` and checkpoints to Blob only
  after the handler returned. A batch the handler keeps failing on is retried ``RETRIES`` times and
  then logged and skipped, so one bad match cannot stop the single partition (at-least-once with a
  bounded retry; the reducer drops duplicates by sequence).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

log = logging.getLogger("matchcast.eventhubs")

RETRIES = 3
RETRY_DELAY_S = 1.0
MAX_BATCH = 50

Handler = Callable[[list[dict[str, Any]]], Awaitable[None]]


class Publisher(Protocol):
    async def publish(self, sk: str, events: list[dict[str, Any]]) -> None: ...
    async def close(self) -> None: ...


def encode(event: dict[str, Any]) -> bytes:
    return json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def decode(body: bytes | str) -> dict[str, Any]:
    return json.loads(body)


class EventHubsPublisher:
    """``producer``: an ``azure.eventhub.aio.EventHubProducerClient`` or a fake."""

    def __init__(self, producer: Any, event_data: Callable[[bytes], Any] | None = None) -> None:
        self._producer = producer
        if event_data is None:
            from azure.eventhub import EventData

            event_data = EventData
        self._event_data = event_data

    async def publish(self, sk: str, events: list[dict[str, Any]]) -> None:
        batch = await self._producer.create_batch(partition_key=sk)
        for event in events:
            data = self._event_data(encode(event))
            try:
                batch.add(data)
            except ValueError:  # the batch is full: send it and start the next one
                await self._producer.send_batch(batch)
                batch = await self._producer.create_batch(partition_key=sk)
                batch.add(data)
        await self._producer.send_batch(batch)

    async def close(self) -> None:
        await self._producer.close()


class EventHubsSource:
    """``consumer`` is an ``azure.eventhub.aio.EventHubConsumerClient`` with a checkpoint store."""

    def __init__(self, consumer: Any, retry_delay_s: float = RETRY_DELAY_S) -> None:
        self._consumer = consumer
        self._delay = retry_delay_s

    async def run(self, handler: Handler) -> None:
        async def on_batch(partition_context: Any, batch: list[Any]) -> None:
            if not batch:
                return
            events: list[dict[str, Any]] = []
            for data in batch:
                try:
                    events.append(decode(data.body_as_str()))
                except ValueError:
                    log.error("dropping an event that is not JSON (offset %s)", data.offset)
            started = time.monotonic()
            lag = _lag_s(batch[0])
            await deliver(handler, events, self._delay)
            await partition_context.update_checkpoint(batch[-1])
            log.info(
                "partition %s: handled %d events in %.2f s, %s behind the hub",
                getattr(partition_context, "partition_id", "?"),
                len(events),
                time.monotonic() - started,
                "?" if lag is None else f"{lag:.1f} s",
            )

        async with self._consumer:
            await self._consumer.receive_batch(
                on_event_batch=on_batch,
                max_batch_size=MAX_BATCH,
                max_wait_time=1,
                starting_position="-1",
            )


def _lag_s(data: Any) -> float | None:
    """Seconds since the hub enqueued the first event of a batch: how far the consumer is behind."""
    try:
        return max(0.0, time.time() - data.enqueued_time.timestamp())
    except (AttributeError, TypeError, ValueError, OSError):  # a metric must never stop the stream
        return None


async def deliver(handler: Handler, events: list[dict[str, Any]], delay_s: float = 0) -> bool:
    """Run ``handler`` with a bounded retry; False when the batch was skipped."""
    if not events:
        return True
    for attempt in range(1, RETRIES + 1):
        try:
            await handler(events)
            return True
        except Exception:  # noqa: BLE001 - the handler's failure must not stop the stream
            log.exception("handler failed (attempt %d of %d)", attempt, RETRIES)
            if attempt < RETRIES:
                await asyncio.sleep(delay_s)
    log.error("skipping a batch of %d events after %d failures", len(events), RETRIES)
    return False


class MemoryBus:
    """An in-process stand-in for the hub: same ``publish``, and ``run`` plays the consumer."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[list[dict[str, Any]] | None] = asyncio.Queue()

    async def publish(self, sk: str, events: list[dict[str, Any]]) -> None:
        await self._queue.put([json.loads(encode(e)) for e in events])  # what a hub would carry

    async def run(self, handler: Handler) -> None:
        while (batch := await self._queue.get()) is not None:
            await deliver(handler, batch)
            self._queue.task_done()
        self._queue.task_done()

    async def drain(self) -> None:
        """Wait until everything published so far was handled (tests)."""
        await self._queue.join()

    async def close(self) -> None:
        await self._queue.put(None)
