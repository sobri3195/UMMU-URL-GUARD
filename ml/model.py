"""Research fits are transient. Only the separate local command produces deployable artifacts."""

import hashlib
import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from ml.dataset import analyze_csv
from ml.evaluation import evaluate
from ml.features import (
    BASIC,
    FEATURE_NAMES,
    SCHEMA_VERSION,
    REFERENCES,
    KEYWORDS,
    SHORTENERS,
    extract_features,
)

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
TRAIN_LOCK = threading.Lock()


def split_groups(y, groups, seed):
    if len(set(groups)) < 20 or min(np.bincount(y, minlength=2)) < 3:
        raise ValueError(
            "Training requires at least 20 registered domains and 3 examples of each class"
        )
    indices = np.arange(len(y))
    for attempt in range(30):
        actual_seed = seed + attempt
        train, rest = next(
            GroupShuffleSplit(
                n_splits=1, train_size=0.7, random_state=actual_seed
            ).split(indices, y, groups)
        )
        val_local, test_local = next(
            GroupShuffleSplit(
                n_splits=1, train_size=0.5, random_state=actual_seed
            ).split(rest, y[rest], np.asarray(groups)[rest])
        )
        val, test = rest[val_local], rest[test_local]
        if all(len(np.unique(y[part])) == 2 for part in (train, val, test)):
            return train, val, test, actual_seed
    raise ValueError(
        "Cannot form domain-disjoint splits containing both classes; supply more diverse domains"
    )


def run_experiment(raw, name, seed=42, estimators=100, max_rows=2000):
    frame, summary, groups = analyze_csv(raw, name, max_rows=max_rows)
    y = (frame.label == "phishing").to_numpy(dtype=int)
    train, val, test, actual_seed = split_groups(y, groups, seed)
    features = [extract_features(url)["features"] for url in frame.url]
    timestamp = datetime.now(timezone.utc).isoformat()
    experiment_id = str(uuid.uuid4())
    reports = []
    selected_artifact = None
    for scenario, names in (("basic", BASIC), ("extended", FEATURE_NAMES)):
        x = np.array([[f[key] for key in names] for f in features], dtype=float)
        models = {
            "Random Forest": RandomForestClassifier(
                n_estimators=estimators,
                max_depth=16,
                min_samples_split=2,
                min_samples_leaf=1,
                class_weight="balanced",
                random_state=seed,
                n_jobs=1,
            ),
            "Logistic Regression": make_pipeline(
                StandardScaler(),
                LogisticRegression(
                    class_weight="balanced", max_iter=2000, random_state=seed
                ),
            ),
            "Decision Tree": DecisionTreeClassifier(
                max_depth=16, class_weight="balanced", random_state=seed
            ),
        }
        fitted = []
        for model_name, estimator in models.items():
            estimator.fit(x[train], y[train])
            validation = evaluate(estimator, x[val], y[val])
            fitted.append((model_name, estimator, validation))
        selected = max(fitted, key=lambda item: item[2]["f1"])[0]
        # No hyperparameter search here. All three predeclared candidates use the
        # exact same untouched test partition, once, after validation selection.
        for model_name, estimator, validation in fitted:
            metrics = evaluate(estimator, x[test], y[test])
            errors = []
            for idx, pred in zip(test, metrics.pop("predictions")):
                if pred != y[idx]:
                    from urllib.parse import urlsplit, urlunsplit

                    p = urlsplit(frame.url.iloc[idx])
                    # Redact paths as well as query/fragment: tokens may be in either.
                    masked = urlunsplit((p.scheme, p.netloc, "/[redacted]", "", ""))
                    errors.append(
                        {
                            "url": masked,
                            "actual": "phishing" if y[idx] else "benign",
                            "predicted": "phishing" if pred else "benign",
                        }
                    )
            validation.pop("predictions")
            importance = (
                dict(zip(names, map(float, estimator.feature_importances_)))
                if hasattr(estimator, "feature_importances_")
                else None
            )
            reports.append(
                {
                    "model_name": model_name,
                    "feature_set": scenario,
                    "selected_on_validation": model_name == selected,
                    "validation": validation,
                    "test": metrics,
                    "errors": errors[:100],
                    "error_count": len(errors),
                    "feature_importance": importance,
                }
            )
            if model_name == "Random Forest" and scenario == "extended":
                selected_artifact = {
                    "estimator": estimator,
                    "feature_names": list(names),
                    "schema_version": SCHEMA_VERSION,
                    "model_version": experiment_id,
                    "sklearn_version": sklearn.__version__,
                }
    split = {
        key: {
            "rows": len(part),
            "groups": len(set(groups.iloc[part])),
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
    report = {
        "experiment_id": experiment_id,
        "model_version": experiment_id,
        "dataset": {k: v for k, v in summary.items() if k != "preview"},
        "evaluated_at": timestamp,
        "seed": seed,
        "split_seed": actual_seed,
        "schema_version": SCHEMA_VERSION,
        "split": split,
        "split_membership_sha256": hashlib.sha256(
            json.dumps(membership, sort_keys=True).encode()
        ).hexdigest(),
        "split_policy": "70/15/15 by registered-domain groups; actual row fractions may differ. Seed retries require both classes only.",
        "selection_policy": "Validation F1; all fixed candidates tested once on identical held-out groups. Repeated experiments do not create fresh evidence.",
        "references": list(REFERENCES),
        "keywords": list(KEYWORDS),
        "shorteners": sorted(SHORTENERS),
        "config": {
            "n_estimators": estimators,
            "max_depth": 16,
            "min_samples_split": 2,
            "min_samples_leaf": 1,
            "class_weight": "balanced",
            "random_state": seed,
        },
        "reports": reports,
    }
    return report, selected_artifact


def load_production():
    artifact_path = MODEL_DIR / "model.joblib"
    metadata_path = MODEL_DIR / "model_metadata.json"
    if not artifact_path.exists() or not metadata_path.exists():
        return None, None
    try:
        metadata = json.loads(metadata_path.read_text())
        if (
            metadata["artifact_sha256"]
            != hashlib.sha256(artifact_path.read_bytes()).hexdigest()
            or metadata["schema_version"] != SCHEMA_VERSION
            or metadata["sklearn_version"] != sklearn.__version__
        ):
            return None, None
        # Only fixed, deployment-owned paths, never any caller-selected artifact.
        bundle = joblib.load(artifact_path)
        if (
            bundle["feature_names"] != list(FEATURE_NAMES)
            or bundle["schema_version"] != SCHEMA_VERSION
        ):
            return None, None
        return bundle, metadata
    except (OSError, ValueError, KeyError, EOFError, ImportError):
        return None, None


def predict(extracted, bundle):
    if bundle is None:
        return {
            "prediction": None,
            "probability": None,
            "model_version": None,
            "message": "Prediction unavailable — model not trained",
        }
    values = [[extracted["features"][key] for key in bundle["feature_names"]]]
    estimator = bundle["estimator"]
    positive = list(estimator.classes_).index(1)
    return {
        "prediction": "phishing" if estimator.predict(values)[0] == 1 else "benign",
        "probability": float(estimator.predict_proba(values)[0, positive]),
        "probability_label": "Uncalibrated model estimate of phishing probability",
        "model_version": bundle["model_version"],
    }
