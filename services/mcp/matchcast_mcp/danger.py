"""predict_danger: a ranking score for "the event's team shoots within 10 s" (DAT-6).

The model (data/models/danger/v1) was trained on simulator scenes, whose events carry fields the
event contract does not (xg, difficulty, phase, kind, stamina). A live contract event has only its
type, team and position, so every other numeric field is filled with the card's `missing_value`
and the phase and kind one-hots stay empty, exactly as the training rows did for events without
them. The score orders moments; it is not a probability (the card shows it is overconfident at
the top end), and it describes the simulator, not real football.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

WINDOW_MS = 10_000
# contract event types -> the model's `type=` one-hots; the rest leave every type flag at 0
TYPE_MAP = {
    "pass": "pass",
    "shot": "shot",
    "goal": "goal",
    "foul": "foul",
    "corner": "corner",
    "freekick": "freekick",
    "free_kick": "freekick",
    "throw_in": "throw_in",
    "possession_change": "turnover",
}
SCENE_COUNTED = ("pass", "turnover", "shot")


class DangerUnavailable(RuntimeError):
    """The model or onnxruntime is not available in this process."""


def model_dir() -> Path:
    env = os.environ.get("MATCHCAST_DANGER_MODEL")
    return Path(env) if env else Path(__file__).resolve().parents[3] / "data/models/danger/v1"


@lru_cache(maxsize=2)
def _load(path: str) -> tuple[Any, dict[str, Any]]:
    try:
        import numpy  # noqa: F401
        import onnxruntime as ort
    except ImportError as error:  # pragma: no cover - depends on the image
        raise DangerUnavailable("onnxruntime or numpy is not installed") from error
    folder = Path(path)
    try:
        card = json.loads((folder / "model-card.json").read_text())
        for key in ("features", "missing_value", "name", "version", "metrics", "limits"):
            card[key]
        session = ort.InferenceSession(
            str(folder / "model.onnx"), providers=["CPUExecutionProvider"]
        )
    except Exception as error:  # noqa: BLE001 - onnxruntime's errors are not OSError or ValueError
        raise DangerUnavailable(f"danger model not usable in {folder.name}") from error
    return session, card


def event_team(event: dict[str, Any]) -> str | None:
    """The team the score is about: the actor, or for a possession change the team that won it."""
    payload = event["payload"]
    return payload.get("team_id") or payload.get("to_team_id")


def _model_type(event: dict[str, Any]) -> str | None:
    return TYPE_MAP.get(event["payload"]["type"])


def features(
    event: dict[str, Any], earlier: list[dict[str, Any]], card: dict[str, Any]
) -> tuple[list[float], list[str]]:
    """The model's input row for one event and the events before it; also the fields left unset."""
    names: list[str] = card["features"]
    if _model_type(event) is None:
        raise ValueError(f"no danger score for a {event['payload']['type']} event")
    missing_value = float(card["missing_value"])
    row = dict.fromkeys(names, 0.0)
    unset: list[str] = []
    payload = event["payload"]
    position = payload.get("position") or {}
    numeric = ("dist_m", "quality", "difficulty", "xg", "x", "y", "own_x", "stamina")
    values = {"x": position.get("x"), "y": position.get("y")}
    for name in numeric:
        value = values.get(name)
        row[name] = missing_value if value is None else float(value)
        if value is None:
            unset.append(name)
    now = event["event_time_ms"]
    counts = dict.fromkeys(SCENE_COUNTED, 0)
    for prior in earlier:
        if now - WINDOW_MS <= prior["event_time_ms"] < now:
            kind = _model_type(prior)
            if kind in counts:  # corrections and retractions have no model type, so never count
                counts[kind] += 1
    row["passes_prev_10s"] = float(counts["pass"])
    row["turnovers_prev_10s"] = float(counts["turnover"])
    row["shots_prev_10s"] = float(counts["shot"])
    kind = _model_type(event)
    if kind and f"type={kind}" in row:
        row[f"type={kind}"] = 1.0
    for empty in ("phase=", "kind="):  # contract events carry neither
        if empty in row:
            row[empty] = 1.0
    unset += ["phase", "kind"]
    return [row[n] for n in names], unset


def predict(event: dict[str, Any], earlier: list[dict[str, Any]]) -> dict[str, Any]:
    import numpy as np

    session, card = _load(str(model_dir()))
    vector, unset = features(event, earlier, card)
    outputs = session.run(None, {"X": np.array([vector], dtype=np.float32)})
    score = float(outputs[1][0][1])
    return {
        "event_id": event["event_id"],
        "stream_sequence": event["stream_sequence"],
        "score": round(score, 4),
        "meaning": "ranking score for a same-team shot within 10 s; not a probability",
        "model": {"name": card["name"], "version": card["version"], "auc": card["metrics"]["auc"]},
        "team_id": event_team(event),
        "unset_inputs": unset,
        "caution": (
            "the live event lacks xg, phase, kind and stamina, so the held-out AUC (measured with "
            "them) does not carry over, and high scores were overconfident in the model card"
        ),
        "limits": card["limits"],
    }
