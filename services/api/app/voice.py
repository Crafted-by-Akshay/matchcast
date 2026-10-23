"""Spoken commentary and talk replies (EXP-16, docs/architecture/10 section 2).

The api synthesises the speech itself, so the browser never gets a Speech key or a Speech token for
synthesis; it plays the MP3 the api returns. Only text the Verifier has already passed is spoken:
approved lines on air, verified talk replies, and one fixed audition script. Clips are cached in
memory under a hash of voice and text, so an audio id can only name something the api synthesised.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen
from xml.sax.saxutils import escape

VOICES_FILE = Path(__file__).parents[1] / "config" / "voices.json"
SCOPE = "https://cognitiveservices.azure.com/.default"
ENDPOINT = re.compile(r"^https://[a-z0-9-]{2,64}\.cognitiveservices\.azure\.com/?$")
OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
SYNTH_TIMEOUT_S = 10.0
MAX_CHARS = 1000  # the audition script is the longest text; lines and replies are far shorter
CACHE_LIMIT = 300  # clips kept per process
CHAR_BUDGET_DEFAULT = 200_000  # characters sent to Speech per process; a cost cap, see the cost doc
PER_MINUTE = 30  # new clips per client address per rolling minute; cache hits are free
_SYNTH_POOL = ThreadPoolExecutor(
    max_workers=4, thread_name_prefix="voice"
)  # not shared with other work
MARKER = re.compile(r"\[(?:claim|kb|line):[^\]]+\]")

AUDITION_SCRIPT = (
    "Welcome to MatchCast. Northgate FC get the ball in their own half and play it wide. "
    "Harbour City press high, and the winger wins it back on the touchline. "
    "Now a through ball into the box, the striker runs onto it and sees the keeper "
    "come off the line. "
    "A touch, a finish, and it is one nil to Northgate FC. "
    "This is a voice audition, so the words are fixed, and nothing here is from a real match."
)

log = logging.getLogger("matchcast.voice")


class VoiceError(Exception):
    """A clip could not be made; the message is safe to show."""


Synthesiser = Callable[[str], bytes]  # SSML in, MP3 out


class _AzureTts:
    """Neural TTS on the Speech custom domain, called with the api's managed identity (no key)."""

    def __init__(self, endpoint: str) -> None:
        self.url = endpoint.rstrip("/") + "/tts/cognitiveservices/v1"
        self._credential: Any = None

    def __call__(self, ssml: str) -> bytes:
        if self._credential is None:
            from azure.identity import DefaultAzureCredential

            self._credential = DefaultAzureCredential()
        request = Request(  # noqa: S310 - https, host checked by ENDPOINT
            self.url,
            data=ssml.encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {self._credential.get_token(SCOPE).token}",
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
                "User-Agent": "matchcast-api",
            },
        )
        with urlopen(request, timeout=SYNTH_TIMEOUT_S) as response:  # noqa: S310
            return response.read()


def load_voices(path: Path = VOICES_FILE) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def speakable(text: str) -> str:
    """The words to say: citation markers are for the screen, not the voice."""
    return " ".join(MARKER.sub("", text).split())


def ssml(text: str, voice: str) -> str:
    locale = voice.rsplit("-", 1)[0]  # en-GB-RyanNeural -> en-GB
    return (
        f"<speak version='1.0' xml:lang='{locale}'>"
        f"<voice name='{voice}'>{escape(text)}</voice></speak>"
    )


def _budget_from_env() -> int:
    try:
        return int(os.environ.get("SPEECH_MAX_CHARS") or CHAR_BUDGET_DEFAULT)
    except ValueError:
        log.warning("SPEECH_MAX_CHARS is not a whole number; using the default")
        return CHAR_BUDGET_DEFAULT


def clip_key(text: str, voice: str) -> str:
    return hashlib.sha256(f"{voice}\n{text}".encode()).hexdigest()[:32]


class VoiceService:
    """Synthesises and caches clips; one per api process, like the Speech token service."""

    def __init__(
        self,
        endpoint: str | None = None,
        synthesiser: Synthesiser | None = None,
        voices: Mapping[str, Any] | None = None,
        char_budget: int | None = None,
    ) -> None:
        endpoint = os.environ.get("SPEECH_ENDPOINT", "") if endpoint is None else endpoint
        if synthesiser is None and ENDPOINT.match(endpoint):
            synthesiser = _AzureTts(endpoint)
        self._synthesiser = synthesiser
        self.voices: Mapping[str, Any] = load_voices() if voices is None else voices
        self.char_budget = char_budget if char_budget is not None else _budget_from_env()
        self.used = 0
        self._clips: OrderedDict[str, bytes] = OrderedDict()
        self._inflight: dict[
            str, asyncio.Task[bytes]
        ] = {}  # one synthesis per clip, however many ask
        self._asked: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    @property
    def ready(self) -> bool:
        return self._synthesiser is not None

    def voice_for(self, role: str, player_id: str | None = None) -> str:
        """The voice for a role: commentary, producer, or a player (by id, else the default)."""
        if role == "player":
            players = self.voices["players"]
            return str(players.get(player_id or "", players["default"]))
        return str(self.voices[role])

    def get(self, key: str) -> bytes | None:
        with self._lock:
            audio = self._clips.get(key)
            if audio is not None:
                self._clips.move_to_end(key)
            return audio

    def allow(self, client: str, now: float | None = None) -> bool:
        """At most PER_MINUTE new clips per client address per rolling minute."""
        now = time.monotonic() if now is None else now
        with self._lock:
            for idle in [a for a, w in self._asked.items() if now - w[-1] >= 60]:
                del self._asked[idle]  # every window holds at least one time, so w[-1] exists
            window = self._asked.setdefault(client, deque())
            while window and now - window[0] >= 60:
                window.popleft()
            if len(window) >= PER_MINUTE:
                return False
            window.append(now)
            return True

    async def clip(self, text: str, voice: str) -> bytes:
        """The MP3 for text in voice: cached when made before, else synthesised once.

        Callers that ask for the same new clip while it is being made share one synthesis.
        A failed synthesis gives its characters back to the budget.
        """
        if not self.ready:
            raise VoiceError("no Speech resource is configured")
        if not text or len(text) > MAX_CHARS:
            raise VoiceError("the text is empty or too long to voice")
        key = clip_key(text, voice)
        with self._lock:
            if (audio := self._clips.get(key)) is not None:
                return audio
            task = self._inflight.get(key)
            if task is None:
                if self.used + len(text) > self.char_budget:
                    raise VoiceError("the voice budget for this process is used up")
                self.used += len(
                    text
                )  # reserved before the call, so parallel requests cannot overspend
                task = asyncio.ensure_future(self._make(key, text, voice))
                self._inflight[key] = task
                task.add_done_callback(lambda done, key=key: self._forget(key, done))
        return await asyncio.shield(task)

    async def _make(self, key: str, text: str, voice: str) -> bytes:
        try:
            loop = asyncio.get_running_loop()
            audio = await loop.run_in_executor(_SYNTH_POOL, self._synthesise, ssml(text, voice))
        except VoiceError:
            with self._lock:
                self.used -= len(text)  # nothing was voiced, so nothing is charged
            raise
        with self._lock:
            self._clips[key] = audio
            while len(self._clips) > CACHE_LIMIT:
                self._clips.popitem(last=False)
        return audio

    def _forget(self, key: str, task: asyncio.Task[bytes]) -> None:
        """Drop a finished synthesis; retrieve its error so asyncio does not log the detail."""
        with self._lock:
            if self._inflight.get(key) is task:
                del self._inflight[key]
        if not task.cancelled():
            task.exception()

    def _synthesise(self, markup: str) -> bytes:
        assert self._synthesiser is not None  # clip() checks ready first
        try:
            return self._synthesiser(markup)
        except Exception as error:  # noqa: BLE001 - never leak credential or service detail
            log.warning("speech synthesis failed: %s", type(error).__name__)
            raise VoiceError("the voice could not be made") from error
