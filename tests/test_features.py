import pytest
from ml.features import (
    FEATURE_NAMES,
    domain_parts,
    extract_features,
    normalize_url,
    typosquatting,
)


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com",
        "https://u:p@example.com",
        "http://",
        "https://exa mple.com",
        "https://example.com\\x",
        "https://example.com/%ZZ",
        "https://example.com:99999",
        "javascript:alert(1)",
        "https://example.com\nX: y",
    ],
)
def test_invalid(url):
    with pytest.raises(ValueError):
        normalize_url(url)


def test_normalization():
    assert normalize_url("HTTPS://EXAMPLE.COM:443#x") == "https://example.com/"
    assert normalize_url("https://bücher.de") == "https://xn--bcher-kva.de/"
    assert normalize_url("http://[::1]") == "http://[::1]/"


def test_consistency_and_domain():
    value = extract_features("https://www.google.com/login?q=123")
    assert tuple(value["features"]) == FEATURE_NAMES
    assert value["features"]["suspicious_keywords"] == 1
    assert value["features"]["digit_count"] == 3
    assert value["features"]["subdomain_count"] == 1
    assert value["registered_domain"] == "google.com"
    assert domain_parts("https://a.research.co.uk/")[1] == "research.co.uk"
    assert domain_parts("https://tenant.github.io/")[1] == "tenant.github.io"
    assert extract_features("http://127.0.0.1/")["features"]["ip_address"] == 1
    assert extract_features("https://bit.ly/id")["features"]["shortener"] == 1
    assert extract_features("https://notbit.ly/")["features"]["shortener"] == 0


@pytest.mark.parametrize(
    "domain,change",
    [
        ("gooogle.com", "insertion"),
        ("gogle.com", "deletion"),
        ("googel.com", "transposition"),
        ("go-ogle.com", "hyphen insertion"),
        ("g00gle.com", "multiple edits"),
    ],
)
def test_typos(domain, change):
    result = typosquatting(domain)
    assert result["indicator"]
    assert result["change"] == change
    assert not typosquatting("google.com")["indicator"]
