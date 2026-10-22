"""A cross-origin browser can read Retry-After on a 429 only when the api exposes it."""

import pytest
from app.main import create_app
from fastapi.testclient import TestClient

ORIGIN = "https://web.example.test"


def ask(client: TestClient, headers: dict[str, str]):
    body = {"session_id": "short", "question": "What is offside?"}
    return client.post("/v1/matches/match-short/ask", json=body, headers=headers)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CORS_ORIGINS", ORIGIN)
    return TestClient(create_app())


def test_retry_after_is_exposed_to_the_configured_origin(client: TestClient) -> None:
    from test_api_matches import create

    create(client)
    headers = {"Origin": ORIGIN}
    last = None
    for _ in range(8):  # /ask allows 5 a minute per caller
        last = ask(client, headers)
        if last.status_code == 429:
            break
    assert last is not None and last.status_code == 429
    assert last.headers["retry-after"]
    assert last.headers["access-control-allow-origin"] == ORIGIN
    assert "retry-after" in last.headers["access-control-expose-headers"].lower()


def test_other_origins_get_no_cors_headers_and_preflight_works(client: TestClient) -> None:
    other = client.get("/health", headers={"Origin": "https://evil.example.test"})
    assert "access-control-allow-origin" not in other.headers
    pre = client.options(
        "/v1/matches/m/ask",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert pre.status_code == 200 and pre.headers["access-control-allow-origin"] == ORIGIN
