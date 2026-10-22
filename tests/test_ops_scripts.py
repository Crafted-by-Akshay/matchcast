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
