#!/usr/bin/env python3
"""PLT-7/DAT-1: prove the event stream end to end against a running api.

Usage: scripts/smoke_pipeline.py --base https://<api-fqdn> [--timeout 90]

Creates a match from the ten-minute fixture, posts all events (the api answers 202 only after the
events are on the stream when MATCHCAST_PIPELINE=eventhubs), then waits until the consumer has
produced verified claims. Prints the time each step took and exits 1 on any failure. Run it after
`azd env set PIPELINE_MODE eventhubs && azd provision`; flip back with PIPELINE_MODE=direct.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

FIXTURE = Path(__file__).parents[1] / "packages/agents/tests/fixtures/match-short.json"
# In live mode each events POST runs model calls in the request (direct pipeline): measured
# 24 Oct at 21-101 s for 10 events, so one 50-event batch can take minutes.
REQUEST_TIMEOUT_S = 300
FINAL_VERDICTS = {"verified", "review", "rejected"}


def settled(claims: list[dict]) -> bool:
    """Every claim has a final verdict and at least one is verified. Live agents can produce
    claims the Verifier rejects; that is the Verifier working, not a failed pipeline."""
    verdicts = [c.get("verdict") for c in claims]
    return bool(verdicts) and all(v in FINAL_VERDICTS for v in verdicts) and "verified" in verdicts


def call(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        url, data, {"Content-Type": "application/json"} if data else {}, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", required=True)
    parser.add_argument("--timeout", type=float, default=90)
    args = parser.parse_args()
    base = args.base.rstrip("/")
    fixture = json.loads(FIXTURE.read_text())
    name = f"smoke-{uuid.uuid4().hex[:8]}"
    stream = {**fixture["events"][0]["stream"], "session_id": name, "match_id": name}
    events = [{**e, "stream": stream} for e in fixture["events"]]
    started = time.perf_counter()

    status, reply = call(
        "POST",
        f"{base}/v1/matches",
        {
            "session_id": name,
            "match_id": name,
            "roster": {**fixture["roster"], "stream": stream},
            "names": fixture["names"],
            "clubs": fixture["teams"],
        },
    )
    if status != 201:
        print(f"FAIL create match: {status} {reply}")
        return 1
    elapsed = time.perf_counter() - started
    print(f"created {name} (agent mode {reply.get('mode')}) after {elapsed:.1f}s")

    for start in range(0, len(events), 50):
        status, reply = call(
            "POST",
            f"{base}/v1/matches/{name}/events?session_id={name}",
            {"events": events[start : start + 50]},
        )
        if status != 202:
            print(f"FAIL post events at {start}: {status} {reply}")
            return 1
    print(f"all {len(events)} events accepted after {time.perf_counter() - started:.1f}s")

    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        status, reply = call("GET", f"{base}/v1/matches/{name}/claims?session_id={name}")
        items = reply.get("items", []) if status == 200 else []
        if settled(items):
            verified = sum(c.get("verdict") == "verified" for c in items)
            others = len(items) - verified
            extra = f" ({others} rejected or held for review)" if others else ""
            elapsed = time.perf_counter() - started
            print(f"OK: {verified} verified claims{extra} after {elapsed:.1f}s")
            return 0
        time.sleep(2)
    print(f"FAIL: no verified claims in {args.timeout:.0f}s (status {status}, {len(items)} claims)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
