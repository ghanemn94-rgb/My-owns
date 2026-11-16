#!/usr/bin/env node
// code-security-reviewer DG7 round 6 (T-DG7-REV-CS-R6): adversarial probe of the F-DG7-971 fix, ADR-0064 A5 (D-278).
// Imports the CANDIDATE's deploy/scripts/drill/schedule-explained.mjs from the disposable clone given as argv[2] and
// tries to make the rule explain writes it must not explain (initiating user, unscheduled code, slot outside the
// window, a second execution per slot, an unrelated table, ...). Each case states the expected outcome; the probe
// exits 1 if ANY case deviates. Inputs are modelled on the real quarter2 evidence of T-DG7-DO-D9 (SYNTHETIC ids).
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repo = process.argv[2];
if (!repo) {
  console.error("usage: f971-adversarial-probe.mjs <clone dir>");
  process.exit(2);
}
const M = await import(pathToFileURL(join(repo, "deploy/scripts/drill/schedule-explained.mjs")).href);

const X1 = "01a1e3da-c303-7a8b-a35f-32308e2b7cc7";
const R1 = "01a1e3da-c317-70fe-8b85-91cb4bbfa98f";
const X2 = "01a1e3da-c303-7a8b-a35f-32308e2b7cc8";
const R2 = "01a1e3da-c317-70fe-8b85-91cb4bbfa990";
const PKGX = "01990000-0000-7000-8000-00000000aaaa";
const W = { start: "2026-11-16T10:14:41.442Z", end: "2026-11-16T10:15:27.756Z" };
const SCH = [
  { code: "approval.escalation_scan", cron: "*/15 * * * *", timezone: "Asia/Riyadh", enabled: true },
  { code: "kpi.daily_refresh", cron: "0 3 * * *", timezone: "Asia/Riyadh", enabled: true },
  { code: "report.disabled_job", cron: "* * * * *", timezone: "Asia/Riyadh", enabled: false },
];
const exec = (o = {}) => ({
  id: X1,
  trigger_code: "approval.escalation_scan",
  trigger_key: "approval.escalation_scan:2026-11-16T10:15",
  initiating_user_id: null,
  run_as: "service",
  status: "succeeded",
  attempt_no: 1,
  version: 2,
  created_at: "2026-11-16T10:15:27.231Z",
  rule_code: "starter.approval_escalation_scan",
  ...o,
});
const res = (o = {}) => ({ id: R1, automation_execution_id: X1, attempt_no: 1, ordinal: 1, action_type: "starter_handler", ...o });
const ev = (o = {}) => ({
  id: "ev-" + Math.random().toString(16).slice(2),
  seq: "1493",
  record_type: "automation_execution",
  record_id: X1,
  source: "worker",
  actor_type: "service",
  actor_user_id: null,
  on_behalf_of_user_id: null,
  request_id: "job:8db1a75a-5bb0-4d3d-b1a6-be9f9ecb099e",
  new_version: 2,
  ...o,
});
const base = () => ({
  ux: [X1],
  ur: [R1],
  executions: { [X1]: exec() },
  peers: [{ id: X1, trigger_code: "approval.escalation_scan", trigger_key: "approval.escalation_scan:2026-11-16T10:15" }],
  packageExecutionIds: [PKGX],
  packageResultIds: [],
  triggers: { "approval.escalation_scan": "schedule" },
  schedules: SCH,
  results: [res()],
  events: [
    ev({ seq: "1493", new_version: 1 }),
    ev({ seq: "1494", record_type: "automation_action_result", record_id: R1, new_version: 1 }),
    ev({ seq: "1495", new_version: 2 }),
  ],
});
const run = (mut, window = W, baseline = "1400") => {
  const rows = base();
  mut?.(rows);
  return M.explain({ rows, window, baseline });
};

let bad = 0;
const check = (name, r, wantPass, wantReason) => {
  const pass = r.failures.length === 0 && r.executions.length > 0;
  const reasons = r.failures.map((f) => `${f.table} ${f.key.slice(-4)}: ${f.reason}`).join(" | ");
  const ok = pass === wantPass && (wantReason === undefined || reasons.includes(wantReason));
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "DEVIATION"} ${name}: expected ${wantPass ? "explained" : "NOT explained"}; got ${pass ? "explained" : "NOT explained"}${reasons ? " [" + reasons + "]" : ""}`);
};

console.log("== explain(): rules S1-S9, uniqueness, S'");
check("A0 baseline (real quarter2 shape)", run(), true);
check("A1 initiating user set", run((r) => (r.executions[X1].initiating_user_id = "01995000-0000-7000-8000-000000000012")), false, "initiating user");
check("A2 run_as user", run((r) => (r.executions[X1].run_as = "user")), false, "initiating user");
check("A3 trigger kind event (not schedule)", run((r) => (r.triggers["approval.escalation_scan"] = "event")), false, "not a schedule trigger");
check("A4 unscheduled code (no job_schedule row)", run((r) => {
  r.executions[X1].trigger_code = "approval.manual_scan"; r.executions[X1].trigger_key = "approval.manual_scan:2026-11-16T10:15";
  r.triggers["approval.manual_scan"] = "schedule";
}), false, "no enabled job_schedule row");
check("A5 schedule row disabled", run((r) => (r.schedules = SCH.map((s) => ({ ...s, enabled: false })))), false, "no enabled job_schedule row");
check("A6 key names another schedule than trigger_code", run((r) => (r.executions[X1].trigger_key = "kpi.daily_refresh:2026-11-16T10:15")), false, "is not");
check("A7 slot outside window (10:00 slot)", run((r) => (r.executions[X1].trigger_key = "approval.escalation_scan:2026-11-16T10:00")), false, "outside the window");
check("A8 slot after W1 (10:30)", run((r) => (r.executions[X1].trigger_key = "approval.escalation_scan:2026-11-16T10:30")), false, "outside the window");
check("A9 key minute not a cron slot (10:17)", run((r) => (r.executions[X1].trigger_key = "approval.escalation_scan:2026-11-16T10:17")), false, "names no slot");
check("A10 key minute = slot + 1 min (10:16 -> slot 10:15, allowed by S6)", run((r) => (r.executions[X1].trigger_key = "approval.escalation_scan:2026-11-16T10:16")), true);
check("A11 key minute = slot + 2 min (10:17) rejected", run((r) => (r.executions[X1].trigger_key = "approval.escalation_scan:2026-11-16T10:17")), false);
check("A12 second execution same slot (10:15 and 10:16 both unexplained)", run((r) => {
  r.ux.push(X2); r.ur.push(R2);
  r.executions[X2] = exec({ id: X2, trigger_key: "approval.escalation_scan:2026-11-16T10:16" });
  r.peers.push({ id: X2, trigger_code: "approval.escalation_scan", trigger_key: "approval.escalation_scan:2026-11-16T10:16" });
  r.results.push(res({ id: R2, automation_execution_id: X2 }));
  r.events.push(ev({ seq: "1496", record_id: X2 }), ev({ seq: "1497", record_type: "automation_action_result", record_id: R2 }));
}), false, "has 2 executions");
check("A13 second execution same slot exists only as a peer (not listed by the recheck)", run((r) => {
  r.peers.push({ id: X2, trigger_code: "approval.escalation_scan", trigger_key: "approval.escalation_scan:2026-11-16T10:15" });
}), false, "has 2 executions");
check("A14 created_at before W0", run((r) => (r.executions[X1].created_at = "2026-11-16T10:14:40.000Z")), false, "outside the window");
check("A15 created_at after W1", run((r) => (r.executions[X1].created_at = "2026-11-16T10:15:28.000Z")), false, "outside the window");
check("A16 execution's own events carry an actor user", run((r) => r.events.forEach((e) => (e.actor_user_id = "01995000-0000-7000-8000-000000000012"))), false, "no service audit event");
check("A17 execution's events on behalf of a user", run((r) => r.events.forEach((e) => (e.on_behalf_of_user_id = "01995000-0000-7000-8000-000000000012"))), false, "no service audit event");
check("A18 events from source api", run((r) => r.events.forEach((e) => (e.source = "api"))), false);
check("A19 request_id not job:", run((r) => r.events.forEach((e) => (e.request_id = "req:abc"))), false);
check("A20 events at or below the import baseline", run(undefined, W, "1495"), false, "no service audit event");
check("A21 no event at the execution's current version", run((r) => (r.executions[X1].version = 3)), false, "no service audit event");
check("A22 result without a worker event", run((r) => (r.events = r.events.filter((e) => e.record_type !== "automation_action_result"))), false, "no worker audit event");
check("A23 result event under another job's request id", run((r) => r.events.forEach((e) => { if (e.record_type === "automation_action_result") e.request_id = "job:other"; })), false, "no worker audit event");
check("A24 result belongs to an execution in the package (not added)", run((r) => (r.results[0].automation_execution_id = PKGX)), false, "not schedule-explained");
check("A25 execution id is in the package (not added)", run((r) => r.packageExecutionIds.push(X1)), false, "not added");
check("A26 extra added result not listed by the recheck (stray)", run((r) => r.results.push(res({ id: R2, ordinal: 2 }))), false);
check("A27 result attempt after execution attempt", run((r) => (r.results[0].attempt_no = 2)), false, "after the execution");
check("A28 starter with two results in the current attempt", run((r) => { r.results.push(res({ id: R2, ordinal: 2 })); r.ur.push(R2); r.events.push(ev({ seq: "1498", record_type: "automation_action_result", record_id: R2 })); }), false, "expected 1..1");
check("A29 slot boundary: slot == W0 - 60 s is excluded (window (W0-60s, W1])",
  run((r) => (r.executions[X1].created_at = "2026-11-16T10:16:00.500Z"), { start: "2026-11-16T10:16:00.000Z", end: "2026-11-16T10:16:30.000Z" }), false, "outside the window");
check("A30 slot boundary: slot == W0 - 59.999 s is included",
  run((r) => (r.executions[X1].created_at = "2026-11-16T10:15:59.999Z"), { start: "2026-11-16T10:15:59.999Z", end: "2026-11-16T10:16:30.000Z" }), true);
check("A31 daily schedule 0 3 * * * Asia/Riyadh: slot 00:00Z (03:00 +03) inside window",
  run((r) => {
    Object.assign(r.executions[X1], { trigger_code: "kpi.daily_refresh", trigger_key: "kpi.daily_refresh:2026-11-17T00:00", created_at: "2026-11-17T00:00:01.000Z" });
    r.triggers = { "kpi.daily_refresh": "schedule" };
    r.peers = [{ id: X1, trigger_code: "kpi.daily_refresh", trigger_key: "kpi.daily_refresh:2026-11-17T00:00" }];
  }, { start: "2026-11-16T23:59:30.000Z", end: "2026-11-17T00:00:20.000Z" }), true);
check("A32 daily schedule key at 03:00Z (wrong zone reading) rejected",
  run((r) => {
    Object.assign(r.executions[X1], { trigger_code: "kpi.daily_refresh", trigger_key: "kpi.daily_refresh:2026-11-17T03:00", created_at: "2026-11-17T03:00:01.000Z" });
    r.triggers = { "kpi.daily_refresh": "schedule" };
  }, { start: "2026-11-17T02:59:30.000Z", end: "2026-11-17T03:00:20.000Z" }), false, "names no slot");
check("A33 key with an invalid date (02-30)", run((r) => (r.executions[X1].trigger_key = "approval.escalation_scan:2026-02-30T10:15")), false);
check("A34 two enabled job_schedule rows with the same code", run((r) => r.schedules.push({ ...SCH[0] })), false, "no enabled job_schedule row");
check("A35 schedule with an unknown time zone", run((r) => (r.schedules = [{ ...SCH[0], timezone: "Mars/Olympus" }])), false, "names no slot");
check("A36 unsupported cron syntax (@hourly)", run((r) => (r.schedules = [{ ...SCH[0], cron: "@hourly" }])), false, "names no slot");

console.log("== gate0(): only automation rows may be unexplained");
const T = (body, exit = 4) => M.gate0(body, exit);
const head = "transfer-attachments verify: matched: 2 objects\n  automation_execution: 32 explaining events\n";
const ex = `  automation_execution: 17 added, 0 changed, 0 missing (audit_explained)\n    unexplained added ["${X1}"]\n`;
const ar = `  automation_action_result: 16 explaining events\n  automation_action_result: 17 added, 0 changed, 0 missing (audit_explained)\n    unexplained added ["${R1}"]\n`;
const tail = (n) => `  forum: 5 explaining events\nreconcile-migration: mismatch: ${n} tables, 0 attachments differ\n`;
const g = (name, r, want, why) => {
  const ok = r.applicable === want && (why === undefined || String(r.reason).includes(why));
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "DEVIATION"} ${name}: expected ${want ? "applicable" : "not applicable"}; got ${r.applicable ? "applicable" : "not applicable (" + r.reason + ")"}`);
};
g("G0 real quarter2 shape", T(head + ex + ar + tail(2)), true);
g("G1 an unrelated table also unexplained (approval)", T(head + ex + ar + `  approval: 1 added, 0 changed, 0 missing (audit_explained)\n    unexplained added ["${X2}"]\n` + tail(3)), false, "is not automation_execution");
g("G2 unrelated table placed after the final line", T(head + ex + ar + tail(2) + `  approval: 1 added, 0 changed, 0 missing (audit_explained)\n`), false, "line not allowed");
g("G3 unexplained CHANGED automation_execution key", T(head + `  automation_execution: 0 added, 1 changed, 0 missing (audit_explained)\n    unexplained changed ["${PKGX}"]\n` + tail(1)), false, "line not allowed");
g("G4 changed key together with an added key", T(head + `  automation_execution: 1 added, 1 changed, 0 missing (audit_explained)\n    unexplained added ["${X1}"]\n    unexplained changed ["${PKGX}"]\n` + tail(1)), false, "line not allowed");
g("G5 missing rows", T(head + `  automation_execution: 1 added, 0 changed, 1 missing (audit_explained)\n    unexplained added ["${X1}"]\n` + tail(1)), false, "line not allowed");
g("G6 child_of basis for results", T(head + ex + `  automation_action_result: 1 added, 0 changed, 0 missing (child_of)\n    unexplained added ["${R1}"]\n` + tail(2)), false, "line not allowed");
g("G7 final count larger than tables listed (hidden table)", T(head + ex + ar + tail(3)), false, "mismatch: 3");
g("G8 attachments differ", T(head + ex + ar + "reconcile-migration: mismatch: 2 tables, 1 attachments differ\n"), false, "line not allowed");
g("G9 recheck exit 1 (error)", T(head + ex + ar + tail(2), 1), false, "recheck exit 1");
g("G10 no final line", T(head + ex + ar), false, "no final");
g("G11 20 keys (possibly truncated list)", T(head + `  automation_execution: 25 added, 0 changed, 0 missing (audit_explained)\n` + Array.from({ length: 20 }, (_, i) => `    unexplained added ["01a1e3da-c303-7a8b-a35f-${String(i).padStart(12, "0")}"]\n`).join("") + tail(1)), false, "truncated");
g("G12 'expected but not added' line", T(head + ex + `    expected but not added ["${X2}"]\n` + tail(1)), false, "line not allowed");
g("G13 lineage run line / unknown line", T(head + ex + "    run 1234 lineage something\n" + tail(1)), false, "line not allowed");
g("G14 duplicate automation_execution table line", T(head + ex + ex + tail(2)), false, "line not allowed");
g("G15 only results unexplained (no execution key)", T(head + ar + tail(1)), false, `no unexplained automation_execution`);
g("G16 key line directly after an info line", T(head + `    unexplained added ["${X1}"]\n` + tail(0)), false, "line not allowed");
g("G17 user_identity unexplained", T(head + ex + "  user_identity: 1 added, 0 changed, 0 missing (unexplained)\n" + tail(2)), false, "is not automation_execution");

console.log("== stage(): report shape on failure lists nothing as explained");
const st = M.stage({ text: head + ex + ar + tail(2), exit: 4, window: W, read: () => ({ rows: (() => { const r = base(); r.executions[X1].initiating_user_id = "u"; return r; })(), baseline: "1400" }) });
const stOk = st.pass === false && st.report.executions.length === 0 && st.recheck === "not_matched";
if (!stOk) bad++;
console.log(`${stOk ? "OK  " : "DEVIATION"} S1 failing key -> pass false, executions [] in report, recheck not_matched (${st.lines.join(" / ")})`);
const st0 = M.stage({ text: "", exit: 0, window: W, read: () => { throw new Error("must not read"); } });
const st0Ok = st0.pass === true && st0.recheck === "matched";
if (!st0Ok) bad++;
console.log(`${st0Ok ? "OK  " : "DEVIATION"} S2 recheck exit 0 -> matched without reading the target`);

console.log(`== ${bad === 0 ? "ALL CASES AS EXPECTED" : bad + " DEVIATION(S)"}`);
process.exit(bad === 0 ? 0 : 1);
