// P3 contract exercises of KBE-C (T-DG3-KBE-C; p3-work-split §5): the 13 T09 benefit-formula operations. Every call
// goes through `ctx.mirrored` (OpenAPI status/body/headers + problem mirror), and every success body is parsed with the
// benefit-formula zod mirror listed in P3_MIRRORS_KBE_C. All data is SYNTHETIC; the examples are illustrative
// calculations with synthetic values, and the Finance validation below is a demo decision by a synthetic FIN user that
// approves nothing real (product gates G1-G6 and DG0-DG7 are untouched).
import {
  benefitCalculation,
  benefitCalculationPage,
  benefitFormula,
  benefitFormulaExampleList,
  benefitFormulaPage,
  benefitFormulaVersion,
  benefitFormulaVersionList,
  formulaCheckResult,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import type { P3ExerciseContext } from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";
import { financeUser } from "./p3-exercises-kbe-b.ts";

export const P3_MIRRORS_KBE_C: Readonly<Record<string, z.ZodType>> = {
  listBenefitFormulaExamples: benefitFormulaExampleList,
  checkBenefitFormula: formulaCheckResult,
  listBenefitFormulas: benefitFormulaPage,
  createBenefitFormula: benefitFormula,
  getBenefitFormula: benefitFormula,
  updateBenefitFormula: benefitFormula,
  archiveBenefitFormula: benefitFormula,
  listBenefitFormulaVersions: benefitFormulaVersionList,
  createBenefitFormulaVersion: benefitFormulaVersion,
  getBenefitFormulaVersion: benefitFormulaVersion,
  listBenefitCalculations: benefitCalculationPage,
  createBenefitCalculation: benefitCalculation,
  validateBenefitFormulaVersion: benefitFormulaVersion,
};

/** The B0087 cost example's expression and variables (synthetic illustrative values). */
export const COST_VERSION = {
  expression: "eligible_volume * (baseline_unit_cost - target_unit_cost)",
  variables: [
    { name: "eligible_volume", kind: "count", unit: "transactions", period: "year", value: "200000" },
    { name: "baseline_unit_cost", kind: "currency", currency: "SAR", period: "none", value: "12.50" },
    { name: "target_unit_cost", kind: "currency", currency: "SAR", period: "none", value: "10.00" },
  ],
};

export async function exerciseP3KbeCOperations(ctx: P3ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const p = await setupP2World(ctx.api, ctx.world, m);
  const fin = await financeUser(ctx.api, ctx.world, p);
  const F = "/api/v1/benefit-formulas";

  const examples = await m("GET", "/api/v1/benefit-formula-examples", { session: p.auditor.session });
  expect(examples.status).toBe(200);
  expect(examples.body.items.map((e: { code: string }) => e.code)).toEqual(["revenue_uplift", "cost_reduction"]);

  const checked = await m("POST", `${F}/validate`, { session: p.lead.session, body: COST_VERSION });
  expect([checked.status, checked.body.result]).toEqual([200, "500000"]);
  expect(
    (await m("POST", `${F}/validate`, { session: p.lead.session, body: { ...COST_VERSION, expression: "x * 2" } }))
      .status,
  ).toBe(422);
  expect((await m("POST", `${F}/validate`, { session: p.auditor.session, body: COST_VERSION })).status).toBe(403);

  const created = await m("POST", F, {
    session: p.lead.session,
    body: {
      transformationId: p.transformationId,
      benefitName: "Synthetic revenue uplift",
      fromExample: "revenue_uplift",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body).toMatchObject({ code: "BF-01", isIllustrative: true, currentVersionNo: 1, confidence: "M" });
  const item = `${F}/${created.body.id}`;
  expect((await m("GET", item, { session: p.auditor.session })).status).toBe(200);
  const listed = await m("GET", `${F}?transformationId=${p.transformationId}&limit=5`, { session: p.auditor.session });
  expect(listed.body.items.map((f: { id: string }) => f.id)).toEqual([created.body.id]);
  expect((await m("PATCH", item, { session: p.lead.session, body: { ramp: "Q1-Q4" } })).status).toBe(428);
  const updated = await m("PATCH", item, {
    session: p.lead.session,
    headers: ifm(created.body.version),
    body: { confidence: "H" },
  });
  expect([updated.status, updated.body.isIllustrative]).toEqual([200, false]);

  const v2 = await m("POST", `${item}/versions`, {
    session: p.lead.session,
    headers: ifm(updated.body.version),
    body: { ...COST_VERSION, changeNote: "Synthetic: switch to the cost example." },
  });
  expect([v2.status, v2.body.versionNo, v2.body.previewResult]).toEqual([201, 2, "500000"]);
  const versions = await m("GET", `${item}/versions`, { session: p.auditor.session });
  expect(versions.body.items.map((v: { versionNo: number }) => v.versionNo)).toEqual([2, 1]);
  expect((await m("GET", `${item}/versions/1`, { session: p.auditor.session })).body.previewResult).toBe("100000");

  const calc = await m("POST", `${item}/versions/2/calculations`, {
    session: p.lead.session,
    body: { assumptions: "Synthetic volume.", periodStart: "2026-01-01", periodEnd: "2026-12-31" },
  });
  expect([calc.status, calc.body.result, calc.body.outcome]).toEqual([201, "500000", "ok"]);
  const page = await m("GET", `${item}/versions/2/calculations?limit=5`, { session: p.auditor.session });
  expect(page.body.items.map((c: { id: string }) => c.id)).toEqual([calc.body.id]);

  const validated = await m("POST", `${item}/versions/2/validation`, {
    session: fin.session,
    headers: ifm(1),
    body: { result: "validated", note: "Synthetic demo validation; approves nothing real." },
  });
  expect([validated.status, validated.body.validationStatus]).toEqual([200, "validated"]);

  const second = await m("POST", F, {
    session: p.lead.session,
    body: { transformationId: p.transformationId, benefitName: "Synthetic to archive" },
  });
  expect([second.status, second.body.currentVersion]).toEqual([201, null]);
  const archived = await m("POST", `${F}/${second.body.id}/archive`, {
    session: p.lead.session,
    headers: ifm(1),
    body: { reason: "Synthetic duplicate" },
  });
  expect([archived.status, archived.body.status]).toEqual([200, "archived"]);
}
