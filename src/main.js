import "./style.css";
import {
  createIcons,
  ShieldCheck,
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
import { KEYS, loadExperiment } from "./utils/storage.js";
import { createWorkspace, startPage } from "./utils/workspace.js";
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
  `<aside id="sidebar"><a href="#dashboard" class="brand"><span class="brand-icon"><i data-lucide="shield-check"></i></span><span>UMMU<span class="brand-sub">URL GUARD</span></span></a><div class="sidebar-label">WORKSPACE</div><nav aria-label="Main navigation">${Object.entries(
    routes,
  )
    .map(
      ([id, [name, , icon]]) =>
        `<a href="#${id}" data-route="${id}"><i data-lucide="${icon}"></i>${name}</a>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-note"><span class="status-dot"></span>Research, responsibly.<p>Predictions are indicators.<br>Always verify independently.</p></div></aside><div class="workspace"><header><button id="mobile-menu" aria-label="Toggle navigation" aria-expanded="false"><i data-lucide="menu"></i></button><div class="header-title">Phishing URL Detection <span>& Typosquatting Analysis</span></div><span class="version">RESEARCH EDITION</span></header><main><div class="page-heading"><div><div class="eyebrow">UMMU URL GUARD</div><h1 id="title"></h1><p id="subtitle"></p></div><div class="connection-badges" role="status" aria-live="polite"><span id="backend-status" class="model-status" data-state="checking">Checking Python API…</span><span id="model-status" class="model-status">Model status unknown</span></div></div><p id="job-status" class="notice" role="status" hidden></p><div id="view"></div><footer>UMMU URL GUARD · Research workspace <span>Machine learning prediction is an indicator, not a guarantee of website safety.</span></footer></main></div>`;
const icons = {
  ShieldCheck,
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
const ctx = {
  ...createWorkspace(),
  view: document.getElementById("view"),
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
  startPage(ctx, id);
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
  updateJobStatus();
  showConnection(ctx.connection);
  const check = document.getElementById("check-backend");
  if (check) check.onclick = () => ctx.refreshStatus();
}
function updateJobStatus() {
  const element = document.getElementById("job-status");
  element.hidden = !ctx.job;
  element.textContent = ctx.job
    ? `Research request running: ${ctx.job.datasetName}. Results will be retained in this tab when it completes.`
    : "";
}
ctx.render = render;
ctx.renderResearch = () => {
  updateJobStatus();
  if (
    ["training", "experiments", "evaluation", "analysis", "dashboard"].includes(
      ctx.route,
    )
  )
    render();
};
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
window.addEventListener("storage", (event) => {
  if (event.key === KEYS.experiments && !ctx.job) ctx.report = loadExperiment();
  if (
    [KEYS.history, KEYS.experiments, null].includes(event.key) &&
    ["dashboard", "history"].includes(ctx.route) &&
    !document.activeElement.matches("input, select, textarea")
  )
    render();
});
render();
ctx.refreshStatus();
