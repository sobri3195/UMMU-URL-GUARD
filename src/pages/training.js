import { notice } from "../utils/ui.js";
import {
  controls,
  bindControls,
  resultSummary,
  bindExport,
} from "./research.js";
export function render(ctx) {
  ctx.view.innerHTML = `<article class="panel"><h2>Reproducible model training</h2><p>Fit all three families and compare basic/extended features. At least 20 domain groups, with each class present in three groups, are required. Files stay in this tab only; aggregate results can survive refresh.</p>${controls(ctx, "/train", "Start Training")}</article><article class="panel">${resultSummary(ctx)}</article>${notice("Online experiments never activate a production model. Train a trusted artifact locally and redeploy for inference.")}`;
  bindControls(ctx, "/train");
  bindExport(ctx);
}
