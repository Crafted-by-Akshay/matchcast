"""The web image builds from apps/unified alone (`az acr build ... apps/unified`), so build.py must
not read anything outside that folder (25 Oct: squads read from data/history broke the build)."""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]


def test_build_py_runs_with_only_the_web_build_context(tmp_path: Path) -> None:
    archive = subprocess.run(
        ["git", "archive", "HEAD", "apps/unified"], cwd=ROOT, capture_output=True, check=True
    ).stdout
    subprocess.run(["tar", "-x", "-C", str(tmp_path)], input=archive, check=True)
    # the tracked tree, as a clean checkout has it, with nothing of the repo around it
    app = tmp_path / "context"
    (tmp_path / "apps/unified").rename(app)
    run = subprocess.run(
        [sys.executable, "build.py", "--api", "https://api.example.invalid"],
        cwd=app,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert run.returncode == 0, run.stderr[-2000:]
    assert (app / "watch/index.html").exists()
