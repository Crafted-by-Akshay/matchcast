"""scripts/smoke_foundry.py must pin the api version: newer azure-ai-projects no longer picks one,
and `make live-eval` stopped at "Must provide either the api_version argument" (25 Oct)."""

import importlib.util
import sys
import types
from pathlib import Path

ROOT = Path(__file__).parents[1]


def test_the_openai_client_gets_the_same_api_version_as_the_agents(monkeypatch) -> None:
    seen: dict = {}

    class Project:
        def __init__(self, **_kwargs) -> None: ...

        def get_openai_client(self, **kwargs):
            seen.update(kwargs)
            raise SystemExit(0)  # stop before any network call

    monkeypatch.setitem(
        sys.modules, "azure.ai.projects", types.SimpleNamespace(AIProjectClient=Project)
    )
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://f.example/api/projects/p")
    spec = importlib.util.spec_from_file_location(
        "smoke_foundry", ROOT / "scripts/smoke_foundry.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        module.main()
    except SystemExit:
        pass
    from matchcast_agents.live.client import API_VERSION

    assert seen.get("api_version") == API_VERSION
