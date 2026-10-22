import copy
import json
import random
from pathlib import Path

from matchcast_worker.reducer import StreamState, reduce
from matchcast_worker.repo import MemoryStateRepo, process

FIX = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "fixtures"


def fx(name):
    return json.loads((FIX / name).read_text())


def ev(seq, payload, event_id=None, revision=0, ms=None):
    e = fx("goal.json")
    e.update(event_id=event_id or f"e{seq}", stream_sequence=seq, revision=revision)
    e["event_time_ms"] = ms or seq * 1000
    e["payload"] = payload
    return e


def goal(team="home", player="home1"):
    return {"type": "goal", "player_id": player, "team_id": team, "own_goal": False,
            "position_unit": "m", "position": {"x": 100, "y": 34, "z": 0}}  # fmt: skip


def shot(team="home"):
    return {"type": "shot", "player_id": "home1", "team_id": team, "position_unit": "m",
            "position": {"x": 90, "y": 34, "z": 0}, "on_target": True}  # fmt: skip


def run(events):
    s = StreamState()
    for e in events:
        s = reduce(s, e)
    return s


def correction(seq, target_id, target_seq, scorer):
    c = ev(seq, {"type": "correction", "target_event_id": target_id,
                 "target_stream_sequence": target_seq, "target_revision": 0, "new_revision": 1,
                 "replacement": goal(player=scorer), "reason": "fixture"})  # fmt: skip
    return c


def test_same_event_twice_raises_the_revision_once():
    e = ev(1, goal())
    once = reduce(StreamState(), e)
    twice = reduce(once, e)
    assert twice is once and twice.revision == 1 and twice.score == {"home": 1}


def test_correction_replaces_the_scorer_and_removes_the_old_one():
    s = run([ev(1, goal(player="home1"), "g1"), correction(2, "g1", 1, "home2")])
    assert s.ledger["g1"].payload["player_id"] == "home2" and s.ledger["g1"].revision == 1
    assert s.score == {"home": 1}


def test_retraction_removes_the_goal():
    r = ev(3, {"type": "retraction", "target_event_id": "g1", "target_stream_sequence": 1,
               "target_revision": 0, "new_revision": 1, "reason": "offside"})  # fmt: skip
    s = run([ev(1, goal(), "g1"), ev(2, shot(), "s1"), r])
    assert s.score == {} and s.counts["shots"] == {"home": 1}


def test_stale_correction_target_is_ignored_but_counted_as_applied():
    c = correction(2, "g1", 1, "home2")
    c["payload"]["target_revision"] = 5
    s = run([ev(1, goal(player="home1"), "g1"), c])
    assert s.ledger["g1"].payload["player_id"] == "home1" and s.max_sequence == 2


def random_stream(rng, n=40):
    out, goals = [], []
    for seq in range(1, n + 1):
        roll = rng.random()
        team = rng.choice(["home", "away"])
        if roll < 0.2:
            goals.append((f"e{seq}", seq))
            out.append(ev(seq, goal(team), f"e{seq}"))
        elif roll < 0.3 and goals:
            tid, tseq = rng.choice(goals)
            out.append(correction(seq, tid, tseq, "home2"))
        else:
            out.append(ev(seq, shot(team)))
    return out


def test_duplicates_and_restarts_give_the_same_state():
    rng = random.Random(11)
    for _ in range(200):
        stream = random_stream(rng)
        clean = run(stream)
        noisy = []
        for e in stream:
            noisy.append(e)
            noisy += [
                copy.deepcopy(rng.choice(stream[: stream.index(e) + 1]))
                for _ in range(rng.randint(0, 3))
            ]
        assert run(noisy).model_dump() == clean.model_dump()
        assert run(stream + stream).model_dump() == clean.model_dump()


def test_replay_from_the_start_matches_the_original_run_through_the_repo():
    rng = random.Random(3)
    stream = random_stream(rng, 60)
    repo = MemoryStateRepo()
    first = process(repo, stream)
    sk = "tenant-demo|session-demo|match-demo"
    original = repo.get(sk)
    assert process(repo, stream) == []
    assert repo.get(sk).model_dump() == original.model_dump()
    assert len(first) == 60 and first[-1]["snapshot"]["state_revision"] == 60
    assert [r.revision for r in repo.revisions(sk)] == list(range(1, 61))
