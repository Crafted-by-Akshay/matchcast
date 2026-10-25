"""The six derived feeds (CREW-7.1 to 7.6): the registry and the lane rule (CREW-4.3)."""

import pytest
from matchcast_agents.feeds import (
    BOOTH_LANE,
    DERIVED_LANE,
    FEED_KEYS,
    FEEDS,
    drops_on_failed_repair,
    feed_for,
    lane_for,
    waits_for_producer,
)
from matchcast_agents.personas import BOOTH, valid


def test_six_feeds_with_the_story_keys() -> None:
    assert FEED_KEYS == {
        "casual",
        "analyst",
        "audio_description",
        "catch_me_up",
        "half_time",
        "ticker",
    }
    assert len(FEEDS) == 6


def test_casual_and_analyst_map_to_their_existing_personas() -> None:
    assert feed_for("casual").key == "casual"
    assert feed_for("analyst").key == "analyst"
    assert feed_for("casual").max_chars == 140 and feed_for("casual").max_numbers == 1
    assert feed_for("analyst").max_numbers == 6


def test_limits_come_from_the_stories() -> None:
    by_key = {feed.key: feed for feed in FEEDS}
    assert by_key["catch_me_up"].max_words == 280  # under two minutes spoken
    assert by_key["half_time"].max_seconds == 90  # the explainer runs under 90 s
    assert by_key["audio_description"].min_gap_ms == 2_000  # speaks only in gaps of 2 s


def test_only_persona_backed_feeds_have_a_writer_today() -> None:
    assert {feed.key for feed in FEEDS if feed.persona} == {"casual", "analyst"}
    assert feed_for("broadcast") is None


@pytest.mark.parametrize("persona", sorted(BOOTH))
def test_booth_lines_are_booth_lane(persona: str) -> None:
    assert valid(persona)
    assert lane_for(persona) == BOOTH_LANE


@pytest.mark.parametrize("persona", ["casual", "analyst", "my-club:home", "one-metric:shots"])
def test_everything_else_is_derived(persona: str) -> None:
    assert lane_for(persona) == DERIVED_LANE


@pytest.mark.parametrize("mode", ["auto", "producer"])
def test_derived_lines_never_wait_for_the_producer(mode: str) -> None:
    assert not waits_for_producer("casual", mode)
    assert not waits_for_producer("analyst", mode)
    assert not waits_for_producer("my-club:home", mode)


def test_booth_waits_in_producer_mode_only() -> None:
    assert not waits_for_producer("booth:pbp", "auto")
    assert waits_for_producer("booth:pbp", "producer")
    assert waits_for_producer("booth:colour", "producer")


@pytest.mark.parametrize("persona", ["casual", "analyst", "my-club:home"])
def test_failed_repair_drops_derived_lines(persona: str) -> None:
    assert drops_on_failed_repair(persona)


def test_failed_repair_never_drops_a_booth_line() -> None:
    assert not drops_on_failed_repair("booth:colour")
