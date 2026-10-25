"""The six derived fan feeds (CREW-7.1 to 7.6) and the lane each line airs on.

The booth keeps the producer queue. Every derived feed bypasses it (CREW-4.3): a line airs
as soon as the Verifier passes it, and a line that fails repair is dropped with an audit
record. Casual and analyst are the two feeds that exist today as personas; the other four
are new and get their writers in later changes.
"""

from dataclasses import dataclass

from .personas import BOOTH

BOOTH_LANE = "booth"
DERIVED_LANE = "derived"


@dataclass(frozen=True)
class Feed:
    key: str  # wire name used by the feed switcher and the desk
    label: str  # what a fan or producer reads
    persona: str | None  # the persona that writes it today; None until its writer lands
    max_chars: int | None = None  # per line, for written feeds
    max_numbers: int | None = None  # numbers a line may state
    max_words: int | None = None  # whole-feed recap length (catch-me-up)
    max_seconds: int | None = None  # spoken length of a whole-feed piece (half-time)
    min_gap_ms: int | None = None  # silence needed before a spoken line (audio description)


FEEDS: tuple[Feed, ...] = (
    Feed("casual", "Casual", "casual", max_chars=140, max_numbers=1),
    Feed("analyst", "Analyst", "analyst", max_chars=280, max_numbers=6),
    Feed("audio_description", "Audio description", None, min_gap_ms=2_000),
    Feed("catch_me_up", "Catch me up", None, max_words=280),
    Feed("half_time", "Half-time explainer", None, max_seconds=90),
    Feed("ticker", "News ticker", None),  # fixed templates only, no free text
)

FEED_KEYS = frozenset(feed.key for feed in FEEDS)
_BY_PERSONA = {feed.persona: feed for feed in FEEDS if feed.persona}


def feed_for(persona: str) -> Feed | None:
    """The derived feed a persona writes, or None for the booth and the watch modes."""
    return _BY_PERSONA.get(persona)


def lane_for(persona: str) -> str:
    """Booth lines queue for the producer; every other line is derived and never queues."""
    return BOOTH_LANE if persona in BOOTH else DERIVED_LANE


def waits_for_producer(persona: str, approval_mode: str) -> bool:
    """Whether a verified line waits in the producer queue before it airs.

    The booth waits in producer mode (Akshay, 25 Oct). Derived lines never wait, whatever the
    approval mode (CREW-4.3 criterion 2).
    """
    return lane_for(persona) == BOOTH_LANE and approval_mode != "auto"


def drops_on_failed_repair(persona: str) -> bool:
    """A derived line that fails repair is dropped with an audit record, never escalated."""
    return lane_for(persona) == DERIVED_LANE
