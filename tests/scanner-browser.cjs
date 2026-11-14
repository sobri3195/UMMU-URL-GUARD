// Real browser -> Vite -> production API/scanner; only outbound DNS/HEAD is mocked.
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const python = process.env.PYTHON || "python3";
const host = "http://127.0.0.1:5175";
const target = "http://127.0.0.1:18002";
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
      "scanner_fixture:app",
      "--app-dir",
      "tests",
      "--host",
      "127.0.0.1",
      "--port",
      "18002",
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
  for (const url of [host, target + "/api/health"]) {
    let occupied = false;
    try {
      await fetch(url, { signal: AbortSignal.timeout(500) });
      occupied = true;
    } catch {}
    assert.equal(occupied, false, `${url} test port is occupied`);
  }
  const api = backend();
  await ready(api, target + "/api/health");
  const vite = start(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "5175",
      "--strictPort",
    ],
    { API_PROXY_TARGET: target },
  );
  await ready(vite, host);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [],
    external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith(host + "/")) external.push(request.url());
  });
  await page.goto(host + "/#scanner");
  await page.getByText("Backend connected", { exact: true }).waitFor();
  async function scan(url, expected) {
    await page.locator("#url").fill(url);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url() === host + "/api/scan" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Scan URL", exact: true }).click();
    if (url.includes("bit.ly"))
      await page.locator('#result[aria-busy="true"]').waitFor();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    const payload = await response.json();
    assert.equal(payload.online.status, expected);
    await page
      .getByRole("heading", { name: `Online check: ${expected}`, exact: true })
      .waitFor();
    await page
      .getByRole("heading", {
        name: "Prediction unavailable — model not trained",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.locator("#lexical-result tbody tr").count(),
      Object.keys(payload.features).length,
    );
    return payload;
  }
  const resolved = await scan("https://bit.ly/start", "complete");
  assert.equal(resolved.online.final_domain, "gooogle.com");
  assert.equal(resolved.online.redirect_count, 1);
  assert.equal(resolved.online.chain.length, 2);
  await page
    .getByRole("cell", { name: "gooogle.com / google.com", exact: true })
    .waitFor();
  const history = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ummu_url_guard_history")),
  );
  assert.equal(history[0].url, "https://bit.ly/[redacted]");
  await scan("http://169.254.169.254/latest", "blocked");
  const failed = await scan("https://error.example.com", "http_error");
  assert.equal(failed.online.http_status, 503);
  const limited = await scan("https://no-head.example.com", "limited");
  assert.equal(limited.online.http_status, 405);
  const redirect = await scan("https://redirect.example.com", "blocked");
  assert.equal(redirect.online.final_url, null);
  const dns = await scan("https://no-dns.example.com", "unavailable");
  assert.equal(dns.online.reason_code, "dns_failure");
  const timeout = await scan("https://slow.example.com", "unavailable");
  assert.equal(timeout.online.reason_code, "timeout");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(await page.locator("#url").inputValue(), "");
  assert.equal(await page.locator("#result").innerText(), "");
  await page.locator("[name=online]").uncheck();
  await page.locator("#url").fill("https://googel.com/login");
  await page.getByRole("button", { name: "Scan URL", exact: true }).click();
  await page
    .getByRole("heading", { name: "Online check: not requested", exact: true })
    .waitFor();
  await page
    .getByRole("cell", { name: "transposition", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "Scanner browser PASSED: actual POST /api/scan, loading, real Python features and typo analysis, mocked public redirect success, blocked metadata/private redirect, HTTP 503, limited HEAD, DNS failure, timeout, no-model lexical analysis, masked history, clear, offline mode, mobile, no target browser navigation.",
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
