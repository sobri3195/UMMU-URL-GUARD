import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { request, getHealth, post } from "../src/utils/api.js";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const health = () => ({
  status: "ok",
  backend: "fastapi",
  app_version: "1.0.1",
  model_status: "unavailable",
  model_available: false,
  model_version: null,
  report: null,
});
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

test("health requires real typed backend JSON and never uses browser cache", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/health");
    assert.equal(options.cache, "no-store");
    return json(health());
  };
  assert.deepEqual(await getHealth(), health());
});
test("features POST uses central client and checks numerical feature values", async () => {
  const payload = {
    url: "https://example.com/",
    schema_version: "lexical-v1",
    features: { url_length: 20 },
    definitions: { url_length: "Normalized URL characters" },
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/features");
    assert.equal(options.method, "POST");
    assert.equal(JSON.parse(options.body).url, payload.url);
    return json(payload);
  };
  assert.deepEqual(await post("/features", { url: payload.url }), payload);
  globalThis.fetch = async () =>
    json({ ...payload, features: { url_length: "20" } });
  await assert.rejects(
    post("/features", { url: payload.url }),
    /Invalid feature response/,
  );
});
test("rejects SPA HTML, malformed JSON, arrays and false health contracts", async () => {
  for (const response of [
    new Response("<!doctype html>", {
      headers: { "content-type": "text/html" },
    }),
    new Response("{broken", {
      headers: { "content-type": "application/json" },
    }),
    json([]),
    json({ status: "ok" }),
    json({ ...health(), model_available: true }),
  ]) {
    globalThis.fetch = async () => response;
    await assert.rejects(getHealth(), /JSON|health response/);
  }
});
test("HTTP errors and unreachable backend produce actionable errors", async () => {
  globalThis.fetch = async () => json({ detail: "Rate limit reached" }, 429);
  await assert.rejects(getHealth(), /HTTP 429: Rate limit reached/);
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(getHealth(), /Cannot reach the Python API/);
});
test("timeouts abort the actual network request", async () => {
  let aborted = false;
  globalThis.fetch = async (url, { signal }) =>
    new Promise((resolve, reject) =>
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      ),
    );
  await assert.rejects(getHealth({ timeoutMs: 10 }), /timed out/);
  assert.ok(aborted);
});
test("caller cancellation and invalid endpoint paths cannot escape /api", async () => {
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async () => {
    throw new DOMException("Aborted", "AbortError");
  };
  await assert.rejects(getHealth({ signal: controller.signal }), /cancelled/);
  await assert.rejects(request("https://evil.example"), /relative endpoint/);
  await assert.rejects(request("//evil.example"), /relative endpoint/);
});

test("scan responses preserve blocked/limited/error metadata independently of ML", async () => {
  const payload = {
    url: "https://example.com/",
    schema_version: "lexical-v1",
    features: { url_length: 20 },
    definitions: { url_length: "URL characters" },
    typosquatting: { indicator: false },
    prediction: null,
    probability: null,
    model_version: null,
    model_status: "unavailable",
    prediction_timestamp: "2026-11-14T00:00:00+00:00",
    online: {
      status: "blocked",
      chain: [],
      redirect_count: 0,
      http_status: null,
    },
  };
  globalThis.fetch = async () => json(payload);
  assert.equal(
    (await post("/scan", { url: payload.url })).online.status,
    "blocked",
  );
  for (const invalid of [
    { ...payload, online: { ...payload.online, status: "safe" } },
    { ...payload, online: { ...payload.online, redirect_count: 6 } },
    { ...payload, features: { url_length: "fake" } },
  ]) {
    globalThis.fetch = async () => json(invalid);
    await assert.rejects(post("/scan", { url: payload.url }), /Invalid/);
  }
});

test("prediction response requires actual model status/probability and timestamp", async () => {
  const payload = {
    url: "https://example.com/",
    schema_version: "lexical-v2",
    features: { url_length: 20 },
    definitions: { url_length: "URL characters" },
    model_status: "unavailable",
    prediction: null,
    probability: null,
    model_version: null,
    prediction_timestamp: "2026-11-14T00:00:00Z",
  };
  globalThis.fetch = async () => json(payload);
  assert.equal((await post("/predict", { url: payload.url })).prediction, null);
  globalThis.fetch = async () =>
    json({ ...payload, model_status: "available", probability: 42 });
  await assert.rejects(
    post("/predict", { url: payload.url }),
    /Invalid model prediction/,
  );
});

test("training client rejects missing metrics and requires reasons for N/A", async () => {
  // Contract fixture only; not research results or production training data.
  const reports = ["basic", "extended"].flatMap((feature_set) =>
    ["Random Forest", "Logistic Regression", "Decision Tree"].map(
      (model_name) => ({
        feature_set,
        model_name,
        test: {
          accuracy: 0.5,
          precision: null,
          recall: 0,
          f1: 0,
          roc_auc: 0.5,
          pr_auc: 0.5,
          metric_reasons: { precision: "No predicted phishing samples" },
        },
      }),
    ),
  );
  const result = {
    experiment_id: "test-only",
    feature_fingerprint: "test-fingerprint",
    dataset: { sha256: "test-hash" },
    reports,
  };
  globalThis.fetch = async () => json(result);
  assert.equal((await post("/train", {})).reports.length, 6);
  globalThis.fetch = async () => json({ ...result, reports: [] });
  await assert.rejects(post("/train", {}), /Invalid experiment/);
  delete reports[0].test.metric_reasons.precision;
  globalThis.fetch = async () => json(result);
  await assert.rejects(post("/train", {}), /Invalid experiment/);
});
