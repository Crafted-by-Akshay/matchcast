"""Shirt-number second opinion route and budget (DAT-11, task 275)."""

import base64
import json
import struct
import zlib
from pathlib import Path

import pytest
from app.main import create_app
from app.vision import (
    Reading,
    UnavailableReader,
    VisionBudget,
    VisionError,
    VisionService,
    best_shirt,
    decode_crop,
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
        + chunk(b"IEND", b"")
        + b"\x00" * pad
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
    assert r.json() == {**r.json(), "shirt": None, "source": "unavailable", "confidence": 0.0}


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
    ],
    ids=["not-base64", "not-png", "wrong-size", "too-large"],
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
    c = client_with(Fake(RuntimeError("azure down")))
    r = post(c)
    assert r.status_code == 502 and r.json()["code"] == "vision_unavailable"
    assert c.get("/health").status_code == 200


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
