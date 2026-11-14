import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from pathlib import Path
import hashlib

from fastapi.testclient import TestClient

import api.index as api


def test_training_timeout_kills_worker_and_releases_lock(monkeypatch):
    async def communicate(raw):
        await asyncio.sleep(1)

    process = SimpleNamespace(
        communicate=communicate, returncode=None, kill=Mock(), wait=AsyncMock()
    )
    monkeypatch.setattr(api, "ONLINE_TRAIN_TIMEOUT", 0.01)
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", AsyncMock(return_value=process)
    )
    result = TestClient(api.create_app()).post(
        "/api/train", files={"file": ("test.csv", b"url,label\n")}
    )
    assert result.status_code == 408
    assert "train_local --dataset" in result.json()["detail"]
    process.kill.assert_called_once()
    process.wait.assert_awaited_once()
    assert api.TRAIN_LOCK.acquire(blocking=False)
    api.TRAIN_LOCK.release()


def test_online_experiment_never_writes_or_replaces_production(
    research_csv, tmp_path, monkeypatch
):
    import ml.model as model

    repository_models = Path(api.__file__).resolve().parents[1] / "models"

    def snapshot(directory):
        return {
            str(path.relative_to(directory)): hashlib.sha256(
                path.read_bytes()
            ).hexdigest()
            for path in directory.rglob("*")
            if path.is_file()
        }

    repository_before = snapshot(repository_models)
    monkeypatch.setattr(model, "MODEL_DIR", tmp_path)
    before = list(tmp_path.iterdir())
    c = TestClient(api.create_app())
    response = c.post(
        "/api/train?n_estimators=20", files={"file": ("unit-only.csv", research_csv)}
    )
    assert response.status_code == 200
    assert len(response.json()["reports"]) == 6
    assert list(tmp_path.iterdir()) == before
    assert snapshot(repository_models) == repository_before
    assert c.get("/api/health").json()["model_available"] is False
    prediction = c.post("/api/predict", json={"url": "https://example.com"}).json()
    assert prediction["model_status"] == "unavailable"
    assert prediction["prediction"] is None and prediction["probability"] is None
    assert prediction["prediction_timestamp"]
