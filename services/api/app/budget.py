"""Cost guard: what anonymous callers can make the model spend (docs/architecture/14 §5).

The live app has no sign-in for viewers, so a loop of new matches or questions could spend the
Azure budget. Every model call goes through ``ModelBudget``: a daily cap per api replica, and the
``MATCHCAST_MODEL_OFF`` kill switch. A refused call raises ``ModelError``, so the agents answer with
their rules twins (ADR-0014) and the app keeps publishing; only model spend stops.
"""

import logging
import os
import time
from collections import deque
from collections.abc import Callable
from typing import Any

from matchcast_agents.resilience import ModelError

CALLS_PER_DAY = 4000  # about 25 live matches; a judged day uses a few
LIVE_MATCHES_PER_IP_HOUR = 10  # past it, one address's new matches run on the rules
MATCHES_PER_HOUR = 300  # every address together; past it, new matches are refused (memory too)
HOUR_S = 3600.0
DAY_S = 86400.0

log = logging.getLogger(__name__)


def model_off() -> bool:
    """MATCHCAST_MODEL_OFF=true: no model calls at all, for new or running matches."""
    return os.environ.get("MATCHCAST_MODEL_OFF", "").strip().lower() == "true"


def calls_per_day() -> int:
    """MATCHCAST_MODEL_CALLS_PER_DAY overrides the daily cap (0 keeps every match on the rules)."""
    try:
        return max(0, int(os.environ.get("MATCHCAST_MODEL_CALLS_PER_DAY", CALLS_PER_DAY)))
    except ValueError:
        return CALLS_PER_DAY


class ModelBudget:
    """Model calls per UTC day; ``take`` is False past the cap or with the kill switch on."""

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self.day = -1
        self.used = 0
        self._warned = False

    def take(self) -> bool:
        if model_off():
            return False
        day = int(self._clock() // DAY_S)
        if day != self.day:
            self.day, self.used, self._warned = day, 0, False
        if self.used >= calls_per_day():
            if not self._warned:
                self._warned = True
                log.warning(
                    "daily model budget used up; agents answer on the rules until 00:00 UTC"
                )
            return False
        self.used += 1
        return True

    def wrap(self, client: Any) -> "BudgetedModelClient":
        return BudgetedModelClient(client, self)


class BudgetedModelClient:
    """A model client that asks the budget before every call."""

    def __init__(self, inner: Any, budget: ModelBudget) -> None:
        self.inner = inner
        self.budget = budget

    async def complete(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        if not self.budget.take():
            raise ModelError("the model budget is used up or switched off")
        return await self.inner.complete(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:  # usage, deployment and the like
        return getattr(self.inner, name)


class HourlyWindows:
    """A rolling one-hour count per key, pruned as it goes."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._windows: dict[str, deque[float]] = {}

    def allow(self, key: str, limit: int) -> bool:
        now = self._clock()
        for stale in [k for k, w in self._windows.items() if not w or now - w[-1] >= HOUR_S]:
            del self._windows[stale]
        window = self._windows.setdefault(key, deque())
        while window and now - window[0] >= HOUR_S:
            window.popleft()
        if len(window) >= limit:
            return False
        window.append(now)
        return True
