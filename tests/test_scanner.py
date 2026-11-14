import asyncio
import socket
from unittest.mock import AsyncMock

import pytest
from ml import scanner


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.0.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "0.0.0.0",
        "::1",
        "fd00::1",
        "fe80::1",
        "224.0.0.1",
        "::ffff:8.8.8.8",
        "192.0.2.1",
        "2002:7f00:1::",
    ],
)
def test_nonpublic(ip):
    assert not scanner.public_address(ip)


def test_public():
    assert scanner.public_address("8.8.8.8")


def test_dns_mixed_and_failure(monkeypatch):
    async def run():
        loop = asyncio.get_running_loop()
        monkeypatch.setattr(
            loop,
            "getaddrinfo",
            AsyncMock(
                return_value=[
                    (2, 1, 6, "", ("8.8.8.8", 443)),
                    (2, 1, 6, "", ("10.0.0.1", 443)),
                ]
            ),
        )
        with pytest.raises(scanner.ScanError, match="non-public"):
            await scanner.resolve("example.com", 443)
        monkeypatch.setattr(
            loop, "getaddrinfo", AsyncMock(side_effect=socket.gaierror())
        )
        with pytest.raises(scanner.ScanError, match="DNS"):
            await scanner.resolve("example.com", 443)

    asyncio.run(run())


def test_redirect_private_no_connection(monkeypatch):
    connect = AsyncMock()
    monkeypatch.setattr(asyncio, "open_connection", connect)
    original = scanner.head

    async def request(url):
        if url == "https://example.com/":
            return 302, "http://127.0.0.1/"
        return await original(url)

    result = asyncio.run(scanner.scan_online("https://example.com", request))
    assert result["status"] == "unavailable"
    assert "blocked" in result["reason"]
    connect.assert_not_called()


def test_port_rejected():
    result = asyncio.run(scanner.scan_online("https://example.com:8443"))
    assert result["status"] == "unavailable"
    assert "ports" in result["reason"]


def test_pin_and_head_only(monkeypatch):
    class Writer:
        def get_extra_info(self, key):
            return ("8.8.8.8", 443)

        def write(self, raw):
            self.sent = raw

        async def drain(self):
            pass

        def close(self):
            self.closed = True

    writer = Writer()
    reader = AsyncMock()
    reader.readuntil.return_value = (
        b"HTTP/1.1 200 OK\r\nContent-Length: 999999999\r\n\r\n"
    )
    monkeypatch.setattr(scanner, "resolve", AsyncMock(return_value=["8.8.8.8"]))
    connect = AsyncMock(return_value=(reader, writer))
    monkeypatch.setattr(asyncio, "open_connection", connect)
    assert asyncio.run(scanner.head("https://example.com/login")) == (200, None)
    assert connect.call_args.args[0] == "8.8.8.8"
    assert connect.call_args.kwargs["server_hostname"] == "example.com"
    assert connect.call_args.kwargs["ssl"].check_hostname
    assert writer.sent.startswith(b"HEAD /login HTTP/1.1\r\nHost: example.com\r\n")
    assert b"Cookie:" not in writer.sent
    reader.read.assert_not_called()
    assert writer.closed


def test_chain_limits_timeout_and_head():
    async def redirects(url):
        return 302, "/next"

    result = asyncio.run(scanner.scan_online("https://example.com", redirects))
    assert result["redirect_count"] == 5
    assert len(result["chain"]) == 6

    async def timeout(url):
        raise TimeoutError()

    assert (
        "timed out"
        in asyncio.run(scanner.scan_online("https://example.com", timeout))["reason"]
    )

    async def unsupported(url):
        return 405, None

    assert (
        "HEAD is not supported"
        in asyncio.run(scanner.scan_online("https://example.com", unsupported))[
            "reason"
        ]
    )

    async def invalid_redirect(url):
        return 302, "file:///etc/passwd"

    assert (
        asyncio.run(scanner.scan_online("https://example.com", invalid_redirect))[
            "status"
        ]
        == "unavailable"
    )


def test_large_headers(monkeypatch):
    writer = AsyncMock()
    writer.get_extra_info = lambda k: ("8.8.8.8", 443)
    writer.write = lambda raw: None
    writer.close = lambda: None
    reader = AsyncMock()
    reader.readuntil.return_value = (
        b"HTTP/1.1 200 OK\r\nX: " + b"a" * 17000 + b"\r\n\r\n"
    )
    monkeypatch.setattr(scanner, "resolve", AsyncMock(return_value=["8.8.8.8"]))
    monkeypatch.setattr(
        asyncio, "open_connection", AsyncMock(return_value=(reader, writer))
    )
    with pytest.raises(scanner.ScanError, match="too large"):
        asyncio.run(scanner.head("https://example.com/"))
