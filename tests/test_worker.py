"""Verify local worker lifecycle and rejection of unsupported provider modes."""

import os
import select
import signal
import subprocess
import sys

import pytest


@pytest.mark.skipif(os.name != "posix", reason="POSIX shutdown signals target macOS and Linux")
@pytest.mark.parametrize("stop_signal", [signal.SIGINT, signal.SIGTERM])
def test_worker_starts_locally_and_stops_cleanly(stop_signal: int) -> None:
    process = subprocess.Popen(
        [sys.executable, "-m", "matchcast_worker"],
        env={key: value for key, value in os.environ.items() if key != "MATCHCAST_WORKER_MODE"},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert process.stdout is not None
        readable, _, _ = select.select([process.stdout], [], [], 10)
        assert readable, "worker did not announce readiness"
        assert "worker ready: mode=local" in process.stdout.readline()
        process.send_signal(stop_signal)
        output, error = process.communicate(timeout=5)

        assert process.returncode == 0, error
        assert "MatchCast worker stopped" in output
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)


def test_worker_rejects_cloud_mode() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "matchcast_worker", "--mode", "azure"],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 2
    assert "invalid choice" in result.stderr
    assert "worker ready" not in result.stdout


def test_worker_rejects_unsupported_environment_mode() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "matchcast_worker"],
        env={**os.environ, "MATCHCAST_WORKER_MODE": "azure"},
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 2
    assert "cloud execution is not implemented" in result.stderr
    assert "worker ready" not in result.stdout
