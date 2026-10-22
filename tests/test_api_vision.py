"""Shirt-number second opinion route and budget (DAT-11, task 275)."""

import base64
import json
import struct
import threading
import zlib
from pathlib import Path
from unittest import mock

import pytest
from app.main import create_app
from app.vision import (
    AzureReadReader,
    Reading,
    TokenError,
    UnavailableReader,
    VisionBudget,
    VisionError,
    VisionService,
    best_shirt,
    check_endpoint,
    decode_crop,
    reader_from_env,
)
from fastapi.testclient import TestClient

FIXTURE = json.loads(
    (Path(__file__).parents[1] / "packages/agents/tests/fixtures/match-short.json").read_text()
)


def png(side: int = 128, pad: int = 0) -> str:
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = b"".join(b"\x00" + b"\x80" * side for _ in range(side))
    data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", side, side, 8, 0, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + (chunk(b"tEXt", b"k\x00" + b"x" * pad) if pad else b"")
        + chunk(b"IEND", b"")
    )
    return base64.b64encode(data).decode()


class Fake:
    def __init__(self, reading: Reading | Exception):
        self.reading, self.calls = reading, 0

    def read(self, _png: bytes) -> Reading:
        self.calls += 1
        if isinstance(self.reading, Exception):
            raise self.reading
        return self.reading


def client_with(reader, budget=None) -> TestClient:
    app = create_app()
    app.state.matches.vision = VisionService(reader, budget or VisionBudget())
    c = TestClient(app)
    body = {
        "session_id": "short",
        "match_id": "match-short",
        "roster": FIXTURE["roster"],
        "names": FIXTURE["names"],
        "clubs": FIXTURE["teams"],
    }
    r = c.post("/v1/matches", json=body)
    assert r.status_code == 201, r.text[:300]
    return c


def post(c: TestClient, crop: str | None = None, **extra):
    body = {
        "session_id": "short",
        "crop": crop or png(),
        "track_id": "t1",
        "team_hint": "home",
        **extra,
    }
    return c.post("/v1/matches/match-short/vision/identify", json=body)


def test_identify_returns_shirt_confidence_source_and_time():
    c = client_with(Fake(Reading("10", 0.91, "azure_read")))
    r = post(c)
    assert r.status_code == 200, r.text
    assert {k: r.json()[k] for k in ("shirt", "confidence", "source")} == {
        "shirt": "10",
        "confidence": 0.91,
        "source": "azure_read",
    }
    assert r.json()["elapsed_ms"] >= 0


def test_without_a_vision_resource_the_route_says_unavailable_and_invents_nothing():
    r = post(client_with(UnavailableReader()))
    assert {k: v for k, v in r.json().items() if k != "elapsed_ms"} == {
        "shirt": None,
        "confidence": 0.0,
        "source": "unavailable",
    }


def test_sixteenth_call_in_a_minute_is_429_with_retry_after():
    fake = Fake(Reading("7", 0.8, "azure_read"))
    c = client_with(fake)
    assert all(post(c).status_code == 200 for _ in range(15))
    r = post(c)
    assert r.status_code == 429 and r.json()["code"] == "rate_limited"
    assert int(r.headers["Retry-After"]) >= 1
    assert fake.calls == 15  # the sixteenth never reached Azure


def test_total_cap_stops_calls_for_good():
    budget = VisionBudget(per_minute=100, total=2)
    c = client_with(Fake(Reading("7", 0.8, "azure_read")), budget)
    assert [post(c).status_code for _ in range(3)] == [200, 200, 429]
    assert post(c).json()["code"] == "vision_budget_used"


def test_budget_window_slides():
    b = VisionBudget(per_minute=2, total=100)
    b.take(0.0)
    b.take(1.0)
    with pytest.raises(VisionError):
        b.take(30.0)
    b.take(61.0)  # the first call left the window


@pytest.mark.parametrize(
    ("crop", "status"),
    [
        ("not base64!!", 422),
        (base64.b64encode(b"hello").decode(), 422),
        (png(64), 422),
        (png(pad=41_000), 413),
        (base64.b64encode(base64.b64decode(png()) + b"junk").decode(), 422),
        ("data:image/png;base64," + png(), 422),
    ],
    ids=["not-base64", "not-png", "wrong-size", "too-large", "trailing-junk", "data-uri"],
)
def test_bad_crops_are_refused_and_cost_no_budget(crop, status):
    budget = VisionBudget(total=5)
    c = client_with(Fake(Reading("1", 0.9, "azure_read")), budget)
    assert post(c, crop).status_code == status
    assert budget.used == 0


def test_unknown_match_is_404_and_extra_fields_are_refused():
    c = client_with(Fake(Reading("1", 0.9, "azure_read")))
    r = c.post(
        "/v1/matches/nope/vision/identify",
        json={"session_id": "short", "crop": png(), "track_id": "t", "team_hint": "home"},
    )
    assert r.status_code == 404
    assert post(c, extra="x").status_code == 422
    assert post(c, team_hint="both").status_code == 422


def test_reader_failure_is_502_and_the_api_stays_up():
    budget = VisionBudget(total=10)
    c = client_with(Fake(RuntimeError("azure down")), budget)
    r = post(c)
    assert r.status_code == 502 and r.json()["code"] == "vision_unavailable"
    assert c.get("/health").status_code == 200
    assert post(c).status_code == 502  # still answers, and the attempt is charged
    assert budget.used == 2


def test_best_shirt_takes_only_one_or_two_digit_words_by_confidence():
    body = {
        "readResult": {
            "blocks": [
                {
                    "lines": [
                        {
                            "words": [
                                {"text": "B8", "confidence": 0.99},
                                {"text": "123", "confidence": 0.98},
                                {"text": "8", "confidence": 0.6},
                                {"text": "10", "confidence": 0.9},
                            ]
                        }
                    ]
                }
            ]
        }
    }
    assert best_shirt(body) == Reading("10", 0.9, "azure_read")
    assert best_shirt({}) == Reading(None, 0.0, "azure_read")


def test_decode_crop_accepts_a_valid_png():
    assert decode_crop(png()).startswith(b"\x89PNG")


def test_a_failure_before_azure_is_refunded():
    budget = VisionBudget(total=10)
    c = client_with(Fake(TokenError()), budget)
    assert post(c).status_code == 502
    assert budget.used == 0


def test_body_over_the_envelope_is_413_before_it_is_read():
    c = client_with(Fake(Reading("1", 0.9, "azure_read")))
    r = post(c, "A" * 70_000)
    assert r.status_code == 413 and r.json()["code"] == "crop_too_large"
    assert post(c, "A" * 60_001).status_code == 422  # inside the envelope, over the field limit


def test_budget_is_thread_safe():
    b = VisionBudget(per_minute=1000, total=100)
    taken, refused = [], []

    def work():
        for _ in range(50):
            try:
                b.take()
                taken.append(1)
            except VisionError:
                refused.append(1)

    threads = [threading.Thread(target=work) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(taken) == 100 and b.used == 100 and len(refused) == 300


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://r.cognitiveservices.azure.com",
        "https://evil.example.com",
        "https://user:pw@r.cognitiveservices.azure.com",
        "https://r.cognitiveservices.azure.com/path",
        "https://r.cognitiveservices.azure.com?x=1",
        "https://r.cognitiveservices.azure.com.evil.com",
    ],
)
def test_endpoint_must_be_an_azure_https_host(endpoint):
    with pytest.raises(ValueError):
        check_endpoint(endpoint)


def test_reader_from_env_picks_the_reader(monkeypatch):
    monkeypatch.delenv("VISION_ENDPOINT", raising=False)
    assert isinstance(reader_from_env(), UnavailableReader)
    monkeypatch.setenv("VISION_ENDPOINT", "http://x")
    with pytest.raises(ValueError):
        reader_from_env()
    monkeypatch.setenv("VISION_ENDPOINT", "https://r.cognitiveservices.azure.com/")
    assert isinstance(reader_from_env(), AzureReadReader)


class Cred:
    def get_token(self, scope):
        self.scope = scope
        return mock.Mock(token="TOKEN")


READ_BODY = {
    "readResult": {"blocks": [{"lines": [{"words": [{"text": "9", "confidence": 0.88}]}]}]}
}


def test_azure_reader_calls_image_analysis_with_a_bearer_token():
    cred = Cred()
    reader = AzureReadReader("https://r.cognitiveservices.azure.com/", cred)
    response = mock.MagicMock()
    response.__enter__.return_value = response
    with (
        mock.patch.object(reader._opener, "open", return_value=response) as opened,
        mock.patch("app.vision.json.load", return_value=READ_BODY),
    ):
        assert reader.read(b"png") == Reading("9", 0.88, "azure_read")
    request = opened.call_args.args[0]
    assert request.full_url == (
        "https://r.cognitiveservices.azure.com/computervision/imageanalysis:analyze"
        "?api-version=2023-10-01&features=read"
    )
    assert request.get_method() == "POST" and request.data == b"png"
    assert request.get_header("Authorization") == "Bearer TOKEN"
    assert cred.scope == "https://cognitiveservices.azure.com/.default"


def test_azure_reader_refuses_redirects_and_wraps_token_failures():
    reader = AzureReadReader("https://r.cognitiveservices.azure.com", Cred())
    handler = reader._opener.handlers
    redirect = next(h for h in handler if h.__class__.__name__ == "_NoRedirect")
    assert redirect.redirect_request(None, None, 302, "Found", {}, "https://evil") is None

    class Bad:
        def get_token(self, _scope):
            raise RuntimeError("no identity")

    with pytest.raises(TokenError):
        AzureReadReader("https://r.cognitiveservices.azure.com", Bad()).read(b"x")
