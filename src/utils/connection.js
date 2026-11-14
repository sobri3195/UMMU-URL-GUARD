import { when } from "./ui.js";

export function connectionPanel() {
  return `<section class="panel connection-panel" aria-labelledby="connection-title"><div><h2 id="connection-title">Backend connection</h2><p id="connection-detail" role="status" aria-live="polite">Checking Python API…</p><p id="connection-time" class="muted"></p></div><button type="button" id="check-backend" class="secondary">Check connection</button></section>`;
}

export function showConnection(state) {
  const badge = document.getElementById("backend-status");
  const model = document.getElementById("model-status");
  const detail = document.getElementById("connection-detail");
  const time = document.getElementById("connection-time");
  const button = document.getElementById("check-backend");
  const connected = state.connection === "connected";
  badge.textContent = connected
    ? "Backend connected"
    : state.connection === "checking"
      ? "Checking Python API…"
      : "Python API unavailable";
  badge.dataset.state = state.connection;
  model.textContent = connected
    ? state.health.model_available
      ? "Production model available"
      : "Model not available"
    : "Model status unknown";
  if (detail) {
    detail.textContent = connected
      ? `FastAPI responded with valid health JSON · app ${state.health.app_version}.`
      : state.error || "Waiting for a valid health response from FastAPI.";
    // All server/network messages are displayed as text, never markup.
    time.textContent = state.checkedAt
      ? `Last checked: ${when(state.checkedAt)}. Rechecks every 15 seconds while this tab is visible.`
      : "No completed backend check yet.";
  }
  if (button) button.disabled = state.checking;
}
