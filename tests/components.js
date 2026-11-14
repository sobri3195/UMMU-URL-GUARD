// Isolated unit-test mount; no production app, pollers, datasets or mock-mode switch.
import { createWorkspace, startPage } from "../src/utils/workspace.js";
import { clearCharts, chartCount } from "../src/utils/charts.js";
import * as scanner from "../src/pages/scanner.js";
import * as dataset from "../src/pages/dataset.js";
import * as features from "../src/pages/features.js";
import * as training from "../src/pages/training.js";
import * as experiments from "../src/pages/experiments.js";
import * as evaluation from "../src/pages/evaluation.js";
import * as analysis from "../src/pages/analysis.js";
import * as history from "../src/pages/history.js";
const pages = {
  scanner,
  dataset,
  features,
  training,
  experiments,
  evaluation,
  analysis,
  history,
};
let ctx;
function reset() {
  clearCharts();
  ctx = createWorkspace();
  ctx.view = document.getElementById("view");
  ctx.render = () => mount(ctx.route);
  ctx.renderResearch = () => ctx.render();
  ctx.refreshStatus = async () => {};
  return ctx;
}
function mount(name) {
  startPage(ctx, name);
  clearCharts();
  pages[name].render(ctx);
}
reset();
window.unit = {
  mount,
  reset,
  get ctx() {
    return ctx;
  },
  chartCount,
};
