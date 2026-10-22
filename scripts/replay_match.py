"""Replay a recorded match as contract events at 1x or 4x (DAT-1).

    uv run python scripts/replay_match.py --match M001 --speed 4 --sink jsonl --out events.jsonl
    uv run python scripts/replay_match.py --events path/to/events.json --speed 4 --sink http \
        --url http://localhost:8000 --session-id demo-replay

`--match` reads a season match from apps/unified/sources/enterprise-console/data; `--events` takes a
JSON file holding `{"events": [...]}` or a list. Events are converted to contract v1.1,
validated, and sent in order, each at its match time divided by the speed (a 90-minute match at
4x takes 22.5 minutes). Sinks: `jsonl` (a file or stdout), `http` (the api's
POST /v1/matches/{id}/events, batches of up to 50). An Event Hubs sink goes behind the same
function once the namespace exists.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

from matchcast_contracts import ContractError, validate
from matchcast_worker.convert import roster_packet, slug, to_contract_events

ROOT = Path(__file__).resolve().parent.parent
SEASON = ROOT / "apps" / "unified" / "sources" / "enterprise-console" / "data"


def load(args: argparse.Namespace) -> tuple[list[dict], dict, list[str], str]:
    if args.match:
        d = json.loads((SEASON / f"{args.match}.json").read_text())
        teams = [d["home"], d["away"]]
        players = [(n, r["team"]) for n, r in d["roster"].items()]
        return d["events"], {"players": players}, teams, args.match
    raw = json.loads(Path(args.events).read_text())
    events = raw["events"] if isinstance(raw, dict) else raw
    teams = sorted({e["team"] for e in events if e.get("team")})
    players = sorted(
        {(e["player"], e["team"]) for e in events if e.get("player") and e.get("team")}
    )
    return events, {"players": players}, teams, Path(args.events).stem


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--match", help="season match id, for example M001")
    src.add_argument("--events", help="JSON file of engine events")
    ap.add_argument("--speed", type=float, default=1.0, help="1 or 4 (any positive number works)")
    ap.add_argument("--sink", choices=("jsonl", "http"), default="jsonl")
    ap.add_argument("--out", default="-", help="jsonl sink: file path or - for stdout")
    ap.add_argument("--url", default="http://localhost:8000", help="http sink: api base URL")
    ap.add_argument("--session-id", default="replay")
    ap.add_argument("--tenant-id", default="demo")
    ap.add_argument("--no-wait", action="store_true", help="skip the pacing (tests)")
    a = ap.parse_args()

    events, meta, teams, match_id = load(a)
    stream = {
        "tenant_id": a.tenant_id,
        "session_id": a.session_id,
        "match_id": f"m-{slug(match_id)}",
    }
    roster = roster_packet(stream, meta["players"], teams)
    out = sys.stdout if a.out == "-" else open(a.out, "w")  # noqa: SIM115 closed at exit
    batch: list[dict] = []

    def flush() -> None:
        if not batch:
            return
        if a.sink == "http":
            q = f"?session_id={a.session_id}"
            req = urllib.request.Request(
                f"{a.url}/v1/matches/{stream['match_id']}/events{q}",
                data=json.dumps({"events": batch}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req).read()  # noqa: S310 operator-supplied URL
        batch.clear()

    start = time.monotonic()
    sent = 0
    for e in to_contract_events(events, stream, teams):
        try:
            validate(e, roster=roster)
        except ContractError as err:
            print(f"skipped {e['event_id']}: {err}", file=sys.stderr)
            continue
        if not a.no_wait:
            due = start + e["event_time_ms"] / 1000 / a.speed
            flush()
            time.sleep(max(0.0, due - time.monotonic()))
        if a.sink == "jsonl":
            out.write(json.dumps(e) + "\n")
        else:
            batch.append(e)
            if len(batch) >= 50:
                flush()
        sent += 1
    flush()
    if out is not sys.stdout:
        out.close()
    print(f"replayed {sent} events of {match_id} at {a.speed}x", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
