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
    steps = [
        line for line in build.splitlines() if line and not line[0].isspace() and line[0] != "#"
    ]
    assert steps[-1].startswith("RUN ") and fix[4:] in steps[-1], (
        f"{dockerfile}: `{fix}` must be the last step of the build stage"
    )
    assert f"COPY --from=build {tree}" in runtime
    # ACR Tasks builds with the classic builder, which rejects BuildKit-only `COPY --chmod`,
    # so the runtime stage copies only from the build stage, after its chmod
    assert "--chmod" not in text, f"{dockerfile}: --chmod needs BuildKit, which ACR builds lack"
    for line in runtime.splitlines():
        if line.startswith("COPY "):
            assert line.startswith("COPY --from=build "), (
                f"{dockerfile}: {line!r} copies from the context, skipping the chmod"
            )
