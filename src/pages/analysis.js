import { download, toCSV } from "../utils/storage.js";
import { escape, notice, table, pct } from "../utils/ui.js";
import { metricHeaders, metricRows } from "./evaluation.js";
export function render(ctx) {
  if (!ctx.report) {
    ctx.view.innerHTML = notice(
      "No experiment source is available. Run Model Training first.",
    );
    return;
  }
  const report = ctx.report;
  const rf = report.reports.find(
    (r) => r.model_name === "Random Forest" && r.feature_set === "extended",
  );
  const ranking = Object.entries(rf.feature_importance || {}).sort(
    (a, b) => b[1] - a[1],
  );
  ctx.view.innerHTML = `<article class="panel"><h2>Research results and error analysis</h2>${table(
    ["Metadata", "Value"],
    [
      ["Experiment / model version", report.experiment_id],
      ["Dataset", report.dataset.name],
      ["Dataset SHA-256", report.dataset.sha256],
      ["Evaluation timestamp", report.evaluated_at],
      ["Requested / split seed", `${report.seed} / ${report.split_seed}`],
      ["Schema", report.schema_version],
      ["Split membership hash", report.split_membership_sha256],
    ],
  )}<div class="actions"><button id="export-json">Export JSON</button><button id="export-csv" class="secondary">Export comparison CSV</button><button id="export-summary" class="secondary">Export research summary</button></div><h3>Model comparison</h3>${table(metricHeaders, metricRows(report))}<h3>RF feature importance (impurity-based; may favor high-cardinality features)</h3>${table(
    ["Rank", "Feature", "Importance"],
    ranking.map(([name, score], i) => [i + 1, name, pct(score)]),
  )}<h3>RF false positives and false negatives</h3><p>${rf.error_count} errors on held-out data. At most 100 masked rows are shown. Paths, query strings, and fragments are redacted.</p>${
    rf.errors
      ? table(
          ["Masked URL", "Actual", "Predicted"],
          rf.errors.map((r) => [r.url, r.actual, r.predicted]),
        )
      : notice(
          "Row-level errors are session-only and are not saved to localStorage.",
        )
  }<p class="muted">${escape(report.selection_policy)} Keep reference domains fixed before experiments. Inspect dataset provenance and domain overlap with references before drawing research conclusions.</p></article>`;
  document.getElementById("export-json").onclick = () =>
    download("research-results.json", report);
  document.getElementById("export-csv").onclick = () =>
    download(
      "comparison.csv",
      toCSV(
        report.reports.map((r) => ({
          model: r.model_name,
          features: r.feature_set,
          ...Object.fromEntries(
            ["accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc"].map(
              (k) => [k, r.test[k]],
            ),
          ),
        })),
      ),
      "text/csv;charset=utf-8",
    );
  document.getElementById("export-summary").onclick = () =>
    download(
      "research-summary.txt",
      `UMMU URL GUARD research summary\nExperiment: ${report.experiment_id}\nDataset: ${report.dataset.name}\nSHA-256: ${report.dataset.sha256}\nEvaluated: ${report.evaluated_at}\nSeed: ${report.seed}; split seed: ${report.split_seed}\n${report.split_policy}\nExtended RF held-out F1: ${pct(rf.test.f1)}; recall: ${pct(rf.test.recall)}; AP: ${pct(rf.test.pr_auc)}.\nThis is dataset-specific research evidence, not a guarantee of website safety.`,
      "text/plain",
    );
}
