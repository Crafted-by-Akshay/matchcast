"""Liveness and readiness behavior, including configuration failures."""

from app.config import load_settings
from app.main import app, create_app
from fastapi.testclient import TestClient


def test_health_is_liveness_and_does_not_require_model_connection() -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_openapi_document_is_available() -> None:
    response = TestClient(app).get("/openapi.json")

    assert response.status_code == 200
    assert response.json()["info"]["title"] == "MatchCast API"


def test_local_readiness_marks_model_and_store_as_mock() -> None:
    response = TestClient(create_app(settings_result=load_settings({}))).get("/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "mode": "local",
        "configuration": {"status": "valid", "errors": []},
        "dependencies": {
            "model": {"status": "local_mock", "detail": "no model connection is attempted"},
            "session_store": {
                "status": "local_mock",
                "detail": "demo /sessions store in memory; matches: see /v1/status",
            },
        },
    }


CLOUD_ENV = {
    "MATCHCAST_MODE": "cloud",
    "FOUNDRY_PROJECT_ENDPOINT": "https://example.invalid/api/projects/proj",
    "FOUNDRY_MODEL_DEPLOYMENT": "gpt-6-luna",
}


def _no_credential() -> None:
    raise RuntimeError("no credential, secret-detail-that-must-not-leak")


def test_incomplete_cloud_configuration_is_not_ready_and_health_stays_live() -> None:
    client = TestClient(create_app(settings_result=load_settings({"MATCHCAST_MODE": "cloud"})))

    readiness = client.get("/ready")
    assert readiness.status_code == 503
    assert readiness.json()["configuration"]["status"] == "invalid"
    assert readiness.json()["dependencies"]["model"]["status"] == "unavailable"
    assert "FOUNDRY_PROJECT_ENDPOINT" in readiness.json()["configuration"]["errors"][0]
    assert client.get("/health").status_code == 200


def test_invalid_mode_configuration_is_reported() -> None:
    result = load_settings({"MATCHCAST_MODE": "foundry"})
    response = TestClient(create_app(settings_result=result)).get("/ready")

    assert response.status_code == 503
    assert response.json()["configuration"]["status"] == "invalid"
    assert "MATCHCAST_MODE" in " ".join(response.json()["configuration"]["errors"])


def test_blank_deployment_and_insecure_endpoint_are_invalid() -> None:
    result = load_settings(
        {
            "MATCHCAST_MODE": "cloud",
            "FOUNDRY_PROJECT_ENDPOINT": "http://model.example.test",
            "FOUNDRY_MODEL_DEPLOYMENT": "   ",
        }
    )

    assert result.settings is None
    errors = " ".join(result.errors)
    assert "FOUNDRY_PROJECT_ENDPOINT" in errors
    assert "FOUNDRY_MODEL_DEPLOYMENT" in errors


def test_cloud_ready_only_after_a_credential_is_obtained() -> None:
    result = load_settings(CLOUD_ENV)
    response = TestClient(create_app(settings_result=result, credential_probe=lambda: None)).get(
        "/ready"
    )

    assert response.status_code == 200
    assert response.json()["dependencies"]["model"]["status"] == "ready"


def test_cloud_without_a_credential_is_not_ready_and_leaks_nothing() -> None:
    result = load_settings(CLOUD_ENV)
    response = TestClient(create_app(settings_result=result, credential_probe=_no_credential)).get(
        "/ready"
    )

    assert response.status_code == 503
    assert response.json()["dependencies"]["model"]["status"] == "unavailable"
    assert "secret-detail-that-must-not-leak" not in response.text
