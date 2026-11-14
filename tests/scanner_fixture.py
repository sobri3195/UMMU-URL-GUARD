"""Test-only ASGI harness: real application, mocked outbound DNS/HEAD transport.

Started explicitly by tests/scanner-browser.cjs, never imported by production.
Unexpected DNS destinations/connections fail closed; no live target is contacted.
"""

import asyncio
import socket

from api.index import create_app

HOSTS = {
    "bit.ly",
    "gooogle.com",
    "error.example.com",
    "no-head.example.com",
    "redirect.example.com",
    "loop.example.com",
    "slow.example.com",
}


async def dns(self, host, port, **kwargs):
    if host not in HOSTS:
        raise socket.gaierror()
    return [
        (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("8.8.8.8", port))
    ]


class Writer:
    def __init__(self):
        self.sent = b""
        self.transport = self

    def get_extra_info(self, key):
        assert key == "peername"
        return ("8.8.8.8", 443)

    def write(self, raw):
        assert (
            raw.startswith(b"HEAD ")
            and b"Cookie:" not in raw
            and b"Authorization:" not in raw
        )
        self.sent = raw

    async def drain(self):
        pass

    def close(self):
        pass

    def abort(self):
        pass


class Reader:
    def __init__(self, writer):
        self.writer = writer

    async def readuntil(self, separator):
        assert separator == b"\r\n\r\n"
        await asyncio.sleep(0.15)
        raw = self.writer.sent
        host = raw.split(b"\r\nHost: ")[1].split(b"\r\n")[0].decode()
        if host == "slow.example.com":
            raise TimeoutError()
        if host == "bit.ly":
            return b"HTTP/1.1 302 Found\r\nLocation: https://gooogle.com/login?test=1\r\n\r\n"
        if host == "redirect.example.com":
            return b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/\r\n\r\n"
        if host == "loop.example.com":
            return b"HTTP/1.1 302 Found\r\nLocation: /start\r\n\r\n"
        if host == "error.example.com":
            return b"HTTP/1.1 503 Unavailable\r\n\r\n"
        if host == "no-head.example.com":
            return b"HTTP/1.1 405 Not Allowed\r\n\r\n"
        assert host == "gooogle.com"
        return b"HTTP/1.1 200 OK\r\nContent-Length: 99999999\r\n\r\n"

    async def read(self, *args):
        raise AssertionError("Scanner must not consume a response body")


async def connection(host, port, **kwargs):
    assert host == "8.8.8.8" and port == 443
    assert kwargs["ssl"].check_hostname
    writer = Writer()
    return Reader(writer), writer


asyncio.BaseEventLoop.getaddrinfo = dns
asyncio.open_connection = connection
app = create_app()
