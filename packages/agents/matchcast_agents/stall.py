"""Stall detection for the Showrunner (CREW-1.2): when the match goes quiet, the crew replans.

A stall is wall time with no verified line, measured on the clock the workflow runs on, not the
match clock (at 1x speed 60 s is about three match minutes). The first stall replans: the
Showrunner picks a storyline and assigns one specialist. A replan that is followed by another
stall with still no verified line falls back to a rules storyline, so the crew never loops on a
replan that produces nothing. A verified line resets the clock.
"""

from dataclasses import dataclass, field
from typing import Callable, Literal

STALL_S = 60.0  # wall time with no verified line before the Showrunner acts
Step = Literal["wait", "replan", "fallback"]


@dataclass
class StallClock:
    clock: Callable[[], float]
    last_line: float = field(init=False)
    replanned: bool = field(default=False, init=False)

    def __post_init__(self) -> None:
        self.last_line = self.clock()

    def note_line(self) -> None:
        """A verified line aired: the match is not quiet, so the clock and any replan reset."""
        self.last_line = self.clock()
        self.replanned = False

    def next_step(self) -> Step:
        """What the Showrunner does now. ``wait`` until a stall, then ``replan`` once, then
        ``fallback`` for each further stall with no verified line in between."""
        if self.clock() - self.last_line < STALL_S:
            return "wait"
        if self.replanned:
            return "fallback"
        return "replan"

    def note_replan(self) -> None:
        """The replan was made. The next stall with no verified line gets the fallback."""
        self.replanned = True
        self.last_line = self.clock()
