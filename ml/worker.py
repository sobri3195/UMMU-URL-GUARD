"""Isolated bounded online experiment process; stdin is CSV, stdout is JSON."""

import json
import sys

from ml.model import run_experiment

if __name__ == "__main__":
    try:
        report, _ = run_experiment(
            sys.stdin.buffer.read(), sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
        )
        print(json.dumps({"report": report}, allow_nan=False))
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(2)
