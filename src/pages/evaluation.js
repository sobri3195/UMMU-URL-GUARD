import { table, pct, notice, escape } from "../utils/ui.js";
import { curve } from "../utils/charts.js";
import { MODELS } from "./research.js";
export function metricRows(report) {
  return report.reports.map((row) => [
    row.model_name,
    row.feature_set,
    ...["accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc"].map(
      (key) =>
        row.test[key] == null
          ? `N/A — ${row.test.metric_reasons?.[key] || "Not available"}`
          : pct(row.test[key]),
    ),
    row.selected_on_validation ? "Yes" : "No",
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
    ctx.view.innerHTML =
      notice(
        "No evaluation data. Upload a labeled dataset and run Model Training.",
      ) + '<a class="button" href="#training">Open Model Training</a>';
    return;
  }
  const report = ctx.report,
    model = ctx.state.config.model,
    scenario = ctx.state.evaluation.scenario;
  const row = report.reports.find(
    (row) => row.model_name === model && row.feature_set === scenario,
  );
  if (!row) {
    ctx.view.innerHTML = notice(
      "This stored report does not contain the selected model/scenario.",
    );
    return;
  }
  const matrix = row.test.confusion_matrix;
  ctx.view.innerHTML = `<article class="panel"><h2>Held-out model evaluation</h2><p>Experiment ${escape(report.experiment_id)} · ${escape(report.dataset.name)} · Positive class: phishing. Scores describe this dataset only.</p><div class="form-grid"><label>Model<select id="evaluate-model" aria-label="Model">${MODELS.map((name) => `<option ${name === model ? "selected" : ""}>${name}</option>`).join("")}</select></label><label>Feature set<select id="evaluate-scenario" aria-label="Feature set"><option value="basic">Basic features</option><option value="extended">Extended features</option></select></label></div>${table(metricHeaders, metricRows(report))}<h3>${escape(model)} — ${escape(scenario)} features</h3>${table(
    ["Actual / predicted", "Benign", "Phishing"],
    [
      ["Benign", ...matrix[0]],
      ["Phishing", ...matrix[1]],
    ],
  )}<p class="muted">PR-AUC means average precision. Probabilities are uncalibrated model estimates. Testing never fits preprocessing or selects hyperparameters.</p><h3>Partition class distribution</h3>${table(
    ["Split", "Benign", "Phishing"],
    Object.entries(report.split).map(([name, value]) => [
      name,
      value.classes.benign,
      value.classes.phishing,
    ]),
  )}</article><div class="chart-grid"><article class="panel"><h3>ROC · x: FPR / y: TPR</h3>${row.test.roc ? '<div class="chart"><canvas id="roc" aria-label="Actual ROC curve"></canvas></div>' : notice(row.test.metric_reasons?.roc_auc || "Curve points were not stored in this aggregate summary. Rerun with your CSV to obtain actual curves.")}</article><article class="panel"><h3>Precision–recall · x: recall / y: precision</h3>${row.test.pr ? '<div class="chart"><canvas id="pr" aria-label="Actual precision-recall curve"></canvas></div>' : notice(row.test.metric_reasons?.pr_auc || "Curve points were not stored in this aggregate summary.")}</article></div>`;
  if (row.test.roc) curve("roc", row.test.roc.fpr, row.test.roc.tpr, "ROC");
  if (row.test.pr)
    curve("pr", row.test.pr.recall, row.test.pr.precision, "Precision–recall");
  document.getElementById("evaluate-scenario").value = scenario;
  document.getElementById("evaluate-scenario").onchange = (event) => {
    ctx.state.evaluation.scenario = event.target.value;
    ctx.render();
  };
  document.getElementById("evaluate-model").onchange = (event) => {
    ctx.state.config.model = event.target.value;
    ctx.render();
  };
}
