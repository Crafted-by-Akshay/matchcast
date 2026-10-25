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
    assert all(eid for eid in piece["source_event_ids"])
    assert piece["cut_sequence"] == 137
