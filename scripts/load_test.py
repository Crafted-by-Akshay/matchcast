#!/usr/bin/env python3
"""PLT-9: replay the ten-minute fixture into N matches at once and report ingest latency.

Usage: scripts/load_test.py [--base URL] [--matches 8] [--repeat 1] [--out report.json]

Standard library only. Each match gets its own session and match id, so the api sees N independent
streams. Run it against a local api (rules mode) for a baseline, or the deployed api to record the
replica graph (docs/infra.md, Scaling proof). Exit code 1 if any request failed.
"""

import argparse
import http.client
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

FIXTURE = Path(__file__).parents[1] / "packages/agents/tests/fixtures/match-short.json"
BATCH = 50


def call(url: str, body: dict) -> tuple[int, float]:
    request = urllib.request.Request(
        url, json.dumps(body).encode(), {"Content-Type": "application/json"}, method="POST"
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status = response.status
            response.read()
    except urllib.error.HTTPError as error:
        status = error.code
    except (OSError, http.client.HTTPException):
        status = 0
    return status, (time.perf_counter() - started) * 1000


def run_match(base: str, fixture: dict, index: int, run: str) -> list[tuple[int, float, int]]:
    session, match = f"load-{run}-{index}", f"load-{run}-{index}"
    stream = {**fixture["events"][0]["stream"], "session_id": session, "match_id": match}
    results: list[tuple[int, float, int]] = []
    created = call(
        f"{base}/v1/matches",
        {
            "session_id": session,
            "match_id": match,
            "roster": {**fixture["roster"], "stream": stream},
            "names": fixture["names"],
            "clubs": fixture["teams"],
        },
    )
    results.append((*created, 0))
    if created[0] != 201:
        return results
    events = []
    for event in fixture["events"]:
        events.append({**event, "stream": stream})
    for start in range(0, len(events), BATCH):
        url = f"{base}/v1/matches/{match}/events?session_id={session}"
        batch = events[start : start + BATCH]
        results.append((*call(url, {"events": batch}), len(batch)))
    return results


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(q * (len(ordered) - 1)))]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--matches", type=int, default=8)
    parser.add_argument("--repeat", type=int, default=1, help="rounds of N matches")
    parser.add_argument("--out", help="write the report as JSON")
    args = parser.parse_args()
    fixture = json.loads(FIXTURE.read_text())
    run = str(int(time.time()))
    started = time.perf_counter()
    results: list[tuple[int, float, int]] = []
    for round_ in range(args.repeat):
        with ThreadPoolExecutor(args.matches) as pool:
            futures = [
                pool.submit(
                    run_match, args.base.rstrip("/"), fixture, round_ * args.matches + i, run
                )
                for i in range(args.matches)
            ]
            for future in futures:
                results.extend(future.result())
    elapsed = time.perf_counter() - started
    latencies = [ms for _, ms, _ in results]
    failures = [status for status, _, _ in results if status not in (201, 202)]
    sent = sum(n for status, _, n in results if status == 202)
    report = {
        "matches": args.matches * args.repeat,
        "requests": len(results),
        "events": sent,
        "seconds": round(elapsed, 2),
        "events_per_second": round(sent / elapsed, 1),
        "p50_ms": round(statistics.median(latencies), 1),
        "p95_ms": round(percentile(latencies, 0.95), 1),
        "max_ms": round(max(latencies), 1),
        "failures": len(failures),
        "failure_statuses": sorted(set(failures)),
    }
    print(json.dumps(report, indent=2))
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2) + "\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
