"""Bounded, body-free HEAD checks with pinned, publicly validated DNS addresses.

Direct sockets deliberately do not use HTTP proxies: if direct egress is unavailable,
report unavailable rather than delegating DNS/SSRF decisions to an opaque proxy.
"""

import asyncio
import ipaddress
import re
import socket
import ssl
import time
from urllib.parse import urljoin, urlsplit, quote

from ml.features import normalize_url

MAX_REDIRECTS = 5
HEADER_LIMIT = 16384


class ScanError(ValueError):
    pass


def public_address(address):
    ip = ipaddress.ip_address(address)
    return (
        ip.is_global
        and not (
            ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_private
        )
        and not any(
            getattr(ip, attr, None) for attr in ("ipv4_mapped", "sixtofour", "teredo")
        )
    )


async def resolve(host, port):
    if "." not in host and ":" not in host:
        raise ScanError("Local and internal hostnames are blocked")
    if host.endswith((".localhost", ".local", ".internal", ".test", ".invalid")):
        raise ScanError("Internal hostname is blocked")
    try:
        records = await asyncio.get_running_loop().getaddrinfo(
            host, port, type=socket.SOCK_STREAM
        )
    except socket.gaierror:
        raise ScanError("DNS resolution failed") from None
    ips = list(dict.fromkeys(record[4][0] for record in records))
    if not ips or not all(public_address(ip) for ip in ips):
        raise ScanError("DNS returned a non-public address; online request blocked")
    return ips


async def head(url):
    p = urlsplit(url)
    port = p.port or (443 if p.scheme == "https" else 80)
    if port != (443 if p.scheme == "https" else 80):
        raise ScanError("Only standard HTTP/HTTPS ports are permitted")
    ips = await resolve(p.hostname, port)
    # Connect to numeric validated IP, retain original hostname for certificate/SNI/Host.
    context = ssl.create_default_context() if p.scheme == "https" else None
    reader, writer = await asyncio.open_connection(
        ips[0],
        port,
        ssl=context,
        server_hostname=p.hostname if context else None,
        limit=HEADER_LIMIT,
    )
    try:
        peer = writer.get_extra_info("peername")[0]
        if ipaddress.ip_address(peer) != ipaddress.ip_address(ips[0]):
            raise ScanError("Connection address could not be verified")
        path = quote(p.path or "/", safe="/%:@!$&'()*+,;=-._~")
        if p.query:
            path += "?" + quote(p.query, safe="/%?:@!$&'()*+,;=-._~")
        host_header = f"[{p.hostname}]" if ":" in p.hostname else p.hostname
        writer.write(
            (
                f"HEAD {path} HTTP/1.1\r\nHost: {host_header}\r\nUser-Agent: UMMU-URL-GUARD/1.0\r\nConnection: close\r\nAccept: */*\r\n\r\n"
            ).encode("ascii")
        )
        await writer.drain()
        try:
            raw = await reader.readuntil(b"\r\n\r\n")
        except (asyncio.LimitOverrunError, asyncio.IncompleteReadError):
            raise ScanError("Response headers incomplete or too large") from None
        if len(raw) > HEADER_LIMIT:
            raise ScanError("Response headers too large")
        lines = raw.decode("iso-8859-1").split("\r\n")
        if not re.fullmatch(r"HTTP/1\.[01] [1-5][0-9]{2}(?: .*)?", lines[0]):
            raise ScanError("Invalid HTTP status")
        headers = {}
        for line in lines[1:]:
            if not line:
                continue
            key, sep, value = line.partition(":")
            if (
                not sep
                or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", key)
                or key.lower() in headers
            ):
                raise ScanError("Malformed or duplicate response header")
            headers[key.lower()] = value.strip()
        return int(lines[0].split()[1]), headers.get("location")
    finally:
        writer.close()
        # No body is read; do not wait for a hostile peer to close TLS.


async def scan_online(value, request=head):
    current = normalize_url(value)
    chain = []
    started = time.monotonic()
    result = {
        "status": "unavailable",
        "redirect_count": 0,
        "http_status": None,
        "final_url": None,
        "chain": chain,
    }
    try:
        async with asyncio.timeout(15):
            for hop in range(MAX_REDIRECTS + 1):
                async with asyncio.timeout(5):
                    status, location = await request(current)
                chain.append({"url": current, "http_status": status})
                result["http_status"] = status
                if status in (301, 302, 303, 307, 308):
                    if not location:
                        raise ScanError("Redirect did not include Location")
                    if hop == MAX_REDIRECTS:
                        raise ScanError("Redirect limit reached (5)")
                    current = normalize_url(urljoin(current, location))
                    result["redirect_count"] += 1
                    continue
                if status in (405, 501):
                    raise ScanError("HEAD is not supported; no body fallback performed")
                if status < 200:
                    raise ScanError("Interim HTTP response not supported")
                result.update(status="complete", final_url=current)
                break
    except TimeoutError:
        result["reason"] = "Online check timed out"
    except (OSError, ValueError) as exc:
        # Never echo exception text from network libraries: it may contain URLs.
        result["reason"] = (
            str(exc)
            if isinstance(exc, ScanError)
            else "Connection, TLS, or redirect validation failed"
        )
    result["response_ms"] = round((time.monotonic() - started) * 1000)
    return result
