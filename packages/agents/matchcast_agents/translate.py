"""Translate verified English text, then re-check it (EXP-17, docs/architecture/10 §4).

Only text the Verifier already passed is translated. Names are wrapped so the service leaves them
alone, and the result is accepted only when it carries the same numbers and the same names as the
English. Anything else drops that language for that line: the viewer keeps the English.
"""

from __future__ import annotations

import asyncio
import hashlib
import html
import json
import logging
import os
import re
import urllib.parse
import urllib.request
from collections import OrderedDict
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
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
    """Numbers in the text, Devanagari read as ASCII, decimal commas as points, sorted."""
    found = _NUMBER.findall(text.translate(_DEVANAGARI))
    return sorted(n.replace(",", ".") for n in found)  # 2.5 and 2,5 are the same, 25 is not


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


_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="translate")
_RETRY = ("service_error", "paused")  # not remembered: the next viewer may succeed
CACHE_LIMIT = 2000


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
        self._tasks: OrderedDict[str, asyncio.Task[Variant]] = OrderedDict()

    @property
    def ready(self) -> bool:
        return self.translator is not None

    @property
    def paused(self) -> bool:
        return self.used >= self.max_chars

    async def variant(
        self,
        scope: str,
        key: str,
        text: str,
        lang: str,
        names: Iterable[str],
        on_reject: Callable[[str], None] | None = None,
    ) -> Variant:
        """The checked translation of ``text``, shared by every viewer asking for the same thing.

        ``scope`` (session and match) and the text and names are part of the cache key, so a
        variant is never served to another match. ``on_reject`` runs once, when the result is
        first computed."""
        if lang == "en" or lang not in LANGUAGES:
            return Variant(None, "unsupported")
        if self.translator is None:
            return Variant(None, "unavailable")
        names = sorted(set(names))
        digest = hashlib.sha256(
            json.dumps([scope, key, lang, text, names], ensure_ascii=False).encode()
        ).hexdigest()
        task = self._tasks.get(digest)
        if task is None:
            task = asyncio.get_running_loop().create_task(
                self._translate(text, lang, names, on_reject)
            )
            self._tasks[digest] = task
            task.add_done_callback(lambda t, d=digest: self._settled(d, t))
            while len(self._tasks) > CACHE_LIMIT:
                self._tasks.popitem(last=False)
        return await asyncio.shield(task)  # a viewer leaving cancels only its own wait

    def _settled(self, digest: str, task: asyncio.Task[Variant]) -> None:
        if task.cancelled() or task.exception() is not None or task.result().reason in _RETRY:
            self._tasks.pop(digest, None)

    async def _translate(
        self, text: str, lang: str, names: list[str], on_reject: Callable[[str], None] | None
    ) -> Variant:
        if self.paused:
            return Variant(None, "paused")
        sent = protect(text, names)
        self.used += len(sent)
        try:
            raw = await asyncio.wait_for(
                asyncio.get_running_loop().run_in_executor(
                    _POOL,
                    self.translator.translate,
                    sent,
                    lang,  # type: ignore[union-attr]
                ),
                TRANSLATE_TIMEOUT_S + 1,
            )
        except Exception as error:  # noqa: BLE001 - auth, network, timeout: keep the English
            log.warning("translation to %s failed: %s", lang, type(error).__name__)
            return Variant(None, "service_error")
        translated = clean(raw)
        reason = recheck(text, translated, names)
        if reason:
            if on_reject:
                on_reject(reason)
            return Variant(None, reason)
        return Variant(translated)
