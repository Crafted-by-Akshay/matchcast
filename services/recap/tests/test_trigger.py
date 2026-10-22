import json
from pathlib import Path

import httpx
import pytest
from matchcast_recap import MatchKey, RecapClient, full_time_matches

STREAM = {"tenant_id": "demo", "session_id": "s1", "match_id": "m1"}


def event(
    kind: str = "event",
    ptype: str = "period_boundary",
    boundary: str = "ended",
    period: int = 2,
    stream: dict = STREAM,
) -> str:
    return json.dumps({
        "kind": kind, "stream": stream, "clock": {"period": period, "period_elapsed_ms": 0},
        "payload": {"type": ptype, "boundary": boundary},
    })  # fmt: skip


def test_full_time_is_the_end_of_period_two() -> None:
    assert full_time_matches([event()]) == [MatchKey("demo", "s1", "m1")]


@pytest.mark.parametrize(
    "body",
    [
        event(period=1),  # half time
        event(boundary="started"),
        event(ptype="pass"),
        event(kind="claim"),
        "not json",
        b"{}",
        json.dumps({"kind": "event", "payload": None}),
    ],
)
def test_everything_else_is_ignored(body: str) -> None:
    assert full_time_matches([body]) == []


def test_each_match_once_in_first_seen_order() -> None:
    other = {**STREAM, "match_id": "m0"}
    bodies = [event(stream=other), event(), event(stream=other), event().encode()]
    assert full_time_matches(bodies) == [MatchKey("demo", "s1", "m0"), MatchKey("demo", "s1", "m1")]


def test_extra_time_is_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RECAP_FINAL_PERIODS", "2, 4")
    assert full_time_matches([event(period=4)]) == [MatchKey("demo", "s1", "m1")]
    monkeypatch.setenv("RECAP_FINAL_PERIODS", "2")
    assert full_time_matches([event(period=4)]) == []


def client(handler, token=None) -> RecapClient:
    return RecapClient("https://api.example", token, httpx.MockTransport(handler))


def test_posts_the_match_with_a_bearer_token() -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"], seen["auth"] = request.url.path, request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(202, json={"match_id": "m1", "personas": ["casual"]})

    result = client(handler, lambda: "tok").request_recap(MatchKey("demo", "s1", "m1"))
    assert result == {"match_id": "m1", "personas": ["casual"]}
    assert seen == {
        "path": "/internal/v1/recaps", "auth": "Bearer tok",
        "body": {"tenant_id": "demo", "session_id": "s1", "match_id": "m1"},
    }  # fmt: skip


def test_no_token_means_no_authorization_header() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "authorization" not in request.headers
        return httpx.Response(202, json={})

    client(handler).request_recap(MatchKey("demo", "s1", "m1"))


def test_a_503_is_retried_then_succeeds() -> None:
    calls = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(503) if len(calls) < 3 else httpx.Response(202, json={"ok": 1})

    assert client(handler).request_recap(MatchKey("demo", "s1", "m1")) == {"ok": 1}
    assert len(calls) == 3


def test_gives_up_after_three_5xx() -> None:
    with pytest.raises(RuntimeError, match="after 3 tries"):
        client(lambda _: httpx.Response(500)).request_recap(MatchKey("demo", "s1", "m1"))


def test_a_403_is_not_retried() -> None:
    calls = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(403)

    with pytest.raises(httpx.HTTPStatusError):
        client(handler).request_recap(MatchKey("demo", "s1", "m1"))
    assert len(calls) == 1


def test_connection_errors_are_retried() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    with pytest.raises(RuntimeError, match="after 3 tries"):
        client(handler).request_recap(MatchKey("demo", "s1", "m1"))


SHORT_MATCH = (
    Path(__file__).resolve().parents[3] / "packages/agents/tests/fixtures/match-short.json"
)


def test_the_short_demo_match_ends_in_period_one(monkeypatch: pytest.MonkeyPatch) -> None:
    """The 10-minute test match has one period: it needs RECAP_FINAL_PERIODS=1 to fire."""
    bodies = [json.dumps(e) for e in json.loads(SHORT_MATCH.read_text())["events"]]
    monkeypatch.delenv("RECAP_FINAL_PERIODS", raising=False)
    assert full_time_matches(bodies) == []
    monkeypatch.setenv("RECAP_FINAL_PERIODS", "1")
    assert len(full_time_matches(bodies)) == 1
