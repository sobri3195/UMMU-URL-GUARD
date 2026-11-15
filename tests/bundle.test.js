import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { glob } from "@vercel/build-utils";

test("Python bundle excludes the frontend install's dependencies and retains the API and ML files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ummu-python-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceFiles = [
    "api/index.py",
    "ml/features.py",
    "ml/model.py",
    "ml/worker.py",
    "models/model.joblib",
    "models/model_metadata.json",
  ];
  const duplicateDependencies = [
    ".vercel_python_packages/numpy/__init__.py",
    ".vercel_python_packages/numpy.libs/libopenblas.so",
    ".vercel_python_packages/pandas/_libs/interval.so",
    ".vercel_python_packages/scipy/linalg/_fblas.so",
  ];
  for (const file of [...sourceFiles, ...duplicateDependencies]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), "bundle fixture\n");
  }
  // Verify the fixture includes hidden dependencies before applying exclusions.
  const unfiltered = await glob("**", { cwd: root });
  for (const file of duplicateDependencies) assert.ok(file in unfiltered);

  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ).functions["api/index.py"];
  const patterns = (value) =>
    Array.isArray(value) ? value : value ? [value] : [];
  // Use the same glob implementation and include-after-exclude order as
  // @vercel/python, so an includeFiles change cannot reintroduce dependencies.
  const files = await glob("**", {
    cwd: root,
    ignore: patterns(config.excludeFiles),
  });
  for (const pattern of patterns(config.includeFiles))
    Object.assign(files, await glob(pattern, root));
  assert.deepEqual(Object.keys(files).sort(), sourceFiles.sort());
});
