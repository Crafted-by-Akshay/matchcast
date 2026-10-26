"""In-process fan-out of stream events to SSE subscribers, with a replay buffer per match."""

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

PUBLICATION_REPLAYED = ("publication", "audit")
# onair and feed_drop are records, not speech: a desk that opens late rebuilds its feed monitor
# from them. They are kept past the buffer, so a long match still has its feed records
FEED_REPLAYED = ("onair", "feed_drop")
# the crew's frames (contract 1.3.0): one ledger and the spawn starts and ends of each moment. A
# viewer who opens the stream late rebuilds the crew tree and ledger from them
CREW_REPLAYED = ("crew_ledger", "crew_spawn")
REPLAYED = (*PUBLICATION_REPLAYED, *FEED_REPLAYED, *CREW_REPLAYED)
REPLAY_LIMIT = 500
FEED_REPLAY_LIMIT = 2000
CREW_REPLAY_LIMIT = 2000


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
        # the newest feed records the buffer has evicted, oldest first: they are older than _log
        self._kept_feeds: list[StreamEvent] = []
        self._subscribers: set[asyncio.Queue[StreamEvent]] = set()

    def publish(self, event: str, id_: str | None, data: dict[str, Any]) -> None:
        item = StreamEvent(event, id_, data)
        self._log.append(item)
        overflow = len(self._log) - self._buffer
        if overflow > 0:
            evicted = self._log[:overflow]
            del self._log[:overflow]
            self._kept_feeds.extend(e for e in evicted if e.event in FEED_REPLAYED)
            del self._kept_feeds[:-FEED_REPLAY_LIMIT]
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

        Publications and audit records are capped at the first 500 of what ``wanted`` lets
        through. Feed records are capped at the newest 2000 of those, and they are kept past the
        buffer, so a late desk still counts the feeds of a long match."""
        records = [*self._kept_feeds, *self._log]
        start = 0
        if last_id:
            for index, item in enumerate(records):
                if item.id == last_id:
                    start = index + 1
        candidates = [
            (index, item)
            for index, item in enumerate(records[start:])
            if item.event in REPLAYED and (wanted is None or wanted(item))
        ]
        publications = [pair for pair in candidates if pair[1].event in PUBLICATION_REPLAYED]
        feeds = [pair for pair in candidates if pair[1].event in FEED_REPLAYED]
        crew = [pair for pair in candidates if pair[1].event in CREW_REPLAYED]
        chosen = {
            index
            for index, _ in publications[:REPLAY_LIMIT]
            + feeds[-FEED_REPLAY_LIMIT:]
            + crew[-CREW_REPLAY_LIMIT:]
        }
        return [item for index, item in candidates if index in chosen]

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
