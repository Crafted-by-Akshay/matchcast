"""The recording script exports a match by its ids from the api, or reads a saved export (CREW-5.2).
No test here reaches the api or a model."""

import importlib.util
import io
import json
import urllib.error
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load_script():
    spec = importlib.util.spec_from_file_location(
        "scoreboard_live", ROOT / "scripts" / "scoreboard_live.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Reply(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


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


def test_a_match_file_and_the_api_options_do_not_mix(capsys, tmp_path) -> None:
    script = load_script()
    code = script.main(
        [
            "--match",
            "m.json",
            "--api",
            "https://api.example",
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "out.json"),
        ]
    )
    assert code == 2
    assert "give --match alone" in capsys.readouterr().err


def test_the_fixture_is_still_required(tmp_path) -> None:
    script = load_script()
    with pytest.raises(SystemExit) as stop:
        script.main(["--match", "m.json", "--max-calls", "5", "--out", str(tmp_path / "o.json")])
    assert stop.value.code == 2


def test_the_export_is_fetched_from_the_read_only_input_route(monkeypatch) -> None:
    script = load_script()
    seen = {}

    def fake_urlopen(url, timeout):
        seen["url"] = url
        return Reply(json.dumps({"events": [], "teams": {}}).encode())

    monkeypatch.setattr(script.urllib.request, "urlopen", fake_urlopen)
    match = script.fetch_input("https://api.example/", "s 1", "x/y z")
    assert match == {"events": [], "teams": {}}
    assert seen["url"] == (
        "https://api.example/v1/matches/x%2Fy%20z/scoreboard/input?session_id=s+1"
    )


def test_an_export_that_fails_is_a_message_not_a_traceback(monkeypatch, capsys, tmp_path) -> None:
    script = load_script()

    def unreachable(url, timeout):
        raise urllib.error.URLError("no route to host")

    monkeypatch.setattr(script.urllib.request, "urlopen", unreachable)
    code = script.main(
        [
            "--api",
            "https://api.example",
            "--session-id",
            "s1",
            "--match-id",
            "m1",
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "o.json"),
        ]
    )
    assert code == 1
    assert "could not export the match" in capsys.readouterr().err


def test_a_saved_export_is_recorded_with_the_given_fixture(monkeypatch, tmp_path) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps({"events": [], "teams": {"a": "Argentina"}}))
    seen = {}

    def fake_live_run(match, **kwargs):
        seen["match"] = match
        seen.update(kwargs)
        return {"run_id": "r1", "arms": {}}

    monkeypatch.setattr(script, "live_run", fake_live_run)
    monkeypatch.setattr(script, "FoundryModelClient", lambda: None)
    out = tmp_path / "out.json"
    code = script.main(
        ["--match", str(match_file), "--fixture", "M001", "--max-calls", "5", "--out", str(out)]
    )
    assert code == 0
    assert seen["match"] == {"events": [], "teams": {"a": "Argentina"}}
    assert seen["fixture"] == "M001" and seen["max_calls"] == 5
    assert json.loads(out.read_text())["run_id"] == "r1"
