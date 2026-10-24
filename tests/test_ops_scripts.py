"""The shutdown script is a dry run by default; destructive steps need a confirmation."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).parents[1]


def run(*args, env=None):
    return subprocess.run(
        ["bash", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        env={"PATH": "/usr/bin:/bin", **(env or {})},
    )


def test_steps_print_by_default():
    for step in ("scale-down", "cost-final", "stop-eventhubs", "teardown"):
        result = run("scripts/shutdown.sh", step)
        assert result.returncode == 0 and "[dry run]" in result.stdout, step


def test_destructive_steps_refuse_without_confirmation():
    for step in ("stop-eventhubs", "teardown"):
        result = run("scripts/shutdown.sh", step, "--execute")
        assert result.returncode == 2 and "CONFIRM_DESTROY" in result.stderr, step


def test_unknown_step_is_a_usage_error():
    assert run("scripts/shutdown.sh", "nope").returncode == 2


def test_health_check_dry_run_sends_nothing():
    result = run(
        "scripts/health_check.sh", "http://api.invalid", "http://web.invalid", env={"DRY_RUN": "1"}
    )
    assert result.returncode == 0 and "HEALTHY" in result.stdout


def test_health_check_fails_when_the_api_is_unreachable():
    result = run("scripts/health_check.sh", "http://127.0.0.1:9", env={"HEALTH_RETRIES": "0"})
    assert result.returncode == 1 and "UNHEALTHY" in result.stdout


def test_health_check_fails_on_unavailable_dependency_and_passes_when_clean(tmp_path):
    import http.server
    import json
    import threading

    doc = {"dependencies": [{"key": "speech", "status": "unavailable"}]}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps(doc if self.path == "/v1/status" else {"ok": 1}).encode()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}"
    try:
        bad = run("scripts/health_check.sh", url)
        assert bad.returncode == 1 and "unavailable dependencies: speech" in bad.stdout
        doc["dependencies"][0]["status"] = "live"
        good = run("scripts/health_check.sh", url)
        assert good.returncode == 0 and "HEALTHY" in good.stdout
    finally:
        server.shutdown()


def test_pause_fabric_none_and_wrong_confirmation():
    assert (
        "no paid capacity"
        in run("scripts/shutdown.sh", "pause-fabric", env={"FABRIC_CAPACITY": "none"}).stdout
    )
    wrong = run("scripts/shutdown.sh", "teardown", "--execute", env={"CONFIRM_DESTROY": "other"})
    assert wrong.returncode == 2


def test_scale_down_covers_api_web_and_mcp() -> None:
    import os
    import subprocess

    out = subprocess.run(
        ["bash", "scripts/shutdown.sh", "scale-down"],
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, "DRY_RUN": "1"},
    ).stdout
    for app in ("ca-api-matchcast", "ca-web-matchcast", "ca-mcp-matchcast"):
        assert f"--name {app}" in out
        assert "--min-replicas 0" in out


def _smoke():
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "smoke_pipeline", ROOT / "scripts/smoke_pipeline.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_smoke_accepts_verifier_rejections_once_claims_stop_changing():
    smoke = _smoke()
    claims = [
        {"claim_id": "a", "verdict": "verified"},
        {"claim_id": "b", "verdict": "rejected"},
        {"claim_id": "c", "verdict": "pending"},
    ]
    assert not smoke.settled(claims, None)  # first poll: nothing to compare with yet
    assert smoke.settled(claims, smoke.snapshot(claims))
    moved = [claims[0], claims[1], {"claim_id": "c", "verdict": "verified"}]
    assert not smoke.settled(moved, smoke.snapshot(claims))
    rejected = [{"claim_id": "b", "verdict": "rejected"}]
    assert not smoke.settled(rejected, smoke.snapshot(rejected))
    assert not smoke.settled([], [])


def test_smoke_waits_long_enough_for_live_model_calls():
    assert _smoke().REQUEST_TIMEOUT_S >= 300
