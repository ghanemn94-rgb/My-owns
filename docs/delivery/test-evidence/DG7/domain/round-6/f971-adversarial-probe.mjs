// domain-reviewer DG7 round 6 (T-DG7-REV-DOM-R6): adversarial probe of the ADR-0064 A5 (D-278) schedule rule,
// deploy/scripts/drill/schedule-explained.mjs, on the FROZEN candidate (disposable clone at 830d7edfd).
// Independent of the shipped unit tests: each case tries to make the rule explain a write it must not explain
// (initiating user, unscheduled code, slot outside the window, second execution per slot, unrelated table, ...), plus
// the positive controls. Usage: node f971-adversarial-probe.mjs <clone root>. Exit 0 only if every expectation holds.
// SYNTHETIC values only; approves nothing (no G1-G6, Finance, IT or DG approval).
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
const SE = await import(pathToFileURL(join(root, "deploy/scripts/drill/schedule-explained.mjs")).href);

const X = "01a1e35f-8e4f-7de0-80d2-0aab0e420e27";
const X2 = "01a1e35f-9999-7de0-80d2-0aab0e420e27";
const AR = "01a1e35f-8e85-72b8-bcd3-074233427210";
const AR2 = "01a1e35f-8e85-72b8-bcd3-07423342ffff";
const WIN = { start: "2026-11-16T07:59:30.000Z", end: "2026-11-16T08:01:10.000Z" };
const ESC = { code: "approval.escalation_scan", cron: "*/15 * * * *", timezone: "Asia/Riyadh", enabled: true };
const DEL = { code: "delegation.expiry_sweep", cron: "10 0 * * *", timezone: "Asia/Riyadh", enabled: true };

const textOf = ({ ux = [X], ur = [AR], extra = [], tables = 2, xCounts = "17 added, 0 changed, 0 missing", exitLine } = {}) =>
  [
    "transfer-attachments verify: matched: 2 objects",
    "  automation_execution: 32 explaining events",
    `  automation_execution: ${xCounts} (audit_explained)`,
    ...ux.map((k) => `    unexplained added ["${k}"]`),
    "  automation_action_result: 16 explaining events",
    "  automation_action_result: 17 added, 0 changed, 0 missing (audit_explained)",
    ...ur.map((k) => `    unexplained added ["${k}"]`),
    ...extra,
    "  work_item: 6 explaining events",
    exitLine ?? `reconcile-migration: mismatch: ${tables} tables, 0 attachments differ`,
  ].join("\n") + "\n";

function ev(id, seq, record_type, record_id, o = {}) {
  return {
    id, seq: String(seq), record_type, record_id, source: "worker", actor_type: "service",
    actor_user_id: null, on_behalf_of_user_id: null, request_id: "job:aaaa", new_version: null, ...o,
  };
}
const exec = (o = {}) => ({
  id: X, trigger_code: "approval.escalation_scan", trigger_key: "approval.escalation_scan:2026-11-16T08:00",
  initiating_user_id: null, run_as: "service", status: "succeeded", attempt_no: 1, version: 2,
  created_at: "2026-11-16T08:00:52.806Z", rule_code: "starter.decision_sla", ...o,
});
const rows = (over = {}) => {
  const x = exec(over.x);
  return {
    ux: over.ux ?? [X],
    ur: over.ur ?? [AR],
    executions: over.executions ?? { [X]: x },
    peers: over.peers ?? [x],
    packageExecutionIds: over.packageExecutionIds ?? [],
    packageResultIds: over.packageResultIds ?? [],
    triggers: over.triggers ?? { "approval.escalation_scan": "schedule", "delegation.expiry_sweep": "schedule" },
    schedules: over.schedules ?? [ESC, DEL],
    results: over.results ?? [{ id: AR, automation_execution_id: X, attempt_no: 1, ordinal: 1, action_type: "starter_handler" }],
    events: over.events ?? [
      ev("e1", 101, "automation_execution", X, { new_version: 1 }),
      ev("e2", 102, "automation_action_result", AR),
      ev("e3", 103, "automation_execution", X, { new_version: 2 }),
    ],
  };
};
const run = (r, { window = WIN, text, exit = 4 } = {}) =>
  SE.stage({ text: text ?? textOf({ ux: r.ux, ur: r.ur }), exit, window, read: () => ({ rows: r, baseline: "100" }) });

const cases = [];
const expect = (name, res, pass, reasonRe) => {
  const reason = res.report.failures[0]?.reason ?? res.report.notApplicableReason ?? null;
  const ok = res.pass === pass && (reasonRe === undefined || reasonRe.test(reason ?? ""));
  cases.push({ name, ok, pass: res.pass, recheck: res.recheck, reason, explained: res.report.executions.length });
};

// Positive controls
expect("P01 control: the F-DG7-971 shape (escalation scan 08:00, starter_handler result) is explained", run(rows()), true);
expect("P02 control: key one minute after the slot (08:01 -> slot 08:00) is explained",
  run(rows({ x: { trigger_key: "approval.escalation_scan:2026-11-16T08:01", created_at: "2026-11-16T08:01:05.000Z" } })), true);
expect("P03 control: recheck exit 0 -> matched, nothing listed", run(rows(), { exit: 0 }), true);
expect("P04 control: a daily cron '10 0 * * *' Asia/Riyadh slot is 21:10Z the previous UTC day",
  run(rows({ x: { trigger_code: "delegation.expiry_sweep", trigger_key: "delegation.expiry_sweep:2026-11-15T21:10", created_at: "2026-11-15T21:10:20.000Z" } }),
    { window: { start: "2026-11-15T21:09:40.000Z", end: "2026-11-15T21:10:40.000Z" } }), true);

// S2: initiating user / run_as
expect("N01 S2 an initiating user (run_as service) is refused",
  run(rows({ x: { initiating_user_id: "11111111-1111-7111-8111-111111111111" } })), false, /initiating user/);
expect("N02 S2 run_as user with a NULL initiating user is refused", run(rows({ x: { run_as: "user" } })), false, /initiating user/);
// S3: trigger kind
expect("N03 S3 an event trigger whose code also names a job_schedule row is refused",
  run(rows({ triggers: { "approval.escalation_scan": "event" } })), false, /not a schedule trigger/);
expect("N04 S3 a request trigger is refused", run(rows({ triggers: { "approval.escalation_scan": "request" } })), false, /not a schedule trigger/);
// S4/S5: unscheduled code, key/code mismatch
expect("N05 S5 a schedule trigger with no job_schedule row (unscheduled code) is refused",
  run(rows({ schedules: [DEL] })), false, /no enabled job_schedule row/);
expect("N06 S5 a disabled schedule is refused", run(rows({ schedules: [{ ...ESC, enabled: false }, DEL] })), false, /no enabled job_schedule row/);
expect("N07 S4 key code differs from trigger_code (another schedule's key) is refused",
  run(rows({ x: { trigger_key: "delegation.expiry_sweep:2026-11-16T08:00" } })), false, /is not 'approval.escalation_scan:YYYY/);
expect("N08 S4 a key with seconds is refused",
  run(rows({ x: { trigger_key: "approval.escalation_scan:2026-11-16T08:00:00" } })), false, /YYYY-MM-DDTHH:MM/);
expect("N09 S4 an event-style idempotency key is refused",
  run(rows({ x: { trigger_key: "approval.escalation_scan:01a1e35f-0000" } })), false, /YYYY-MM-DDTHH:MM/);
// S6/S7: slots
expect("N10 S6 a key two minutes after the slot (08:02) names no slot",
  run(rows({ x: { trigger_key: "approval.escalation_scan:2026-11-16T08:02" } })), false, /names no slot/);
expect("N11 S7 a slot before the window (07:45) is refused",
  run(rows({ x: { trigger_key: "approval.escalation_scan:2026-11-16T07:45" } })), false, /outside the window/);
expect("N12 S7 a slot exactly at W0 - 60 s is refused (exclusive bound)",
  run(rows(), { window: { start: "2026-11-16T08:01:00.000Z", end: "2026-11-16T08:01:30.000Z" } }), false, /outside the window/);
expect("N13 S7 a slot after W1 (08:15 key, window ends 08:01:10) is refused",
  run(rows({ x: { trigger_key: "approval.escalation_scan:2026-11-16T08:15", created_at: "2026-11-16T08:00:59.000Z" } })), false, /outside the window/);
// S8
expect("N14 S8 created before W0 is refused", run(rows({ x: { created_at: "2026-11-16T07:59:29.999Z" } })), false, /outside the window/);
expect("N15 S8 created after W1 is refused", run(rows({ x: { created_at: "2026-11-16T08:01:10.001Z" } })), false, /outside the window/);
// S9: audit events
expect("N16 S9 the execution's event carries a user (forged by a user request) -> refused",
  run(rows({ events: [ev("e1", 101, "automation_execution", X, { new_version: 2, actor_user_id: "11111111-1111-7111-8111-111111111111" }), ev("e2", 102, "automation_action_result", AR)] })),
  false, /no service audit event/);
expect("N17 S9 an API-sourced event with a request id (not job:) -> refused",
  run(rows({ events: [ev("e1", 101, "automation_execution", X, { new_version: 2, source: "api", request_id: "req-1" }), ev("e2", 102, "automation_action_result", AR)] })),
  false, /no service audit event/);
expect("N18 S9 the only event is at or below the import baseline -> refused",
  run(rows({ events: [ev("e1", 100, "automation_execution", X, { new_version: 2 }), ev("e2", 102, "automation_action_result", AR)] })),
  false, /no service audit event/);
expect("N19 S9 no event at the execution's current version -> refused",
  run(rows({ events: [ev("e1", 101, "automation_execution", X, { new_version: 1 }), ev("e2", 102, "automation_action_result", AR)] })),
  false, /no service audit event/);
// S1
expect("N20 S1 an execution that is in the package (not added) -> refused", run(rows({ packageExecutionIds: [X] })), false, /not added/);
// Uniqueness
{
  const x2 = exec({ id: X2, trigger_key: "approval.escalation_scan:2026-11-16T08:01", created_at: "2026-11-16T08:01:02.000Z" });
  const r = rows({ peers: [exec(), x2] });
  expect("N21 uniqueness: a second execution of the same slot exists on T (not listed) -> the listed one is refused", run(r), false, /has 2 executions/);
  // run 1 of this probe omitted X2's own service events, so X2 failed S9 first (probe bug, see the run1 log); now X2
  // carries its own events so that uniqueness is the first failing condition for both.
  const evs = [
    ev("e1", 101, "automation_execution", X, { new_version: 2 }), ev("e2", 102, "automation_action_result", AR),
    ev("e4", 104, "automation_execution", X2, { new_version: 2, request_id: "job:bbbb" }),
  ];
  const r2 = rows({ ux: [X, X2], executions: { [X]: exec(), [X2]: x2 }, peers: [exec(), x2], events: evs });
  const res2 = run(r2);
  expect("N22 uniqueness: two listed executions name one slot -> both refused", res2, false, /has 2 executions/);
  cases[cases.length - 1].ok &&= res2.report.failures.filter((f) => /has 2 executions/.test(f.reason)).length === 2;
}
// S': action results
expect("N23 S' a stray added result of the explained execution not in the recheck list -> refused",
  run(rows({ results: [{ id: AR, automation_execution_id: X, attempt_no: 1, ordinal: 1, action_type: "starter_handler" }, { id: AR2, automation_execution_id: X, attempt_no: 1, ordinal: 2, action_type: "notify" }] })),
  false, /ordinals|not in the recheck/);
expect("N24 S' the result's event belongs to another job (request id not in R(x)) -> refused",
  run(rows({ events: [ev("e1", 101, "automation_execution", X, { new_version: 2 }), ev("e2", 102, "automation_action_result", AR, { request_id: "job:other" })] })),
  false, /no worker audit event/);
expect("N25 S' a starter with a non-starter_handler action -> refused",
  run(rows({ results: [{ id: AR, automation_execution_id: X, attempt_no: 1, ordinal: 1, action_type: "create_work_item" }] })),
  false, /starter_handler/);
// Gate 0: anything else in the recheck output
expect("N26 Gate 0 an unrelated table (approval) with an unexplained added row -> not applicable",
  run(rows(), { text: textOf({ extra: ["  approval: 1 added, 0 changed, 0 missing (audit_explained)", '    unexplained added ["01a1e35f-0000-7000-8000-000000000001"]'], tables: 3 }) }),
  false, /table approval is not/);
expect("N27 Gate 0 an unexplained CHANGED execution -> not applicable",
  run(rows(), { text: textOf({ xCounts: "17 added, 1 changed, 0 missing", extra: [] }).replace('    unexplained added ["' + AR + '"]', '    unexplained added ["' + AR + '"]\n    unexplained changed ["' + X2 + '"]') }),
  false, /line not allowed/);
expect("N28 Gate 0 a reporting_period line (daily kpi.reporting_period_open) -> not applicable",
  run(rows(), { text: textOf({ extra: ["  reporting_period: 0 added, 1 changed, 0 missing (audit_explained)"], tables: 3 }) }), false, /reporting_period/);
expect("N29 Gate 0 a child_of table line (inbox notification style) -> not applicable",
  run(rows(), { text: textOf({ extra: ["  approval_step: 1 added, 0 changed, 0 missing (child_of)"], tables: 3 }) }), false, /not automation_execution/);
expect("N30 Gate 0 a non-zero attachment count -> not applicable",
  run(rows(), { text: textOf({ exitLine: "reconcile-migration: mismatch: 2 tables, 1 attachments differ" }) }), false, /line not allowed/);
expect("N31 Gate 0 table count in the final line differs -> not applicable",
  run(rows(), { text: textOf({ tables: 3 }) }), false, /line not allowed/);
expect("N32 Gate 0 recheck exit 1 (refused) -> not applicable", run(rows(), { exit: 1 }), false, /recheck exit 1/);
expect("N33 Gate 0 a chain-depth line -> not applicable",
  run(rows(), { text: textOf({ extra: ['    chain depth 6 exceeds 5 at ["' + X + '"]'] }) }), false, /line not allowed/);
{
  const many = Array.from({ length: 20 }, (_, i) => `01a1e35f-8e4f-7de0-80d2-${String(i).padStart(12, "0")}`);
  expect("N34 Gate 0 20 keys (possibly truncated) -> not applicable",
    run(rows({ ux: many }), { text: textOf({ ux: many }) }), false, /truncated/);
}
expect("N35 Gate 0 a key line before any table line -> not applicable",
  run(rows(), { text: '    unexplained added ["' + X + '"]\n' + textOf() }), false, /line not allowed/);
expect("N36 Gate 0 only results unexplained, no execution key -> not applicable",
  run(rows({ ux: [] }), { text: textOf({ ux: [], tables: 2 }) }), false, /no unexplained automation_execution key/);
// cron grammar is strict
expect("N37 cron outside the grammar ('*/15 * * * MON') makes the slot unnamed (strict)",
  run(rows({ schedules: [{ ...ESC, cron: "*/15 * * * MON" }] })), false, /names no slot/);
expect("N38 unknown timezone makes the slot unnamed (strict)",
  run(rows({ schedules: [{ ...ESC, timezone: "Mars/Olympus" }] })), false, /names no slot/);

let bad = 0;
for (const c of cases) {
  if (!c.ok) bad += 1;
  console.log(`${c.ok ? "OK  " : "BAD "} ${c.name} | pass=${c.pass} recheck=${c.recheck} explained=${c.explained} reason=${c.reason}`);
}
console.log(`f971-adversarial-probe: ${cases.length} cases, ${cases.length - bad} as expected, ${bad} unexpected`);
process.exit(bad === 0 ? 0 : 1);
