// The kpi G4 facts (T-DG3-KBE-C; ADR-0021 §7, ADR-0024 §5), unit level: the pure builder behind loadKpiP3GateFacts.
// Worked fixtures, all SYNTHETIC: one transformation case, two initiative cases, financial and non-financial benefit
// lines and formulas in every validation state. Stale is never validated; a line without a validated CURRENT version
// never reads as validated. The loader itself runs against PostgreSQL in test/integration/kpi/benefit-formulas.test.ts.
import type { BusinessCase } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { buildKpiP3GateFacts, formulaValidationOf, type FactFormula, type FactVersion } from "./p3-gate-facts.ts";

const TIMEOUT = 10_000;
const T = "01920000-0000-7000-8000-0000000000aa";

function kase(over: Partial<BusinessCase> & Pick<BusinessCase, "id" | "code" | "level">): BusinessCase {
  return {
    organizationId: "o",
    transformationId: T,
    initiativeId: null,
    parentCaseId: null,
    title: `Synthetic ${over.code}`,
    currency: "SAR",
    sections: {} as BusinessCase["sections"],
    missingSections: [],
    baselineValidation: "validated",
    baselineValidatedBy: null,
    baselineValidatedAt: null,
    baselineValidationNote: null,
    status: "draft",
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    version: 1,
    createdAt: "2026-10-08T00:00:00.000Z",
    createdBy: "u",
    updatedAt: "2026-10-08T00:00:00.000Z",
    updatedBy: "u",
    ...over,
  };
}

const benefit = (id: string, caseId: string, benefitClass: string, formulaId: string | null) => ({
  id,
  businessCaseId: caseId,
  lineKind: "benefit",
  benefitClass,
  valueBasis: benefitClass === "revenue" ? "revenue_uplift" : "cash_saving",
  title: `Synthetic line ${id}`,
  benefitFormulaId: formulaId,
});

describe("formulaValidationOf: only a validated CURRENT version counts", () => {
  const formulas = new Map<string, FactFormula>([
    ["f-current-validated", { id: "f-current-validated", code: "BF-01", status: "active", currentVersionNo: 2 }],
    ["f-old-validated", { id: "f-old-validated", code: "BF-02", status: "active", currentVersionNo: 2 }],
    ["f-rejected", { id: "f-rejected", code: "BF-03", status: "active", currentVersionNo: 1 }],
    ["f-no-version", { id: "f-no-version", code: "BF-04", status: "active", currentVersionNo: null }],
    ["f-archived", { id: "f-archived", code: "BF-05", status: "archived", currentVersionNo: 1 }],
  ]);
  const versions: FactVersion[] = [
    { id: "v1", formulaId: "f-current-validated", versionNo: 1, validationStatus: "unvalidated" },
    { id: "v2", formulaId: "f-current-validated", versionNo: 2, validationStatus: "validated" },
    // Version 1 was validated, but version 2 (current, unvalidated) replaced it: not validated.
    { id: "v3", formulaId: "f-old-validated", versionNo: 1, validationStatus: "validated" },
    { id: "v4", formulaId: "f-old-validated", versionNo: 2, validationStatus: "unvalidated" },
    { id: "v5", formulaId: "f-rejected", versionNo: 1, validationStatus: "rejected" },
    { id: "v6", formulaId: "f-archived", versionNo: 1, validationStatus: "validated" },
  ];
  it.each([
    ["f-current-validated", "validated", "v2"],
    ["f-old-validated", "unvalidated", "v4"],
    ["f-rejected", "rejected", "v5"],
    ["f-no-version", "no_current_version", null],
    ["f-archived", "formula_archived", null],
    ["f-unknown", "no_formula", null],
  ])(
    "%s -> %s",
    (formulaId, fact, versionId) => {
      const r = formulaValidationOf(formulaId, formulas, versions);
      expect([r.fact, r.version?.id ?? null]).toEqual([fact, versionId]);
    },
    TIMEOUT,
  );
  it(
    "a line without a formula is no_formula",
    () => {
      expect(formulaValidationOf(null, formulas, versions).fact).toBe("no_formula");
    },
    TIMEOUT,
  );
});

describe("buildKpiP3GateFacts", () => {
  it(
    "cases with section completeness and baseline state (incl. stale); financial benefit lines with their formula state",
    () => {
      const top = kase({ id: "c-top", code: "BC-01", level: "transformation", missingSections: ["risks"] });
      const ini2 = kase({
        id: "c-ini-2",
        code: "BC-03",
        level: "initiative",
        initiativeId: "ini-2",
        baselineValidation: "stale",
      });
      const ini1 = kase({ id: "c-ini-1", code: "BC-02", level: "initiative", initiativeId: "ini-1" });
      const archived = kase({
        id: "c-old",
        code: "BC-04",
        level: "initiative",
        initiativeId: "ini-3",
        status: "archived",
      });
      const facts = buildKpiP3GateFacts({
        transformationId: T,
        cases: [ini2, top, archived, ini1],
        lines: [
          benefit("l-1", "c-ini-1", "revenue", "f-1"),
          benefit("l-2", "c-ini-2", "cost_reduction", null),
          benefit("l-3", "c-ini-2", "strategic_non_financial", null), // non-financial: not listed
          { ...benefit("l-4", "c-top", "revenue", null), lineKind: "investment", benefitClass: null }, // investment
          benefit("l-5", "c-old", "revenue", "f-1"), // archived case: not listed
        ],
        formulas: [{ id: "f-1", code: "BF-01", status: "active", currentVersionNo: 1 }],
        versions: [{ id: "v-1", formulaId: "f-1", versionNo: 1, validationStatus: "validated" }],
      });
      expect(facts.transformationId).toBe(T);
      expect(facts.transformationCase).toMatchObject({
        id: "c-top",
        missingSections: ["risks"],
        baselineValidation: "validated",
        pointer: "/business-cases/c-top",
      });
      expect(facts.initiativeCases.map((c) => [c.code, c.initiativeId, c.baselineValidation])).toEqual([
        ["BC-02", "ini-1", "validated"],
        ["BC-03", "ini-2", "stale"],
      ]);
      expect(facts.benefitLines).toEqual([
        {
          lineId: "l-1",
          businessCaseId: "c-ini-1",
          initiativeId: "ini-1",
          title: "Synthetic line l-1",
          benefitClass: "revenue",
          valueBasis: "revenue_uplift",
          benefitFormulaId: "f-1",
          formulaCode: "BF-01",
          currentVersionNo: 1,
          currentVersionId: "v-1",
          formulaValidation: "validated",
          pointer: "/benefit-formulas/f-1/versions/1",
        },
        {
          lineId: "l-2",
          businessCaseId: "c-ini-2",
          initiativeId: "ini-2",
          title: "Synthetic line l-2",
          benefitClass: "cost_reduction",
          valueBasis: "cash_saving",
          benefitFormulaId: null,
          formulaCode: null,
          currentVersionNo: null,
          currentVersionId: null,
          formulaValidation: "no_formula",
          pointer: "/business-cases/c-ini-2/lines/l-2",
        },
      ]);
    },
    TIMEOUT,
  );

  it(
    "no cases: no transformation case (null), no initiative cases, no lines - never a default 'validated'",
    () => {
      const facts = buildKpiP3GateFacts({ transformationId: T, cases: [], lines: [], formulas: [], versions: [] });
      expect(facts).toEqual({ transformationId: T, transformationCase: null, initiativeCases: [], benefitLines: [] });
    },
    TIMEOUT,
  );
});
