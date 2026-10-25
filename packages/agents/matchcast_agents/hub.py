"""In-process fan-out of stream events to SSE subscribers, with a replay buffer per match."""

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

PUBLICATION_REPLAYED = ("publication", "audit")
# onair and feed_drop are records, not speech: a desk that opens late rebuilds its feed monitor from
# them, so they have their own budget and are not crowded out by publications and audit records
FEED_REPLAYED = ("onair", "feed_drop")
REPLAYED = (*PUBLICATION_REPLAYED, *FEED_REPLAYED)
REPLAY_LIMIT = 500
FEED_REPLAY_LIMIT = 2000


@dataclass(frozen=True)
class StreamEvent:
    event: str
    id: str | None
    data: dict[str, Any]

    def encode(self) -> str:
        lines = [f"event: {self.event}"]
        if self.id:
            lines.append(f"id: {self.id}")
        lines.append("data: " + json.dumps(self.data, separators=(",", ":"), ensure_ascii=False))
        return "\n".join(lines) + "\n\n"


class StreamHub:
    """One per match. ``publish`` never blocks; a slow subscriber is dropped, not waited for."""

    def __init__(self, buffer: int = 5000) -> None:
        self._buffer = buffer
        self._log: list[StreamEvent] = []
        self._subscribers: set[asyncio.Queue[StreamEvent]] = set()

    def publish(self, event: str, id_: str | None, data: dict[str, Any]) -> None:
        item = StreamEvent(event, id_, data)
        self._log.append(item)
        del self._log[: -self._buffer]
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(item)
            except asyncio.QueueFull:
                self._subscribers.discard(queue)

    def history(self) -> list[StreamEvent]:
        return list(self._log)

    def replay_after(
        self, last_id: str | None, wanted: Callable[[StreamEvent], bool] | None = None
    ) -> list[StreamEvent]:
        """Records after ``last_id`` (all of them when it is unknown), oldest first.

        The first 500 publication and audit records and the first 2000 feed records are kept, so
        the caps count only what ``wanted`` lets through, in the order they were published."""
        start = 0
        if last_id:
            for index, item in enumerate(self._log):
                if item.id == last_id:
                    start = index + 1
        kept: list[StreamEvent] = []
        counts = {"publication": 0, "feed": 0}
        for item in self._log[start:]:
            if item.event not in REPLAYED or (wanted is not None and not wanted(item)):
                continue
            kind, limit = (
                ("feed", FEED_REPLAY_LIMIT)
                if item.event in FEED_REPLAYED
                else ("publication", REPLAY_LIMIT)
            )
            if counts[kind] < limit:
                counts[kind] += 1
                kept.append(item)
        return kept

    async def subscribe(self, replay: list[StreamEvent]) -> AsyncIterator[StreamEvent]:
        queue: asyncio.Queue[StreamEvent] = asyncio.Queue(maxsize=1000)
        self._subscribers.add(queue)
        try:
            for item in replay:
                yield item
            while True:
                yield await queue.get()
        finally:
            self._subscribers.discard(queue)
