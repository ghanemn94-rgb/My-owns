// The kpi_actual.v1 import template without a database (ADR-0056 §5, §9; T-DG6-KBE-A). The row rules, duplicates,
// commit and lineage run against PostgreSQL in apps/api/test/integration/kpi/import-target.test.ts.
import { describe, expect, it } from "vitest";
import {
  createKpiActualImportTarget,
  KPI_ACTUAL_IMPORT_COLUMNS,
  KPI_ACTUAL_TEMPLATE_VERSION,
  slotKeyOf,
} from "./import-target.ts";

describe("kpi_actual.v1 template (ADR-0056 §9)", () => {
  it("has the 15 columns of §9 in order, each key a template key, with en and ar labels", () => {
    expect(KPI_ACTUAL_IMPORT_COLUMNS.map((c) => c.key)).toEqual([
      "source_record_id",
      "kpi_id",
      "kpi_name",
      "scope_kind",
      "scope_id",
      "period_label",
      "value",
      "numerator",
      "denominator",
      "milestone_achieved",
      "achieved_on",
      "currency",
      "missing_reason",
      "data_as_of",
      "comment",
    ]);
    for (const c of KPI_ACTUAL_IMPORT_COLUMNS) {
      expect(c.key).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
      expect(c.labelEn.length).toBeGreaterThan(0);
      expect(c.labelAr).toMatch(/[؀-ۿ]/);
    }
  });

  it("requires the slot (KPI, scope, period) and data_as_of; every value column is optional (shape is a row rule)", () => {
    expect(KPI_ACTUAL_IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.key)).toEqual([
      "kpi_id",
      "scope_kind",
      "scope_id",
      "period_label",
      "data_as_of",
    ]);
    expect(KPI_ACTUAL_IMPORT_COLUMNS.filter((c) => c.kind === "decimal").map((c) => c.key)).toEqual([
      "value",
      "numerator",
      "denominator",
    ]);
    // kpi_name is informational by its label only: the contract's ImportTemplateColumn has no `informational` member.
    expect(KPI_ACTUAL_IMPORT_COLUMNS.find((c) => c.key === "kpi_name")).toEqual({
      key: "kpi_name",
      labelEn: "KPI name (ignored on import)",
      labelAr: "اسم المؤشر (يُتجاهل عند الاستيراد)",
      required: false,
      kind: "text",
      example: null,
    });
  });

  it("is the kpi_actual target, version 1, and needs kpi_actual.submit at commit", async () => {
    const t = createKpiActualImportTarget();
    expect([t.kind, t.templateVersion, KPI_ACTUAL_TEMPLATE_VERSION]).toEqual([
      "kpi_actual",
      "kpi_actual.v1",
      "kpi_actual.v1",
    ]);
    expect(t.requiredPermissions).toEqual(["kpi_actual.submit"]);
    expect(Object.isFrozen(t)).toBe(true);
    // The P5 form schema has no kpi_actual record type: no extension column is accepted.
    expect(await t.extensionColumns({} as never)).toEqual([]);
  });

  it("keys a row by the DG4 slot (kpi_actual_slot_key)", () => {
    expect(
      slotKeyOf(
        "0190a000-0000-7000-8000-000000000001",
        "transformation",
        "0190a000-0000-7000-8000-000000000002",
        "0190a000-0000-7000-8000-000000000003",
      ),
    ).toBe(
      "kpi_actual:0190a000-0000-7000-8000-000000000001:transformation:0190a000-0000-7000-8000-000000000002:0190a000-0000-7000-8000-000000000003",
    );
  });
});
