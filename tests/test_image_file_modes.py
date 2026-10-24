"""Images run as a non-root user, so every copied file must be world-readable whatever the
builder's umask was (24 Oct: a checkout under umask 077 shipped an api that could not read its
own code and never became healthy)."""

from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]


@pytest.mark.parametrize(
    ("dockerfile", "tree"),
    [
        ("services/api/Dockerfile", "/app"),
        ("services/mcp/Dockerfile", "/app"),
        ("apps/unified/Dockerfile", "/site"),
    ],
)
def test_build_stage_makes_the_shipped_tree_world_readable(dockerfile: str, tree: str) -> None:
    text = (ROOT / dockerfile).read_text()
    build, _, runtime = text.rpartition("\nFROM ")
    fix = f"RUN chmod -R a+rX {tree}"
    assert fix in build, f"{dockerfile}: add `{fix}` to the build stage"
    assert f"COPY --from=build {tree}" in runtime
