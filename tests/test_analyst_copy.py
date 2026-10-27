# AB#373 (FIX-06, FIX-08): the analyst console's copy is rewritten at build time;
# a stale count stops the build.
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load_build():
    path = ROOT / "apps" / "unified" / "build.py"
    spec = importlib.util.spec_from_file_location("unified_build", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = load_build()


def test_a_known_sentence_is_rewritten(monkeypatch):
    old = "Rules answer when Claude is not granted."
    new = "Rules answer when no model is available here."
    monkeypatch.setattr(build, "ANALYST_COPY", [(old, new, 1)])
    assert build.analyst_copy(old, strict=False) == new


def test_a_count_mismatch_stops_the_build(monkeypatch):
    entry = ("Shared with your team", "Saved on this device", 2)
    monkeypatch.setattr(build, "ANALYST_COPY", [entry])
    with pytest.raises(SystemExit, match="expected 2"):
        build.analyst_copy("Shared with your team", strict=False)


def test_host_identifiers_are_left_alone(monkeypatch):
    monkeypatch.setattr(build, "ANALYST_COPY", [])
    out = build.analyst_copy("window.claude allowClaude ClaudeAgent", strict=False)
    assert out == "window.claude allowClaude ClaudeAgent"
