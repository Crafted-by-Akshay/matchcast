"""Replay a recorded match as contract events at 1x or 4x (DAT-1).

    uv run python scripts/replay_match.py --match M001 --speed 4 --sink jsonl --out events.jsonl
    uv run python scripts/replay_match.py --events path/to/events.json --speed 4 --sink http \
        --url http://localhost:8000 --session-id demo-replay

`--match` reads a season match from apps/unified/sources/enterprise-console/data; `--events` takes a
JSON file holding `{"events": [...]}` or a list. Events are converted to contract v1.1,
validated, and sent in order, each at its match time divided by the speed (a 90-minute match at
4x takes 22.5 minutes). Sinks: `jsonl` (a file or stdout), `http` (the api's
POST /v1/matches/{id}/events, batches of up to 50), `eventhub` (scripts/replay_sinks/eventhub.py:
creates the match over HTTP at --url, then publishes to the hub; needs EVENTHUB_FQDN and an Entra
login).
"""

from __future__ import annotations

import argparse
import atexit
import json
import sys
import time
import urllib.error
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--match", help="season match id, for example M001")
    src.add_argument("--events", help="JSON file of engine events")
    ap.add_argument("--speed", type=float, default=1.0, help="1 or 4 (any positive number works)")
    ap.add_argument("--sink", choices=("jsonl", "http", "eventhub"), default="jsonl")
    ap.add_argument("--out", default="-", help="jsonl sink: file path or - for stdout")
    ap.add_argument("--url", default="http://localhost:8000", help="http sink: api base URL")
    ap.add_argument("--session-id", default="replay")
    ap.add_argument("--tenant-id", default="demo")
    ap.add_argument("--no-wait", action="store_true", help="skip the pacing (tests)")
    a = ap.parse_args(argv)
    if a.speed <= 0:
        ap.error("--speed must be above 0")

    events, meta, teams, match_id = load(a)
    stream = {
        "tenant_id": a.tenant_id,
        "session_id": a.session_id,
        "match_id": f"m-{slug(match_id)}",
    }
    roster = roster_packet(stream, meta["players"], teams)
    out = sys.stdout if a.out == "-" else open(a.out, "w")  # noqa: SIM115 closed at exit
    batch: list[dict] = []

    def post(path: str, body: dict, ok: tuple[int, ...] = ()) -> None:
        req = urllib.request.Request(
            f"{a.url}{path}",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req).read()  # noqa: S310 operator-supplied URL
        except urllib.error.HTTPError as err:
            if err.code not in ok:
                detail = err.read()[:200]
                raise SystemExit(f"api answered {err.code} for {path}: {detail!r}") from err

    sk = "|".join((stream["tenant_id"], stream["session_id"], stream["match_id"]))
    hub = None
    if a.sink == "eventhub":
        from replay_sinks.eventhub import from_env

        hub = from_env()
        atexit.register(hub.close)

    def flush() -> None:
        if batch and a.sink == "http":
            post(f"/v1/matches/{stream['match_id']}/events?session_id={a.session_id}",
                 {"events": batch})  # fmt: skip
        elif batch and hub is not None:
            hub.send(sk, list(batch))
        batch.clear()

    if a.sink in ("http", "eventhub"):
        # a match must exist before events are posted; 409 means a previous run created it
        post("/v1/matches", {"session_id": a.session_id, "match_id": stream["match_id"],
                             "roster": roster}, ok=(409,))  # fmt: skip

    events_out = list(to_contract_events(events, stream, teams))
    start = time.monotonic()
    sent = 0
    for n, e in enumerate(events_out):
        try:
            validate(e, roster=roster)
        except ContractError as err:
            print(f"skipped {e['event_id']}: {err}", file=sys.stderr)
            continue
        if not a.no_wait:
            time.sleep(max(0.0, start + e["event_time_ms"] / 1000 / a.speed - time.monotonic()))
        if a.sink == "jsonl":
            out.write(json.dumps(e) + "\n")
            out.flush()
        else:
            batch.append(e)
            nxt_due = (
                start + events_out[n + 1]["event_time_ms"] / 1000 / a.speed
                if n + 1 < len(events_out)
                else None
            )
            # send now unless the next event is already due, so a goal never waits for the lull
            if len(batch) >= 50 or nxt_due is None or nxt_due > time.monotonic() + 0.05:
                flush()
        sent += 1
    flush()
    if hub is not None:
        hub.close()  # idempotent; atexit covers an error before this point
    if out is not sys.stdout:
        out.close()
    print(f"replayed {sent} events of {match_id} at {a.speed}x", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
