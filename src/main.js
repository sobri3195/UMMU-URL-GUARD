import "./style.css";
import {
  createIcons,
  LayoutDashboard,
  ScanLine,
  Database,
  ListFilter,
  BrainCircuit,
  ChartNoAxesCombined,
  FlaskConical,
  FileChartColumn,
  History,
  Menu,
} from "lucide";
import { getHealth } from "./utils/api.js";
import { showConnection } from "./utils/connection.js";
import { KEYS, read } from "./utils/storage.js";
import { clearCharts } from "./utils/charts.js";
import * as dashboard from "./pages/dashboard.js";
import * as scanner from "./pages/scanner.js";
import * as dataset from "./pages/dataset.js";
import * as features from "./pages/features.js";
import * as training from "./pages/training.js";
import * as evaluation from "./pages/evaluation.js";
import * as experiments from "./pages/experiments.js";
import * as analysis from "./pages/analysis.js";
import * as history from "./pages/history.js";
const routes = {
  dashboard: [
    "Dashboard",
    "Your research at a glance",
    "layout-dashboard",
    dashboard,
  ],
  scanner: [
    "URL Scanner",
    "Inspect lexical signals and public redirects",
    "scan-line",
    scanner,
  ],
  dataset: [
    "Dataset Management",
    "Validate data before drawing conclusions",
    "database",
    dataset,
  ],
  features: [
    "Feature Extraction",
    "Understand every model input",
    "list-filter",
    features,
  ],
  training: [
    "Model Training",
    "Train with reproducible domain-separated splits",
    "brain-circuit",
    training,
  ],
  evaluation: [
    "Model Evaluation",
    "Measure performance on held-out data",
    "chart-no-axes-combined",
    evaluation,
  ],
  experiments: [
    "Feature Experiment",
    "Compare basic and extended lexical features",
    "flask-conical",
    experiments,
  ],
  analysis: [
    "Result Analysis",
    "Trace results to their evidence",
    "file-chart-column",
    analysis,
  ],
  history: [
    "Detection History",
    "Your private browser activity",
    "history",
    history,
  ],
};
document.getElementById("app").innerHTML =
  `<aside id="sidebar"><a href="#dashboard" class="brand"><img class="brand-icon" src="/assets/logo.svg" alt="" width="44" height="44" /><span>UMMU<span class="brand-sub">URL GUARD</span></span></a><div class="sidebar-label">WORKSPACE</div><nav aria-label="Main navigation">${Object.entries(
    routes,
  )
    .map(
      ([id, [name, , icon]]) =>
        `<a href="#${id}" data-route="${id}"><i data-lucide="${icon}"></i>${name}</a>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-note"><span class="status-dot"></span>Research, responsibly.<p>Predictions are indicators.<br>Always verify independently.</p></div></aside><div class="workspace"><header><button id="mobile-menu" aria-label="Toggle navigation" aria-expanded="false"><i data-lucide="menu"></i></button><img class="header-logo" src="/assets/logo.svg" alt="UMMU URL GUARD" width="28" height="28" /><div class="header-title">Phishing URL Detection <span>& Typosquatting Analysis</span></div><span class="version">RESEARCH EDITION</span></header><main><div class="page-heading"><div><div class="eyebrow">UMMU URL GUARD</div><h1 id="title"></h1><p id="subtitle"></p></div><div class="connection-badges" role="status" aria-live="polite"><span id="backend-status" class="model-status" data-state="checking">Checking Python API…</span><span id="model-status" class="model-status">Model status unknown</span></div></div><div id="view"></div><footer>Dibuat oleh M. Rahman Muttaqin 12105 55201 21 162</footer></main></div>`;
const icons = {
  LayoutDashboard,
  ScanLine,
  Database,
  ListFilter,
  BrainCircuit,
  ChartNoAxesCombined,
  FlaskConical,
  FileChartColumn,
  History,
  Menu,
};
createIcons({ icons });
const saved = read(KEYS.experiments, []);
const ctx = {
  view: document.getElementById("view"),
  file: null,
  report: Array.isArray(saved) ? saved[0] : null,
  refreshStatus: () => {},
  connection: {
    connection: "checking",
    checking: true,
    health: null,
    checkedAt: null,
    error: null,
  },
};
function render() {
  const id = Object.hasOwn(routes, location.hash.slice(1))
    ? location.hash.slice(1)
    : "dashboard";
  const [name, subtitle, , page] = routes[id];
  clearCharts();
  document.getElementById("title").textContent = name;
  document.getElementById("subtitle").textContent = subtitle;
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === id);
    if (link.dataset.route === id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("mobile-menu").setAttribute("aria-expanded", "false");
  page.render(ctx);
  showConnection(ctx.connection);
  const check = document.getElementById("check-backend");
  if (check) check.onclick = () => ctx.refreshStatus();
}
let pendingHealth = null;
ctx.refreshStatus = () => {
  if (pendingHealth) return pendingHealth;
  ctx.connection.checking = true;
  showConnection(ctx.connection);
  pendingHealth = (async () => {
    let reportChanged = false;
    try {
      const health = await getHealth();
      ctx.connection = { connection: "connected", health, error: null };
      if (!ctx.report && health.report) {
        ctx.report = health.report;
        reportChanged = true;
      }
    } catch (error) {
      ctx.connection = {
        connection: "unavailable",
        health: null,
        error: error.message,
      };
    } finally {
      ctx.connection.checkedAt = new Date().toISOString();
      ctx.connection.checking = false;
      pendingHealth = null;
      if (reportChanged && (!location.hash || location.hash === "#dashboard"))
        render();
      else showConnection(ctx.connection);
    }
  })();
  return pendingHealth;
};
setInterval(() => {
  if (!document.hidden) ctx.refreshStatus();
}, 15000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) ctx.refreshStatus();
});
window.addEventListener("online", () => ctx.refreshStatus());
document.getElementById("mobile-menu").onclick = (event) => {
  const open = document.getElementById("sidebar").classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
};
window.addEventListener("hashchange", render);
render();
ctx.refreshStatus();
