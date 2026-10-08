// Audit-trail changes are shown with localized labels in Arabic and English (F-DG1-005, F-DG1-008, REQ-S15-007, M0302).
import { describe, expect, it } from "vitest";
import {
  PHASES,
  ROLE_CODES,
  STANDALONE_DELIVERABLE_TYPES,
  TRANSFORMATION_MODES,
  TRANSFORMATION_STATUSES,
} from "@mth/shared";
import { createI18n } from "../i18n/index.ts";
import {
  auditActionKey,
  auditFieldKey,
  describeAuditAction,
  describeAuditChange,
  describeAuditChanges,
  describeAuditValue,
} from "./auditChanges.ts";

const en = createI18n("en").t;
const ar = createI18n("ar").t;

/** Every field the API audits on a transformation (apps/api/src/modules/transformations/repository.ts). */
const AUDITED_FIELDS = [
  "code",
  "name",
  "description",
  "mode",
  "entry_phase",
  "standalone_deliverable_type",
  "status",
  "current_phase",
  "sponsor_user_id",
  "lead_user_id",
  "timezone",
  "currency",
  "business_unit_id",
  "archivedAt",
];

describe("audit field labels", () => {
  it("maps every audited field key to a label in both languages (no raw keys)", () => {
    for (const t of [en, ar]) {
      for (const f of AUDITED_FIELDS) {
        const label = describeAuditChange(t, f, { from: null, to: "x" }).label;
        expect(label, f).toBeTruthy();
        expect(label, f).not.toBe(f);
        expect(label, f).not.toMatch(/_/);
      }
    }
  });

  it("uses the localized words, Arabic in Arabic and English in English", () => {
    expect(describeAuditChange(en, "status", { from: "active", to: "closed" }).label).toBe("Status");
    expect(describeAuditChange(ar, "status", { from: "active", to: "closed" }).label).toBe("الحالة");
    expect(describeAuditChange(en, "current_phase", { from: null, to: "diagnose" }).label).toBe("Phase");
    expect(describeAuditChange(ar, "current_phase", { from: null, to: "diagnose" }).label).toBe("المرحلة");
    expect(describeAuditChange(en, "business_unit_id", { from: null, to: "u" }).label).toBe("Business unit");
    expect(describeAuditChange(ar, "business_unit_id", { from: null, to: "u" }).label).toBe("وحدة العمل");
    expect(describeAuditChange(en, "lead_user_id", { from: null, to: "u" }).label).toBe("Transformation Lead");
    expect(describeAuditChange(ar, "lead_user_id", { from: null, to: "u" }).label).toBe("قائد التحوّل");
    expect(describeAuditChange(en, "archivedAt", { from: null, to: "2026-10-01T06:00:00Z" }).label).toBe("Archived on");
    expect(describeAuditChange(ar, "archivedAt", { from: null, to: "2026-10-01T06:00:00Z" }).label).toBe(
      "تاريخ الأرشفة",
    );
  });

  it("normalises camelCase keys", () => {
    expect(auditFieldKey("archivedAt")).toBe("archived_at");
    expect(auditFieldKey("current_phase")).toBe("current_phase");
  });
});

describe("audit values", () => {
  it("shows enum codes with their catalogue labels (status, mode, phase, deliverable) in en and ar", () => {
    expect(describeAuditChange(en, "status", { from: "active", to: "closed" })).toMatchObject({
      from: { kind: "label", text: "Active" },
      to: { kind: "label", text: "Closed" },
    });
    expect(describeAuditChange(ar, "status", { from: "active", to: "closed" })).toMatchObject({
      from: { kind: "label", text: "نشط" },
      to: { kind: "label", text: "مغلق" },
    });
    expect(describeAuditValue(en, "mode", "end_to_end")).toMatchObject({ kind: "label", text: "End-to-End" });
    expect(describeAuditValue(ar, "mode", "modular")).toMatchObject({
      kind: "label",
      text: "النمط الجزئي المرن (الدخول عند المرحلة المناسبة)",
    });
    expect(describeAuditValue(en, "current_phase", "diagnose")).toMatchObject({ kind: "label", text: "Diagnose" });
    expect(describeAuditValue(ar, "entry_phase", "transform")).toMatchObject({
      kind: "label",
      text: "التحويل والتنفيذ",
    });
    expect(describeAuditValue(ar, "standalone_deliverable_type", "benefits_register")).toMatchObject({
      kind: "label",
      text: "سجل المنافع",
    });
  });

  it("has a label for every value of every audited enumeration, in both languages", () => {
    const cases: [string, readonly string[]][] = [
      ["status", TRANSFORMATION_STATUSES],
      ["mode", TRANSFORMATION_MODES],
      ["current_phase", PHASES],
      ["entry_phase", PHASES],
      ["standalone_deliverable_type", STANDALONE_DELIVERABLE_TYPES],
    ];
    for (const t of [en, ar])
      for (const [field, values] of cases)
        for (const v of values) expect(describeAuditValue(t, field, v).kind, `${field}=${v}`).toBe("label");
  });

  it("types ids, timestamps, identifiers and free text instead of printing them raw", () => {
    expect(describeAuditValue(en, "lead_user_id", "u-1")).toEqual({ kind: "user", id: "u-1" });
    expect(describeAuditValue(en, "business_unit_id", "bu-1")).toEqual({ kind: "businessUnit", id: "bu-1" });
    expect(describeAuditValue(en, "archivedAt", "2026-10-01T06:00:00Z")).toEqual({
      kind: "datetime",
      iso: "2026-10-01T06:00:00Z",
    });
    expect(describeAuditValue(en, "currency", "SAR")).toEqual({ kind: "code", text: "SAR" });
    expect(describeAuditValue(ar, "name", "اسم")).toEqual({ kind: "text", text: "اسم" });
  });

  it("shows 'none' for an absent value, never a blank or a symbol", () => {
    expect(describeAuditValue(en, "status", null)).toEqual({ kind: "none" });
    expect(describeAuditValue(ar, "description", "")).toEqual({ kind: "none" });
  });

  it("falls back to the raw code, explicitly marked, for values and fields without a translation", () => {
    expect(describeAuditValue(en, "status", "frozen")).toEqual({ kind: "untranslated", raw: "frozen" });
    expect(describeAuditValue(ar, "status", "frozen")).toEqual({ kind: "untranslated", raw: "frozen" });
    // A value can never address another catalogue entry.
    expect(describeAuditValue(en, "status", "audit.title")).toEqual({ kind: "untranslated", raw: "audit.title" });
    expect(describeAuditValue(en, "archivedAt", "not-a-date")).toEqual({ kind: "untranslated", raw: "not-a-date" });
    const unknown = describeAuditChange(ar, "new_field", { from: 1, to: { a: 2 } });
    expect(unknown.label).toBeNull();
    expect(unknown.from).toEqual({ kind: "untranslated", raw: "1" });
    expect(unknown.to).toEqual({ kind: "untranslated", raw: '{"a":2}' });
    expect(en("transformations.audit.untranslatedField")).toBe("field without a translation");
    expect(ar("transformations.audit.untranslatedValue")).toBe("قيمة بلا ترجمة");
  });

  it("orders fields stably, unknown fields last", () => {
    const order = describeAuditChanges(en, {
      zzz: { from: null, to: "x" },
      business_unit_id: { from: null, to: "b" },
      code: { from: null, to: "TR-1" },
      status: { from: null, to: "draft" },
    }).map((c) => c.field);
    expect(order).toEqual(["code", "status", "business_unit_id", "zzz"]);
  });
});

// F-DG1-008: the derived creator assignment (F-DG1-106) is written on the new transformation's own trail, exactly in
// the shape apps/api/src/modules/access/assignments.ts (grantCreatorTransformationRoles) records it.
describe("role-assignment events on a transformation's trail (F-DG1-008)", () => {
  const SRC = "01920000-0000-7000-8000-0000000000b1";
  const TR = "01920000-0000-7000-9000-000000000301";
  const USER = "01920000-0000-7000-8000-0000000000u1";
  const derived = {
    userId: { from: null, to: USER },
    roleCode: { from: null, to: "TL" },
    scope: { from: null, to: { type: "transformation", id: TR } },
    derivedFromAssignmentId: { from: null, to: SRC },
    effectiveTo: { from: null, to: null },
  };

  it("labels the action in both languages, the derived grant differently from a manual one", () => {
    expect(describeAuditAction(en, "scoped_assignment.create", derived)).toBe(
      "Role granted to the creator (carried over from a business-unit assignment)",
    );
    expect(describeAuditAction(ar, "scoped_assignment.create", derived)).toBe(
      "إسناد دور لمُنشئ السجل (منقول من إسناد على مستوى وحدة العمل)",
    );
    expect(describeAuditAction(en, "scoped_assignment.create", { userId: derived.userId })).toBe("Role granted");
    expect(describeAuditAction(ar, "scoped_assignment.create", null)).toBe("إسناد دور");
    expect(describeAuditAction(en, "scoped_assignment.revoke", null)).toBe("Role revoked");
    expect(describeAuditAction(ar, "scoped_assignment.revoke", null)).toBe("سحب دور");
    expect(describeAuditAction(en, "transformation.create", null)).toBe("Created");
    expect(auditActionKey("scoped_assignment.create", derived)).toBe(
      "transformations.audit.actions.scoped_assignment_create_derived",
    );
  });

  it("falls back (null -> raw code, marked by the caller) for an unknown or malformed action", () => {
    expect(describeAuditAction(en, "kpi.recalculate", null)).toBeNull();
    expect(describeAuditAction(ar, "kpi.recalculate", null)).toBeNull();
    // An action can never address another catalogue entry.
    expect(auditActionKey("../audit.title", null)).toBeNull();
    expect(describeAuditAction(en, "Audit.Title", null)).toBeNull();
  });

  it("English: every field and value of the derived event is localized, none raw", () => {
    const c = describeAuditChanges(en, derived);
    expect(c.map((x) => x.label)).toEqual(["User", "Role", "Scope", "Effective until", "Carried over from assignment"]);
    const by = Object.fromEntries(c.map((x) => [x.field, x.to]));
    expect(by["userId"]).toEqual({ kind: "user", id: USER });
    expect(by["roleCode"]).toEqual({ kind: "label", text: "Transformation Lead", code: "TL" });
    expect(by["scope"]).toEqual({ kind: "scope", scopeType: "transformation", id: TR });
    expect(by["effectiveTo"]).toEqual({ kind: "none" });
    expect(by["derivedFromAssignmentId"]).toEqual({ kind: "code", text: SRC });
    for (const x of c) expect(x.to.kind).not.toBe("untranslated");
  });

  it("Arabic: the same fields and the role with Arabic (glossary) labels", () => {
    const c = describeAuditChanges(ar, derived);
    expect(c.map((x) => x.label)).toEqual(["المستخدم", "الدور", "النطاق", "يسري حتى", "منقول من الإسناد"]);
    const role = c.find((x) => x.field === "roleCode")!.to;
    expect(role).toEqual({ kind: "label", text: "قائد التحوّل", code: "TL" });
    for (const x of c) expect(x.to.kind).not.toBe("untranslated");
  });

  it("has a role label for every role code, and the revocation time 'now' reads as the event time", () => {
    for (const t of [en, ar])
      for (const code of ROLE_CODES) expect(describeAuditValue(t, "roleCode", code).kind).toBe("label");
    expect(describeAuditValue(en, "revokedAt", "now")).toMatchObject({
      kind: "label",
      text: "at the time of this event",
    });
    expect(describeAuditValue(ar, "revokedAt", "now")).toMatchObject({ kind: "label", text: "وقت هذا الحدث" });
    expect(describeAuditValue(en, "effectiveTo", "2027-01-01T00:00:00.000Z")).toEqual({
      kind: "datetime",
      iso: "2027-01-01T00:00:00.000Z",
    });
  });

  it("keeps the marked fallback for unexpected role codes and malformed scopes", () => {
    expect(describeAuditValue(en, "roleCode", "NEW_ROLE")).toEqual({ kind: "untranslated", raw: "NEW_ROLE" });
    expect(describeAuditValue(ar, "roleCode", "tl")).toEqual({ kind: "untranslated", raw: "tl" });
    expect(describeAuditValue(en, "scope", { type: "galaxy", id: "x" })).toEqual({
      kind: "untranslated",
      raw: '{"type":"galaxy","id":"x"}',
    });
    // T-DG3-FE-A: a string `scope` is the free-text scope of a P3 business case (BUSINESS_CASE_AUDIT_FIELDS), shown as
    // text; a role assignment's scope is always an object, and a malformed object stays marked (above and below).
    expect(describeAuditValue(en, "scope", "Retail stores")).toEqual({ kind: "text", text: "Retail stores" });
    expect(describeAuditValue(en, "scope", ["transformation"])).toEqual({
      kind: "untranslated",
      raw: '["transformation"]',
    });
    expect(describeAuditValue(en, "scope", { type: "business_unit", id: "b" })).toEqual({
      kind: "scope",
      scopeType: "business_unit",
      id: "b",
    });
  });
});

// P3 (T-DG3-FE-A0): creating a transformation writes the P3 starter structure (0024/0025 p3_instantiate_transformation),
// so its trail carries `roadmap_wave.create` and `scoring_weight_set.create` with the B0076 source weights.
describe("P3 starter-structure events on the transformation trail", () => {
  const weights = {
    strategic_fit: "25.00",
    financial_value: "25.00",
    customer_impact: "20.00",
    feasibility: "15.00",
    time_to_value: "15.00",
  };

  it("labels the two instantiation actions in both languages", () => {
    expect(describeAuditAction(en, "roadmap_wave.create", null)).toBe("Roadmap wave created");
    expect(describeAuditAction(ar, "roadmap_wave.create", null)).toBe("أُنشئ: موجة في خارطة الطريق");
    expect(describeAuditAction(en, "scoring_weight_set.create", { weights: { from: null, to: weights } })).toBe(
      "Prioritization weight set created",
    );
    expect(describeAuditAction(ar, "scoring_weight_set.create", null)).toBe("أُنشئ: مجموعة أوزان ترتيب الأولويات");
  });

  it("shows the weights as localized criteria with their exact decimal percentages, in the B0076 order", () => {
    const enChange = describeAuditChange(en, "weights", { from: null, to: weights });
    expect(enChange.label).toBe("Criterion weights");
    expect(enChange.from).toEqual({ kind: "none" });
    expect(enChange.to).toEqual({
      kind: "label",
      code: "weights",
      text: "Strategic fit 25.00%, Financial value 25.00%, Customer impact 20.00%, Feasibility 15.00%, Time-to-value 15.00%",
    });
    const arChange = describeAuditChange(ar, "weights", { from: null, to: weights });
    expect(arChange.label).toBe("أوزان المعايير");
    expect(arChange.to).toMatchObject({ kind: "label" });
    const text = (arChange.to as { text: string }).text;
    expect(text).toContain("الملاءمة الاستراتيجية 25.00٪");
    expect(text).toContain("الوقت اللازم لتحقيق القيمة 15.00٪");
    expect(text.split("، ")).toHaveLength(5);
  });

  it("keeps the marked fallback for an unknown criterion, a non-decimal percent or a malformed value", () => {
    for (const bad of [{ unknown_criterion: "10.00" }, { feasibility: 15 }, { feasibility: "15.000" }, {}, [], "x"]) {
      expect(describeAuditValue(en, "weights", bad).kind, JSON.stringify(bad)).toBe("untranslated");
    }
  });
});

// P3 (T-DG3-FE-A): every P3 record type and action that can appear on a transformation's trail is labelled in both
// languages; P3 statuses and enum codes have labels; decimals, dates and ids are shown exactly as recorded.
describe("P3 record events on the transformation trail", () => {
  const P3_ACTIONS = [
    // initiative (T05), lifecycle and links
    "initiative.create",
    "initiative.update",
    "initiative.submit",
    "initiative.withdraw",
    "initiative.select",
    "initiative.deselect",
    "initiative.launch",
    "initiative.cancel",
    "initiative.rank",
    "initiative_gap_link.create",
    "initiative_gap_link.remove",
    "initiative_outcome_contribution.create",
    "initiative_outcome_contribution.remove",
    "initiative_decision_link.create",
    "initiative_decision_link.remove",
    // selection and funding (business approvals)
    "portfolio_selection.select",
    "portfolio_selection.deselect",
    "funding_decision.create",
    // prioritization
    "scoring_weight_set.create",
    "scoring_weight_set.approve",
    "scoring_weight_set.supersede",
    "scoring_weight_set.withdraw",
    "initiative_score.create",
    "initiative_score.update",
    "ranking_snapshot.create",
    "ranking_snapshot.supersede",
    "ranking_override.create",
    "ranking_override.decide",
    "ranking_override.revoke",
    // roadmap, deliverables, milestones, dependencies
    "roadmap_wave.create",
    "roadmap_wave.update",
    "deliverable.create",
    "deliverable.update",
    "deliverable.archive",
    "deliverable.submit",
    "deliverable.decide",
    "milestone.create",
    "milestone.update",
    "milestone.approve_date",
    "milestone.reapprove_date",
    "dependency.create",
    "dependency.update",
    "dependency.archive",
    "dependency_type.create",
    "dependency_type.update",
    "dependency_type.retire",
    // capacity and resource demand
    "capacity.create",
    "capacity.update",
    "resource_demand.create",
    "resource_demand.update",
    "resource_demand.commit",
    "resource_demand.release",
    // business cases and T09
    "business_case.create",
    "business_case.update",
    "business_case.archive",
    "business_case.baseline_validate",
    "business_case.baseline_reject",
    "business_case_line.create",
    "business_case_line.update",
    "business_case_line.archive",
    "benefit_formula.create",
    "benefit_formula.update",
    "benefit_formula.archive",
    "benefit_formula.version_set",
    "benefit_formula_version.create",
    "benefit_formula_version.validate",
    "benefit_formula_version.reject",
    "benefit_calculation.create",
    // dispensations and the G1 agreement
    "gate_dispensation.create",
    "gate_dispensation.decide",
    "gate_dispensation.revoke",
    "gate_decision.create",
    "gate_decision_agreement.create",
  ];

  it.each(P3_ACTIONS)("labels %s in English and Arabic", (action) => {
    const e = describeAuditAction(en, action, null);
    const a = describeAuditAction(ar, action, null);
    expect(e, action).toBeTruthy();
    expect(a, action).toBeTruthy();
    expect(a, action).not.toBe(e);
  });

  it("labels business approvals as such, never as an engineering gate", () => {
    for (const action of [
      "portfolio_selection.select",
      "funding_decision.create",
      "scoring_weight_set.approve",
      "ranking_override.decide",
      "gate_dispensation.decide",
    ]) {
      expect(describeAuditAction(en, action, null)).toContain("business approval");
      expect(describeAuditAction(ar, action, null)).toContain("موافقة أعمال");
      expect(describeAuditAction(en, action, null)).not.toMatch(/\bDG[0-7]\b/);
    }
  });

  it("an initiative create shows its T05 fields labelled, people as users and the status translated", () => {
    const changes = {
      code: { from: null, to: "INI-01" },
      name: { from: null, to: "Synthetic initiative" },
      executive_owner_user_id: { from: null, to: "u-1" },
      objective: { from: null, to: "Cut churn" },
      planned_start: { from: null, to: "2026-11-01" },
      status: { from: null, to: "draft" },
    };
    for (const t of [en, ar]) {
      const list = describeAuditChanges(t, changes);
      for (const c of list) {
        expect(c.label, c.field).toBeTruthy();
        expect(c.to.kind, c.field).not.toBe("untranslated");
      }
    }
    expect(describeAuditChange(en, "executive_owner_user_id", { from: null, to: "u-1" }).to).toEqual({
      kind: "user",
      id: "u-1",
    });
    expect(describeAuditChange(en, "planned_start", { from: null, to: "2026-11-01" }).to).toEqual({
      kind: "code",
      text: "2026-11-01",
    });
  });

  it("P3 statuses fall back to the P3 catalogue; the transformation statuses keep theirs", () => {
    expect(describeAuditValue(en, "status", "submitted")).toEqual({
      kind: "label",
      text: "Submitted",
      code: "submitted",
    });
    expect(describeAuditValue(ar, "status", "removed")).toEqual({ kind: "label", text: "مُزال", code: "removed" });
    expect(describeAuditValue(en, "status", "on_hold")).toEqual({ kind: "label", text: "On hold", code: "on_hold" });
    expect(describeAuditValue(en, "status", "galaxy").kind).toBe("untranslated");
  });

  it("P3 enum codes have labels (kind, action, link target type, acceptance, result); unknown codes stay marked", () => {
    expect(describeAuditValue(en, "kind", "waiver")).toEqual({ kind: "label", text: "Waiver", code: "waiver" });
    expect(describeAuditValue(ar, "kind", "inherited_approval")).toEqual({
      kind: "label",
      text: "اعتماد موروث",
      code: "inherited_approval",
    });
    expect(describeAuditValue(en, "action", "deselected")).toMatchObject({ kind: "label", text: "Deselected" });
    expect(describeAuditValue(en, "targetType", "tom_gap")).toMatchObject({ kind: "label", text: "T03 gap" });
    expect(describeAuditValue(en, "acceptance_status", "accepted")).toMatchObject({ kind: "label" });
    expect(describeAuditValue(en, "result", "accepted")).toMatchObject({ kind: "label", text: "Accepted" });
    expect(describeAuditValue(en, "kind", "capability").kind).toBe("untranslated");
    expect(describeAuditValue(en, "criterionCode", "feasibility")).toMatchObject({
      kind: "label",
      text: "Feasibility",
    });
    expect(describeAuditValue(en, "criterionCode", "luck").kind).toBe("untranslated");
  });

  it("decimal strings are shown exactly as recorded, never converted to numbers", () => {
    expect(describeAuditValue(en, "amount", "1250000.50")).toEqual({ kind: "code", text: "1250000.50" });
    expect(describeAuditValue(en, "score", "3.70")).toEqual({ kind: "code", text: "3.70" });
    expect(describeAuditValue(en, "fte", "0.25")).toEqual({ kind: "code", text: "0.25" });
  });

  it("booleans, structured values and the G1 agreements are readable, not marked", () => {
    expect(describeAuditValue(en, "isIllustrative", true)).toEqual({ kind: "label", text: "Yes", code: "true" });
    expect(describeAuditValue(ar, "isIllustrative", false)).toEqual({ kind: "label", text: "لا", code: "false" });
    expect(describeAuditValue(en, "agreements", ["problem", "baseline", "material_value_pools"])).toEqual({
      kind: "code",
      text: '["problem","baseline","material_value_pools"]',
    });
    expect(describeAuditChange(ar, "agreements", { from: null, to: ["problem"] }).label).toBe("اتفاق القيادة (G1)");
  });
});

// T-DG3-FE-E: BE-E's ACTUAL audit writes (apps/api/src/modules/portfolio/{funding,capacity,resource-demands}.ts), and
// the remaining P3 enum codes (FE-A §5.6), labelled in both languages.
describe("BE-E audit writes and the remaining P3 enums (T-DG3-FE-E)", () => {
  /** action -> the `changes` keys BE-E records for it (copied from the API source, 2026-10-08). */
  const BE_E_WRITES: Record<string, Record<string, { from: unknown; to: unknown }>> = {
    "funding_decision.create": {
      initiativeId: { from: null, to: "01920000-0000-7000-b000-000000000001" },
      decisionCode: { from: null, to: "DEC-07" },
      outcome: { from: null, to: "approved" },
      amount: { from: null, to: "1250000.5000" },
      currency: { from: null, to: "SAR" },
      approverRoleCode: { from: null, to: "FIN" },
    },
    "decision.create": {
      kind: { from: null, to: "executive" },
      code: { from: null, to: "DEC-07" },
      outcome: { from: null, to: "approved" },
    },
    "resource_role.create": {
      code: { from: null, to: "data_engineer" },
      label_en: { from: null, to: "Data engineer" },
      label_ar: { from: null, to: "مهندس بيانات" },
    },
    "resource_role.update": { label_en: { from: "Data engineer", to: "Senior data engineer" } },
    "resource_role.archive": { status: { from: "active", to: "archived" } },
    "capacity.create": {
      resource_role_id: { from: null, to: "01920000-0000-7000-aa00-000000000001" },
      period_month: { from: null, to: "2026-11-01" },
      available_fte: { from: null, to: "2.00" },
      owner_user_id: { from: null, to: "01920000-0000-7000-9000-000000000202" },
    },
    "capacity.update": { available_fte: { from: "2.00", to: "2.50" }, note: { from: null, to: "Synthetic" } },
    "capacity.archive": { status: { from: "active", to: "archived" } },
    "resource_demand.create": {
      initiative_id: { from: null, to: "01920000-0000-7000-b000-000000000001" },
      resource_role_id: { from: null, to: "01920000-0000-7000-aa00-000000000001" },
      period_month: { from: null, to: "2026-11-01" },
      demand_fte: { from: null, to: "2.50" },
      status: { from: null, to: "planned" },
    },
    "resource_demand.update": { demand_fte: { from: "2.50", to: "1.75" } },
    "resource_demand.archive": { status: { from: "planned", to: "archived" } },
    "resource_demand.commit": {
      status: { from: "planned", to: "committed" },
      committed_by: { from: null, to: "01920000-0000-7000-9000-000000000202" },
    },
    "resource_demand.release": { status: { from: "committed", to: "released" } },
    "initiative.fund": { status: { from: "selected", to: "funded" } },
    "initiative.unfund": { status: { from: "funded", to: "selected" } },
  };

  it.each(Object.keys(BE_E_WRITES))(
    "%s: the action, every field and every enum value are labelled (EN and AR)",
    (action) => {
      for (const t of [en, ar]) {
        expect(describeAuditAction(t, action, BE_E_WRITES[action])).toBeTruthy();
        for (const c of describeAuditChanges(t, BE_E_WRITES[action]!)) {
          expect(c.label, `${action} ${c.field}`).toBeTruthy();
          expect(c.from.kind, `${action} ${c.field} from`).not.toBe("untranslated");
          expect(c.to.kind, `${action} ${c.field} to`).not.toBe("untranslated");
        }
      }
    },
  );

  it("the funding approver role and the executive decision kind read as labels", () => {
    expect(describeAuditValue(en, "approverRoleCode", "FIN").kind).toBe("label");
    expect(describeAuditValue(en, "kind", "executive")).toEqual({
      kind: "label",
      text: "Executive decision",
      code: "executive",
    });
    expect(describeAuditValue(ar, "kind", "executive")).toEqual({
      kind: "label",
      text: "قرار تنفيذي",
      code: "executive",
    });
  });

  const ENUMS: Record<string, readonly string[]> = {
    line_kind: ["investment", "benefit"],
    benefit_class: ["revenue", "cost_reduction", "cost_avoidance", "working_capital", "strategic_non_financial"],
    investment_class: ["capex", "opex", "internal_fte", "vendor_cost", "opportunity_cost"],
    unit_kind: ["currency", "percentage", "count", "ratio", "duration", "score", "other"],
    polarity: ["higher_is_better", "lower_is_better", "within_band"],
    confidence: ["H", "M", "L"],
    result_kind: ["fraction", "fraction_delta", "percent_change", "count", "currency", "quantity", "number"],
    result_period: ["none", "month", "quarter", "year"],
    frequency: ["daily", "weekly", "monthly", "quarterly", "annual", "ad_hoc"],
    recurrence: ["one_off", "recurring"],
  };

  it.each(Object.keys(ENUMS))("%s: every code is a localized label in EN and AR, never the raw code", (field) => {
    for (const code of ENUMS[field]!) {
      const e = describeAuditValue(en, field, code);
      const a = describeAuditValue(ar, field, code);
      expect(e.kind, `${field}=${code}`).toBe("label");
      expect(a.kind, `${field}=${code}`).toBe("label");
      if (e.kind === "label" && a.kind === "label") {
        expect(e.text).not.toBe(a.text);
        expect(a.text).not.toMatch(/^[a-z_]+$/);
      }
    }
  });

  it("a char-padded confidence is trimmed; an unknown or dotted code stays marked", () => {
    expect(describeAuditValue(en, "confidence", "M ")).toEqual({ kind: "label", text: "Medium (M)", code: "M" });
    expect(describeAuditValue(en, "line_kind", "loan").kind).toBe("untranslated");
    expect(describeAuditValue(en, "polarity", "status.draft").kind).toBe("untranslated");
    expect(describeAuditValue(en, "frequency", 3).kind).toBe("untranslated");
  });

  it("result_unit and result_currency stay exact technical codes (free unit text, ISO 4217)", () => {
    expect(describeAuditValue(en, "resultUnit", "minutes")).toEqual({ kind: "code", text: "minutes" });
    expect(describeAuditValue(ar, "resultCurrency", "SAR")).toEqual({ kind: "code", text: "SAR" });
  });
});
