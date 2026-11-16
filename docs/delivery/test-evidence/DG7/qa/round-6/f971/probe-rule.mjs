#!/usr/bin/env node
// qa-verifier DG7 round 6 (T-DG7-REV-QA-R6): independent adversarial probes of the ADR-0064 A5 (D-278) rule in
// deploy/scripts/drill/schedule-explained.mjs (F-DG7-971). The cases are mine, beyond DO-D9's T-S1..T-S10: they try to
// make the rule explain a write that D-278 says must stay unexplained, and pin the exact boundaries that must pass.
// Inputs are the DO-D9 fixture (the QA round-5 recheck output) plus row values built here. Pure functions only.
//   node probe-rule.mjs <repo root of the frozen clone>
// Exit 0 when every case gives the expected outcome, 1 otherwise. SYNTHETIC values; approves nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.argv[2];
const SE = await import(pathToFileURL(join(REPO, "deploy/scripts/drill/schedule-explained.mjs")).href);
const FIX = JSON.parse(readFileSync(join(REPO, "deploy/scripts/tests/fixtures/f-dg7-971-reconcile-d9.json"), "utf8"));
const TEXT = FIX.output.join("\n") + "\n";
const X = "01a1e35f-8e4f-7de0-80d2-0aab0e420e27";
const X2 = "01a1e35f-9999-7000-8000-000000000002";
const AR = "01a1e35f-8e85-72b8-bcd3-074233427210";
const AR2 = "01a1e35f-9999-7000-8000-0000000000a2";
const WIN = { start: "2026-11-16T07:59:30.000Z", end: "2026-11-16T08:01:10.000Z" };
const ESC = { code: "approval.escalation_scan", cron: "*/15 * * * *", timezone: "Asia/Riyadh", enabled: true };

const ev = (id, seq, record_type, record_id, o = {}) => ({
  id, seq: String(seq), record_type, record_id, source: "worker", actor_type: "service", actor_user_id: null,
  on_behalf_of_user_id: null, request_id: "job:7f1c", new_version: null, ...o,
});
const baseX = (o = {}) => ({
  id: X, trigger_code: "approval.escalation_scan", trigger_key: "approval.escalation_scan:2026-11-16T08:00",
  initiating_user_id: null, run_as: "service", status: "succeeded", attempt_no: 1, version: 2,
  created_at: "2026-11-16T08:00:52.806Z", rule_code: "starter.decision_sla", ...o,
});
const rows = (over = {}) => {
  const x = baseX(over.x);
  return {
    ux: over.ux ?? [X], ur: over.ur ?? [AR],
    executions: { [X]: x, ...(over.executions ?? {}) },
    peers: [x, ...(over.peers ?? [])],
    packageExecutionIds: over.packageExecutionIds ?? [], packageResultIds: over.packageResultIds ?? [],
    triggers: over.triggers ?? { "approval.escalation_scan": "schedule" },
    schedules: over.schedules ?? [ESC],
    results: over.results ?? [{ id: AR, automation_execution_id: X, attempt_no: 1, ordinal: 1, action_type: "starter_handler" }],
    events: over.events ?? [
      ev("e1", 101, "automation_execution", X, { new_version: 1 }),
      ev("e2", 102, "automation_action_result", AR),
      ev("e3", 103, "automation_execution", X, { new_version: 2 }),
    ],
  };
};
// The read callback gets the keys Gate 0 parsed from the recheck text (as the CLI's readTarget does), so U_x and U_r
// always come from the text, never from the probe (round-6 correction: a first draft ignored them; see the log).
const run = (r, window = WIN, text = TEXT, exit = 4) =>
  SE.stage({ text, exit, window, read: (ux, ur) => ({ rows: { ...r, ux, ur }, baseline: "100" }) });
const why = (res) => res.report.failures.map((f) => `${f.table} ${f.key.slice(0, 8)}: ${f.reason}`).join(" | ") || res.report.notApplicableReason || "";

const lines = TEXT.replace(/\n$/, "").split("\n");
const finIdx = lines.findIndex((l) => /^reconcile-migration: mismatch:/.test(l));
const xIdx = lines.findIndex((l) => /^ {2}automation_execution: \d+ added/.test(l));
const withLines = (at, add) => [...lines.slice(0, at), ...add, ...lines.slice(at)].join("\n") + "\n";
const replaceLine = (i, s) => lines.map((l, j) => (j === i ? s : l)).join("\n") + "\n";
const uuid = (n) => `01a1e35f-0000-7000-8000-${String(n).padStart(12, "0")}`;

const cases = [];
const c = (id, expectPass, desc, fn) => cases.push({ id, expectPass, desc, fn });

c("A0", true, "baseline: the round-5 execution and its result are explained", () => run(rows()));
// S2: initiating user, in either column
c("S2a", false, "run_as initiating_user with a NULL user id (schema drift)", () => run(rows({ x: { run_as: "initiating_user" } })));
c("S2b", false, "a user id with run_as service (schema drift)", () => run(rows({ x: { initiating_user_id: uuid(7) } })));
// S3/S4/S5: unscheduled or mismatched codes
c("S3a", false, "the trigger code is an event trigger", () => run(rows({ triggers: { "approval.escalation_scan": "event" } })));
c("S3b", false, "the trigger kind is unknown (no automation_trigger row)", () => run(rows({ triggers: {} })));
c("S4a", false, "key code is another schedule's code (key does not equal trigger_code)", () =>
  run(rows({ x: { trigger_key: "kpi.reporting_period_open:2026-11-16T08:00" } })));
c("S4b", false, "key with a trailing space", () => run(rows({ x: { trigger_key: "approval.escalation_scan:2026-11-16T08:00 " } })));
c("S5a", false, "two enabled job_schedule rows with the same code", () => run(rows({ schedules: [ESC, { ...ESC }] })));
c("S5b", false, "the schedule row is disabled (another enabled row exists for a different code)", () =>
  run(rows({ schedules: [{ ...ESC, enabled: false }, { code: "kpi.reporting_period_open", cron: "*/15 * * * *", timezone: "Asia/Riyadh", enabled: true }] })));
// S6/S7: slots and the window, with the exact boundaries
c("S6a", true, "key minute 08:01 names slot 08:00 (the pg-boss send-latency minute)", () =>
  run(rows({ x: { trigger_key: "approval.escalation_scan:2026-11-16T08:01" } })));
c("S6b", false, "key minute 08:02 names no slot", () => run(rows({ x: { trigger_key: "approval.escalation_scan:2026-11-16T08:02" } })));
c("S6c", false, "a cron the evaluator cannot parse (MON) is too strict, never loose", () =>
  run(rows({ schedules: [{ ...ESC, cron: "0 8 * * MON" }] })));
c("S6d", true, "daily '5 0 * * *' Asia/Riyadh: the slot is 21:05Z the day before (zone from the row)", () =>
  run(rows({ x: { trigger_key: "approval.escalation_scan:2026-11-15T21:05", created_at: "2026-11-15T21:05:20.000Z" }, schedules: [{ ...ESC, cron: "5 0 * * *" }] }),
    { start: "2026-11-15T21:04:50.000Z", end: "2026-11-15T21:06:00.000Z" }));
c("S6e", false, "daily '5 0 * * *' read in UTC instead of the row's zone: 21:05Z is not a slot of the UTC row", () =>
  run(rows({ x: { trigger_key: "approval.escalation_scan:2026-11-15T21:05", created_at: "2026-11-15T21:05:20.000Z" }, schedules: [{ ...ESC, cron: "5 0 * * *", timezone: "UTC" }] }),
    { start: "2026-11-15T21:04:50.000Z", end: "2026-11-15T21:06:00.000Z" }));
c("S7a", true, "slot exactly W1 is inside (created at W1)", () =>
  run(rows({ x: { created_at: "2026-11-16T08:00:00.000Z" } }), { start: "2026-11-16T07:59:30.000Z", end: "2026-11-16T08:00:00.000Z" }));
c("S7b", false, "slot 1 ms after W1 is outside", () =>
  run(rows({ x: { created_at: "2026-11-16T07:59:59.000Z" } }), { start: "2026-11-16T07:59:30.000Z", end: "2026-11-16T07:59:59.999Z" }));
c("S7c", false, "slot exactly W0 - 60 s is outside (W0 = 08:01:00)", () =>
  run(rows({ x: { created_at: "2026-11-16T08:01:05.000Z" } }), { start: "2026-11-16T08:01:00.000Z", end: "2026-11-16T08:02:00.000Z" }));
c("S7d", true, "slot W0 - 59.999 s is inside (W0 = 08:00:59.999, a catch-up send)", () =>
  run(rows({ x: { trigger_key: "approval.escalation_scan:2026-11-16T08:01", created_at: "2026-11-16T08:01:02.000Z" } }), { start: "2026-11-16T08:00:59.999Z", end: "2026-11-16T08:02:00.000Z" }));
c("S7e", false, "a real earlier slot (07:45) with the row created inside the window", () =>
  run(rows({ x: { trigger_key: "approval.escalation_scan:2026-11-16T07:45" } })));
// S8
c("S8a", false, "created 1 ms before W0", () => run(rows({ x: { created_at: "2026-11-16T07:59:29.999Z" } })));
c("S8b", false, "created 1 ms after W1", () => run(rows({ x: { created_at: "2026-11-16T08:01:10.001Z" } })));
// S9: the execution's own worker event
c("S9a", false, "own event from source api", () => run(rows({ events: [ev("e1", 101, "automation_execution", X, { new_version: 2, source: "api" }), ev("e2", 102, "automation_action_result", AR)] })));
c("S9b", false, "own event on behalf of a user", () => run(rows({ events: [ev("e1", 101, "automation_execution", X, { new_version: 2, on_behalf_of_user_id: uuid(7) }), ev("e2", 102, "automation_action_result", AR)] })));
c("S9c", false, "own event request id not job:", () => run(rows({ events: [ev("e1", 101, "automation_execution", X, { new_version: 2, request_id: "req:abc" }), ev("e2", 102, "automation_action_result", AR, { request_id: "req:abc" })] })));
c("S9d", false, "own event at or below the import baseline (seq 100 = B)", () => run(rows({ events: [ev("e1", 100, "automation_execution", X, { new_version: 2 }), ev("e2", 102, "automation_action_result", AR)] })));
c("S9e", false, "no own event carries the row's current version", () => run(rows({ events: [ev("e1", 101, "automation_execution", X, { new_version: 1 }), ev("e2", 102, "automation_action_result", AR)] })));
// Uniqueness
c("U1", false, "a second execution for the same slot, listed too (key 08:01)", () =>
  run(rows({ ux: [X, X2], executions: { [X2]: baseX({ id: X2, trigger_key: "approval.escalation_scan:2026-11-16T08:01" }) },
    peers: [baseX({ id: X2, trigger_key: "approval.escalation_scan:2026-11-16T08:01" })] }),
  WIN, withLines(xIdx + 2, [`    unexplained added ["${X2}"]`])));
c("U2", false, "a second execution for the same slot that the recheck did not list (a peer)", () =>
  run(rows({ peers: [baseX({ id: X2, trigger_key: "approval.escalation_scan:2026-11-16T08:01" })] })));
// S1
c("S1a", false, "the execution id is in the package (a changed, not added, row)", () => run(rows({ packageExecutionIds: [X] })));
// S': the action results
c("R1", false, "the result's event belongs to another job", () =>
  run(rows({ events: [ev("e1", 101, "automation_execution", X, { new_version: 2 }), ev("e2", 102, "automation_action_result", AR, { request_id: "job:other" })] })));
c("R2", false, "a further added result of x not listed by the recheck", () =>
  run(rows({ results: [{ id: AR, automation_execution_id: X, attempt_no: 1, ordinal: 1, action_type: "starter_handler" }, { id: AR2, automation_execution_id: X, attempt_no: 1, ordinal: 2, action_type: "starter_handler" }] })));
c("R3", false, "a listed result of a different, unexplained execution", () =>
  run(rows({ results: [{ id: AR, automation_execution_id: X, attempt_no: 1, ordinal: 1, action_type: "starter_handler" }, { id: AR2, automation_execution_id: X2, attempt_no: 1, ordinal: 1, action_type: "starter_handler" }] }),
    WIN, withLines(xIdx + 4, [`    unexplained added ["${AR2}"]`])));
c("R4", false, "a starter that is not running with a result action other than starter_handler", () =>
  run(rows({ results: [{ id: AR, automation_execution_id: X, attempt_no: 1, ordinal: 1, action_type: "send_notification" }] })));
// Gate 0: unrelated tables and other kinds of difference
c("G1", false, "an unrelated table changed (approval_request), final count bumped", () =>
  run(rows(), WIN, withLines(finIdx, ["  approval_request: 0 added, 1 changed, 0 missing (audit_explained)", `    unexplained changed ["${uuid(1)}"]`]).replace(/mismatch: (\d+) tables/, (m, n) => `mismatch: ${Number(n) + 1} tables`)));
c("G2", false, "an unexplained changed automation_execution key", () =>
  run(rows(), WIN, withLines(xIdx + 1, [`    unexplained changed ["${uuid(2)}"]`])));
c("G3", false, "the automation_execution line with 1 missing", () =>
  run(rows(), WIN, replaceLine(xIdx, lines[xIdx].replace(/0 missing/, "1 missing"))));
c("G4", false, "the automation_execution line with basis child_of", () =>
  run(rows(), WIN, replaceLine(xIdx, lines[xIdx].replace(/\(audit_explained\)/, "(child_of)"))));
c("G5", false, "the final line counts one more table than listed", () =>
  run(rows(), WIN, TEXT.replace(/mismatch: (\d+) tables/, (m, n) => `mismatch: ${Number(n) + 1} tables`)));
c("G6", false, "a key line before any per-table line", () => run(rows(), WIN, [`    unexplained added ["${X}"]`, ...lines].join("\n") + "\n"));
c("G7", false, "the recheck exit is 1 (error), not 4", () => run(rows(), WIN, TEXT, 1));
c("G8", false, "an audit_event per-table line", () =>
  run(rows(), WIN, withLines(finIdx, ["  audit_event: 1 added, 0 changed, 0 missing (audit_explained)"]).replace(/mismatch: (\d+) tables/, (m, n) => `mismatch: ${Number(n) + 1} tables`)));
c("G9", false, "a non-zero attachment count in the final line", () => run(rows(), WIN, TEXT.replace(/0 attachments differ/, "1 attachments differ")));
c("G10", false, "20 automation_execution keys (list may be truncated)", () =>
  run(rows(), WIN, withLines(xIdx + 2, Array.from({ length: 19 }, (_, i) => `    unexplained added ["${uuid(100 + i)}"]`))));
c("G11", false, "19 keys but 18 of them are not schedule executions (not found on T)", () =>
  run(rows(), WIN, withLines(xIdx + 2, Array.from({ length: 18 }, (_, i) => `    unexplained added ["${uuid(200 + i)}"]`))));
c("G12", true, "exit 0 (recheck matched): no execution listed, pass", () => run(rows(), WIN, "", 0));

let bad = 0;
for (const k of cases) {
  let res, err = null;
  try { res = k.fn(); } catch (e) { err = e; }
  const got = err ? `THREW ${err.message}` : res.pass ? "PASS" : "FAIL";
  const listed = res && res.pass ? res.report.executions.map((x) => x.executionId.slice(0, 8)).join(",") : "";
  const ok = !err && res.pass === k.expectPass && (!res.pass || k.id === "G12" || res.report.executions.length >= 1);
  if (!ok) bad++;
  console.log(`${ok ? "ok    " : "NOT OK"} ${k.id.padEnd(4)} expect ${k.expectPass ? "PASS" : "FAIL"} got ${got}${listed ? ` listed [${listed}]` : ""} | ${k.desc}${res && !res.pass ? ` | reason: ${why(res)}` : ""}`);
}
console.log(`${cases.length} cases, ${cases.length - bad} as expected, ${bad} not`);
process.exit(bad === 0 ? 0 : 1);
