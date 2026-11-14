import { notice, table, pct } from "../utils/ui.js";
import { chart } from "../utils/charts.js";
export function render(ctx) {
  if (!ctx.report) {
    ctx.view.innerHTML = notice(
      "Run Model Training to compare basic and extended features on identical domain-separated splits.",
    );
    return;
  }
  const rows = ctx.report.reports.filter(
    (r) => r.model_name === "Random Forest",
  );
  ctx.view.innerHTML = `<article class="panel"><h2>Do extended features help?</h2><p>A: seven basic lexical features. B: the same features plus entropy, keywords, shortener, reference-domain similarity, and domain structure. Additional features may reduce performance.</p>${table(
    ["RF feature set", "Accuracy", "F1", "Recall", "PR-AUC"],
    rows.map((r) => [
      r.feature_set,
      ...["accuracy", "f1", "recall", "pr_auc"].map((k) => pct(r.test[k])),
    ]),
  )}<a class="button secondary" href="#training">Run a new controlled experiment</a></article><div class="chart-grid">${["Accuracy", "F1", "Recall", "PR-AUC"].map((name, i) => `<article class="panel"><h3>${name}</h3><div class="chart"><canvas id="exp-${i}"></canvas></div></article>`).join("")}</div>`;
  ["accuracy", "f1", "recall", "pr_auc"].forEach((key, i) =>
    chart(
      `exp-${i}`,
      rows.map((r) => r.feature_set),
      rows.map((r) => r.test[key]),
      "bar",
      key,
    ),
  );
}
