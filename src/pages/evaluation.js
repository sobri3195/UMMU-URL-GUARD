import { table, pct, notice, escape } from "../utils/ui.js";
import { curve } from "../utils/charts.js";
export function metricRows(report) {
  return report.reports.map((r) => [
    r.model_name,
    r.feature_set,
    ...["accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc"].map(
      (k) =>
        r.test[k] == null
          ? `N/A — ${r.test.metric_reasons?.[k] || "Not available"}`
          : pct(r.test[k]),
    ),
    r.selected_on_validation ? "Yes" : "No",
  ]);
}
export const metricHeaders = [
  "Model",
  "Features",
  "Accuracy",
  "Precision",
  "Recall",
  "F1",
  "ROC-AUC",
  "PR-AUC (AP)",
  "Validation selected",
];
export function render(ctx) {
  if (!ctx.report) {
    ctx.view.innerHTML = notice(
      "No evaluation data. Upload a labeled dataset and run Model Training.",
    );
    return;
  }
  const report = ctx.report;
  const rf = report.reports.find(
    (r) => r.model_name === "Random Forest" && r.feature_set === "extended",
  );
  const m = rf.test.confusion_matrix;
  ctx.view.innerHTML = `<article class="panel"><h2>Held-out model evaluation</h2><p>Experiment ${escape(report.experiment_id)} · Positive class: phishing · Identical test groups for all predeclared models.</p>${table(metricHeaders, metricRows(report))}<p class="muted">PR-AUC is reported as average precision. Scores are uncalibrated model estimates. Test data is never used to select models or fit the scaler.</p><h3>Random Forest — extended features</h3>${table(
    ["Actual / predicted", "Benign", "Phishing"],
    [
      ["Benign", ...m[0]],
      ["Phishing", ...m[1]],
    ],
  )}<h3>Partition class distribution</h3>${table(
    ["Split", "Benign", "Phishing"],
    Object.entries(report.split).map(([name, s]) => [
      name,
      s.classes.benign,
      s.classes.phishing,
    ]),
  )}</article>${rf.test.roc ? '<div class="chart-grid"><article class="panel"><h3>ROC · x: FPR / y: TPR</h3><div class="chart"><canvas id="roc"></canvas></div></article><article class="panel"><h3>Precision–recall · x: recall / y: precision</h3><div class="chart"><canvas id="pr"></canvas></div></article></div>' : notice("Curve points are session-only. Rerun the reproducible experiment to display curves.")}`;
  if (rf.test.roc) {
    curve("roc", rf.test.roc.fpr, rf.test.roc.tpr, "RF ROC");
    curve("pr", rf.test.pr.recall, rf.test.pr.precision, "RF precision–recall");
  }
}
