import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkspace,
  startPage,
  selectFile,
  runResearch,
} from "../src/utils/workspace.js";
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) || null,
  setItem: (key, value) => store.set(key, value),
};
test("navigation aborts page requests and retains memory inputs", () => {
  const ctx = createWorkspace();
  const first = startPage(ctx, "features");
  ctx.state.features.url = "https://example.com";
  startPage(ctx, "scanner");
  assert.equal(first.signal.aborted, true);
  assert.equal(first.active(), false);
  assert.equal(ctx.state.features.url, "https://example.com");
  assert.equal(ctx.page.signal.aborted, false);
});
test("workspace coalesces research submissions and records unsupported action", async () => {
  const original = globalThis.fetch;
  const ctx = createWorkspace();
  let renders = 0,
    calls = 0,
    release;
  ctx.renderResearch = () => {
    renders++;
  };
  globalThis.fetch = async () => {
    calls++;
    await new Promise((resolve) => {
      release = resolve;
    });
    return new Response(JSON.stringify({ detail: "not supported" }), {
      status: 501,
      headers: { "content-type": "application/json" },
    });
  };
  const running = runResearch(
    ctx,
    "/train",
    new File(["url,label"], "test.csv"),
    { seed: 42, estimators: 20 },
  );
  await assert.rejects(
    runResearch(ctx, "/train", new File(["url,label"], "test.csv"), {
      seed: 42,
      estimators: 20,
    }),
    /already running/,
  );
  release();
  await running;
  assert.equal(calls, 1);
  assert.equal(ctx.job, null);
  assert.ok(ctx.unsupported.has("/train"));
  assert.ok(renders >= 2);
  assert.match(ctx.researchError, /501/);
  globalThis.fetch = original;
});

test("empty and oversize file selections cannot silently reuse a prior dataset", () => {
  const ctx = createWorkspace();
  selectFile(ctx, new File(["url,label"], "prior.csv"));
  assert.throws(() => selectFile(ctx, new File([], "empty.csv")), /empty/);
  assert.equal(ctx.file, null);
  selectFile(ctx, new File(["url,label"], "prior.csv"));
  assert.throws(
    () => selectFile(ctx, new File([new Uint8Array(2000001)], "large.csv")),
    /2 MB/,
  );
  assert.equal(ctx.file, null);
});
