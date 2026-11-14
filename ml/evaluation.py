import numpy as np
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    average_precision_score,
    confusion_matrix,
    roc_curve,
    precision_recall_curve,
)


def evaluate(estimator, x, y):
    pred = estimator.predict(x)
    positive = list(estimator.classes_).index(1)
    probability = estimator.predict_proba(x)[:, positive]
    both = len(np.unique(y)) == 2
    roc = roc_curve(y, probability) if both else ([], [], [])
    pr = precision_recall_curve(y, probability) if both else ([], [], [])
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y, probability)) if both else None,
        "pr_auc": float(average_precision_score(y, probability)) if both else None,
        "confusion_matrix": confusion_matrix(y, pred, labels=[0, 1]).tolist(),
        "roc": {"fpr": list(map(float, roc[0])), "tpr": list(map(float, roc[1]))},
        "pr": {"precision": list(map(float, pr[0])), "recall": list(map(float, pr[1]))},
        "predictions": pred.tolist(),
        "positive_class": "phishing",
        "pr_auc_definition": "average precision",
    }
