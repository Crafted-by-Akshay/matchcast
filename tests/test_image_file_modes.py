"""Images run as a non-root user, so every copied file must be world-readable whatever the
builder's umask was (24 Oct: a checkout under umask 077 shipped an api that could not read its
own code and never became healthy)."""

import re
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
    steps = [
        line for line in build.splitlines() if line and not line[0].isspace() and line[0] != "#"
    ]
    # the last build step chmods whole trees, and nothing after it in that step
    last = re.fullmatch(r"RUN (?:.* && )?chmod -R a\+rX ((?:/[\w.-]+ ?)+)", steps[-1])
    assert last, f"{dockerfile}: the build stage must end with `chmod -R a+rX {tree} ...`"
    trees = last.group(1).split()
    assert tree in trees, f"{dockerfile}: the chmod must cover {tree}"
    assert f"COPY --from=build {tree}" in runtime
    # ACR Tasks builds with the classic builder, which rejects BuildKit-only `COPY --chmod`,
    # so the runtime stage copies only from the build stage, and only from chmodded trees
    assert "--chmod" not in text, f"{dockerfile}: --chmod needs BuildKit, which ACR builds lack"
    for line in runtime.splitlines():
        assert not line.startswith("ADD "), f"{dockerfile}: {line!r} skips the chmod"
        if line.startswith("COPY "):
            parts = line.split()
            assert parts[1] == "--from=build", (
                f"{dockerfile}: {line!r} copies from the context, skipping the chmod"
            )
            assert any(src == t or src.startswith(t + "/") for src in parts[2:-1] for t in trees), (
                f"{dockerfile}: {line!r} copies a path the chmod did not cover"
            )
