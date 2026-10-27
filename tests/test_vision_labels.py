"""FIX-11: the detection boxes and raw track ids are a debug view, off by default.

The overlay lives in the prototype's autoevent.js (read only), so the default is a build-time
patch (build.vision_labels), applied to both engine copies. The Boxes button is labelled as debug
(build.vision_debug_button).
"""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
UNIFIED = ROOT / "apps" / "unified"
SRC = UNIFIED / "sources"


def _load():
    spec = importlib.util.spec_from_file_location("unified_build", UNIFIED / "build.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = _load()
AUTO_WATCH = (SRC / "3d-source/v2/autoevent.js").read_text(encoding="utf-8")
AUTO_DESK = (SRC / "broadcaster-console/engine/autoevent.js").read_text(encoding="utf-8")
WATCH_HEAD = (SRC / "3d-source/v2/head.html").read_text(encoding="utf-8")
DESK_HEAD = (SRC / "broadcaster-console/engine/head.html").read_text(encoding="utf-8")
EVENTS = (UNIFIED / "embed/vision-events.js").read_text(encoding="utf-8")


@pytest.mark.parametrize("src", [AUTO_WATCH, AUTO_DESK], ids=["watch", "desk"])
def test_boxes_and_raw_track_ids_are_off_by_default(src):
    out = build.vision_labels(src, "test")
    assert "const VIS = { on: false, boxes: false," in out
    assert "const VIS = { on: false, boxes: true," not in out


def test_both_engine_copies_get_the_same_edit():
    assert build.vision_labels(AUTO_WATCH, "a") == build.vision_labels(AUTO_DESK, "b")


def test_patch_fails_loudly_when_the_source_moves():
    moved = AUTO_WATCH.replace(
        "const VIS = { on: false, boxes: true,", "const VIS = { on: false, boxes: 1,"
    )
    with pytest.raises(AssertionError, match="vision boxes off by default"):
        build.vision_labels(moved, "vision boxes off by default")


@pytest.mark.parametrize("head", [WATCH_HEAD, DESK_HEAD], ids=["watch", "desk"])
def test_boxes_button_is_labelled_as_debug(head):
    out = build.vision_debug_button(head, "test")
    assert (
        '<button id="visp-box" aria-pressed="false" '
        'title="Debug: detected boxes and raw track ids">Debug boxes</button>'
    ) in out


def test_hook_no_longer_turns_boxes_on_or_off_by_width():
    assert "innerWidth < 700) bx.click()" not in EVENTS
