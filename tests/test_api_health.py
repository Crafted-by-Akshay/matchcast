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
            "session_store": {"status": "local_mock", "detail": "process-local memory"},
        },
    }


def test_incomplete_cloud_configuration_is_not_ready_and_health_stays_live() -> None:
    client = TestClient(create_app(settings_result=load_settings({"MATCHCAST_MODE": "cloud"})))

    readiness = client.get("/ready")
    assert readiness.status_code == 503
    assert readiness.json()["configuration"]["status"] == "invalid"
    assert readiness.json()["dependencies"]["model"]["status"] == "unavailable"
    assert "MATCHCAST_MODEL_ENDPOINT" in readiness.json()["configuration"]["errors"][0]
    assert client.get("/health").status_code == 200


def test_invalid_mode_configuration_is_reported_without_secret_echo() -> None:
    result = load_settings(
        {
            "MATCHCAST_MODE": "foundry",
            "MATCHCAST_MODEL_API_KEY": "do-not-return-this-secret",
        }
    )
    response = TestClient(create_app(settings_result=result)).get("/ready")

    assert response.status_code == 503
    assert response.json()["configuration"]["status"] == "invalid"
    assert "MATCHCAST_MODE" in " ".join(response.json()["configuration"]["errors"])
    assert "do-not-return-this-secret" not in response.text


def test_blank_cloud_key_and_insecure_endpoint_are_invalid() -> None:
    result = load_settings(
        {
            "MATCHCAST_MODE": "cloud",
            "MATCHCAST_MODEL_ENDPOINT": "http://model.example.test",
            "MATCHCAST_MODEL_API_KEY": "   ",
        }
    )

    assert result.settings is None
    errors = " ".join(result.errors)
    assert "MATCHCAST_MODEL_ENDPOINT" in errors
    assert "MATCHCAST_MODEL_API_KEY" in errors


def test_valid_cloud_configuration_remains_pending_until_adapter_exists() -> None:
    result = load_settings(
        {
            "MATCHCAST_MODE": "cloud",
            "MATCHCAST_MODEL_ENDPOINT": "https://example.invalid/model",
            "MATCHCAST_MODEL_API_KEY": "placeholder-secret",
        }
    )
    response = TestClient(create_app(settings_result=result)).get("/ready")

    assert response.status_code == 503
    assert response.json()["configuration"]["status"] == "valid"
    assert response.json()["dependencies"]["model"]["status"] == "pending"
    assert "no provider probe was made" in response.json()["dependencies"]["model"]["detail"]
    assert "placeholder-secret" not in response.text
