"""Per-dependency status for the status pill and the status page (``GET /v1/status``).

Each dependency is ``live`` (configured and used), ``simulated`` (a local stand-in runs and the UI
says so), ``planned`` (not built yet) or ``unavailable`` (it should be live in this deployment but
is not configured). Nothing here calls Azure: the states come from the settings the process was
started with, so the route is cheap, never 503, and safe to poll. ``/ready`` stays the probe for
orchestrators and keeps its own shape.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

LIVE, SIMULATED, PLANNED, UNAVAILABLE = "live", "simulated", "planned", "unavailable"


_BAD = {
    "speech": "SPEECH_ENDPOINT or SPEECH_REGION is malformed",
    "search": "SEARCH_ENDPOINT is not a search host or SEARCH_QUERY_KEY is missing",
}


def _speech_ok(env: Mapping[str, str]) -> bool:
    from app.speech import SpeechTokenService

    return SpeechTokenService(env.get("SPEECH_ENDPOINT", ""), env.get("SPEECH_REGION", "")).ready


def _safety_ok(env: Mapping[str, str]) -> bool:
    from matchcast_agents.safety import ENDPOINT

    return bool(ENDPOINT.match(env.get("CONTENT_SAFETY_ENDPOINT", "").strip().lower()))


def _search_ok(env: Mapping[str, str]) -> bool:
    from matchcast_agents.ask.azure_search import ENDPOINT

    return bool(ENDPOINT.match(env.get("SEARCH_ENDPOINT", "").strip().lower())) and bool(
        env.get("SEARCH_QUERY_KEY")
    )


def _vision_ok(env: Mapping[str, str]) -> bool:
    from app.vision import check_endpoint

    try:
        check_endpoint(env.get("VISION_ENDPOINT", "").strip())
    except ValueError:
        return False
    return True


def _item(key: str, label: str, state: str, detail: str) -> dict[str, str]:
    return {"key": key, "label": label, "status": state, "detail": detail}


def dependency_status(
    env: Mapping[str, str],
    mode: str,
    safety: object | None = None,
    search_fallbacks: int = 0,
) -> dict[str, Any]:
    """The status document. ``mode`` is ``local`` or ``cloud`` (the settings mode)."""
    cloud = mode == "cloud"
    items: list[dict[str, str]] = []

    if env.get("MATCHCAST_AGENT_MODE") == "live" and env.get("FOUNDRY_PROJECT_ENDPOINT"):
        items.append(
            _item(
                "agents",
                "Foundry agents",
                LIVE,
                "configured; rules take over if a model call fails",
            )
        )
    else:
        items.append(_item("agents", "Foundry agents", SIMULATED, "rules agents, no model call"))

    from matchcast_agents.statsdesk import A2A_URL

    if A2A_URL.match(env.get("STATS_DESK_URL", "").strip()):
        items.append(_item("stats_desk", "Stats Desk (A2A)", LIVE, "STATS_DESK_URL is configured"))
    else:
        items.append(
            _item("stats_desk", "Stats Desk (A2A)", SIMULATED, "same skill, called in the api")
        )

    if env.get("MATCHCAST_STORE") == "table":
        items.append(_item("store", "Table Storage", LIVE, "events and audit are in Table Storage"))
    else:
        items.append(_item("store", "Table Storage", SIMULATED, "process memory, lost on restart"))

    pipeline = env.get("MATCHCAST_PIPELINE", "direct")
    if pipeline == "eventhubs":
        items.append(_item("stream", "Event Hubs", LIVE, "events go through the hub"))
    else:
        items.append(_item("stream", "Event Hubs", SIMULATED, f"in-process stream ({pipeline})"))

    resources = (
        ("speech", "Azure AI Speech", "SPEECH_ENDPOINT", _speech_ok),
        ("translator", "Azure AI Translator", "TRANSLATOR_ENDPOINT", lambda e: True),
        ("vision", "Azure AI Vision", "VISION_ENDPOINT", _vision_ok),
        ("content_safety", "Azure AI Content Safety", "CONTENT_SAFETY_ENDPOINT", _safety_ok),
        ("search", "Azure AI Search", "SEARCH_ENDPOINT", _search_ok),
    )
    for key, label, variable, valid in resources:
        if not env.get(variable):
            state, detail = (
                (UNAVAILABLE, f"{variable} is not set")
                if cloud
                else (
                    SIMULATED,
                    "not connected in local mode",
                )
            )
        elif not valid(env):
            state, detail = UNAVAILABLE, _BAD.get(key, f"{variable} is malformed")
        else:
            state, detail = LIVE, "resource configured"
            if key == "search" and search_fallbacks:
                detail = f"{search_fallbacks} answers used the local index after a search problem"
            if key == "content_safety" and getattr(safety, "fallbacks", 0):
                detail = f"{safety.fallbacks} lines screened locally after a failed call"  # type: ignore[attr-defined]
                if getattr(safety, "degraded", False):
                    state = UNAVAILABLE
        items.append(_item(key, label, state, detail))

    if env.get("MATCHCAST_EASY_AUTH") == "1" and env.get("MATCHCAST_REQUIRE_ROLE") == "1":
        items.append(_item("auth", "Entra sign-in", LIVE, "Easy Auth roles enforced"))
    else:
        items.append(_item("auth", "Entra sign-in", SIMULATED, "roles are simulated in the page"))

    for key, label in (("fabric", "Microsoft Fabric"), ("databricks", "Azure Databricks")):
        items.append(_item(key, label, PLANNED, "not connected yet"))

    counts = {
        state: sum(1 for i in items if i["status"] == state)
        for state in (LIVE, SIMULATED, PLANNED, UNAVAILABLE)
    }
    # Planned items are not built, so they do not decide the overall state of what is built.
    overall = UNAVAILABLE if counts[UNAVAILABLE] else (SIMULATED if counts[SIMULATED] else LIVE)
    return {"mode": mode, "overall": overall, "counts": counts, "dependencies": items}
