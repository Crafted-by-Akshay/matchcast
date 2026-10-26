"""The voice call socket (EXP-18): turns, sentence-by-sentence audio, cancel and bad frames."""

import asyncio
import json

from app.call import CallSocket, sentences

DISCONNECT = object()
REPLY = "Two shots so far, boss. I'll keep asking for the ball. Watch the far post."


class FakeSocket:
    def __init__(self) -> None:
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.sent: list = []

    async def receive(self) -> dict:
        """The raw ASGI message, as Starlette hands it over: a binary frame has no "text" key."""
        item = await self.inbox.get()
        if item is DISCONNECT:
            return {"type": "websocket.disconnect", "code": 1000}
        if isinstance(item, bytes):
            return {"type": "websocket.receive", "bytes": item}
        text = json.dumps(item) if isinstance(item, dict) else item
        return {"type": "websocket.receive", "text": text}

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    async def send_bytes(self, data: bytes) -> None:
        self.sent.append(data)

    def types(self) -> list:
        return [p["type"] if isinstance(p, dict) else "bytes" for p in self.sent]


async def until_turn_ends(ws: FakeSocket, turn_id: int) -> None:
    def done() -> bool:
        return any(
            p.get("type") == "audio_end" and p["id"] == turn_id
            for p in ws.sent
            if isinstance(p, dict)
        )

    while not done():
        await asyncio.sleep(0.001)


def verified(reply: str = REPLY) -> dict:
    return {
        "verdict": "verified",
        "reply": reply,
        "order": "none",
        "facts": {"shots": 2},
        "audio_url": "/v1/audio/x.mp3",
    }


async def talk_once(result: dict, *, speak=None, allow=lambda: True) -> FakeSocket:
    ws = FakeSocket()

    async def talk(target: str, utterance: str, position: str | None, lang: str) -> dict:
        return result

    async def default_speak(sentence: str, voice: str) -> bytes | None:
        return f"mp3:{sentence}".encode()

    socket = CallSocket(
        ws,
        talk=talk,
        speak=speak or default_speak,
        voice_for=lambda role, target: "voice-" + role,
        allow_talk=allow,
    )
    server = asyncio.create_task(socket.serve())
    await ws.inbox.put({"type": "talk", "id": 1, "target": "home9", "utterance": "shots?"})
    await until_turn_ends(ws, 1)
    await ws.inbox.put(DISCONNECT)
    await server
    return ws


def test_sentences_split_on_full_stops_and_drop_blanks() -> None:
    assert sentences(" One. Two! Three? ") == ["One.", "Two!", "Three?"]
    assert sentences("No break here") == ["No break here"]
    assert sentences("") == []


def test_a_verified_reply_is_sent_then_spoken_one_sentence_at_a_time() -> None:
    ws = asyncio.run(talk_once(verified()))
    assert ws.types() == [
        "reply",
        "audio",
        "bytes",
        "audio",
        "bytes",
        "audio",
        "bytes",
        "audio_end",
    ]
    reply = ws.sent[0]
    assert reply["type"] == "reply" and reply["id"] == 1
    assert (
        "audio_url" not in reply
    )  # the call streams audio, the talk route's clip link is not used
    headers = [p for p in ws.sent if isinstance(p, dict) and p["type"] == "audio"]
    assert [h["seq"] for h in headers] == [0, 1, 2]
    assert [h["last"] for h in headers] == [False, False, True]
    assert ws.sent[-1] == {"type": "audio_end", "id": 1, "cancelled": False}


def test_each_sentence_is_voiced_with_the_role_voice() -> None:
    voices: list[str] = []

    async def speak(sentence: str, voice: str) -> bytes:
        voices.append(voice)
        return b"mp3"

    asyncio.run(talk_once(verified(), speak=speak))
    assert voices == ["voice-player"] * 3


def test_an_unverified_reply_is_shown_but_not_spoken() -> None:
    ws = asyncio.run(talk_once({"verdict": "refused", "reply": "No.", "order": "none"}))
    assert ws.types() == ["reply", "audio_end"]
    assert ws.sent[-1] == {"type": "audio_end", "id": 1, "cancelled": False}


def test_a_sentence_that_cannot_be_voiced_ends_the_audio_without_cancel() -> None:
    async def silent(sentence: str, voice: str) -> None:
        return None

    ws = asyncio.run(talk_once(verified(), speak=silent))
    assert ws.types() == ["reply", "audio_end"]
    assert ws.sent[-1]["cancelled"] is False


def test_a_cancel_stops_the_reply_before_its_next_sentence() -> None:
    ws = FakeSocket()

    async def talk(target: str, utterance: str, position: str | None, lang: str) -> dict:
        return verified()

    async def speak_then_cancel(sentence: str, voice: str) -> bytes:
        # the fan talks over the second sentence while it is being made: it is not sent
        if sentence.startswith("I'll"):
            await ws.inbox.put({"type": "cancel", "id": 1})
            await asyncio.sleep(0.01)
        return b"mp3"

    async def scenario() -> None:
        socket = CallSocket(
            ws,
            talk=talk,
            speak=speak_then_cancel,
            voice_for=lambda role, target: "v",
            allow_talk=lambda: True,
        )
        server = asyncio.create_task(socket.serve())
        await ws.inbox.put({"type": "talk", "id": 1, "target": "home9", "utterance": "x"})
        await until_turn_ends(ws, 1)
        await ws.inbox.put(DISCONNECT)
        await server

    asyncio.run(scenario())
    audio = [p for p in ws.sent if isinstance(p, dict) and p["type"] == "audio"]
    assert len(audio) == 1  # the first sentence went out; the one the fan spoke over did not
    assert ws.sent[-1] == {"type": "audio_end", "id": 1, "cancelled": True}


def test_a_rate_limited_turn_is_refused_and_never_talked() -> None:
    called = []

    async def talk(target: str, utterance: str, position: str | None, lang: str) -> dict:
        called.append(target)
        return verified()

    ws = FakeSocket()

    async def scenario() -> None:
        socket = CallSocket(
            ws, talk=talk, speak=None, voice_for=lambda r, t: "v", allow_talk=lambda: False
        )
        server = asyncio.create_task(socket.serve())
        await ws.inbox.put({"type": "talk", "id": 2, "target": "home9", "utterance": "x"})
        while not ws.sent:
            await asyncio.sleep(0.001)
        await ws.inbox.put(DISCONNECT)
        await server

    asyncio.run(scenario())
    assert ws.sent == [{"type": "error", "id": 2, "code": "rate_limited"}]
    assert called == []


def test_a_bad_frame_is_answered_and_the_call_stays_open() -> None:
    ws = FakeSocket()

    async def scenario() -> None:
        socket = CallSocket(
            ws,
            talk=None,
            speak=None,
            voice_for=lambda r, t: "v",
            allow_talk=lambda: True,
        )
        server = asyncio.create_task(socket.serve())
        await ws.inbox.put({"type": "shout", "id": 3})
        await ws.inbox.put({"type": "talk", "id": "not-a-number"})
        while len(ws.sent) < 2:
            await asyncio.sleep(0.001)
        await ws.inbox.put(DISCONNECT)
        await server

    asyncio.run(scenario())
    assert ws.sent == [
        {"type": "error", "id": 3, "code": "bad_frame"},
        {"type": "error", "id": None, "code": "bad_frame"},  # an id that is not an int: no echo
    ]


def test_a_talk_error_with_a_code_is_sent_with_that_code() -> None:
    class Refused(Exception):
        code = "not_found"

    async def talk(target: str, utterance: str, position: str | None, lang: str) -> dict:
        raise Refused("unknown target")

    ws = FakeSocket()

    async def scenario() -> None:
        socket = CallSocket(
            ws, talk=talk, speak=None, voice_for=lambda r, t: "v", allow_talk=lambda: True
        )
        server = asyncio.create_task(socket.serve())
        await ws.inbox.put({"type": "talk", "id": 4, "target": "ghost", "utterance": "x"})
        while not ws.sent:
            await asyncio.sleep(0.001)
        await ws.inbox.put(DISCONNECT)
        await server

    asyncio.run(scenario())
    assert ws.sent == [{"type": "error", "id": 4, "code": "not_found"}]


def test_a_verified_reply_without_facts_is_shown_and_not_spoken() -> None:
    # Watch shows a reply by its facts only; the call speaks the same replies and no others
    ws = asyncio.run(talk_once({**verified(), "facts": {}}))
    assert ws.types() == ["reply", "audio_end"]


def test_frames_that_are_not_json_objects_are_refused_and_the_call_stays_open() -> None:
    ws = FakeSocket()

    async def scenario() -> None:
        socket = CallSocket(
            ws, talk=None, speak=None, voice_for=lambda r, t: "v", allow_talk=lambda: True
        )
        server = asyncio.create_task(socket.serve())
        for frame in ("not json", "[1, 2]", "42", b"\x00\x01"):
            await ws.inbox.put(frame)
        await ws.inbox.put({"type": "shout", "id": 3})
        while len(ws.sent) < 5:
            await asyncio.sleep(0.001)
        await ws.inbox.put(DISCONNECT)
        await server

    asyncio.run(scenario())
    assert ws.sent == [{"type": "error", "id": None, "code": "bad_frame"}] * 4 + [
        {"type": "error", "id": 3, "code": "bad_frame"}
    ]


def test_a_talk_whose_id_is_in_flight_is_refused_and_the_first_still_answers() -> None:
    ws = FakeSocket()

    async def talk(target: str, utterance: str, position: str | None, lang: str) -> dict:
        await asyncio.sleep(0.02)
        return verified()

    async def scenario() -> None:
        socket = CallSocket(
            ws,
            talk=talk,
            speak=lambda sentence, voice: asyncio.sleep(0, b"mp3"),
            voice_for=lambda r, t: "v",
            allow_talk=lambda: True,
        )
        server = asyncio.create_task(socket.serve())
        await ws.inbox.put({"type": "talk", "id": 5, "target": "home9", "utterance": "one"})
        await ws.inbox.put({"type": "talk", "id": 5, "target": "home9", "utterance": "two"})
        await until_turn_ends(ws, 5)
        await ws.inbox.put(DISCONNECT)
        await server

    asyncio.run(scenario())
    assert {"type": "error", "id": 5, "code": "bad_frame"} in ws.sent
    assert sum(1 for p in ws.sent if isinstance(p, dict) and p["type"] == "reply") == 1


def test_a_disconnect_cancels_the_turn_in_flight() -> None:
    ws = FakeSocket()
    cancelled: list[str] = []

    async def talk(target: str, utterance: str, position: str | None, lang: str) -> dict:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.append(target)
            raise
        return verified()

    async def scenario() -> None:
        socket = CallSocket(
            ws, talk=talk, speak=None, voice_for=lambda r, t: "v", allow_talk=lambda: True
        )
        server = asyncio.create_task(socket.serve())
        await ws.inbox.put({"type": "talk", "id": 1, "target": "home9", "utterance": "x"})
        await asyncio.sleep(0.01)
        await ws.inbox.put(DISCONNECT)
        await server
        await asyncio.sleep(0.01)  # the cancelled turn runs its handler

    asyncio.run(scenario())
    assert cancelled == ["home9"]


def test_a_cancel_for_a_finished_turn_is_ignored() -> None:
    ws = FakeSocket()

    async def scenario() -> None:
        socket = CallSocket(
            ws,
            talk=lambda t, u, p, lang: asyncio.sleep(0, verified()),
            speak=lambda s, v: asyncio.sleep(0, b"mp3"),
            voice_for=lambda r, t: "v",
            allow_talk=lambda: True,
        )
        server = asyncio.create_task(socket.serve())
        await ws.inbox.put({"type": "talk", "id": 1, "target": "home9", "utterance": "x"})
        await until_turn_ends(ws, 1)
        await ws.inbox.put({"type": "cancel", "id": 1})  # a cut-in that races the end
        await asyncio.sleep(0.01)
        await ws.inbox.put(DISCONNECT)
        await server

    asyncio.run(scenario())
    assert not [p for p in ws.sent if isinstance(p, dict) and p["type"] == "error"]
    assert ws.sent[-1] == {"type": "audio_end", "id": 1, "cancelled": False}


def test_the_viewers_language_reaches_the_talk_and_defaults_to_english() -> None:
    ws = FakeSocket()
    seen: list[str] = []

    async def talk(target: str, utterance: str, position: str | None, lang: str) -> dict:
        seen.append(lang)
        return {**verified(), "captions": {"caption": {"lang": lang, "text": None}}}

    async def scenario() -> None:
        socket = CallSocket(
            ws,
            talk=talk,
            speak=lambda s, v: asyncio.sleep(0, b"mp3"),
            voice_for=lambda r, t: "v",
            allow_talk=lambda: True,
        )
        server = asyncio.create_task(socket.serve())
        await ws.inbox.put(
            {"type": "talk", "id": 1, "target": "home9", "utterance": "x", "lang": "es"}
        )
        await until_turn_ends(ws, 1)
        await ws.inbox.put({"type": "talk", "id": 2, "target": "home9", "utterance": "x"})
        await until_turn_ends(ws, 2)
        await ws.inbox.put(DISCONNECT)
        await server

    asyncio.run(scenario())
    assert seen == ["es", "en"]
    reply = next(p for p in ws.sent if isinstance(p, dict) and p["type"] == "reply")
    assert reply["captions"] == {"caption": {"lang": "es", "text": None}}
