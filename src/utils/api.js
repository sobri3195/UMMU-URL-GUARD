export class APIError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}
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
  if (path === "/features" || path === "/scan" || path === "/predict") {
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
  if (path === "/predict" || path === "/scan") {
    const available = data.model_status === "available";
    if (
      !["available", "unavailable"].includes(data.model_status) ||
      !Number.isFinite(Date.parse(data.prediction_timestamp)) ||
      (available
        ? !["phishing", "benign"].includes(data.prediction) ||
          !nonempty(data.model_version) ||
          typeof data.probability !== "number" ||
          !Number.isFinite(data.probability) ||
          data.probability < 0 ||
          data.probability > 1
        : data.prediction !== null ||
          data.probability !== null ||
          data.model_version !== null)
    ) {
      throw new Error("Invalid model prediction response from the Python API.");
    }
  }
  if (["/train", "/evaluate", "/experiment"].includes(path)) {
    const metrics = [
      "accuracy",
      "precision",
      "recall",
      "f1",
      "roc_auc",
      "pr_auc",
    ];
    if (
      !nonempty(data.experiment_id) ||
      !nonempty(data.feature_fingerprint) ||
      !isObject(data.dataset) ||
      !nonempty(data.dataset.sha256) ||
      !Array.isArray(data.reports) ||
      data.reports.length !== 6 ||
      !data.reports.every(isObject) ||
      new Set(data.reports.map((row) => `${row.model_name}|${row.feature_set}`))
        .size !== 6 ||
      data.reports.some(
        (row) =>
          !["Random Forest", "Logistic Regression", "Decision Tree"].includes(
            row.model_name,
          ) ||
          !["basic", "extended"].includes(row.feature_set) ||
          !isObject(row.test) ||
          metrics.some((key) =>
            row.test[key] === null
              ? !nonempty(row.test.metric_reasons?.[key])
              : typeof row.test[key] !== "number" ||
                !Number.isFinite(row.test[key]) ||
                row.test[key] < 0 ||
                row.test[key] > 1,
          ),
      )
    ) {
      throw new Error(
        "Invalid experiment response from the Python API; no training success can be confirmed.",
      );
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
      throw new APIError(
        `API returned HTTP ${response.status} without JSON. Check FastAPI and /api routing; a frontend HTML page is not an API response.`,
        response.status,
      );
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`API returned malformed JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new APIError(
        `API HTTP ${response.status}: ${typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail ?? "Request failed")}`,
        response.status,
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
