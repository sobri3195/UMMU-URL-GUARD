"""Train from your labeled CSV; never fetch data or silently activate online fits."""

import argparse
from pathlib import Path

from ml.artifacts import save_artifact
from ml.model import run_experiment

LOCAL_MAX_BYTES = 100_000_000


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "dataset", type=Path, nargs="?", help="Legacy positional CSV path"
    )
    parser.add_argument(
        "--dataset",
        dest="dataset_option",
        type=Path,
        help="Labeled UTF-8 CSV with url,label",
    )
    parser.add_argument("--output", type=Path, default=Path("models"))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--n-estimators", type=int, default=100)
    parser.add_argument("--max-rows", type=int, default=100000)
    parser.add_argument("--source", help="Dataset citation/source (non-secret)")
    parser.add_argument(
        "--license", dest="license_name", help="Dataset license, if known"
    )
    args = parser.parse_args()
    if bool(args.dataset) == bool(args.dataset_option):
        parser.error(
            "Supply exactly one CSV path using --dataset or the positional argument"
        )
    if args.max_rows < 1:
        parser.error("--max-rows must be positive")
    dataset = args.dataset_option or args.dataset
    try:
        with dataset.open("rb") as stream:
            raw = stream.read(LOCAL_MAX_BYTES + 1)
        report, bundle = run_experiment(
            raw,
            dataset.name,
            args.seed,
            args.n_estimators,
            max_rows=args.max_rows,
            max_bytes=LOCAL_MAX_BYTES,
        )
        save_artifact(bundle, report, args.output, args.source, args.license_name)
    except (ValueError, OSError) as exc:
        parser.exit(2, f"Training failed: {exc}\n")
    print(
        f"Wrote actual validation-selected Random Forest, dataset/feature/PSL metadata, and holdout results to {args.output}. Review provenance before deployment."
    )


if __name__ == "__main__":
    main()
