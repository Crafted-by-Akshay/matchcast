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
KEPT_REPLAYED = (*FEED_REPLAYED, *CREW_REPLAYED)  # kept past the buffer, each kind newest-capped
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
        # the newest feed and crew records the buffer has evicted, in publish order: they are older
        # than _log, so a resume from any of them replays what came after it, in order
        self._kept: list[StreamEvent] = []
        self._subscribers: set[asyncio.Queue[StreamEvent]] = set()

    def publish(self, event: str, id_: str | None, data: dict[str, Any]) -> None:
        item = StreamEvent(event, id_, data)
        self._log.append(item)
        overflow = len(self._log) - self._buffer
        if overflow > 0:
            evicted = self._log[:overflow]
            del self._log[:overflow]
            self._kept.extend(e for e in evicted if e.event in KEPT_REPLAYED)
            if len(self._kept) > 2 * (FEED_REPLAY_LIMIT + CREW_REPLAY_LIMIT):
                self._trim_kept()
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(item)
            except asyncio.QueueFull:
                self._subscribers.discard(queue)

    def _trim_kept(self) -> None:
        """Keep the newest FEED_REPLAY_LIMIT feed records and the newest CREW_REPLAY_LIMIT crew
        frames of the kept list, in publish order."""
        feeds = [i for i, e in enumerate(self._kept) if e.event in FEED_REPLAYED]
        crew = [i for i, e in enumerate(self._kept) if e.event in CREW_REPLAYED]
        dropped = set(feeds[:-FEED_REPLAY_LIMIT]) | set(crew[:-CREW_REPLAY_LIMIT])
        self._kept = [e for i, e in enumerate(self._kept) if i not in dropped]

    def history(self) -> list[StreamEvent]:
        return list(self._log)

    def replay_after(
        self, last_id: str | None, wanted: Callable[[StreamEvent], bool] | None = None
    ) -> list[StreamEvent]:
        """Records after ``last_id`` (all of them when it is unknown), oldest first.

        Publications and audit records are capped at the first 500 of what ``wanted`` lets
        through. Feed records and crew frames are each capped at the newest 2000 of those, and
        both are kept past the buffer, in publish order, so a late desk still counts the feeds of
        a long match and a late viewer still has the crew tree."""
        records = [*self._kept, *self._log]
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
