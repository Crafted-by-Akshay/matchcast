"""The event-stream pipeline mode of the api (F1): publish before acknowledging, consume, resume."""

import json
import time
from pathlib import Path

import pytest
from app.main import create_app
from fastapi.testclient import TestClient

FIXTURE = json.loads(
    (Path(__file__).parents[1] / "packages/agents/tests/fixtures/match-short.json").read_text()
)
Q = {"session_id": "short"}
BODY = {
    "session_id": "short",
    "match_id": "match-short",
    "roster": FIXTURE["roster"],
    "names": FIXTURE["names"],
    "clubs": FIXTURE["teams"],
}


def post(client: TestClient, events: list[dict]) -> list:
    replies = []
    for start in range(0, len(events), 50):
        replies.append(
            client.post(
                "/v1/matches/match-short/events",
                params=Q,
                json={"events": events[start : start + 50]},
            )
        )
    return replies


def wait_for_sequence(client: TestClient, sequence: int, seconds: float = 10) -> None:
    """Wait until the consumer has processed events up to ``sequence`` (read from the store)."""
    from matchcast_agents.store import stream_key

    store = client.app.state.matches.store
    sk = stream_key({"tenant_id": "demo", "session_id": "short", "match_id": "match-short"})
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if store.get_state(sk).max_sequence >= sequence:
            return
        time.sleep(0.05)
    raise AssertionError(f"state stopped at {store.get_state(sk).max_sequence}, wanted {sequence}")


def claims(client: TestClient) -> list:
    return client.get("/v1/matches/match-short/claims", params=Q).json()["items"]


def test_default_mode_is_direct(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MATCHCAST_PIPELINE", raising=False)
    assert create_app().state.matches.pipeline is None


def test_unknown_mode_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MATCHCAST_PIPELINE", "kafka")
    with pytest.raises(ValueError, match="MATCHCAST_PIPELINE"):
        create_app()


def test_memory_pipeline_gives_the_same_result_as_direct(monkeypatch: pytest.MonkeyPatch) -> None:
    events = FIXTURE["events"]
    monkeypatch.delenv("MATCHCAST_PIPELINE", raising=False)
    direct = TestClient(create_app())
    assert direct.post("/v1/matches", json=BODY).status_code == 201
    post(direct, events)
    expected = sorted(c["claim_id"] for c in claims(direct))

    monkeypatch.setenv("MATCHCAST_PIPELINE", "memory")
    with TestClient(create_app()) as piped:
        assert piped.post("/v1/matches", json=BODY).status_code == 201
        replies = post(piped, events)
        assert all(r.status_code == 202 for r in replies)
        assert replies[-1].json()["last_sequence"] == events[-1]["stream_sequence"]
        wait_for_sequence(piped, events[-1]["stream_sequence"])
        assert sorted(c["claim_id"] for c in claims(piped)) == expected


def test_an_invalid_event_is_refused_before_it_is_published(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MATCHCAST_PIPELINE", "memory")
    with TestClient(create_app()) as client:
        client.post("/v1/matches", json=BODY)
        bad = {k: v for k, v in FIXTURE["events"][0].items() if k != "payload"}
        reply = client.post("/v1/matches/match-short/events", params=Q, json={"events": [bad]})
        assert reply.status_code == 422 and reply.json()["code"] == "contract_invalid"
        assert reply.json()["path"] == "/events/0"


def test_a_publish_failure_is_a_503_the_browser_can_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MATCHCAST_PIPELINE", "memory")

    class Down:
        async def publish(self, sk, events):
            raise ConnectionError("hub unreachable")

        async def close(self):
            return None

    with TestClient(create_app()) as client:
        client.post("/v1/matches", json=BODY)
        client.app.state.matches.pipeline.publisher = Down()
        reply = post(client, FIXTURE["events"][:5])[0]
        assert reply.status_code == 503 and reply.json()["code"] == "publish_failed"
        assert claims(client) == []  # nothing was processed behind the failed publish


def test_the_pipeline_resumes_a_match_after_a_restart(monkeypatch: pytest.MonkeyPatch) -> None:
    """The second process has no workflow for the match: it is rebuilt from the stored roster."""
    events = FIXTURE["events"]
    monkeypatch.setenv("MATCHCAST_PIPELINE", "memory")
    with TestClient(create_app()) as first:
        first.post("/v1/matches", json=BODY)
        post(first, events[:60])
        wait_for_sequence(first, events[59]["stream_sequence"])
        store = first.app.state.matches.store
    with TestClient(create_app()) as second:
        second.app.state.matches.store = store  # same rows, new process: no flows in memory
        assert second.app.state.matches.flows == {}
        replies = post(second, events[60:])
        assert all(r.status_code == 202 for r in replies)
        wait_for_sequence(second, events[-1]["stream_sequence"])


def test_consumer_restarts_after_a_failure(monkeypatch):
    import asyncio

    from app.pipeline import Pipeline

    calls = []

    class Flaky:
        async def run(self, handler):
            calls.append(1)
            if len(calls) < 3:
                raise RuntimeError("boom")

    async def go():
        pipeline = Pipeline(None, None, Flaky())
        real_sleep = asyncio.sleep
        monkeypatch.setattr("app.pipeline.asyncio.sleep", lambda _s: real_sleep(0))
        await pipeline._supervise()

    asyncio.run(go())
    assert len(calls) == 3


def test_reducer_writer_delivers_a_shuffled_stream_to_the_workflow_in_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ADR-0017: the reducer reorders and dedupes, so the workflow sees the stream in order."""
    import random

    events = FIXTURE["events"]
    monkeypatch.setenv("MATCHCAST_PIPELINE", "direct")
    direct = TestClient(create_app())
    direct.post("/v1/matches", json=BODY)
    post(direct, events)
    expected = sorted(c["claim_id"] for c in claims(direct))

    shuffled = list(events) + events[:20]
    random.Random(3).shuffle(shuffled)
    monkeypatch.setenv("MATCHCAST_PIPELINE", "memory")
    monkeypatch.setenv("MATCHCAST_STATE_WRITER", "reducer")
    with TestClient(create_app()) as piped:
        piped.post("/v1/matches", json=BODY)
        assert piped.app.state.matches.pipeline.state_repo is not None
        post(piped, shuffled)
        wait_for_sequence(piped, events[-1]["stream_sequence"])
        assert sorted(c["claim_id"] for c in claims(piped)) == expected


def test_workflow_writer_is_the_default_and_leaves_the_reducer_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MATCHCAST_PIPELINE", "memory")
    monkeypatch.delenv("MATCHCAST_STATE_WRITER", raising=False)
    with TestClient(create_app()) as piped:
        assert piped.app.state.matches.pipeline.state_repo is None


class _FakeFlow:
    """Stands in for a match workflow: records what it is given, and can fail once."""

    sk = "demo|short|match-short"

    def __init__(self) -> None:
        self.seen: list[int] = []
        self.fail_next = False

    def validate_batch(self, events: list[dict]) -> None:
        from matchcast_contracts import ContractError

        if events[0].get("bad"):
            raise ContractError("invalid_schema", "/x", "bad")

    async def ingest(self, events: list[dict]) -> dict:
        if self.fail_next:
            self.fail_next = False
            raise RuntimeError("foundry hiccup")
        self.seen += [e["stream_sequence"] for e in events]
        return {"accepted": len(events)}


def _handle(pipeline, flow, events):
    import asyncio

    async def go() -> None:
        await pipeline._handle_reduced(flow, "match-short", events)

    asyncio.run(go())


def test_a_held_event_still_reaches_the_workflow_after_a_failed_ingest() -> None:
    from app.pipeline import Pipeline
    from matchcast_worker.repo import MemoryStateRepo

    events = {e["stream_sequence"]: e for e in FIXTURE["events"][:8]}
    pipeline = Pipeline(None, None, None, MemoryStateRepo())  # type: ignore[arg-type]
    flow = _FakeFlow()
    _handle(pipeline, flow, [events[1], events[2], events[4]])  # 4 is held behind 3
    assert flow.seen == [1, 2]
    flow.fail_next = True
    with pytest.raises(RuntimeError):
        _handle(pipeline, flow, [events[3]])  # closes the gap, then the workflow fails
    _handle(pipeline, flow, [events[3]])  # the hub redelivers only this batch
    assert flow.seen == [1, 2, 3, 4]


def test_a_malformed_event_does_not_take_its_batch_down() -> None:
    from app.pipeline import Pipeline
    from matchcast_worker.repo import MemoryStateRepo

    events = FIXTURE["events"][:3]
    pipeline = Pipeline(None, None, None, MemoryStateRepo())  # type: ignore[arg-type]
    flow = _FakeFlow()
    junk = {**events[1], "bad": True}
    nonum = {k: v for k, v in events[2].items() if k != "stream_sequence"}
    _handle(pipeline, flow, [events[0], junk, nonum])
    assert flow.seen == [1]
