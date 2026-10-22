"""The Broadcast engine copies the Watch engine; shared files stay byte-identical (DAT-9)."""

from pathlib import Path

SOURCES = Path(__file__).resolve().parent.parent / "apps" / "unified" / "sources"
WATCH = SOURCES / "3d-source" / "v2"
BROADCAST = SOURCES / "broadcaster-console" / "engine"


def test_copies_exist():
    assert len(list(BROADCAST.iterdir())) >= 10


def test_broadcast_engine_equals_watch_engine():
    drifted = [
        f.name
        for f in sorted(BROADCAST.iterdir())
        if f.read_bytes() != (WATCH / f.name).read_bytes()
    ]
    assert drifted == [], f"edit both copies of the engine identically: {drifted}"
