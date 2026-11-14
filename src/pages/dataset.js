import { upload } from "../utils/api.js";
import { download } from "../utils/storage.js";
import { bindForm, escape, table } from "../utils/ui.js";
import { chart } from "../utils/charts.js";
export const fileInput =
  '<label for="dataset-file">Labeled CSV <span class="muted">(UTF-8, up to 2 MB / 2,000 rows)</span></label><input id="dataset-file" name="file" type="file" accept=".csv,text/csv">';
export function chooseFile(data, ctx) {
  const file = data.get("file");
  const chosen = file?.size ? file : ctx.file;
  if (!chosen) throw new Error("Choose a CSV file with url,label columns.");
  if (chosen.size > 2000000)
    throw new Error("File exceeds 2 MB; use local training.");
  return chosen;
}
export function render(ctx) {
  ctx.view.innerHTML = `<article class="panel"><h2>Bring your research dataset</h2><p>Required columns: <code>url,label</code>. Labels: <code>benign</code> or <code>phishing</code>. Duplicate normalized URLs are removed; conflicting labels are rejected. Uploaded data stays in memory for this session only.</p><form id="dataset-form">${fileInput}<button type="submit">Validate dataset</button></form><p class="muted">${ctx.file ? `Selected in memory: ${escape(ctx.file.name)}` : "No dataset selected. No sample results are preloaded."}</p><p id="feedback" class="error" role="alert"></p><div id="result"></div></article>`;
  bindForm("dataset-form", async (data) => {
    const output = document.getElementById("result");
    const file = chooseFile(data, ctx);
    const result = await upload("/dataset/analyze", file);
    ctx.file = file;
    output.innerHTML = `<h3>${escape(result.name)}</h3>${table(
      ["Dataset check", "Value"],
      [
        ["Raw records", result.raw_records],
        ["Unique records", result.records],
        ["Phishing", result.classes.phishing || 0],
        ["Benign", result.classes.benign || 0],
        ["Missing values", result.missing_values],
        ["Duplicates removed", result.duplicates_removed],
        ["Domain groups", result.registered_domain_groups],
        ["Raw CSV SHA-256", result.sha256],
        ["Normalized dataset SHA-256", result.normalized_sha256],
        ["Missing value policy", result.missing_value_policy],
      ],
    )}<h3>Preview — first 8 normalized records</h3>${table(
      ["URL", "Label"],
      result.preview.map((row) => [row.url, row.label]),
    )}<div class="chart"><canvas id="class-chart"></canvas></div><button id="summary" class="secondary">Download dataset summary</button>`;
    chart(
      "class-chart",
      ["Benign", "Phishing"],
      [result.classes.benign || 0, result.classes.phishing || 0],
    );
    document.getElementById("summary").onclick = () => {
      const { preview, ...safe } = result;
      download("dataset-summary.json", safe);
    };
  });
}
