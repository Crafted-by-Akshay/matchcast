"""Read-only match tools, bound to ``up_to_sequence`` so an agent cannot read the future."""

from typing import Any

from ..context import MatchContext

MAX_EVENTS = 200
MAX_RESULT_BYTES = 20_000
METRIC_UNITS = {
    "goals": "count",
    "shots": "count",
    "shots_on_target": "count",
    "tackles_won": "count",
    "fouls": "count",
    "cards": "count",
    "red_cards": "count",
}
DERIVATION_VERSION = "1.0.0"

TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "get_state": {
        "description": "Score, clock, possession and the last 10 event ids.",
        "parameters": {},
    },
    "get_events": {
        "description": "Contract events in a sequence range (max 200).",
        "parameters": {"from_seq": "int", "to_seq": "int", "kinds": "list[str]"},
    },
    "get_metrics": {
        "description": "Metric values as '<name>:<team_id>' with units and derivation_version.",
        "parameters": {"names": "list[str]"},
    },
}


class ToolError(Exception):
    """A tool call failed; the caller must not guess a value (audit fallback reason tool_error)."""

    def __init__(self, tool: str, detail: str):
        self.tool = tool
        super().__init__(f"{tool}: {detail}")


class InProcessTools:
    """One instance per task; ``calls`` is the record the claims cite as tool_call_ids."""

    def __init__(
        self, ctx: MatchContext, up_to_sequence: int, *, fail: frozenset[str] = frozenset()
    ) -> None:
        self._ctx = ctx
        self._up_to = up_to_sequence
        self._fail = fail
        self.calls: list[dict[str, Any]] = []

    def _call(self, tool: str, args: dict[str, Any], result: dict[str, Any]) -> tuple[str, dict]:
        call_id = f"tc-{len(self.calls) + 1}"
        self.calls.append({"call_id": call_id, "tool": tool, "args": args})
        return call_id, result

    def _check(self, tool: str) -> None:
        if tool in self._fail:
            raise ToolError(tool, "unavailable")

    def get_state(self) -> tuple[str, dict[str, Any]]:
        self._check("get_state")
        state = self._ctx.state
        return self._call(
            "get_state",
            {},
            {
                "score": dict(state.score),
                "clock_ms": state.event_time_ms,
                "possession": state.possession,
                "revision": state.revision,
                "last_events": list(state.last_events),
                "up_to_sequence": self._up_to,
            },
        )

    def get_events(
        self, from_seq: int, to_seq: int, kinds: list[str] | None = None
    ) -> tuple[str, dict[str, Any]]:
        self._check("get_events")
        to_seq = min(to_seq, self._up_to)
        rows = [
            e
            for e in self._ctx.events
            if from_seq <= e["stream_sequence"] <= to_seq
            and (not kinds or e["payload"]["type"] in kinds)
        ][:MAX_EVENTS]
        return self._call("get_events", {"from_seq": from_seq, "to_seq": to_seq}, {"events": rows})

    def get_metrics(self, names: list[str]) -> tuple[str, dict[str, Any]]:
        self._check("get_metrics")
        values = {}
        for name in names:
            metric, _, team = name.partition(":")
            if metric not in METRIC_UNITS or not team:
                raise ToolError("get_metrics", f"unknown metric {name}")
            values[name] = {
                "value": self._ctx.state.count(metric, team),
                "units": METRIC_UNITS[metric],
                "derivation_version": DERIVATION_VERSION,
            }
        return self._call("get_metrics", {"names": names}, {"values": values})
