import { notice, table, pct } from "../utils/ui.js";
import { chart } from "../utils/charts.js";
import { metricRows, metricHeaders } from "./evaluation.js";
import {
  controls,
  bindControls,
  resultSummary,
  bindExport,
} from "./research.js";
export function render(ctx) {
  const rows =
    ctx.report?.reports.filter(
      (row) => row.model_name === ctx.state.config.model,
    ) || [];
  ctx.view.innerHTML = `<article class="panel"><h2>Compare basic and extended features</h2><p>A: seven basic lexical features. B: extended features including entropy, shortener and fixed reference-domain similarity. Both scenarios use identical domain-separated splits. Additional features may reduce performance.</p>${controls(ctx, "/experiment", "Run Experiment")}</article>${
    ctx.report
      ? `<article class="panel"><h3>${ctx.state.config.model} — feature comparison</h3>${table(
          ["Feature set", "Accuracy", "F1", "Recall", "PR-AUC"],
          rows.map((row) => [
            row.feature_set,
            ...["accuracy", "f1", "recall", "pr_auc"].map((key) =>
              pct(row.test[key]),
            ),
          ]),
        )}<h3>All model / feature combinations</h3>${table(metricHeaders, metricRows(ctx.report))}${resultSummary(ctx)}</article><div class="chart-grid">${["Accuracy", "F1", "Recall", "PR-AUC"].map((name, i) => `<article class="panel"><h3>${name}</h3><div class="chart"><canvas id="exp-${i}" aria-label="${name} feature comparison"></canvas></div></article>`).join("")}</div>`
      : notice(
          "No feature experiment has been run. Use Run Experiment with a labeled CSV; no comparison numbers are preloaded.",
        )
  }`;
  bindControls(ctx, "/experiment");
  bindExport(ctx);
  if (ctx.report)
    ["accuracy", "f1", "recall", "pr_auc"].forEach((key, i) =>
      chart(
        `exp-${i}`,
        rows.map((row) => row.feature_set),
        rows.map((row) => row.test[key]),
        "bar",
        key,
      ),
    );
  document.querySelector('[name="model"]').onchange = (event) => {
    ctx.state.config.model = event.target.value;
    ctx.render();
  };
}
