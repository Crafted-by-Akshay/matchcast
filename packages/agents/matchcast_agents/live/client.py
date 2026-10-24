"""The model client behind the live agents: structured JSON out, Entra ID auth, no API key.

``FoundryModelClient`` talks to the gpt-6-luna deployment through the Azure OpenAI client with a
bearer-token provider. Failures are mapped to the exceptions ``ResilientAgent`` understands, so a
slow, throttled or malformed answer falls back to the rules twin. ``ScriptedModelClient`` replays
recorded answers for tests and for running without quota.
"""

import asyncio
import json
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from ..resilience import ModelError, ModelRateLimited, ModelTimeout

PROMPTS = Path(__file__).resolve().parents[2] / "prompts"
COGNITIVE_SCOPE = "https://cognitiveservices.azure.com/.default"
API_VERSION = "2025-04-01-preview"


def prompt(name: str) -> str:
    """The prompt file for an agent, without its version line."""
    text = (PROMPTS / f"{name}.md").read_text(encoding="utf-8")
    return "\n".join(line for line in text.splitlines() if not line.startswith("version:")).strip()


REASONING_HEADROOM = 1500  # completion tokens on top of the answer, spent on reasoning first


class ModelClient(Protocol):
    async def complete(
        self,
        system: str,
        user: str,
        schema: dict[str, Any],
        *,
        temperature: float = 0.1,
        max_tokens: int = 400,
    ) -> dict[str, Any]:
        """One call that must return JSON matching ``schema`` (already parsed)."""
        ...


@dataclass
class Usage:
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0


class FoundryModelClient:
    """Azure OpenAI chat completions with a JSON-schema response format."""

    def __init__(
        self,
        endpoint: str | None = None,
        deployment: str | None = None,
        *,
        client: Any = None,
    ) -> None:
        self.deployment = deployment or os.environ.get("FOUNDRY_MODEL_DEPLOYMENT", "gpt-6-luna")
        self.usage = Usage()
        self._endpoint = endpoint or os.environ.get("FOUNDRY_PROJECT_ENDPOINT", "")
        self._injected = client is not None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._client = client or self._build(self._endpoint)

    @staticmethod
    def _build(endpoint: str) -> Any:
        from azure.identity import get_bearer_token_provider
        from matchcast_shared.azure_clients import credential
        from openai import AsyncAzureOpenAI

        return AsyncAzureOpenAI(
            azure_endpoint=endpoint.split("/api/projects")[0],
            api_version=API_VERSION,
            azure_ad_token_provider=get_bearer_token_provider(credential(), COGNITIVE_SCOPE),
            timeout=25.0,
            max_retries=1,
        )

    async def complete(
        self,
        system: str,
        user: str,
        schema: dict[str, Any],
        *,
        temperature: float = 0.1,  # kept for callers; reasoning models take only the default
        max_tokens: int = 400,
    ) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        if not self._injected and self._loop is not loop:
            # an async HTTP client is tied to the loop it first ran on; the eval harness calls
            # asyncio.run many times, and a stale client would fail and hide behind the fallback
            if self._loop is not None:
                self._client = self._build(self._endpoint)
            self._loop = loop
        try:
            response = await self._client.chat.completions.create(
                model=self.deployment,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                # Reasoning models (gpt-5-mini) reject max_tokens and any non-default temperature,
                # and count their hidden reasoning against the completion budget.
                max_completion_tokens=max_tokens + REASONING_HEADROOM,
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": "answer", "schema": schema, "strict": True},
                },
            )
        except Exception as error:  # noqa: BLE001 - mapped to the resilience vocabulary
            raise _map(error) from error
        self.usage.calls += 1
        if response.usage:
            self.usage.prompt_tokens += response.usage.prompt_tokens
            self.usage.completion_tokens += response.usage.completion_tokens
        try:
            data = json.loads(response.choices[0].message.content)
        except (ValueError, TypeError, IndexError, AttributeError) as error:
            raise ModelError("the model did not return JSON") from error
        if not isinstance(data, dict):
            raise ModelError("the model returned JSON that is not an object")
        return data


def _map(error: Exception) -> Exception:
    name = type(error).__name__
    if name == "RateLimitError":
        retry = getattr(getattr(error, "response", None), "headers", {}).get("retry-after", "1")
        try:
            return ModelRateLimited(float(retry))
        except ValueError:
            return ModelRateLimited()
    if name in ("APITimeoutError", "TimeoutError"):
        return ModelTimeout()
    return ModelError(f"{name}: {error}")


@dataclass
class ScriptedModelClient:
    """Replays answers in order (or from a function); each answer may be an Exception to raise."""

    answers: list[Any] | Callable[[str, str], Any] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def complete(
        self,
        system: str,
        user: str,
        schema: dict[str, Any],
        *,
        temperature: float = 0.1,
        max_tokens: int = 400,
    ) -> dict[str, Any]:
        self.calls.append({"system": system, "user": user, "schema": schema})
        answer = self.answers(system, user) if callable(self.answers) else self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer
