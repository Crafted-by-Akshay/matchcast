"""QUA-4: the frozen set of 30 moments, drawn from the recorded season, for the A/B harness.

    uv run --all-packages python eval/frozen.py            # check the file still matches the season
    uv run --all-packages python eval/frozen.py --write    # re-draw, rewrite frozen-moments.json

A moment is a shot or goal in one of the 28 season matches (converted to contract events the same
way scripts/replay_match.py does). The draw is seeded and capped per match, so it covers many
matches, scorelines and minutes; `frozen-moments.json` holds each moment with its true score,
shots and shots on target. A test fails when the season data or the converter changes the draw.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any

from matchcast_worker.convert import roster_packet, slug, to_contract_events

ROOT = Path(__file__).resolve().parent.parent
SEASON = ROOT / "apps" / "unified" / "sources" / "enterprise-console" / "data"
FROZEN = Path(__file__).resolve().parent / "frozen-moments.json"
SEED, GOALS, SHOTS, PER_MATCH = 30, 10, 20, 3


def season_ids() -> list[str]:
    return sorted(p.stem for p in SEASON.glob("M[0-9][0-9][0-9].json"))


def load_season_match(match_id: str) -> dict[str, Any]:
    """A season match as the harness's match dict: teams, names, roster and contract events."""
    raw = json.loads((SEASON / f"{match_id}.json").read_text())
    clubs = {c["key"]: c["club"] for c in json.loads((SEASON / "league.json").read_text())["clubs"]}
    teams = [raw["home"], raw["away"]]
    stream = {"tenant_id": "eval", "session_id": "frozen", "match_id": f"m-{slug(match_id)}"}
    players = [(n, r["team"]) for n, r in raw["roster"].items()]
    return {
        "id": match_id,
        "teams": {slug(t): clubs.get(t, t) for t in teams},
        "names": {slug(n): n for n, _ in players},
        "roster": roster_packet(stream, players, teams),
        "events": list(to_contract_events(raw["events"], stream, teams)),
    }


def draw(moments_of: Any) -> list[dict[str, Any]]:
    """Seeded draw of GOALS goals and SHOTS shots, at most PER_MATCH from one match."""
    rng = random.Random(SEED)
    pool: dict[str, list[dict[str, Any]]] = {"goal": [], "shot": []}
    for mid in season_ids():
        for m in moments_of(load_season_match(mid)):
            pool[m["type"]].append({"match": mid, **m})
    taken: dict[str, int] = {}
    out: list[dict[str, Any]] = []
    for kind, want in (("goal", GOALS), ("shot", SHOTS)):
        rng.shuffle(pool[kind])
        got = 0
        for m in pool[kind]:
            if got == want:
                break
            if taken.get(m["match"], 0) >= PER_MATCH:
                continue
            taken[m["match"]] = taken.get(m["match"], 0) + 1
            out.append(m)
            got += 1
    return sorted(out, key=lambda m: (m["match"], int(m["event_id"][1:])))


def frozen() -> list[dict[str, Any]]:
    return json.loads(FROZEN.read_text())


def main() -> int:
    import importlib.util

    spec = importlib.util.spec_from_file_location("compare", Path(__file__).with_name("compare.py"))
    cmp = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("compare", cmp)
    spec.loader.exec_module(cmp)
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    now = draw(cmp.moments)
    if ap.parse_args().write:
        FROZEN.write_text(json.dumps(now, indent=1) + "\n")
        print(f"wrote {len(now)} moments from {len({m['match'] for m in now})} matches")
        return 0
    if now != frozen():
        print("frozen-moments.json is stale: run with --write and review the diff", file=sys.stderr)
        return 1
    print(f"{len(now)} frozen moments match the season")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
