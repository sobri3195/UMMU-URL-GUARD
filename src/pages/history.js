import {
  history,
  historyExport,
  removeScan,
  clearHistory,
  download,
  toCSV,
} from "../utils/storage.js";
import { escape, pct, table, when } from "../utils/ui.js";
export function render(ctx) {
  const state = ctx.state.history;
  ctx.view.innerHTML = `<article class="panel"><h2>Detection history</h2><p>Stored on this browser only, up to 200 records / 512 KB. Paths, credentials, queries, and fragments are removed before saving/exporting. No cross-device synchronization.</p><div class="history-filters"><label>Search domain<input id="search" placeholder="Search domain…" value="${escape(state.search)}"></label><label>Prediction<select id="filter" aria-label="Prediction"><option value="">All predictions</option><option value="phishing">Phishing</option><option value="benign">Benign</option><option value="unavailable">Unavailable</option></select></label><label>Date order<select id="sort" aria-label="Date order"><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></label></div><div class="actions"><button id="csv" class="secondary">Export CSV</button><button id="json" class="secondary">Export JSON</button><button id="clear" class="danger">Clear all</button></div><p id="storage-feedback" class="error" role="alert"></p><p id="history-count" class="muted" role="status"></p><div id="history-table"></div><div id="history-details"></div></article>`;
  document.getElementById("filter").value = state.filter;
  document.getElementById("sort").value = state.sort;
  const rows = () =>
    history()
      .filter(
        (row) =>
          row.url.toLowerCase().includes(state.search.toLowerCase()) &&
          (!state.filter || (row.prediction || "unavailable") === state.filter),
      )
      .sort(
        (a, b) =>
          (state.sort === "desc" ? -1 : 1) *
          ((Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0)),
      );
  function details() {
    const element = document.getElementById("history-details");
    const row = history().find((row) => row.id === state.detail);
    if (!row) {
      element.innerHTML = "";
      return;
    }
    element.innerHTML = `<section class="history-detail" tabindex="-1" aria-label="Saved scan details"><h3>Saved scan details</h3>${table(
      ["Field", "Saved value"],
      [
        ["Record ID", row.id],
        ["Masked URL", row.url],
        ["Prediction", row.prediction || "Unavailable"],
        ["Estimated phishing probability", pct(row.probability)],
        ["Timestamp", when(row.timestamp)],
        ["Model version", row.model_version],
        ["Online status", row.online_status],
        ["Redirects", row.redirect_count],
        ["Final URL (masked)", row.details.final_url],
        ["HTTP status", row.details.http_status],
        ["Online duration (ms)", row.details.response_ms],
        ["Reason code", row.details.reason_code],
      ],
    )}<h3>Saved numeric features</h3>${table(["Feature", "Value"], Object.entries(row.details.features))}<h3>Masked redirect chain</h3>${table(
      ["Masked URL", "HTTP status"],
      row.details.chain.map((hop) => [hop.url, hop.http_status]),
    )}<p class="muted">Older records may only contain summary metadata. Missing details are not reconstructed.</p><button type="button" id="close-detail" class="secondary">Close details</button></section>`;
    element.querySelector("#close-detail").onclick = () => {
      state.detail = null;
      details();
    };
  }
  function refresh() {
    const filtered = rows();
    document.getElementById("history-count").textContent =
      `${filtered.length} matching records of ${history().length} saved.`;
    document.getElementById("history-table").innerHTML =
      `<div class="table-wrap"><table><thead><tr><th>Masked URL</th><th>Prediction</th><th>Online</th><th>Timestamp</th><th>Actions</th></tr></thead><tbody>${filtered.map((row) => `<tr><td>${escape(row.url)}</td><td>${escape(row.prediction || "Unavailable")}</td><td>${escape(row.online_status)}</td><td>${escape(when(row.timestamp))}</td><td><div class="row-actions"><button type="button" class="secondary small" data-view="${escape(row.id)}">View details</button><button type="button" class="secondary small" data-remove="${escape(row.id)}">Delete</button></div></td></tr>`).join("") || '<tr><td colspan="5" class="empty">No matching history</td></tr>'}</tbody></table></div>`;
    for (const id of ["csv", "json"]) {
      document.getElementById(id).disabled = !filtered.length;
      document.getElementById(id).title = filtered.length
        ? "Export filtered, sorted, masked records"
        : "No matching history to export";
    }
    document.getElementById("clear").disabled = !history().length;
    document.querySelectorAll("[data-remove]").forEach(
      (button) =>
        (button.onclick = () => {
          if (!removeScan(button.dataset.remove))
            document.getElementById("storage-feedback").textContent =
              "Could not update browser storage.";
          refresh();
        }),
    );
    document.querySelectorAll("[data-view]").forEach(
      (button) =>
        (button.onclick = () => {
          state.detail = button.dataset.view;
          details();
          document.querySelector(".history-detail").focus();
        }),
    );
    details();
  }
  document.getElementById("search").oninput = (event) => {
    state.search = event.target.value;
    refresh();
  };
  document.getElementById("filter").onchange = (event) => {
    state.filter = event.target.value;
    refresh();
  };
  document.getElementById("sort").onchange = (event) => {
    state.sort = event.target.value;
    refresh();
  };
  document.getElementById("clear").onclick = () => {
    if (confirm("Delete all detection history on this browser?")) {
      if (!clearHistory())
        document.getElementById("storage-feedback").textContent =
          "Could not clear browser storage.";
      state.detail = null;
      refresh();
    }
  };
  document.getElementById("csv").onclick = () =>
    download(
      "masked-history.csv",
      toCSV(historyExport(rows())),
      "text/csv;charset=utf-8",
    );
  document.getElementById("json").onclick = () =>
    download("masked-history.json", rows());
  refresh();
}
