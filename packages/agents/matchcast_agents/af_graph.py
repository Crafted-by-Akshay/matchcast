"""The per-event agent graph on Microsoft Agent Framework (04-agents.md §3, ADR-0002).

One executor per box: Producer, Analyst, Narrator, Verifier and the Stats Desk. Edges carry the
small dataclasses below, and the Stats Desk edge is conditional (priority 1 moments only). The
executors call the same ``MatchWorkflow`` steps as the native path, so a test can run both and
compare. The repair router and the approval step run inside the Verifier executor
(``_verify_line``), where the one-repair rule lives. A new Workflow is built per event because an
Agent Framework workflow instance refuses concurrent runs; the api already serialises events per
match.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from agent_framework import Executor, WorkflowBuilder, WorkflowContext, handler

from .context import MatchContext
from .messages import DraftLine, ProducerTask

if TYPE_CHECKING:
    from .workflow import MatchWorkflow


@dataclass
class Incoming:
    ctx: MatchContext
    event: dict[str, Any]


@dataclass
class Tasked:
    ctx: MatchContext
    task: ProducerTask


@dataclass
class Analysed:
    ctx: MatchContext
    task: ProducerTask
    claims: list[dict[str, Any]]


@dataclass
class Drafted:
    ctx: MatchContext
    task: ProducerTask
    claims: list[dict[str, Any]]
    drafts: list[DraftLine]


@dataclass
class Verified:
    task: ProducerTask


class ProducerExecutor(Executor):
    def __init__(self, flow: "MatchWorkflow") -> None:
        super().__init__(id="producer")
        self._flow = flow

    @handler
    async def decide(self, message: Incoming, out: WorkflowContext[Tasked]) -> None:
        task = await self._flow._decide(message.ctx, message.event)
        if task is not None:  # a Skip ends the run here, already audited
            await out.send_message(Tasked(message.ctx, task))


class AnalystExecutor(Executor):
    def __init__(self, flow: "MatchWorkflow") -> None:
        super().__init__(id="analyst")
        self._flow = flow

    @handler
    async def analyse(self, message: Tasked, out: WorkflowContext[Analysed]) -> None:
        claims = await self._flow._analyse(message.ctx, message.task, repair=False)
        if claims:  # no claim (a failed tool) means no line, never a guessed number
            await out.send_message(Analysed(message.ctx, message.task, claims))


class NarratorExecutor(Executor):
    def __init__(self, flow: "MatchWorkflow") -> None:
        super().__init__(id="narrator")
        self._flow = flow

    @handler
    async def write(self, message: Analysed, out: WorkflowContext[Drafted]) -> None:
        drafts = await self._flow._narrate(message.ctx, message.task, message.claims)
        await out.send_message(Drafted(message.ctx, message.task, message.claims, drafts))


class VerifierExecutor(Executor):
    def __init__(self, flow: "MatchWorkflow") -> None:
        super().__init__(id="verifier")
        self._flow = flow

    @handler
    async def check(self, message: Drafted, out: WorkflowContext[Verified]) -> None:
        await self._flow._verify_drafts(message.ctx, message.task, message.claims, message.drafts)
        await out.send_message(Verified(message.task))


class StatsDeskExecutor(Executor):
    def __init__(self, flow: "MatchWorkflow") -> None:
        super().__init__(id="stats_desk")
        self._flow = flow

    @handler
    async def compare(self, message: Verified, out: WorkflowContext) -> None:
        await self._flow._desk_after_verify(message.task)


def build_graph(flow: "MatchWorkflow") -> Any:
    producer = ProducerExecutor(flow)
    analyst = AnalystExecutor(flow)
    narrator = NarratorExecutor(flow)
    verifier = VerifierExecutor(flow)
    desk = StatsDeskExecutor(flow)
    return (
        WorkflowBuilder(start_executor=producer, name="matchcast-moment")
        .add_edge(producer, analyst)
        .add_edge(analyst, narrator)
        .add_edge(narrator, verifier)
        .add_edge(verifier, desk, condition=lambda v: flow._wants_desk(v.task))
        .build()
    )


async def run_event(flow: "MatchWorkflow", ctx: MatchContext, event: dict[str, Any]) -> None:
    """Run one event through the graph; an executor's exception surfaces here unchanged."""
    await build_graph(flow).run(Incoming(ctx, event))
