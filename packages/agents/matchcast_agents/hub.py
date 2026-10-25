"""In-process fan-out of stream events to SSE subscribers, with a replay buffer per match."""

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

# onair and feed_drop are records, not speech, so a reconnecting desk can rebuild its feed monitor
REPLAYED = ("publication", "audit", "onair", "feed_drop")
REPLAY_LIMIT = 500


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

    def replay_after(self, last_id: str | None) -> list[StreamEvent]:
        """Publications and audit records after ``last_id`` (all of them when it is unknown)."""
        start = 0
        if last_id:
            for index, item in enumerate(self._log):
                if item.id == last_id:
                    start = index + 1
        rows = [e for e in self._log[start:] if e.event in REPLAYED]
        return rows[:REPLAY_LIMIT]

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
