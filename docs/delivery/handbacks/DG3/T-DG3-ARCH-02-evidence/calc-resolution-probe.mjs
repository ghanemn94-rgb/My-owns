// T-DG3-ARCH-02 resolution probe for the @mth/shared/calc subpath (solution-architect). Run from the repo root:
//   node docs/delivery/handbacks/DG3/T-DG3-ARCH-02-evidence/calc-resolution-probe.mjs
// Checks: (1) Node resolution from apps/api without and with the @mth/source condition; (2) the built top-level entry
// does not reach decimal.js or zod through its static import graph, while the calc entry does reach decimal.js;
// (3) the top-level entry no longer exports the calculation symbols and the calc entry does; (4) Vite resolution with
// apps/web/vite.config.ts (the condition list the web build uses).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
let failures = 0;
const report = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -- ${detail}`);
};
const resolveFromApi = (spec, conditions) =>
  execFileSync(
    process.execPath,
    [...conditions.map((c) => `--conditions=${c}`), "--input-type=module", "-e", `console.log(import.meta.resolve(${JSON.stringify(spec)}))`],
    { cwd: join(repo, "apps/api"), encoding: "utf8" },
  ).trim();

// 1. Node resolution.
for (const [spec, cond, want] of [
  ["@mth/shared/calc", [], "/packages/shared/dist/calc.js"],
  ["@mth/shared/calc", ["@mth/source"], "/packages/shared/src/calc.ts"],
  ["@mth/shared/schemas", ["@mth/source"], "/packages/shared/src/schemas/index.ts"],
  ["@mth/shared", [], "/packages/shared/dist/index.js"],
]) {
  const got = resolveFromApi(spec, cond);
  report(`node resolves ${spec} [${cond.join(",") || "default"}]`, got.endsWith(want), got.replace(pathToFileURL(repo).href, "<repo>"));
}

// 2. Static import graph of the built entries.
function graph(entry) {
  const seen = new Set();
  const bare = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith(".")) walk(resolve(dirname(file), spec));
      else bare.add(spec);
    }
  };
  walk(entry);
  return { files: seen.size, bare: [...bare].sort() };
}
const top = graph(join(repo, "packages/shared/dist/index.js"));
report("built @mth/shared (top level) imports no package", top.bare.length === 0, `${top.files} files, bare imports: [${top.bare.join(", ")}]`);
const calc = graph(join(repo, "packages/shared/dist/calc.js"));
report("built @mth/shared/calc imports decimal.js (and no zod)", calc.bare.includes("decimal.js") && !calc.bare.includes("zod"), `${calc.files} files, bare imports: [${calc.bare.join(", ")}]`);

// 3. Export surfaces (built).
const topMod = await import(pathToFileURL(join(repo, "packages/shared/dist/index.js")).href);
const calcMod = await import(pathToFileURL(join(repo, "packages/shared/dist/calc.js")).href);
const calcSymbols = ["validateFormula", "evaluateFormula", "formatFormulaValue", "displayNumber", "ENGINE_VERSION", "FORMULA_LIMITS", "weightedScore", "validateWeightSet", "display100", "CRITERION_CODES", "DEFAULT_WEIGHTS_V1"];
report("top-level @mth/shared exports none of the calc symbols", calcSymbols.every((k) => !(k in topMod)), `top-level keys: ${Object.keys(topMod).length}`);
report("@mth/shared/calc exports every calc symbol", calcSymbols.every((k) => k in calcMod), `calc keys: ${Object.keys(calcMod).length}`);
report("@mth/shared/calc smoke: 5,4,3,2,1 under v1 = 3.3000; revenue example = 100000",
  calcMod.weightedScore({ strategic_fit: 5, financial_value: 4, customer_impact: 3, feasibility: 2, time_to_value: 1 }, calcMod.DEFAULT_WEIGHTS_V1).weightedScore === "3.3000" &&
  calcMod.evaluateFormula("(t - b) * n * arpu", [
    { name: "b", kind: "fraction", period: "none", value: "0.10" },
    { name: "t", kind: "fraction", period: "none", value: "0.12" },
    { name: "n", kind: "count", period: "year", value: "100000" },
    { name: "arpu", kind: "currency", currency: "SAR", period: "year", value: "50" },
  ]).result === "100000",
  "ok");

// 4. Vite resolution with the web app's config.
const webRequire = createRequire(join(repo, "apps/web/package.json"));
const vite = await import(pathToFileURL(webRequire.resolve("vite")).href);
const server = await vite.createServer({ configFile: join(repo, "apps/web/vite.config.ts"), root: join(repo, "apps/web"), logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null } });
try {
  const importer = join(repo, "apps/web/src/main.tsx");
  for (const [spec, want] of [["@mth/shared/calc", "/packages/shared/src/calc.ts"], ["@mth/shared/schemas", "/packages/shared/src/schemas/index.ts"]]) {
    const r = await server.pluginContainer.resolveId(spec, importer);
    report(`vite (apps/web/vite.config.ts) resolves ${spec}`, !!r && r.id.endsWith(want), r ? r.id.replace(repo, "<repo>") : "unresolved");
  }
} finally {
  await server.close();
}
console.log(failures === 0 ? "PROBE PASS" : `PROBE FAIL (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
