"""Bounded HEAD metadata only; DNS is checked and TCP is pinned at every hop.

No HTTP proxy, automatic redirects, cookies, browser navigation, or GET fallback.
Opaque/proxy-only egress is unavailable rather than weakening address pinning.
"""

import asyncio
import ipaddress
import re
import socket
import ssl
import time
from urllib.parse import quote, urljoin, urlsplit

from ml.features import domain_parts
from ml.url_validation import (
    BlockedTarget,
    public_address,
    validate_host,
    validate_target,
)

MAX_REDIRECTS = 5
HEADER_LIMIT = 16384
MAX_HEADER_FIELDS = 100
MAX_DNS_ANSWERS = 64
MAX_REQUEST_BYTES = 8192
REQUEST_TIMEOUT = 5
TOTAL_TIMEOUT = 15


class ScanError(ValueError):
    def __init__(self, message, code="response_invalid"):
        super().__init__(message)
        self.code = code


def unavailable(reason, code):
    return {
        "status": "unavailable",
        "reason": reason,
        "reason_code": code,
        "redirect_count": 0,
        "redirects_observed": 0,
        "http_status": None,
        "final_url": None,
        "final_domain": None,
        "last_checked_url": None,
        "chain": [],
        "response_ms": None,
    }


async def resolve(host, port):
    validate_host(host)
    try:
        ipaddress.ip_address(host)
        return [host]  # Literal IP needs no DNS; validate_host already checked it.
    except ValueError:
        pass
    try:
        records = await asyncio.get_running_loop().getaddrinfo(
            host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP
        )
    except socket.gaierror:
        raise ScanError("DNS resolution failed", "dns_failure") from None
    if not records or len(records) > MAX_DNS_ANSWERS:
        raise ScanError(
            "DNS answers missing or above the resource limit", "dns_unverified"
        )
    ips = []
    for family, kind, proto, _, sockaddr in records:
        if (
            family not in (socket.AF_INET, socket.AF_INET6)
            or kind != socket.SOCK_STREAM
        ):
            raise ScanError(
                "DNS address family could not be verified", "dns_unverified"
            )
        address = sockaddr[0]
        if not public_address(address):
            raise BlockedTarget(
                "DNS returned a non-public address; online request blocked",
                "non_public_dns",
            )
        if ipaddress.ip_address(address).version != (
            4 if family == socket.AF_INET else 6
        ):
            raise ScanError("DNS address family mismatch", "dns_unverified")
        if address not in ips:
            ips.append(address)
    return ips


def parse_headers(raw):
    if len(raw) > HEADER_LIMIT:
        raise ScanError("Response headers too large", "headers_too_large")
    lines = raw.decode("iso-8859-1").split("\r\n")
    match = re.fullmatch(
        r"HTTP/1\.[01] ([1-5][0-9]{2})(?: [\x20-\x7e\x80-\xff]*)?", lines[0]
    )
    if not match:
        raise ScanError("Invalid HTTP status line")
    fields = [line for line in lines[1:] if line]
    if len(fields) > MAX_HEADER_FIELDS:
        raise ScanError("Too many response headers", "headers_too_large")
    location = None
    for line in fields:
        key, sep, value = line.partition(":")
        if (
            not sep
            or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", key)
            or any((ord(c) < 32 and c != "\t") or ord(c) == 127 for c in value)
        ):
            raise ScanError("Malformed response header")
        # Repeated irrelevant fields such as Set-Cookie are legal and ignored.
        if key.lower() == "location":
            if location is not None:
                raise ScanError("Ambiguous duplicate Location header")
            location = value.strip(" \t")
    return int(match[1]), location


async def head(value):
    url = validate_target(value)
    p = urlsplit(url)
    port = 443 if p.scheme == "https" else 80
    path = quote(p.path or "/", safe="/%:@!$&'()*+,;=-._~")
    if p.query:
        path += "?" + quote(p.query, safe="/%?:@!$&'()*+,;=-._~")
    host_header = f"[{p.hostname}]" if ":" in p.hostname else p.hostname
    request = (
        f"HEAD {path} HTTP/1.1\r\nHost: {host_header}\r\nUser-Agent: UMMU-URL-GUARD/1.0\r\nConnection: close\r\nAccept: */*\r\n\r\n"
    ).encode("ascii")
    if len(request) > MAX_REQUEST_BYTES:
        raise BlockedTarget("Encoded request target exceeds 8 KB", "request_too_large")
    ips = await resolve(p.hostname, port)
    # Defense in depth: never connect even if a resolver implementation regresses.
    if not ips or not all(public_address(ip) for ip in ips):
        raise BlockedTarget(
            "Connection addresses could not be validated", "non_public_dns"
        )
    context = ssl.create_default_context() if p.scheme == "https" else None
    if context:
        context.set_alpn_protocols(["http/1.1"])
    # Numeric destination prevents a second hostname lookup / DNS rebinding.
    reader, writer = await asyncio.open_connection(
        ips[0],
        port,
        ssl=context,
        server_hostname=p.hostname if context else None,
        family=socket.AF_INET6 if ":" in ips[0] else socket.AF_INET,
        flags=socket.AI_NUMERICHOST,
        limit=HEADER_LIMIT,
    )
    try:
        peer = writer.get_extra_info("peername")
        if (
            not peer
            or not public_address(peer[0])
            or ipaddress.ip_address(peer[0]) != ipaddress.ip_address(ips[0])
        ):
            raise BlockedTarget(
                "Connected peer did not match the validated address", "peer_mismatch"
            )
        writer.write(request)
        await writer.drain()
        try:
            raw = await reader.readuntil(b"\r\n\r\n")
        except (asyncio.LimitOverrunError, asyncio.IncompleteReadError):
            raise ScanError(
                "Response headers incomplete or too large", "headers_incomplete"
            ) from None
        return parse_headers(raw)
    finally:
        writer.close()
        # End transport immediately; never wait for a hostile TLS peer or read a body.
        transport = getattr(writer, "transport", None)
        if transport is not None:
            transport.abort()


async def scan_online(value, request=None):
    request = request or head
    started = time.monotonic()
    result = unavailable("Online check did not complete", "unavailable")
    visited = set()
    try:
        current = validate_target(value)
        async with asyncio.timeout(TOTAL_TIMEOUT):
            for hop in range(MAX_REDIRECTS + 1):
                if current in visited:
                    raise ScanError("Redirect loop detected", "redirect_loop")
                visited.add(current)
                async with asyncio.timeout(REQUEST_TIMEOUT):
                    status, location = await request(current)
                result["chain"].append({"url": current, "http_status": status})
                result.update(
                    http_status=status, last_checked_url=current, redirect_count=hop
                )
                if status in (301, 302, 303, 307, 308):
                    result["redirects_observed"] += 1
                    if not location:
                        raise ScanError(
                            "Redirect did not include Location", "missing_location"
                        )
                    if hop == MAX_REDIRECTS:
                        raise ScanError("Redirect limit reached (5)", "redirect_limit")
                    # Check scheme, credentials, host, and port before next-hop DNS.
                    next_url = validate_target(urljoin(current, location))
                    if next_url in visited:
                        raise ScanError("Redirect loop detected", "redirect_loop")
                    current = next_url
                    continue
                if status in (405, 501) or status < 200:
                    result.update(
                        status="limited",
                        reason=(
                            "HEAD is not supported; no body fallback performed"
                            if status in (405, 501)
                            else "Interim HTTP response; final headers not consumed"
                        ),
                        reason_code=(
                            "head_unsupported"
                            if status in (405, 501)
                            else "interim_response"
                        ),
                    )
                    break
                result.update(
                    status="http_error" if status >= 400 else "complete",
                    final_url=current,
                    final_domain=domain_parts(current)[1],
                    reason=f"Target returned HTTP {status}" if status >= 400 else None,
                    reason_code="http_error" if status >= 400 else None,
                )
                break
    except BlockedTarget as exc:
        result.update(status="blocked", reason=str(exc), reason_code=exc.code)
    except ScanError as exc:
        result.update(reason=str(exc), reason_code=exc.code)
    except TimeoutError:
        result.update(reason="Online check timed out", reason_code="timeout")
    except ssl.SSLError:
        result.update(
            reason="TLS certificate or handshake validation failed",
            reason_code="tls_failure",
        )
    except (OSError, ValueError):
        result.update(
            reason="Connection or redirect validation failed",
            reason_code="connection_failure",
        )
    result["response_ms"] = round((time.monotonic() - started) * 1000)
    return result
