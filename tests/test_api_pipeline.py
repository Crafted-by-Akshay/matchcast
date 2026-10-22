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
