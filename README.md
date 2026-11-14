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

By default this checks all nine pages, actual API features, masked history/deletion, desktop/mobile overflow, and uncaught page errors. Dataset upload/training/evaluation/importance UI checks run only when an explicit real CSV is supplied: `ML_TEST_DATASET=/path/to/validated-small.csv npm run test:browser`. Without that input, the runner explicitly reports the ML browser workflow as NOT RUN; it never generates synthetic research results in the app. Synthetic training CSVs are confined to Python unit tests. Screenshots go into ignored `artifacts/`. The isolated browser context is cleared and closed afterward. Run `npm run format:check` for frontend/Markdown formatting.

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
3. Train on at most 2 MB / 2,000 rows online. At least 20 distinct registered domains and each class present in at least three domain groups are required, with both classes in each partition. Larger datasets use the local command below.
4. Inspect all six predeclared model/scenario combinations, confusion matrix, ROC/PR curves, feature importance, and masked false positives/negatives. Export JSON, CSV, or the readable research summary.
5. Scan URLs for real lexical indicators. Predictions are explicitly unavailable until a trusted production model is deployed. Online experiments **never** activate a model in the scanner.

### Train a production Random Forest

```bash
python -m ml.train_local --dataset data/dataset.csv --output models --seed 42
# Optional provenance fields: --source "dataset citation" --license "license name"
# Review provenance, metrics, package versions and model checksum first.
git add -f models/model.joblib models/model_metadata.json
```

The local command uses the same feature and split definitions, with configurable `--max-rows` (100,000 default) and a 100 MB input limit. It selects Random Forest `max_depth` from 8/16 using **validation F1**, then writes the **extended-feature Random Forest**, even if a baseline has better validation F1. Logistic Regression and Decision Tree remain comparison baselines, not replacement production algorithms. Positional dataset paths are still supported for existing scripts. `--n-estimators` defaults to 100 (local range 20–1,000; online range 20–150). The artifact is fitted on the training partition only; it is not silently refitted on validation/test data. Use `--output /outside/the/repo` for experimental artifacts that should not ship.

Joblib is pickle-based and can execute code. Never upload or load artifacts from an untrusted source. Inference loads only fixed, deployment-owned `models/model.joblib` and its metadata; artifact SHA-256, manifest/bundle version consistency, fitted Random Forest Pipeline, feature schema/order/fingerprint, PSL provenance, scikit-learn version, and Python major/minor compatibility are checked. Dependency versions are recorded for reproduction. Inference artifacts are capped at 100 MB; saving an oversized model fails instead of publishing a supposedly ready artifact. A checksum verifies file consistency, not producer trust. Both trusted files must be included in the deployment. A missing/incompatible pair disables prediction.

### Experiment design

- `lexical-v2`: 21 fixed features (including separate URL and hostname Shannon entropy) in `ml/features.py`; numeric definitions are exposed by `/api/features`.
- Seven basic lexical features versus all 21 extended features.
- Fixed shortener, keyword, and six-domain reference lists are versioned in source and recorded in each report. Punycode is normalized; ASCII edit similarity is an indicator, **not** full Unicode confusable detection.
- Public Suffix List extraction uses the packaged snapshot (including private suffixes), with no runtime PSL downloads. The pinned `tldextract` version, packaged PSL SHA-256, ordered names/definitions, reference domains, keywords, and shorteners form a SHA-256 feature fingerprint stored in reports and artifact manifests. Updating the PSL dependency or any feature definition requires explicit review/retraining; there is no silent background refresh. Document reference-list overlap with datasets and keep lists fixed before comparison. Changing any definition/list requires retraining and a new schema version.
- A deterministic stratified shuffle of registered-domain group IDs targets 70/15/15 **by groups**, using benign-only / phishing-only / mixed-label strata. If two-stage stratification is incompatible with rare strata, a recorded `GroupShuffleSplit` fallback checks class presence only. Actual row proportions are reported and may differ. Domain variants, paths, and subdomains within a registered domain cannot cross partitions. Cross-domain ownership/family relationships are not inferred; curate group definitions separately if your research requires them.
- Seed retries (at most 30) only ensure both classes occur in every split; the actual split seed and partition membership hash are recorded. No metric guides splitting.
- All three families use scikit-learn Pipelines. Logistic Regression includes `StandardScaler` fitted exclusively on training data; trees need no scaling. Two predeclared Random Forest depths (8/16) are fitted on training data and compared on validation F1, with ties choosing the first/shallower depth. Fixed LR/DT baselines and the selected RF configuration are evaluated once per family/scenario on identical untouched test groups. No candidate is fitted again on validation or test data. Repeatedly inspecting the same test scores is not new independent evidence.
- Positive class is phishing. PR-AUC means **average precision**. Undefined metrics return JSON null / N/A with a reason (for example precision with no positive predictions or ROC-AUC with one class). AP requires actual positives; an all-positive partition has defined AP but carries a caveat that it cannot measure discrimination against benign URLs. Confusion matrices always use benign/phishing row and column order. Scores from `predict_proba` are labeled uncalibrated estimates.
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

### Online scanner response contract (stage 2)

`POST /api/scan` runs the real Python DNS/HEAD scanner. A structurally invalid URL returns API HTTP 422. A valid lexical URL can still be refused for networking; the API returns its lexical features, the actual ML availability, and a separate `online` result:

| `online.status` | Meaning                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `complete`      | Response headers obtained; no safety verdict is implied                                                                     |
| `http_error`    | The target really returned HTTP 4xx/5xx; inspect `http_status`                                                              |
| `limited`       | HEAD is unsupported (405/501), or only an interim response was received; no GET fallback                                    |
| `blocked`       | URL/host/port/IP/peer policy rejected the target or a redirect before sending the next request                              |
| `unavailable`   | DNS, TLS, connection, timeout, malformed/oversized response, redirect loop/limit, or instance capacity prevented completion |

`reason_code` identifies the failure without echoing network-library exception text. `chain` contains **only** hops whose headers were received; an uncontacted/blocked target never gets a fabricated HTTP status. `redirect_count` counts transitions with received response headers (maximum five), while `redirects_observed` counts redirect responses, including one that could not be followed. Failed resolution leaves `final_url`/`final_domain` null. Unsupported HEAD also leaves the final destination unconfirmed. The last observed status and chain are retained when a later hop fails. Durations are measured with a monotonic clock; capacity rejection has no online duration because no network check ran.

The network policy additionally blocks site-local IPv6, IPv4-mapped/6to4/Teredo/NAT64 addresses, Azure's platform address `168.63.129.16`, internal suffixes, and ambiguous numeric IP notation. Every A/AAAA answer that the system resolver returns is checked; at most 64 answers are accepted. The connection uses a validated numeric IP, certificate verification/SNI use the normalized original host, and the connected peer is checked **before** sending HEAD. Every redirect repeats these checks, including redirects on the same hostname. The transport closes immediately after headers. Request headers are capped at 8 KB, response headers at 16 KB / 100 fields, and each instance allows at most four active network scans. These supplement the existing five-second hop/15-second total deadlines and rate limits.

The scanner page shows original and normalized URLs, final domain, actual target status, redirect chain, measured durations, exact-host shortener detection, original/final domain similarity, and all Python lexical features. Model status is separate; no artifact still means **Prediction unavailable**, not loss of lexical analysis. References remain fixed. Stage 3 deliberately migrates features to `lexical-v2` to add URL entropy; old `lexical-v1` artifacts are rejected and must be retrained, rather than silently used with a different feature order. Punycode normalization and ASCII edit comparison do not provide comprehensive Unicode visual-confusable detection. Clear cancels the pending browser request and preserves the online-check preference.

### Scanner tests

```bash
python -m pytest -q
npm test
# Install Playwright Chromium first, as described above:
npm run test:scanner
# Retained cloud tools:
PYTHON=/workspace/ummu-venv/bin/python CHROMIUM_PATH=/usr/bin/chromium npm run test:scanner
```

Security tests mock **all outbound DNS and sockets**, and unexpected egress fails the tests. They exercise mixed public/private DNS, changed DNS at redirects, connected-peer mismatch, pinning/TLS settings, private/metadata targets, loop/redirect limits, HEAD-only behavior, actual HTTP error handling, DNS failure, deadlines, resource caps, and concurrency.

The scanner browser test starts actual Vite and FastAPI services on dedicated ports 5175/18002, refuses occupied ports, and stops only its own processes. The explicit test-only `tests/scanner_fixture.py` mocks outbound DNS/HEAD responses; production never imports it and has no mock-mode switch. The browser sends real `/api/scan` requests, checks Python-computed output, and confirms it never navigates to a target. No real phishing site is used. Mocked public success is evidence of integration behavior, **not** proof of live deployment egress. The current cloud live probe to `https://example.com/` returned `unavailable` / `dns_failure`, without an HTTP status or destination. Live public DNS/HEAD and Vercel deployment still require verification in the intended hosting network; passing these tests alone does not establish suitability for unrestricted public access.

## Privacy and exports

History is stored under `ummu_url_guard_history` in localStorage, at most 200 records. Paths, queries, and fragments are removed **before saving**, including tokens embedded in paths. The current on-screen scan/CSV preview necessarily shows submitted values; do not share screenshots containing sensitive URLs. Scheme/hostname remain in masked exports and may still be identifying.

`ummu_url_guard_settings` stores the online-check preference. `ummu_url_guard_experiment_summaries` stores only the latest aggregate experiment, without uploaded datasets, error URLs, or curve points. Full current results stay in session memory and can be exported. localStorage is specific to the browser/device and can be unavailable or cleared. There is no synchronization or server-side dataset persistence. CSV exports neutralize spreadsheet formula prefixes. Untrusted URLs are displayed as text, never clickable target links or embedded frames.

## API

### Stage 3 ML validation and production status

No production model or dataset is bundled. No public dataset was downloaded, so no third-party dataset source/license is claimed. Training requires your own provenance-reviewed `url,label` CSV; optional local `--source` and `--license` fields record its citation and license without inventing either. Synthetic data is confined to tests/temp artifacts and must never be presented as research performance or committed as a production model.

The dataset summary records raw and normalized row counts, duplicate removal, class distribution, missing-value rejection policy, preview, exact raw-file SHA-256, and an order-preserving normalized-record SHA-256. No target label or online DNS/HTTP result is included in features. Group ownership across different registered domains is still not inferred; curate additional groups if your study requires it.

`/api/predict` returns actual Pipeline class/probability, model version/status, numeric features, and a UTC `prediction_timestamp`. Scores are **uncalibrated** estimates of phishing probability; no calibration dataset/method is used or implied. Missing/incompatible artifacts return null class/score/version and `model_status: unavailable`.

Online experiments are capped at 2 MB CSV / 2,000 rows, a 2.1 MB complete multipart body, one experiment per instance, one numeric-library thread, and a 40-second child-process deadline. Timeout kills/reaps the child, releases the training lock, returns HTTP 408, and never reports training success. Nothing writes or activates production artifacts. Each response includes actual split row fractions/class counts, stratification/fallback details, selected/candidate configurations, feature/PSL fingerprint, package versions, test metrics/curves, and masked FP/FN records. Temporary Vercel files are not treated as persistent storage.

Evaluation renders N/A reasons, real model comparison, ROC/PR curves, and FP/FN counts. Result Analysis includes a horizontal impurity-importance chart and a table from the fitted forest. Up to 50 masked errors per type are exported; aggregate error counts cover the entire holdout. JSON exports retain all experiment metadata; localStorage still excludes datasets and row-level errors.

Run `python -m pytest -q` for feature/order/leakage/scaler-fit boundaries, actual three-family training, metrics including undefined cases, CLI compatibility, artifact/manifest round trips, real model-backed API prediction in an isolated unit test, online non-persistence, and worker timeout cleanup. Production remains unavailable until **you** train a reviewed dataset, explicitly commit the trusted artifact pair, and redeploy. Local tests do not establish hosted Vercel deployment readiness.

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
