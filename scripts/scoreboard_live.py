"""Record one live ablation run of the crew scoreboard (CREW-5.2): the three arms on the model,
each with its own call budget. The scoreboard route shows the recorded run beside the rules arms.

    uv run python scripts/scoreboard_live.py \
        --api <api base URL> --session-id <session> --match-id <match> \
        --fixture <fixture id, e.g. M001> --max-calls 300 --out scoreboard-live.json
    uv run python scripts/scoreboard_live.py --match <match.json> \
        --fixture <fixture id, e.g. M001> --max-calls 300 --out scoreboard-live.json
    MATCHCAST_SCOREBOARD_LIVE_RUN=scoreboard-live.json  (read by the api on each scoreboard request)

Either export the match from the api (`--api`, `--session-id`, `--match-id`, read-only) or read
a saved export (`--match`, a JSON file with `events`, `roster`, `names` and `teams`, the shape the
api builds for a match). Each arm has its own budget of --max-calls model calls, one per
complete() call (the SDK may retry one request inside a call). Calls past a budget are refused and
fall back to the rules. The record says how many were sent, failed or refused, and how many agent
calls a fallback answered. Needs FOUNDRY_PROJECT_ENDPOINT, FOUNDRY_MODEL_DEPLOYMENT and `az login`.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

from matchcast_agents.grading import SEED_RATE
from matchcast_agents.grading_live import MAX_CALLS_PER_ARM, live_run
from matchcast_agents.live.client import FoundryModelClient


def fetch_input(api: str, session_id: str, match_id: str) -> dict:
    """The stored match of a live session, from the scoreboard input export. The route makes no
    model call; its cold read writes the match record once, as the other match routes do."""
    if match_id in ("", ".", ".."):  # a dot segment would climb out of the match route
        raise ValueError(f"not a match id: {match_id!r}")
    query = urllib.parse.urlencode({"session_id": session_id})
    path = f"/v1/matches/{urllib.parse.quote(match_id, safe='')}/scoreboard/input?{query}"
    with urllib.request.urlopen(api.rstrip("/") + path, timeout=30) as response:
        match = json.loads(response.read())
    if not isinstance(match, dict):
        raise ValueError("the export is not a match object")
    return match


MATCH_KEYS = ("events", "teams", "roster", "names")  # what live_run and the grader read


def _iso_date(text: str) -> str:
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"not a YYYY-MM-DD date: {text!r}") from error


def _writable(out: Path) -> bool:
    """Can the record be written to ``out`` now, so a paid run is not lost at the write?"""
    if out.is_symlink() or out.is_dir():
        return False
    if out.exists():
        return os.access(out, os.W_OK)
    return out.parent.is_dir() and os.access(out.parent, os.W_OK | os.X_OK)


def match_problem(match: object) -> str | None:
    """Why this is not a match the recording can run on, or None when it is."""
    if not isinstance(match, dict):
        return "not a match object"
    missing = [key for key in MATCH_KEYS if key not in match]
    if missing:
        return f"missing {', '.join(missing)}"
    stream = match["roster"].get("stream") if isinstance(match["roster"], dict) else None
    if not isinstance(stream, dict) or "match_id" not in stream:
        return "the roster has no stream with a match_id"
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--match", type=Path, help="the export file, if already saved")
    parser.add_argument("--api", help="the api base URL, to export the match instead of --match")
    parser.add_argument("--session-id", help="the live session the match is in (with --api)")
    parser.add_argument("--match-id", help="the match id in that session (with --api)")
    parser.add_argument(
        "--fixture", required=True, help="the fixture id the match is, e.g. M001 or N001"
    )
    parser.add_argument("--max-calls", type=int, required=True, help="model calls per arm")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--rate", type=float, default=SEED_RATE)
    parser.add_argument(
        "--run-date", type=_iso_date, default=None, help="YYYY-MM-DD; default today"
    )
    args = parser.parse_args(argv)
    if not 1 <= args.max_calls <= MAX_CALLS_PER_ARM:
        print(f"--max-calls must be between 1 and {MAX_CALLS_PER_ARM}", file=sys.stderr)
        return 2
    from_api = bool(args.api and args.session_id and args.match_id)
    if args.match is not None and (args.api or args.session_id or args.match_id):
        print("give --match alone, or --api with --session-id and --match-id", file=sys.stderr)
        return 2
    if args.match is not None:
        try:
            match = json.loads(args.match.read_text())
        except (OSError, ValueError, RecursionError) as error:
            print(f"could not read {args.match}: {error}", file=sys.stderr)
            return 1
    elif from_api:
        try:
            match = fetch_input(args.api, args.session_id, args.match_id)
        except (OSError, http.client.HTTPException, ValueError, RecursionError) as error:
            print(f"could not export the match from {args.api}: {error}", file=sys.stderr)
            return 1
    else:
        print("give --match, or all of --api, --session-id and --match-id", file=sys.stderr)
        return 2
    if problem := match_problem(match):
        print(f"{args.match or args.api}: {problem}", file=sys.stderr)
        return 1
    if not _writable(args.out):
        print(
            f"--out {args.out} must be a plain file path in a folder that can be written",
            file=sys.stderr,
        )
        return 2
    if not os.environ.get("FOUNDRY_PROJECT_ENDPOINT"):
        print("FOUNDRY_PROJECT_ENDPOINT is not set; the calls would all fail", file=sys.stderr)
        return 2
    print(f"three arms, up to {args.max_calls} model calls each", file=sys.stderr)
    record = live_run(
        match,
        client=FoundryModelClient(),
        max_calls=args.max_calls,
        fixture=args.fixture,
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
