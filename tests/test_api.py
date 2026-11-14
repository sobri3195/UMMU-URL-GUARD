from fastapi.testclient import TestClient
from api.index import create_app


def client():
    return TestClient(create_app())


def test_endpoints():
    c = client()
    assert c.get("/api/health").json()["model_available"] is False
    assert (
        c.post("/api/predict", json={"url": "https://example.com"}).json()["prediction"]
        is None
    )
    assert (
        c.post("/api/features", json={"url": "https://example.com"}).json()["features"][
            "https"
        ]
        == 1
    )
    assert c.post("/api/predict", json={"url": "file:///x"}).status_code == 422
    assert (
        c.post("/api/predict", json={"url": "https://u:p@example.com"}).status_code
        == 422
    )
    assert c.post("/api/predict", json={"url": "x" * 5000}).status_code == 422
    assert c.post("/api/predict", content=b"x" * 2100001).status_code == 413


def test_private_scan():
    response = client().post("/api/scan", json={"url": "http://127.0.0.1"})
    assert response.status_code == 200
    assert response.json()["online"]["status"] == "blocked"
    assert response.json()["prediction"] is None


def test_training_api(research_csv):
    c = client()
    result = c.post(
        "/api/train?n_estimators=20",
        files={"file": ("test-only.csv", research_csv, "text/csv")},
    )
    assert result.status_code == 200, result.text
    assert len(result.json()["reports"]) == 6
    assert c.get("/api/health").json()["model_available"] is False
    assert (
        c.post(
            "/api/dataset/analyze",
            files={"file": ("bad.csv", b"url,label\n", "text/csv")},
        ).status_code
        == 422
    )


def test_rate_limits():
    c = client()
    for _ in range(30):
        assert c.get("/api/health").status_code == 200
    assert c.get("/api/health").status_code == 429
