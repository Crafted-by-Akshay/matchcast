"""GET /v1/speech/token: Entra token for the browser, no key, rate limited (EXP-16)."""

from __future__ import annotations

import time

from app.main import create_app
from app.speech import SpeechToken, SpeechTokenService
from fastapi.testclient import TestClient

ENDPOINT = "https://matchcast-speech.cognitiveservices.azure.com/"


def make(issuer=None, endpoint=ENDPOINT, region="eastus") -> tuple[TestClient, SpeechTokenService]:
    app = create_app()
    service = SpeechTokenService(endpoint, region, issuer)
    app.state.matches.speech = service
    return TestClient(app), service


def test_without_a_resource_the_route_is_not_ready():
    client, _ = make(endpoint="", region="")
    r = client.get("/v1/speech/token")
    assert r.status_code == 503 and r.json()["code"] == "not_ready"


def test_returns_token_region_and_expiry_in_sdk_shape():
    calls = []

    def issuer():
        calls.append(1)
        return SpeechToken("entra-token", time.time() + 3600)

    client, _ = make(issuer)
    body = client.get("/v1/speech/token").json()
    assert body["token"] == "entra-token"  # the issuer returns the Speech-only STS token
    assert body["region"] == "eastus" and body["expires_at"].endswith("Z")
    client.get("/v1/speech/token")
    assert len(calls) == 1  # cached until a minute before expiry


def test_an_expiring_token_is_refreshed():
    tokens = iter([SpeechToken("old", time.time() + 30), SpeechToken("new", time.time() + 3600)])
    client, _ = make(lambda: next(tokens))
    assert client.get("/v1/speech/token").json()["token"] == "old"
    assert client.get("/v1/speech/token").json()["token"] == "new"


def test_issuer_failure_is_a_503_without_the_cause():
    def issuer():
        raise RuntimeError("secret-looking detail")

    client, _ = make(issuer)
    r = client.get("/v1/speech/token")
    assert r.status_code == 503 and "secret" not in r.text


def test_sts_issuer_posts_the_entra_bearer_and_returns_only_the_sts_token():
    from unittest import mock

    from app.speech import _StsIssuer

    cred = mock.Mock()
    cred.get_token.return_value = mock.Mock(token="ENTRA-BEARER")
    response = mock.MagicMock()
    response.__enter__.return_value.read.return_value = b"sts-token"
    issuer = _StsIssuer(ENDPOINT)
    issuer._credential = cred
    with mock.patch("app.speech.urllib.request.urlopen", return_value=response) as opened:
        token = issuer()
    request = opened.call_args.args[0]
    assert request.full_url == ENDPOINT + "sts/v1.0/issueToken" and request.method == "POST"
    assert request.get_header("Authorization") == "Bearer ENTRA-BEARER"
    assert token.token == "sts-token" and "ENTRA" not in token.token


def test_malformed_settings_are_not_ready():
    client, _ = make(endpoint="https://evil.example.com/")
    assert client.get("/v1/speech/token").status_code == 503
    client, _ = make(region="East US!")
    assert client.get("/v1/speech/token").status_code == 503


def test_eleventh_request_in_a_minute_is_limited_with_retry_after():
    client, _ = make(lambda: SpeechToken("t", time.time() + 3600))
    codes = [client.get("/v1/speech/token").status_code for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429
    last = client.get("/v1/speech/token")
    assert last.headers["Retry-After"] == "60" and last.json()["code"] == "rate_limited"
