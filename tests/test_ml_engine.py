"""Synthetic fixtures stay in tests/temp directories, never shipped as research evidence."""

import hashlib
import json
import subprocess
import sys
from collections import Counter
from datetime import datetime
from unittest.mock import Mock

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import api.index as api
import ml.model as model
from ml.artifacts import load_artifact, save_artifact
from ml.dataset import analyze_csv
from ml.evaluation import evaluate
from ml.features import (
    BASIC,
    FEATURE_NAMES,
    FEATURE_FINGERPRINT,
    FEATURE_PROVENANCE,
    extract_features,
)


@pytest.fixture(scope="module")
def trained():
    rows = ["url,label"]
    for i in range(90):
        label = "phishing" if i % 3 == 0 else "benign"
        rows.append(
            f'https://fixture{i}.com/{"verify" if i % 3 == 0 else "about"}{"x" * i},{label}'
        )
    raw = "\n".join(rows).encode()
    report, bundle = model.run_experiment(raw, "test-fixture-only.csv", estimators=20)
    return raw, report, bundle


def test_schema_entropy_and_no_target_or_online_features():
    result = extract_features("https://example.com/a?x=1")
    assert result["schema_version"] == "lexical-v2"
    assert result["feature_fingerprint"] == FEATURE_FINGERPRINT
    assert len(FEATURE_NAMES) == 21 and len(set(FEATURE_NAMES)) == 21
    assert result["features"]["url_entropy"] > 0
    assert result["features"]["url_entropy"] != result["features"]["domain_entropy"]
    assert all(
        isinstance(v, (float, int)) and np.isfinite(v)
        for v in result["features"].values()
    )
    assert not {"label", "http_status", "redirect_count", "prediction"} & set(
        FEATURE_NAMES
    )
    assert len(FEATURE_PROVENANCE["psl_snapshot_sha256"]) == 64


def test_dataset_hash_limits_labels_stats_and_conflicts():
    raw = b"url,label\nhttps://EXAMPLE.com, BENIGN \nhttps://example.com/,benign\nhttps://other.com/login,Phishing"
    frame, stats, groups = analyze_csv(raw)
    assert stats["sha256"] == hashlib.sha256(raw).hexdigest()
    assert stats["raw_records"] == 3 and stats["records"] == 2
    assert stats["duplicates_removed"] == 1
    assert stats["classes"] == {"benign": 1, "phishing": 1}
    assert len(stats["normalized_sha256"]) == 64
    assert frame.label.tolist() == ["benign", "phishing"]
    with pytest.raises(ValueError):
        analyze_csv(raw, max_bytes=len(raw) - 1)
    with pytest.raises(ValueError):
        analyze_csv(raw, max_rows=1)
    with pytest.raises(ValueError, match="conflicting"):
        analyze_csv(
            b"url,label\nhttps://example.com,benign\nhttps://example.com,PHISHING"
        )
    with pytest.raises(ValueError, match="missing"):
        analyze_csv(b"url,label\nhttps://example.com,")


def test_stratified_group_plan_deterministic_and_imbalance():
    groups = np.repeat([f"group{i}" for i in range(90)], 2)
    y = np.repeat([int(i % 3 == 0) for i in range(90)], 2)
    parts = model._split_plan(y, groups, 42)
    assert parts[4]["method"] == "stratified_group_shuffle"
    for a in range(3):
        assert len(np.unique(y[parts[a]])) == 2
        for b in range(a + 1, 3):
            assert not set(groups[parts[a]]) & set(groups[parts[b]])
        assert np.array_equal(parts[a], model._split_plan(y, groups, 42)[a])
    # Three positive groups cannot support two stages of stratification.
    rare = np.repeat([int(i % 30 == 0) for i in range(90)], 2)
    fallback = model._split_plan(rare, groups, 42)
    assert fallback[4]["method"] == "group_shuffle"
    assert fallback[4]["fallback_reason"]
    assert all(len(np.unique(rare[part])) == 2 for part in fallback[:3])
    impossible = np.zeros(len(groups), dtype=int)
    impossible[:2] = 1
    with pytest.raises(ValueError, match="3 domain groups"):
        model._split_plan(impossible, groups, 42)


def test_all_models_pipeline_train_only_scaler_and_holdout_once(
    research_csv, monkeypatch
):
    frame, _, groups = analyze_csv(research_csv)
    y = (frame.label == "phishing").to_numpy(int)
    train, val, test, _, _ = model._split_plan(y, groups, 42)
    feature_rows = [extract_features(url)["features"] for url in frame.url]
    matrices = {
        len(names): np.array([[row[key] for key in names] for row in feature_rows])
        for names in (BASIC, FEATURE_NAMES)
    }
    fit_inputs = []
    original_fit = StandardScaler.fit

    def scaler_fit(self, x, y=None, **kwargs):
        fit_inputs.append(x.copy())
        result = original_fit(self, x, y, **kwargs)
        assert np.allclose(self.mean_, np.asarray(x).mean(axis=0))
        return result

    monkeypatch.setattr(StandardScaler, "fit", scaler_fit)
    calls = Counter()
    phases = []
    original_evaluate = model.evaluate

    def tracked(estimator, x, labels):
        assert isinstance(estimator, Pipeline)
        matrix = matrices[x.shape[1]]
        classifier = type(estimator.named_steps["classifier"]).__name__
        is_test = np.array_equal(x, matrix[test]) and np.array_equal(labels, y[test])
        is_val = np.array_equal(x, matrix[val]) and np.array_equal(labels, y[val])
        assert is_test != is_val
        phases.append("test" if is_test else "validation")
        calls[(x.shape[1], classifier, "test" if is_test else "validation")] += 1
        return original_evaluate(estimator, x, labels)

    monkeypatch.setattr(model, "evaluate", tracked)
    report, bundle = model.run_experiment(research_csv, "unit-only.csv", estimators=20)
    assert phases == ["validation"] * 8 + ["test"] * 6
    assert len(fit_inputs) == 2
    for x in fit_inputs:
        assert np.array_equal(x, matrices[x.shape[1]][train])
    for count in (len(BASIC), len(FEATURE_NAMES)):
        for family in (
            "RandomForestClassifier",
            "LogisticRegression",
            "DecisionTreeClassifier",
        ):
            assert calls[(count, family, "test")] == 1
        assert calls[(count, "RandomForestClassifier", "validation")] == 2
    assert isinstance(bundle["estimator"], Pipeline)
    for row in report["reports"]:
        assert row["config"]["class_weight"] == "balanced"
        if row["model_name"] == "Random Forest":
            assert row["validation"]["f1"] == max(
                c["validation_f1"] for c in row["validation_candidates"]
            )
        assert sum(map(sum, row["test"]["confusion_matrix"])) == len(test)
        assert (
            row["error_count"]
            == row["false_positive_count"] + row["false_negative_count"]
        )


def test_metrics_undefined_are_null_with_reasons():
    class AllBenign:
        classes_ = [0, 1]

        def predict(self, x):
            return np.zeros(len(x), int)

        def predict_proba(self, x):
            return np.tile([1.0, 0.0], (len(x), 1))

    metrics = evaluate(AllBenign(), np.ones((4, 1)), np.array([0, 1, 0, 1]))
    assert metrics["precision"] is None
    assert metrics["metric_reasons"]["precision"] == "No predicted phishing samples"
    assert metrics["recall"] == 0 and metrics["f1"] == 0
    single = evaluate(AllBenign(), np.ones((2, 1)), np.zeros(2, int))
    assert single["roc_auc"] is None and single["pr_auc"] is None
    assert single["roc"] is None and single["pr"] is None
    assert single["metric_reasons"]["recall"]
    assert evaluate(AllBenign(), np.empty((0, 1)), np.array([]))["accuracy"] is None
    json.dumps(single, allow_nan=False)


def test_serialization_order_and_backend_prediction(trained, tmp_path, monkeypatch):
    raw, report, bundle = trained
    save_artifact(
        bundle,
        report,
        tmp_path,
        source="Synthetic unit fixture only",
        license_name="Test only; not research evidence",
    )
    restored, metadata = load_artifact(tmp_path)
    assert restored is not None
    assert metadata["dataset_sha256"] == hashlib.sha256(raw).hexdigest()
    assert metadata["feature_names"] == list(FEATURE_NAMES)
    assert metadata["feature_provenance"] == FEATURE_PROVENANCE
    value = extract_features("https://example.com/login?q=123")
    before = model.predict(value, bundle)
    after = model.predict(
        {**value, "features": dict(reversed(list(value["features"].items())))}, restored
    )
    for key in ("prediction", "probability", "model_version"):
        assert before[key] == after[key]
    x = np.asarray([[value["features"][key] for key in FEATURE_NAMES]])
    assert after["probability"] == restored["estimator"].predict_proba(x)[0, 1]
    assert datetime.fromisoformat(after["prediction_timestamp"]).tzinfo is not None
    monkeypatch.setattr(model, "MODEL_DIR", tmp_path)
    c = TestClient(api.create_app())
    assert c.get("/api/health").json()["model_available"] is True
    response = c.post("/api/predict", json={"url": value["url"]})
    assert response.status_code == 200
    assert response.json()["probability"] == after["probability"]
    assert response.json()["model_status"] == "available"


@pytest.mark.parametrize(
    "field,value",
    [
        ("schema_version", "lexical-v1"),
        ("feature_fingerprint", "wrong"),
        ("feature_names", list(reversed(FEATURE_NAMES))),
        ("model_version", "wrong"),
        ("artifact_sha256", "wrong"),
    ],
)
def test_incompatible_manifest_never_deserializes(
    field, value, trained, tmp_path, monkeypatch
):
    _, report, bundle = trained
    save_artifact(bundle, report, tmp_path)
    path = tmp_path / "model_metadata.json"
    manifest = json.loads(path.read_text())
    manifest[field] = value
    path.write_text(json.dumps(manifest))

    no_load = Mock(side_effect=AssertionError("Unverified artifact deserialized"))
    monkeypatch.setattr("ml.artifacts.joblib.load", no_load)
    assert load_artifact(tmp_path) == (None, None)
    no_load.assert_not_called()


def test_cli_dataset_option_and_legacy_path(trained, tmp_path):
    raw, _, _ = trained
    source = tmp_path / "test-only.csv"
    source.write_bytes(raw)
    for arguments, output in (
        (["--dataset", str(source)], tmp_path / "option"),
        ([str(source)], tmp_path / "legacy"),
    ):
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "ml.train_local",
                *arguments,
                "--n-estimators",
                "20",
                "--output",
                str(output),
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        assert load_artifact(output)[0] is not None
    # Invalid inputs must not leave a falsely successful artifact.
    source.write_text("url,label\n")
    output = tmp_path / "invalid"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "ml.train_local",
            "--dataset",
            str(source),
            "--output",
            str(output),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0 and not (output / "model.joblib").exists()


def test_average_precision_single_positive_class_is_defined_with_caveat():
    class Constant:
        classes_ = [0, 1]

        def predict(self, x):
            return np.ones(len(x), int)

        def predict_proba(self, x):
            return np.tile([0.3, 0.7], (len(x), 1))

    result = evaluate(Constant(), np.zeros((2, 1)), np.ones(2, int))
    assert result["pr_auc"] == 1.0 and result["roc_auc"] is None
    assert result["metric_notes"]["pr_auc"]
