"""Real group-separated research fits; online runs never activate production models."""

import hashlib
import json
import platform
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import joblib
import numpy as np
import pandas as pd
import scipy
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ml.dataset import MAX_BYTES, MAX_ROWS, analyze_csv
from ml.evaluation import evaluate
from ml.features import (
    BASIC,
    FEATURE_NAMES,
    SCHEMA_VERSION,
    REFERENCES,
    KEYWORDS,
    SHORTENERS,
    FEATURE_PROVENANCE,
    FEATURE_FINGERPRINT,
    extract_features,
)

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
TRAIN_LOCK = threading.Lock()
RF_DEPTHS = (8, 16)


def runtime_versions():
    return {
        "python": platform.python_version(),
        "scikit_learn": sklearn.__version__,
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scipy": scipy.__version__,
        "joblib": joblib.__version__,
    }


def _split_plan(y, groups, seed):
    y, groups = np.asarray(y, dtype=int), np.asarray(groups)
    unique = np.unique(groups)
    if len(unique) < 20 or any(len(set(groups[y == label])) < 3 for label in (0, 1)):
        raise ValueError(
            "Training requires 20 registered domains, with each class present in at least 3 domain groups"
        )
    # Stratify group IDs, not individual URLs. Mixed-label groups stay intact.
    counts = (
        pd.DataFrame({"group": groups, "label": y})
        .groupby("group")
        .label.agg(["min", "max"])
    )
    strata = {
        group: "mixed" if row["min"] != row["max"] else str(int(row["min"]))
        for group, row in counts.iterrows()
    }
    try:
        training, rest = train_test_split(
            unique,
            train_size=0.7,
            random_state=seed,
            stratify=[strata[g] for g in unique],
        )
        validation, testing = train_test_split(
            rest, train_size=0.5, random_state=seed, stratify=[strata[g] for g in rest]
        )
        parts = tuple(
            np.flatnonzero(np.isin(groups, values))
            for values in (training, validation, testing)
        )
        if not all(len(np.unique(y[part])) == 2 for part in parts):
            raise ValueError("Both classes not represented")
        return (
            *parts,
            seed,
            {"method": "stratified_group_shuffle", "fallback_reason": None},
        )
    except ValueError:
        # Tiny/rare strata may not be stratifiable. Class-presence checks only,
        # never scores, guide deterministic fallback retries.
        indices = np.arange(len(y))
        for attempt in range(30):
            split_seed = seed + attempt
            train, rest = next(
                GroupShuffleSplit(
                    n_splits=1, train_size=0.7, random_state=split_seed
                ).split(indices, y, groups)
            )
            val_local, test_local = next(
                GroupShuffleSplit(
                    n_splits=1, train_size=0.5, random_state=split_seed
                ).split(rest, y[rest], groups[rest])
            )
            val, test = rest[val_local], rest[test_local]
            if all(len(np.unique(y[part])) == 2 for part in (train, val, test)):
                return (
                    train,
                    val,
                    test,
                    split_seed,
                    {
                        "method": "group_shuffle",
                        "fallback_reason": "Group label strata cannot support stratification in both split stages",
                    },
                )
    raise ValueError(
        "Cannot form domain-disjoint partitions with both classes; provide more diverse domains"
    )


def split_groups(y, groups, seed):
    return _split_plan(y, groups, seed)[:4]


def _pipeline(model_name, seed, estimators, depth=16):
    if model_name == "Random Forest":
        classifier = RandomForestClassifier(
            n_estimators=estimators,
            max_depth=depth,
            min_samples_split=2,
            min_samples_leaf=1,
            class_weight="balanced",
            random_state=seed,
            n_jobs=1,
        )
    elif model_name == "Decision Tree":
        classifier = DecisionTreeClassifier(
            max_depth=16, class_weight="balanced", random_state=seed
        )
    else:
        return Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "classifier",
                    LogisticRegression(
                        class_weight="balanced", max_iter=2000, random_state=seed
                    ),
                ),
            ]
        )
    return Pipeline([("classifier", classifier)])


def _configuration(pipeline):
    keys = (
        "n_estimators",
        "max_depth",
        "min_samples_split",
        "min_samples_leaf",
        "class_weight",
        "random_state",
        "max_iter",
        "solver",
    )
    return {
        key: value
        for key, value in pipeline.named_steps["classifier"].get_params().items()
        if key in keys
    }


def _errors(frame, indices, actual, predictions):
    buckets = {"false_positive": [], "false_negative": []}
    for idx, label, pred in zip(indices, actual, predictions):
        if label == pred:
            continue
        kind = "false_positive" if pred == 1 else "false_negative"
        if len(buckets[kind]) < 50:
            p = urlsplit(frame.url.iloc[idx])
            buckets[kind].append(
                {
                    "url": urlunsplit((p.scheme, p.netloc, "/[redacted]", "", "")),
                    "actual": "phishing" if label else "benign",
                    "predicted": "phishing" if pred else "benign",
                    "kind": kind,
                    "row_index": int(idx),
                }
            )
    return buckets["false_positive"] + buckets["false_negative"]


def run_experiment(
    raw, name, seed=42, estimators=100, max_rows=MAX_ROWS, max_bytes=MAX_BYTES
):
    if not 0 <= seed <= 2147483617 or not 20 <= estimators <= 1000:
        raise ValueError(
            "seed must be 0–2147483617 and n_estimators must be 20–1000 (online limit 150)"
        )
    started = time.monotonic()
    frame, summary, groups = analyze_csv(
        raw, name, max_rows=max_rows, max_bytes=max_bytes
    )
    y = (frame.label == "phishing").to_numpy(dtype=int)
    train, val, test, split_seed, split_details = _split_plan(y, groups, seed)
    # Split before any fitting. Feature extraction is deterministic and unfitted.
    features = [extract_features(url)["features"] for url in frame.url]
    version = str(uuid.uuid4())
    reports, production = [], None
    plans = []
    for scenario, names in (("basic", BASIC), ("extended", FEATURE_NAMES)):
        x = np.asarray([[row[key] for key in names] for row in features], dtype=float)
        fitted = []
        for model_name in ("Random Forest", "Logistic Regression", "Decision Tree"):
            candidates = []
            for depth in RF_DEPTHS if model_name == "Random Forest" else (16,):
                estimator = _pipeline(model_name, seed, estimators, depth)
                estimator.fit(x[train], y[train])
                validation = evaluate(estimator, x[val], y[val])
                validation.pop("predictions")
                candidates.append((estimator, validation))
            estimator, validation = max(
                candidates,
                key=lambda item: item[1]["f1"] if item[1]["f1"] is not None else -1,
            )
            fitted.append(
                (
                    model_name,
                    estimator,
                    validation,
                    [
                        {
                            "config": _configuration(model),
                            "validation_f1": metrics["f1"],
                        }
                        for model, metrics in candidates
                    ],
                )
            )
        selected = max(
            fitted, key=lambda item: item[2]["f1"] if item[2]["f1"] is not None else -1
        )[0]
        plans.append((scenario, names, x, fitted, selected))
    # Finish both scenarios' tuning before touching either holdout matrix.
    for scenario, names, x, fitted, selected in plans:
        for model_name, estimator, validation, candidates in fitted:
            metrics = evaluate(estimator, x[test], y[test])
            predictions = metrics.pop("predictions")
            classifier = estimator.named_steps["classifier"]
            importance = (
                dict(zip(names, map(float, classifier.feature_importances_)))
                if hasattr(classifier, "feature_importances_")
                else None
            )
            matrix = metrics["confusion_matrix"]
            is_production = model_name == "Random Forest" and scenario == "extended"
            reports.append(
                {
                    "model_name": model_name,
                    "feature_set": scenario,
                    "selected_on_validation": model_name == selected,
                    "selected_for_production": is_production,
                    "config": _configuration(estimator),
                    "validation_candidates": candidates,
                    "validation": validation,
                    "test": metrics,
                    "errors": _errors(frame, test, y[test], predictions),
                    "error_count": matrix[0][1] + matrix[1][0],
                    "false_positive_count": matrix[0][1],
                    "false_negative_count": matrix[1][0],
                    "feature_importance": importance,
                }
            )
            if is_production:
                production = {
                    "estimator": estimator,
                    "feature_names": list(names),
                    "schema_version": SCHEMA_VERSION,
                    "feature_fingerprint": FEATURE_FINGERPRINT,
                    "model_name": model_name,
                    "model_version": version,
                    "sklearn_version": sklearn.__version__,
                    "runtime_versions": runtime_versions(),
                }
    split = {
        key: {
            "rows": len(part),
            "groups": len(set(groups.iloc[part])),
            "row_fraction": len(part) / len(frame),
            "classes": {
                "benign": int(sum(y[part] == 0)),
                "phishing": int(sum(y[part] == 1)),
            },
        }
        for key, part in (("train", train), ("validation", val), ("test", test))
    }
    membership = {
        key: sorted(set(groups.iloc[part]))
        for key, part in (("train", train), ("validation", val), ("test", test))
    }
    primary = next(row for row in reports if row["selected_for_production"])
    report = {
        "experiment_id": version,
        "model_version": version,
        "dataset": {k: v for k, v in summary.items() if k != "preview"},
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": round((time.monotonic() - started) * 1000),
        "seed": seed,
        "split_seed": split_seed,
        "schema_version": SCHEMA_VERSION,
        "feature_fingerprint": FEATURE_FINGERPRINT,
        "feature_provenance": FEATURE_PROVENANCE,
        "runtime_versions": runtime_versions(),
        "split": split,
        "split_details": split_details,
        "split_membership_sha256": hashlib.sha256(
            json.dumps(membership, sort_keys=True).encode()
        ).hexdigest(),
        "split_policy": "70/15/15 by registered-domain groups, stratified when compatible; actual row fractions are reported. Fallback retries check class presence only.",
        "selection_policy": "RF max_depth 8/16 selected on validation F1; fixed LR/DT baselines. Each selected family tested once on identical untouched groups. Repeated runs are not independent evidence.",
        "production_model": {
            "model_name": "Random Forest",
            "feature_set": "extended",
            "config": primary["config"],
            "selection_partition": "validation",
        },
        "references": list(REFERENCES),
        "keywords": list(KEYWORDS),
        "shorteners": sorted(SHORTENERS),
        "config": primary["config"],
        "reports": reports,
    }
    return report, production


def load_production():
    # No caller-controlled path or uploaded joblib is ever accepted by the API.
    from ml.artifacts import load_artifact

    return load_artifact(MODEL_DIR)


def predict(extracted, bundle):
    timestamp = datetime.now(timezone.utc).isoformat()
    if bundle is None:
        return {
            "prediction": None,
            "probability": None,
            "model_version": None,
            "model_status": "unavailable",
            "prediction_timestamp": timestamp,
            "message": "Prediction unavailable — model not trained",
        }
    values = np.asarray(
        [[extracted["features"][name] for name in bundle["feature_names"]]], dtype=float
    )
    estimator = bundle["estimator"]
    probability = estimator.predict_proba(values)[0, list(estimator.classes_).index(1)]
    return {
        "prediction": "phishing" if estimator.predict(values)[0] == 1 else "benign",
        "probability": float(probability),
        "probability_label": "Uncalibrated model estimate of phishing probability",
        "probability_calibration": "none",
        "model_version": bundle["model_version"],
        "model_status": "available",
        "prediction_timestamp": timestamp,
    }
