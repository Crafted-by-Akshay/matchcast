"""What a player may know beyond the match log: both squads, and the knowledge base (kb/).

The squads come from the kb's club pages (shirt, name, position, rating). Only the name and the
position in words reach the model: a shirt number or a rating would be a digit the Verifier cannot
tie to the log. The knowledge base passages about the speaker and the question are background in
words too; their numbers are never repeated.
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from ..ask.chunking import load_kb
from ..ask.retrieval import Bm25Index

POSITION_WORDS = {
    "GK": "goalkeeper",
    "RB": "right back",
    "LB": "left back",
    "CB": "centre back",
    "DM": "defensive midfielder",
    "CM": "central midfielder",
    "LW": "left winger",
    "RW": "right winger",
    "ST": "striker",
}
SQUAD_ROW = re.compile(r"^\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*([A-Z]{1,3})\s*\|", re.MULTILINE)
TITLE = re.compile(r"^title:\s*(.+?)\s*$", re.MULTILINE)
PASSAGES = 3  # knowledge passages a reply may draw on
PASSAGE_CHARS = 420  # a passage is a paragraph for the model, not a page
FIGURE_SECTIONS = re.compile(r"record|result", re.IGNORECASE)


@dataclass(frozen=True)
class Squad:
    club: str
    players: tuple[tuple[str, str], ...] = field(default_factory=tuple)  # (name, position in words)

    def lines(self) -> list[str]:
        return [f"{name}, {position}" for name, position in self.players]


def parse_squad(text: str) -> Squad | None:
    """The squad of one club page, or None when the page has no squad table."""
    title = TITLE.search(text)
    rows = [
        (name.strip(), POSITION_WORDS.get(code, code.lower()))
        for name, code in SQUAD_ROW.findall(text)
    ]
    if title is None or not rows:
        return None
    return Squad(club=title.group(1), players=tuple(rows))


def load_squads(root: Path) -> dict[str, Squad]:
    squads = {}
    for path in sorted((root / "clubs").glob("*.md")):
        squad = parse_squad(path.read_text(encoding="utf-8"))
        if squad is not None:
            squads[squad.club] = squad
    return squads


def _passage(text: str) -> str:
    """The passage as words: markup gone, and every token that carries a digit dropped."""
    flat = re.sub(r"[`*_#|]", "", text)
    words = [w for w in flat.split() if not re.search(r"\d", w)]
    return " ".join(words)[:PASSAGE_CHARS]


@dataclass(frozen=True)
class TalkKnowledge:
    squads: dict[str, Squad]
    index: Bm25Index

    def team_sheet(self, clubs: Iterable[str]) -> dict[str, list[str]]:
        """Each club's squad as the model may name it: `name, position` lines, no numbers."""
        return {club: self.squads[club].lines() for club in clubs if club in self.squads}

    def passages(self, query: str) -> list[str]:
        """The knowledge passages that best match the speaker's name and the manager's words.

        Season records and results are left out: they are figures, and a figure the log does not
        give would be said as fact.
        """
        hits = self.index.search(query, k=PASSAGES * 3)
        kept = [hit for hit in hits if not FIGURE_SECTIONS.search(hit.chunk.section)]
        return [_passage(hit.chunk.text) for hit in kept[:PASSAGES]]

    @classmethod
    def from_kb(cls, root: Path) -> "TalkKnowledge":
        return cls(squads=load_squads(root), index=Bm25Index(load_kb(root)))
