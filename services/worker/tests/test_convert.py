import json
import subprocess
import sys
from pathlib import Path

from matchcast_contracts import validate
from matchcast_worker.convert import roster_packet, to_contract_events
from matchcast_worker.repo import MemoryStateRepo, process

ROOT = Path(__file__).resolve().parents[3]
M001 = json.loads((ROOT / "apps/unified/sources/enterprise-console/data/M001.json").read_text())
STREAM = {"tenant_id": "t", "session_id": "s", "match_id": "m-1"}


def converted():
    teams = [M001["home"], M001["away"]]
    roster = roster_packet(STREAM, [(n, r["team"]) for n, r in M001["roster"].items()], teams)
    return roster, list(to_contract_events(M001["events"], STREAM, teams))


def test_season_match_converts_to_valid_contract_events_in_order():
    roster, events = converted()
    assert len(events) > 300
    for e in events:
        validate(e, roster=roster)
    seqs = [e["stream_sequence"] for e in events]
    assert seqs == list(range(1, len(events) + 1))
    assert [e["event_time_ms"] for e in events] == sorted(e["event_time_ms"] for e in events)


def test_converted_match_reduces_to_the_engine_score():
    _, events = converted()
    repo = MemoryStateRepo()
    process(repo, events)
    state = repo.get("t|s|m-1")
    assert state.max_sequence == len(events)
    assert sum(state.score.values()) == sum(M001["score"])


def test_replay_tool_writes_validated_jsonl(tmp_path):
    out = tmp_path / "m.jsonl"
    r = subprocess.run(
        [sys.executable, str(ROOT / "scripts/replay_match.py"), "--match", "M001", "--speed", "4",
         "--no-wait", "--out", str(out)],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    lines = out.read_text().splitlines()
    assert len(lines) == len(converted()[1]) and "replayed" in r.stderr
