"""GET /v1/speech/token: Entra token for the browser, no key, rate limited (EXP-16)."""

from __future__ import annotations

import time

from app.main import create_app
from app.speech import SpeechToken, SpeechTokenService
from fastapi.testclient import TestClient

RESOURCE = (
    "/subscriptions/s1/resourceGroups/rg-matchcast"
    "/providers/Microsoft.CognitiveServices/accounts/speech"
)


def make(issuer=None, resource=RESOURCE, region="eastus") -> tuple[TestClient, SpeechTokenService]:
    app = create_app()
    service = SpeechTokenService(resource, region, issuer)
    app.state.matches.speech = service
    return TestClient(app), service


def test_without_a_resource_the_route_is_not_ready():
    client, _ = make(resource="", region="")
    r = client.get("/v1/speech/token")
    assert r.status_code == 503 and r.json()["code"] == "not_ready"


def test_returns_token_region_and_expiry_in_sdk_shape():
    calls = []

    def issuer():
        calls.append(1)
        return SpeechToken("entra-token", time.time() + 3600)

    client, _ = make(issuer)
    body = client.get("/v1/speech/token").json()
    assert body["token"] == f"aad#{RESOURCE}#entra-token"
    assert body["region"] == "eastus" and body["expires_at"].endswith("Z")
    client.get("/v1/speech/token")
    assert len(calls) == 1  # cached until a minute before expiry


def test_an_expiring_token_is_refreshed():
    tokens = iter([SpeechToken("old", time.time() + 30), SpeechToken("new", time.time() + 3600)])
    client, _ = make(lambda: next(tokens))
    assert client.get("/v1/speech/token").json()["token"].endswith("#old")
    assert client.get("/v1/speech/token").json()["token"].endswith("#new")


def test_issuer_failure_is_a_503_without_the_cause():
    def issuer():
        raise RuntimeError("secret-looking detail")

    client, _ = make(issuer)
    r = client.get("/v1/speech/token")
    assert r.status_code == 503 and "secret" not in r.text


def test_malformed_settings_are_not_ready():
    client, _ = make(resource="not-a-resource-id")
    assert client.get("/v1/speech/token").status_code == 503
    client, _ = make(region="East US!")
    assert client.get("/v1/speech/token").status_code == 503


def test_eleventh_request_in_a_minute_is_limited_with_retry_after():
    client, _ = make(lambda: SpeechToken("t", time.time() + 3600))
    codes = [client.get("/v1/speech/token").status_code for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429
    last = client.get("/v1/speech/token")
    assert last.headers["Retry-After"] == "60" and last.json()["code"] == "rate_limited"
