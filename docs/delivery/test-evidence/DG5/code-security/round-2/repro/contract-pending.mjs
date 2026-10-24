// code-security-reviewer DG5 r2: every exported list of apps/api/test/support/p5-pending*.ts is empty (P5_PENDING_TESTS_BE_O
// included); docs/api/openapi.yaml has the expected operation count; every request body media type is pinned. Clone root, Node 24.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { parse } = createRequire(`${process.cwd()}/node_modules/.pnpm/yaml@2.8.1/node_modules/yaml/package.json`)("yaml");
const dir = "apps/api/test/support";
let nonEmpty = 0, lists = 0;
for (const f of readdirSync(dir).filter((n) => /^p5-pending.*\.ts$/.test(n)).sort()) {
  const m = await import(`${process.cwd()}/${dir}/${f}`);
  for (const [k, v] of Object.entries(m)) {
    const size = v instanceof Set || v instanceof Map ? v.size : Array.isArray(v) ? v.length : typeof v === "object" && v ? Object.keys(v).length : null;
    if (size === null) continue;
    lists++;
    if (size !== 0) { nonEmpty++; console.log(`NON-EMPTY ${f} ${k}: ${size}`); }
  }
}
console.log(`p5-pending files' exported collections: ${lists}; non-empty: ${nonEmpty}`);
const be0 = await import(`${process.cwd()}/${dir}/p5-pending-be-o.ts`);
console.log(`P5_PENDING_TESTS_BE_O present: ${"P5_PENDING_TESTS_BE_O" in be0}; size: ${JSON.stringify([...(be0.P5_PENDING_TESTS_BE_O ?? [])].length)}`);
const doc = parse(readFileSync("docs/api/openapi.yaml", "utf8"));
const methods = ["get", "put", "post", "patch", "delete", "head", "options"];
let ops = 0; const media = new Map();
for (const p of Object.values(doc.paths)) for (const m of methods) if (p[m]) { ops++; for (const t of Object.keys(p[m].requestBody?.content ?? {})) media.set(t, (media.get(t) ?? 0) + 1); }
console.log(`openapi operations: ${ops}`);
console.log(`request media types: ${JSON.stringify(Object.fromEntries(media))}`);
process.exit(nonEmpty === 0 && ops === 846 ? 0 : 1);
