"""Security checks use mocked DNS and sockets only; unexpected egress fails tests."""

import asyncio
import socket
import ssl
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from ml import scanner
from ml.features import extract_features, normalize_url, typosquatting
from ml.url_validation import BlockedTarget, validate_target


@pytest.fixture(autouse=True)
def no_real_egress(monkeypatch):
    monkeypatch.setattr(
        asyncio.BaseEventLoop,
        "getaddrinfo",
        AsyncMock(side_effect=AssertionError("Unmocked DNS lookup")),
    )
    monkeypatch.setattr(
        asyncio,
        "open_connection",
        AsyncMock(side_effect=AssertionError("Unmocked socket connection")),
    )


def answer(address="8.8.8.8"):
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (address, 443))


def network(monkeypatch, responses, addresses=None, peers=None):
    dns = AsyncMock(side_effect=addresses or [[answer()] for _ in responses])
    monkeypatch.setattr(asyncio.BaseEventLoop, "getaddrinfo", dns)
    readers, writers = [], []
    for i, raw in enumerate(responses):
        reader = AsyncMock()
        reader.readuntil.return_value = raw
        peer = peers[i] if peers else "8.8.8.8"
        writer = SimpleNamespace(
            get_extra_info=Mock(return_value=(peer, 443)),
            write=Mock(),
            drain=AsyncMock(),
            close=Mock(),
            transport=SimpleNamespace(abort=Mock()),
        )
        readers.append(reader)
        writers.append(writer)
    connect = AsyncMock(side_effect=list(zip(readers, writers)))
    monkeypatch.setattr(asyncio, "open_connection", connect)
    return dns, connect, readers, writers


def headers(status=200, extra=""):
    return (f"HTTP/1.1 {status} Test\r\n{extra}\r\n").encode("iso-8859-1")


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.0.0.1",
        "172.16.1.1",
        "192.168.1.1",
        "169.254.169.254",
        "100.100.100.200",
        "168.63.129.16",
        "0.0.0.0",
        "::1",
        "fd00::1",
        "fe80::1",
        "fec0::1",
        "224.0.0.1",
        "ff02::1",
        "::ffff:8.8.8.8",
        "192.0.2.1",
        "2002:7f00:1::",
        "64:ff9b::7f00:1",
    ],
)
def test_nonpublic(ip):
    assert not scanner.public_address(ip)


@pytest.mark.parametrize(
    "value",
    [
        "",
        "file:///etc/passwd",
        "ftp://example.com",
        "https://u:p@example.com",
        "http://localhost",
        "http://foo.localhost",
        "https://metadata.google.internal",
        "http://router.home.arpa",
        "http://server.lan",
        "http://2130706433",
        "http://0177.0.0.1",
        "http://0x7f.0.0.1",
        "https://example.com:8443",
        "http://127.0.0.1",
        "http://[::1]",
        "http://169.254.169.254",
        "http://168.63.129.16",
    ],
)
def test_policy_blocks_before_network(value):
    result = asyncio.run(scanner.scan_online(value))
    assert result["status"] == "blocked"
    assert result["http_status"] is None
    assert result["chain"] == []


def test_unicode_and_long_valid_url():
    url = "https://Shop.BÜCHER.de/" + "p" * 1500 + "?query=" + "q" * 1000
    assert validate_target(url).startswith("https://shop.xn--bcher-kva.de/")
    assert extract_features("https://bücher.de/") == extract_features(
        "https://xn--bcher-kva.de/"
    )
    assert scanner.public_address("8.8.8.8")
    assert scanner.public_address("2001:4860:4860::8888")


@pytest.mark.parametrize(
    "host,provider",
    [
        ("bit.ly", "bit.ly"),
        ("tinyurl.com", "tinyurl.com"),
        ("t.co", "t.co"),
        ("cutt.ly", "cutt.ly"),
        ("is.gd", "is.gd"),
        ("notbit.ly", None),
        ("bit.ly.evil.com", None),
        ("sub.bit.ly", None),
    ],
)
def test_exact_shorteners(host, provider):
    value = extract_features("https://" + host + "/abc")
    assert value["shortener_provider"] == provider
    assert value["features"]["shortener"] == int(provider is not None)


@pytest.mark.parametrize(
    "domain,change",
    [
        ("gooogle.com", "insertion"),
        ("gogle.com", "deletion"),
        ("goggle.com", "substitution"),
        ("googel.com", "transposition"),
    ],
)
def test_typo_changes_and_registered_domain_only(domain, change):
    value = extract_features("https://accounts." + domain + "/login")
    assert value["typosquatting"]["tested_domain"] == domain
    assert value["typosquatting"]["reference_domain"] == "google.com"
    assert value["typosquatting"]["change"] == change
    assert 0 <= value["typosquatting"]["similarity"] <= 1
    assert not typosquatting("google.com")["indicator"]
    assert (
        extract_features("https://google.com.other.com")["typosquatting"][
            "tested_domain"
        ]
        == "other.com"
    )


def test_pinned_connection_tls_head_only_and_repeated_cookies(monkeypatch):
    dns, connect, readers, writers = network(
        monkeypatch,
        [
            headers(
                extra="Content-Length: 99999999\r\nSet-Cookie: a=x\r\nSet-Cookie: b=y\r\n"
            )
        ],
        addresses=[[answer(), answer("2001:4860:4860::8888")]],
    )
    result = asyncio.run(scanner.scan_online("https://bücher.de/login"))
    assert result["status"] == "complete" and result["http_status"] == 200
    assert result["final_domain"] == "xn--bcher-kva.de"
    assert dns.await_count == 1
    assert connect.call_args.args == ("8.8.8.8", 443)
    assert connect.call_args.kwargs["flags"] == socket.AI_NUMERICHOST
    assert connect.call_args.kwargs["server_hostname"] == "xn--bcher-kva.de"
    context = connect.call_args.kwargs["ssl"]
    assert context.check_hostname and context.verify_mode == ssl.CERT_REQUIRED
    request = writers[0].write.call_args.args[0]
    assert request.startswith(b"HEAD /login HTTP/1.1\r\nHost: xn--bcher-kva.de\r\n")
    assert (
        b"Cookie:" not in request
        and b"Authorization:" not in request
        and b"GET " not in request
    )
    readers[0].read.assert_not_called()
    writers[0].close.assert_called_once()
    writers[0].transport.abort.assert_called_once()


def test_dns_failure_and_mixed_answers(monkeypatch):
    dns, connect, _, _ = network(
        monkeypatch, [headers()], addresses=[socket.gaierror()]
    )
    result = asyncio.run(scanner.scan_online("https://example.com"))
    assert result["reason_code"] == "dns_failure"
    assert result["http_status"] is None
    connect.assert_not_called()
    for private in ("10.0.0.1", "fd00::1", "168.63.129.16"):
        dns, connect, _, _ = network(
            monkeypatch, [headers()], addresses=[[answer(), answer(private)]]
        )
        result = asyncio.run(scanner.scan_online("https://example.com"))
        assert (
            result["status"] == "blocked" and result["reason_code"] == "non_public_dns"
        )
        connect.assert_not_called()


def test_peer_mismatch_rebinding_sends_no_request(monkeypatch):
    _, _, _, writers = network(monkeypatch, [headers()], peers=["127.0.0.1"])
    result = asyncio.run(scanner.scan_online("https://example.com"))
    assert result["status"] == "blocked" and result["reason_code"] == "peer_mismatch"
    writers[0].write.assert_not_called()
    writers[0].transport.abort.assert_called_once()


def test_redirect_revalidates_same_host_dns_rebinding(monkeypatch):
    dns, connect, _, _ = network(
        monkeypatch,
        [headers(302, "Location: /next\r\n")],
        addresses=[[answer()], [answer("10.0.0.1")]],
    )
    result = asyncio.run(scanner.scan_online("https://example.com/start"))
    assert result["status"] == "blocked" and result["reason_code"] == "non_public_dns"
    assert dns.await_count == 2 and connect.await_count == 1
    assert result["redirect_count"] == 0
    assert result["http_status"] == 302 and result["final_url"] is None
    assert len(result["chain"]) == 1


@pytest.mark.parametrize(
    "location",
    [
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://router.internal/",
        "https://example.com:8443/",
        "file:///etc/passwd",
        "https://u:p@example.com/",
    ],
)
def test_redirect_forbidden_target_no_second_connection(location, monkeypatch):
    dns, connect, _, _ = network(
        monkeypatch, [headers(302, f"Location: {location}\r\n")]
    )
    result = asyncio.run(scanner.scan_online("https://example.com"))
    assert result["status"] == "blocked" and result["final_url"] is None
    assert result["redirect_count"] == 0 and result["redirects_observed"] == 1
    assert dns.await_count == connect.await_count == 1


def test_real_head_chain_relative_and_absolute_redirects(monkeypatch):
    _, connect, _, _ = network(
        monkeypatch,
        [
            headers(301, "Location: /middle\r\n"),
            headers(302, "Location: https://destination.com/end\r\n"),
            headers(204),
        ],
    )
    result = asyncio.run(scanner.scan_online("https://bit.ly/start"))
    assert result["status"] == "complete" and result["redirect_count"] == 2
    assert result["final_url"] == "https://destination.com/end"
    assert result["final_domain"] == "destination.com"
    assert [hop["http_status"] for hop in result["chain"]] == [301, 302, 204]
    assert connect.await_count == 3


def test_loop_stops_without_following_repeated_url(monkeypatch):
    _, connect, _, _ = network(
        monkeypatch,
        [headers(302, "Location: /b\r\n"), headers(302, "Location: /a#fragment\r\n")],
    )
    result = asyncio.run(scanner.scan_online("https://example.com/a"))
    assert result["reason_code"] == "redirect_loop" and connect.await_count == 2
    assert result["redirects_observed"] == 2 and result["final_url"] is None


def test_five_redirect_limit(monkeypatch):
    _, connect, _, _ = network(
        monkeypatch, [headers(302, f"Location: /hop{i}\r\n") for i in range(6)]
    )
    result = asyncio.run(scanner.scan_online("https://example.com"))
    assert result["redirect_count"] == 5 and len(result["chain"]) == 6
    assert result["reason_code"] == "redirect_limit" and connect.await_count == 6


@pytest.mark.parametrize(
    "status,expected",
    [
        (404, "http_error"),
        (500, "http_error"),
        (403, "http_error"),
        (405, "limited"),
        (501, "limited"),
    ],
)
def test_actual_http_error_or_head_unsupported(status, expected, monkeypatch):
    _, connect, readers, writers = network(monkeypatch, [headers(status)])
    result = asyncio.run(scanner.scan_online("https://example.com"))
    assert result["status"] == expected and result["http_status"] == status
    assert connect.await_count == 1
    assert writers[0].write.call_args.args[0].startswith(b"HEAD ")
    readers[0].read.assert_not_called()


def test_timeout_cancels_pending_request_and_total_deadline(monkeypatch):
    cancelled = []

    async def slow(url):
        try:
            await asyncio.sleep(1)
        finally:
            cancelled.append(True)

    monkeypatch.setattr(scanner, "REQUEST_TIMEOUT", 0.01)
    result = asyncio.run(scanner.scan_online("https://example.com", slow))
    assert result["reason_code"] == "timeout" and cancelled
    assert result["http_status"] is None
    monkeypatch.setattr(scanner, "REQUEST_TIMEOUT", 0.5)
    monkeypatch.setattr(scanner, "TOTAL_TIMEOUT", 0.02)

    async def hops(url):
        await asyncio.sleep(0.008)
        return 302, url + "next"

    result = asyncio.run(scanner.scan_online("https://example.com", hops))
    assert result["reason_code"] == "timeout" and len(result["chain"]) < 6


def test_tls_error_does_not_echo_network_exception(monkeypatch):
    network(monkeypatch, [headers()])
    monkeypatch.setattr(
        asyncio,
        "open_connection",
        AsyncMock(
            side_effect=ssl.SSLCertVerificationError(
                "https://secret.invalid/?token=hidden"
            )
        ),
    )
    result = asyncio.run(scanner.scan_online("https://example.com"))
    assert result["reason_code"] == "tls_failure"
    assert "token" not in str(result) and result["http_status"] is None


@pytest.mark.parametrize(
    "raw",
    [
        b"HTTP/1.1 200 OK\r\nX: " + b"a" * 17000 + b"\r\n\r\n",
        headers(extra="X: a\r\n" * 101),
        headers(302, "Location: /a\r\nLocation: /b\r\n"),
        b"HTTP/1.1 bogus\r\n\r\n",
        headers(extra=" folded: value\r\n"),
    ],
)
def test_bad_or_oversized_headers(raw, monkeypatch):
    _, _, _, writers = network(monkeypatch, [raw])
    result = asyncio.run(scanner.scan_online("https://example.com"))
    assert result["status"] == "unavailable" and result["http_status"] is None
    writers[0].close.assert_called_once()


def test_dns_and_encoded_request_resource_limits(monkeypatch):
    _, connect, _, _ = network(
        monkeypatch, [headers()], addresses=[[answer() for _ in range(65)]]
    )
    result = asyncio.run(scanner.scan_online("https://example.com"))
    assert result["reason_code"] == "dns_unverified"
    connect.assert_not_called()
    result = asyncio.run(scanner.scan_online("https://example.com/" + "界" * 1600))
    assert (
        result["reason_code"] == "request_too_large" and result["status"] == "blocked"
    )
    connect.assert_not_called()
