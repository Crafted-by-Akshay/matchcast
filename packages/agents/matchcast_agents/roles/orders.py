"""Role bounds for player orders: what a manager may ask of each player, decided in code.

The keys are the simulator's own order keys (apps/unified/sources/3d-source/v2/talk.js). The API
checks every order before it is returned, and the Watch hook applies only the orders the API
accepted. A prompt is not the bound: a keeper's model can say anything, the guard still refuses.
"""

import re
from dataclasses import dataclass

NONE = "none"  # the manager said nothing that is an order: he is only talking
CLEAR = "clear"  # cancelling an order is always allowed
ORDER_KEYS = frozenset(
    {"push", "deep", "wide", "inside", "press", "mark", "shoot", "simple", "runs", "rest", CLEAR}
)

GROUP_OF = {
    "GK": "keeper",
    "CB": "centre_back",
    "LB": "fullback",
    "RB": "fullback",
    "LWB": "fullback",
    "RWB": "fullback",
    "DM": "midfield",
    "CM": "midfield",
    "LM": "midfield",
    "RM": "midfield",
    "AM": "midfield",
    "LW": "forward",
    "RW": "forward",
    "ST": "forward",
}
POSITIONS = frozenset(GROUP_OF)
# A keeper is asked about his line, his distribution and his rest. He is never sent upfield.
GROUP_ORDERS = {
    "keeper": frozenset({"deep", "simple", "rest"}),
    "centre_back": frozenset({"push", "deep", "mark", "simple", "rest"}),
    "fullback": frozenset({"push", "deep", "wide", "runs", "mark", "simple", "rest"}),
    "midfield": ORDER_KEYS - {CLEAR},
    "forward": frozenset(
        {"push", "deep", "wide", "inside", "press", "shoot", "runs", "simple", "rest"}
    ),
    "unknown": frozenset({"deep", "simple", "rest"}),  # no position sent: the most restrictive set
}  # fmt: skip

# What he says back when an order is accepted. Each line passes the Verifier: no digits, no names.
ACK = {
    "push": "Higher it is, boss.",
    "deep": "Got it, boss. I'll hold the shape behind.",
    "wide": "Wide it is, boss. Find me early.",
    "inside": "Coming inside, boss.",
    "press": "Pressing now, boss.",
    "mark": "Shadowing him, boss.",
    "shoot": "Shooting on sight, boss.",
    "simple": "Two touches, boss. Safe.",
    "runs": "Running the channels, boss.",
    "rest": "Thanks, boss. I'll pick my moments.",
    CLEAR: "Back to the plan, boss.",
}
# What he says back when an order is outside his role. The sim does not change.
REFUSAL = {
    "keeper": "Not from my line, boss. I stay on my line and keep the shape.",
    "centre_back": "Not from the back line, boss. I'll keep the shape and cover.",
    "fullback": "I can't go that far forward, boss. I'd leave the back door open.",
    "midfield": "Not from the middle, boss. I'll keep the shape.",
    "forward": "Not from the front, boss. I'm the one who finishes, not the one who marks.",
    "unknown": (
        "I don't know my role in this match, boss, so I won't take that. "
        "I can hold my shape, keep it simple or rest."
    ),
}

# The rules-mode reading of a typed or spoken instruction, the same words the sim's parser hears.
_RULES = (
    (CLEAR, re.compile(r"forget|as you were|cancel|\bnormal\b|\breset\b")),
    ("rest", re.compile(r"\brest\b|\blegs\b|breath|\btired\b|\beasy\b|conserve")),
    (
        "shoot",
        re.compile(r"\bshoot|shot on sight|take (a |the |your )?shot|\bstrike\b|hit it|\brange\b"),
    ),
    ("mark", re.compile(r"\bmark|\bfollow\b|\btrack\b|shadow|man.?to.?man")),
    ("press", re.compile(r"\bpress|\bhunt\b|close down|harass|win (it|the ball) back")),
    ("runs", re.compile(r"\brun|behind|channel|over the top|\bspace\b")),
    ("simple", re.compile(r"simple|\bsafe\b|keep (the )?ball|possession|\bcalm\b")),
    ("wide", re.compile(r"\bwide|width|touchline|stretch")),
    ("inside", re.compile(r"inside|\btuck|narrow|half.?space|\bcentre\b|\bcenter\b")),
    ("deep", re.compile(r"\bdeep|\bback\b|\bdrop\b|defend|\bsit\b")),
    ("push", re.compile(r"\bpush|higher|up the pitch|forward|attack|squeeze")),
)


_NEGATED = re.compile(r"\b(don'?t|do not|stop|never|no need to|not)\b")


@dataclass(frozen=True)
class OrderDecision:
    key: str
    accepted: bool
    line: str  # what he says back: the acknowledgement, or the refusal


def group_of(position: str | None) -> str:
    return GROUP_OF.get(position or "", "unknown")


def allowed_orders(position: str | None) -> frozenset[str]:
    return GROUP_ORDERS[group_of(position)] | {CLEAR}


def decide(position: str | None, key: str) -> OrderDecision:
    """Whether an order reaches the sim for this player, and what he says about it."""
    accepted = key in allowed_orders(position)
    line = ACK[key] if accepted else REFUSAL[group_of(position)]
    return OrderDecision(key, accepted, line)


def keyword_order(utterance: str) -> str:
    """The order a typed instruction means in rules mode; a question or a negation is no order."""
    text = utterance.casefold()
    if "?" in text or _NEGATED.search(text):
        return NONE
    for key, pattern in _RULES:
        if pattern.search(text):
            return key
    return NONE
