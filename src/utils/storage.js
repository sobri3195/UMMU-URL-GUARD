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
    return `${u.protocol}//${u.host}/[redacted]`;
  } catch {
    return "[redacted URL]";
  }
}
export function history() {
  const rows = read(KEYS.history, []);
  return Array.isArray(rows)
    ? rows
        .filter(
          (row) =>
            row && typeof row.id === "string" && typeof row.url === "string",
        )
        .slice(0, 200)
    : [];
}
export function saveScan(scan) {
  const item = {
    id: crypto.randomUUID(),
    url: maskURL(scan.url),
    prediction: scan.prediction,
    probability: scan.probability,
    online_status: scan.online?.status ?? "not requested",
    redirect_count: scan.online?.redirect_count ?? 0,
    timestamp: scan.timestamp ?? new Date().toISOString(),
    model_version: scan.model_version,
    shortener: Boolean(scan.shortener_provider),
    typo: Boolean(scan.typosquatting?.indicator),
  };
  return write(KEYS.history, [item, ...history()].slice(0, 200));
}
export function removeScan(id) {
  return write(
    KEYS.history,
    history().filter((row) => row.id !== id),
  );
}
export function clearHistory() {
  return write(KEYS.history, []);
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
    ...report,
    reports: report.reports.map(({ errors, ...row }) => ({
      ...row,
      validation: { ...row.validation, roc: null, pr: null },
      test: { ...row.test, roc: null, pr: null },
    })),
  };
  return write(KEYS.experiments, [compact]);
}
