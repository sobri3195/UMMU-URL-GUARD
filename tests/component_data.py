"""Generate actual Python results for isolated frontend component unit tests only.

No model files are written, no network targets contacted, no production API runs.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import base64
import json
from conftest import research_csv
from ml.dataset import analyze_csv
from ml.features import DEFINITIONS, extract_features
from ml.model import run_experiment, predict

raw = research_csv.__wrapped__()
report, bundle = run_experiment(raw, "component-unit-only.csv", seed=7, estimators=20)
frame, summary, _ = analyze_csv(raw, "component-unit-only.csv")
urls = list(frame.url.head(3)) + [
    "https://example.com/login?token=unit-secret-1",
    "https://google.com/about?token=unit-secret-2",
]
features = {url: {**extract_features(url), "definitions": DEFINITIONS} for url in urls}
predictions = {
    url: {**value, **predict(value, bundle)} for url, value in features.items()
}
print(
    json.dumps(
        {
            "report": report,
            "summary": summary,
            "features": features,
            "predictions": predictions,
            "csv": base64.b64encode(raw).decode(),
        },
        allow_nan=False,
    )
)
