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

# (key, label, environment variable that points at the Azure resource)
_RESOURCES = (
    ("speech", "Azure AI Speech", "SPEECH_ENDPOINT"),
    ("translator", "Azure AI Translator", "TRANSLATOR_ENDPOINT"),
    ("vision", "Azure AI Vision", "VISION_ENDPOINT"),
    ("content_safety", "Azure AI Content Safety", "CONTENT_SAFETY_ENDPOINT"),
    ("search", "Azure AI Search", "SEARCH_ENDPOINT"),
)


def _item(key: str, label: str, state: str, detail: str) -> dict[str, str]:
    return {"key": key, "label": label, "status": state, "detail": detail}


def dependency_status(env: Mapping[str, str], mode: str) -> dict[str, Any]:
    """The status document. ``mode`` is ``local`` or ``cloud`` (the settings mode)."""
    cloud = mode == "cloud"
    items: list[dict[str, str]] = []

    if env.get("MATCHCAST_AGENT_MODE") == "live" and env.get("FOUNDRY_PROJECT_ENDPOINT"):
        items.append(_item("agents", "Foundry agents", LIVE, "agents call the Foundry model"))
    else:
        items.append(_item("agents", "Foundry agents", SIMULATED, "rules agents, no model call"))

    if env.get("MATCHCAST_STORE") == "table":
        items.append(_item("store", "Table Storage", LIVE, "events and audit are in Table Storage"))
    else:
        items.append(_item("store", "Table Storage", SIMULATED, "process memory, lost on restart"))

    pipeline = env.get("MATCHCAST_PIPELINE", "direct")
    if pipeline == "eventhubs":
        items.append(_item("stream", "Event Hubs", LIVE, "events go through the hub"))
    else:
        items.append(_item("stream", "Event Hubs", SIMULATED, f"in-process stream ({pipeline})"))

    for key, label, variable in _RESOURCES:
        if env.get(variable):
            items.append(_item(key, label, LIVE, "resource configured"))
        elif cloud:
            items.append(_item(key, label, UNAVAILABLE, f"{variable} is not set"))
        else:
            items.append(_item(key, label, SIMULATED, "not connected in local mode"))

    if env.get("MATCHCAST_EASY_AUTH") == "1":
        items.append(_item("auth", "Entra sign-in", LIVE, "Easy Auth roles enforced"))
    else:
        items.append(_item("auth", "Entra sign-in", SIMULATED, "roles are simulated in the page"))

    for key, label in (("fabric", "Microsoft Fabric"), ("databricks", "Azure Databricks")):
        items.append(_item(key, label, PLANNED, "not connected yet"))

    counts = {
        state: sum(1 for i in items if i["status"] == state)
        for state in (LIVE, SIMULATED, PLANNED, UNAVAILABLE)
    }
    overall = UNAVAILABLE if counts[UNAVAILABLE] else (SIMULATED if counts[SIMULATED] else LIVE)
    if counts[PLANNED] and overall == LIVE:
        overall = PLANNED
    return {"mode": mode, "overall": overall, "counts": counts, "dependencies": items}
