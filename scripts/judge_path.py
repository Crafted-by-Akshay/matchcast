#!/usr/bin/env python3
"""Judge path on this machine: boot the api and the unified app with no Azure, prove the demo flow.

Usage: scripts/judge_path.py [--e2e]

Starts the api (rules agents, in-memory store, in-process event stream) on a free port, builds the
unified app, then checks in order: /health and /ready, the app shell and its three views are built,
a match is created and its events flow through the stream to verified claims
(scripts/smoke_pipeline.py),
and the openapi document lists the routes the app calls. With --e2e it also runs the Playwright
unified spec against the build. Exit 1 on the first failure. Nothing here calls Azure or Foundry.
"""

import argparse
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parents[1]
CLOUD_PREFIXES = (
    "AZURE_",
    "FOUNDRY_",
    "STORAGE_",
    "EVENTHUB_",
    "APPLICATIONINSIGHTS_",
    "SPEECH_",
    "TRANSLATOR_",
    "VISION_",
    "SEARCH_",
    "CONTENT_SAFETY_",
    "MATCHCAST_",
)
VIEWS = ("watch", "analyst", "broadcast")
ROUTES = ("/v1/matches", "/v1/matches/{match_id}/events", "/v1/matches/{match_id}/claims")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read()


def step(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}{' - ' + detail if detail else ''}")
    if not ok:
        sys.exit(1)


def wait_ready(base: str, api: subprocess.Popen, seconds: float = 60) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline and api.poll() is None:
        try:
            get(f"{base}/health")
            return True
        except OSError:
            time.sleep(0.5)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--e2e", action="store_true", help="also run the Playwright unified spec")
    args = parser.parse_args()
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    # Nothing inherited from the shell may point the api at Azure: drop every cloud setting.
    env = {k: v for k, v in os.environ.items() if not k.startswith(CLOUD_PREFIXES)}
    env.update(
        MATCHCAST_PIPELINE="memory",
        MATCHCAST_STORE="memory",
        MATCHCAST_AGENT_MODE="rules",
        AZURE_CONFIG_DIR=tempfile.mkdtemp(prefix="judge-az-"),
    )
    log = tempfile.NamedTemporaryFile("w+", prefix="judge-api-", suffix=".log")
    api = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--app-dir", "services/api"]
        + ["--host", "127.0.0.1", "--port", str(port)],
        cwd=ROOT,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    try:
        booted = wait_ready(base, api)
        if not booted:
            log.seek(0)
            print(log.read()[-1500:])
        step("api boots", booted and api.poll() is None, base)
        try:
            get(f"{base}/ready")  # a 503 raises: the api reports itself not ready
            ready = True
        except OSError:
            ready = False
        step("api ready", ready)
        with tempfile.TemporaryDirectory() as dist:
            built = subprocess.run(
                [sys.executable, "apps/unified/build.py", dist],
                cwd=ROOT,
                capture_output=True,
                timeout=120,
            )
            step("unified app builds", built.returncode == 0, built.stderr.decode()[-200:])
            shell = (Path(dist) / "index.html").read_text(errors="ignore")
            step("app shell has the three views", all(v in shell.lower() for v in VIEWS))
            step(
                "view pages are built",
                all((Path(dist) / v / "index.html").exists() for v in VIEWS),
            )
        smoke = subprocess.run(
            [sys.executable, "scripts/smoke_pipeline.py", "--base", base, "--timeout", "60"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=120,
        )
        step(
            "match to verified claims",
            smoke.returncode == 0,
            (smoke.stdout.strip().splitlines() or [""])[-1],
        )
        spec = get(f"{base}/openapi.json").decode()
        step("openapi lists the app routes", all(route in spec for route in ROUTES))
        if args.e2e:
            e2e = subprocess.run(
                ["npx", "playwright", "test", "tests/e2e/unified.spec.ts"], cwd=ROOT, timeout=1200
            )
            step("playwright unified spec", e2e.returncode == 0)
    finally:
        api.terminate()
        try:
            api.wait(timeout=15)
        except subprocess.TimeoutExpired:
            api.kill()
    print("Judge path OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
