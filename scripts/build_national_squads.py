"""Synthetic squads for national teams, strength and style from the martj42 results (CC0).

Every player is fictional: the names are made here from small per-country lists and checked
against a list of real footballers' surnames. Ratings come from the nation's Elo; the
attacking and defensive style come from its goals for and against in the last ten matches.
The output is data/history/national_squads.json, and each squad is marked synthetic.

Usage: python3 scripts/build_national_squads.py
"""

from __future__ import annotations

import json
import random
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages/agents"))

from matchcast_agents.history import _before, _elo_ratings, _key, resolve_team  # noqa: E402

OUT = ROOT / "data/history/national_squads.json"
AS_OF = date(2026, 10, 25)
NATIONS = ["Argentina", "Brazil"]
RECENT = 10

# Locale lists: invented names that are not footballers' names. Checked against REAL below.
LOCALE = {
    "Argentina": (
        [
            "Tomás",
            "Ignacio",
            "Benicio",
            "Santino",
            "Julián",
            "Bautista",
            "Ramiro",
            "Thiago",
            "Ezequiel",
            "Joaquín",
            "Matías",
            "Lisandro",
            "Facundo",
            "Mauro",
        ],
        [
            "Ferrante",
            "Quiroga",
            "Salvatierra",
            "Arrieta",
            "Belmonte",
            "Caruso",
            "Escobedo",
            "Fraga",
            "Iriarte",
            "Lucero",
            "Montenegro",
            "Quintana",
            "Tapia",
            "Vallejo",
        ],
    ),
    "Brazil": (
        [
            "Gabriel",
            "Rafael",
            "Caio",
            "Enzo",
            "Davi",
            "Murilo",
            "Heitor",
            "Otávio",
            "Samuel",
            "Raul",
            "Lucas",
            "Arthur",
            "Vinícius",
            "Bernardo",
        ],
        [
            "Azevedo",
            "Bittencourt",
            "Duarte",
            "Faria",
            "Guimarães",
            "Lacerda",
            "Macedo",
            "Nogueira",
            "Pacheco",
            "Queiroz",
            "Rangel",
            "Salgado",
            "Teixeira",
            "Viana",
        ],
    ),
}

# The layout of a 23-man squad: (position, count), in shirt-number order.
LAYOUT = [("GK", 3), ("DF", 8), ("MF", 7), ("FW", 5)]

# Surnames and full names of well-known footballers, folded. Mirrors tests/test_synthetic_names.py
# and adds the best-known Argentina and Brazil players, so an invented name never lands on one.
REAL_SURNAMES = {
    "messi",
    "maradona",
    "aguero",
    "dimaria",
    "martinez",
    "alvarez",
    "otamendi",
    "fernandez",
    "mac allister",
    "neymar",
    "pele",
    "kaka",
    "ronaldinho",
    "romario",
    "rivaldo",
    "ronaldo",
    "rodrygo",
    "casemiro",
    "marquinhos",
    "alisson",
    "ederson",
    "richarlison",
    "paqueta",
    "raphinha",
    "coutinho",
    "firmino",
    "cafu",
    "silva",
    "luiz",
    "antony",
    "gerson",
    "leao",
    "felix",
    "guimaraes",
}
REAL_FULL = {"lionel messi", "diego maradona", "neymar jr", "dibu martinez", "gabriel jesus"}


def _is_real(name: str) -> bool:
    """True when the surname or the full name is on the real-footballer list.

    A name that merely contains a real first name, such as "Enzo", is not rejected.
    """
    surname = _key(name.split()[-1])
    return surname in REAL_SURNAMES or _key(name) in {_key(n) for n in REAL_FULL}


def _recent(team: str, on: date) -> tuple[float, float]:
    """Goals for and against per match over the last RECENT games before `on`."""
    games = [m for m in _before(on) if team in (m[1], m[2])][-RECENT:]
    if not games:
        return 1.3, 1.3
    gf = sum(m[3] if m[1] == team else m[4] for m in games) / len(games)
    ga = sum(m[4] if m[1] == team else m[3] for m in games) / len(games)
    return round(gf, 2), round(ga, 2)


def _squad(nation: str, elo: float, rng: random.Random) -> list[dict]:
    firsts, lasts = LOCALE[nation]
    base = min(88.0, max(55.0, 60.0 + (elo - 1500.0) / 25.0))
    players, number = [], 0
    used: set[str] = set()
    for position, count in LAYOUT:
        for _ in range(count):
            number += 1
            for _attempt in range(50):
                name = f"{rng.choice(firsts)} {rng.choice(lasts)}"
                if name not in used and not _is_real(name):
                    break
            else:
                raise RuntimeError(f"could not find a fictional name for {nation}")
            used.add(name)
            players.append(
                {
                    "name": name,
                    "shirt": number,
                    "position": position,
                    "rating": round(base + rng.uniform(-4, 4), 1),
                    "synthetic": True,
                }
            )
    return players


def build(as_of: date = AS_OF) -> dict:
    ratings = _elo_ratings(as_of)
    out = {}
    for nation in NATIONS:
        name = resolve_team(nation)
        if name is None:
            raise SystemExit(f"{nation} is not in the results file")
        elo = ratings[name]
        gf, ga = _recent(name, as_of)
        rng = random.Random(f"{name}:{as_of.isoformat()}")
        out[name] = {
            "elo": round(elo, 1),
            "style": {"attack": gf, "defence": ga},
            "label": "synthetic squad",
            "players": _squad(name, elo, rng),
        }
    return out


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
