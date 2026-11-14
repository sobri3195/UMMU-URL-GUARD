const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.length > 0;

function validateResponse(path, data) {
  if (!isObject(data))
    throw new Error("Invalid API response: expected a JSON object.");
  if (path === "/health") {
    if (
      data.status !== "ok" ||
      data.backend !== "fastapi" ||
      !nonempty(data.app_version) ||
      typeof data.model_available !== "boolean" ||
      data.model_status !==
        (data.model_available ? "available" : "unavailable") ||
      !(data.model_version === null || nonempty(data.model_version)) ||
      (data.model_available && !nonempty(data.model_version)) ||
      !(
        data.report === undefined ||
        data.report === null ||
        (isObject(data.report) && Array.isArray(data.report.reports))
      )
    ) {
      throw new Error(
        "Invalid health response from the Python API. Check backend version and API routing.",
      );
    }
  }
  if (path === "/features" || path === "/scan") {
    if (
      !nonempty(data.url) ||
      !nonempty(data.schema_version) ||
      !isObject(data.features) ||
      !Object.keys(data.features).length ||
      !isObject(data.definitions) ||
      Object.entries(data.features).some(
        ([key, value]) =>
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          !nonempty(data.definitions[key]),
      )
    ) {
      throw new Error("Invalid feature response from the Python API.");
    }
  }
  if (path === "/scan") {
    const online = data.online;
    if (
      !isObject(online) ||
      !["complete", "blocked", "unavailable", "limited", "http_error"].includes(
        online.status,
      ) ||
      !Array.isArray(online.chain) ||
      online.chain.length > 6 ||
      !Number.isInteger(online.redirect_count) ||
      online.redirect_count < 0 ||
      online.redirect_count > 5 ||
      !(
        online.http_status === null ||
        (Number.isInteger(online.http_status) &&
          online.http_status >= 100 &&
          online.http_status <= 599)
      ) ||
      !isObject(data.typosquatting)
    ) {
      throw new Error("Invalid online scan response from the Python API.");
    }
  }
  return data;
}

export async function request(path, options = {}) {
  if (typeof path !== "string" || !/^\/[a-z][a-z0-9/-]*(?:\?.*)?$/.test(path)) {
    throw new Error("API path must be a relative endpoint such as /health.");
  }
  const { timeoutMs = 55000, signal: callerSignal, ...fetchOptions } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("API timeout must be a positive number.");
  const controller = new AbortController();
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(`/api${path}`, {
        ...fetchOptions,
        cache: "no-store",
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(
        "Cannot reach the Python API. Start FastAPI or check the Vite proxy and network connection.",
      );
    }
    const type = response.headers.get("content-type") || "";
    if (!/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(type)) {
      throw new Error(
        `API returned HTTP ${response.status} without JSON. Check FastAPI and /api routing; a frontend HTML page is not an API response.`,
      );
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`API returned malformed JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new Error(
        `API HTTP ${response.status}: ${typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail ?? "Request failed")}`,
      );
    }
    return validateResponse(path.split("?")[0], data);
  } catch (error) {
    if (controller.signal.aborted) {
      const localHint = /^\/(train|evaluate|experiment)(?:\?|$)/.test(path)
        ? " Use python -m ml.train_local for longer experiments."
        : " Check that FastAPI is running and the proxy target is correct.";
      throw new Error(
        `Python API request timed out after ${timeoutMs / 1000} seconds.${localHint}`,
      );
    }
    if (callerSignal?.aborted) throw new Error("API request cancelled.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function getHealth(options = {}) {
  return request("/health", { timeoutMs: 4000, ...options });
}
export function post(path, data, options = {}) {
  return request(path, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
export function upload(path, file, options = {}) {
  const body = new FormData();
  body.append("file", file);
  return request(path, { ...options, method: "POST", body });
}
