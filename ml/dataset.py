import csv
import hashlib
import io
import json
from collections import Counter

import pandas as pd

from ml.features import domain_parts, normalize_url

MAX_BYTES = 2_000_000
MAX_ROWS = 2000


def analyze_csv(raw, name="dataset.csv", max_rows=MAX_ROWS, max_bytes=MAX_BYTES):
    if not raw or len(raw) > max_bytes:
        raise ValueError(
            f"CSV must be nonempty and at most {max_bytes} bytes; use local training for larger datasets"
        )
    try:
        text = raw.decode("utf-8-sig", errors="strict")
        if "\x00" in text:
            raise ValueError("CSV contains invalid NUL characters")
        reader = csv.reader(io.StringIO(text), strict=True)
        if next(reader, None) != ["url", "label"]:
            raise ValueError("CSV columns must be exactly url,label")
        count = 0
        for row in reader:
            count += 1
            if count > max_rows:
                raise ValueError(f"CSV exceeds {max_rows} rows; use local training")
            if len(row) != 2:
                raise ValueError("Every CSV row must contain exactly two fields")
        frame = pd.read_csv(
            io.StringIO(text), dtype=str, keep_default_na=False, nrows=max_rows + 1
        )
    except (UnicodeError, csv.Error, pd.errors.ParserError, pd.errors.EmptyDataError):
        raise ValueError("CSV must be valid UTF-8 with url,label columns") from None
    if list(frame.columns) != ["url", "label"]:
        raise ValueError("CSV columns must be exactly url,label")
    if not 1 <= len(frame) <= max_rows:
        raise ValueError(
            f"CSV must contain 1–{max_rows} data rows; use the local script for larger datasets"
        )
    missing = int(
        ((frame.url.str.strip() == "") | (frame.label.str.strip() == "")).sum()
    )
    if missing:
        raise ValueError(f"Dataset has {missing} rows with missing URL or label")
    frame["label"] = frame.label.str.strip().str.lower()
    if not frame.label.isin(["benign", "phishing"]).all():
        raise ValueError("Labels must be phishing or benign (case-insensitive)")
    try:
        frame["url"] = frame.url.map(normalize_url)
    except ValueError as exc:
        raise ValueError(f"Dataset contains an invalid URL: {exc}") from None
    if (frame.groupby("url").label.nunique() > 1).any():
        raise ValueError("Identical normalized URLs have conflicting labels")
    raw_records = len(frame)
    duplicates = int(frame.url.duplicated().sum())
    frame = frame.drop_duplicates("url").reset_index(drop=True)
    groups = frame.url.map(lambda url: domain_parts(url)[1])
    summary = {
        "name": str(name)[:120],
        "sha256": hashlib.sha256(raw).hexdigest(),
        "records": len(frame),
        "raw_records": raw_records,
        "normalized_sha256": hashlib.sha256(
            json.dumps(frame.to_dict("records"), sort_keys=True).encode()
        ).hexdigest(),
        "missing_value_policy": "Reject incomplete rows; no label or URL imputation",
        "label_normalization": "strip whitespace, lowercase; phishing=1 and benign=0",
        "class_ratio_phishing": float((frame.label == "phishing").mean()),
        "duplicates_removed": duplicates,
        "missing_values": missing,
        "classes": dict(Counter(frame.label)),
        "registered_domain_groups": int(groups.nunique()),
        "preview": frame.head(8).to_dict("records"),
    }
    return frame, summary, groups
