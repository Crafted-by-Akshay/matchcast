"""Cost guard: anonymous callers cannot spend the Azure budget by looping new matches or questions.

Over a cap the agents answer with their rules twins (ADR-0014), so the app keeps working; only
model spend stops. MATCHCAST_MODEL_OFF=true is the kill switch.
"""

import asyncio
import json
from pathlib import Path

import pytest
from app import budget, matches
from app.main import create_app
from fastapi.testclient import TestClient
from matchcast_agents.live import ScriptedModelClient
from matchcast_agents.resilience import ModelError

FIXTURE = json.loads(
    (Path(__file__).parents[1] / "packages/agents/tests/fixtures/match-short.json").read_text()
)
DAY = 86400.0


def answer(_system: str, user: str) -> dict:
    facts = json.loads(user)
    if "personas" in facts:
        claim = facts["claims"][0]
        club = next(iter(facts["clubs"].values()))
        text = f"{club} {claim['metric'].split(':')[0].replace('_', ' ')} {claim['value']}."
        return {"lines": [{"persona": p, "text": text} for p in facts["personas"]]}
    if "metrics_available" in facts:
        return {"metrics": facts["metrics_available"][:1]}
    return {"judgement": "supported", "detail": "ok"}


def body(session: str, match: str = "match-short") -> dict:
    roster = json.loads(json.dumps(FIXTURE["roster"]))
    roster["stream"] = {**roster["stream"], "session_id": session, "match_id": match}
    return {"session_id": session, "match_id": match, "roster": roster,
            "names": FIXTURE["names"], "clubs": FIXTURE["teams"]}  # fmt: skip


def live_client(monkeypatch) -> TestClient:
    monkeypatch.setenv("MATCHCAST_LIVE_MAX_PRIORITY", "3")  # every moment goes to the model
    client = TestClient(create_app())
    client.app.state.matches._model_client = ScriptedModelClient(answer)
    return client


def test_the_daily_model_budget_refuses_calls_until_the_next_utc_day(monkeypatch) -> None:
    monkeypatch.setenv("MATCHCAST_MODEL_CALLS_PER_DAY", "2")
    now = [10 * DAY + 100]
    guard = budget.ModelBudget(clock=lambda: now[0])
    client = guard.wrap(ScriptedModelClient([{"a": 1}, {"a": 2}, {"a": 3}]))

    async def call() -> dict:
        return await client.complete("s", "u", {})

    assert asyncio.run(call()) == {"a": 1}
    assert asyncio.run(call()) == {"a": 2}
    with pytest.raises(ModelError):  # the agents' resilience layer answers with the rules twin
        asyncio.run(call())
    assert guard.used == 2
    now[0] = 11 * DAY + 1
    assert asyncio.run(call()) == {"a": 3}


def test_the_kill_switch_stops_new_and_running_matches_calling_the_model(monkeypatch) -> None:
    client = live_client(monkeypatch)
    registry = client.app.state.matches
    running = registry.model_client()
    assert running is not None
    monkeypatch.setenv("MATCHCAST_MODEL_OFF", "true")
    assert registry.model_client() is None  # new matches start on the rules
    with pytest.raises(ModelError):
        asyncio.run(running.complete("s", "u", {}))


def test_a_live_match_over_the_daily_budget_still_publishes_from_the_rules(monkeypatch) -> None:
    monkeypatch.setenv("MATCHCAST_MODEL_CALLS_PER_DAY", "0")
    client = live_client(monkeypatch)
    assert client.post("/v1/matches", json=body("short")).status_code == 201
    events = FIXTURE["events"]
    for start in range(0, len(events), 50):
        response = client.post(
            "/v1/matches/match-short/events",
            params={"session_id": "short"},
            json={"events": events[start : start + 50]},
        )
        assert response.status_code == 202
    lines = client.get("/v1/matches/match-short/lines", params={"session_id": "short"})
    origins = {ln["origin"] for ln in lines.json()["items"]}
    assert origins and "model" not in origins
    assert client.app.state.matches._model_client.calls == []
    audit = client.get("/v1/matches/match-short/audit", params={"session_id": "short"}).json()
    assert any(r["action"] == "fallback_used" for r in audit["items"])  # the guard is visible


def post_events(client: TestClient, session: str, match: str) -> None:
    events = [
        {**e, "stream": {**e["stream"], "session_id": session, "match_id": match}}
        for e in FIXTURE["events"]
    ]
    for start in range(0, len(events), 50):
        response = client.post(
            f"/v1/matches/{match}/events",
            params={"session_id": session},
            json={"events": events[start : start + 50]},
        )
        assert response.status_code == 202, response.text


def test_questions_over_their_own_pool_answer_from_the_rules(monkeypatch) -> None:
    monkeypatch.setenv("MATCHCAST_ANSWER_CALLS_PER_DAY", "0")
    client = live_client(monkeypatch)
    assert client.post("/v1/matches", json=body("short")).status_code == 201
    reply = client.post(
        "/v1/matches/match-short/ask", json={"session_id": "short", "question": "what is xG?"}
    )
    assert reply.status_code == 200 and reply.json()["mode"] == "rules"
    assert client.app.state.matches.budgets["agents"].used == 0  # the agents' pool is untouched


def test_one_address_gets_rules_matches_after_its_hourly_live_allowance(monkeypatch) -> None:
    monkeypatch.setattr(budget, "LIVE_MATCHES_PER_IP_HOUR", 2)
    client = live_client(monkeypatch)
    modes = [
        client.post("/v1/matches", json=body(f"s{i}", f"m{i}")).json()["mode"] for i in range(3)
    ]
    assert "rules" not in modes[:2] and modes[2] == "rules"


def test_a_repeated_create_does_not_use_the_live_allowance(monkeypatch) -> None:
    monkeypatch.setattr(budget, "LIVE_MATCHES_PER_IP_HOUR", 2)
    client = live_client(monkeypatch)
    for _ in range(3):  # the app creates again after a 404; a 409 is not a new match
        client.post("/v1/matches", json=body("s0", "m0"))
    assert client.post("/v1/matches", json=body("s1", "m1")).json()["mode"] != "rules"


def test_every_address_together_gets_rules_matches_past_the_live_hourly_cap(monkeypatch) -> None:
    monkeypatch.setattr(budget, "LIVE_MATCHES_PER_HOUR", 1)
    client = live_client(monkeypatch)
    modes = [
        client.post("/v1/matches", json=body(f"s{i}", f"m{i}")).json()["mode"] for i in range(2)
    ]
    assert modes[0] != "rules" and modes[1] == "rules"


def test_a_rules_match_stays_on_the_rules_after_a_restart(monkeypatch) -> None:
    monkeypatch.setattr(budget, "LIVE_MATCHES_PER_IP_HOUR", 0)
    first = live_client(monkeypatch)
    assert first.post("/v1/matches", json=body("short")).json()["mode"] == "rules"
    restarted = live_client(monkeypatch)
    restarted.app.state.matches.store = first.app.state.matches.store
    post_events(restarted, "short", "match-short")
    assert restarted.app.state.matches._model_client.calls == []


def test_new_matches_stop_at_the_global_hourly_cap(monkeypatch) -> None:
    monkeypatch.setattr(budget, "MATCHES_PER_HOUR", 2)
    client = TestClient(create_app())
    for i in range(2):
        assert client.post("/v1/matches", json=body(f"s{i}", f"m{i}")).status_code == 201
    refused = client.post("/v1/matches", json=body("s9", "m9"))
    assert refused.status_code == 429
    assert refused.json()["code"] == "rate_limited" and refused.headers["retry-after"]


def test_questions_are_capped_per_address_across_session_ids(monkeypatch) -> None:
    monkeypatch.setattr(matches, "ASK_PER_IP_MINUTE", 3)
    client = TestClient(create_app())
    for i in range(4):
        assert client.post("/v1/matches", json=body(f"q{i}", "mq")).status_code == 201
    asks = [
        client.post(
            "/v1/matches/mq/ask", json={"session_id": f"q{i}", "question": "what is offside?"}
        ).status_code
        for i in range(4)
    ]
    assert asks == [200, 200, 200, 429]


def test_talks_share_the_per_address_question_limit(monkeypatch) -> None:
    monkeypatch.setattr(matches, "ASK_PER_IP_MINUTE", 2)
    client = TestClient(create_app())
    for i in range(3):
        assert client.post("/v1/matches", json=body(f"t{i}", "mt")).status_code == 201
    post_events(client, "t0", "mt")
    ask = {"session_id": "t0", "question": "what is offside?"}
    assert client.post("/v1/matches/mt/ask", json=ask).status_code == 200
    talk = {"session_id": "t1", "target": "home9", "utterance": "How many shots have you had?"}
    assert client.post("/v1/matches/mt/talk", json=talk).status_code == 200
    talk2 = {**talk, "session_id": "t2"}
    assert client.post("/v1/matches/mt/talk", json=talk2).status_code == 429


def test_questions_are_capped_per_address_each_hour(monkeypatch) -> None:
    monkeypatch.setattr(budget, "QUESTIONS_PER_IP_HOUR", 2)
    client = TestClient(create_app())
    assert client.post("/v1/matches", json=body("h0", "mh")).status_code == 201
    asks = [
        client.post(
            "/v1/matches/mh/ask", json={"session_id": "h0", "question": "what is offside?"}
        ).status_code
        for _ in range(3)
    ]
    assert asks == [200, 200, 429]
