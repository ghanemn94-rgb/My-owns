// Audit-trail changes are shown with localized labels in Arabic and English (F-DG1-005, REQ-S15-007, M0302).
import { describe, expect, it } from "vitest";
import { PHASES, STANDALONE_DELIVERABLE_TYPES, TRANSFORMATION_MODES, TRANSFORMATION_STATUSES } from "@mth/shared";
import { createI18n } from "../i18n/index.ts";
import { auditFieldKey, describeAuditChange, describeAuditChanges, describeAuditValue } from "./auditChanges.ts";

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
