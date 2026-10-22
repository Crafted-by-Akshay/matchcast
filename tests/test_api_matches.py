"""Match routes on the ten-minute fixture, in rules mode (AGT-3 acceptance criteria 1 and 3)."""

import json
from pathlib import Path

import pytest
from app.main import create_app
from fastapi.testclient import TestClient
from matchcast_contracts import validate
from matchcast_contracts.audit import verify_chain

FIXTURE = json.loads(
    (Path(__file__).parents[1] / "packages/agents/tests/fixtures/match-short.json").read_text()
)
Q = {"session_id": "short"}


def create(client: TestClient, **extra) -> None:
    body = {
        "session_id": "short",
        "match_id": "match-short",
        "roster": FIXTURE["roster"],
        "names": FIXTURE["names"],
        "clubs": FIXTURE["teams"],
        **extra,
    }
    assert client.post("/v1/matches", json=body).status_code == 201


def post_all(client: TestClient) -> None:
    events = FIXTURE["events"]
    for start in range(0, len(events), 50):
        response = client.post(
            "/v1/matches/match-short/events", params=Q, json={"events": events[start : start + 50]}
        )
        assert response.status_code == 202, response.text


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_events_yield_claims_lines_and_a_valid_audit_chain(client: TestClient) -> None:
    create(client)
    post_all(client)
    claims = client.get("/v1/matches/match-short/claims", params=Q).json()["items"]
    assert len(claims) >= 5 and all(c["verdict"] == "verified" for c in claims)
    for claim in claims:
        validate({k: v for k, v in claim.items() if k not in ("agent", "moment_id", "verdict")})
    lines = client.get("/v1/matches/match-short/lines", params=Q).json()["items"]
    assert len(lines) >= 5 and {ln["status"] for ln in lines} == {"published"}
    audit = client.get("/v1/matches/match-short/audit", params=Q).json()["items"]
    assert verify_chain(audit)["valid"] is True
    match = client.get("/v1/matches/match-short", params=Q).json()
    assert match["state"]["revision"] == 137 and match["mode"] == "rules"


def test_claim_filters_and_paging(client: TestClient) -> None:
    create(client)
    post_all(client)
    page = client.get("/v1/matches/match-short/claims", params={**Q, "limit": 5}).json()
    assert len(page["items"]) == 5 and page["next_cursor"] == 5
    goals = client.get(
        "/v1/matches/match-short/claims", params={**Q, "metric": "goals:home"}
    ).json()
    assert goals["items"] and all(c["metric"] == "goals:home" for c in goals["items"])


def test_stream_replays_publications_then_audit_as_sse(client: TestClient) -> None:
    create(client)
    post_all(client)
    response = client.get(
        "/v1/matches/match-short/stream", params={**Q, "persona": "casual", "follow": "false"}
    )
    assert response.headers["content-type"].startswith("text/event-stream")
    frames = [f for f in response.text.split("\n\n") if f]
    names = [f.splitlines()[0] for f in frames]
    assert names[:2] == ["event: status", "event: state"]
    pubs = [
        json.loads(f.splitlines()[-1][6:]) for f in frames if f.startswith("event: publication")
    ]
    assert pubs and {p["persona"] for p in pubs} == {"casual"}
    assert any(n == "event: audit" for n in names)

    first_audit = next(f for f in frames if f.startswith("event: audit")).splitlines()[1][4:]
    later = client.get(
        "/v1/matches/match-short/stream",
        params={**Q, "follow": "false"},
        headers={"Last-Event-ID": first_audit},
    )
    assert f"id: {first_audit}\n" not in later.text


def test_bad_batch_is_a_problem_with_the_event_index(client: TestClient) -> None:
    create(client)
    events = json.loads(json.dumps(FIXTURE["events"][:3]))
    events[2]["payload"] = {"type": "teleport"}
    response = client.post("/v1/matches/match-short/events", params=Q, json={"events": events})
    body = response.json()
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    assert body["code"] == "contract_invalid" and body["path"].startswith("/events/2")
    assert client.get("/v1/matches/match-short", params=Q).json()["state"]["revision"] == 0


def test_unknown_and_duplicate_matches(client: TestClient) -> None:
    missing = client.get("/v1/matches/nope", params=Q)
    assert missing.status_code == 404 and missing.json()["code"] == "not_found"
    create(client)
    again = client.post(
        "/v1/matches",
        json={"session_id": "short", "match_id": "match-short", "roster": FIXTURE["roster"]},
    )
    assert again.status_code == 409 and again.json()["code"] == "match_exists"


def test_roster_for_another_match_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/v1/matches",
        json={"session_id": "short", "match_id": "other", "roster": FIXTURE["roster"]},
    )
    assert response.status_code == 422 and response.json()["code"] == "contract_invalid"


def test_producer_approval_flow_and_role_gate(client: TestClient) -> None:
    client.app.state.matches.require_role = True  # type: ignore[attr-defined]
    create(client, approval_mode="producer")
    producer = {"X-MatchCast-Role": "Producer"}
    events = FIXTURE["events"][:60]
    client.post("/v1/matches/match-short/events", params=Q, json={"events": events[:50]})
    client.post("/v1/matches/match-short/events", params=Q, json={"events": events[50:]})

    assert client.get("/v1/matches/match-short/lines", params=Q).status_code == 403
    queue = client.get("/v1/matches/match-short/lines", params=Q, headers=producer).json()["items"]
    assert queue and {ln["status"] for ln in queue} == {"verified"}

    ids = {"session_id": "short", "match_id": "match-short"}
    denied = client.post(f"/v1/lines/{queue[0]['line_id']}/approve", json=ids)
    assert denied.status_code == 403 and denied.json()["code"] == "forbidden_role"
    ok = client.post(f"/v1/lines/{queue[0]['line_id']}/approve", json=ids, headers=producer)
    assert ok.status_code == 200 and ok.json()["line"]["status"] == "published"
    twice = client.post(f"/v1/lines/{queue[0]['line_id']}/approve", json=ids, headers=producer)
    assert twice.status_code == 409 and twice.json()["code"] == "not_approvable"

    killed = client.post(
        f"/v1/lines/{queue[1]['line_id']}/kill", json={**ids, "reason": "off air"}, headers=producer
    )
    assert killed.json()["line"]["status"] == "killed"
    bad = client.post(
        f"/v1/lines/{queue[-1]['line_id']}/edit",
        json={**ids, "text": "Northgate FC have scored 99 goals."},
        headers=producer,
    )
    assert bad.status_code == 422
    audit = client.get("/v1/matches/match-short/audit", params=Q).json()["items"]
    assert verify_chain(audit)["valid"] is True


def test_trace_lists_each_agent_step_for_a_line(client: TestClient) -> None:
    create(client, seed_bad_claim=True)
    post_all(client)
    lines = client.get("/v1/matches/match-short/lines", params=Q).json()["items"]
    repaired = next(ln for ln in lines if ln["repair_of"])
    steps = client.get(f"/v1/matches/match-short/trace/{repaired['line_id']}", params=Q).json()[
        "steps"
    ]
    actions = [s["action"] for s in steps]
    assert "line_drafted" in actions and "line_verified" in actions
    first = client.get(f"/v1/matches/match-short/trace/{repaired['repair_of']}", params=Q).json()
    assert "line_rejected" in [s["action"] for s in first["steps"]]
