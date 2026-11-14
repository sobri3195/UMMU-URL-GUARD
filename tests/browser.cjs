const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { mkdirSync } = require("node:fs");
const { basename } = require("node:path");
mkdirSync("artifacts", { recursive: true });
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Model not available", { exact: true }).waitFor();
  await page.screenshot({
    path: "artifacts/browser-desktop.png",
    fullPage: true,
  });
  for (const route of [
    "scanner",
    "dataset",
    "features",
    "training",
    "evaluation",
    "experiments",
    "analysis",
    "history",
  ]) {
    await page.goto(`http://127.0.0.1:5173/#${route}`);
    await page.locator("h1").waitFor();
  }
  await page.goto("http://127.0.0.1:5173/#features");
  await page.locator("#url").fill("https://gooogle.com/login?token=abc");
  await page.getByRole("button", { name: "Extract features" }).click();
  await page
    .locator("#result table")
    .first()
    .getByRole("cell", { name: "suspicious_keywords", exact: true })
    .waitFor();
  await page.goto("http://127.0.0.1:5173/#scanner");
  await page.locator("[name=online]").uncheck();
  await page.locator("#url").fill("https://gooogle.com/login?token=abc");
  await page.getByRole("button", { name: "Scan URL", exact: true }).click();
  await page
    .getByRole("heading", {
      name: "Prediction unavailable — model not trained",
    })
    .waitFor();
  await page.goto("http://127.0.0.1:5173/#history");
  await page
    .getByRole("cell", { name: "https://gooogle.com/[redacted]", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator("#history-table")
      .innerText()
      .then((t) => t.includes("token=abc")),
    false,
  );
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByText("No matching history", { exact: true }).waitFor();
  // Dataset-derived UI results require an explicitly provided real CSV.
  // Synthetic training fixtures are confined to Python unit tests.
  if (process.env.ML_TEST_DATASET) {
    await page.goto("http://127.0.0.1:5173/#dataset");
    await page
      .locator("#dataset-file")
      .setInputFiles(process.env.ML_TEST_DATASET);
    await page.getByRole("button", { name: "Validate dataset" }).click();
    await page
      .getByRole("heading", {
        name: basename(process.env.ML_TEST_DATASET),
        exact: true,
      })
      .waitFor();
    await page.goto("http://127.0.0.1:5173/#training");
    await page.locator("[name=estimators]").fill("20");
    await page
      .getByRole("button", { name: "Start Training", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Training completed" })
      .waitFor({ timeout: 50000 });
    for (const route of ["evaluation", "experiments", "analysis"]) {
      await page.goto(`http://127.0.0.1:5173/#${route}`);
      assert.ok((await page.locator("tbody tr").count()) > 0);
    }
    await page.locator("#feature-importance").waitFor();
    console.log(
      "ML browser workflow executed with the supplied CSV; results are dataset-specific, not general research claims.",
    );
  } else {
    console.log(
      "ML upload/training/evaluation browser workflow NOT RUN: provide a real CSV via ML_TEST_DATASET. Synthetic training is tested only in Python unit tests.",
    );
  }
  await page.goto("http://127.0.0.1:5173/#toString");
  await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "URL Scanner", exact: true }).click();
  await page
    .getByRole("heading", { name: "URL Scanner", exact: true })
    .waitFor();
  await page.screenshot({
    path: "artifacts/browser-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  // Remove all synthetic browser state: fixture metrics must not remain in a user's workspace.
  await page.evaluate(() => localStorage.clear());
  console.log(
    "Browser smoke passed: all routes, real API features, masked scan history/delete, desktop/mobile, zero page errors. Dataset-dependent ML coverage is reported separately above.",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
