import { post } from "../utils/api.js";
import { KEYS, read, write, saveScan } from "../utils/storage.js";
import {
  bindForm,
  escape,
  notice,
  pct,
  table,
  urlForm,
  when,
} from "../utils/ui.js";

function scanResult(result, original, requestMs, saved) {
  const online = result.online;
  const typo = result.typosquatting;
  const status = online?.status || "not requested";
  return `<section class="panel" id="online-result"><span class="eyebrow">NETWORK METADATA · SEPARATE FROM MACHINE LEARNING</span><h2>Online check: ${escape(status)}</h2>${online?.reason ? notice(online.reason, online.status === "blocked" || online.status === "http_error" ? "warning" : "") : ""}${table(
    ["Network signal", "Observed result"],
    [
      ["Original input", result.input_url || original],
      ["Normalized URL", result.url],
      ["Registered domain", result.registered_domain],
      ["Resolution status", status],
      ["Status reason code", online?.reason_code],
      ["Final destination", online?.final_url],
      ["Final registered domain", online?.final_domain],
      ["Last URL with received headers", online?.last_checked_url],
      ["HTTP status", online?.http_status],
      ["Redirects followed (headers received)", online?.redirect_count],
      ["Redirect responses observed", online?.redirects_observed],
      ["Online duration (ms)", online?.response_ms],
      ["Backend scan duration (ms)", result.scan_duration_ms],
      ["Browser request duration (ms)", requestMs],
      ["Scan timestamp", when(result.timestamp || new Date().toISOString())],
    ],
  )}<h3>Redirect chain — received response headers only</h3>${
    online?.chain?.length
      ? table(
          ["Checked URL", "HTTP status"],
          online.chain.map((hop) => [hop.url, hop.http_status]),
        )
      : "<p>No response headers received. No status code or destination is inferred.</p>"
  }</section>
  <section class="panel" id="domain-result"><h2>Domain indicators</h2>${table(
    ["Indicator", "Value"],
    [
      ["Short URL indicator", result.shortener_provider ? "Yes" : "No"],
      [
        "Shortener provider (exact hostname)",
        result.shortener_provider || "Not recognized",
      ],
      ["Typosquatting indicator", typo.indicator ? "Yes" : "No"],
      ["Registered domain tested", typo.tested_domain],
      ["Reference domain", typo.reference_domain],
      ["Normalized similarity", pct(typo.similarity)],
      ["Levenshtein distance", typo.edit_distance],
      ["Character change", typo.change],
      ["Fixed reference set", result.reference_domains?.join(", ")],
      [
        "Final destination typo indicator",
        result.final_destination
          ? result.final_destination.typosquatting.indicator
            ? "Yes"
            : "No"
          : null,
      ],
      [
        "Final tested / reference domain",
        result.final_destination
          ? `${result.final_destination.typosquatting.tested_domain} / ${result.final_destination.typosquatting.reference_domain}`
          : null,
      ],
      [
        "Final domain similarity",
        result.final_destination
          ? pct(result.final_destination.typosquatting.similarity)
          : null,
      ],
      [
        "Final character change",
        result.final_destination?.typosquatting.change,
      ],
    ],
  )}<p>Shortened URLs and similar names can be legitimate. Domain similarity is an indicator, not a phishing classification. Unicode hostnames are normalized to ASCII punycode; this is not comprehensive visual-confusable detection.</p></section>
  <section class="panel scan-result ${escape(result.prediction || "unavailable")}" id="prediction-result"><span class="eyebrow">MACHINE LEARNING · ORIGINAL NORMALIZED URL</span><h2>${escape(result.prediction ? `Predicted ${result.prediction}` : result.message || "Prediction unavailable")}</h2><p>${escape(result.probability_label || "No trained model has been deployed. Lexical analysis remains available.")}</p>${table(
    ["Model signal", "Value"],
    [
      ["Estimated phishing probability", pct(result.probability)],
      ["Model version", result.model_version],
      ["Prediction timestamp", when(result.prediction_timestamp)],
      [
        "Prediction target",
        result.prediction_target ||
          "Original normalized URL only; online metadata is not a model input",
      ],
    ],
  )}</section><section class="panel" id="lexical-result"><h2>Lexical features</h2><p>Computed by Python · ${escape(result.schema_version)}</p>${table(
    ["Feature", "Value", "Definition"],
    Object.entries(result.features).map(([name, value]) => [
      name,
      value,
      result.definitions?.[name],
    ]),
  )}</section>${notice(saved ? "History saved on this browser with path, query, and fragment redacted." : "Browser storage is unavailable; this scan was not saved.", saved ? "" : "warning")}`;
}

export function render(ctx) {
  ctx.view.innerHTML = `<article class="panel"><h2>Inspect a URL</h2><p>Analyze lexical signals and optionally check public DNS, HEAD responses, and up to five redirects. The browser never opens the target.</p>${urlForm("scan-form", "Scan URL", true)}</article><div class="notice">Machine learning prediction is an indicator, not a guarantee of website safety.</div>`;
  const checkbox = document.querySelector("[name=online]");
  checkbox.checked = read(KEYS.settings, {}).online !== false;
  checkbox.addEventListener("change", () =>
    write(KEYS.settings, { online: checkbox.checked }),
  );
  let active = null;
  let generation = 0;
  document.getElementById("scan-form").addEventListener("reset", (event) => {
    event.preventDefault();
    document.getElementById("url").value = "";
    generation += 1;
    active?.abort();
    document.getElementById("result").innerHTML = "";
    document.getElementById("feedback").textContent = "";
  });
  bindForm("scan-form", async (data) => {
    const output = document.getElementById("result");
    const current = ++generation;
    active = new AbortController();
    output.setAttribute("aria-busy", "true");
    output.innerHTML = notice("Checking URL with the Python backend…");
    const started = performance.now();
    try {
      const result = await post(
        data.get("online") === "on" ? "/scan" : "/predict",
        { url: data.get("url") },
        { timeoutMs: 25000, signal: active.signal },
      );
      if (current !== generation) return;
      const saved = saveScan(result);
      output.innerHTML = scanResult(
        result,
        data.get("url"),
        Math.round(performance.now() - started),
        saved,
      );
    } catch (error) {
      if (current !== generation) return;
      output.innerHTML = "";
      throw error;
    } finally {
      output.removeAttribute("aria-busy");
      active = null;
    }
  });
}
