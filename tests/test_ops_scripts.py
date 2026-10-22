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
