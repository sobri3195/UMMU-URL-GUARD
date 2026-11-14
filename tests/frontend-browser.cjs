// Full application integration: real FastAPI/Vite, controlled DNS/HEAD fixture,
// no synthetic ML training dataset, no production-model activation.
const assert = require("node:assert/strict");
const { mkdirSync } = require("node:fs");
mkdirSync("artifacts", { recursive: true });
const { processTools, portsFree, chromium } = require("./support/browser.cjs");
const services = processTools(),
  host = "http://127.0.0.1:5176",
  target = "http://127.0.0.1:18003";
let browser;
async function textDownload(page, button) {
  const wait = page.waitForEvent("download");
  await button.click();
  const file = await wait;
  const stream = await file.createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}
(async () => {
  await portsFree([host, target + "/api/health"]);
  const api = services.start(process.env.PYTHON || "python3", [
    "-m",
    "uvicorn",
    "scanner_fixture:app",
    "--app-dir",
    "tests",
    "--host",
    "127.0.0.1",
    "--port",
    "18003",
    "--no-access-log",
  ]);
  await services.ready(api, target + "/api/health");
  const vite = services.start(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "5176",
      "--strictPort",
    ],
    { API_PROXY_TARGET: target },
  );
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
    errors = [],
    external = [];
  let scans = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url() === host + "/api/scan") scans++;
    if (!request.url().startsWith(host + "/")) external.push(request.url());
  });
  await page.goto(host);
  await page.getByText("Backend connected", { exact: true }).waitFor();
  assert.equal(await page.locator("canvas").count(), 0);
  await page.screenshot({
    path: "artifacts/frontend-desktop.png",
    fullPage: true,
  });
  for (const name of [
    "scanner",
    "dataset",
    "features",
    "training",
    "evaluation",
    "experiments",
    "analysis",
    "history",
  ]) {
    await page.goto(host + "/#" + name);
    await page.locator("h1").waitFor();
  }
  await page.goto(host + "/#scanner");
  await page.locator("#url").fill("https://bit.ly/start?token=do-not-store");
  await page.evaluate(() => {
    const form = document.querySelector("#scan-form");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
  });
  await page.locator("#result[aria-busy=true]").waitFor();
  await page
    .getByRole("heading", { name: "Online check: complete", exact: true })
    .waitFor();
  assert.equal(scans, 1);
  await page
    .getByRole("button", { name: "Saved to history", exact: true })
    .waitFor();
  await page.goto(host + "/#features");
  await page.goto(host + "/#scanner");
  await page
    .getByRole("heading", { name: "Online check: complete", exact: true })
    .waitFor();
  assert.equal(scans, 1);
  assert.ok((await page.locator("#url").inputValue()).includes("do-not-store"));
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(await page.locator("#url").inputValue(), "");
  await page.locator("#url").fill("http://127.0.0.1/private?token=hidden");
  await page.getByRole("button", { name: "Scan URL", exact: true }).click();
  await page
    .getByRole("heading", { name: "Online check: blocked", exact: true })
    .waitFor();
  assert.equal(scans, 2);
  await page.goto(host + "/#history");
  assert.equal(await page.locator("#history-table tbody tr").count(), 2);
  await page.reload();
  await page.getByText("Backend connected", { exact: true }).waitFor();
  assert.equal(await page.locator("#history-table tbody tr").count(), 2);
  const stored = await page.evaluate(() =>
    localStorage.getItem("ummu_url_guard_history"),
  );
  assert.ok(
    !stored.includes("do-not-store") &&
      !stored.includes("token=") &&
      !stored.includes("/private"),
  );
  await page.getByLabel("Date order", { exact: true }).selectOption("asc");
  assert.ok(
    (
      await page.locator("#history-table tbody tr").first().innerText()
    ).includes("bit.ly"),
  );
  await page.getByLabel("Date order", { exact: true }).selectOption("desc");
  assert.ok(
    (
      await page.locator("#history-table tbody tr").first().innerText()
    ).includes("127.0.0.1"),
  );
  await page
    .getByRole("button", { name: "View details", exact: true })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Saved scan details", exact: true })
    .waitFor();
  assert.ok(
    !(await page.locator("#history-details").innerText()).includes("token="),
  );
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  const exported = JSON.parse(
    await textDownload(
      page,
      page.getByRole("button", { name: "Export JSON", exact: true }),
    ),
  );
  assert.equal(exported.length, 2);
  const csv = await textDownload(
    page,
    page.getByRole("button", { name: "Export CSV", exact: true }),
  );
  assert.ok(csv.includes("masked") || csv.includes("[redacted]"));
  await page.getByLabel("Search domain", { exact: true }).fill("bit.ly");
  assert.equal(await page.locator("#history-table tbody tr").count(), 1);
  await page.getByLabel("Search domain", { exact: true }).fill("");
  await page.getByLabel("Prediction", { exact: true }).selectOption("benign");
  await page.getByText("No matching history", { exact: true }).waitFor();
  await page
    .getByLabel("Prediction", { exact: true })
    .selectOption("unavailable");
  assert.equal(await page.locator("#history-table tbody tr").count(), 2);
  await page
    .getByRole("button", { name: "Delete", exact: true })
    .first()
    .click();
  assert.equal(await page.locator("#history-table tbody tr").count(), 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await page.getByText("No matching history", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("No matching history", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Export CSV", exact: true })
      .isDisabled(),
    true,
  );
  // Features genuinely come from Python, survive navigation, copy/export mask URLs.
  await page.goto(host + "/#features");
  await page
    .locator("#url")
    .fill("https://example.com/login?token=real-api-test");
  await page
    .getByRole("button", { name: "Extract features", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "URL comparison (1/4)", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Copy results", exact: true }).click();
  await page
    .getByText("Results copied. URL paths and queries are masked.", {
      exact: true,
    })
    .waitFor();
  assert.ok(
    !(await page.evaluate(() => navigator.clipboard.readText())).includes(
      "real-api-test",
    ),
  );
  await page.goto(host + "/#dataset");
  await page.goto(host + "/#features");
  assert.ok(
    (await page.locator("#url").inputValue()).includes("real-api-test"),
  );
  await page
    .getByRole("button", { name: "Clear comparison", exact: true })
    .click();
  // Invalid upload and backend training errors remain errors, never fake progress/results.
  await page.goto(host + "/#dataset");
  await page.locator("#dataset-file").setInputFiles({
    name: "invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("invalid,columns\n"),
  });
  await page
    .getByRole("button", { name: "Validate dataset", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#feedback").textContent.includes("422"),
  );
  await page.goto(host + "/#training");
  await page
    .getByRole("button", { name: "Start Training", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#feedback").textContent.includes("422"),
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Training completed", exact: true })
      .count(),
    0,
  );
  await page.goto(host + "/#experiments");
  await page
    .getByRole("button", { name: "Run Experiment", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#feedback").textContent.includes("422"),
  );
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 950 });
    for (const name of [
      "dashboard",
      "scanner",
      "dataset",
      "features",
      "training",
      "evaluation",
      "experiments",
      "analysis",
      "history",
    ]) {
      await page.goto(host + "/#" + name);
      await page.waitForFunction(
        () => document.documentElement.scrollWidth <= innerWidth,
      );
    }
  }
  await page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .click();
  await page.getByRole("link", { name: "URL Scanner", exact: true }).click();
  await page
    .getByRole("heading", { name: "URL Scanner", exact: true })
    .waitFor();
  await page.screenshot({
    path: "artifacts/frontend-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "Frontend API integration PASSED: all nine routes, real Python scan/features/validation/training errors, single scan submit, preserved state, masked history across refresh, details/search/filter/sort/delete/clear and exports, clipboard, desktop/tablet/mobile navigation, zero page errors and no target visits. Success ML controls are covered by isolated unit components using actual Python fixture outputs.",
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
