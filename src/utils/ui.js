export const escape = (value) =>
  String(value ?? "—").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export const pct = (value) =>
  value == null ? "N/A" : `${(value * 100).toFixed(1)}%`;
export const when = (value) => (value ? new Date(value).toLocaleString() : "—");
export function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="empty">Belum ada data</td></tr>`}</tbody></table></div>`;
}
export function notice(message, kind = "") {
  return `<div class="notice ${kind}" role="status">${escape(message)}</div>`;
}
export function bindForm(id, action) {
  const form = document.getElementById(id);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("[type=submit]");
    const old = button.textContent;
    const feedback = document.getElementById("feedback");
    button.disabled = true;
    button.textContent = "Working…";
    feedback.textContent = "";
    try {
      await action(new FormData(form));
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  });
}
export const urlForm = (id, label = "Analyze URL", online = false) =>
  `<form id="${id}" class="url-form"><label for="url">Website URL</label><div class="input-row"><input id="url" name="url" type="url" maxlength="4096" placeholder="https://example.com/login" required autocomplete="off" spellcheck="false"><button type="submit">${label}</button><button type="reset" class="secondary">Clear</button></div>${online ? '<label class="check"><input type="checkbox" name="online" checked> Include online HEAD / redirect metadata</label>' : ""}</form><p id="feedback" class="error" role="alert"></p><div id="result" aria-live="polite"></div>`;
