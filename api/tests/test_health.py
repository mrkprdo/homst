from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_public_config():
    response = client.get("/api/v1/config")
    assert response.status_code == 200
    assert "spotify_client_id" in response.json()
