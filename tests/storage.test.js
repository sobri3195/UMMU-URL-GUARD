import test from "node:test";
import assert from "node:assert/strict";
import {
  KEYS,
  read,
  history,
  saveScan,
  removeScan,
  clearHistory,
  toCSV,
  maskURL,
  saveExperiment,
} from "../src/utils/storage.js";
const data = new Map();
globalThis.localStorage = {
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, value),
};
test("history redacts secrets, caps count, deletes individual entries, and clears", () => {
  const scan = {
    url: "https://example.com/secret-token?password=x#token",
    prediction: null,
    probability: null,
  };
  for (let i = 0; i < 205; i++) assert.equal(saveScan(scan), true);
  assert.equal(history().length, 200);
  assert.equal(history()[0].url, "https://example.com/[redacted]");
  assert.equal(toCSV(history()).includes("password"), false);
  assert.equal(removeScan(history()[0].id), true);
  assert.equal(history().length, 199);
  clearHistory();
  assert.equal(history().length, 0);
});
test("handles corrupt or unavailable storage", () => {
  data.set(KEYS.history, "{broken");
  assert.deepEqual(history(), []);
  data.set(KEYS.history, "{}");
  assert.deepEqual(history(), []);
  const saved = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("quota");
    },
  };
  assert.deepEqual(read(KEYS.settings, {}), {});
  assert.equal(saveScan({ url: "https://example.com" }), false);
  globalThis.localStorage = saved;
});
test("CSV prevents formulas and quotes strings", () => {
  const text = toCSV([
    { name: "=SUM(A1)", other: '"quote"' },
    { name: " \t@cmd", other: "safe" },
  ]);
  assert.ok(text.includes("'="));
  assert.ok(text.includes("' \t@"));
  assert.ok(text.includes('""quote""'));
  assert.equal(maskURL("javascript:alert(1)"), "[redacted URL]");
});
test("experiment persistence excludes datasets and row-level errors", () => {
  saveExperiment({
    reports: [
      {
        errors: [{ url: "sensitive" }],
        test: { roc: { x: [1] }, pr: { x: [1] } },
        validation: { roc: { x: [1] }, pr: { x: [1] } },
      },
    ],
  });
  assert.equal(data.get(KEYS.experiments).includes("sensitive"), false);
});

test("history details and legacy rows are masked before read/export", () => {
  data.clear();
  saveScan({
    url: "https://user:password@example.com/path?token=never-persist",
    features: { url_length: 40 },
    online: {
      status: "complete",
      final_url: "https://final.com/token-in-path?q=secret",
      http_status: 200,
      chain: [
        { url: "https://example.com/private?q=secret", http_status: 302 },
      ],
    },
  });
  const raw = data.get(KEYS.history);
  assert.equal(
    /password|never-persist|token-in-path|q=secret/.test(raw),
    false,
  );
  assert.equal(history()[0].details.features.url_length, 40);
  data.set(
    KEYS.history,
    JSON.stringify([
      { id: "legacy", url: "https://u:p@example.com/path?token=old" },
    ]),
  );
  assert.equal(history()[0].url, "https://example.com/[redacted]");
});
test("quota failure preserves existing history and never claims a saved record", () => {
  data.clear();
  saveScan({ url: "https://example.com" });
  const before = data.get(KEYS.history);
  const original = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error("quota");
  };
  assert.equal(saveScan({ url: "https://other.com" }), false);
  assert.equal(data.get(KEYS.history), before);
  localStorage.setItem = original;
});

test("retrying persistence with the same scan ID cannot duplicate history", () => {
  data.clear();
  const value = { url: "https://example.com" };
  assert.equal(saveScan(value, "same-scan"), true);
  assert.equal(saveScan(value, "same-scan"), true);
  assert.equal(history().length, 1);
});
