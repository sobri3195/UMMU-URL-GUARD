export const KEYS = {
  history: "ummu_url_guard_history",
  settings: "ummu_url_guard_settings",
  experiments: "ummu_url_guard_experiment_summaries",
};
export function read(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}
export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function maskURL(value) {
  try {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol)) return "[redacted URL]";
    return `${u.protocol}//${u.host}/[redacted]`;
  } catch {
    return "[redacted URL]";
  }
}
export const HISTORY_LIMIT = 200;
export const HISTORY_BYTES = 512000;
const number = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
function record(row) {
  if (!row || typeof row.id !== "string" || typeof row.url !== "string")
    return null;
  const details = row.details || {};
  return {
    id: row.id.slice(0, 120),
    url: maskURL(row.url),
    prediction: ["phishing", "benign"].includes(row.prediction)
      ? row.prediction
      : null,
    probability: number(row.probability),
    online_status: String(row.online_status || "not requested").slice(0, 40),
    redirect_count: number(row.redirect_count) ?? 0,
    timestamp: String(row.timestamp || "").slice(0, 40),
    model_version: row.model_version
      ? String(row.model_version).slice(0, 120)
      : null,
    shortener: row.shortener === true,
    typo: row.typo === true,
    details: {
      final_url: details.final_url ? maskURL(details.final_url) : null,
      http_status: number(details.http_status),
      response_ms: number(details.response_ms),
      reason_code: /^[a-z_]{1,64}$/.test(details.reason_code)
        ? details.reason_code
        : null,
      features: Object.fromEntries(
        Object.entries(details.features || {})
          .slice(0, 32)
          .filter(
            ([key, value]) =>
              /^[a-z_]{1,64}$/.test(key) && number(value) !== null,
          ),
      ),
      chain: Array.isArray(details.chain)
        ? details.chain.slice(0, 6).map((hop) => ({
            url: maskURL(hop?.url),
            http_status: number(hop?.http_status),
          }))
        : [],
    },
  };
}
export function history() {
  const rows = read(KEYS.history, []);
  return Array.isArray(rows)
    ? rows.map(record).filter(Boolean).slice(0, HISTORY_LIMIT)
    : [];
}
export function saveScan(scan, id = crypto.randomUUID()) {
  const item = record({
    id,
    url: scan.url,
    prediction: scan.prediction,
    probability: scan.probability,
    online_status: scan.online?.status ?? "not requested",
    redirect_count: scan.online?.redirect_count ?? 0,
    timestamp:
      scan.timestamp ?? scan.prediction_timestamp ?? new Date().toISOString(),
    model_version: scan.model_version,
    shortener: Boolean(scan.shortener_provider),
    typo: Boolean(
      scan.typosquatting?.indicator ||
      scan.final_destination?.typosquatting?.indicator,
    ),
    details: {
      final_url: scan.online?.final_url,
      http_status: scan.online?.http_status,
      response_ms: scan.online?.response_ms,
      reason_code: scan.online?.reason_code,
      features: scan.features,
      chain: scan.online?.chain,
    },
  });
  if (!item) return false;
  const rows = [item, ...history().filter((row) => row.id !== id)].slice(
    0,
    HISTORY_LIMIT,
  );
  while (
    rows.length > 1 &&
    new TextEncoder().encode(JSON.stringify(rows)).length > HISTORY_BYTES
  )
    rows.pop();
  if (new TextEncoder().encode(JSON.stringify(rows)).length > HISTORY_BYTES)
    return false;
  return write(KEYS.history, rows);
}
export function removeScan(id) {
  return write(
    KEYS.history,
    history().filter((row) => row.id !== id),
  );
}
export function clearHistory() {
  try {
    if (localStorage.removeItem) {
      localStorage.removeItem(KEYS.history);
      return true;
    }
  } catch {
    return false;
  }
  return write(KEYS.history, []);
}
export function historyExport(rows) {
  return rows.map((row) => ({
    id: row.id,
    url: maskURL(row.url),
    prediction: row.prediction,
    probability: row.probability,
    timestamp: row.timestamp,
    online_status: row.online_status,
    redirect_count: row.redirect_count,
    model_version: row.model_version,
    final_url: row.details?.final_url,
    http_status: row.details?.http_status,
  }));
}
export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function toCSV(rows) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  return [
    keys.map(csvCell).join(","),
    ...rows.map((row) => keys.map((k) => csvCell(row[k])).join(",")),
  ].join("\r\n");
}
export function download(name, value, type = "application/json") {
  const blob = new Blob(
    [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
    { type },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function saveExperiment(report) {
  // Store only bounded summaries, never uploaded datasets or row-level errors.
  const compact = {
    ...Object.fromEntries(
      [
        "experiment_id",
        "model_version",
        "evaluated_at",
        "duration_ms",
        "seed",
        "split_seed",
        "schema_version",
        "feature_fingerprint",
        "feature_provenance",
        "runtime_versions",
        "split",
        "split_details",
        "split_policy",
        "split_membership_sha256",
        "selection_policy",
        "production_model",
        "references",
        "keywords",
        "shorteners",
        "config",
      ]
        .filter((key) => key in report)
        .map((key) => [key, report[key]]),
    ),
    dataset: report.dataset
      ? Object.fromEntries(
          [
            "name",
            "sha256",
            "normalized_sha256",
            "records",
            "raw_records",
            "duplicates_removed",
            "missing_values",
            "classes",
            "registered_domain_groups",
          ]
            .filter((key) => key in report.dataset)
            .map((key) => [key, report.dataset[key]]),
        )
      : undefined,
    aggregate_only: true,
    reports: report.reports.map(({ errors, ...row }) => ({
      ...row,
      validation: { ...row.validation, roc: null, pr: null },
      test: { ...row.test, roc: null, pr: null },
    })),
  };
  if (new TextEncoder().encode(JSON.stringify(compact)).length > 160000)
    return false;
  return write(KEYS.experiments, [compact]);
}

export function loadExperiment() {
  const values = read(KEYS.experiments, []);
  const value = Array.isArray(values) ? values[0] : null;
  if (
    !value ||
    typeof value.experiment_id !== "string" ||
    !value.dataset ||
    !Array.isArray(value.reports) ||
    value.reports.length !== 6
  )
    return null;
  if (
    !value.split ||
    ["train", "validation", "test"].some((key) => !value.split[key]?.classes)
  )
    return null;
  const keys = new Set();
  for (const row of value.reports) {
    if (
      !row ||
      !["Random Forest", "Logistic Regression", "Decision Tree"].includes(
        row.model_name,
      ) ||
      !["basic", "extended"].includes(row.feature_set) ||
      !row.test ||
      !Array.isArray(row.test.confusion_matrix) ||
      row.test.confusion_matrix.length !== 2
    )
      return null;
    if (
      row.test.confusion_matrix.some(
        (values) =>
          !Array.isArray(values) ||
          values.length !== 2 ||
          values.some((number) => !Number.isInteger(number) || number < 0),
      )
    )
      return null;
    keys.add(`${row.model_name}|${row.feature_set}`);
    if (
      ["accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc"].some(
        (key) =>
          row.test[key] !== null &&
          (number(row.test[key]) === null ||
            row.test[key] < 0 ||
            row.test[key] > 1),
      )
    )
      return null;
  }
  return keys.size === 6 ? value : null;
}
