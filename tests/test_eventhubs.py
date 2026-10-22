"""Event Hubs transport (DAT-1, DAT-2): publisher batching, consumer checkpoints, bounded retry."""

import asyncio
import json

import pytest
from matchcast_worker import eventhubs
from matchcast_worker.eventhubs import EventHubsPublisher, EventHubsSource, MemoryBus, deliver


class FakeBatch:
    def __init__(self, partition_key: str, limit: int) -> None:
        self.partition_key, self.limit, self.items = partition_key, limit, []

    def add(self, data: bytes) -> None:
        if len(self.items) >= self.limit:
            raise ValueError("batch is full")
        self.items.append(data)


class FakeProducer:
    def __init__(self, limit: int = 3, fail: bool = False) -> None:
        self.limit, self.fail, self.sent, self.closed = limit, fail, [], False

    async def create_batch(self, partition_key: str) -> FakeBatch:
        return FakeBatch(partition_key, self.limit)

    async def send_batch(self, batch: FakeBatch) -> None:
        if self.fail:
            raise ConnectionError("hub unreachable")
        self.sent.append(batch)

    async def close(self) -> None:
        self.closed = True


def event(seq: int) -> dict:
    return {"kind": "event", "stream_sequence": seq, "stream": {"match_id": "m1"}, "text": "é"}


def test_publisher_keeps_the_partition_key_and_splits_a_full_batch() -> None:
    producer = FakeProducer(limit=3)
    publisher = EventHubsPublisher(producer, event_data=lambda body: body)
    asyncio.run(publisher.publish("demo|s1|m1", [event(n) for n in range(1, 8)]))
    assert [b.partition_key for b in producer.sent] == ["demo|s1|m1"] * 3
    assert [len(b.items) for b in producer.sent] == [3, 3, 1]
    flat = [json.loads(body) for b in producer.sent for body in b.items]
    assert [e["stream_sequence"] for e in flat] == list(range(1, 8))  # order kept across batches
    assert flat[0]["text"] == "é"  # not escaped to ASCII


def test_publisher_raises_when_the_hub_refuses() -> None:
    publisher = EventHubsPublisher(FakeProducer(fail=True), event_data=lambda body: body)
    with pytest.raises(ConnectionError):
        asyncio.run(publisher.publish("sk", [event(1)]))


def test_deliver_retries_then_skips_a_batch_so_the_stream_goes_on(monkeypatch) -> None:
    calls = []

    async def always_fails(events):
        calls.append(len(events))
        raise RuntimeError("boom")

    assert asyncio.run(deliver(always_fails, [event(1)], 0)) is False
    assert calls == [1] * eventhubs.RETRIES

    seen = []

    async def fails_once(events):
        seen.append(1)
        if len(seen) == 1:
            raise RuntimeError("first time")

    assert asyncio.run(deliver(fails_once, [event(1)], 0)) is True
    assert asyncio.run(deliver(always_fails, [], 0)) is True  # nothing to do is not a failure


class FakeData:
    def __init__(self, body: str, offset: int) -> None:
        self._body, self.offset = body, offset

    def body_as_str(self) -> str:
        return self._body


class FakePartition:
    def __init__(self) -> None:
        self.checkpoints = []

    async def update_checkpoint(self, data) -> None:
        self.checkpoints.append(data.offset)


class FakeConsumer:
    """Plays a script of batches into the source's callback, then returns."""

    def __init__(self, batches) -> None:
        self.batches, self.partition, self.kwargs = batches, FakePartition(), {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    async def receive_batch(self, on_event_batch, **kwargs) -> None:
        self.kwargs = kwargs
        for batch in self.batches:
            await on_event_batch(self.partition, batch)


def test_source_checkpoints_after_the_handler_and_skips_non_json() -> None:
    batches = [
        [FakeData(json.dumps(event(1)), 10), FakeData("not json", 11)],
        [FakeData(json.dumps(event(2)), 12)],
    ]
    consumer = FakeConsumer(batches)
    got = []

    async def handler(events):
        got.append([e["stream_sequence"] for e in events])

    asyncio.run(EventHubsSource(consumer, retry_delay_s=0).run(handler))
    assert got == [[1], [2]]
    assert consumer.partition.checkpoints == [11, 12]  # the last offset of each batch
    assert consumer.kwargs["starting_position"] == "-1" and consumer.kwargs["max_batch_size"] == 50


def test_source_still_checkpoints_a_batch_the_handler_could_not_process(monkeypatch) -> None:
    monkeypatch.setattr(eventhubs, "RETRIES", 2)
    consumer = FakeConsumer([[FakeData(json.dumps(event(1)), 5)]])

    async def broken(events):
        raise RuntimeError("bad match")

    asyncio.run(EventHubsSource(consumer, retry_delay_s=0).run(broken))
    assert consumer.partition.checkpoints == [5]  # one bad batch must not block the partition


def test_memory_bus_delivers_what_a_hub_would_carry() -> None:
    async def scenario() -> list:
        bus = MemoryBus()
        got = []

        async def handler(events):
            got.extend(events)

        runner = asyncio.create_task(bus.run(handler))
        await bus.publish("sk", [event(1), event(2)])
        await bus.drain()
        await bus.close()
        await runner
        return got

    assert [e["stream_sequence"] for e in asyncio.run(scenario())] == [1, 2]
