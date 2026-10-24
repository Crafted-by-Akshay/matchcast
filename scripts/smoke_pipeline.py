#!/usr/bin/env python3
"""PLT-7/DAT-1: prove the event stream end to end against a running api.

Usage: scripts/smoke_pipeline.py --base https://<api-fqdn> [--timeout 600]

Creates a match from the ten-minute fixture and posts all events in small batches (the api answers
202 only after the events are on the stream when MATCHCAST_PIPELINE=eventhubs). It then waits until
every event is processed, at least one claim is verified and the claims have stopped changing.
Prints the time each step took and exits 1 on any failure. Run it after every deploy, and after
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
REQUEST_TIMEOUT_S = 200  # under the Container Apps ingress cut-off of 240 s
BATCH = 10  # the measured batch size: at most 101 s live
# When the POSTs return before processing (eventhubs), a moment can still be in the model calls
# after its event is counted, so the claims must stay unchanged for longer than one moment.
QUIET_S = 60


def snapshot(claims: list[dict]) -> list[tuple[str, str]]:
    return sorted((str(c.get("claim_id")), str(c.get("verdict"))) for c in claims)


def settled(claims: list[dict], previous: list[tuple[str, str]] | None) -> bool:
    """At least one claim is verified and nothing changed since the last poll. The api reports
    verified, rejected or pending; live agents leave some claims rejected (the Verifier working)
    or pending (a line held back), so "every claim verified" only ever holds in rules mode."""
    current = snapshot(claims)
    return any(v == "verified" for _, v in current) and current == previous


def wait_for_claims(get, total: int, timeout: float, inline: bool, clock=time.monotonic,
                    sleep=time.sleep) -> tuple[bool, list[dict], int]:  # fmt: skip
    """Poll until settled. `inline` means the POSTs already ran the pipeline (direct mode), so two
    equal polls are enough; otherwise the claims must stay equal for QUIET_S."""
    deadline = clock() + timeout
    previous: list[tuple[str, str]] | None = None
    since = clock()
    processed, items = 0, []
    while clock() < deadline:
        processed, items = get()
        current = snapshot(items)
        if current != previous:
            previous, since = current, clock()
        elif processed >= total and settled(items, previous):
            if inline or clock() - since >= QUIET_S:
                return True, items, processed
        sleep(2)
    return False, items, processed


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
    except OSError as error:  # timeout, reset or refused: report it, do not crash
        return 0, {"error": repr(error)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", required=True)
    parser.add_argument("--timeout", type=float, default=600)
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

    for start in range(0, len(events), BATCH):
        status, reply = call(
            "POST",
            f"{base}/v1/matches/{name}/events?session_id={name}",
            {"events": events[start : start + BATCH]},
        )
        if status != 202:
            print(f"FAIL post events at {start}: {status} {reply}")
            return 1
    print(f"all {len(events)} events accepted after {time.perf_counter() - started:.1f}s")

    def get() -> tuple[int, list[dict]]:
        status, match = call("GET", f"{base}/v1/matches/{name}?session_id={name}")
        processed = match.get("stats", {}).get("events", 0) if status == 200 else 0
        status, reply = call("GET", f"{base}/v1/matches/{name}/claims?session_id={name}&limit=500")
        return processed, reply.get("items", []) if status == 200 else []

    # Only the Event Hubs pipeline answers the POSTs before processing; direct runs them inline.
    _, status_doc = call("GET", f"{base}/v1/status")
    stream_item = [d for d in status_doc.get("dependencies", []) if d.get("key") == "stream"]
    inline = not stream_item or stream_item[0].get("status") != "live"
    ok, items, processed = wait_for_claims(get, len(events), args.timeout, inline)
    if ok:
        verified = sum(c.get("verdict") == "verified" for c in items)
        others = len(items) - verified
        extra = f" ({others} rejected or pending)" if others else ""
        print(f"OK: {verified} verified claims{extra} after {time.perf_counter() - started:.1f}s")
        return 0
    print(f"FAIL: claims not settled in {args.timeout:.0f}s ({processed} events processed)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
