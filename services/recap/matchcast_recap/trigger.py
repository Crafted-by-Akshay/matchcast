"""The function holds no agent logic (03 F8): it spots full time and asks the api for the recap.

``POST /internal/v1/recaps`` is idempotent (the workflow skips personas that already have a recap),
so a replayed batch or two functions seeing the same event only repeat a cheap no-op. With extra
time configured (``RECAP_FINAL_PERIODS=2,4``) the end of period 2 writes a regulation-time recap,
because the function cannot know whether extra time follows; the end of the last period is sent
with ``final`` so the api writes the recap again and the full-time one replaces it.
"""

import json
import os
from collections.abc import Callable, Iterable
from typing import Any, NamedTuple

import httpx

ATTEMPTS = 3


class MatchKey(NamedTuple):
    tenant_id: str
    session_id: str
    match_id: str
    final: bool = False  # the last configured period ended after an earlier one: replace its recap


def final_periods() -> frozenset[int]:
    """Periods whose end is full time. 2 for a league match; add 4 for extra time, e.g. ``2,4``."""
    raw = os.environ.get("RECAP_FINAL_PERIODS", "2")
    return frozenset(int(p) for p in raw.split(",") if p.strip())


def full_time_matches(
    bodies: Iterable[str | bytes], periods: frozenset[int] | None = None
) -> list[MatchKey]:
    """Matches whose final period ended in this batch, once each, in first-seen order.

    Anything that is not a contract event (claims, lines, bad JSON) is ignored.
    """
    wanted = periods or final_periods()
    supersedes = len(wanted) > 1
    seen: dict[tuple[str, str, str], bool] = {}
    for body in bodies:
        try:
            event = json.loads(body)
            payload = event["payload"]
            if event["kind"] != "event" or payload["type"] != "period_boundary":
                continue
            if payload["boundary"] != "ended" or event["clock"]["period"] not in wanted:
                continue
            stream = event["stream"]
            key = (stream["tenant_id"], stream["session_id"], stream["match_id"])
            last = supersedes and event["clock"]["period"] == max(wanted)
        except (ValueError, KeyError, TypeError):
            continue
        seen[key] = seen.get(key, False) or last
    return [MatchKey(*key, final) for key, final in seen.items()]


class RecapClient:
    """Calls the api with the function's managed identity (token scope from ``RECAP_API_SCOPE``)."""

    def __init__(
        self,
        base_url: str,
        token: Callable[[], str] | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._http = httpx.Client(base_url=base_url, timeout=30, transport=transport)
        self._token = token

    def request_recap(self, match: MatchKey) -> dict[str, Any]:
        """202 on success. Retries a 5xx or a connection error; a 4xx is our bug and raises."""
        headers = {"Authorization": f"Bearer {self._token()}"} if self._token else {}
        last: Exception | None = None
        for _ in range(ATTEMPTS):
            try:
                response = self._http.post(
                    "/internal/v1/recaps", json=match._asdict(), headers=headers
                )
            except httpx.TransportError as error:
                last = error
                continue
            if response.status_code < 300:
                return response.json()
            if response.status_code < 500:
                response.raise_for_status()
            last = httpx.HTTPStatusError(
                f"api answered {response.status_code}", request=response.request, response=response
            )
        raise RuntimeError(f"recap for {match.match_id} failed after {ATTEMPTS} tries") from last
