// Shared real /train and /experiment controls; the backend always fits all 3 families.
import { download } from "../utils/storage.js";
import { selectFile, runResearch } from "../utils/workspace.js";
import { bindForm, escape, notice, table } from "../utils/ui.js";
import { chooseFile, fileInput } from "./dataset.js";
export const MODELS = ["Random Forest", "Logistic Regression", "Decision Tree"];
export function controls(ctx, endpoint, label) {
  const config = ctx.state.config,
    unsupported = ctx.unsupported.has(endpoint);
  return `<form id="research-form">${fileInput}<p id="research-selected-file" class="muted">${ctx.file ? `Selected in memory: ${escape(ctx.file.name)}. Choose a new file to replace it.` : "No dataset selected. Upload a provenance-reviewed CSV; files are not retained across refresh."}</p><div class="form-grid"><label>Result model<select name="model" aria-label="Result model">${MODELS.map((model) => `<option ${config.model === model ? "selected" : ""}>${model}</option>`).join("")}</select></label><label>Random seed<input name="seed" type="number" min="0" max="2147483617" value="${config.seed}" required></label><label>RF estimators<input name="estimators" type="number" min="20" max="150" value="${config.estimators}" required></label><label>RF depth selection<input value="8 / 16 — selected by validation F1" disabled aria-describedby="fixed-training-policy"></label></div><p id="fixed-training-policy" class="muted">Result model selects what to inspect; the backend always trains Random Forest, Logistic Regression, and Decision Tree on both feature sets. Split targets 70/15/15 by domain groups, min_samples_split 2, min_samples_leaf 1, class_weight balanced, n_jobs 1. Editing depth/split is unsupported by this API and intentionally disabled.</p><button type="submit" ${ctx.job || unsupported ? "disabled" : ""}>${label}</button></form><p id="feedback" class="error" role="alert">${escape(ctx.researchError || "")}</p>${ctx.job ? notice(`Experiment running for ${ctx.job.datasetName}. Waiting for actual backend results; no progress percentage is available.`) : ""}${unsupported ? notice("This backend does not support this online action. Use local training. Retry after the backend is updated; retry resubmits the selected CSV.", "warning") : ""}${ctx.researchError || unsupported ? '<div class="notice"><p>For large datasets, timeouts, or unsupported online training:</p><code>python -m ml.train_local --dataset /path/to/dataset.csv</code></div>' : ""}${unsupported ? '<button type="button" id="retry-online" class="secondary">Retry online action</button>' : ""}`;
}
export function bindControls(ctx, endpoint) {
  const form = document.getElementById("research-form");
  form.elements.file.onchange = (event) => {
    try {
      const file = selectFile(ctx, event.target.files[0]);
      document.getElementById("research-selected-file").textContent = file
        ? `Selected in memory: ${file.name}`
        : "No dataset selected.";
    } catch (error) {
      document.getElementById("feedback").textContent = error.message;
      document.getElementById("research-selected-file").textContent =
        "No valid dataset selected.";
    }
  };
  for (const name of ["seed", "estimators", "model"])
    form.elements[name].onchange = () => {
      ctx.state.config[name] =
        name === "model"
          ? form.elements[name].value
          : Number(form.elements[name].value);
    };
  bindForm("research-form", async (data) => {
    const file = chooseFile(data, ctx);
    ctx.state.config = {
      model: data.get("model"),
      seed: Number(data.get("seed")),
      estimators: Number(data.get("estimators")),
    };
    await runResearch(ctx, endpoint, file, { ...ctx.state.config });
  });
  const retry = document.getElementById("retry-online");
  if (retry)
    retry.onclick = async () => {
      if (ctx.job) return;
      if (!ctx.file) {
        ctx.researchError = "Select a labeled CSV first.";
        ctx.render();
        return;
      }
      ctx.unsupported.delete(endpoint);
      await runResearch(ctx, endpoint, ctx.file, { ...ctx.state.config });
    };
}
export function resultSummary(ctx) {
  const report = ctx.report;
  if (!report)
    return notice(
      "No experiment results yet. Training requires your own labeled dataset.",
    );
  return `<h3>${ctx.job ? "Previous completed experiment — new request running" : ctx.researchError ? "Previous completed experiment — current request failed" : "Training completed"}</h3>${table(
    ["Metadata", "Value"],
    [
      ["Dataset", report.dataset.name],
      ["Experiment / model version", report.model_version],
      ["Feature schema", report.schema_version],
      ["Split method", report.split_details?.method],
      [
        "Selected primary RF config",
        JSON.stringify(report.production_model?.config || report.config),
      ],
    ],
  )}${table(
    ["Partition", "Rows", "Domain groups", "Actual row fraction"],
    Object.entries(report.split).map(([name, value]) => [
      name,
      value.rows,
      value.groups,
      value.row_fraction == null
        ? "N/A"
        : `${(value.row_fraction * 100).toFixed(1)}%`,
    ]),
  )}<p>${escape(report.split_policy)}</p><p>${escape(report.selection_policy)}</p><div class="actions"><a class="button" href="#evaluation">Evaluate model</a><a class="button secondary" href="#analysis">Analyze results</a><button type="button" id="export-research" class="secondary">Export Results</button></div>${notice(ctx.storageNotice || (report.aggregate_only ? "Restored aggregate summary. Full curves and error rows were not stored; export original results before refreshing." : "Experiments do not replace the production model."))}`;
}
export function bindExport(ctx) {
  const button = document.getElementById("export-research");
  if (button) button.onclick = () => download("experiment.json", ctx.report);
}
