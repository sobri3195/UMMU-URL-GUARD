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
  assert.equal(maskURL("javascript:alert(1)"), "javascript:///[redacted]");
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
