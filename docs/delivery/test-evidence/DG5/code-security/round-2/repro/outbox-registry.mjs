// code-security-reviewer DG5 r2 (re-run of the r1 probe on candidate 5df44203): every outbox event type with a payload schema has >=1 consumer queue, and vice versa;
// and every event_type literal written by product code is in the registry. Run from the clone root with Node 24.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const { OUTBOX_EVENT_SCHEMAS } = await import(process.cwd() + "/packages/shared/src/schemas/events.ts");
const { QUEUES_FOR_EVENT } = await import(process.cwd() + "/apps/worker/src/queues/index.ts");
const schemas = Object.keys(OUTBOX_EVENT_SCHEMAS).sort();
const queues = Object.keys(QUEUES_FOR_EVENT).sort();
const noQueue = schemas.filter((t) => !(QUEUES_FOR_EVENT[t]?.length > 0));
const noSchema = queues.filter((t) => !(t in OUTBOX_EVENT_SCHEMAS));
console.log(`schema types: ${schemas.length}; queue-mapped types: ${queues.length}`);
console.log("schema types without a queue:", JSON.stringify(noQueue));
console.log("queue types without a schema:", JSON.stringify(noSchema));
// literal event types used at write sites (eventType: "x" / event_type: "x" / *_EVENT = "x")
const out = execSync(
  `grep -rhoE "(eventType|event_type)[\\"']?\\s*[:=]\\s*[\\"'][a-z_]+\\.[a-z_.]+[\\"']|_EVENT(_TYPE)?\\s*=\\s*[\\"'][a-z_]+\\.[a-z_.]+[\\"']" apps/api/src apps/worker/src packages/db/src --include=*.ts --exclude=*.test.ts || true`,
  { encoding: "utf8" },
);
const lits = [...new Set(out.split("\n").map((l) => l.match(/["']([a-z_]+\.[a-z_.]+)["']/)?.[1]).filter(Boolean))].sort();
const unknown = lits.filter((t) => !(t in OUTBOX_EVENT_SCHEMAS));
console.log(`event-type literals at write sites: ${lits.length}`);
console.log("literals not in OUTBOX_EVENT_SCHEMAS:", JSON.stringify(unknown));
process.exit(noQueue.length || noSchema.length ? 1 : 0);
