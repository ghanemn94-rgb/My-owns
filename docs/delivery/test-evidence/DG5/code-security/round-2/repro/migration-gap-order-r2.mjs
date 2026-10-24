// code-security-reviewer DG5 r2: F-DG5-100 pure check with the runner's own compareStatus() (packages/db/src/migrate.ts),
// corrected from the round-1 script: applied rows carry their REAL ids (r1 used 1..89) and the new outOfOrderPending
// field is printed and asserted. For each retired P5 gap, a later build adding <gap>_p6_example.sql on an upgraded
// database (0001-0097 applied) must list it in outOfOrderPending; a forward 0098 must not be; a database applied only to
// 0065 must accept 0066 (no false refusal). Clone root, Node 24.
import { readdirSync } from "node:fs";
const { compareStatus } = await import(process.cwd() + "/packages/db/src/migrate.ts");
const names = readdirSync("packages/db/migrations").filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
const asFile = (name) => ({ id: Number(name.slice(0, 4)), name, sha256: "x".repeat(64), sql: "" });
const applied = names.map((name) => ({ id: Number(name.slice(0, 4)), name, sha256: "x".repeat(64) }));
let bad = 0;
for (const gap of [66, 67, 73, 77, 78, 79, 83, 84]) {
  const g = `${String(gap).padStart(4, "0")}_p6_example.sql`;
  const s = compareStatus([...names, g, "0098_p6_forward.sql"].sort().map(asFile), applied);
  const ok = JSON.stringify(s.outOfOrderPending) === JSON.stringify([g]) && !s.upToDate;
  if (!ok) bad++;
  console.log(`${ok ? "OK " : "BAD"} gap ${g}: pending=${JSON.stringify(s.pending)} outOfOrderPending=${JSON.stringify(s.outOfOrderPending)}`);
}
const old = applied.filter((a) => a.id <= 65);
const s2 = compareStatus([...names.filter((n) => Number(n.slice(0, 4)) <= 65), "0066_p6_example.sql"].map(asFile), old);
const ok2 = s2.outOfOrderPending.length === 0 && JSON.stringify(s2.pending) === '["0066_p6_example.sql"]';
if (!ok2) bad++;
console.log(`${ok2 ? "OK " : "BAD"} database at 0065 + 0066: pending=${JSON.stringify(s2.pending)} outOfOrderPending=${JSON.stringify(s2.outOfOrderPending)}`);
process.exit(bad === 0 ? 0 : 1);
