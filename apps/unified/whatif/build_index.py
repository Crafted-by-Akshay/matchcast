"""Writes whatif/clips/index.json from the runner's whatif.json files.

    python3 whatif/build_index.py N001 deeper=/x/deeper/whatif.json higher=/x/higher/whatif.json

The runner is services/simulation/run.cjs (--season N001, with --move or --whatif). Each clip keeps
the runner's pairs (per seed: untouched and what-if numbers after the change), its 1 Hz tracking
samples and the player names, plus the two teams from shared/fixtures.json and a label written from
the change. The build copies the index to analyst/data/whatif/.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
FIXTURES = HERE.parent / "shared" / "fixtures.json"
OUT = HERE / "clips" / "index.json"


def describe(change, names):
    if change.get("kind") == "move":
        dx, dy = change["dx"], change["dy"]
        parts = []
        if dx:
            parts.append(f"{abs(dx)} m {'deeper' if dx < 0 else 'higher'}")
        if dy:
            parts.append(f"{abs(dy)} m {'left' if dy < 0 else 'right'}")
        moved = " and ".join(parts)
        return f"{names[change['pi']]} moves {moved}, minute {change['minute']}"
    side = "Home" if change["ti"] == 0 else "Away"
    return f"{side} switch to {change['form']}, minute {change['minute']}"


def team(fixture, side):
    t = fixture[side]
    return {"key": t["key"], "club": t["club"], "color": t["color"]}


def main(match, pairs):
    fixture = next(f for f in json.loads(FIXTURES.read_text()) if f["id"] == match)
    clips = []
    for spec in pairs:
        name, path = spec.split("=", 1)
        run = json.loads(pathlib.Path(path).read_text())
        names = run["track"]["names"]
        clips.append({
            "id": f"{match}-{name}", "match": match, "name": name,
            "label": describe(run["change"], names), "change": run["change"],
            "teams": {"home": team(fixture, "home"), "away": team(fixture, "away")},
            "fixture": run["fixture"], "pairs": run["pairs"], "track": run["track"],
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"clips": clips}, separators=(",", ":")))
    print("wrote", OUT, len(clips), "clips", OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
