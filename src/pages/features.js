import { post } from "../utils/api.js";
import { download, toCSV } from "../utils/storage.js";
import { bindForm, table, urlForm } from "../utils/ui.js";
export function render(ctx) {
  ctx.view.innerHTML = `<article class="panel"><h2>Feature extraction</h2><p>All values are computed by Python, using the same versioned definitions as model training.</p>${urlForm("features-form", "Extract features")}</article>`;
  bindForm("features-form", async (data) => {
    const output = document.getElementById("result");
    const result = await post("/features", { url: data.get("url") });
    const importance =
      ctx.report?.reports.find(
        (r) => r.model_name === "Random Forest" && r.feature_set === "extended",
      )?.feature_importance || {};
    const rows = Object.entries(result.features).map(([name, value]) => ({
      feature: name,
      value,
      type: Number.isInteger(value) ? "integer" : "float",
      description: result.definitions[name],
      rf_importance: importance[name] ?? "N/A",
    }));
    output.innerHTML = `<h3>Schema: ${result.schema_version}</h3>${table(["Feature", "Value", "Type", "Definition", "Experiment RF importance"], rows.map(Object.values))}<button id="export-features" class="secondary">Export features CSV</button>`;
    document.getElementById("export-features").onclick = () =>
      download("features.csv", toCSV(rows), "text/csv;charset=utf-8");
  });
}
