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


SAVED = {
    "events": [],
    "teams": {"a": "Argentina"},
    "names": {},
    "roster": {"stream": {"match_id": "m1"}},
}


def test_a_saved_export_is_recorded_with_the_given_fixture(monkeypatch, tmp_path) -> None:
    script = load_script()
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
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
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
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
    assert "must be a plain file path in a folder that can be written" in capsys.readouterr().err


def test_an_output_that_is_a_symlink_is_refused_before_any_model_call(
    monkeypatch, capsys, tmp_path
) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
    dangling = tmp_path / "out.json"
    dangling.symlink_to(tmp_path / "nowhere.json")
    monkeypatch.setattr(script, "FoundryModelClient", lambda: pytest.fail("no model call"))
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
    code = script.main(
        [
            "--match",
            str(match_file),
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(dangling),
        ]
    )
    assert code == 2
    assert "plain file path" in capsys.readouterr().err


def test_a_run_without_the_model_endpoint_is_refused(monkeypatch, capsys, tmp_path) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
    monkeypatch.delenv("FOUNDRY_PROJECT_ENDPOINT", raising=False)
    monkeypatch.setattr(script, "FoundryModelClient", lambda: pytest.fail("no model call"))
    code = script.main(
        [
            "--match",
            str(match_file),
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "o.json"),
        ]
    )
    assert code == 2
    assert "FOUNDRY_PROJECT_ENDPOINT is not set" in capsys.readouterr().err


def test_a_run_date_that_is_not_a_date_is_refused(capsys, tmp_path) -> None:
    script = load_script()
    with pytest.raises(SystemExit) as stop:
        script.main(
            [
                "--match",
                str(tmp_path / "m.json"),
                "--fixture",
                "N001",
                "--max-calls",
                "5",
                "--out",
                str(tmp_path / "o.json"),
                "--run-date",
                "tomorrow",
            ]
        )
    assert stop.value.code == 2
    assert "not a YYYY-MM-DD date" in capsys.readouterr().err


def test_a_match_without_a_match_id_is_refused_before_any_model_call(
    monkeypatch, capsys, tmp_path
) -> None:
    script = load_script()
    no_id = tmp_path / "match.json"
    no_id.write_text(json.dumps({**SAVED, "roster": {"stream": {}}}))
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
    monkeypatch.setattr(script, "FoundryModelClient", lambda: pytest.fail("no model call"))
    code = script.main(
        [
            "--match",
            str(no_id),
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "o.json"),
        ]
    )
    assert code == 1
    assert "match_id" in capsys.readouterr().err


def test_an_output_that_is_not_writable_is_refused_before_any_model_call(
    monkeypatch, capsys, tmp_path
) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
    monkeypatch.setattr(script.os, "access", lambda path, mode: False)  # root can write anywhere
    monkeypatch.setattr(script, "FoundryModelClient", lambda: pytest.fail("no model call"))
    code = script.main(
        [
            "--match",
            str(match_file),
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "o.json"),
        ]
    )
    assert code == 2
    assert "can be written" in capsys.readouterr().err


def test_an_output_that_is_a_folder_is_refused_before_any_model_call(
    monkeypatch, capsys, tmp_path
) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
    folder = tmp_path / "out-dir"
    folder.mkdir()
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
    monkeypatch.setattr(script, "FoundryModelClient", lambda: pytest.fail("no model call"))
    code = script.main(
        ["--match", str(match_file), "--fixture", "N001", "--max-calls", "5", "--out", str(folder)]
    )
    assert code == 2
    assert "can be written" in capsys.readouterr().err


def test_a_call_budget_out_of_range_is_refused_before_any_model_call(
    monkeypatch, capsys, tmp_path
) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
    monkeypatch.setattr(script, "FoundryModelClient", lambda: pytest.fail("no model call"))
    code = script.main(
        [
            "--match",
            str(match_file),
            "--fixture",
            "N001",
            "--max-calls",
            "5000",
            "--out",
            str(tmp_path / "o.json"),
        ]
    )
    assert code == 2
    assert "--max-calls must be between 1 and" in capsys.readouterr().err


def test_a_late_failure_keeps_the_arms_already_paid_for(monkeypatch, tmp_path) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
    out = tmp_path / "out.json"
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
    monkeypatch.setattr(script, "FoundryModelClient", lambda: None)

    def failing_run(match, *, on_arm, **kwargs):
        arm = {
            "run_id": "full_crew-live",
            "lines_aired": 0,
            "wrong_lines_aired": 0,
            "cost": {"model_calls": 4, "model_errors": 0, "budget_refused": 0},
        }
        on_arm("full_crew", arm)
        raise RuntimeError("the third arm failed")

    monkeypatch.setattr(script, "live_run", failing_run)
    with pytest.raises(RuntimeError):
        script.main(
            ["--match", str(match_file), "--fixture", "N001", "--max-calls", "5", "--out", str(out)]
        )
    partial = json.loads((tmp_path / "out.json.partial").read_text())
    assert partial["kind"] == "crew_live_partial"
    assert list(partial["arms"]) == ["full_crew"]
    assert not out.exists()  # no record was written, and the kept arm is not a recording


def test_a_partial_that_cannot_be_written_is_refused_before_any_model_call(
    monkeypatch, capsys, tmp_path
) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
    (tmp_path / "out.json.partial").mkdir()  # a folder where the partial file goes

    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
    monkeypatch.setattr(script, "FoundryModelClient", lambda: pytest.fail("no model call"))
    code = script.main(
        [
            "--match",
            str(match_file),
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "out.json"),
        ]
    )
    assert code == 2
    assert "cannot be written" in capsys.readouterr().err


def test_a_finished_run_removes_its_partial_file(monkeypatch, tmp_path) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
    (tmp_path / "out.json.partial").write_text("{}")  # a stale one from an earlier run
    out = tmp_path / "out.json"
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
    monkeypatch.setattr(script, "FoundryModelClient", lambda: None)
    monkeypatch.setattr(script, "live_run", lambda match, *, on_arm, **kwargs: {"run_id": "r1"})
    code = script.main(
        ["--match", str(match_file), "--fixture", "N001", "--max-calls", "5", "--out", str(out)]
    )
    assert code == 0
    assert json.loads(out.read_text()) == {"run_id": "r1"}
    assert not (tmp_path / "out.json.partial").exists()


def test_a_stale_partial_is_moved_aside_not_deleted_even_when_the_run_fails(
    monkeypatch, tmp_path
) -> None:
    # the arms a dead run paid for are kept under a dated name, so they can be read by hand; a
    # rerun still pays for its own calls
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
    (tmp_path / "out.json.partial").write_text('{"kind": "crew_live_partial", "arms": {}}')
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
    monkeypatch.setattr(script, "FoundryModelClient", lambda: None)

    def dies(match, **kwargs):
        raise RuntimeError("the run dies")

    monkeypatch.setattr(script, "live_run", dies)
    with pytest.raises(RuntimeError):
        script.main(
            [
                "--match",
                str(match_file),
                "--fixture",
                "N001",
                "--max-calls",
                "5",
                "--out",
                str(tmp_path / "out.json"),
            ]
        )
    assert not (tmp_path / "out.json.partial").exists()
    kept = list(tmp_path.glob("out.json.partial.*"))
    assert len(kept) == 1
    assert json.loads(kept[0].read_text())["kind"] == "crew_live_partial"


def test_an_arm_is_printed_when_its_partial_cannot_be_written(
    monkeypatch, capsys, tmp_path
) -> None:
    # disk full or read-only mid-run: the run goes on and the paid arm is printed, not dropped
    script = load_script()
    _real_replace = script._replace
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
    monkeypatch.setattr(script, "FoundryModelClient", lambda: None)
    arm = {
        "run_id": "full_crew-live",
        "lines_aired": 0,
        "wrong_lines_aired": 0,
        "cost": {"model_calls": 4, "model_errors": 0, "budget_refused": 0},
    }

    def one_arm_then_done(match, *, on_arm, **kwargs):
        on_arm("full_crew", arm)
        return {"run_id": "r1"}

    def broken_write(path, data):
        if path.name.endswith(".partial"):
            raise OSError("no space left on device")
        _real_replace(path, data)

    monkeypatch.setattr(script, "live_run", one_arm_then_done)
    monkeypatch.setattr(script, "_replace", broken_write)
    code = script.main(
        [
            "--match",
            str(match_file),
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "out.json"),
        ]
    )
    assert code == 0
    err = capsys.readouterr().err
    printed = [line for line in err.splitlines() if line.startswith("{")]
    assert [json.loads(line) for line in printed] == [{"full_crew": arm}]
    assert "NOT kept (printed above)" in err


def test_a_failed_replace_leaves_the_file_that_was_there(monkeypatch, tmp_path) -> None:
    # written through a temp file, so a failure before the rename cannot truncate the old file
    script = load_script()
    path = tmp_path / "out.json.partial"
    path.write_text("old arms")

    def no_rename(src, dst):
        raise OSError("the rename failed")

    monkeypatch.setattr(script.os, "replace", no_rename)
    with pytest.raises(OSError):
        script._replace(path, {"kind": "crew_live_partial", "arms": {}})
    assert path.read_text() == "old arms"


def test_a_temp_file_that_cannot_be_written_is_refused_before_any_model_call(
    monkeypatch, capsys, tmp_path
) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
    (tmp_path / "out.json.partial.tmp").mkdir()  # the temp file the partial is written through
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
    monkeypatch.setattr(script, "FoundryModelClient", lambda: pytest.fail("no model call"))
    code = script.main(
        [
            "--match",
            str(match_file),
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "out.json"),
        ]
    )
    assert code == 2
    assert "cannot be written" in capsys.readouterr().err


def test_a_record_that_cannot_be_written_is_printed_not_lost(monkeypatch, capsys, tmp_path) -> None:
    script = load_script()
    match_file = tmp_path / "match.json"
    match_file.write_text(json.dumps(SAVED))
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", "https://example.services.ai.azure.com")
    monkeypatch.setattr(script, "FoundryModelClient", lambda: None)
    monkeypatch.setattr(script, "live_run", lambda match, *, on_arm, **kwargs: {"run_id": "r9"})

    def full_disk(path, data):
        raise OSError("no space left on device")

    monkeypatch.setattr(script, "_replace", full_disk)
    code = script.main(
        [
            "--match",
            str(match_file),
            "--fixture",
            "N001",
            "--max-calls",
            "5",
            "--out",
            str(tmp_path / "out.json"),
        ]
    )
    assert code == 1
    assert json.loads(capsys.readouterr().err.splitlines()[-1]) == {"run_id": "r9"}
