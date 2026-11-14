import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { convertRewrites, normalizeRoutes } from "@vercel/routing-utils";
const config = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url)),
);

test("Vercel compiler accepts rewrites; API paths can never use the SPA fallback", () => {
  const { routes, error } = normalizeRoutes(convertRewrites(config.rewrites));
  assert.equal(error, null);
  const matching = (path) =>
    routes.filter((route) => new RegExp(route.src).test(path));
  for (const path of [
    "/api",
    "/api/",
    "/api/health",
    "/api/features",
    "/api/unknown/nested",
  ]) {
    assert.ok(matching(path).length > 0, `${path} needs a Python rewrite`);
    assert.ok(
      matching(path).every(
        (route) => route.dest.split("?")[0] === "/api/index.py",
      ),
      `${path} must never reach index.html`,
    );
  }
  for (const path of ["/", "/dashboard", "/apiary"])
    assert.equal(matching(path)[0].dest, "/index.html");
  assert.equal(matching("/assets/missing.js").length, 0);
});
