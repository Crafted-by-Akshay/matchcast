"""Record one live ablation run of the crew scoreboard (CREW-5.2): the three arms on the model,
each with its own call budget. The scoreboard route shows the recorded run as precomputed arms.

    uv run python scripts/scoreboard_live.py \
        --match packages/agents/tests/fixtures/match-short.json --max-calls 300 \
        --out scoreboard-live.json
    MATCHCAST_SCOREBOARD_LIVE_RUN=scoreboard-live.json  (read by the api on each scoreboard request)

`--match` is a JSON file with `events`, `roster`, `names` and `teams`, the shape the api builds for
a match. The run sends at most 3 x --max-calls model calls (one budget per arm) and never more
than MAX_CALLS_CEILING per arm. Calls past a budget are refused and fall back to the rules, and the
record says how many. Needs FOUNDRY_PROJECT_ENDPOINT, FOUNDRY_MODEL_DEPLOYMENT and `az login`.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from matchcast_agents.grading import SEED_RATE
from matchcast_agents.grading_live import live_run
from matchcast_agents.live.client import FoundryModelClient

MAX_CALLS_CEILING = 1000  # per arm; a run above this is refused, whatever the flag says


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--match", type=Path, required=True)
    parser.add_argument("--max-calls", type=int, required=True, help="model calls per arm")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--rate", type=float, default=SEED_RATE)
    parser.add_argument("--run-date", default=None, help="YYYY-MM-DD; default today")
    args = parser.parse_args(argv)
    if not 1 <= args.max_calls <= MAX_CALLS_CEILING:
        print(f"--max-calls must be between 1 and {MAX_CALLS_CEILING}", file=sys.stderr)
        return 2
    match = json.loads(args.match.read_text())
    print(f"three arms, up to {args.max_calls} model calls each", file=sys.stderr)
    record = live_run(
        match,
        client=FoundryModelClient(),
        max_calls=args.max_calls,
        seed=args.seed,
        rate=args.rate,
        run_date=args.run_date,
    )
    args.out.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    for key, arm in record["arms"].items():
        cost = arm["cost"]
        print(
            f"{key}: {arm['lines_aired']} lines, {arm['wrong_lines_aired']} wrong, "
            f"{cost['model_calls']} calls sent, {cost['model_errors']} failed, "
            f"{cost['budget_refused']} refused",
            file=sys.stderr,
        )
    print(f"run {record['run_id']} written to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
