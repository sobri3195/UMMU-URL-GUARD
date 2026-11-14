// Self-contained integration check: starts actual FastAPI + Vite, stops/restarts
// only its own backend, and verifies browser connectivity without mocked health.
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { mkdirSync } = require("node:fs");
const python = process.env.PYTHON || "python3";
const host = "http://127.0.0.1:5174";
const target = "http://127.0.0.1:18001";
const services = [];
let browser;

function start(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.logs = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      child.logs = (child.logs + chunk.toString()).slice(-5000);
    });
  child.on("error", (error) => {
    child.failure = error;
  });
  services.push(child);
  return child;
}
function backend() {
  return start(
    python,
    [
      "-m",
      "uvicorn",
      "api.index:app",
      "--host",
      "127.0.0.1",
      "--port",
      "18001",
      "--no-access-log",
    ],
    { ALLOWED_ORIGINS: host },
  );
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid)
    return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 4000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}
async function ready(child, url) {
  for (let i = 0; i < 100; i++) {
    if (child.failure || child.exitCode !== null)
      throw new Error(`${url} service failed: ${child.failure || child.logs}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${url} not ready: ${child.logs}`);
}
(async () => {
  // Refuse to interfere with any existing services on the dedicated test ports.
  for (const url of [host, target + "/api/health"]) {
    let occupied = false;
    try {
      await fetch(url, { signal: AbortSignal.timeout(500) });
      occupied = true;
    } catch {}
    assert.equal(
      occupied,
      false,
      `${url} is already occupied; stop it or change test ports.`,
    );
  }
  let api = backend();
  await ready(api, target + "/api/health");
  const vite = start(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "5174",
      "--strictPort",
    ],
    { API_PROXY_TARGET: target },
  );
  await ready(vite, host);
  const direct = await fetch(target + "/api/health");
  assert.equal(direct.status, 200);
  const health = await direct.json();
  assert.equal(health.status, "ok");
  assert.equal(health.backend, "fastapi");
  assert.equal(health.app_version, "1.0.1");
  assert.equal(
    (await fetch(host + "/api/health")).headers.get("cache-control"),
    "no-store",
  );
  for (const path of ["/api", "/api/unknown/nested"]) {
    const response = await fetch(host + path);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).detail, "Not Found");
  }
  assert.match(
    (await fetch(host + "/dashboard")).headers.get("content-type"),
    /text\/html/,
  );
  const preflight = await fetch(target + "/api/features", {
    method: "OPTIONS",
    headers: {
      Origin: host,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  });
  assert.equal(preflight.headers.get("access-control-allow-origin"), host);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(host);
  await page.getByText("Backend connected", { exact: true }).waitFor();
  await page.getByText("Model not available", { exact: true }).waitFor();
  assert.match(
    await page.locator("#connection-detail").innerText(),
    /FastAPI responded.*1\.0\.1/,
  );
  assert.match(
    await page.locator("#connection-time").innerText(),
    /Last checked:/,
  );
  const featureURL = "https://example.com/login?q=123";
  const featureResponse = await page.evaluate(async (url) => {
    const api = await import("/src/utils/api.js");
    return api.post("/features", { url });
  }, featureURL);
  assert.equal(featureResponse.features.url_length, featureURL.length);
  assert.equal(featureResponse.features.digit_count, 3);
  await page.goto(host + "/#features");
  await page.locator("#url").fill(featureURL);
  await page.getByRole("button", { name: "Extract features" }).click();
  await page.getByRole("cell", { name: "url_length", exact: true }).waitFor();
  const lengthRow = page.locator("tr").filter({
    has: page.getByRole("cell", { name: "url_length", exact: true }),
  });
  assert.equal(
    await lengthRow.locator("td").nth(1).innerText(),
    String(featureURL.length),
  );
  await page.goto(host + "/#dashboard");
  await page.getByText("Backend connected", { exact: true }).waitFor();
  await stop(api);
  // No reload or manual button: the scheduled live check must notice real outage.
  await page
    .getByText("Python API unavailable", { exact: true })
    .waitFor({ timeout: 23000 });
  await page.getByText("Model status unknown", { exact: true }).waitFor();
  await page.goto(host + "/#features");
  await page.locator("#url").fill(featureURL);
  await page.getByRole("button", { name: "Extract features" }).click();
  await page.waitForFunction(() =>
    /FastAPI|Python API/.test(document.querySelector("#feedback").textContent),
  );
  const coldPage = await context.newPage();
  await coldPage.goto(host);
  await coldPage.getByText("Python API unavailable", { exact: true }).waitFor();
  assert.equal(
    await coldPage.getByText("Backend connected", { exact: true }).count(),
    0,
  );
  await coldPage.close();
  api = backend();
  await ready(api, target + "/api/health");
  await page.bringToFront();
  await page.goto(host + "/#dashboard");
  await page
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await page.getByText("Backend connected", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/foundation-connected.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Foundation integration PASSED: real health/features through Vite, valid JSON/version, API 404 vs SPA, CORS, scheduled outage detection, cold-load failure, feature error, backend recovery, mobile layout, zero page errors.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    for (const child of services.reverse()) await stop(child);
  });
