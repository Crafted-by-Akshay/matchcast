"""The six fan feeds (CREW-7.1 to 7.6): the registry and the lane rule (CREW-4.3)."""

import pytest
from matchcast_agents.feeds import (
    BOOTH_LANE,
    DERIVED_LANE,
    DERIVED_PERSONAS,
    FEED_KEYS,
    FEEDS,
    QUEUE_LANE,
    drops_on_failed_repair,
    feed_for,
    lane_for,
    waits_for_producer,
)
from matchcast_agents.personas import BOOTH, max_chars, max_numbers, valid


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


def test_casual_and_analyst_limits_are_pinned_and_match_the_personas() -> None:
    casual, analyst = feed_for("casual"), feed_for("analyst")
    assert (casual.max_chars, casual.max_numbers) == (140, 1)  # the story's casual limits
    assert (analyst.max_chars, analyst.max_numbers) == (280, 6)
    for feed in (casual, analyst):
        assert feed.persona == feed.key
        assert feed.max_chars == max_chars(feed.key)
        assert feed.max_numbers == max_numbers(feed.key)


@pytest.mark.parametrize(
    "persona", ["booth:pbp", "booth:colour", "broadcast", "my-club:home", "one-metric:shots"]
)
def test_only_feed_personas_map_to_a_feed(persona: str) -> None:
    assert feed_for(persona) is None


@pytest.mark.parametrize("key", ["catch_me_up"])
def test_feeds_without_a_writer_have_no_persona(key: str) -> None:
    feed = next(f for f in FEEDS if f.key == key)
    assert feed.persona is None
    assert key not in DERIVED_PERSONAS


@pytest.mark.parametrize("key", ["audio_description", "ticker"])
def test_the_writers_of_audio_and_ticker_are_derived_personas(key: str) -> None:
    feed = next(f for f in FEEDS if f.key == key)
    assert feed.persona == key
    assert feed.persona in DERIVED_PERSONAS
    assert lane_for(key) == "derived"


def test_a_raw_viewer_alias_is_not_a_persona() -> None:
    # lane_for takes server personas. "fan" only becomes "casual" in normalise(), so the
    # lane rule must be applied after normalising, never to the raw string.
    assert lane_for("fan") == QUEUE_LANE


def test_limits_come_from_the_stories() -> None:
    by_key = {feed.key: feed for feed in FEEDS}
    assert by_key["catch_me_up"].max_words == 280  # under two minutes spoken
    assert by_key["half_time"].max_seconds == 90  # the explainer runs under 90 s
    assert by_key["audio_description"].min_gap_ms == 2_000  # speaks only in gaps of 2 s


def test_the_persona_backed_feeds_are_the_derived_lanes() -> None:
    assert {feed.key for feed in FEEDS if feed.persona} == {
        "casual",
        "analyst",
        "audio_description",
        "ticker",
        "half_time",
    }


@pytest.mark.parametrize("persona", sorted(BOOTH))
def test_booth_lines_are_booth_lane(persona: str) -> None:
    assert valid(persona)
    assert lane_for(persona) == BOOTH_LANE


@pytest.mark.parametrize("persona", ["casual", "analyst"])
def test_feed_personas_are_derived(persona: str) -> None:
    assert lane_for(persona) == DERIVED_LANE


@pytest.mark.parametrize(
    "persona", ["broadcast", "my-club:home", "player-focus:home9", "one-metric:shots"]
)
def test_broadcast_and_watch_modes_keep_the_queue(persona: str) -> None:
    # not one of the six feeds: they neither skip the producer nor drop on failed repair
    assert lane_for(persona) == QUEUE_LANE
    assert not drops_on_failed_repair(persona)
    assert waits_for_producer(persona, "producer")
    assert not waits_for_producer(persona, "auto")


@pytest.mark.parametrize("persona", ["booth:PBP", "booth", "booth:pbp ", "casual:x", ""])
def test_malformed_personas_fail_closed_to_the_queue(persona: str) -> None:
    assert lane_for(persona) == QUEUE_LANE
    assert not drops_on_failed_repair(persona)
    assert waits_for_producer(persona, "producer")


@pytest.mark.parametrize("mode", ["auto", "producer"])
def test_derived_lines_never_wait_for_the_producer(mode: str) -> None:
    assert not waits_for_producer("casual", mode)
    assert not waits_for_producer("analyst", mode)


def test_booth_waits_in_producer_mode_only() -> None:
    assert not waits_for_producer("booth:pbp", "auto")
    assert waits_for_producer("booth:pbp", "producer")
    assert waits_for_producer("booth:colour", "producer")


@pytest.mark.parametrize("persona", ["casual", "analyst"])
def test_failed_repair_drops_derived_lines(persona: str) -> None:
    assert drops_on_failed_repair(persona)


def test_failed_repair_never_drops_a_booth_line() -> None:
    assert not drops_on_failed_repair("booth:colour")
