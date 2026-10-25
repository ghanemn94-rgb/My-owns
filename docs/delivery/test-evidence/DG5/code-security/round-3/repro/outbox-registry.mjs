// Static probe: every outbox event type written in product source is registered (schema) and routed (queue).
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const root = process.argv[2];
const { OUTBOX_EVENT_SCHEMAS } = await import(`${root}/packages/shared/dist/schemas/events.js`);
const { QUEUES_FOR_EVENT } = await import(`${root}/apps/worker/src/queues/index.ts`);
const files = execSync(`git -C ${root} ls-files 'apps/*/src/**.ts' 'packages/*/src/**.ts'`, { encoding: "utf8" })
  .split("\n").filter((f) => f && !/\.test\.ts$|\/test\//.test(f));
const found = new Map();
const lit = /(?:event_type|eventType)\s*:\s*"([a-z_]+\.[a-z_]+)"/g;
const cst = /export const [A-Z0-9_]*(?:EVENT|ISSUED|SLIPPED|FAILED|RECORDED|APPROVED|REQUESTED)[A-Z0-9_]* = "([a-z_]+\.[a-z_]+)"/g;
for (const f of files) {
  const s = readFileSync(`${root}/${f}`, "utf8");
  for (const re of [lit, cst]) for (const m of s.matchAll(re)) (found.get(m[1]) ?? found.set(m[1], new Set()).get(m[1])).add(f);
}
const reg = new Set(Object.keys(OUTBOX_EVENT_SCHEMAS));
let bad = 0;
for (const [t, fs] of [...found].sort()) {
  const r = reg.has(t), q = (QUEUES_FOR_EVENT[t] ?? []).length > 0;
  if (!r || !q) bad++;
  console.log(`${r ? "REG" : "---"} ${q ? "Q" : "-"} ${t}  <- ${[...fs].join(", ")}`);
}
for (const t of reg) if (!((QUEUES_FOR_EVENT[t] ?? []).length > 0)) { bad++; console.log(`registered without queue: ${t}`); }
console.log(`types found in source: ${found.size}; registered: ${reg.size}; unregistered-or-unrouted lines: ${bad}`);
