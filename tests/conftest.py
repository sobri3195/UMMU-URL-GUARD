import pytest


@pytest.fixture
def research_csv():
    # Synthetic fixtures test mechanics only; never a production dataset/result.
    rows = ["url,label"]
    for i in range(90):
        label = "phishing" if i % 3 == 0 else "benign"
        path = "/verify-account-123" if label == "phishing" else "/about"
        rows.extend(
            [
                f"https://research{i}.com{path},{label}",
                f"https://research{i}.com/other{path},{label}",
            ]
        )
    return "\n".join(rows).encode()
