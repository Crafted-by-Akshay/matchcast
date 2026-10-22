"""The split in data/databricks/train_danger.py must hold out whole matches."""

import importlib.util
from pathlib import Path

import numpy as np

SPEC = importlib.util.spec_from_file_location(
    "train_danger", Path(__file__).resolve().parent.parent / "data/databricks/train_danger.py"
)
td = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(td)


def test_split_never_puts_a_match_on_both_sides_and_is_deterministic():
    seeds = np.repeat(np.arange(40), 25)
    held = td.split_by_match(seeds)
    assert set(seeds[held].tolist()).isdisjoint(set(seeds[~held].tolist()))
    assert 0 < held.sum() < len(seeds)
    assert (held == td.split_by_match(seeds)).all()


def test_calibration_bins_report_predicted_against_observed():
    y = np.array([0, 0, 1, 1, 1, 0, 1, 1])
    p = np.array([0.1, 0.15, 0.85, 0.9, 0.95, 0.2, 0.7, 0.75])
    bins = td.calibration_bins(y, p, bins=2)
    assert [b["n"] for b in bins] == [3, 5]
    assert bins[0]["observed"] == 0.0 and bins[1]["observed"] == 1.0
