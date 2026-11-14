const { spawn } = require("node:child_process");
const { once } = require("node:events");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
function processTools() {
  const services = [];
  function start(command, args, env = {}) {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.logs = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on(
        "data",
        (chunk) => (child.logs = (child.logs + chunk).slice(-4000)),
      );
    child.on("error", (error) => (child.failure = error));
    services.push(child);
    return child;
  }
  async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid)
      return;
    const done = once(child, "exit");
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
    try {
      await done;
    } finally {
      clearTimeout(timer);
    }
  }
  async function close() {
    for (const child of services.reverse()) await stop(child);
  }
  async function ready(child, url) {
    for (let i = 0; i < 100; i++) {
      if (child.failure || child.exitCode !== null)
        throw Error(child.logs || String(child.failure));
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    throw Error("Service not ready: " + url + " " + child.logs);
  }
  return { start, close, ready };
}
async function portsFree(urls) {
  for (const url of urls) {
    let used = false;
    try {
      await fetch(url, { signal: AbortSignal.timeout(500) });
      used = true;
    } catch {}
    assert.equal(used, false, "Test port occupied: " + url);
  }
}
module.exports = { processTools, portsFree, chromium };
