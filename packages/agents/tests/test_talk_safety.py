"""Talk (EXP-16): Content Safety screens a checked reply before it is shown or spoken."""

from conftest import run
from matchcast_agents.safety import SafetyResult, ShieldResult


class UnsafeScreen:
    async def analyze(self, text: str) -> SafetyResult:
        return SafetyResult(allowed=False, categories={"Hate": 4}, source="test")

    async def shield(self, user_prompt: str) -> ShieldResult:
        return ShieldResult(attack_detected=False, source="test")


def test_an_unsafe_reply_is_refused_and_audited(make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    flow.safety = UnsafeScreen()
    reply = run(flow.talk("home9", "How many shots have you had?"))
    assert reply["verdict"] == "rejected" and reply["facts"] == {}
    assert reply["reply"] == "I can't confirm that from the match data yet."
    records = flow.store.audit_records(flow.sk)
    assert any(r.get("action") == "safety_blocked" for r in records)
