"""The recording script exports a match by its ids from the api, or reads a saved export (CREW-5.2).
No test here reaches the api or a model."""

import http.client
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


def test_the_script_needs_a_match_or_all_three_ids(capsys, tmp_path) -> None:
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
            str(tmp_path / "out.json"),
        ]
    )
    assert code == 2
    assert "give --match" in capsys.readouterr().err


def test_a_match_file_and_the_api_options_do_not_mix(capsys, tmp_path) -> None:
    script = load_script()
    code = script.main(
        [
            "--match",
            str(tmp_path / "m.json"),
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
        script.main(
            [
                "--match",
                str(tmp_path / "m.json"),
                "--max-calls",
                "5",
                "--out",
                str(tmp_path / "o.json"),
            ]
        )
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


def test_a_read_that_is_cut_off_is_a_message_too(monkeypatch, capsys, tmp_path) -> None:
    script = load_script()

    class Timeout(Reply):
        def read(self, *args):
            raise TimeoutError("read timed out")

    class Truncated(Reply):
        def read(self, *args):
            raise http.client.IncompleteRead(b"")

    for reply in (Timeout, Truncated):
        monkeypatch.setattr(script.urllib.request, "urlopen", lambda url, timeout, r=reply: r(b""))
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


def test_an_export_that_is_not_a_match_object_is_refused(monkeypatch) -> None:
    script = load_script()
    for body in (b"[]", b"null", b'"x"', b"3"):
        monkeypatch.setattr(script.urllib.request, "urlopen", lambda url, timeout, b=body: Reply(b))
        with pytest.raises(ValueError):
            script.fetch_input("https://api.example", "s1", "m1")


def test_a_saved_export_that_does_not_parse_is_a_message(capsys, tmp_path) -> None:
    script = load_script()
    bad = tmp_path / "match.json"
    bad.write_text("{not json")
    code = script.main(
        [
            "--match",
            str(bad),
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "o.json"),
        ]
    )
    assert code == 1
    assert "could not read" in capsys.readouterr().err
    bad.write_text("[]")
    code = script.main(
        [
            "--match",
            str(bad),
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "o.json"),
        ]
    )
    assert code == 1
    assert "not a match object" in capsys.readouterr().err


def test_a_dot_segment_is_not_a_match_id(monkeypatch) -> None:
    script = load_script()
    monkeypatch.setattr(script.urllib.request, "urlopen", lambda url, timeout: Reply(b"{}"))
    for match_id in ("", ".", ".."):
        with pytest.raises(ValueError):
            script.fetch_input("https://api.example", "s1", match_id)


SAVED = {"events": [], "teams": {"a": "Argentina"}, "names": {}, "roster": {"stream": {}}}


def test_a_saved_export_is_recorded_with_the_given_fixture(monkeypatch, tmp_path) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
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
    assert seen["match"] == SAVED
    assert seen["fixture"] == "M001" and seen["max_calls"] == 5
    assert json.loads(out.read_text())["run_id"] == "r1"


def test_a_match_without_what_the_run_reads_is_refused(capsys, tmp_path) -> None:
    script = load_script()
    partial = tmp_path / "match.json"
    partial.write_text(json.dumps({"events": [], "teams": {}}))
    code = script.main(
        [
            "--match",
            str(partial),
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "o.json"),
        ]
    )
    assert code == 1
    assert "missing roster, names" in capsys.readouterr().err


def test_an_output_that_cannot_be_written_is_refused_before_any_model_call(
    monkeypatch, capsys, tmp_path
) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))

    def no_model():
        raise AssertionError("the model must not be built before the output is checked")

    monkeypatch.setattr(script, "FoundryModelClient", no_model)
    code = script.main(
        [
            "--match",
            str(match_file),
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "missing-folder" / "out.json"),
        ]
    )
    assert code == 2
    assert "must be a file in a folder that exists" in capsys.readouterr().err
