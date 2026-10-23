from app.main import create_app
from fastapi.testclient import TestClient


def test_danger_model_card_is_served_from_the_model_folder():
    client = TestClient(create_app())
    response = client.get("/v1/models/danger/card")
    assert response.status_code == 200
    card = response.json()
    assert card["name"] == "matchcast.ml.danger"
    assert 0.5 < card["metrics"]["auc"] <= 1
    assert card["onnx"] is True


def test_danger_model_card_is_404_when_the_folder_has_none(monkeypatch, tmp_path):
    monkeypatch.setenv("MATCHCAST_DANGER_MODEL", str(tmp_path))
    response = TestClient(create_app()).get("/v1/models/danger/card")
    assert response.status_code == 404
    assert response.json()["detail"] != ""


def test_a_corrupt_or_non_object_card_is_503_not_a_crash(monkeypatch, tmp_path):
    monkeypatch.setenv("MATCHCAST_DANGER_MODEL", str(tmp_path))
    client = TestClient(create_app())
    for body in (b"{not json", b"[1, 2]", b"\xff\xfe"):
        (tmp_path / "model-card.json").write_bytes(body)
        assert client.get("/v1/models/danger/card").status_code == 503
