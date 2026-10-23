"""Voice (EXP-16): Azure Speech clips for lines and talk replies, cached, budgeted, never a key."""

import asyncio

import app.voice as voice_module
import pytest
from app.main import create_app
from app.voice import (
    AUDITION_SCRIPT,
    MAX_CHARS,
    VoiceError,
    VoiceService,
    clip_key,
    speakable,
    ssml,
)
from fastapi.testclient import TestClient
from matchcast_agents.safety import SafetyResult, ShieldResult
from test_api_matches import Q, create, post_all

VOICES = {
    "commentary": "en-GB-RyanNeural",
    "producer": "en-GB-SoniaNeural",
    "players": {"default": "en-US-GuyNeural", "home9": "en-GB-ThomasNeural"},
}
ENDPOINT = "https://spch-matchcast-dev.cognitiveservices.azure.com/"


class FakeSynth:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def __call__(self, markup: str) -> bytes:
        self.calls.append(markup)
        return b"fake-mp3:" + markup.encode()[:16]


class UnsafeScreen:
    async def analyze(self, text: str) -> SafetyResult:
        return SafetyResult(allowed=False, categories={"Hate": 4}, source="test")

    async def shield(self, user_prompt: str) -> ShieldResult:
        return ShieldResult(attack_detected=False, source="test")


def service(synth: FakeSynth | None = None, **extra) -> VoiceService:
    return VoiceService(endpoint=ENDPOINT, synthesiser=synth or FakeSynth(), voices=VOICES, **extra)


def test_markers_are_not_spoken() -> None:
    assert speakable("Goal [claim:c1] by  Ana [kb:x]") == "Goal by Ana"


def test_ssml_escapes_the_text_and_names_the_voice_and_locale() -> None:
    markup = ssml("a < b & c", "en-GB-RyanNeural")
    assert "a &lt; b &amp; c" in markup
    assert "xml:lang='en-GB'" in markup and "name='en-GB-RyanNeural'" in markup


def test_voice_for_picks_the_role_and_the_player_override() -> None:
    svc = service()
    assert svc.voice_for("commentary") == "en-GB-RyanNeural"
    assert svc.voice_for("player", "home9") == "en-GB-ThomasNeural"
    assert svc.voice_for("player", "away1") == "en-US-GuyNeural"


def test_only_a_valid_speech_endpoint_is_ready() -> None:
    assert VoiceService(endpoint=ENDPOINT, voices=VOICES).ready
    assert not VoiceService(endpoint="", voices=VOICES).ready
    assert not VoiceService(endpoint="http://evil.example", voices=VOICES).ready


def test_without_synthesis_clip_refuses() -> None:
    with pytest.raises(VoiceError):
        asyncio.run(VoiceService(endpoint="", voices=VOICES).clip("Hello", "en-GB-RyanNeural"))


def test_a_clip_is_synthesised_once_then_cached() -> None:
    synth = FakeSynth()
    svc = service(synth)
    first = asyncio.run(svc.clip("Hello there", "en-GB-RyanNeural"))
    again = asyncio.run(svc.clip("Hello there", "en-GB-RyanNeural"))
    assert first == again and len(synth.calls) == 1
    assert svc.get(clip_key("Hello there", "en-GB-RyanNeural")) == first


def test_the_character_budget_stops_further_synthesis() -> None:
    svc = service(char_budget=10)
    asyncio.run(svc.clip("123456789", "en-GB-RyanNeural"))
    with pytest.raises(VoiceError):
        asyncio.run(svc.clip("abcdef", "en-GB-RyanNeural"))


def test_text_over_the_limit_is_refused() -> None:
    with pytest.raises(VoiceError):
        asyncio.run(service().clip("x" * (MAX_CHARS + 1), "en-GB-RyanNeural"))


def test_the_cache_keeps_a_bounded_number_of_clips(monkeypatch) -> None:
    monkeypatch.setattr(voice_module, "CACHE_LIMIT", 2)
    svc = service()
    for text in ("one", "two", "three"):
        asyncio.run(svc.clip(text, "en-GB-RyanNeural"))
    assert svc.get(clip_key("one", "en-GB-RyanNeural")) is None
    assert svc.get(clip_key("three", "en-GB-RyanNeural")) is not None


def test_a_synthesis_failure_does_not_leak_the_cause() -> None:
    def broken(markup: str) -> bytes:
        raise RuntimeError("secret detail")

    with pytest.raises(VoiceError) as error:
        asyncio.run(service(broken).clip("Hello", "en-GB-RyanNeural"))
    assert "secret" not in str(error.value)


def test_new_clips_are_rate_limited_per_client() -> None:
    svc = service()
    assert [svc.allow("1.2.3.4", now=0.0) for _ in range(31)].count(True) == 30
    assert svc.allow("5.6.7.8", now=0.0)  # other clients have their own window
    assert svc.allow("1.2.3.4", now=61.0)  # the window rolls


def test_the_audition_is_about_thirty_seconds_of_speech() -> None:
    assert 70 <= len(AUDITION_SCRIPT.split()) <= 82


def test_audition_is_unavailable_without_a_speech_resource() -> None:
    client = TestClient(create_app())
    client.app.state.matches.voice = VoiceService(endpoint="", voices=VOICES)
    r = client.get("/v1/voice/audition.mp3")
    assert r.status_code == 503 and r.json()["code"] == "not_ready"


def test_audition_is_served_as_mp3_and_cached() -> None:
    synth = FakeSynth()
    client = TestClient(create_app())
    client.app.state.matches.voice = service(synth)
    first = client.get("/v1/voice/audition.mp3")
    second = client.get("/v1/voice/audition.mp3")
    assert first.status_code == 200 and first.headers["content-type"] == "audio/mpeg"
    assert first.content == second.content and len(synth.calls) == 1
    assert "en-GB-RyanNeural" in synth.calls[0]


def test_unknown_audio_ids_are_not_found() -> None:
    client = TestClient(create_app())
    client.app.state.matches.voice = service()
    assert client.get("/v1/audio/" + "0" * 32 + ".mp3").status_code == 404


def test_only_a_line_on_air_is_voiced() -> None:
    synth = FakeSynth()
    client = TestClient(create_app())
    client.app.state.matches.voice = service(synth)
    producer = {"X-MatchCast-Role": "Producer"}
    ids = {"session_id": "short", "match_id": "match-short"}
    create(client, approval_mode="producer")
    post_all(client)
    queue = client.get("/v1/matches/match-short/lines", params=Q, headers=producer).json()["items"]
    waiting, approved, killed = queue[0]["line_id"], queue[1]["line_id"], queue[2]["line_id"]
    line_audio = "/v1/matches/match-short/lines/{}/audio.mp3"

    assert client.get(line_audio.format(waiting), params=Q).status_code == 404  # not yet on air
    assert synth.calls == []  # and nothing was synthesised for it
    client.post(f"/v1/lines/{approved}/approve", json=ids, headers=producer)
    client.post(f"/v1/lines/{killed}/kill", json={**ids, "reason": "off air"}, headers=producer)
    ok = client.get(line_audio.format(approved), params=Q)
    assert ok.status_code == 200 and ok.headers["content-type"] == "audio/mpeg"
    assert client.get(line_audio.format(killed), params=Q).status_code == 404
    assert len(synth.calls) == 1


def test_parallel_requests_for_one_new_clip_share_one_synthesis() -> None:
    synth = FakeSynth()
    svc = service(synth)

    async def both():
        return await asyncio.gather(
            svc.clip("Same line", "en-GB-RyanNeural"), svc.clip("Same line", "en-GB-RyanNeural")
        )

    first, second = asyncio.run(both())
    assert first == second and len(synth.calls) == 1
    assert svc.used == len("Same line")  # charged once


def test_a_failed_synthesis_gives_its_characters_back() -> None:
    def broken(markup: str) -> bytes:
        raise RuntimeError("speech down")

    svc = service(broken)
    with pytest.raises(VoiceError):
        asyncio.run(svc.clip("Hello", "en-GB-RyanNeural"))
    assert svc.used == 0


def test_a_bad_budget_setting_falls_back_to_the_default(monkeypatch) -> None:
    monkeypatch.setenv("SPEECH_MAX_CHARS", "two hundred")
    svc = VoiceService(endpoint="", synthesiser=FakeSynth(), voices=VOICES)
    assert svc.char_budget == voice_module.CHAR_BUDGET_DEFAULT


def test_a_verified_talk_reply_is_spoken_and_an_unsafe_one_is_not() -> None:
    synth = FakeSynth()
    client = TestClient(create_app())
    client.app.state.matches.voice = service(synth)
    create(client)
    post_all(client)
    body = {"session_id": "short", "target": "home9", "utterance": "How many shots have you had?"}
    ok = client.post("/v1/matches/match-short/talk", json=body).json()
    assert ok["verdict"] == "verified" and ok["lang"] == "en"
    assert ok["audio_url"].startswith("/v1/audio/") and ok["audio_url"].endswith(".mp3")
    assert client.get(ok["audio_url"]).status_code == 200

    client.app.state.matches.get("short", "match-short").safety = UnsafeScreen()
    refused = client.post("/v1/matches/match-short/talk", json=body).json()
    assert refused["verdict"] == "rejected" and refused["audio_url"] is None


def test_a_talk_reply_over_the_voice_allowance_is_shown_unspoken() -> None:
    synth = FakeSynth()
    client = TestClient(create_app())
    client.app.state.matches.voice = service(synth)
    create(client)
    post_all(client)
    body = {"session_id": "short", "target": "home9", "utterance": "How many shots have you had?"}
    client.app.state.matches.voice.used = 0
    import app.voice as voice_mod

    for _ in range(voice_mod.PER_MINUTE):
        client.app.state.matches.voice.allow("testclient")
    spent = client.post("/v1/matches/match-short/talk", json=body).json()
    assert spent["verdict"] == "verified" and spent["audio_url"] is None
    assert synth.calls == []


def test_a_cancelled_caller_does_not_stop_a_shared_synthesis() -> None:
    synth = FakeSynth()
    svc = service(synth)

    async def scenario():
        waiter = asyncio.ensure_future(svc.clip("Shared line", "en-GB-RyanNeural"))
        other = asyncio.ensure_future(svc.clip("Shared line", "en-GB-RyanNeural"))
        await asyncio.sleep(0)
        waiter.cancel()
        return await other

    assert asyncio.run(scenario()) == svc.get(clip_key("Shared line", "en-GB-RyanNeural"))
    assert len(synth.calls) == 1 and svc.used == len("Shared line")


def test_a_failed_shared_synthesis_fails_every_waiter_once() -> None:
    def broken(markup: str) -> bytes:
        raise RuntimeError("speech down")

    svc = service(broken)

    async def both():
        return await asyncio.gather(
            svc.clip("Doomed", "en-GB-RyanNeural"),
            svc.clip("Doomed", "en-GB-RyanNeural"),
            return_exceptions=True,
        )

    results = asyncio.run(both())
    assert all(isinstance(r, VoiceError) for r in results)
    assert svc.used == 0


def test_a_recap_is_voiced_only_once_it_exists_and_is_verified() -> None:
    synth = FakeSynth()
    client = TestClient(create_app())
    client.app.state.matches.voice = service(synth)
    create(client)
    url = "/v1/matches/match-short/recap/casual/audio.mp3"
    assert client.get(url, params=Q).status_code == 404  # no full time yet
    assert synth.calls == []
    post_all(client)
    client.post("/internal/v1/recaps", json={"session_id": "short", "match_id": "match-short"})
    recap = client.get("/v1/matches/match-short/recap/casual", params=Q).json()
    assert all(row["verdict"] == "verified" for row in recap["sentences"])
    ok = client.get(url, params=Q)
    assert ok.status_code == 200 and ok.headers["content-type"] == "audio/mpeg"
    assert len(synth.calls) == 1
    assert recap["sentences"][0]["text"].split()[0] in synth.calls[0]
    assert client.get(url.replace("casual", "fan"), params=Q).status_code == 200  # alias
    assert len(synth.calls) == 1  # same text and voice: the clip is cached


def test_only_verified_recap_sentences_are_spoken() -> None:
    synth = FakeSynth()
    client = TestClient(create_app())
    client.app.state.matches.voice = service(synth)
    create(client)
    post_all(client)
    client.post("/internal/v1/recaps", json={"session_id": "short", "match_id": "match-short"})
    flow = client.app.state.matches.get("short", "match-short")
    recap = flow.store.get_recap(flow.sk, "casual")
    recap["sentences"][0]["verdict"] = "review"
    flow.store.put_recap(flow.sk, "casual", recap)
    held = recap["sentences"][0]["text"]
    assert client.get("/v1/matches/match-short/recap/casual/audio.mp3", params=Q).status_code == 200
    assert held not in synth.calls[0]
    for row in recap["sentences"]:
        row["verdict"] = "review"
    flow.store.put_recap(flow.sk, "casual", recap)
    assert client.get("/v1/matches/match-short/recap/casual/audio.mp3", params=Q).status_code == 404


def test_a_long_recap_is_voiced_in_parts_that_each_fit_one_clip() -> None:
    from app.matches import pack

    sentences = [
        f"Sentence number {n} of a long full time recap about the match." for n in range(40)
    ]
    parts = pack(sentences)
    assert len(parts) > 1 and all(len(p) < voice_module.MAX_CHARS for p in parts)
    assert " ".join(parts) == " ".join(sentences)  # nothing lost, order kept
    assert len(pack(["x" * 5000])[0]) < voice_module.MAX_CHARS  # one runaway sentence is cut


def test_published_lines_carry_the_voice_route_only_when_speech_is_ready() -> None:
    def audio_urls(voice) -> list:
        client = TestClient(create_app())
        client.app.state.matches.voice = voice
        create(client)
        post_all(client)
        text = client.get(
            "/v1/matches/match-short/stream", params={**Q, "persona": "casual", "follow": "false"}
        ).text
        return [ln for ln in text.splitlines() if ln.startswith("data:") and "audio_url" in ln]

    on = audio_urls(service())
    assert on and "/lines/" in on[0] and "audio.mp3?session_id=short" in on[0]
    assert audio_urls(VoiceService()) == []  # no Speech resource: no url offered
