# UMMU URL GUARD

**Phishing URL Detection & Typosquatting Analysis** — a student-oriented research workspace built with Vite, vanilla JavaScript, FastAPI, and scikit-learn. No database, fabricated metrics, or bundled training dataset. All nine navigation sections work with actual API responses and browser history.

## Run locally

Use Python **3.12** and Node **22+**. In the repository root:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
npm install
python -m uvicorn api.index:app --host 127.0.0.1 --port 8000 --no-access-log
```

In a second terminal **in the same repository root**, run `npm run dev`. Vite uses port **5173** and forwards only the `/api` namespace to FastAPI on port **8000**. A busy frontend port causes an explicit error instead of silently moving to another port. The backend is Python; Node runs Vite/build tools only.

For the development proxy, copy `.env.example` to `.env` and adjust the server-only `API_PROXY_TARGET` if the Python port differs. Vite reads this file on startup; restart Vite after changes. Browser requests always use same-origin `/api`, so no `VITE_API_URL` or browser secret is needed. Example for a different port:

```bash
# Backend terminal (with the virtual environment active):
python -m uvicorn api.index:app --host 127.0.0.1 --port 8001 --no-access-log
# Frontend terminal:
API_PROXY_TARGET=http://127.0.0.1:8001 npm run dev
```

Same-origin proxy and Vercel deployment need no CORS configuration. For a separate frontend origin, export `ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173` **before starting Python**. Only explicit HTTP(S) origins are accepted; wildcards, credentials, and URL paths fail startup with a configuration error. CORS also applies to upload/rate-limit errors. Python reads exported process variables; it does **not** load Vite's `.env` automatically. Set deployed values in Vercel project environment settings.

The dashboard and page header show backend connection separately from production-model availability. A real, schema-validated `/api/health` response is required before showing **Backend connected**. Health is checked at startup, every 15 seconds while visible, on returning to the tab, when browser connectivity returns, or using **Check connection**. Health requests time out after four seconds and bypass caching. Failed/HTML/malformed responses show **Python API unavailable** and **Model status unknown**, plus the actual error; a missing model alone does not mean the backend is offline.

Manual API checks from a third terminal:

```bash
curl --fail-with-body http://127.0.0.1:8000/api/health
curl --fail-with-body -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/login?q=123"}' http://127.0.0.1:8000/api/features
# Repeat through Vite, proving its proxy reaches Python:
curl --fail-with-body http://127.0.0.1:5173/api/health
```

Health returns backend status, `backend: "fastapi"`, `app_version: "1.0.1"`, `model_status`, `model_available`, and the actual model version/report when present. No trained artifact means `model_status: "unavailable"`; lexical extraction still returns actual computed values. To verify failure handling manually, stop only the FastAPI process and keep Vite open: within one polling cycle the connection must fail, and submitting Feature Extraction must show an error. Restart FastAPI and press **Check connection** to recover.

Run `python -m pytest -q`, `npm test`, `pip check`, `npm audit`, and `npm run build`. Tests use controlled synthetic fixtures to test mechanics; their scores are **not research evidence** and are never shipped as application data.

Optional browser integration check, with both services running:

```bash
# Install Playwright Chromium, or use an existing system Chromium below.
npx playwright install chromium
npm run test:browser
# Cloud runtime alternative: CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

This checks all nine pages, actual API feature/CSV/training flows, masked history/deletion, desktop/mobile overflow, and uncaught page errors. Screenshots go into ignored `artifacts/`. The isolated browser context is cleared and closed afterward. Run `npm run format:check` for frontend/Markdown formatting.

### Foundation integration test

```bash
# With the virtual environment active and Playwright Chromium installed:
npm run test:foundation
# Cloud runtime with retained Python/system Chromium:
PYTHON=/workspace/ummu-venv/bin/python CHROMIUM_PATH=/usr/bin/chromium npm run test:foundation
```

This test owns dedicated ports **18001** (FastAPI) and **5174** (Vite) and refuses to reuse occupied ports. It starts real services, exercises browser health/features and CORS, stops its backend to check scheduled outage detection and cold-load failure, verifies the feature error, restarts Python, and checks recovery. It stops its own services afterward. `npm test` also compiles `vercel.json` with Vercel's routing utility: `/api`, `/api/`, and nested/unknown API paths cannot match the SPA rewrite. Local unknown API paths return JSON 404; frontend routes return HTML. This checks configuration locally, not a hosted Vercel deployment. The development-only Vercel compiler uses an npm override to patched `path-to-regexp` 6.3.0; its upstream 6.1.0 dependency is vulnerable.

## Research workflow

1. Upload a UTF-8 CSV with exactly `url,label` columns. Labels are `phishing` / `benign`, case-insensitive. Use a licensed dataset with documented provenance, dates, and labeling methodology. No third-party dataset is automatically downloaded.
2. Validate the dataset. Normalized duplicate URLs are removed. Missing/invalid rows and conflicting labels are rejected. The API returns counts, SHA-256, class distribution, and an eight-row preview.
3. Train on at most 2 MB / 2,000 rows online. At least 20 distinct registered domains and three records per class are required, with both classes in each partition. Larger datasets use the local command below.
4. Inspect all six predeclared model/scenario combinations, confusion matrix, ROC/PR curves, feature importance, and masked false positives/negatives. Export JSON, CSV, or the readable research summary.
5. Scan URLs for real lexical indicators. Predictions are explicitly unavailable until a trusted production model is deployed. Online experiments **never** activate a model in the scanner.

### Train a production Random Forest

```bash
python -m ml.train_local /path/to/labeled.csv --output models --seed 42
# Review provenance, metrics, package versions and model checksum first.
git add -f models/model.joblib models/model_metadata.json
```

The local command uses the same feature and split definitions, with configurable `--max-rows` (100,000 default) and a 100 MB input limit. It writes the **extended-feature Random Forest**, even if a baseline has better validation F1. The artifact is fitted on the training partition only; it is not silently refitted on validation/test data. Use `--output /outside/the/repo` for experimental artifacts that should not ship.

Joblib is pickle-based and can execute code. Never upload or load artifacts from an untrusted source. Inference loads only fixed, deployment-owned `models/model.joblib` and its metadata; artifact SHA-256, feature schema/order, and scikit-learn version are checked. A checksum verifies file consistency, not producer trust. Both trusted files must be included in the deployment. A missing/incompatible pair disables prediction.

### Experiment design

- `lexical-v1`: 20 fixed features in `ml/features.py`; numeric definitions are exposed by `/api/features`.
- Seven basic lexical features versus all 20 extended features.
- Fixed shortener, keyword, and six-domain reference lists are versioned in source and recorded in each report. Punycode is normalized; ASCII edit similarity is an indicator, **not** full Unicode confusable detection.
- Public Suffix List extraction uses the packaged snapshot (including private suffixes), with no runtime PSL downloads. Document reference-list overlap with datasets and keep lists fixed before comparison. Changing any definition/list requires retraining and a new schema version.
- `GroupShuffleSplit` targets 70/15/15 **by registered-domain groups**. Actual row proportions are reported and may differ. Domain variants, paths, and subdomains within a registered domain cannot cross partitions. Cross-domain ownership/family relationships are not inferred; curate group definitions separately if your research requires them.
- Seed retries (at most 30) only ensure both classes occur in every split; the actual split seed and partition membership hash are recorded. No metric guides splitting.
- Logistic Regression uses a `StandardScaler` pipeline fitted exclusively on training data. All models use fixed configurations, and validation F1 selects the preferred model in each scenario. Predeclared candidates are evaluated once on the same held-out test groups. Repeatedly inspecting the same test scores is not new independent evidence.
- Positive class is phishing. PR-AUC means **average precision**. Unsupported metrics return N/A. Scores from `predict_proba` are labeled uncalibrated estimates.
- Research results include experiment/model ID, dataset name/hash, seed/configuration, split sizes/class counts/hash, feature lists and evaluation time. Impurity importance can favor high-cardinality features. Neither additional features nor high scores establish generalization to unseen threats.

## Scanner security and limits

`ml/scanner.py` performs HEAD only, with no GET/body fallback, browser navigation, page execution, cookies, authorization headers, or automatic proxy use.

- HTTP/HTTPS only, credential-free, maximum 4,096-character URL. Online ports must be 80 for HTTP or 443 for HTTPS.
- Reject internal names, non-public literal IPs, and **every DNS response containing any non-public address**, including mixed public/private responses. IPv4-mapped IPv6, multicast, reserved, loopback, private, and link-local addresses are blocked.
- Pin the TCP connection to a validated numeric IP. TLS certificate verification and SNI use the original hostname. Verify the connected peer. Revalidate DNS/address/port at every redirect.
- Maximum five redirects, five seconds per hop, 15 seconds total, 16 KB response headers. Close immediately after headers; unsupported HEAD is reported as unavailable.
- If DNS, direct egress, TLS, or address pinning cannot be established, online metadata is **unavailable**. Lexical extraction and deployed-model inference continue. Proxy-only environments may therefore support lexical research but not live scanning; do not remove pinning to make such a network pass.
- API uploads are capped before multipart parsing, with a ten-second upload deadline. Experiments run in an isolated subprocess with one numeric-library thread and a 40-second deadline; timeout terminates the process and recommends local training.
- Per-instance in-memory limit: 30 requests/minute/client, at most three experiment requests/minute and one active experiment per instance. Caller forwarding headers are not trusted. Configure **Vercel Firewall** limits before exposing expensive training endpoints publicly: in-process counters are not distributed across serverless instances and proxy client identities may be shared.
- Uvicorn instructions disable access logging. Do not enable request-body logging or retain URL-bearing application errors. Hosting/provider logs have their own retention policy.

Prediction uses the **original normalized URL**, not online metadata or the resolved destination; final-destination features are returned separately. Short URLs and similar-looking domains can be legitimate. A benign prediction never guarantees safety.

## Privacy and exports

History is stored under `ummu_url_guard_history` in localStorage, at most 200 records. Paths, queries, and fragments are removed **before saving**, including tokens embedded in paths. The current on-screen scan/CSV preview necessarily shows submitted values; do not share screenshots containing sensitive URLs. Scheme/hostname remain in masked exports and may still be identifying.

`ummu_url_guard_settings` stores the online-check preference. `ummu_url_guard_experiment_summaries` stores only the latest aggregate experiment, without uploaded datasets, error URLs, or curve points. Full current results stay in session memory and can be exported. localStorage is specific to the browser/device and can be unavailable or cleared. There is no synchronization or server-side dataset persistence. CSV exports neutralize spreadsheet formula prefixes. Untrusted URLs are displayed as text, never clickable target links or embedded frames.

## API

See local FastAPI `/docs` for generated schemas (on the Python port). JSON URL bodies are `{ "url": "https://example.com/" }`.

| Method | Endpoint               | Behavior                                                               |
| ------ | ---------------------- | ---------------------------------------------------------------------- |
| GET    | `/api/health`          | Backend status, application version, and production-model availability |
| POST   | `/api/predict`         | Lexical features and production prediction, if available               |
| POST   | `/api/scan`            | Prediction plus separate bounded online metadata                       |
| POST   | `/api/features`        | Python-computed values and feature definitions                         |
| POST   | `/api/dataset/analyze` | CSV validation/summary; multipart `file`                               |
| POST   | `/api/train`           | Actual six-model experiment; multipart `file`                          |
| POST   | `/api/evaluate`        | Stateless rerun/evaluation from the same CSV/config; multipart `file`  |
| POST   | `/api/experiment`      | Same controlled basic/extended experiment; multipart `file`            |

Training endpoints accept `seed=42&n_estimators=100` query options. There is no server-side experiment database: the UI evaluates and compares the actual report returned by training rather than resubmitting fabricated metrics. Re-running any experiment is explicitly a new fit, not an independent test dataset.

## Deploy to Vercel

1. Run tests and `npm run build` locally; commit and push the source and lockfile to GitHub.
2. If production prediction is needed, train from your validated dataset and explicitly commit both trusted artifacts before deployment.
3. Import the GitHub repository in Vercel. Use the Vite preset, `npm run build`, and `dist` output. Python 3.12 is pinned in `.python-version`; verify availability with your current Vercel runtime/plan.
4. `api/index.py` exposes the FastAPI `app`. `vercel.json` routes `/api/*` to Python before the SPA fallback and includes `ml/` / `models/` in the function. Python dependencies come from `requirements.txt`. The function excludes `.vercel_python_packages/`, the separate dependency directory created during the frontend build, so Python packages are not bundled twice. Keep this exclusion when editing the function configuration: duplicate scientific libraries can trigger `LAMBDA_SIZE_EXCEEDED` even after Vercel's dependency optimization. HTTPS and security headers are configured. Frontend navigation uses hash routes, so API endpoints are never taken over by page navigation.
5. Same-origin deployment needs no CORS variable. If required, set explicit `ALLOWED_ORIGINS` values; never put secrets in client-side Vite variables.
6. Configure firewall rate limits, verify function bundle/runtime limits and cold-start behavior, then deploy. Online training is intentionally small and may still need the local workflow on constrained plans.
7. Check deployed `/api/health`, `/api/features`, private-target rejection in `/api/scan`, then a controlled public HEAD target. Verify a prediction only if the trusted artifact is present. Upload your CSV and inspect actual results. Confirm no browser console errors and check mobile navigation.

**Deployment status:** Vercel configuration and the production frontend build are prepared; a hosted Vercel deployment has not been executed or verified in this task. No Vercel credentials were requested or fabricated. Real public network metadata may be unavailable in a restricted cloud environment and must be tested again on the deployment.

## Structure

- `src/pages/`: all nine functional views; `src/utils/`: API, charts, privacy-aware storage/exports.
- `api/index.py`: FastAPI routes, request bounds, process-isolated training, rate limits.
- `ml/`: URL/features, dataset validation, pinned scanner, training/evaluation and local CLI.
- `models/`: trusted deployment artifacts only; none supplied by default.
- `tests/`: backend/security/research and browser-storage unit tests. Synthetic test fixtures are not production data.
