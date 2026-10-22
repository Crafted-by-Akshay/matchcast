"""Every browser spec uses the shared fixtures (network guard against Azure) and synthetic clubs."""

import re
from pathlib import Path

SPECS = sorted(Path(__file__).parent.joinpath("e2e").glob("*.spec.ts"))
REAL_CLUBS = re.compile(
    r"\b(Arsenal|Chelsea|Liverpool|Barcelona|Real Madrid|Manchester|Bayern|Juventus|Tottenham)\b"
)


def test_specs_found():
    assert len(SPECS) > 20


def test_every_spec_imports_test_from_fixtures():
    bad = [s.name for s in SPECS if "from './fixtures'" not in s.read_text()]
    assert bad == [], f"import test from './fixtures' so the Azure network guard runs: {bad}"


def test_no_real_club_names_in_specs():
    bad = [s.name for s in SPECS if REAL_CLUBS.search(s.read_text())]
    assert bad == [], f"the data is synthetic; use the fictional clubs: {bad}"
