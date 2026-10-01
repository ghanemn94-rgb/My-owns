// Usage (inside a disposable clone of the candidate, cwd = clone root):
//   node docs/.../repro-ajv/run-repro.mjs
// 1) lints the planted file with the candidate's own fileViolations(); 2) imports it and reports what ran.
import { readFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.cwd();
const here = new URL(".", import.meta.url).pathname;
const kit = await import(pathToFileURL(join(root, "apps/api/src/architecture.testkit.ts")).href);
const target = join(root, "apps/api/src/modules/transformations/zz-ajv-planted.ts");
copyFileSync(join(here, "zz-ajv-planted.ts"), target);
const v = kit.fileViolations("transformations", target, readFileSync(target, "utf8"));
console.log("LINT violations for planted file:", JSON.stringify(v));
const m = await import(pathToFileURL(target).href);
console.log("child_process.execFileSync reachable:", m.result?.cp);
const deep = await m.result?.deep;
console.log("deep import of access/policy.ts exports:", Object.keys(deep ?? {}).sort().join(","));
