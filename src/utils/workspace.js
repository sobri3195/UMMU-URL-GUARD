import { upload } from "./api.js";
import { loadExperiment, saveExperiment } from "./storage.js";

export function createWorkspace() {
  return {
    file: null,
    report: loadExperiment(),
    page: null,
    route: "dashboard",
    job: null,
    unsupported: new Set(),
    researchError: "",
    storageNotice: "",
    state: {
      scanner: { url: "", result: null },
      features: { url: "", results: [] },
      dataset: { summary: null, featurePreview: [] },
      history: { search: "", filter: "", sort: "desc", detail: null },
      config: { seed: 42, estimators: 100, model: "Random Forest" },
      evaluation: { scenario: "extended" },
    },
  };
}
export function startPage(ctx, id) {
  ctx.page?.controller.abort();
  const controller = new AbortController();
  const page = {
    controller,
    signal: controller.signal,
    active: () => !controller.signal.aborted,
  };
  ctx.page = page;
  ctx.route = id;
  return page;
}
export function selectFile(ctx, file) {
  if (!file?.name) return ctx.file;
  if (ctx.file !== file) {
    ctx.state.dataset.summary = null;
    ctx.state.dataset.featurePreview = [];
  }
  ctx.file = null;
  if (!file.size)
    throw new Error(
      "Selected CSV is empty. Choose a nonempty labeled dataset.",
    );
  if (file.size > 2000000)
    throw new Error(
      "File exceeds 2 MB. Use python -m ml.train_local --dataset /path/to/dataset.csv",
    );
  ctx.file = file;
  return file;
}
export async function runResearch(ctx, endpoint, file, config) {
  if (ctx.job)
    throw new Error(
      "An experiment is already running. Wait for its actual result.",
    );
  if (!file) throw new Error("Select a labeled CSV first.");
  if (ctx.unsupported.has(endpoint))
    throw new Error(
      "This backend does not support this online action. Use local training.",
    );
  ctx.job = {
    endpoint,
    datasetName: file.name,
    startedAt: new Date().toISOString(),
  };
  ctx.researchError = "";
  ctx.renderResearch();
  try {
    const report = await upload(
      `${endpoint}?seed=${config.seed}&n_estimators=${config.estimators}`,
      file,
    );
    ctx.report = report;
    ctx.storageNotice = saveExperiment(report)
      ? "Aggregate experiment summary saved locally. Full curves and error rows stay in this session."
      : "Could not save the aggregate summary. Export JSON to retain this result.";
    return report;
  } catch (error) {
    ctx.researchError = error.message;
    if ([404, 405, 501].includes(error.status)) ctx.unsupported.add(endpoint);
    return null;
  } finally {
    ctx.job = null;
    ctx.renderResearch();
  }
}
