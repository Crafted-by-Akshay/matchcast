from app.main import create_app
from app.status import dependency_status
from fastapi.testclient import TestClient


def states(env, mode):
    return {i["key"]: i["status"] for i in dependency_status(env, mode)["dependencies"]}


def test_local_defaults_are_simulated_and_the_rest_planned():
    doc = dependency_status({}, "local")
    got = {i["key"]: i["status"] for i in doc["dependencies"]}
    assert got["agents"] == got["store"] == got["stream"] == got["speech"] == "simulated"
    assert got["fabric"] == got["databricks"] == "planned"
    assert doc["overall"] == "simulated"
    assert sum(doc["counts"].values()) == len(doc["dependencies"])


def test_configured_resources_are_live():
    env = {
        "MATCHCAST_AGENT_MODE": "live",
        "FOUNDRY_PROJECT_ENDPOINT": "https://x.invalid",
        "MATCHCAST_STORE": "table",
        "MATCHCAST_PIPELINE": "eventhubs",
        "MATCHCAST_EASY_AUTH": "1",
        "SPEECH_ENDPOINT": "https://s.invalid",
    }
    got = states(env, "cloud")
    assert got["agents"] == got["store"] == got["stream"] == got["auth"] == "live"
    assert got["speech"] == "live"


def test_cloud_without_a_resource_is_unavailable_not_simulated():
    got = states({}, "cloud")
    assert got["translator"] == got["vision"] == "unavailable"
    assert dependency_status({}, "cloud")["overall"] == "unavailable"


def test_live_agent_mode_without_an_endpoint_stays_simulated():
    assert states({"MATCHCAST_AGENT_MODE": "live"}, "cloud")["agents"] == "simulated"


def test_route_is_public_never_503_and_leaks_no_values(monkeypatch):
    monkeypatch.setenv("SPEECH_ENDPOINT", "https://secret-name.invalid")
    response = TestClient(create_app()).get("/v1/status")
    assert response.status_code == 200
    assert "secret-name" not in response.text
    assert {"mode", "overall", "counts", "dependencies"} <= response.json().keys()
