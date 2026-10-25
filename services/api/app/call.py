"""The voice call socket (EXP-18): one WebSocket per call, both ways.

Client to server, JSON text frames:
  {"type": "talk", "id": n, "target": "home9", "position": "ST", "utterance": "..."}
  {"type": "cancel", "id": n}        the fan spoke over the reply: stop sending it

Server to client:
  {"type": "reply", "id": n, ...the checked talk result, without audio_url}
  {"type": "audio", "id": n, "seq": k, "last": bool}, then one binary frame: an MP3 for one sentence
  {"type": "audio_end", "id": n, "cancelled": bool}
  {"type": "error", "id": n, "code": "...", "message": "..."}

A reply is spoken one sentence at a time, so the first sentence plays while the rest is made. Only a
verified reply is spoken, as in the talk route. Frames for one turn are sent in order, and a cancel
stops the turn before its next sentence is sent.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import WebSocketDisconnect

SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+")

TalkFn = Callable[[str, str, str | None], Awaitable[dict[str, Any]]]
SpeakFn = Callable[[str, str], Awaitable[bytes | None]]


def _retrieved(task: asyncio.Task) -> None:
    """A turn that fails after the fan hung up is not an error to log: retrieve its exception."""
    if not task.cancelled():
        task.exception()


def sentences(reply: str) -> list[str]:
    return [part for part in SENTENCE_BREAK.split(reply.strip()) if part]


class CallSocket:
    """Serves one call: talks run in turn, each as its own task, and a cancel stops one."""

    def __init__(
        self,
        websocket: Any,
        *,
        talk: TalkFn,
        speak: SpeakFn,
        voice_for: Callable[[str, str], str],
        allow_talk: Callable[[], bool],
    ) -> None:
        self.ws = websocket
        self._talk = talk
        self._speak = speak
        self._voice_for = voice_for
        self._allow_talk = allow_talk
        self._cancelled: set[int] = set()
        self._send_lock = asyncio.Lock()  # a header and its audio frame go out together

    async def _json(self, payload: dict[str, Any]) -> None:
        async with self._send_lock:
            await self.ws.send_json(payload)

    async def serve(self) -> None:
        turns: dict[int, asyncio.Task] = {}
        try:
            while True:
                message = await self.ws.receive_json()
                kind, turn_id = message.get("type"), message.get("id")
                if kind == "cancel" and isinstance(turn_id, int):
                    self._cancelled.add(turn_id)
                elif kind == "talk" and isinstance(turn_id, int):
                    task = asyncio.create_task(self._turn(turn_id, message))
                    task.add_done_callback(_retrieved)
                    turns[turn_id] = task
                else:
                    await self._json({"type": "error", "id": turn_id, "code": "bad_frame"})
        except WebSocketDisconnect:
            pass
        finally:
            for task in turns.values():
                task.cancel()

    async def _turn(self, turn_id: int, message: dict[str, Any]) -> None:
        if not self._allow_talk():
            await self._json({"type": "error", "id": turn_id, "code": "rate_limited"})
            return
        target = message.get("target")
        utterance = message.get("utterance")
        position = message.get("position")
        if not isinstance(target, str) or not isinstance(utterance, str):
            await self._json({"type": "error", "id": turn_id, "code": "bad_frame"})
            return
        try:
            result = await self._talk(target, utterance, position)
        except Exception as error:  # a workflow refusal is answered in the call, not dropped
            await self._json(
                {"type": "error", "id": turn_id, "code": getattr(error, "code", "talk_failed")}
            )
            return
        public = {k: v for k, v in result.items() if k != "audio_url"}
        await self._json({"type": "reply", "id": turn_id, **public})
        if result.get("verdict") != "verified":
            await self._json({"type": "audio_end", "id": turn_id, "cancelled": False})
            return
        role = "producer" if target == "producer" else "player"
        role_voice = self._voice_for(role, target)
        parts = sentences(str(result.get("reply", "")))
        for seq, sentence in enumerate(parts):
            if turn_id in self._cancelled:
                break
            audio = await self._speak(sentence, role_voice)
            if audio is None or turn_id in self._cancelled:
                break
            async with self._send_lock:
                await self.ws.send_json(
                    {"type": "audio", "id": turn_id, "seq": seq, "last": seq == len(parts) - 1}
                )
                await self.ws.send_bytes(audio)
        cancelled = turn_id in self._cancelled
        self._cancelled.discard(turn_id)
        await self._json({"type": "audio_end", "id": turn_id, "cancelled": cancelled})
