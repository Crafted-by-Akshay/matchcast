"""Event Hubs sink for scripts/replay_match.py (DAT-1).

Batches go to the `match-events` hub with the stream key as partition key, the same way the api
publishes in `MATCHCAST_PIPELINE=eventhubs`.

Needs `EVENTHUB_FQDN` (and optionally `EVENTHUB_NAME`) and an Entra login that holds Azure Event
Hubs Data Sender on the namespace; no key is read or written. The match must exist in the api
(replay_match.py creates it over HTTP first) so the consumer can rebuild its workflow.
"""

from __future__ import annotations

import asyncio
from typing import Any


class EventHubSink:
    """``publisher``: ``async publish(sk, events)`` and ``async close()`` (EventHubsPublisher).

    The sink owns one event loop and the publisher must have been created on it, because the
    Event Hubs transport binds to the loop it starts on.
    """

    def __init__(self, publisher: Any, loop: asyncio.AbstractEventLoop | None = None) -> None:
        self._publisher = publisher
        self._loop = loop or asyncio.new_event_loop()
        self._closed = False

    def send(self, sk: str, events: list[dict[str, Any]]) -> None:
        self._loop.run_until_complete(self._publisher.publish(sk, events))

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._loop.run_until_complete(self._publisher.close())
        finally:
            self._loop.close()


def from_env() -> EventHubSink:
    from matchcast_shared import azure_clients
    from matchcast_worker.eventhubs import EventHubsPublisher

    loop = asyncio.new_event_loop()

    async def make() -> Any:
        return azure_clients.eventhub_producer_aio()

    return EventHubSink(EventHubsPublisher(loop.run_until_complete(make())), loop)
