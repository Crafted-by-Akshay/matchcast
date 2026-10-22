import json
from pathlib import Path

import pytest
from matchcast_metrics import (
    DERIVATION_VERSIONS,
    Frame,
    Pass,
    Shot,
    ball_speed_kmh,
    moment_score,
    pass_difficulty,
    pass_quality,
    pressure_index,
    xg,
)

GOLDEN = json.loads((Path(__file__).parent.parent / "golden" / "golden.json").read_text())
ROOT = Path(__file__).resolve().parents[3]


def frame(opponents):
    return Frame(tuple(map(tuple, opponents))) if opponents else None


def compute(case):
    i = case["input"]
    match case["metric"]:
        case "xg":
            return xg(Shot(**i["shot"]), frame(i["opponents"]))
        case "pass_difficulty":
            return pass_difficulty(Pass(**i["pass"]), frame(i["opponents"]))
        case "pass_quality":
            return pass_quality(Pass(**i["pass"]), frame(i["opponents"]))
        case "ball_speed_kmh":
            return ball_speed_kmh(
                [tuple(s) for s in i["samples"]], i["event_time_ms"], i["window_ms"]
            )
        case "pressure_index":
            return pressure_index(
                i["x"], i["y"], Frame(tuple(map(tuple, i["opponents"]))), i["radius_m"]
            )
        case "moment_score":
            return moment_score(i["events"], i["minute"], i["goal_margin"])
    raise AssertionError(case["metric"])


def test_golden_has_at_least_50_cases():
    assert len(GOLDEN["cases"]) >= 50


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=lambda c: c["metric"])
def test_matches_javascript_reference(case):
    assert compute(case) == pytest.approx(case["expected"], abs=GOLDEN["tolerance"])


def test_xg_is_deterministic():
    shot = Shot(x=92.0, y=30.0)
    f = Frame(((90.0, 31.0),))
    assert xg(shot, f) == xg(shot, f)


def test_every_metric_has_a_version():
    assert set(DERIVATION_VERSIONS) == {
        "xg",
        "pass_difficulty",
        "pass_quality",
        "ball_speed_kmh",
        "pressure_index",
        "moment_score",
    }


def test_xg_constants_match_calibration_file():
    from matchcast_metrics import core

    fit = json.loads((ROOT / "data" / "calibration" / "xg.json").read_text())
    assert (core.XG_B0, core.XG_B1, core.XG_B2) == pytest.approx(
        (fit["b0"], fit["b1"], fit["b2"]), abs=1e-6
    )


def test_pressure_index_rejects_radius_of_one_or_less():
    with pytest.raises(ValueError):
        pressure_index(10.0, 10.0, Frame(((11.0, 10.0),)), radius_m=1.0)
