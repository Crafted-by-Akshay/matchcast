"""Shirt-number second opinion for the browser's vision tracker (DAT-11, docs/architecture/09).

The browser reads shirt numbers from pixels itself. Only when a track's identity confidence is
low does it send a 128x128 torso crop here; this module asks Azure AI Vision Read for the digits.
The 15-a-minute and 3,000-call limits are ours, for cost (ADR-0010).
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from collections import deque
from dataclasses import dataclass
from typing import Protocol

VISION_PER_MINUTE = 15
VISION_MAX_CALLS_DEFAULT = 3000
MAX_CROP_BYTES = 40 * 1024
CROP_SIDE = 128
VISION_MAX_BODY = 64 * 1024  # JSON envelope around a 60,000-character base64 crop
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
SHIRT = re.compile(r"^\d{1,2}$")
ENDPOINT_SUFFIXES = (".cognitiveservices.azure.com", ".cognitive.microsoft.com")
IEND = b"\x00\x00\x00\x00IEND\xaeB`\x82"

log = logging.getLogger("matchcast.vision")


class VisionError(Exception):
    def __init__(self, status: int, code: str, detail: str, retry_after: int | None = None):
        super().__init__(detail)
        self.status, self.code, self.detail, self.retry_after = status, code, detail, retry_after


@dataclass(frozen=True)
class Reading:
    shirt: str | None
    confidence: float
    source: str  # azure_read | unavailable


class ShirtReader(Protocol):
    def read(self, png: bytes) -> Reading: ...


class UnavailableReader:
    """No Azure AI Vision resource configured: say so, never invent a number."""

    def read(self, png: bytes) -> Reading:
        return Reading(None, 0.0, "unavailable")


class TokenError(Exception):
    """Managed identity gave no token: nothing was sent to Azure."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """The bearer token must never follow a redirect to another host."""

    def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None


def check_endpoint(endpoint: str) -> str:
    """An https Azure AI Services host with no credentials, path, query or fragment."""
    url = urllib.parse.urlparse(endpoint)
    host = url.hostname or ""
    extra = tuple(x for x in os.environ.get("VISION_ENDPOINT_SUFFIXES", "").split(",") if x)
    ok = (
        url.scheme == "https"
        and not url.username
        and not url.password
        and not url.query
        and not url.fragment
        and url.path in ("", "/")
        and host.endswith(ENDPOINT_SUFFIXES + extra)
    )
    if not ok:
        raise ValueError(
            "VISION_ENDPOINT must be https://<resource>.cognitiveservices.azure.com "
            "(or .cognitive.microsoft.com), with no credentials, path or query"
        )
    return endpoint.rstrip("/")


class AzureReadReader:
    """Image Analysis 4.0, feature `read`, over REST with a managed-identity token (no API key)."""

    API = "2023-10-01"

    def __init__(self, endpoint: str, credential: object | None = None, timeout: float = 5.0):
        self.endpoint, self.timeout = check_endpoint(endpoint), timeout
        self._credential = credential
        self._opener = urllib.request.build_opener(_NoRedirect)

    def _token(self) -> str:
        if self._credential is None:
            from azure.identity import DefaultAzureCredential  # noqa: PLC0415

            self._credential = DefaultAzureCredential()
        return self._credential.get_token("https://cognitiveservices.azure.com/.default").token  # type: ignore[attr-defined]

    def read(self, png: bytes) -> Reading:
        path = f"/computervision/imageanalysis:analyze?api-version={self.API}&features=read"
        url = self.endpoint + path
        try:
            token = self._token()
        except Exception as error:
            raise TokenError from error
        request = urllib.request.Request(  # noqa: S310 - https endpoint from our own config
            url,
            data=png,
            method="POST",
            headers={
                "Content-Type": "application/octet-stream",
                "Authorization": f"Bearer {token}",
            },
        )
        with self._opener.open(request, timeout=self.timeout) as response:
            body = json.load(response)
        return best_shirt(body)


def best_shirt(body: dict) -> Reading:
    """The highest-confidence word that is exactly one or two digits."""
    best: tuple[str, float] | None = None
    for block in (body.get("readResult") or {}).get("blocks", []):
        for line in block.get("lines", []):
            for word in line.get("words", []):
                text = str(word.get("text", "")).strip()
                confidence = float(word.get("confidence", 0.0))
                if SHIRT.match(text) and (best is None or confidence > best[1]):
                    best = (text, confidence)
    return (
        Reading(best[0], round(best[1], 3), "azure_read")
        if best
        else Reading(None, 0.0, "azure_read")
    )


def reader_from_env() -> ShirtReader:
    """Unset means no resource (the glyph reader works alone); a set but bad value fails loudly."""
    endpoint = os.environ.get("VISION_ENDPOINT", "").strip()
    return AzureReadReader(endpoint) if endpoint else UnavailableReader()


class VisionBudget:
    """At most VISION_PER_MINUTE calls in a rolling minute and a total cap, per api process.

    One caller can use the whole allowance; that is accepted for a cost cap (ADR-0010). With more
    than one replica each process keeps its own counters, so the real ceiling is the sum.
    Calls that reach Azure are charged even when Azure fails; a failure before the call
    (token acquisition) is refunded.
    """

    def __init__(self, per_minute: int = VISION_PER_MINUTE, total: int | None = None):
        self.per_minute = per_minute
        self.total = (
            int(os.environ.get("VISION_MAX_CALLS", VISION_MAX_CALLS_DEFAULT))
            if total is None
            else total
        )
        self.used = 0
        self._window: deque[float] = deque()
        self._lock = threading.Lock()

    def take(self, now: float | None = None) -> None:
        with self._lock:
            self._take(time.monotonic() if now is None else now)

    def refund(self) -> None:
        """Give back the latest slot when the call never reached Azure."""
        with self._lock:
            if self._window:
                self._window.pop()
                self.used -= 1

    def _take(self, now: float) -> None:
        if self.used >= self.total:
            raise VisionError(
                429,
                "vision_budget_used",
                "the OCR call budget is used; the glyph reader works alone",
            )
        while self._window and now - self._window[0] >= 60:
            self._window.popleft()
        if len(self._window) >= self.per_minute:
            wait = max(1, int(60 - (now - self._window[0])) + 1)
            raise VisionError(
                429,
                "rate_limited",
                f"at most {self.per_minute} OCR calls a minute",
                retry_after=wait,
            )
        self._window.append(now)
        self.used += 1


def decode_crop(crop_b64: str) -> bytes:
    """A 128x128 PNG of at most 40 KB, or a VisionError."""
    try:
        png = base64.b64decode(crop_b64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise VisionError(422, "invalid_crop", "crop is not base64") from error
    if len(png) > MAX_CROP_BYTES:
        raise VisionError(413, "crop_too_large", f"crop is over {MAX_CROP_BYTES} bytes")
    if (
        len(png) < 33 + len(IEND)
        or not png.startswith(PNG_MAGIC)
        or png[8:16] != b"\x00\x00\x00\x0dIHDR"
        or zlib.crc32(png[12:29]) != struct.unpack(">I", png[29:33])[0]
        or not png.endswith(IEND)
    ):
        raise VisionError(422, "invalid_crop", "crop is not a complete PNG")
    width, height = struct.unpack(">II", png[16:24])
    if (width, height) != (CROP_SIDE, CROP_SIDE):
        raise VisionError(
            422, "invalid_crop", f"crop must be {CROP_SIDE}x{CROP_SIDE}, got {width}x{height}"
        )
    return png


class VisionService:
    def __init__(self, reader: ShirtReader | None = None, budget: VisionBudget | None = None):
        self.reader = reader or reader_from_env()
        self.budget = budget or VisionBudget()

    def identify(self, crop_b64: str) -> dict:
        png = decode_crop(crop_b64)
        self.budget.take()
        started = time.perf_counter()
        try:
            reading = self.reader.read(png)
        except TokenError as error:
            self.budget.refund()
            log.warning("vision token acquisition failed: %s", type(error.__cause__).__name__)
            raise VisionError(
                502, "vision_unavailable", "the OCR service did not answer"
            ) from error
        except Exception as error:  # noqa: BLE001 - Azure down or denied: the glyph reading stands
            log.warning("vision read failed: %s", type(error).__name__, exc_info=True)
            raise VisionError(
                502, "vision_unavailable", "the OCR service did not answer"
            ) from error
        return {
            "shirt": reading.shirt,
            "confidence": reading.confidence,
            "source": reading.source,
            "elapsed_ms": round((time.perf_counter() - started) * 1000),
        }
