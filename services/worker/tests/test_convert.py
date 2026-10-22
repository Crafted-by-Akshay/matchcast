import json
import subprocess
import sys
from pathlib import Path

from matchcast_contracts import validate
from matchcast_worker.convert import roster_packet, slug, to_contract_events
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


def load_match(mid):
    path = ROOT / "apps/unified/sources/enterprise-console/data" / f"{mid}.json"
    return json.loads(path.read_text())


def reduce_match(mid):
    m = load_match(mid)
    teams = [m["home"], m["away"]]
    stream = {"tenant_id": "t", "session_id": "s", "match_id": f"m-{mid.lower()}"}
    repo = MemoryStateRepo()
    events = list(to_contract_events(m["events"], stream, teams))
    process(repo, events)
    return m, events, repo.get(f"t|s|m-{mid.lower()}")


def test_converted_matches_reduce_to_the_engine_score_per_team():
    checked = 0
    for mid in ("M004", "M009", "M017", "M025", "M028"):
        m, events, state = reduce_match(mid)
        assert state.max_sequence == len(events)
        score = [state.score.get(slug(m["home"]), 0), state.score.get(slug(m["away"]), 0)]
        assert score == m["score"]
        checked += sum(m["score"])
    assert checked > 5, "the matches must include goals, or the check proves nothing"


def test_periods_follow_the_half_time_event():
    m, events, _ = reduce_match("M017")
    half = next(e for e in m["events"] if e["type"] == "half_time")["minute"] * 60_000
    for e in events:
        late = e["event_time_ms"] > half
        assert e["clock"]["period"] == (2 if late else 1)
        assert e["clock"]["period_elapsed_ms"] == e["event_time_ms"] - (half if late else 0)
    assert any(e["clock"]["period"] == 1 and e["event_time_ms"] > 45 * 60_000 for e in events)


def test_shots_are_on_target_only_when_scored_or_marked():
    m, events, _ = reduce_match("M017")
    shots = [e["payload"] for e in events if e["payload"]["type"] == "shot"]
    goals = sum(
        1 for e in events if e["payload"]["type"] == "goal" and not e["payload"]["own_goal"]
    )
    assert sum(1 for p in shots if p["on_target"]) == goals


def test_replay_tool_writes_validated_jsonl(tmp_path):
    out = tmp_path / "m.jsonl"
    r = subprocess.run(
        [sys.executable, str(ROOT / "scripts/replay_match.py"), "--match", "M001", "--speed", "4",
         "--no-wait", "--out", str(out)],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    lines = out.read_text().splitlines()
    assert len(lines) == len(converted()[1]) and "replayed" in r.stderr


def test_http_sink_creates_the_match_before_posting_events(tmp_path):
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    seen = []

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append((self.path, body))
            self.send_response(201 if self.path == "/v1/matches" else 202)
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        subprocess.run(
            [sys.executable, str(ROOT / "scripts/replay_match.py"), "--match", "M001", "--sink",
             "http", "--url", f"http://127.0.0.1:{srv.server_port}", "--session-id", "sx",
             "--no-wait"],
            capture_output=True, text=True, check=True,
        )  # fmt: skip
    finally:
        srv.shutdown()
    assert seen[0][0] == "/v1/matches" and seen[0][1]["roster"]["kind"] == "roster"
    assert seen[0][1]["session_id"] == "sx"
    posted = [e for p, b in seen[1:] for e in b["events"]]
    assert all(p.startswith("/v1/matches/m-m001/events?session_id=sx") for p, _ in seen[1:])
    assert len(posted) == len(converted()[1])


def test_eventhub_sink_creates_the_match_then_publishes_by_stream_key(monkeypatch):
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    sys.path.insert(0, str(ROOT / "scripts"))
    import replay_match
    from replay_sinks import eventhub

    created, published = [], []

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            created.append(
                (self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            )
            self.send_response(201)
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *a):
            pass

    class Fake:
        closed = False

        async def publish(self, sk, events):
            published.append((sk, list(events)))

        async def close(self):
            Fake.closed = True

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(eventhub, "from_env", lambda: eventhub.EventHubSink(Fake()))
    try:
        replay_match.main(["--match", "M001", "--sink", "eventhub", "--no-wait",
                           "--url", f"http://127.0.0.1:{srv.server_port}", "--session-id", "sx",
                           "--tenant-id", "demo"])  # fmt: skip
    finally:
        srv.shutdown()
    assert created[0][0] == "/v1/matches" and len(created) == 1  # events do not go over HTTP
    assert {sk for sk, _ in published} == {"demo|sx|m-m001"}
    assert sum(len(b) for _, b in published) == len(converted()[1])
    assert all(len(b) <= 50 for _, b in published) and Fake.closed
