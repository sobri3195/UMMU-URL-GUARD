"""Train only from a user-supplied labeled CSV. Never fetch or invent a dataset."""

import argparse
import hashlib
import json
from pathlib import Path

import joblib
import sklearn

from ml.model import run_experiment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, default=Path("models"))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-rows", type=int, default=100000)
    args = parser.parse_args()
    # Local path permits bigger inputs while retaining parser/validation semantics.
    import ml.dataset as dataset

    dataset.MAX_BYTES = 100_000_000
    report, bundle = run_experiment(
        args.dataset.read_bytes(), args.dataset.name, args.seed, max_rows=args.max_rows
    )
    args.output.mkdir(parents=True, exist_ok=True)
    path = args.output / "model.joblib"
    joblib.dump(bundle, path)
    metadata = {
        "schema_version": bundle["schema_version"],
        "model_version": bundle["model_version"],
        "sklearn_version": sklearn.__version__,
        "artifact_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "report": report,
    }
    (args.output / "model_metadata.json").write_text(
        json.dumps(metadata, indent=2, allow_nan=False)
    )
    print(
        f"Wrote trusted local artifact and actual evaluation to {args.output}. Review provenance before deploying."
    )


if __name__ == "__main__":
    main()
