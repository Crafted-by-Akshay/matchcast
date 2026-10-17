"""Session operations preserve full-stream identity and reset isolation."""

import json
from importlib.resources import files

from app.main import create_app
from app.sessions import InMemorySessionStore, StreamIdentity
from fastapi.testclient import TestClient
from jsonschema import Draft7Validator
from pydantic import ValidationError

client = TestClient(create_app())


def _create(tenant: str, session: str, match: str) -> dict:
    response = client.post(
        "/sessions",
        json={"stream": {"tenant_id": tenant, "session_id": session, "match_id": match}},
    )
    assert response.status_code == 201
    return response.json()


def _inspect(tenant: str, session: str, match: str):
    return client.get(f"/sessions/{tenant}/{session}/{match}")


def test_create_inspect_and_duplicate_conflict_use_full_identity() -> None:
    created = _create("tenant-1", "session-1", "match-shared")

    assert created["stream"] == {
        "tenant_id": "tenant-1",
        "session_id": "session-1",
        "match_id": "match-shared",
    }
    assert created["state"] == {}
    assert created["state_revision"] == 0
    assert _inspect("tenant-1", "session-1", "match-shared").json() == created
    assert client.post(
        "/sessions",
        json={
            "stream": {
                "tenant_id": "tenant-1",
                "session_id": "session-1",
                "match_id": "match-shared",
            }
        },
    ).status_code == 409


def test_unknown_session_operations_return_404() -> None:
    path = "/sessions/tenant-1/missing/match-1"

    assert client.get(path).status_code == 404
    assert client.put(path, json={"state": {"score": 1}}).status_code == 404
    assert client.post(f"{path}/reset").status_code == 404


def test_invalid_identity_and_non_json_state_are_rejected() -> None:
    invalid = client.post(
        "/sessions",
        json={"stream": {"tenant_id": "tenant-1\n", "session_id": "s", "match_id": "m"}},
    )
    assert invalid.status_code == 422

    _create("tenant-1", "session-1", "match-1")
    non_json = client.put(
        "/sessions/tenant-1/session-1/match-1",
        content=b'{"state":{"value":NaN}}',
        headers={"content-type": "application/json"},
    )
    assert non_json.status_code == 422


def test_stream_identifiers_match_the_canonical_s02_schema() -> None:
    schema = json.loads(files("matchcast_contracts").joinpath("schemas/v1.json").read_text())
    validator = Draft7Validator(
        {
            "$schema": schema["$schema"],
            "definitions": schema["definitions"],
            "$ref": "#/definitions/StreamIdentity",
        }
    )
    valid = {"tenant_id": "tenant-1", "session_id": "session:a", "match_id": "match.1"}
    invalid = {**valid, "session_id": "session:a\n"}

    assert validator.is_valid(valid)
    assert StreamIdentity.model_validate(valid).session_id == "session:a"
    assert not validator.is_valid(invalid)
    try:
        StreamIdentity.model_validate(invalid)
    except ValidationError:
        pass
    else:
        raise AssertionError("API stream validation accepted an ID rejected by the S02 schema")


def test_update_and_reset_are_isolated_even_for_sessions_sharing_match_id() -> None:
    _create("tenant-1", "session-a", "match-shared")
    _create("tenant-1", "session-b", "match-shared")
    _create("tenant-2", "session-a", "match-shared")

    first_path = "/sessions/tenant-1/session-a/match-shared"
    second_path = "/sessions/tenant-1/session-b/match-shared"
    third_path = "/sessions/tenant-2/session-a/match-shared"

    update = client.put(first_path, json={"state": {"score": {"home": 1, "away": 0}}})
    assert update.status_code == 200
    assert update.json()["state_revision"] == 1
    assert _inspect("tenant-1", "session-b", "match-shared").json()["state"] == {}
    assert _inspect("tenant-2", "session-a", "match-shared").json()["state"] == {}

    reset = client.post(f"{first_path}/reset")
    assert reset.status_code == 200
    assert reset.json()["state"] == {}
    assert reset.json()["state_revision"] == 2
    assert client.get(second_path).json()["state"] == {}
    assert client.get(third_path).json()["state"] == {}


def test_empty_injected_store_is_used_for_session_operations() -> None:
    class SizedSessionStore(InMemorySessionStore):
        def __len__(self) -> int:
            return len(self._sessions)

    store = SizedSessionStore()
    assert not store
    injected_client = TestClient(create_app(session_store=store))
    stream = StreamIdentity(tenant_id="injected", session_id="empty", match_id="match")
    path = "/sessions/injected/empty/match"

    created = injected_client.post("/sessions", json={"stream": stream.model_dump()})
    assert created.status_code == 201
    record = store.get(stream)
    assert record is not None
    assert record.state == {}

    store.replace(stream, {"source": "injected-store"})
    assert injected_client.get(path).json()["state"] == {"source": "injected-store"}

    reset = injected_client.post(f"{path}/reset")
    assert reset.status_code == 200
    record = store.get(stream)
    assert record is not None
    assert record.state == {}
    assert record.state_revision == 2
