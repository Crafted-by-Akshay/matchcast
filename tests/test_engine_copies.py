"""The Broadcast engine copies the Watch engine; shared files stay byte-identical (DAT-9).

services/simulation/tests/checks.cjs checks the same in the e2e job; this one runs under make test.
"""

import re
from pathlib import Path

SOURCES = Path(__file__).resolve().parent.parent / "apps" / "unified" / "sources"
WATCH = SOURCES / "3d-source" / "v2"
BROADCAST = SOURCES / "broadcaster-console" / "engine"
# browsers round these differently and the match is chaotic: the engine uses DM.* (top of main.js)
NATIVE_TRIG = re.compile(r"Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|log|pow|hypot)\(|\*\*")


def test_copies_exist():
    assert len(list(BROADCAST.iterdir())) >= 10


def test_broadcast_engine_equals_watch_engine():
    drifted = []
    for f in sorted(BROADCAST.iterdir()):
        twin = WATCH / f.name
        if f.is_file() and (not twin.is_file() or f.read_bytes() != twin.read_bytes()):
            drifted.append(f.name)
    assert drifted == [], f"edit both copies of the engine identically: {drifted}"


def test_engine_uses_deterministic_maths():
    found = []
    for f in sorted(WATCH.glob("*.js")):
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if NATIVE_TRIG.search(line):
                found.append(f"{f.name}:{n}")
    assert found == [], f"use DM.sin, DM.pow, ... (top of main.js), not native Math: {found}"
