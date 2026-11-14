import {
  history,
  removeScan,
  clearHistory,
  download,
  toCSV,
} from "../utils/storage.js";
import { escape, when } from "../utils/ui.js";
export function render(ctx) {
  ctx.view.innerHTML = `<article class="panel"><h2>Detection history</h2><p>Stored on this browser only, up to 200 scans. Paths, queries, and fragments are masked before saving and exporting. No cross-device synchronization.</p><div class="actions"><input id="search" aria-label="Search history" placeholder="Search domain…"><select id="filter" aria-label="Filter prediction"><option value="">All predictions</option><option value="phishing">Phishing</option><option value="benign">Benign</option><option value="unavailable">Unavailable</option></select><button id="csv" class="secondary">Export CSV</button><button id="json" class="secondary">Export JSON</button><button id="clear" class="danger">Clear all</button></div><p id="storage-feedback" class="error" role="alert"></p><div id="history-table"></div></article>`;
  const rows = () =>
    history().filter(
      (r) =>
        String(r.url)
          .toLowerCase()
          .includes(document.getElementById("search").value.toLowerCase()) &&
        (!document.getElementById("filter").value ||
          (r.prediction || "unavailable") ===
            document.getElementById("filter").value),
    );
  function refresh() {
    document.getElementById("history-table").innerHTML =
      `<div class="table-wrap"><table><thead><tr><th>Masked URL</th><th>Prediction</th><th>Online</th><th>Timestamp</th><th>Action</th></tr></thead><tbody>${
        rows()
          .map(
            (r) =>
              `<tr><td>${escape(r.url)}</td><td>${escape(r.prediction || "Unavailable")}</td><td>${escape(r.online_status)}</td><td>${escape(when(r.timestamp))}</td><td><button class="secondary small" data-remove="${escape(r.id)}">Delete</button></td></tr>`,
          )
          .join("") ||
        '<tr><td colspan="5" class="empty">No matching history</td></tr>'
      }</tbody></table></div>`;
    document.querySelectorAll("[data-remove]").forEach(
      (button) =>
        (button.onclick = () => {
          if (!removeScan(button.dataset.remove))
            document.getElementById("storage-feedback").textContent =
              "Could not update browser storage.";
          refresh();
        }),
    );
  }
  document.getElementById("search").oninput = refresh;
  document.getElementById("filter").onchange = refresh;
  document.getElementById("clear").onclick = () => {
    if (confirm("Delete all detection history on this browser?")) {
      if (!clearHistory())
        document.getElementById("storage-feedback").textContent =
          "Could not clear browser storage.";
      refresh();
    }
  };
  document.getElementById("csv").onclick = () =>
    download("masked-history.csv", toCSV(rows()), "text/csv;charset=utf-8");
  document.getElementById("json").onclick = () =>
    download("masked-history.json", rows());
  refresh();
}
