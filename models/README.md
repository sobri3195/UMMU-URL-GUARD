No pretrained model or dataset is supplied. Train from a provenance-reviewed labeled CSV:

```bash
python -m ml.train_local --dataset data/dataset.csv --source "dataset citation" --license "license name"
```

Review actual validation/holdout results and provenance, then explicitly commit `model.joblib` and `model_metadata.json` with `git add -f`. The format-v2 manifest binds the actual Random Forest Pipeline to the ordered `lexical-v2` features, PSL/definition fingerprint, dataset hash, model version, package versions, and artifact SHA-256. Older artifacts must be retrained. Joblib is pickle-based: its checksum detects mismatch, not an untrusted producer. Never upload or deserialize someone else's artifact on a public server. Test fixtures are not production training data. Online experiments never write this directory.
