#!/usr/bin/env node
// qa-verifier DG7 round 6 (T-DG7-REV-QA-R6): runs the A18 harness's OWN re-check of schedule-explained entries
// (tests/qa/integration/a18-transfer-drill.test.ts lines 67-138: WDAY, cronField, isOccurrence,
// scheduleExplainedProblems), copied VERBATIM from the frozen file at run time (type annotations stripped by Node's
// built-in type stripping), against my live run-3b report (a real 14:00 hit), and against tampered copies of it.
//   node harness-recheck.mjs <frozen clone> <transfer-drill-report.json>
// Exit 0 when the live entry has no problem and every tampered copy has at least one. SYNTHETIC; approves nothing.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const [repo, reportPath] = process.argv.slice(2);
const src = readFileSync(join(repo, "tests/qa/integration/a18-transfer-drill.test.ts"), "utf8").split("\n");
const start = src.findIndex((l) => l.startsWith("const WDAY"));
const end = src.findIndex((l) => l.startsWith("function requireBuilt"));
const body = src.slice(start, end).join("\n");
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "harness-recheck-"));
const f = join(dir, "recheck.ts");
writeFileSync(f, `type Json = any;\n${body}\nexport { isOccurrence, scheduleExplainedProblems };\n`);
const { scheduleExplainedProblems } = await import(pathToFileURL(f).href);
console.log(`extracted lines ${start + 1}-${end} of the frozen harness (${end - start} lines)`);

const r = JSON.parse(readFileSync(reportPath, "utf8"));
const d9 = r.steps.find((s) => s.id === "D9");
console.log(`live report: D9 ${d9.result}, recheck ${d9.recheck}, ${d9.scheduleExplained.length} entries, window ${JSON.stringify(d9.scheduleWindow)}`);
const live = scheduleExplainedProblems(d9.scheduleExplained, d9.scheduleWindow);
console.log(`live problems ${JSON.stringify(live)}`);
const e0 = d9.scheduleExplained[0];
const w = d9.scheduleWindow;
const tamper = {
  "initiating user": { initiatingUserId: "01920000-0000-7000-9000-000000000200", runAs: "initiating_user" },
  "event trigger kind": { triggerKind: "event" },
  "key of another code": { triggerKey: e0.triggerKey.replace(/^[^:]+/, "kpi.reporting_period_open") },
  "slot not the key's slot": { slot: new Date(Date.parse(e0.slot) - 15 * 60000).toISOString() },
  "key and slot 15 min before the window": {
    triggerKey: `${e0.triggerCode}:${new Date(Date.parse(e0.slot) - 15 * 60000).toISOString().slice(0, 16)}`,
    slot: new Date(Date.parse(e0.slot) - 15 * 60000).toISOString(),
  },
  "created before W0": { createdAt: new Date(Date.parse(w.start) - 1).toISOString() },
  "no job audit event": { auditEvents: e0.auditEvents.map((e) => ({ ...e, requestId: "req:x" })) },
};
let bad = live.length === 0 ? 0 : 1;
for (const [name, over] of Object.entries(tamper)) {
  const p = scheduleExplainedProblems([{ ...e0, ...over }], w);
  if (p.length === 0) bad++;
  console.log(`${p.length > 0 ? "ok    " : "NOT OK"} tampered '${name}': ${JSON.stringify(p)}`);
}
const dup = scheduleExplainedProblems([e0, { ...e0, executionId: "01a1e4a8-0000-7000-8000-000000000002", triggerKey: `${e0.triggerCode}:${new Date(Date.parse(e0.slot) + 60000).toISOString().slice(0, 16)}` }], w);
if (dup.length === 0) bad++;
console.log(`${dup.length > 0 ? "ok    " : "NOT OK"} two entries for one slot: ${JSON.stringify(dup)}`);
console.log(bad === 0 ? "all as expected" : `${bad} not as expected`);
process.exit(bad === 0 ? 0 : 1);
