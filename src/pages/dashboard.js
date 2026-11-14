import { history } from "../utils/storage.js";
import { escape, pct } from "../utils/ui.js";
import { chart } from "../utils/charts.js";
export function render(ctx) {
  const rows = history();
  const accuracy = ctx.report?.reports.find(
    (r) => r.model_name === "Random Forest" && r.feature_set === "extended",
  )?.test.accuracy;
  const cards = [
    ["Total URL scanned", rows.length],
    [
      "Predicted phishing",
      rows.filter((r) => r.prediction === "phishing").length,
    ],
    ["Predicted benign", rows.filter((r) => r.prediction === "benign").length],
    ["Short URL indicators", rows.filter((r) => r.shortener).length],
    ["Typosquatting indicators", rows.filter((r) => r.typo).length],
    [
      "Experiment RF accuracy",
      accuracy == null ? "Belum ada data" : pct(accuracy),
    ],
  ];
  ctx.view.innerHTML = `<div class="welcome"><div><span class="eyebrow">RESEARCH WORKSPACE</span><h2>Understand the URL.<br>Investigate the indicators.</h2><p>Transparent features, reproducible experiments, and careful URL inspection.</p><a class="button" href="#scanner">Open URL scanner <span aria-hidden="true">→</span></a></div><div class="hero-symbol" aria-hidden="true"><svg viewBox="0 0 80 90" fill="none"><path d="M40 5 70 17v25c0 22-15 35-30 43C25 77 10 64 10 42V17L40 5Z" stroke="currentColor" stroke-width="3"/><path d="m25 43 10 10 22-23" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div><div class="stats">${cards.map(([label, value]) => `<article class="stat"><span>${escape(label)}</span><strong>${escape(value)}</strong></article>`).join("")}</div><p class="muted">Activity reflects up to 200 saved scans on this browser. Experiment accuracy is held-out research performance, not a safety guarantee.</p><div class="chart-grid">${["Prediction distribution", "Scans by day", "Short URL proportion", "Typosquatting indicators"].map((label, i) => `<article class="panel"><h3>${label}</h3><div class="chart"><canvas id="dash-${i}" aria-label="${label}"></canvas></div></article>`).join("")}</div>`;
  const counts = ["phishing", "benign", null].map(
    (p) => rows.filter((r) => r.prediction === p).length,
  );
  chart("dash-0", ["Phishing", "Benign", "Unavailable"], counts, "doughnut");
  const days = {};
  rows.forEach((row) => {
    const day = row.timestamp?.slice(0, 10);
    if (day) days[day] = (days[day] || 0) + 1;
  });
  const labels = Object.keys(days).sort();
  chart(
    "dash-1",
    labels,
    labels.map((k) => days[k]),
  );
  chart(
    "dash-2",
    ["Known shortener", "Other"],
    [
      rows.filter((r) => r.shortener).length,
      rows.filter((r) => !r.shortener).length,
    ],
    "doughnut",
  );
  chart(
    "dash-3",
    ["Indicator", "No indicator"],
    [rows.filter((r) => r.typo).length, rows.filter((r) => !r.typo).length],
    "doughnut",
  );
}
