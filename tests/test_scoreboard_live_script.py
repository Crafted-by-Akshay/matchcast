"""The recording script exports a match by its ids from the api, or reads a saved export (CREW-5.2).
No test here reaches the api or a model."""

import importlib.util
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_script():
    spec = importlib.util.spec_from_file_location(
        "scoreboard_live", ROOT / "scripts" / "scoreboard_live.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_script_needs_a_match_or_all_three_ids(capsys) -> None:
    script = load_script()
    code = script.main(
        [
            "--api",
            "https://api.example",
            "--session-id",
            "s1",
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            "out.json",
        ]
    )
    assert code == 2
    assert "give --match" in capsys.readouterr().err


def test_the_export_is_fetched_from_the_read_only_input_route(monkeypatch) -> None:
    script = load_script()
    seen = {}

    class Reply(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_urlopen(url, timeout):
        seen["url"] = url
        return Reply(json.dumps({"events": [], "teams": {}}).encode())

    monkeypatch.setattr(script.urllib.request, "urlopen", fake_urlopen)
    match = script.fetch_input("https://api.example/", "s 1", "m-N001")
    assert match == {"events": [], "teams": {}}
    assert seen["url"] == ("https://api.example/v1/matches/m-N001/scoreboard/input?session_id=s+1")
