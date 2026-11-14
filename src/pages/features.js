import { post } from "../utils/api.js";
import { download, toCSV, maskURL } from "../utils/storage.js";
import { bindForm, copyText, escape, table, urlForm } from "../utils/ui.js";

export function render(ctx) {
  const state = ctx.state.features;
  const page = ctx.page;
  ctx.view.innerHTML = `<article class="panel"><h2>Feature extraction</h2><p>Python computes all feature values using the training/inference schema. Keep up to four URLs in this tab for comparison; raw inputs are never saved to localStorage.</p>${urlForm("features-form", "Extract features")}</article>`;
  const input = document.getElementById("url");
  input.value = state.url;
  input.oninput = () => {
    state.url = input.value;
  };
  const output = document.getElementById("result");
  const rows = () =>
    state.results.flatMap((result, index) =>
      Object.entries(result.features).map(([name, value]) => ({
        url_number: index + 1,
        masked_url: maskURL(result.url),
        feature: name,
        value,
        description: result.definitions[name],
      })),
    );
  function show() {
    if (!page.active()) return;
    if (!state.results.length) {
      output.innerHTML = '<p class="empty">No extracted features yet.</p>';
      return;
    }
    const latest = state.results.at(-1);
    const importance =
      ctx.report?.reports.find(
        (row) =>
          row.model_name === "Random Forest" && row.feature_set === "extended",
      )?.feature_importance || {};
    output.innerHTML = `<h3>Schema: ${escape(latest.schema_version)}</h3>${table(
      ["Feature", "Value", "Description", "Experiment RF importance"],
      Object.entries(latest.features).map(([name, value]) => [
        name,
        value,
        latest.definitions[name],
        importance[name] ?? "N/A",
      ]),
    )}<h3>URL comparison (${state.results.length}/4)</h3><ol>${state.results.map((result) => `<li>${escape(result.url)}</li>`).join("")}</ol>${table(
      ["Feature", ...state.results.map((_, i) => `URL ${i + 1}`)],
      Object.keys(latest.features).map((name) => [
        name,
        ...state.results.map((result) => result.features[name]),
      ]),
    )}<div class="actions"><button type="button" id="copy-features">Copy results</button><button type="button" class="secondary" id="export-features">Export CSV</button><button type="button" class="secondary" id="clear-comparison">Clear comparison</button></div><p id="copy-feedback" role="status"></p><p class="muted">Copy/export masks URL paths, queries, and fragments.</p>`;
    if (!navigator.clipboard?.writeText) {
      output.querySelector("#copy-features").disabled = true;
      output.querySelector("#copy-features").title =
        "Clipboard API unavailable in this browser; use Export CSV.";
    }
    output.querySelector("#copy-features").onclick = () =>
      copyText(
        JSON.stringify(rows(), null, 2),
        output.querySelector("#copy-feedback"),
      );
    output.querySelector("#export-features").onclick = () =>
      download(
        "feature-comparison.csv",
        toCSV(rows()),
        "text/csv;charset=utf-8",
      );
    output.querySelector("#clear-comparison").onclick = () => {
      state.results = [];
      show();
    };
  }
  show();
  bindForm("features-form", async (data) => {
    state.url = data.get("url");
    const result = await post(
      "/features",
      { url: state.url },
      { signal: page.signal, timeoutMs: 10000 },
    );
    if (!page.active()) return;
    state.results = [
      ...state.results.filter(
        (row) =>
          row.url !== result.url &&
          row.schema_version === result.schema_version,
      ),
      result,
    ].slice(-4);
    show();
  });
  document.getElementById("features-form").onreset = (event) => {
    event.preventDefault();
    input.value = "";
    state.url = "";
  };
}
