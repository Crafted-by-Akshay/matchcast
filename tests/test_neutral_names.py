"""No federation or competition names in what ships (trademarks, ADR-0020)."""

# ruff: noqa: E501

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANNED = re.compile(
    r"\b(FIFA|UEFA|IFAB|CONMEBOL|CONCACAF|World Cup|La Liga|Premier League|Champions League|Bundesliga|Serie A)\b",
    re.I,
)


def scan(files) -> list[str]:
    hits = []
    for f in files:
        for n, line in enumerate(
            Path(f).read_text(encoding="utf-8", errors="ignore").splitlines(), 1
        ):
            if m := BANNED.search(line):
                hits.append(f"{f}:{n}: {m.group(0)}")
    return hits


def test_built_app_has_no_federation_names(tmp_path) -> None:
    out = tmp_path / "app"
    subprocess.run(
        [sys.executable, str(ROOT / "apps/unified/build.py"), str(out)],
        check=True,
        capture_output=True,
        timeout=300,
    )
    files = [
        p
        for p in out.rglob("*")
        if p.is_file()
        and p.suffix in {".html", ".js", ".json", ".css"}
        and p.name != "players.json"
    ]
    assert files, "the build wrote nothing"
    assert scan(files) == []


def test_shell_embeds_and_knowledge_base_have_none() -> None:
    files = [
        *ROOT.glob("apps/unified/*.js"),
        ROOT / "apps/unified/index.html",
        *ROOT.glob("apps/unified/embed/*.js"),
        *ROOT.glob("kb/**/*.md"),
        *ROOT.glob("packages/agents/matchcast_agents/**/prompts/**/*"),
    ]
    files = [f for f in files if f.is_file()]
    assert scan(files) == []
