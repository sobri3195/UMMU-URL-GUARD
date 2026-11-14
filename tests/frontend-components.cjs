// Isolated component UNIT tests. Python creates actual ML fixture output; mock
// transport never runs the production app or publishes fixture research results.
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { processTools, portsFree, chromium } = require("./support/browser.cjs");
const fixture = JSON.parse(
  execFileSync(process.env.PYTHON || "python3", ["tests/component_data.py"], {
    encoding: "utf8",
    maxBuffer: 10000000,
  }),
);
const services = processTools(),
  host = "http://127.0.0.1:5177";
let browser;
const count = {};
const modes = {};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function downloadText(page, button) {
  const waiting = page.waitForEvent("download");
  await button.click();
  const file = await waiting;
  const stream = await file.createReadStream();
  let value = "";
  for await (const chunk of stream) value += chunk.toString();
  return value;
}
(async () => {
  await portsFree([host]);
  const vite = services.start(process.execPath, [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5177",
    "--strictPort",
  ]);
  await services.ready(vite, host);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ acceptDownloads: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: host,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    count[path] = (count[path] || 0) + 1;
    assert.equal(request.method(), "POST");
    await delay(180);
    if (modes[path] === "error")
      return route
        .fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Controlled unit API failure" }),
        })
        .catch(() => {});
    if (modes[path] === "unsupported")
      return route
        .fulfill({
          status: 501,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Online action unsupported" }),
        })
        .catch(() => {});
    let value;
    if (path === "/api/features" || path === "/api/predict") {
      const input = request.postDataJSON().url;
      value = (
        path === "/api/features" ? fixture.features : fixture.predictions
      )[input];
      assert.ok(value, "No precomputed Python unit result for " + input);
    } else if (path === "/api/dataset/analyze") value = fixture.summary;
    else if (path === "/api/train" || path === "/api/experiment") {
      assert.equal(url.searchParams.get("seed"), "7");
      assert.equal(url.searchParams.get("n_estimators"), "20");
      assert.ok(
        request
          .postDataBuffer()
          .includes(Buffer.from("component-unit-only.csv")),
      );
      value = fixture.report;
    } else throw Error("Unexpected unit request: " + path);
    await route
      .fulfill({ contentType: "application/json", body: JSON.stringify(value) })
      .catch(() => {});
  });
  await page.goto(host + "/tests/components.html");
  await page.waitForFunction(() => window.unit);
  const mount = (name) =>
    page.evaluate((name) => window.unit.mount(name), name);
  // Empty states never generate metric charts or fabricated numbers.
  for (const name of ["evaluation", "analysis", "experiments"]) {
    await mount(name);
    assert.equal(await page.evaluate(() => window.unit.chartCount()), 0);
  }
  // Python feature responses, duplicate submission guard, comparison/copy/export.
  await mount("features");
  const first = "https://example.com/login?token=unit-secret-1",
    second = "https://google.com/about?token=unit-secret-2";
  await page.locator("#url").fill(first);
  await page.evaluate(() => {
    const form = document.querySelector("#features-form");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
  });
  await page
    .getByRole("heading", { name: "URL comparison (1/4)", exact: true })
    .waitFor();
  assert.equal(count["/api/features"], 1);
  await page.locator("#url").fill(second);
  await page
    .getByRole("button", { name: "Extract features", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "URL comparison (2/4)", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Copy results", exact: true }).click();
  await page
    .getByText("Results copied. URL paths and queries are masked.", {
      exact: true,
    })
    .waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(!copied.includes("unit-secret") && copied.includes("url_entropy"));
  const featuresCSV = await downloadText(
    page,
    page.getByRole("button", { name: "Export CSV", exact: true }),
  );
  assert.ok(
    featuresCSV.includes("url_entropy") && !featuresCSV.includes("unit-secret"),
  );
  await mount("history");
  await mount("features");
  assert.equal(await page.locator("#url").inputValue(), second);
  assert.equal(await page.locator("#result h3").count(), 2);
  modes["/api/features"] = "error";
  await page
    .getByRole("button", { name: "Extract features", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#feedback").textContent.includes("503"),
  );
  delete modes["/api/features"];
  // A response from a page left during the request cannot touch the new page.
  await page.evaluate(() => {
    document
      .querySelector("#features-form")
      .dispatchEvent(new Event("submit", { cancelable: true }));
    window.unit.mount("history");
  });
  await delay(250);
  await page
    .getByRole("heading", { name: "Detection history", exact: true })
    .waitFor();
  await mount("features");
  await page
    .getByRole("button", { name: "Clear comparison", exact: true })
    .click();
  await page.getByText("No extracted features yet.", { exact: true }).waitFor();
  // Actual Python dataset statistics/features are rendered in an isolated unit mount.
  await mount("dataset");
  await page.locator("#dataset-file").setInputFiles({
    name: "component-unit-only.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(fixture.csv, "base64"),
  });
  await page
    .getByRole("button", { name: "Validate dataset", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "component-unit-only.csv", exact: true })
    .waitFor();
  await page
    .getByRole("button", {
      name: "Preview features (first 3 URLs)",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: "Feature extraction preview", exact: true })
    .waitFor();
  assert.equal(
    await page.locator("#dataset-feature-result tbody tr").count(),
    63,
  );
  const summary = JSON.parse(
    await downloadText(
      page,
      page.getByRole("button", { name: "Download summary", exact: true }),
    ),
  );
  assert.equal(summary.sha256, fixture.summary.sha256);
  assert.equal(summary.preview, undefined);
  await mount("features");
  await mount("dataset");
  assert.equal(
    await page.locator("#dataset-feature-result tbody tr").count(),
    63,
  );
  // Shared research request survives navigation; no percentage or duplicate request.
  await mount("training");
  await page.getByLabel("Random seed", { exact: true }).fill("7");
  await page.getByLabel("RF estimators", { exact: true }).fill("20");
  await page
    .getByLabel("Result model", { exact: true })
    .selectOption("Logistic Regression");
  await page.evaluate(() => {
    const form = document.querySelector("#research-form");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    document
      .querySelector("#research-form")
      .dispatchEvent(new Event("submit", { cancelable: true }));
  });
  await mount("experiments");
  assert.equal(
    await page
      .getByRole("button", { name: "Run Experiment", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("heading", { name: "Training completed", exact: true })
    .waitFor();
  assert.equal(count["/api/train"], 1);
  const result = JSON.parse(
    await downloadText(
      page,
      page.getByRole("button", { name: "Export Results", exact: true }),
    ),
  );
  assert.equal(result.experiment_id, fixture.report.experiment_id);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  assert.ok(
    !stored.includes("verify-account-123") && !stored.includes("unit-secret"),
  );
  await page
    .getByRole("button", { name: "Run Experiment", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Training completed", exact: true })
    .waitFor();
  await page.waitForFunction(() => window.unit.ctx.job === null);
  assert.equal(count["/api/experiment"], 1);
  // All models/scenarios, curves, actual importances, metadata, CSV/JSON/summary exports.
  await mount("evaluation");
  await page.getByLabel("Model", { exact: true }).selectOption("Decision Tree");
  await page.getByLabel("Feature set", { exact: true }).selectOption("basic");
  assert.equal(await page.evaluate(() => window.unit.chartCount()), 2);
  await mount("analysis");
  assert.equal(await page.locator("#feature-importance").count(), 1);
  for (const [name, format] of [
    ["Export JSON", "json"],
    ["Export comparison CSV", "csv"],
    ["Export research summary", "text"],
  ]) {
    const text = await downloadText(
      page,
      page.getByRole("button", { name, exact: true }),
    );
    if (format === "json")
      assert.equal(
        JSON.parse(text).experiment_id,
        fixture.report.experiment_id,
      );
    else assert.ok(text.length > 40);
  }
  for (let i = 0; i < 12; i++) {
    for (const name of ["evaluation", "experiments", "analysis"]) {
      await mount(name);
      assert.ok((await page.evaluate(() => window.unit.chartCount())) <= 4);
    }
  }
  // Unsupported/failed backend actions have a real disabled state/local instructions.
  modes["/api/experiment"] = "unsupported";
  await mount("experiments");
  await page
    .getByRole("button", { name: "Run Experiment", exact: true })
    .click();
  await page.waitForFunction(() =>
    window.unit.ctx.unsupported.has("/experiment"),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Run Experiment", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByText("python -m ml.train_local --dataset /path/to/dataset.csv", {
      exact: true,
    })
    .waitFor();
  delete modes["/api/experiment"];
  await page
    .getByRole("button", { name: "Retry online action", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Training completed", exact: true })
    .waitFor();
  await page.waitForFunction(() => window.unit.ctx.job === null);
  assert.equal(
    await page
      .getByRole("button", { name: "Run Experiment", exact: true })
      .isEnabled(),
    true,
  );
  // Quota handling/retry never claims persistence or repeats a scan request.
  await mount("scanner");
  await page.locator("[name=online]").uncheck();
  await page.locator("#url").fill(first);
  await page.evaluate(() => {
    window.restoreStorage = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Scan URL", exact: true }).click();
  await page
    .getByRole("button", { name: "Save masked history", exact: true })
    .waitFor();
  assert.equal(count["/api/predict"], 1);
  await page.evaluate(() => {
    Storage.prototype.setItem = window.restoreStorage;
  });
  await page
    .getByRole("button", { name: "Save masked history", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Saved to history", exact: true })
    .waitFor();
  assert.equal(count["/api/predict"], 1);
  await mount("history");
  await page.getByRole("button", { name: "View details", exact: true }).click();
  await page
    .getByRole("heading", { name: "Saved scan details", exact: true })
    .waitFor();
  assert.ok(
    !(await page.locator("#history-details").innerText()).includes(
      "unit-secret",
    ),
  );
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  const csv = await downloadText(
    page,
    page.getByRole("button", { name: "Export CSV", exact: true }),
  );
  assert.ok(!csv.includes("unit-secret"));
  const json = JSON.parse(
    await downloadText(
      page,
      page.getByRole("button", { name: "Export JSON", exact: true }),
    ),
  );
  assert.equal(json.length, 1);
  await page.getByLabel("Search domain", { exact: true }).fill("no-match");
  await page.getByText("No matching history", { exact: true }).waitFor();
  await page.getByLabel("Search domain", { exact: true }).fill("");
  await page
    .getByLabel("Prediction", { exact: true })
    .selectOption(fixture.predictions[first].prediction);
  assert.equal(await page.locator("#history-table tbody tr").count(), 1);
  await page.getByLabel("Date order", { exact: true }).selectOption("asc");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByText("No matching history", { exact: true }).waitFor();
  await mount("scanner");
  await page
    .getByRole("button", { name: "Save masked history", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Saved to history", exact: true })
    .waitFor();
  assert.equal(count["/api/predict"], 1);
  // Aggregate report persists, but raw file/curves/errors never masquerade as retained data.
  await page.reload();
  await page.waitForFunction(() => window.unit);
  await mount("evaluation");
  assert.equal(await page.evaluate(() => window.unit.ctx.file), null);
  assert.equal(await page.evaluate(() => window.unit.chartCount()), 0);
  assert.ok((await page.locator("#view").innerText()).includes("not stored"));
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 950 });
    for (const name of [
      "features",
      "dataset",
      "training",
      "experiments",
      "evaluation",
      "analysis",
      "history",
      "scanner",
    ]) {
      await mount(name);
      await page.waitForFunction(
        () => document.documentElement.scrollWidth <= innerWidth,
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "Frontend component UNIT tests PASSED: all page controls, actual Python fixture results, single submits, page cancellation, job continuity, copy/exports, dataset preview, model/feature selection, actual charts and cleanup, quotas, history details/filter/delete, cached summaries, and desktop/tablet/mobile. Unit fixtures are not production research evidence.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    await services.close();
  });
