"""The wall-time clock is a build-time patch (build.walltime) of both engine copies."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "apps" / "unified" / "sources"


def _load():
    spec = importlib.util.spec_from_file_location("unified_build", ROOT / "apps/unified/build.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = _load()
WATCH = (SRC / "3d-source/v2/main.js").read_text(encoding="utf-8")
DESK = (SRC / "broadcaster-console/engine/main.js").read_text(encoding="utf-8")


@pytest.mark.parametrize("src", [WATCH, DESK], ids=["watch", "desk"])
def test_patch_raises_the_frame_cap_and_bounds_the_catch_up(src):
    out = build.walltime(src, "test")
    assert "Math.min(clk.getDelta(), 0.05)" not in out
    assert "Math.min(clk.getDelta(), 0.25)" in out
    assert "const CATCHUP_STEPS = 15;" in out
    assert "CATCHUP_STEPS * STEP * Math.max(1, S.speed)" in out
    assert "const STEP = 0.02;" in out  # the fixed step is not touched
    # the headless runner path keeps its exact budget; only the live path is clamped
    assert "window.__mcHeadless ? (window.__mcDt || 0) : Math.min(dt * S.speed, catchup())" in out


def test_both_engine_copies_get_the_same_edit():
    # the two sources are identical (test_engine_copies), so the patched text is too
    assert build.walltime(WATCH, "a") == build.walltime(DESK, "b")


def test_patch_fails_loudly_when_the_source_moves():
    with pytest.raises(AssertionError, match="watch wall-time loop"):
        moved = WATCH.replace("clk.getDelta(), 0.05", "clk.getDelta(), 0.06")
        build.walltime(moved, "watch wall-time loop")
