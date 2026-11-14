"""Network-target policy, separate from offline lexical feature definitions."""

import ipaddress
import re
from urllib.parse import urlsplit

from ml.features import normalize_url

# Fixed destinations with special platform meaning despite public-looking IPs.
PLATFORM_IPS = frozenset({ipaddress.ip_address("168.63.129.16")})
INTERNAL_SUFFIXES = (
    "localhost",
    "local",
    "internal",
    "invalid",
    "test",
    "onion",
    "home.arpa",
    "lan",
    "corp",
    "intranet",
)


class BlockedTarget(ValueError):
    def __init__(self, message, code="target_blocked"):
        super().__init__(message)
        self.code = code


def public_address(address):
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return (
        ip not in PLATFORM_IPS
        and ip.is_global
        and not any(
            getattr(ip, flag, False)
            for flag in (
                "is_multicast",
                "is_reserved",
                "is_unspecified",
                "is_loopback",
                "is_link_local",
                "is_private",
                "is_site_local",
            )
        )
        and not any(
            getattr(ip, attr, None) for attr in ("ipv4_mapped", "sixtofour", "teredo")
        )
        # Never route NAT64/translation addresses to an embedded private IPv4.
        and not (
            ip.version == 6
            and (
                ip in ipaddress.ip_network("64:ff9b::/96")
                or ip in ipaddress.ip_network("64:ff9b:1::/48")
            )
        )
    )


def validate_host(host):
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not public_address(str(literal)):
            raise BlockedTarget(
                "Non-public or platform metadata IP is blocked", "non_public_ip"
            )
        return
    if "." not in host or any(
        host == suffix or host.endswith("." + suffix) for suffix in INTERNAL_SUFFIXES
    ):
        raise BlockedTarget("Local and internal hostnames are blocked", "internal_host")
    if all(
        re.fullmatch(r"(?:[0-9]+|0x[0-9a-f]+)", label, re.I)
        for label in host.split(".")
    ):
        raise BlockedTarget("Ambiguous numeric IP notation is blocked", "ambiguous_ip")


def validate_target(value):
    try:
        url = normalize_url(value)
    except ValueError:
        raise BlockedTarget(
            "Invalid HTTP(S) target or redirect; credentials are forbidden",
            "invalid_target",
        ) from None
    parsed = urlsplit(url)
    if parsed.port not in (None, 443 if parsed.scheme == "https" else 80):
        raise BlockedTarget(
            "Only standard HTTP/HTTPS ports are permitted", "forbidden_port"
        )
    validate_host(parsed.hostname)
    return url
