// code-security-reviewer DG5 r1 (finding F-DG5-100 reproduction). Pure, no database: the migration runner's own
// compareStatus() (packages/db/src/migrate.ts) is given an upgraded database that has applied 0001..0097 (the candidate's
// 36 P5 files with their gaps) and a later build that fills the reserved P5 gap 0066. Run from the clone root, Node 24.
import { readdirSync } from "node:fs";
const { compareStatus } = await import(process.cwd() + "/packages/db/src/migrate.ts");
const names = readdirSync("packages/db/migrations").filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
const ids = names.map((n) => Number(n.slice(0, 4)));
const p5 = ids.filter((i) => i >= 62);
const missing = [];
for (let i = 62; i <= Math.max(...p5); i++) if (!p5.includes(i)) missing.push(i);
console.log(`candidate migrations: ${names.length}, last ${names.at(-1)}; P5 ids 0062-0097 missing: ${missing.map((i) => String(i).padStart(4, "0")).join(", ")}`);
const asFile = (name) => ({ id: Number(name.slice(0, 4)), name, sha256: "x".repeat(64), sql: "" });
const applied = names.map((name, i) => ({ id: i + 1, name, sha256: "x".repeat(64) }));
const later = [...names, "0066_p6_example.sql"].sort().map(asFile);
const s = compareStatus(later, applied);
console.log("later build (adds 0066_p6_example.sql) on an upgraded DB:", JSON.stringify({ pending: s.pending, unknownApplied: s.unknownApplied, checksumMismatches: s.checksumMismatches }));
const order = later.map((f) => f.name);
console.log(`fresh DB order: 0066_p6_example.sql runs at position ${order.indexOf("0066_p6_example.sql") + 1} of ${order.length} (before ${order[order.indexOf("0066_p6_example.sql") + 1]})`);
console.log(`upgraded DB order: it runs at position ${names.length + 1} (after ${names.at(-1)}) -> the two orders differ; nothing refuses it`);
process.exit(s.pending.length === 1 && s.pending[0] === "0066_p6_example.sql" ? 0 : 1);
