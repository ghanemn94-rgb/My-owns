// My Work message keys (T-DG4-FE-R1; FE-C decision 4; S-6): every work-item and notice message key of the ARCH-R1
// and ARCH-R2 code tables (handbacks T-DG4-ARCH-R1 §E item 11, T-DG4-ARCH-R2 rows 182-183) renders a translated text
// in English and Arabic from the parameters its producer really sends (apps/api, apps/worker), never the neutral
// fallback, never a raw key and never an unfilled placeholder. Every work_item_kind of the migrations has a label.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { formatBusinessDate } from "../../lib/format.ts";
import { renderMessage } from "./MyWorkPage.tsx";

type Params = Record<string, string | number | boolean | null>;

/** messageKey -> the messageParams its producer sends (the file in the comment). SYNTHETIC values. */
const PRODUCED: Record<string, Params> = {
  // code table (ARCH-R1) message keys
  "approvals.task.decide": {
    title: "Synthetic ask",
    approvalType: "decision_request",
    roundNo: 1,
    dueDate: "2026-10-20",
  }, // api workflows/approvals.ts
  "approvals.task.changes_requested": { title: "Synthetic ask", roundNo: 1 },
  "approvals.task.outcome": { title: "Synthetic ask", roundNo: 1, outcome: "approved" },
  "approvals.task.escalated": {
    title: "Synthetic ask",
    dueDate: "2026-10-20",
    level: 2,
    fromParty: "BO",
    toParty: "SP",
  },
  "approvals.task.overdue": {
    title: "Synthetic ask",
    roundNo: 1,
    dueDate: "2026-10-20",
    overdueAsOf: "2026-10-21",
    level: 1,
    escalatedToParty: "SP",
    routingError: null,
    routingParty: "SP",
  }, // worker handlers/approvals.ts
  "approvals.task.overdue_routing_error": {
    title: "Synthetic ask",
    roundNo: 1,
    dueDate: "2026-10-20",
    overdueAsOf: "2026-10-21",
    level: 1,
    escalatedToParty: null,
    routingError: "party_unmapped",
    routingParty: "SP",
  },
  "kpi.update_due": { kpiName: "Synthetic churn", periodLabel: "2026-09" }, // worker handlers/kpi.ts
  "kpi_actual.review_due": { kpiName: "Synthetic churn", periodLabel: "2026-09", valueNo: 1 }, // api kpi/actuals.ts
  "kpi_actual.rejected": { kpiName: "Synthetic churn", periodLabel: "2026-09", valueNo: 1 },
  "benefits.task.overlap_review": { benefitACode: "B01", benefitBCode: "B02", dimensions: "customer,period" },
  "benefits.task.finance_validation_review": {
    benefitCode: "B01",
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
  }, // worker handlers/benefits.ts
  "raid.task.action_due": { sourceCode: "R-01" }, // api raid/actions.ts (or {} with no source: see below)
  "raid.task.corrective_follow_up": { caseCode: "CA-01" }, // api raid/corrective-cases.ts; worker handlers/raid.ts
  "governance.task.executive_decision_due": { code: "ED-01", title: "Synthetic ask" }, // api executive-decisions.ts
  "governance.task.executive_decision_escalated": {
    code: "ED-01",
    title: "Synthetic ask",
    slaDueDate: "2026-10-15",
    level: 2,
    partyCode: "SP",
    routingError: null,
    delayImpact: "Synthetic delay",
  }, // worker handlers/escalations.ts
  "adoption.task.intervention_due": { code: "AI-01" }, // api adoption/interventions.ts; worker handlers/adoption.ts
  "adoption.task.assessment_invitation": { formName: "Synthetic pulse" }, // api adoption/assessments.ts
  "adoption.task.assessment_to_review": { formName: "Synthetic pulse" },
  "sustainment.task.bau_handover_to_accept": { handoverCode: "H-01", areaCode: "PA-01", areaName: "Synthetic care" },
  "sustainment.task.performance_review_due": { areaCode: "PA-01", dueDate: "2026-11-01" },
  "sustainment.task.control_check_due": { controlCode: "C-01", dueDate: "2026-11-01" }, // worker handlers/sustainment.ts
  "sustainment.task.benefit_monitoring_due": { decisionCode: "TD-01", dueDate: "2026-11-01" },
  "gates.task.gate_decision_due": { gateCode: "G3", submissionNo: 2, snapshotSha256: "a".repeat(64) }, // worker gates.ts
  "gates.task.gate_condition_due": { gateCode: "G3", ordinal: 1 },
  "gates.task.gate_exception_to_decide": { gateCode: "G3", criterionKey: "g3.design", expiresOn: "2026-12-31" },
  "gates.task.gate_exception_expired": { gateCode: "G3", criterionKey: "g3.design", expiresOn: "2026-12-31" },
  "gates.task.phase_step_enabled": { gateCode: "G3", phaseCode: "P4", stepKey: "build.plan" },
  "gates.task.phase_step_review": { phaseCode: "P4", stepKey: "build.plan" }, // api workflows/phase-steps.ts
  "gates.task.scale_scope_enabled": {
    initiativeCode: "INI-0001",
    initiativeId: "01920000-0000-7000-9000-000000000001",
    businessUnitId: "01920000-0000-7000-9000-000000000002",
  },
  // code table (ARCH-R2 rows 182-183)
  "governance.task.meeting_action_due": { title: "Synthetic action", meetingDate: "2026-10-12" },
  "governance.task.minutes_to_approve": { forum: "Synthetic SteerCo", meetingDate: "2026-10-12" },
  // notice keys (ARCH-R1) shown in the inbox
  "governance.notice.executive_decision_escalated": {
    code: "ED-01",
    title: "Synthetic ask",
    slaDueDate: "2026-10-15",
    level: 2,
    partyCode: "SP",
    routingError: null,
    delayImpact: "Synthetic delay",
  },
  "governance.notice.blocker_ask_calendar_not_configured": {
    sourceRecordType: "raid_entry",
    sourceRecordId: "01920000-0000-7000-9000-000000000003",
    redCycles: 3,
  },
  "governance.notice.blocker_ask_owner_unassigned": {
    code: "ED-01",
    title: "Synthetic ask",
    partyCode: "SP",
    routingError: "party_unmapped",
  },
  "governance.notice.series_calendar_not_configured": {},
  "gates.notice.gate_exception_expired": { gateCode: "G3", criterionKey: "g3.design", expiresOn: "2026-12-31" },
  // the gates worker's routing work item (worker handlers/gates.ts GATE_ROUTING_UNMAPPED_MESSAGE)
  "routing.role_unmapped": { gateCode: "G3", submissionNo: 2, roleCode: "SP" },
};

const DATES = ["dueDate", "periodStart", "periodEnd", "slaDueDate", "expiresOn", "meetingDate"];

/** Every work_item_kind code inserted by a migration. */
function migrationKinds(): string[] {
  let root = process.cwd();
  while (!existsSync(join(root, "packages/db/migrations")) && dirname(root) !== root) root = dirname(root);
  const dir = join(root, "packages/db/migrations");
  const kinds = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, f), "utf8");
    for (const m of sql.matchAll(/INSERT INTO work_item_kind[^;]*;/g))
      for (const row of m[0].matchAll(/\(\s*'([a-z_]+)'/g)) kinds.add(row[1]!);
  }
  return [...kinds].sort();
}

describe.each(["en", "ar"] as const)("My Work message keys (%s)", (locale) => {
  const { t } = createI18n(locale);
  const fallbackPrefix = t("myWork.message.fallback", { kind: "" }).trim();

  it.each(Object.keys(PRODUCED))("%s renders from its producer's params", (key) => {
    const params = PRODUCED[key]!;
    const raw = t(`myWork.message.${key.replace(/\./g, "__")}`, { defaultValue: "" });
    expect(raw, "translated").not.toBe("");
    // every placeholder of the text is a parameter the producer sends
    const placeholders = [...raw.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);
    expect(placeholders.filter((p) => !(p in params))).toEqual([]);
    const text = renderMessage(t, locale, key, params);
    expect(text).not.toContain("{{");
    expect(text).not.toContain(key);
    expect(text.startsWith(fallbackPrefix) && fallbackPrefix !== "").toBe(false);
    if (locale === "ar") expect(text).toMatch(/[؀-ۿ]/);
    // business dates are shown in the reader's locale, never as the raw ISO date
    for (const d of DATES)
      if (typeof params[d] === "string" && placeholders.includes(d)) {
        expect(text).toContain(formatBusinessDate(params[d] as string, locale)!);
        if (formatBusinessDate(params[d] as string, locale) !== params[d]) expect(text).not.toContain(params[d]);
      }
  });

  it("benefits.task.finance_validation_review names the benefit and its period (FE-C decision 4)", () => {
    const text = renderMessage(t, locale, "benefits.task.finance_validation_review", {
      benefitCode: "B01",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
    });
    expect(text).toContain("B01");
    expect(text).toContain(formatBusinessDate("2026-07-01", locale)!);
    expect(text).toContain(formatBusinessDate("2026-09-30", locale)!);
  });

  it("raid.task.action_due with no source code (ADR-0031) has its own text, never an unfilled placeholder", () => {
    const bare = renderMessage(t, locale, "raid.task.action_due", {});
    expect(bare).toBe(t("myWork.message.raid__task__action_due_bare"));
    expect(renderMessage(t, locale, "raid.task.action_due", { sourceCode: "R-01" })).toContain("R-01");
  });

  it("a date parameter that is null is Unknown, never blank", () => {
    const text = renderMessage(t, locale, "sustainment.task.control_check_due", { controlCode: "C-01", dueDate: null });
    expect(text).toContain(t("common.value.unknown"));
  });

  it("every work_item_kind of the migrations has a kind label", () => {
    const kinds = migrationKinds();
    expect(kinds.length).toBeGreaterThan(20);
    expect(kinds.filter((k) => !t(`myWork.kind.${k}`, { defaultValue: "" }))).toEqual([]);
  });
});

it("every message and kind key exists in both languages (no one-sided key)", () => {
  const en = createI18n("en").t;
  const ar = createI18n("ar").t;
  const keys = [
    ...Object.keys(PRODUCED).map((k) => `myWork.message.${k.replace(/\./g, "__")}`),
    "myWork.message.raid__task__action_due_bare",
  ];
  for (const k of keys) {
    const e = en(k, { defaultValue: "" });
    const a = ar(k, { defaultValue: "" });
    expect(e, k).not.toBe("");
    expect(a, k).not.toBe("");
    expect([...a.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort(), k).toEqual(
      [...e.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort(),
    );
  }
});
