"""The season's club codes (TRV, HAR, ...) by club name, from the generated profiles in kb/clubs.

A live match names its sides by roster id (``home``, a Watch club key); the season data is keyed by
club code, so the Stats Desk call resolves the match's club *name* to a code. A name the season does
not know gives None and the comparison is league-wide (and says so in the audit).
"""

from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def _codes() -> dict[str, str]:
    root = next(
        (p / "kb" / "clubs" for p in Path(__file__).resolve().parents if (p / "kb").is_dir()), None
    )
    out: dict[str, str] = {}
    for path in sorted(root.glob("*.md")) if root else []:
        title = code = ""
        for line in path.read_text(encoding="utf-8").splitlines()[1:6]:
            if line.startswith("title:"):
                title = line.split(":", 1)[1].strip()
            elif line.startswith("entities:"):
                code = line.split(":", 1)[1].strip().split(",")[0].strip()
        if title and code:
            out[title.casefold()] = code
    return out


def season_code(club: str | None, team_id: str | None = None) -> str | None:
    """The season's code for a club name (or for a team id that already is a code)."""
    codes = _codes()
    if club and club.casefold() in codes:
        return codes[club.casefold()]
    if team_id and team_id.upper() in codes.values():
        return team_id.upper()
    return None
