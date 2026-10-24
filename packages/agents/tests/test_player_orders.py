"""Role bounds for player orders: what a manager may ask of each player is decided in code."""

import pytest
from matchcast_agents.roles.orders import (
    ORDER_KEYS,
    POSITIONS,
    allowed_orders,
    decide,
    keyword_order,
)


@pytest.mark.parametrize("key", ["shoot", "runs", "press", "mark", "wide", "inside", "push"])
def test_a_keeper_cannot_be_sent_into_the_play(key: str) -> None:
    decision = decide("GK", key)
    assert decision.accepted is False
    assert "line" in decision.line


@pytest.mark.parametrize("key", ["deep", "simple", "rest"])
def test_a_keeper_takes_line_distribution_and_rest(key: str) -> None:
    assert decide("GK", key).accepted is True


def test_a_striker_can_drop_deeper_and_press_but_not_mark() -> None:
    assert decide("ST", "deep").accepted is True
    assert decide("ST", "press").accepted is True
    assert decide("ST", "mark").accepted is False


@pytest.mark.parametrize("position", sorted(POSITIONS))
def test_clear_is_always_allowed(position: str) -> None:
    assert decide(position, "clear").accepted is True


def test_an_unknown_position_gets_the_most_restrictive_set() -> None:
    assert allowed_orders(None) == frozenset({"clear", "deep", "simple", "rest"})
    assert decide(None, "push").accepted is False
    assert decide(None, "simple").accepted is True


def test_every_sim_position_has_a_role_group() -> None:
    # the simulator's own position codes (apps/unified/sources/3d-source/v2)
    sim = {"GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "CM", "LM", "RM", "AM", "LW", "RW", "ST"}
    assert sim <= POSITIONS
    for position in sim:
        assert allowed_orders(position) - {"clear"}


def test_every_order_key_is_one_of_the_sims_keys() -> None:
    assert ORDER_KEYS == frozenset(
        {
            "push",
            "deep",
            "wide",
            "inside",
            "press",
            "mark",
            "shoot",
            "simple",
            "runs",
            "rest",
            "clear",
        }
    )


@pytest.mark.parametrize(
    "text, key",
    [
        ("keep it simple", "simple"),
        ("shoot from range", "shoot"),
        ("follow their number ten", "mark"),
        ("press them high", "press"),
        ("run in behind", "runs"),
        ("push higher up the pitch", "push"),
        ("drop back and sit deep", "deep"),
        ("forget that, as you were", "clear"),
        ("save your legs", "rest"),
        ("how are you feeling", "none"),
        ("how many shots have you had?", "none"),
        ("don't shoot from range", "none"),
        ("stop pressing", "none"),
        ("no need to push higher", "none"),
    ],
)
def test_rules_mode_hears_the_same_orders_as_the_sim(text: str, key: str) -> None:
    assert keyword_order(text) == key


def test_a_refusal_with_no_position_says_why_and_what_he_can_do() -> None:
    line = decide(None, "press").line
    assert "don't know my role" in line
    assert "hold my shape" in line and "simple" in line and "rest" in line
