"""Red-team set (eval/redteam.jsonl): 20 prompts, each tagged with the layer that must stop it.

`shield` and `safety` prompts run today against the offline screen. `ask` prompts need the
Ask router (AGT-16) and are checked by its golden-set gate; here we only assert the set stays
complete so none can be dropped quietly.
"""

import asyncio
import json
from collections import Counter
from pathlib import Path

from matchcast_agents.safety import LocalSafetyScreen

ROWS = [
    json.loads(line)
    for line in (Path(__file__).resolve().parent.parent / "eval" / "redteam.jsonl")
    .read_text()
    .splitlines()
]


def test_set_has_twenty_unique_prompts_across_layers():
    assert len(ROWS) == 20
    assert len({r["id"] for r in ROWS}) == 20
    assert len({r["prompt"] for r in ROWS}) == 20
    assert {r["layer"] for r in ROWS} == {"shield", "safety", "ask"}
    assert Counter(r["class"] for r in ROWS).keys() >= {
        "instruction override",
        "system prompt",
        "keys",
        "abuse",
        "real person",
        "sql",
        "write tool",
    }


def test_shield_and_safety_layers_stop_their_prompts():
    screen = LocalSafetyScreen()
    for row in ROWS:
        if row["layer"] == "shield":
            assert asyncio.run(screen.shield(row["prompt"])).attack_detected, row["id"]
        elif row["layer"] == "safety":
            assert not asyncio.run(screen.analyze(row["prompt"])).allowed, row["id"]
