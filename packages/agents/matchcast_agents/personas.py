"""Personas: three base voices plus three parameterised watch modes (AGT-6).

``my-club:<team_id>``, ``player-focus:<player_id>`` and ``one-metric:<metric>`` write with the
limits of a base voice; the argument decides what the line is about.
"""

import re

BASE = ("casual", "analyst", "broadcast")
PATTERN = (
    r"^(casual|analyst|broadcast|my-club:[A-Za-z0-9._-]{1,64}|"
    r"player-focus:[A-Za-z0-9._-]{1,64}|one-metric:[a-z_]{1,32})$"
)
_VALID = re.compile(PATTERN)
# the base voice whose character limit a persona uses
VOICE = {"my-club": "casual", "player-focus": "casual", "one-metric": "analyst"}
MAX_CHARS = {"casual": 140, "analyst": 280, "broadcast": 180}
MAX_NUMBERS = {"casual": 1, "analyst": 6, "broadcast": 2}
# watch modes keep their own number limits (one-metric may quote both teams)
NUMBER_LIMIT = {"one-metric": 2, "player-focus": 1, "my-club": 1}


def valid(persona: str) -> bool:
    return bool(_VALID.match(persona))


def split(persona: str) -> tuple[str, str]:
    kind, _, arg = persona.partition(":")
    return kind, arg


def voice(persona: str) -> str:
    kind, _ = split(persona)
    return VOICE.get(kind, kind)


def max_chars(persona: str) -> int:
    return MAX_CHARS[voice(persona)]


def max_numbers(persona: str) -> int:
    kind, _ = split(persona)
    return NUMBER_LIMIT.get(kind, MAX_NUMBERS.get(kind, 1))


def slug(persona: str) -> str:
    return persona.replace(":", "-")
