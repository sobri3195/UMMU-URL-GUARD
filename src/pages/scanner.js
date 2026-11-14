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
export function render(ctx) {
  ctx.view.innerHTML = `<article class="panel"><h2>Inspect a URL</h2><p>Analyze lexical signals and, optionally, resolve public redirects using a bounded HEAD check. The browser never opens the target.</p>${urlForm("scan-form", "Scan URL", true)}</article><div class="notice">Machine learning prediction is an indicator, not a guarantee of website safety.</div>`;
  const checkbox = document.querySelector("[name=online]");
  checkbox.checked = read(KEYS.settings, {}).online !== false;
  checkbox.addEventListener("change", () =>
    write(KEYS.settings, { online: checkbox.checked }),
  );
  bindForm("scan-form", async (data) => {
    const output = document.getElementById("result");
    const online = data.get("online") === "on";
    const result = await post(online ? "/scan" : "/predict", {
      url: data.get("url"),
    });
    const saved = saveScan(result);
    const typo = result.typosquatting;
    output.innerHTML = `<section class="scan-result ${escape(result.prediction || "unavailable")}"><span class="eyebrow">ANALYSIS RESULT</span><h2>${escape(result.prediction ? `Predicted ${result.prediction}` : result.message)}</h2><p>${escape(result.probability_label || "No trained model has been deployed.")}</p>${table(
      ["Signal", "Result"],
      [
        ["Original URL", result.url],
        ["Final URL", result.online?.final_url],
        ["Estimated phishing probability", pct(result.probability)],
        ["Known shortener", result.shortener_provider || "No"],
        [
          "Typosquatting indicator",
          typo.indicator ? `Yes — ${typo.change}` : "No",
        ],
        [
          "Reference / tested domain",
          `${typo.reference_domain} / ${typo.tested_domain}`,
        ],
        ["Domain similarity", pct(typo.similarity)],
        [
          "Online status",
          result.online
            ? `${result.online.status}${result.online.reason ? ": " + result.online.reason : ""}`
            : "Not requested",
        ],
        ["HTTP status", result.online?.http_status],
        ["Redirects", result.online?.redirect_count],
        ["Response time (ms)", result.online?.response_ms],
        ["Timestamp", when(result.timestamp || new Date().toISOString())],
        ["Model version", result.model_version],
        [
          "Prediction target",
          "Original URL only; network metadata is separate",
        ],
        [
          "Final registered domain",
          result.final_destination?.registered_domain,
        ],
      ],
    )}<h3>Prominent lexical indicators</h3><p>Suspicious keyword tokens: ${result.features.suspicious_keywords}. Host entropy: ${result.features.domain_entropy.toFixed(2)} bits. IP hostname: ${result.features.ip_address ? "yes" : "no"}. Similar names and shortened links may be legitimate.</p>${
      result.online?.chain?.length
        ? table(
            ["Redirect chain URL", "HTTP status"],
            result.online.chain.map((hop) => [hop.url, hop.http_status]),
          )
        : ""
    }</section>${notice(saved ? "History saved on this browser with path, query, and fragment redacted." : "Browser storage is unavailable; this scan was not saved.", saved ? "" : "warning")}`;
  });
}
