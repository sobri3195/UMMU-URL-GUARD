import { upload } from "../utils/api.js";
import { download, saveExperiment } from "../utils/storage.js";
import { bindForm, notice, table } from "../utils/ui.js";
import { chooseFile, fileInput } from "./dataset.js";
export function render(ctx) {
  ctx.view.innerHTML = `<article class="panel"><h2>Reproducible model training</h2><p>Fit Random Forest, Logistic Regression, and Decision Tree for both basic and extended features. Train / validation / test groups target 70 / 15 / 15%. Related registered domains stay together. At least 20 domain groups and both classes in every split are required.</p><form id="train-form">${fileInput}<p class="muted">${ctx.file ? "The dataset selected on Dataset Management will be reused if no new file is chosen." : "Upload your own labeled dataset. No training data is bundled."}</p><div class="form-grid"><label>Random seed<input name="seed" type="number" min="0" max="2147483617" value="42" required></label><label>RF estimators<input name="estimators" type="number" min="20" max="150" value="100" required></label></div><p class="muted">max_depth: 16 · min_samples_split: 2 · min_samples_leaf: 1 · class_weight: balanced · n_jobs: 1</p><button type="submit">Start training</button></form><p id="feedback" class="error" role="alert"></p><div id="result"></div></article>${notice("Online training is a temporary experiment. It never replaces the deployed model. For permanent inference: train locally, review the artifacts, and redeploy.")}`;
  bindForm("train-form", async (data) => {
    const output = document.getElementById("result");
    const file = chooseFile(data, ctx);
    ctx.file = file;
    const report = await upload(
      `/train?seed=${Number(data.get("seed"))}&n_estimators=${Number(data.get("estimators"))}`,
      file,
    );
    ctx.report = report;
    const saved = saveExperiment(report);
    output.innerHTML = `<h3>Training completed</h3>${table(
      ["Partition", "Rows", "Domain groups"],
      Object.entries(report.split).map(([name, split]) => [
        name,
        split.rows,
        split.groups,
      ]),
    )}<p>${report.split_policy}</p><p>${report.selection_policy}</p><div class="actions"><a class="button" href="#evaluation">Evaluate model</a><a class="button secondary" href="#experiments">Compare feature sets</a><button class="secondary" id="export-training">Export results</button></div>${notice(saved ? "Aggregate experiment summary saved locally. Curves and row-level errors are kept only in this session." : "Browser storage unavailable. Export results before leaving.")}`;
    document.getElementById("export-training").onclick = () =>
      download("experiment.json", report);
    ctx.refreshStatus();
  });
}
