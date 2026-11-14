"""Project-owned model artifacts only. Checksums detect mismatch, not producer trust.

The HTTP API never accepts a path or an uploaded pickle/joblib to deserialize.
"""

import hashlib
import json
import os
import sys
import tempfile
import warnings
from pathlib import Path

import joblib
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.exceptions import InconsistentVersionWarning

from ml.features import (
    FEATURE_NAMES,
    FEATURE_FINGERPRINT,
    FEATURE_PROVENANCE,
    SCHEMA_VERSION,
)


def file_digest(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_artifact(bundle, report, output, source=None, license_name=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".training-", dir=output) as temporary:
        path = Path(temporary) / "model.joblib"
        joblib.dump(bundle, path)
        if path.stat().st_size > 100_000_000:
            raise ValueError(
                "Model exceeds the 100 MB inference limit; reduce estimators or dataset size"
            )
        metadata = {
            "format_version": 2,
            "schema_version": SCHEMA_VERSION,
            "model_name": "Random Forest",
            "model_version": bundle["model_version"],
            "feature_names": list(FEATURE_NAMES),
            "feature_fingerprint": FEATURE_FINGERPRINT,
            "feature_provenance": FEATURE_PROVENANCE,
            "sklearn_version": sklearn.__version__,
            "runtime_versions": bundle["runtime_versions"],
            "artifact_sha256": file_digest(path),
            "dataset_sha256": report["dataset"]["sha256"],
            "dataset_provenance": {
                "source": source or "User provided; source unspecified",
                "license": license_name or "Not supplied; review before deployment",
            },
            "report": report,
        }
        meta = Path(temporary) / "model_metadata.json"
        meta.write_text(
            json.dumps(metadata, indent=2, allow_nan=False), encoding="utf-8"
        )
        # Publish metadata last. A temporarily mismatched pair fails closed.
        os.replace(path, output / "model.joblib")
        os.replace(meta, output / "model_metadata.json")
    return metadata


def load_artifact(directory):
    path, meta = (
        Path(directory) / "model.joblib",
        Path(directory) / "model_metadata.json",
    )
    try:
        if (
            not path.is_file()
            or not meta.is_file()
            or path.stat().st_size > 100_000_000
            or meta.stat().st_size > 32_000_000
        ):
            return None, None
        metadata = json.loads(meta.read_text(encoding="utf-8"))
        if (
            metadata["format_version"] != 2
            or metadata["schema_version"] != SCHEMA_VERSION
            or metadata["model_name"] != "Random Forest"
            or metadata["feature_names"] != list(FEATURE_NAMES)
            or metadata["feature_fingerprint"] != FEATURE_FINGERPRINT
            or metadata["feature_provenance"] != FEATURE_PROVENANCE
            or metadata["sklearn_version"] != sklearn.__version__
            or metadata["artifact_sha256"] != file_digest(path)
            or metadata["report"]["model_version"] != metadata["model_version"]
            or metadata["report"]["feature_fingerprint"] != FEATURE_FINGERPRINT
            or metadata["report"]["dataset"]["sha256"] != metadata["dataset_sha256"]
        ):
            return None, None
        # Only deployment-owned files reach this line; never deserialize uploads.
        with warnings.catch_warnings():
            warnings.simplefilter("error", InconsistentVersionWarning)
            bundle = joblib.load(path)
        estimator = bundle["estimator"]
        if (
            bundle["feature_names"] != list(FEATURE_NAMES)
            or bundle["schema_version"] != SCHEMA_VERSION
            or bundle["feature_fingerprint"] != FEATURE_FINGERPRINT
            or bundle["model_version"] != metadata["model_version"]
            or bundle["runtime_versions"] != metadata["runtime_versions"]
            or bundle["sklearn_version"] != sklearn.__version__
            or bundle["runtime_versions"]["python"].split(".")[:2]
            != list(map(str, sys.version_info[:2]))
            or not isinstance(estimator, Pipeline)
            or list(estimator.named_steps) != ["classifier"]
            or not isinstance(
                estimator.named_steps["classifier"], RandomForestClassifier
            )
            or estimator.n_features_in_ != len(FEATURE_NAMES)
            or list(estimator.classes_) != [0, 1]
        ):
            return None, None
        return bundle, metadata
    except Exception:
        # Corrupt/incompatible trusted files disable inference, not the entire API.
        return None, None
