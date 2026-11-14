import { post, upload } from "../utils/api.js";
import { download, maskURL } from "../utils/storage.js";
import { selectFile } from "../utils/workspace.js";
import { bindForm, escape, table } from "../utils/ui.js";
import { chart, destroyChart } from "../utils/charts.js";
export const fileInput =
  '<label for="dataset-file">Labeled CSV <span class="muted">(UTF-8, up to 2 MB / 2,000 rows)</span></label><input id="dataset-file" name="file" type="file" accept=".csv,text/csv">';
export function chooseFile(data, ctx) {
  const candidate = data.get("file");
  const selected = candidate?.name ? selectFile(ctx, candidate) : ctx.file;
  if (!selected) throw new Error("Choose a CSV file with url,label columns.");
  return selected;
}
export function render(ctx) {
  const page = ctx.page,
    state = ctx.state.dataset;
  ctx.view.innerHTML = `<article class="panel"><h2>Bring your research dataset</h2><p>Required columns: <code>url,label</code>. Labels: benign/phishing. Missing or conflicting labels are rejected; normalized duplicates are removed. Files/previews remain in memory, not localStorage.</p><form id="dataset-form">${fileInput}<button type="submit">Validate dataset</button></form><p id="selected-file" class="muted">${ctx.file ? `Selected in memory: ${escape(ctx.file.name)}` : "No dataset selected. Reselect files after a browser refresh."}</p><p id="feedback" class="error" role="alert"></p><div id="result"></div></article>`;
  const output = document.getElementById("result");
  function show() {
    if (!page.active()) return;
    destroyChart("class-chart");
    const result = state.summary;
    if (!result) {
      output.innerHTML =
        '<p class="empty">Validate a dataset to see actual statistics and preview.</p>';
      return;
    }
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
        ["Normalized SHA-256", result.normalized_sha256],
        ["Missing value policy", result.missing_value_policy],
      ],
    )}<h3>Preview — first 8 normalized records</h3>${table(
      ["URL", "Label"],
      result.preview.map((row) => [row.url, row.label]),
    )}<div class="chart"><canvas id="class-chart" aria-label="Actual class distribution"></canvas></div><div class="actions"><button type="button" id="summary" class="secondary">Download summary</button><button type="button" id="dataset-features" class="secondary">Preview features (first 3 URLs)</button></div><p id="preview-feedback" role="status"></p><div id="dataset-feature-result">${state.featurePreview.length ? previewTable(state.featurePreview) : ""}</div>`;
    chart(
      "class-chart",
      ["Benign", "Phishing"],
      [result.classes.benign || 0, result.classes.phishing || 0],
    );
    output.querySelector("#summary").onclick = () => {
      const { preview, ...safe } = result;
      download("dataset-summary.json", safe);
    };
    output.querySelector("#dataset-features").onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const feedback = output.querySelector("#preview-feedback");
      feedback.textContent = "Extracting actual Python features…";
      try {
        const values = await Promise.all(
          result.preview
            .slice(0, 3)
            .map((row) =>
              post(
                "/features",
                { url: row.url },
                { signal: page.signal, timeoutMs: 10000 },
              ),
            ),
        );
        if (!page.active()) return;
        state.featurePreview = values;
        output.querySelector("#dataset-feature-result").innerHTML =
          previewTable(values);
        feedback.textContent = "Feature preview calculated by Python.";
      } catch (error) {
        if (page.active()) feedback.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  function previewTable(values) {
    return `<h3>Feature extraction preview</h3>${table(
      ["Masked URL", "Feature", "Value"],
      values.flatMap((value) =>
        Object.entries(value.features).map(([name, number]) => [
          maskURL(value.url),
          name,
          number,
        ]),
      ),
    )}`;
  }
  show();
  document.getElementById("dataset-file").onchange = (event) => {
    try {
      const file = selectFile(ctx, event.target.files[0]);
      document.getElementById("selected-file").textContent = file
        ? `Selected in memory: ${file.name}`
        : "No dataset selected.";
      show();
    } catch (error) {
      document.getElementById("feedback").textContent = error.message;
      document.getElementById("selected-file").textContent =
        "No valid dataset selected.";
      show();
    }
  };
  bindForm("dataset-form", async (data) => {
    const file = chooseFile(data, ctx);
    const result = await upload("/dataset/analyze", file, {
      signal: page.signal,
    });
    if (!page.active() || ctx.file !== file) return;
    state.summary = result;
    state.featurePreview = [];
    document.getElementById("selected-file").textContent =
      `Selected in memory: ${file.name}`;
    show();
  });
}
