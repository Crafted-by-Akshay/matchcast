"""Translate verified English text, then re-check it (EXP-17, docs/architecture/10 §4).

Only text the Verifier already passed is translated. Names are wrapped so the service leaves them
alone, and the result is accepted only when it carries the same numbers and the same names as the
English. Anything else drops that language for that line: the viewer keeps the English.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import os
import re
import urllib.parse
import urllib.request
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Protocol

LANGUAGES = ("en", "es", "hi")  # Tamil stays off until a native speaker reviews it
MAX_CHARS_DEFAULT = 500_000
TRANSLATE_TIMEOUT_S = 3.0
SCOPE = "https://cognitiveservices.azure.com/.default"
ENDPOINT = re.compile(r"^https://[a-z0-9-]{2,64}\.cognitiveservices\.azure\.com/?$")
_DEVANAGARI = {ord("०") + i: str(i) for i in range(10)}
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_MARKER = re.compile(r"\[(?:claim|kb|line):[^\]]+\]")
_TAG = re.compile(r"<[^>]+>")

log = logging.getLogger("matchcast.translate")


class TranslationError(Exception):
    """The service did not translate; the viewer keeps the English."""


class Translator(Protocol):
    def translate(self, text_html: str, lang: str) -> str: ...


def numbers(text: str) -> list[str]:
    """Every number in the text, Devanagari digits read as ASCII and separators dropped, sorted."""
    found = _NUMBER.findall(text.translate(_DEVANAGARI))
    return sorted(re.sub(r"[.,]", "", n) for n in found)  # 2.5 and 2,5 are the same number


def protect(text: str, names: Iterable[str]) -> str:
    """HTML for the Translator: names and citation markers sit in translate=no spans."""
    out = html.escape(text, quote=False)
    spans = sorted({html.escape(n, quote=False) for n in names if n}, key=len, reverse=True)
    for span in [*spans, *{html.escape(m, quote=False) for m in _MARKER.findall(text)}]:
        if span:
            out = out.replace(span, f"\x00{span}\x01")
    return out.replace("\x00", '<span translate="no" class="notranslate">').replace(
        "\x01", "</span>"
    )


def clean(translated_html: str) -> str:
    return html.unescape(_TAG.sub("", translated_html)).strip()


def recheck(english: str, translated: str, names: Iterable[str]) -> str | None:
    """None when the translation is faithful, else the reason it was rejected."""
    if not translated:
        return "empty"
    if numbers(english) != numbers(translated):
        return "numbers_differ"
    for name in names:
        if name and name in english and name not in translated:
            return "name_changed"
    if set(_MARKER.findall(english)) != set(_MARKER.findall(translated)):
        return "citation_changed"
    return None


class AzureTranslator:
    """Translator v3 on a custom-domain resource, called with the api's managed identity."""

    def __init__(self, endpoint: str, region: str | None = None) -> None:
        self.url = endpoint.rstrip("/") + "/translator/text/v3.0/translate"
        self.region = region
        self._credential: Any = None

    def translate(self, text_html: str, lang: str) -> str:
        if self._credential is None:
            from azure.identity import DefaultAzureCredential

            self._credential = DefaultAzureCredential()
        query = urllib.parse.urlencode({"api-version": "3.0", "to": lang, "textType": "html"})
        headers = {
            "Authorization": f"Bearer {self._credential.get_token(SCOPE).token}",
            "Content-Type": "application/json",
        }
        if self.region:
            headers["Ocp-Apim-Subscription-Region"] = self.region
        request = urllib.request.Request(  # noqa: S310 - https, host checked by ENDPOINT
            f"{self.url}?{query}",
            data=json.dumps([{"Text": text_html}]).encode(),
            method="POST",
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=TRANSLATE_TIMEOUT_S) as response:  # noqa: S310
                body = json.load(response)
            return str(body[0]["translations"][0]["text"])
        except Exception as error:  # noqa: BLE001 - nothing from the service is shown
            raise TranslationError(type(error).__name__) from error


@dataclass(frozen=True)
class Variant:
    text: str | None  # None: dropped
    reason: str | None = None


class TranslationService:
    """Translates a verified line once per language, within a character cap."""

    def __init__(
        self,
        translator: Translator | None = None,
        max_chars: int | None = None,
    ) -> None:
        if translator is None:
            endpoint = os.environ.get("TRANSLATOR_ENDPOINT", "")
            if ENDPOINT.match(endpoint):
                translator = AzureTranslator(endpoint, os.environ.get("TRANSLATOR_REGION"))
        self.translator = translator
        env_cap = os.environ.get("TRANSLATOR_MAX_CHARS")
        self.max_chars = max_chars if max_chars is not None else int(env_cap or MAX_CHARS_DEFAULT)
        self.used = 0
        self._done: dict[tuple[str, str], asyncio.Future[Variant]] = {}

    @property
    def ready(self) -> bool:
        return self.translator is not None

    @property
    def paused(self) -> bool:
        return self.used >= self.max_chars

    async def variant(self, key: str, text: str, lang: str, names: Iterable[str]) -> Variant:
        """The checked translation of ``text``; shared by every viewer asking for the same key."""
        if lang == "en" or lang not in LANGUAGES:
            return Variant(None, "unsupported")
        if self.translator is None:
            return Variant(None, "unavailable")
        slot = (key, lang)
        pending = self._done.get(slot)
        if pending is None:
            pending = asyncio.get_running_loop().create_future()
            self._done[slot] = pending
            try:
                pending.set_result(await self._translate(text, lang, list(names)))
            except BaseException as error:
                self._done.pop(slot, None)  # a cancelled or failed attempt is retried
                pending.cancel()
                raise error
        return await asyncio.shield(pending)

    async def _translate(self, text: str, lang: str, names: list[str]) -> Variant:
        if self.paused:
            return Variant(None, "paused")
        self.used += len(text)
        try:
            raw = await asyncio.wait_for(
                asyncio.to_thread(self.translator.translate, protect(text, names), lang),  # type: ignore[union-attr]
                TRANSLATE_TIMEOUT_S + 1,
            )
        except (TranslationError, TimeoutError) as error:
            log.warning("translation to %s failed: %s", lang, type(error).__name__)
            return Variant(None, "service_error")
        translated = clean(raw)
        reason = recheck(text, translated, names)
        return Variant(None, reason) if reason else Variant(translated)
