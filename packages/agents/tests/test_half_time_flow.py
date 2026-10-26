"""Half-time explainer in the workflow (CREW-7.4, AB#465): verified lines, claims stored."""

from conftest import run


def test_no_piece_before_the_first_half_has_ended(make_workflow) -> None:
    flow = make_workflow()
    assert run(flow.half_time()) is None


def test_the_workflow_writes_a_verified_half_time_piece(make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    piece = run(flow.half_time())
    assert piece is not None
    assert piece["persona"] == "half_time"
    assert piece["text"]
    assert piece["lines_dropped"] == 0
    for claim_id in piece["claim_ids"]:
        assert flow.store.get_claim(flow.sk, claim_id) is not None
    assert piece["text"] == run(flow.half_time())["text"]  # the same piece on a second call


def test_the_piece_cites_only_first_half_events(make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    piece = run(flow.half_time())
    first_half = {e["event_id"] for e in match["events"] if e["stream_sequence"] <= 137}
    assert set(piece["source_event_ids"]) <= first_half
    assert piece["cut_sequence"] == 137


def second_half_events(match):
    """Two period-2 goals after full time, copied from a real goal so the payload is valid."""
    goal = next(e for e in match["events"] if e["payload"]["type"] == "goal")
    last = match["events"][-1]["stream_sequence"]
    later = []
    for offset in (1, 2):
        seq = last + offset
        later.append(
            {
                **goal,
                "event_id": f"e{seq}",
                "stream_sequence": seq,
                "event_time_ms": 3_000_000 + offset,
                "clock": {"period": 2, "period_elapsed_ms": 600_000 + offset},
            }
        )
    return later


def test_the_piece_cites_only_first_half_events_even_with_later_ones(make_workflow, match) -> None:
    flow = make_workflow()
    later = second_half_events(match)
    run(flow.ingest([*match["events"], *later]))
    piece = run(flow.half_time())
    assert piece["cut_sequence"] == 137
    assert later[0]["event_id"] not in piece["source_event_ids"]
    assert set(piece["source_event_ids"]) <= {e["event_id"] for e in match["events"]}


def test_the_verifier_view_holds_no_later_events_truth_or_storylines(make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest([*match["events"], *second_half_events(match)]))
    seen = []
    original = flow._call

    async def spy(agent, method, subject, *args, **kwargs):
        if method == "check":
            seen.append(args[0])  # the Verifier's half-time view, the first argument after the line
        return await original(agent, method, subject, *args, **kwargs)

    flow._call = spy
    run(flow.half_time())
    assert seen, "the Verifier was not called"
    for view in seen:
        assert max(e["stream_sequence"] for e in view.events) <= 137
        assert view.truth == ()
        assert "storylines" not in view.extra and "vision_passes" not in view.extra
