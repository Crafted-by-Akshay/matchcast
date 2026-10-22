import json
import subprocess
import sys
from pathlib import Path

GOLDEN = Path(__file__).parent.parent / "golden"


def test_indices_golden_is_current():
    """apps/unified/embed/indices.js is checked against this file, so it must match the Python."""
    fresh = subprocess.run(
        [sys.executable, str(GOLDEN / "export_indices_golden.py")],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    assert json.loads(fresh) == json.loads((GOLDEN / "indices-golden.json").read_text())
