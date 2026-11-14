import numpy as np
import pytest
from ml.dataset import analyze_csv
from ml.evaluation import evaluate
from ml.features import extract_features
from ml.model import load_production, predict, run_experiment, split_groups


@pytest.mark.parametrize(
    "raw",
    [
        b"",
        b"url,label\n",
        b"x,label\nhttps://example.com,benign",
        b"url,label\nhttps://example.com,unknown",
        b"url,label\n,benign",
        b"url,label\nhttps://example.com,benign\nhttps://EXAMPLE.com/,phishing",
        b"\xff,\xfe",
        b"url,label\njunk,https://example.com,benign",
        b"url,label\nhttps://example.com,benign\x00",
    ],
)
def test_bad_datasets(raw):
    with pytest.raises(ValueError):
        analyze_csv(raw)


def test_duplicates():
    frame, summary, _ = analyze_csv(
        b"url,label\nhttps://example.com,BENIGN\nhttps://EXAMPLE.com/,benign"
    )
    assert len(frame) == 1
    assert summary["duplicates_removed"] == 1


def test_split_no_leakage(research_csv):
    frame, _, groups = analyze_csv(research_csv)
    y = (frame.label == "phishing").to_numpy(int)
    a, b, c, _ = split_groups(y, groups, 42)
    assert not set(groups.iloc[a]) & set(groups.iloc[b])
    assert not set(groups.iloc[a]) & set(groups.iloc[c])
    assert not set(groups.iloc[b]) & set(groups.iloc[c])
    assert len(a) + len(b) + len(c) == len(frame)


def test_training_and_inference(research_csv):
    report, artifact = run_experiment(
        research_csv, "synthetic-test-only.csv", estimators=20
    )
    assert len(report["reports"]) == 6
    assert all(row["test"]["positive_class"] == "phishing" for row in report["reports"])
    assert all(
        sum(map(sum, r["test"]["confusion_matrix"])) == report["split"]["test"]["rows"]
        for r in report["reports"]
    )
    assert artifact["feature_names"] == list(
        extract_features("https://example.com")["features"]
    )
    result = predict(extract_features("https://example.com"), artifact)
    assert result["prediction"] in ("benign", "phishing")
    assert 0 <= result["probability"] <= 1
    assert predict(extract_features("https://example.com"), None)["prediction"] is None


def test_metrics():
    class Estimator:
        classes_ = [0, 1]

        def predict(self, x):
            return np.array([0, 1, 1, 0])

        def predict_proba(self, x):
            return np.array([[0.8, 0.2], [0.1, 0.9], [0.2, 0.8], [0.7, 0.3]])

    result = evaluate(Estimator(), np.zeros((4, 1)), np.array([0, 0, 1, 1]))
    assert result["confusion_matrix"] == [[1, 1], [1, 1]]
    assert result["f1"] == 0.5
    assert result["accuracy"] == 0.5


def test_artifact_mismatch(tmp_path, monkeypatch):
    import ml.model as model

    (tmp_path / "model.joblib").write_bytes(b"not a joblib")
    (tmp_path / "model_metadata.json").write_text('{"artifact_sha256":"wrong"}')
    monkeypatch.setattr(model, "MODEL_DIR", tmp_path)
    assert load_production() == (None, None)
