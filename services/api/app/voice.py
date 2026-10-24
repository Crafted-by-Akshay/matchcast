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
import zlib
from collections import OrderedDict, deque
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Protocol
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
_STORE_POOL = ThreadPoolExecutor(
    max_workers=2, thread_name_prefix="clipstore"
)  # Blob calls get their own threads, so a slow Blob cannot starve Speech
STORE_TIMEOUT_S = 3.0  # a Blob read or write that takes longer is skipped, never waited on
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
KEY = re.compile(r"^[0-9a-f]{32}$")  # what clip_key makes; nothing else is looked up in the store
CLIPS_CONTAINER = "audio"  # the storage account's audio container (infra/modules/storage.bicep)


class ClipStore(Protocol):
    """Where finished clips are kept so a restart does not lose them."""

    def get(self, key: str) -> bytes | None: ...

    def put(self, key: str, audio: bytes) -> None: ...


class BlobClipStore:
    """Clips as MP3 blobs in the `audio` container, written with the api's managed identity."""

    def __init__(self, account_url: str | None = None) -> None:
        self._account_url = account_url
        self._container: Any = None

    def _client(self, key: str) -> Any:
        if self._container is None:
            from matchcast_shared.azure_clients import blob_service_client

            self._container = blob_service_client(self._account_url).get_container_client(
                CLIPS_CONTAINER
            )
        return self._container.get_blob_client(f"clips/{key}.mp3")

    def get(self, key: str) -> bytes | None:
        from azure.core.exceptions import ResourceNotFoundError

        try:
            return bytes(self._client(key).download_blob().readall())
        except ResourceNotFoundError:
            return None

    def put(self, key: str, audio: bytes) -> None:
        self._client(key).upload_blob(audio, overwrite=True)


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


def _store_from_env() -> ClipStore | None:
    url = os.environ.get("STORAGE_BLOB_URL", "")
    return BlobClipStore(url) if url.startswith("https://") else None


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
        store: ClipStore | None = None,
    ) -> None:
        endpoint = os.environ.get("SPEECH_ENDPOINT", "") if endpoint is None else endpoint
        if synthesiser is None and ENDPOINT.match(endpoint):
            synthesiser = _AzureTts(endpoint)
        self._synthesiser = synthesiser
        self.voices: Mapping[str, Any] = load_voices() if voices is None else voices
        self.char_budget = char_budget if char_budget is not None else _budget_from_env()
        self.store = store if store is not None else _store_from_env()
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
            if player_id in players:  # an explicit override for this player
                return str(players[player_id])
            pool = players.get("pool")
            if pool and player_id:  # every other player keeps one voice from the pool, every time
                return str(pool[zlib.crc32(player_id.encode()) % len(pool)])
            return str(players["default"])
        return str(self.voices[role])

    def get(self, key: str) -> bytes | None:
        with self._lock:
            audio = self._clips.get(key)
            if audio is not None:
                self._clips.move_to_end(key)
            return audio

    async def fetch(self, key: str) -> bytes | None:
        """A clip by key: memory first, then the store (a clip made before a restart)."""
        audio = self.get(key)
        if audio is not None or self.store is None or not KEY.match(key):
            return audio
        audio = await self._stored(key)
        if audio is not None:
            self._remember(key, audio)
        return audio

    async def _stored(self, key: str) -> bytes | None:
        store = self.store
        if store is None:
            return None
        try:
            return await asyncio.wait_for(
                asyncio.get_running_loop().run_in_executor(_STORE_POOL, store.get, key),
                STORE_TIMEOUT_S,
            )
        except Exception as error:  # noqa: BLE001 - a store problem only means a fresh synthesis
            log.warning("clip store read failed: %s", type(error).__name__)
            return None

    def _remember(self, key: str, audio: bytes) -> None:
        with self._lock:
            self._clips[key] = audio
            while len(self._clips) > CACHE_LIMIT:
                self._clips.popitem(last=False)

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
        saved = await self._stored(key)
        if saved is not None:  # made before a restart: no Speech call, nothing charged
            with self._lock:
                self.used -= len(text)
            self._remember(key, saved)
            return saved
        try:
            loop = asyncio.get_running_loop()
            audio = await loop.run_in_executor(_SYNTH_POOL, self._synthesise, ssml(text, voice))
        except VoiceError:
            with self._lock:
                self.used -= len(text)  # nothing was voiced, so nothing is charged
            raise
        self._remember(key, audio)
        await self._save(key, audio)
        return audio

    async def _save(self, key: str, audio: bytes) -> None:
        store = self.store
        if store is None:
            return
        try:
            await asyncio.wait_for(
                asyncio.get_running_loop().run_in_executor(_STORE_POOL, store.put, key, audio),
                STORE_TIMEOUT_S,
            )
        except Exception as error:  # noqa: BLE001 - the clip still plays; it just is not kept
            log.warning("clip store write failed: %s", type(error).__name__)

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
