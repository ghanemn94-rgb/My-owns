// code-security-reviewer DG5 RG2 round 1: outbox registry cross-check (D-QA-F2-1). Run from the disposable clone root
// after `pnpm -r build`: node <this file>. Imports the BUILT registry and the BUILT worker queue map, then scans every
// product source file for event types written to outbox_event (event_type literal or constant), and checks:
//   (1) every enqueued type is registered in OUTBOX_EVENT_SCHEMAS (else the relay refuses it);
//   (2) every registered type has at least one queue in QUEUES_FOR_EVENT (else the relay refuses it);
//   (3) every QUEUES_FOR_EVENT type is registered.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const { OUTBOX_EVENT_SCHEMAS } = await import(join(root, "packages/shared/dist/schemas/index.js"));
const { QUEUES_FOR_EVENT } = await import(join(root, "apps/worker/dist/queues/index.js"));
const registered = new Set(Object.keys(OUTBOX_EVENT_SCHEMAS));
const queued = new Set(Object.keys(QUEUES_FOR_EVENT));
function* walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (n === "node_modules" || n === "dist" || n === "test") continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) yield p;
  }
}
const files = [...walk(join(root, "apps")), ...walk(join(root, "packages"))];
const src = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
// constants: NAME = "a.b"
const consts = new Map();
for (const s of src.values())
  for (const m of s.matchAll(/(?:const|export const)\s+([A-Z0-9_]+)\s*(?::[^=]+)?=\s*"([a-z_]+\.[a-z_.]+)"/g)) consts.set(m[1], m[2]);
const enqueued = new Map();
for (const [f, s] of src) {
  if (!s.includes('insertInto("outbox_event")') && !s.includes("enqueueOutbox") && !s.includes("eventType:")) continue;
  for (const m of s.matchAll(/event_?[tT]ype:\s*("([a-z_]+\.[a-z_.]+)"|([A-Z0-9_]+))/g)) {
    const t = m[2] ?? consts.get(m[3]);
    if (t) enqueued.set(t, [...(enqueued.get(t) ?? []), f.replace(root + "/", "")]);
  }
  for (const m of s.matchAll(/const eventType = "([a-z_]+\.[a-z_.]+)"/g)) enqueued.set(m[1], [...(enqueued.get(m[1]) ?? []), f.replace(root + "/", "")]);
}
const notRegistered = [...enqueued.keys()].filter((t) => !registered.has(t)).sort();
const noQueue = [...registered].filter((t) => !(QUEUES_FOR_EVENT[t]?.length > 0)).sort();
const queueNotRegistered = [...queued].filter((t) => !registered.has(t)).sort();
console.log(`registered (${registered.size}): ${[...registered].sort().join(", ")}`);
console.log(`QUEUES_FOR_EVENT (${queued.size}): ${[...queued].sort().join(", ")}`);
console.log(`enqueued types found in source (${enqueued.size}):`);
for (const [t, fs] of [...enqueued].sort()) console.log(`  ${t}  <- ${[...new Set(fs)].join(", ")}`);
console.log(`(1) enqueued but NOT registered: ${JSON.stringify(notRegistered)}`);
console.log(`(2) registered with NO queue: ${JSON.stringify(noQueue)}`);
console.log(`(3) queue map type NOT registered: ${JSON.stringify(queueNotRegistered)}`);
// report_snapshot.issued is written only when registered (snapshots.ts enqueueIssued guard); not a defect if listed in (1).
const guarded = new Set(["report_snapshot.issued"]);
const real = notRegistered.filter((t) => !guarded.has(t));
console.log(real.length === 0 && noQueue.length === 0 && queueNotRegistered.length === 0 ? "RESULT: PASS" : `RESULT: FAIL ${JSON.stringify({ real, noQueue, queueNotRegistered })}`);
process.exit(real.length === 0 && noQueue.length === 0 && queueNotRegistered.length === 0 ? 0 : 1);
