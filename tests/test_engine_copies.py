"""The Broadcast engine copies the Watch engine; shared files stay byte-identical (DAT-9).

services/simulation/tests/checks.cjs checks the same in the e2e job; this one runs under make test.
"""

from pathlib import Path

SOURCES = Path(__file__).resolve().parent.parent / "apps" / "unified" / "sources"
WATCH = SOURCES / "3d-source" / "v2"
BROADCAST = SOURCES / "broadcaster-console" / "engine"


def test_copies_exist():
    assert len(list(BROADCAST.iterdir())) >= 10


def test_broadcast_engine_equals_watch_engine():
    drifted = []
    for f in sorted(BROADCAST.iterdir()):
        twin = WATCH / f.name
        if f.is_file() and (not twin.is_file() or f.read_bytes() != twin.read_bytes()):
            drifted.append(f.name)
    assert drifted == [], f"edit both copies of the engine identically: {drifted}"
