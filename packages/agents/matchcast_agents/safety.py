"""Content Safety screening (check 7) and Prompt Shields, with a local screen for rules mode.

``AzureContentSafety`` calls the REST API with a bearer token from ``token_provider`` (managed
identity in Azure); it never sees keys. ``LocalSafetyScreen`` is deterministic and offline so tests
and the rules-mode demo behave the same everywhere. A block is any category severity >= 2.
"""

import asyncio
import logging
import os
import re
import time
from collections import deque
from collections.abc import Callable, Mapping
from typing import Any, Protocol

import httpx
from pydantic import BaseModel

BLOCK_AT = 2
API_VERSION = "2024-09-01"
CATEGORIES = ("Hate", "SelfHarm", "Sexual", "Violence")


class SafetyResult(BaseModel):
    allowed: bool
    categories: dict[str, int]
    source: str


class ShieldResult(BaseModel):
    attack_detected: bool
    source: str


class SafetyScreen(Protocol):
    async def analyze(self, text: str) -> SafetyResult: ...

    async def shield(self, user_prompt: str) -> ShieldResult: ...


class LocalSafetyScreen:
    """Offline stand-in: a short word list for severity and a few injection phrases."""

    source = "local"
    UNSAFE = ("idiot", "stupid", "kill yourself", "unsafe-test-marker")
    ATTACKS = ("ignore previous instructions", "ignore all previous", "reveal your system prompt")

    async def analyze(self, text: str) -> SafetyResult:
        lowered = text.casefold()
        hit = any(re.search(rf"\b{re.escape(w)}\b", lowered) for w in self.UNSAFE)
        severity = 4 if hit else 0
        return SafetyResult(
            allowed=severity < BLOCK_AT, categories={"Hate": severity}, source="local"
        )

    async def shield(self, user_prompt: str) -> ShieldResult:
        lowered = user_prompt.casefold()
        return ShieldResult(attack_detected=any(p in lowered for p in self.ATTACKS), source="local")


class AzureContentSafety:
    source = "azure"

    def __init__(
        self,
        endpoint: str,
        token_provider: Callable[[], str],
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._token = token_provider
        self._client = client or httpx.AsyncClient(timeout=3.0)

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        # the credential may call the identity endpoint; a hung chain must not hold the workflow
        token = await asyncio.wait_for(asyncio.to_thread(self._token), TOKEN_TIMEOUT)
        response = await self._client.post(
            f"{self._endpoint}/contentsafety/{path}",
            params={"api-version": API_VERSION},
            headers={"Authorization": f"Bearer {token}"},
            json=body,
        )
        response.raise_for_status()
        return response.json()

    async def analyze(self, text: str) -> SafetyResult:
        data = await self._post(
            "text:analyze",
            {"text": text, "categories": list(CATEGORIES), "outputType": "FourSeverityLevels"},
        )
        found = {row["category"]: int(row["severity"]) for row in data["categoriesAnalysis"]}
        if not found:
            raise ValueError("Content Safety answered with no categories")
        return SafetyResult(
            allowed=all(s < BLOCK_AT for s in found.values()), categories=found, source="azure"
        )

    async def shield(self, user_prompt: str) -> ShieldResult:
        data = await self._post("text:shieldPrompt", {"userPrompt": user_prompt, "documents": []})
        return ShieldResult(
            attack_detected=bool(data["userPromptAnalysis"]["attackDetected"]), source="azure"
        )


log = logging.getLogger(__name__)
ENDPOINT = re.compile(r"^https://[a-z0-9-]+\.cognitiveservices\.azure\.com/?$")
SCOPE = "https://cognitiveservices.azure.com/.default"
TOKEN_TIMEOUT = 3.0
WINDOW, DEGRADED_AT, WINDOW_S = 10, 5, 120.0  # 5 of the last 10 line screens in 2 min = degraded
OPEN_AFTER, OPEN_FOR = 3, 60.0  # consecutive failures, then seconds to skip Azure


class FallbackSafety:
    """Azure Content Safety first; the local screen when the Azure call fails (ADR-0014).

    A failure is logged and counted in ``fallbacks``; the result's ``source`` says ``local`` so the
    trace shows which screen decided. After ``OPEN_AFTER`` failures in a row the circuit opens and
    Azure is skipped for ``OPEN_FOR`` seconds, so an outage costs one timeout, not one per line.
    The local screen is a short word list: a degraded screen is **Simulated** strength."""

    source = "azure"

    def __init__(
        self,
        primary: SafetyScreen,
        fallback: SafetyScreen | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._primary = primary
        self._fallback = fallback or LocalSafetyScreen()
        self._clock = clock
        self._failures = 0
        self._open_until = 0.0
        self.fallbacks = 0
        self.last_error = ""
        self._recent: deque[tuple[float, bool]] = deque(maxlen=WINDOW)  # (when, local decided)

    @property
    def circuit_open(self) -> bool:
        return self._clock() < self._open_until

    @property
    def degraded(self) -> bool:
        """Azure is not really screening: circuit open, or half the recent screens fell back."""
        return self.circuit_open or self.recent_local >= DEGRADED_AT

    @property
    def recent_local(self) -> int:
        """Line screens in the last two minutes that the local word list decided; old ones expire,
        so an idle app recovers on its own. Prompt Shields calls are not counted."""
        now = self._clock()
        return sum(local for at, local in self._recent if now - at <= WINDOW_S)

    def _failed(self, what: str, error: Exception) -> None:
        self.fallbacks += 1
        self._failures += 1
        self.last_error = type(error).__name__
        if self._failures >= OPEN_AFTER:
            self._open_until = self._clock() + OPEN_FOR
        log.warning("%s failed (%s); using the local screen", what, self.last_error)

    async def analyze(self, text: str) -> SafetyResult:
        if not self.circuit_open:
            try:
                result = await self._primary.analyze(text)
                self._failures = 0
                self._recent.append((self._clock(), False))
                return result
            except Exception as error:  # noqa: BLE001 - transport, auth, quota or a bad body
                self._failed("Content Safety analyze", error)
        else:
            self.fallbacks += 1
        self._recent.append((self._clock(), True))
        return await self._fallback.analyze(text)

    async def shield(self, user_prompt: str) -> ShieldResult:
        if not self.circuit_open:
            try:
                result = await self._primary.shield(user_prompt)
                self._failures = 0
                return result
            except Exception as error:  # noqa: BLE001
                self._failed("Prompt Shields", error)
        else:
            self.fallbacks += 1
        return await self._fallback.shield(user_prompt)


def safety_from_env(env: Mapping[str, str] | None = None) -> SafetyScreen:
    """``CONTENT_SAFETY_ENDPOINT`` set and well formed: Azure with the local screen behind it.
    Otherwise the local screen alone. The endpoint must be a ``*.cognitiveservices.azure.com`` host,
    so a bad setting can never send the Azure token elsewhere."""
    env = os.environ if env is None else env
    endpoint = env.get("CONTENT_SAFETY_ENDPOINT", "").strip().lower()
    if not endpoint:
        return LocalSafetyScreen()
    if not ENDPOINT.match(endpoint):
        log.warning("CONTENT_SAFETY_ENDPOINT is not a cognitiveservices.azure.com host; ignored")
        return LocalSafetyScreen()

    def token() -> str:
        from matchcast_shared import azure_clients

        return azure_clients.credential().get_token(SCOPE).token

    return FallbackSafety(AzureContentSafety(endpoint, token))
