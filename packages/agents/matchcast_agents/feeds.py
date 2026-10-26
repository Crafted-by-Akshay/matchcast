"""The six fan feeds (CREW-7.1 to 7.6) and the lane each verified line airs on.

MatchWorkflow reads these functions on the air path: the lane decides whether a verified
line waits for the producer, and a derived line that fails repair is dropped.

Three lanes decide what a verified line does next:

- booth: the two commentary voices. They wait in the producer queue in producer mode.
- derived: the fan feeds that have a persona today (casual, analyst). They never wait for
  a person, and a line that fails repair is dropped, not escalated (CREW-4.3).
- queue: every other persona (broadcast, the watch modes, anything malformed). These keep
  today's behaviour and fail closed: they wait for the producer in any mode but auto.

The half-time explainer (CREW-7.4) is a derived feed too: the workflow writes its piece with
the "half_time" persona (half_time.py). The other three feeds (audio description, catch-me-up,
ticker) have no persona yet, so no line can be tagged with them.
"""

from dataclasses import dataclass

from .personas import BOOTH, max_chars, max_numbers

BOOTH_LANE = "booth"
DERIVED_LANE = "derived"
QUEUE_LANE = "queue"


@dataclass(frozen=True)
class Feed:
    key: str  # wire name used by the feed switcher and the desk
    label: str  # what a fan or producer reads
    persona: str | None  # the persona that writes it today; None until the feed is wired in
    max_chars: int | None = None  # per line, for written feeds
    max_numbers: int | None = None  # numbers a line may state
    max_words: int | None = None  # whole-feed recap length (catch-me-up)
    max_seconds: int | None = None  # spoken length of a whole-feed piece (half-time)
    min_gap_ms: int | None = None  # silence needed before a spoken line (audio description)


FEEDS: tuple[Feed, ...] = (
    Feed(
        "casual",
        "Casual",
        "casual",
        max_chars=max_chars("casual"),
        max_numbers=max_numbers("casual"),
    ),
    Feed(
        "analyst",
        "Analyst",
        "analyst",
        max_chars=max_chars("analyst"),
        max_numbers=max_numbers("analyst"),
    ),
    Feed("audio_description", "Audio description", None, min_gap_ms=2_000),
    Feed("catch_me_up", "Catch me up", None, max_words=280),
    Feed("half_time", "Half-time explainer", "half_time", max_seconds=90),
    Feed("ticker", "News ticker", None),  # fixed templates only, no free text
)

FEED_KEYS = frozenset(feed.key for feed in FEEDS)
_BY_PERSONA = {feed.persona: feed for feed in FEEDS if feed.persona}
DERIVED_PERSONAS = frozenset(_BY_PERSONA)


def feed_for(persona: str) -> Feed | None:
    """The derived feed a persona writes, or None when no feed is written by that persona."""
    return _BY_PERSONA.get(persona)


def lane_for(persona: str) -> str:
    """The lane a server persona's verified lines air on. Unknown strings fail closed to the queue.

    Takes the server's persona, after normalise() in personas.py. A raw viewer alias such as
    "fan" is not a persona and is not looked up here.
    """
    if persona in BOOTH:
        return BOOTH_LANE
    if persona in DERIVED_PERSONAS:
        return DERIVED_LANE
    return QUEUE_LANE


def waits_for_producer(persona: str, approval_mode: str, hold_booth: bool = True) -> bool:
    """Whether a verified line waits in the producer queue before it airs.

    Derived lines never wait, whatever the approval mode (CREW-4.3 criterion 2). The booth
    waits in producer mode unless the match turns hold_booth off (25 Oct decision: the
    producer approves the main booth line). Queue lines wait in any mode except "auto". An
    unknown mode fails closed: the line waits.
    """
    lane = lane_for(persona)
    if lane == DERIVED_LANE:
        return False
    if lane == BOOTH_LANE:
        return approval_mode != "auto" and hold_booth
    return approval_mode != "auto"


def drops_on_failed_repair(persona: str) -> bool:
    """A derived line that fails repair is dropped, not escalated to a person (CREW-4.3).

    This only says whether to drop. The workflow writes the line_abstained audit record (with
    the reason code and text) and the feed_drop record that points to it.
    """
    return lane_for(persona) == DERIVED_LANE
