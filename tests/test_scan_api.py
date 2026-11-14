import asyncio
from unittest.mock import AsyncMock

import httpx
from fastapi.testclient import TestClient

import api.index as api
from ml import scanner
from test_scanner import network, headers, no_real_egress


def test_scan_api_uses_real_scanner_with_mocked_network(monkeypatch):
    network(
        monkeypatch,
        [headers(302, "Location: https://gooogle.com/login\r\n"), headers(200)],
    )
    monkeypatch.setattr(api, "load_production", lambda: (None, None))
    response = TestClient(api.create_app()).post(
        "/api/scan", json={"url": "https://bit.ly/start"}
    )
    assert response.status_code == 200
    result = response.json()
    assert result["online"]["status"] == "complete"
    assert result["online"]["final_domain"] == "gooogle.com"
    assert result["final_destination"]["typosquatting"]["indicator"]
    assert result["shortener_provider"] == "bit.ly"
    assert result["prediction"] is None
    assert result["scan_duration_ms"] >= result["online"]["response_ms"]
    assert result["features"]["shortener"] == 1
    assert result["input_url"] == "https://bit.ly/start"
    assert set(result["features"]) == set(result["definitions"])


def test_scan_block_keeps_lexical_analysis_and_no_model(monkeypatch):
    connect = AsyncMock(side_effect=AssertionError("must not connect"))
    monkeypatch.setattr(asyncio, "open_connection", connect)
    monkeypatch.setattr(api, "load_production", lambda: (None, None))
    result = (
        TestClient(api.create_app())
        .post("/api/scan", json={"url": "http://169.254.169.254/latest"})
        .json()
    )
    assert result["online"]["status"] == "blocked"
    assert result["features"]["ip_address"] == 1
    assert result["prediction"] is None
    connect.assert_not_called()


def test_scan_concurrency_limit_keeps_lexical_result(monkeypatch):
    async def run():
        gate = asyncio.Event()
        active = 0
        maximum = 0

        async def waiting(url):
            nonlocal active, maximum
            active += 1
            maximum = max(maximum, active)
            try:
                await gate.wait()
                return scanner.unavailable("Controlled test", "test_only")
            finally:
                active -= 1

        monkeypatch.setattr(api, "scan_online", waiting)
        monkeypatch.setattr(api, "load_production", lambda: (None, None))
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=api.create_app()),
            base_url="http://testserver",
        ) as client:
            pending = [
                asyncio.create_task(
                    client.post("/api/scan", json={"url": "https://example.com"})
                )
                for _ in range(4)
            ]
            for _ in range(100):
                if active == 4:
                    break
                await asyncio.sleep(0.001)
            result = (
                await client.post("/api/scan", json={"url": "https://example.com"})
            ).json()
            assert result["online"]["reason_code"] == "scanner_busy"
            assert result["features"]["https"] == 1 and result["prediction"] is None
            assert maximum == 4
            gate.set()
            await asyncio.gather(*pending)

    asyncio.run(run())
