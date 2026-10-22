"""Content Safety screening (check 7) and Prompt Shields, with a local screen for rules mode.

``AzureContentSafety`` calls the REST API with a bearer token from ``token_provider`` (managed
identity in Azure); it never sees keys. ``LocalSafetyScreen`` is deterministic and offline so tests
and the rules-mode demo behave the same everywhere. A block is any category severity >= 2.
"""

import re
from collections.abc import Callable
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
        self._client = client or httpx.AsyncClient(timeout=5.0)

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = await self._client.post(
            f"{self._endpoint}/contentsafety/{path}",
            params={"api-version": API_VERSION},
            headers={"Authorization": f"Bearer {self._token()}"},
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
        return SafetyResult(
            allowed=all(s < BLOCK_AT for s in found.values()), categories=found, source="azure"
        )

    async def shield(self, user_prompt: str) -> ShieldResult:
        data = await self._post("text:shieldPrompt", {"userPrompt": user_prompt, "documents": []})
        return ShieldResult(
            attack_detected=bool(data["userPromptAnalysis"]["attackDetected"]), source="azure"
        )
