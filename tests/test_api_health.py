"""Smoke tests for the initial API."""

from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_health_reports_healthy_status() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_openapi_document_is_available() -> None:
    response = client.get("/openapi.json")

    assert response.status_code == 200
    assert response.json()["info"]["title"] == "MatchCast API"
