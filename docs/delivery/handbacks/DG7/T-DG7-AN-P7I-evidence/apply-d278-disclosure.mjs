#!/usr/bin/env node
// T-DG7-AN-P7I (transformation-analyst): applies the D-278 transfer-drill disclosure (ADR-0064 Amendment 5 A5.6) to
// the hand-written handover sources. The analyst's sandbox cannot write docs/handover/**, so this script carries the
// exact text for the orchestrator (or the owner of docs/handover/**) to apply:
//
//   node docs/delivery/handbacks/DG7/T-DG7-AN-P7I-evidence/apply-d278-disclosure.mjs [--root <dir>]
//
// It edits four files and nothing else:
//   docs/handover/known-limitations.md          a new section 6 row after the ADR-0064 row, and D-278 in Sources
//                                               (the Arabic summary's item 5 needs no change: it cites section 6);
//   docs/handover/deployment.md                 one paragraph after the drill paragraph (A5.7 residuals 3 and 4);
//   docs/handover/known-limitations.ar-summary.md   item 7 of the steps (provisional Arabic);
//   docs/handover/deployment.ar-summary.md      one paragraph after the migration paragraph (provisional Arabic).
// Each insertion is anchored on an exact existing line; a missing anchor or an already-applied text exits 2 and
// writes nothing. Sections 1-3 of known-limitations.md (generated) and release-notes.md (generated) are not touched.
// Afterwards run prettier on the four files, `known-limitations.mjs --check`, `release-notes.mjs --check` and
// `check-handover.mjs`. Nothing here grants or implies a G1-G6, Finance or IT approval, or any DG gate.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const i = process.argv.indexOf("--root");
const root = resolve(i > 0 ? process.argv[i + 1] : ".");

const KL_ROW =
  "| ADR-0064 Amendment 5 (D-278) | The transfer drill (A18, `deploy/scripts/transfer-drill.sh`) keeps every scheduled job running and never pauses, disables or reschedules one. When the after-use reconciliation at step D9 exits 4 because a scheduled job ran on the target between D7 and D9, the drill explains only what ADR-0064 A5.2 allows: an added `automation_execution` with no initiating user and a `schedule` trigger, whose `trigger_key` names an enabled `job_schedule` row in the target and a slot of that row's cron and timezone inside the drill's D7–D9 window (read on the target database's clock), created inside the window with the worker's own audit event, at most one per slot, together with that execution's action results and audit events. The drill report lists every execution explained this way (`schedule-explained-d9.json`, and the D9 fields `recheck`, `scheduleExplained` and `scheduleWindow` of `transfer-drill-report.json`). Every other added or changed row stays unexplained. A scheduled job whose handler writes business rows inside the window (for example, `approval.escalation_scan` escalates an overdue approval, or `kpi.reporting_period_open` opens a reporting period) still makes D9 fail; that is not a data defect. The recovery is to re-run the drill, never to pause or reschedule a job. Not covered (A5.7 residual 3): the engine ticks `automation.tick_hourly` and `automation.tick_daily` key their executions by the hour or business-day start, not by a cron slot, so the rule never explains them and such an execution in the window makes D9 fail. The demo data seeds no rule that names a tick, so none is written today; covering them would widen D-278 and is not decided in this release. The slot and window bounds rest on pg-boss 11.0.0's timing defaults, so a pg-boss upgrade must re-verify them (an ADR-0068 upgrade item, A5.7 residual 4). |";

const DEP_PARA =
  "The rule does not cover the engine ticks `automation.tick_hourly` and `automation.tick_daily`. Their executions are keyed by the hour or business-day start, not by a cron slot, so an execution of either inside the window makes D9 fail (ADR-0064 A5.7 residual 3; the demo data seeds no rule that names a tick). The slot and window bounds rest on pg-boss 11.0.0's timing defaults, and a pg-boss upgrade must re-verify them (A5.7 residual 4). Both are listed in [Known limitations](known-limitations.md#adr-residuals).";

const KL_AR_ITEM =
  "7. **تجربة النقل والمهام المجدولة (ADR-0064، التعديل 5، القرار D-278):** تبقى المهام المجدولة تعمل أثناء تجربة النقل، ولا توقف التجربة أي مهمة ولا تعيد جدولتها. في الخطوة D9 تشرح التجربة التنفيذ المجدول فقط وفق القاعدة A5.2: تنفيذ بلا مستخدم مُبادِر، يسمّي `trigger_key` الخاص به صفاً مُفعّلاً في `job_schedule` على المنصة الهدف وموعداً داخل نافذة الخطوات D7–D9 وفق جدول ذلك الصف (cron) ومنطقته الزمنية، مع نتائج إجراءاته وأحداث التدقيق الخاصة به. يُدرج كل تنفيذ يُشرح بهذه الطريقة في تقرير التجربة (`schedule-explained-d9.json`). إذا كتب معالج مهمة مجدولة سجلات أعمال داخل النافذة، تفشل الخطوة D9، وهذا ليس عيباً في البيانات. الحل هو إعادة تشغيل التجربة، ولا تُوقف أي مهمة مجدولة ولا يُعاد جدولتها أبداً. لا تشمل القاعدة نبضات المحرك `automation.tick_hourly` و`automation.tick_daily` (البند 3 من بقايا A5.7)، وتعتمد حدود النافذة على إعدادات التوقيت الافتراضية في pg-boss 11.0.0.";

const DEP_AR_PARA =
  "لتجربة النقل، شغّل `deploy/scripts/transfer-drill.sh`. تبقى المهام المجدولة تعمل أثناء التجربة، ولا توقف التجربة أي مهمة ولا تعيد جدولتها. إذا نُفّذت مهمة مجدولة على المنصة الهدف بين الخطوتين D7 وD9، لا تشرح التجربة إلا ما تسمح به القاعدة ADR-0064 A5.2 (القرار D-278): تنفيذ (`automation_execution`) بلا مستخدم مُبادِر، يسمّي `trigger_key` الخاص به صفاً مُفعّلاً في `job_schedule` على المنصة الهدف وموعداً داخل نافذة الخطوات D7–D9 وفق جدول ذلك الصف (cron) ومنطقته الزمنية، مع نتائج إجراءاته وأحداث التدقيق الخاصة به. يُدرج كل تنفيذ يُشرح بهذه الطريقة في تقرير التجربة. إذا كتب معالج مهمة مجدولة سجلات أعمال داخل النافذة (مثل تصعيد موافقة متأخرة)، تفشل الخطوة D9، وهذا ليس عيباً في البيانات. الحل هو إعادة تشغيل التجربة، ولا يجوز أبداً إيقاف مهمة مجدولة أو إعادة جدولتها لتجنب ذلك. لا تشمل القاعدة نبضات المحرك `automation.tick_hourly` و`automation.tick_daily` (ADR-0064، البند 3 من بقايا A5.7).";

/** [file, anchor predicate, text to insert after the anchor line (with a blank line where a paragraph), guard text]. */
const EDITS = [
  {
    file: "docs/handover/known-limitations.md",
    after: (l) => l.startsWith("| ADR-0064 | Migration scale is unproven;"),
    lines: [KL_ROW],
    guard: "| ADR-0064 Amendment 5 (D-278) |",
  },
  {
    file: "docs/handover/known-limitations.md",
    replace: [
      "(the notes of the rows in section 4); `docs/delivery/decisions.md` (D-049, D-057, D-058, D-243, D-249, D-253 to",
      "(the notes of the rows in section 4); `docs/delivery/decisions.md` (D-049, D-057, D-058, D-243, D-249, D-253 to",
    ],
    replaceNext: [
      "D-256); `docs/architecture/p7-plan.md` §1.4; ADR-0062 to ADR-0073.",
      "D-256, D-278); `docs/architecture/p7-plan.md` §1.4; ADR-0062 to ADR-0073.",
    ],
    guard: "D-256, D-278);",
  },
  {
    file: "docs/handover/deployment.md",
    after: (l) => l.startsWith("To rehearse the move, run `deploy/scripts/transfer-drill.sh`.") && l.includes("never pause a schedule to avoid it."),
    lines: ["", DEP_PARA],
    guard: "The rule does not cover the engine ticks",
  },
  {
    file: "docs/handover/known-limitations.ar-summary.md",
    after: (l) => l.startsWith("6. **قواعد الأتمتة (`automation_rule`):**"),
    lines: [KL_AR_ITEM],
    guard: "القرار D-278",
  },
  {
    file: "docs/handover/deployment.ar-summary.md",
    after: (l) => l.startsWith("لنقل منصة، جهّز المنصة الهدف من حزمة الترحيل"),
    lines: ["", DEP_AR_PARA],
    guard: "القرار D-278",
  },
];

const texts = new Map();
const fail = (m) => {
  console.error(`apply-d278-disclosure: BLOCKED: ${m}`);
  process.exit(2);
};
for (const e of EDITS) {
  const abs = join(root, e.file);
  if (!texts.has(abs)) texts.set(abs, readFileSync(abs, "utf8"));
  const text = texts.get(abs);
  if (text.includes(e.guard)) fail(`${e.file} already carries the text (${e.guard})`);
  const L = text.split("\n");
  if (e.replace) {
    const k = L.indexOf(e.replace[0]);
    if (k < 0 || L[k + 1] !== e.replaceNext[0]) fail(`${e.file}: the Sources anchor was not found`);
    L[k] = e.replace[1];
    L[k + 1] = e.replaceNext[1];
  } else {
    const hits = L.map((l, n) => (e.after(l) ? n : -1)).filter((n) => n >= 0);
    if (hits.length !== 1) fail(`${e.file}: ${hits.length} anchor lines, expected exactly 1`);
    L.splice(hits[0] + 1, 0, ...e.lines);
  }
  texts.set(abs, L.join("\n"));
}
for (const [abs, text] of texts) writeFileSync(abs, text);
console.log(`apply-d278-disclosure: wrote ${texts.size} files under ${root}`);
