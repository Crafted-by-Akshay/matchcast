"""Players must be fictional: no squad, default team or season roster uses a real surname.

The blocklist holds distinctive surnames of well-known footballers (folded to ASCII, lower case).
Add to it when a real name is spotted. Common surnames that many people share are left out on
purpose; the rule is about recognisable players, not about every name that exists somewhere.
"""

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "apps/unified/sources/enterprise-console/data"
ENGINES = [
    ROOT / "apps/unified/sources/3d-source/v2/main.js",
    ROOT / "apps/unified/sources/broadcaster-console/engine/main.js",
]

BLOCKLIST = set(
    """
    messi ronaldo neymar mbappe haaland modric salah benzema lewandowski griezmann bellingham saka
    rodri pedri gavi vinicius kante iniesta xhaka arbeloa cuadrado eriksen coman olmo zielinski
    lozano falcao guerreiro fofana jovanovic ilicic kroos casemiro courtois alisson ederson
    fernandes sterling rashford foden grealish mahrez firmino mane suarez cavani aguero dybala
    lautaro osimhen leao pulisic pogba matuidi lloris giroud dembele tchouameni camavinga
    musiala gundogan sane kimmich neuer muller havertz rudiger hakimi ziyech sancho lukaku
    hazard tielemans doku trossard onana szczesny mitrovic tadic kvaratskhelia donnarumma
    chiesa barella insigne immobile verratti locatelli bonucci chiellini zaniolo spinazzola
    isak gyokeres odegaard ramsdale gabriel jesus martinelli xavi puyol busquets piqué pique
    iker casillas sergio alba jordi carvajal nacho morata asensio isco koke saul oblak
    """.split()
)


def fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def surnames(names) -> set[str]:
    return {fold(n.split(". ", 1)[-1].split(" ")[-1]) for n in names}


def league_names() -> list[str]:
    clubs = json.loads((DATA / "league.json").read_text())["clubs"]
    return [p["name"] for c in clubs for p in c["squad"]]


def default_team_names(path: Path) -> list[str]:
    text = path.read_text()
    block = text[text.index("const TEAMS = ["):]
    block = block[: block.index("];")]
    return re.findall(r"\[\d+, '([^']+)'", block)


def test_league_squads_are_fictional() -> None:
    names = league_names()
    assert len(names) == 88
    assert not surnames(names) & BLOCKLIST


def test_default_teams_are_fictional_in_both_engine_copies() -> None:
    for engine in ENGINES:
        names = default_team_names(engine)
        assert len(names) == 22, engine
        assert not surnames(names) & BLOCKLIST, engine


def test_season_rosters_match_the_league_and_are_fictional() -> None:
    squad = set(league_names())
    for path in sorted(DATA.glob("M0*.json")):
        roster = json.loads(path.read_text())["roster"]
        assert set(roster) <= squad, path.name
        assert not surnames(roster) & BLOCKLIST, path.name


def test_blocklist_catches_the_names_it_was_written_for() -> None:
    assert surnames(["K. Kanté", "T. Arbeloa", "J. Olmo"]) <= BLOCKLIST
