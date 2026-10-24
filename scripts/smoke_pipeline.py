#!/usr/bin/env python3
"""PLT-7/DAT-1: prove the event stream end to end against a running api.

Usage: scripts/smoke_pipeline.py --base https://<api-fqdn> [--timeout 1200]

Creates a match from the ten-minute fixture and posts all events in small batches (the api answers
202 only after the events are on the stream when MATCHCAST_PIPELINE=eventhubs). It then waits until
every event is processed, at least one claim is verified and the claims have stopped changing.
Prints the time each step took and exits 1 on any failure. Run it after every deploy, and after
`azd env set PIPELINE_MODE eventhubs && azd provision`; flip back with PIPELINE_MODE=direct.
"""

import argparse
import http.client
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

FIXTURE = Path(__file__).parents[1] / "packages/agents/tests/fixtures/match-short.json"
# In live mode each events POST runs model calls in the request (direct pipeline): measured
# 24 Oct at 21-101 s for 10 events.
REQUEST_TIMEOUT_S = 200  # under the Container Apps ingress cut-off of 240 s
BATCH = 10  # the measured batch size: at most 101 s live
# When the POSTs return before processing (eventhubs, memory), a moment can still be in its model
# calls after its event is counted, so the claims and line counters must stay unchanged for longer
# than one model call.
QUIET_S = 60


def snapshot(claims: list[dict]) -> list[tuple[str, str]]:
    return sorted((str(c.get("claim_id")), str(c.get("verdict"))) for c in claims)


def settled(claims: list[dict], previous: list[tuple[str, str]] | None) -> bool:
    """At least one claim is verified and nothing changed since the last poll. The api reports
    verified, rejected or pending; live agents leave some claims rejected (the Verifier working)
    or pending (a line held back), so "every claim verified" only ever holds in rules mode."""
    current = snapshot(claims)
    return any(v == "verified" for _, v in current) and current == previous


def inline_from_status(status: int, doc: dict) -> bool:
    """Only the direct pipeline runs the agents inside the POST; anything else, or no answer from
    /v1/status, gets the quiet window."""
    stream = [d for d in doc.get("dependencies", []) if d.get("key") == "stream"]
    return status == 200 and bool(stream) and "(direct)" in str(stream[0].get("detail"))


def wait_for_claims(
    get, total: int, timeout: float, inline: bool, quiet: float = QUIET_S,
    clock=time.monotonic, sleep=time.sleep,
) -> tuple[bool, list[dict], int]:  # fmt: skip
    """Poll `get() -> (match stats, claims)` until settled. `inline` means the POSTs already ran
    the pipeline, so two equal polls are enough; otherwise nothing may change for `quiet` s."""
    deadline = clock() + timeout
    previous: tuple | None = None
    since = clock()
    processed, items = 0, []
    while clock() < deadline:
        stats, items = get()
        processed = stats.get("events", 0)
        current = (snapshot(items), sorted(stats.items()))
        if current != previous:
            previous, since = current, clock()
        elif processed >= total and settled(items, previous[0]):
            if inline or clock() - since >= quiet:
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
            return response.status, parse(response.read())
    except urllib.error.HTTPError as error:
        return error.code, parse(error.read())
    except (OSError, http.client.HTTPException) as error:  # timeout, reset, refused, cut short
        return 0, {"error": repr(error)}


def parse(body: bytes) -> dict:
    """JSON from the api; a gateway page (a 502 or 504 from ingress) is kept as text."""
    try:
        doc = json.loads(body or b"{}")
    except ValueError:
        return {"error": body[:200].decode(errors="replace")}
    return doc if isinstance(doc, dict) else {"error": str(doc)[:200]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", required=True)
    # eventhubs: the POSTs return at once, so this covers all processing (about 495 s live)
    parser.add_argument("--timeout", type=float, default=1200)
    # rules agents answer in milliseconds, so a local rules-mode api can use a short window
    parser.add_argument("--quiet", type=float, default=QUIET_S)
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

    def get() -> tuple[dict, list[dict]]:
        status, match = call("GET", f"{base}/v1/matches/{name}?session_id={name}")
        stats = match.get("stats", {}) if status == 200 else {}
        status, reply = call("GET", f"{base}/v1/matches/{name}/claims?session_id={name}&limit=500")
        return stats, reply.get("items", []) if status == 200 else []

    inline = inline_from_status(*call("GET", f"{base}/v1/status"))
    ok, items, processed = wait_for_claims(get, len(events), args.timeout, inline, args.quiet)
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
