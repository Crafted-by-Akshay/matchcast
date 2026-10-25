"""Vision -> Agents on the api (ADR-0020): the Vision stream's match, its summary route and
the engine truth it is checked against. Rules mode, the ten-minute fixture, no Azure."""

import copy
import json
from pathlib import Path

from app.main import create_app
from fastapi.testclient import TestClient

FIXTURE = json.loads(
    (Path(__file__).parents[1] / "packages/agents/tests/fixtures/match-short.json").read_text()
)
ENGINE = {"session_id": "short", "match_id": "match-short"}
VISION = {"session_id": "short.vision", "match_id": "match-short"}


def create(client: TestClient, session: dict, roster: dict) -> None:
    body = {**session, "roster": roster, "names": FIXTURE["names"], "clubs": FIXTURE["teams"]}
    assert client.post("/v1/matches", json=body).status_code == 201


def post(client: TestClient, session: dict, events: list[dict]) -> None:
    for start in range(0, len(events), 50):
        response = client.post(
            f"/v1/matches/{session['match_id']}/events",
            params={"session_id": session["session_id"]},
            json={"events": events[start : start + 50]},
        )
        assert response.status_code == 202, response.text


def vision_roster() -> dict:
    return {
        **FIXTURE["roster"],
        "stream": {**FIXTURE["roster"]["stream"], "session_id": "short.vision"},
    }


def vision_events() -> list[dict]:
    """Vision's passes: the engine's passes, a second late, on the vision stream."""
    stream = {**FIXTURE["roster"]["stream"], "session_id": "short.vision"}
    passes = [e for e in FIXTURE["events"] if e["payload"]["type"] == "pass"]
    rows = []
    for seq, e in enumerate(passes, start=1):
        row = copy.deepcopy(e)
        row.update(stream=stream, stream_sequence=seq, event_id=f"v{seq}", revision=0,
                   event_time_ms=e["event_time_ms"] + 1_000)  # fmt: skip
        row["clock"] = {"period": 1, "period_elapsed_ms": row["event_time_ms"]}
        rows.append(row)
    return rows


def test_the_summary_is_empty_until_vision_is_sent() -> None:
    client = TestClient(create_app())
    create(client, ENGINE, FIXTURE["roster"])
    response = client.get("/v1/matches/match-short/vision/summary", params={"session_id": "short"})
    assert response.status_code == 200
    body = response.json()
    assert body["passes_in"] == 0 and body["lines_verified"] == 0 and body["latest_line"] is None


def test_vision_passes_are_counted_and_checked_against_the_engine() -> None:
    client = TestClient(create_app())
    create(client, ENGINE, FIXTURE["roster"])
    post(client, ENGINE, FIXTURE["events"])
    create(client, VISION, vision_roster())
    sent = vision_events()
    post(client, VISION, sent)

    body = client.get(
        "/v1/matches/match-short/vision/summary", params={"session_id": "short"}
    ).json()
    assert body["passes_in"] == len(sent)
    assert body["lines_verified"] >= 1
    assert body["latest_line"] and "Vision" in body["latest_line"]
    agreement = body["agreement"]
    assert agreement["vision"] == len(sent)
    assert agreement["engine"] == sum(
        1 for e in FIXTURE["events"] if e["payload"]["type"] == "pass"
    )
    assert agreement["precision"] == 1.0


def test_the_engine_record_is_the_same_with_or_without_vision() -> None:
    client = TestClient(create_app())
    create(client, ENGINE, FIXTURE["roster"])
    post(client, ENGINE, FIXTURE["events"])
    before = client.get("/v1/matches/match-short/claims", params={"session_id": "short"}).json()
    create(client, VISION, vision_roster())
    post(client, VISION, vision_events())
    after = client.get("/v1/matches/match-short/claims", params={"session_id": "short"}).json()
    assert before == after  # the engine's claims never see the vision stream


def test_an_unknown_engine_match_is_a_404() -> None:
    client = TestClient(create_app())
    response = client.get("/v1/matches/nope/vision/summary", params={"session_id": "short"})
    assert response.status_code == 404
