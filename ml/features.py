"""Versioned lexical features; no DNS, HTTP, or corpus fitting."""

import hashlib
import json
from importlib.resources import files

import ipaddress
import math
import re
from collections import Counter
from urllib.parse import urlsplit, urlunsplit

import idna
import tldextract

SCHEMA_VERSION = "lexical-v2"
# Explicit reference set, fixed before any dataset split. Change requires retraining.
REFERENCES = (
    "google.com",
    "microsoft.com",
    "apple.com",
    "amazon.com",
    "paypal.com",
    "facebook.com",
)
SHORTENERS = frozenset(("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly"))
KEYWORDS = (
    "login",
    "verify",
    "account",
    "secure",
    "update",
    "password",
    "signin",
    "bank",
    "wallet",
)
EXTRACT = tldextract.TLDExtract(
    suffix_list_urls=(), cache_dir=None, include_psl_private_domains=True
)


def normalize_url(value):
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise ValueError("URL must contain 1–4096 characters")
    if any(ord(c) <= 32 or ord(c) == 127 for c in value) or "\\" in value:
        raise ValueError("Whitespace, controls, and backslashes are forbidden")
    if re.search(r"%(?![0-9a-fA-F]{2})", value):
        raise ValueError("Invalid percent encoding")
    try:
        p = urlsplit(value)
        if p.scheme.lower() not in ("http", "https") or not p.netloc or not p.hostname:
            raise ValueError("Only absolute HTTP(S) URLs are accepted")
        if p.username is not None or p.password is not None:
            raise ValueError("URL credentials are forbidden")
        host = p.hostname.rstrip(".").lower()
        try:
            host = str(ipaddress.ip_address(host))
        except ValueError:
            host = idna.encode(host, uts46=True, std3_rules=True).decode("ascii")
        if not host or len(host) > 253 or "%" in host:
            raise ValueError("Invalid hostname")
        port = p.port
        if port is not None and not 1 <= port <= 65535:
            raise ValueError("Invalid port")
        netloc = f"[{host}]" if ":" in host else host
        if port and port != (443 if p.scheme.lower() == "https" else 80):
            netloc += f":{port}"
        return urlunsplit((p.scheme.lower(), netloc, p.path or "/", p.query, ""))
    except (ValueError, idna.IDNAError) as exc:
        raise ValueError(str(exc)) from None


def domain_parts(url):
    host = urlsplit(url).hostname
    parts = EXTRACT(host)
    return host, parts.top_domain_under_public_suffix or host, parts


def distance(a, b):
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        nxt = [i]
        for j, y in enumerate(b, 1):
            nxt.append(min(nxt[-1] + 1, row[j] + 1, row[j - 1] + (x != y)))
        row = nxt
    return row[-1]


def typosquatting(registered):
    ref = min(
        REFERENCES, key=lambda r: distance(registered, r) / max(len(registered), len(r))
    )
    d = distance(registered, ref)
    similarity = 1 - d / max(len(registered), len(ref))
    transposed = any(
        registered == ref[:i] + ref[i + 1] + ref[i] + ref[i + 2 :]
        for i in range(len(ref) - 1)
    )
    indicator = registered not in REFERENCES and (
        d == 1 or transposed or (d <= 2 and similarity >= 0.8)
    )
    change = "none" if d == 0 else "multiple edits"
    if indicator:
        if transposed:
            change = "transposition"
        elif registered.replace("-", "") == ref:
            change = "hyphen insertion"
        elif d == 1:
            change = (
                "insertion"
                if len(registered) > len(ref)
                else "deletion" if len(registered) < len(ref) else "substitution"
            )
    return {
        "reference_domain": ref,
        "tested_domain": registered,
        "similarity": round(similarity, 6),
        "edit_distance": d,
        "change": change,
        "indicator": indicator,
    }


DEFINITIONS = {
    "url_length": "Characters in normalized URL (fragment excluded)",
    "domain_length": "Characters in normalized ASCII hostname",
    "path_length": "Characters in path; empty path normalized to /",
    "query_length": "Characters in query",
    "dot_count": "Dots in normalized URL",
    "hyphen_count": "Hyphens in normalized URL",
    "digit_count": "ASCII digits in normalized URL",
    "special_count": "Non-alphanumeric characters in normalized URL",
    "subdomain_count": "Labels preceding the registered domain (private PSL included)",
    "suspicious_keywords": "Count of fixed keyword tokens occurring in normalized URL",
    "ip_address": "Hostname is an IPv4/IPv6 literal",
    "https": "HTTPS scheme indicator",
    "shortener": "Hostname exactly matches fixed shortener set",
    "domain_entropy": "Shannon entropy of ASCII hostname characters, bits",
    "digit_ratio": "ASCII digit count divided by normalized URL length",
    "special_ratio": "Special character count divided by normalized URL length",
    "typo_similarity": "Maximum normalized Levenshtein similarity to fixed references",
    "registered_domain_length": "Characters in registered domain",
    "suffix_length": "Characters in PSL suffix",
    "punycode": "Hostname contains an xn-- label",
    "url_entropy": "Shannon entropy of normalized URL characters, bits",
}
FEATURE_NAMES = tuple(DEFINITIONS)
BASIC = (
    "url_length",
    "domain_length",
    "digit_count",
    "dot_count",
    "hyphen_count",
    "special_count",
    "subdomain_count",
)


def extract_features(value):
    url = normalize_url(value)
    p = urlsplit(url)
    host, registered, parts = domain_parts(url)
    typo = typosquatting(registered)
    try:
        ipaddress.ip_address(host)
        is_ip = 1
    except ValueError:
        is_ip = 0
    digits = sum(c in "0123456789" for c in url)
    special = sum(not c.isalnum() for c in url)
    counts = Counter(host)
    features = dict(
        zip(
            FEATURE_NAMES,
            (
                len(url),
                len(host),
                len(p.path),
                len(p.query),
                url.count("."),
                url.count("-"),
                digits,
                special,
                len(parts.subdomain.split(".")) if parts.subdomain and not is_ip else 0,
                sum(k in url.lower() for k in KEYWORDS),
                is_ip,
                int(p.scheme == "https"),
                int(host in SHORTENERS),
                -sum(
                    (n / len(host)) * math.log2(n / len(host)) for n in counts.values()
                ),
                digits / len(url),
                special / len(url),
                typo["similarity"],
                len(registered),
                len(parts.suffix),
                int(any(s.startswith("xn--") for s in host.split("."))),
                -sum(
                    (n / len(url)) * math.log2(n / len(url))
                    for n in Counter(url).values()
                ),
            ),
        )
    )
    return {
        "url": url,
        "registered_domain": registered,
        "features": features,
        "typosquatting": typo,
        "shortener_provider": host if host in SHORTENERS else None,
        "schema_version": SCHEMA_VERSION,
        "feature_fingerprint": FEATURE_FINGERPRINT,
    }


# Offline PSL snapshot is part of the feature contract; no network refresh occurs.
FEATURE_PROVENANCE = {
    "schema_version": SCHEMA_VERSION,
    "feature_names": list(FEATURE_NAMES),
    "definitions": DEFINITIONS,
    "references": list(REFERENCES),
    "keywords": list(KEYWORDS),
    "shorteners": sorted(SHORTENERS),
    "tldextract_version": tldextract.__version__,
    "include_private_suffixes": True,
    "psl_snapshot_sha256": hashlib.sha256(
        files("tldextract").joinpath(".tld_set_snapshot").read_bytes()
    ).hexdigest(),
    "normalization": "absolute HTTP(S), UTS46 ASCII hostname, default port/empty path normalized, fragment excluded",
}
FEATURE_FINGERPRINT = hashlib.sha256(
    json.dumps(FEATURE_PROVENANCE, sort_keys=True).encode()
).hexdigest()
