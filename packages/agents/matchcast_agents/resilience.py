"""Timeouts, one retry on 429, a circuit breaker and the rules fallback (AGT-9, ADR-0014).

``ResilientAgent`` wraps a live agent and its rules twin behind the same async methods. A failed
live call runs the twin, so the workflow keeps publishing, and the reason is queued for the
workflow to audit as ``fallback_used``. Tool failures are not model failures and pass through.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .tools import ToolError

TIMEOUT_S = 20.0
BREAKER_FAILURES = 3
BREAKER_WINDOW_S = 60.0
HALF_OPEN_AFTER_S = 30.0
METHODS = ("decide", "analyse", "write", "check")


class ModelTimeout(Exception):
    pass


class ModelRateLimited(Exception):
    def __init__(self, retry_after_s: float = 1.0):
        self.retry_after_s = retry_after_s
        super().__init__(f"rate limited; retry after {retry_after_s}s")


class ModelError(Exception):
    """A 5xx, or output that failed structured-output validation."""


class CircuitBreaker:
    """Opens after 3 failures in 60 s; lets one call through after 30 s (half open)."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._failures: list[float] = []
        self._opened_at: float | None = None
        self._probing = False

    @property
    def state(self) -> str:
        if self._opened_at is None:
            return "closed"
        if self._clock() - self._opened_at >= HALF_OPEN_AFTER_S:
            return "half_open"
        return "open"

    def allow(self) -> bool:
        state = self.state
        if state == "closed":
            return True
        if state == "half_open" and not self._probing:
            self._probing = True
            return True
        return False

    def record_success(self) -> None:
        self._failures.clear()
        self._opened_at = None
        self._probing = False

    def record_failure(self) -> None:
        now = self._clock()
        self._probing = False
        self._failures = [t for t in self._failures if now - t < BREAKER_WINDOW_S] + [now]
        if self._opened_at is not None or len(self._failures) >= BREAKER_FAILURES:
            self._opened_at = now


class ResilientAgent:
    def __init__(
        self,
        live: Any,
        rules: Any,
        *,
        timeout_s: float = TIMEOUT_S,
        breaker: CircuitBreaker | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.live, self.rules = live, rules
        self.agent_id = rules.agent_id
        self.breaker = breaker or CircuitBreaker()
        self.last_mode = "live"
        self._timeout = timeout_s
        self._sleep = sleep
        self._fallbacks: list[str] = []

    @property
    def mode(self) -> str:
        return self.last_mode

    def take_fallbacks(self) -> list[str]:
        taken, self._fallbacks = self._fallbacks, []
        return taken

    async def _live_call(self, method: str, args: tuple, kwargs: dict) -> Any:
        call = getattr(self.live, method)
        for attempt in (0, 1):
            try:
                return await asyncio.wait_for(call(*args, **kwargs), self._timeout)
            except TimeoutError as error:
                raise ModelTimeout() from error
            except ModelRateLimited as error:
                if attempt == 1:
                    raise
                await self._sleep(error.retry_after_s)

    def _reason(self, error: Exception) -> str:
        if isinstance(error, ModelTimeout):
            return "timeout"
        if isinstance(error, ModelRateLimited):
            return "rate_limited"
        return "model_error"

    def __getattr__(self, name: str) -> Callable[..., Awaitable[Any]]:
        if name not in METHODS:
            raise AttributeError(name)

        async def run(*args: Any, **kwargs: Any) -> Any:
            if not self.breaker.allow():
                return await self._fallback(name, "circuit_open", args, kwargs)
            try:
                result = await self._live_call(name, args, kwargs)
            except ToolError:
                self.breaker.record_success()
                raise
            except Exception as error:  # noqa: BLE001  any model-side failure falls back
                self.breaker.record_failure()
                return await self._fallback(name, self._reason(error), args, kwargs)
            self.breaker.record_success()
            self.last_mode = "live"
            return result

        return run

    async def _fallback(self, method: str, reason: str, args: tuple, kwargs: dict) -> Any:
        self._fallbacks.append(reason)
        self.last_mode = "rules"
        return await getattr(self.rules, method)(*args, **kwargs)
