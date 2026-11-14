"""Actual holdout metrics; undefined values are JSON null with explicit reasons."""

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    roc_auc_score,
    average_precision_score,
    confusion_matrix,
    roc_curve,
    precision_recall_curve,
)

METRICS = ("accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc")


def evaluate(estimator, x, y):
    y = np.asarray(y, dtype=int)
    if not len(y):
        return {
            **dict.fromkeys(METRICS),
            "metric_reasons": dict.fromkeys(METRICS, "Evaluation partition is empty"),
            "confusion_matrix": [[0, 0], [0, 0]],
            "roc": None,
            "pr": None,
            "predictions": [],
            "positive_class": "phishing",
            "pr_auc_definition": "average precision",
        }
    pred = estimator.predict(x)
    probability = estimator.predict_proba(x)[:, list(estimator.classes_).index(1)]
    matrix = confusion_matrix(y, pred, labels=[0, 1])
    tn, fp, fn, tp = map(int, matrix.ravel())
    denominators = {"precision": tp + fp, "recall": tp + fn, "f1": 2 * tp + fp + fn}
    reasons = {
        key: reason
        for key, reason in (
            ("precision", "No predicted phishing samples"),
            ("recall", "No actual phishing samples"),
            ("f1", "No actual or predicted phishing samples"),
        )
        if not denominators[key]
    }
    both = len(np.unique(y)) == 2
    has_positive = bool(np.any(y == 1))
    if not both:
        reasons.update(
            {key: "Requires both phishing and benign samples" for key in ("roc_auc",)}
        )
    if not has_positive:
        reasons["pr_auc"] = "No actual phishing samples"
    notes = (
        {
            "pr_auc": "Only phishing samples present; AP is defined but does not measure discrimination against benign URLs"
        }
        if has_positive and not both
        else {}
    )
    roc = roc_curve(y, probability) if both else None
    pr = precision_recall_curve(y, probability) if has_positive else None
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
        "f1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None,
        "roc_auc": float(roc_auc_score(y, probability)) if both else None,
        "pr_auc": (
            float(average_precision_score(y, probability)) if has_positive else None
        ),
        "metric_reasons": reasons,
        "metric_notes": notes,
        "confusion_matrix": matrix.tolist(),
        "roc": (
            {"fpr": list(map(float, roc[0])), "tpr": list(map(float, roc[1]))}
            if roc
            else None
        ),
        "pr": (
            {"precision": list(map(float, pr[0])), "recall": list(map(float, pr[1]))}
            if pr
            else None
        ),
        "predictions": pred.tolist(),
        "positive_class": "phishing",
        "pr_auc_definition": "average precision",
    }
