import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import api.index as api


def test_health_contract(monkeypatch):
    monkeypatch.setattr(api, "load_production", lambda: (None, None))
    c = TestClient(api.create_app())
    response = c.get("/api/health")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "status": "ok",
        "backend": "fastapi",
        "app_version": api.APP_VERSION,
        "model_status": "unavailable",
        "model_available": False,
        "model_version": None,
        "report": None,
    }
    package = json.loads((Path(__file__).parents[1] / "package.json").read_text())
    assert package["version"] == api.APP_VERSION


def test_health_model_available(monkeypatch):
    # Contract fixture only, not a deployed model or invented research result.
    monkeypatch.setattr(
        api,
        "load_production",
        lambda: ({"model_version": "test-version"}, {"report": {"reports": []}}),
    )
    payload = TestClient(api.create_app()).get("/api/health").json()
    assert payload["model_available"] is True
    assert payload["model_status"] == "available"
    assert payload["model_version"] == "test-version"


def test_features_and_api_404():
    c = TestClient(api.create_app())
    response = c.post("/api/features", json={"url": "https://example.com/login?q=123"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["features"]["url_length"] == len("https://example.com/login?q=123")
    assert payload["features"]["digit_count"] == 3
    assert payload["features"]["suspicious_keywords"] == 1
    assert set(payload["features"]) == set(payload["definitions"])
    assert c.post("/api/features", json={"url": "ftp://example.com"}).status_code == 422
    assert (
        c.post("/api/features", json={"wrong": "https://example.com"}).status_code
        == 422
    )
    for path in ("/api", "/api/unknown", "/api/unknown/nested"):
        result = c.get(path)
        assert result.status_code == 404
        assert result.json() == {"detail": "Not Found"}


def test_cors_allowed_denied_and_error_responses(monkeypatch):
    monkeypatch.setenv(
        "ALLOWED_ORIGINS", "http://localhost:5173, https://research.example.com/"
    )
    c = TestClient(api.create_app())
    response = c.options(
        "/api/features",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    denied = c.options(
        "/api/features",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers
    for _ in range(30):
        assert c.get("/api/health").status_code == 200
    limited = c.get("/api/health", headers={"Origin": "https://research.example.com"})
    assert limited.status_code == 429
    assert (
        limited.headers["access-control-allow-origin"] == "https://research.example.com"
    )


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "https://example.com/path",
        "https://u:p@example.com",
        "javascript:x",
        "https://example.com:99999",
    ],
)
def test_invalid_cors_config(origin, monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", origin)
    with pytest.raises(ValueError, match="ALLOWED_ORIGINS"):
        api.create_app()


def test_default_cors_is_same_origin(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    result = TestClient(api.create_app()).get(
        "/api/health", headers={"Origin": "https://untrusted.example"}
    )
    assert "access-control-allow-origin" not in result.headers
