"""Export the 28-match synthetic season to Parquet (docs/architecture/07 §6).

Reads apps/unified/sources/enterprise-console/data/M*.json and writes matches, team_match_stats
and player_match_stats to data/season/v1/. The Blob upload is a separate deploy step.
"""

import json
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "apps/unified/sources/enterprise-console/data"
OUT = ROOT / "data/season/v1"

TEAM_SOURCE = {
    "shots": "shots",
    "xg": "xg",
    "passes": "passes",
    "passes_completed": "passesCompleted",
    "possession_pct": "possessionPct",
    "fouls": "fouls",
    "yellow_cards": "yellowCards",
    "red_cards": "redCards",
    "offsides": "offsides",
}


def load(source: Path = SOURCE) -> dict[str, list[dict]]:
    matches, teams, players = [], [], []
    for path in sorted(source.glob("M*.json")):
        m = json.loads(path.read_text())
        s = m["sum"]
        ids = (m["home"], m["away"])
        matches.append(
            {
                "match_id": m["id"],
                "date": m["date"],
                "home_team_id": ids[0],
                "away_team_id": ids[1],
                "score_home": m["score"][0],
                "score_away": m["score"][1],
                "venue": m["setup"]["stadium"],
            }
        )
        for i, side in enumerate(("home", "away")):
            teams.append(
                {
                    "match_id": m["id"],
                    "team_id": ids[i],
                    "side": side,
                    "goals": m["score"][i],
                    **{col: s[key][i] for col, key in TEAM_SOURCE.items()},
                }
            )
        for p in s["playerTracking"]:
            players.append(
                {"match_id": m["id"], "player": p["name"], "team_id": p["team"],
                 "passes": p["passesAttempted"], "passes_completed": p["passesCompleted"],
                 "tackles": p["tackles"], "shots": p["shots"], "xg": p["xg"],
                 "distance_km": p["distanceKm"]}
            )  # fmt: skip
    return {"matches": matches, "team_match_stats": teams, "player_match_stats": players}


def export(out: Path = OUT, source: Path = SOURCE) -> dict[str, int]:
    out.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    counts = {}
    for name, rows in load(source).items():
        scratch = out / f"{name}.json"
        scratch.write_text(json.dumps(rows))
        target = out / f"{name}.parquet"
        con.execute(
            f"COPY (SELECT * FROM read_json_auto('{scratch}')) TO '{target}' (FORMAT parquet)"
        )
        scratch.unlink()
        counts[name] = len(rows)
    return counts


if __name__ == "__main__":
    print(json.dumps(export(), indent=2))
    sys.exit(0)
