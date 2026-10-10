// P4 contract exercises of KBE-E (T-DG4-KBE-E; p4-work-split §B.3, §1 S-10): the 16 slice B operations of values,
// measurements, the Finance queue and decisions, corrections and totals; T-DG4-KBE-R3 adds getBenefitPlanValue (ADR-0030
// amendment P1). Every call of these operations goes through
// `ctx.mirrored` (OpenAPI status/body/headers + problem mirror) and every success body is parsed with the zod mirror in
// P4_MIRRORS_KBE_E. Set-up records (benefits at Measure, formulas, evidence) come from the shared fixtures. All data is
// synthetic; nothing here grants a real business or Finance approval or touches the engineering gates DG0-DG7.
import {
  benefit,
  benefitMeasurement,
  benefitMeasurementPage,
  benefitPlanValue,
  benefitTotals,
  benefitValues,
  financeValidation,
  financeValidationPage,
} from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import { ifm } from "../../support/p2-fixtures.ts";
import type { P4ExerciseContext } from "../../support/harness.ts";
import { benefitAt, financialBody, seedBenefitWorld } from "../benefits/fixtures.ts";
import {
  ALL_ACCEPTED,
  evidenceItem,
  queueItemOf,
  revenueFormula,
  runFinanceQueue,
} from "../benefits/value-fixtures.ts";

export const P4_MIRRORS_KBE_E: Readonly<Record<string, z.ZodType>> = {
  decideBenefitBaseline: benefit,
  getBenefitValues: benefitValues,
  createBenefitPlanValue: benefitPlanValue,
  getBenefitPlanValue: benefitPlanValue,
  updateBenefitPlanValue: benefitPlanValue,
  listBenefitMeasurements: benefitMeasurementPage,
  createBenefitMeasurement: benefitMeasurement,
  getBenefitMeasurement: benefitMeasurement,
  updateBenefitMeasurement: benefitMeasurement,
  submitBenefitMeasurement: benefitMeasurement,
  listFinanceValidationQueue: financeValidationPage,
  getFinanceValidation: financeValidation,
  decideFinanceValidation: financeValidation,
  amendFinanceValidation: financeValidation,
  reverseFinanceValidation: financeValidation,
  getBenefitTotals: benefitTotals,
  getPortfolioBenefitTotals: benefitTotals,
};

export async function exerciseP4KbeEOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const b = await seedBenefitWorld(ctx.api, ctx.world, m);
  const s = b.s;
  const formula = await revenueFormula(ctx.api, b, { send: m });
  const ben = await benefitAt(
    ctx.api,
    b,
    "measure",
    financialBody(b, {
      baselineValue: "1000000",
      baselineUnit: "SAR",
      targetValue: "1200000",
      benefitFormulaId: formula.id,
    }),
  );

  // ------------------------------------------------------------------ decideBenefitBaseline (ADR-0029 §8)
  const BL = `${b.base}/benefits/${ben.id}/baseline-validation`;
  expect(
    (await m("POST", BL, { session: s.bo, headers: ifm(ben.version), body: { decision: "validated" } })).status,
  ).toBe(403);
  expect((await m("POST", BL, { session: s.fin, body: { decision: "validated" } })).status).toBe(428);
  expect((await m("POST", BL, { session: s.fin, headers: ifm(99), body: { decision: "validated" } })).status).toBe(409);
  expect(
    (await m("POST", BL, { session: s.fin, headers: ifm(ben.version), body: { decision: "rejected" } })).status,
  ).toBe(422);
  expect((await m("POST", BL, { session: s.fin, headers: ifm(ben.version), body: { decision: "maybe" } })).status).toBe(
    400,
  );
  const bl = await m("POST", BL, { session: s.fin, headers: ifm(ben.version), body: { decision: "validated" } });
  expect([bl.status, bl.body.baselineValidationStatus]).toEqual([200, "validated"]);

  // ------------------------------------------------------------------ plan values and the value series (ADR-0030 §1, §6)
  const P = `${b.base}/benefits/${ben.id}/plan-values`;
  const planBody = { valueKind: "planned", periodStart: "2039-01-01", periodEnd: "2039-01-31", amount: "300000" };
  const pv = await m("POST", P, { session: s.bo, body: planBody });
  expect([pv.status, pv.headers.etag]).toEqual([201, '"1"']);
  expect((await m("POST", P, { session: s.bo, body: planBody })).status).toBe(409);
  expect((await m("POST", P, { session: s.auditor, body: planBody })).status).toBe(403);
  expect(
    (await m("POST", P, { session: s.bo, body: { ...planBody, periodStart: "2039-02-01", amount: undefined } })).status,
  ).toBe(422);
  expect((await m("POST", P, { session: s.bo, body: { valueKind: "upside" } })).status).toBe(400);
  const PV = `${b.base}/benefit-plan-values/${pv.body.id}`;
  // getBenefitPlanValue (ADR-0030 amendment P1; T-DG4-KBE-R3): the create's Location resolves to 200 with its ETag,
  // AUD reads it; outside the scope, an unknown id and a benefit id are 404; a malformed id is 400.
  expect(pv.headers.location).toBe(PV);
  const pvr = await m("GET", PV, { session: s.auditor });
  expect([pvr.status, pvr.headers.etag, pvr.body.version, pvr.body.valueKind]).toEqual([200, '"1"', 1, "planned"]);
  expect((await m("GET", PV, { session: s.outsider })).status).toBe(404);
  expect((await m("GET", `${b.base}/benefit-plan-values/${uuidv7()}`, { session: s.bo })).status).toBe(404);
  expect((await m("GET", `${b.base}/benefit-plan-values/${ben.id}`, { session: s.bo })).status).toBe(404);
  expect((await m("GET", `${b.base}/benefit-plan-values/not-a-uuid`, { session: s.bo })).status).toBe(400);
  expect((await m("PATCH", PV, { session: s.bo, body: { amount: "1" } })).status).toBe(428);
  expect((await m("PATCH", PV, { session: s.bo, headers: ifm(5), body: { amount: "1" } })).status).toBe(409);
  const pvu = await m("PATCH", PV, {
    session: s.bo,
    headers: { "if-match": pvr.headers.etag as string },
    body: { amount: "310000" },
  });
  expect([pvu.status, pvu.body.amount]).toEqual([200, "310000.0000"]);
  const pvr2 = await m("GET", PV, { session: s.bo });
  expect([pvr2.status, pvr2.headers.etag, pvr2.body.amount]).toEqual([200, '"2"', "310000.0000"]);
  const vals = await m("GET", `${b.base}/benefits/${ben.id}/values`, { session: s.auditor });
  expect([vals.status, vals.body.series.length]).toEqual([200, 7]);
  expect((await m("GET", `${b.base}/benefits/${ben.id}/values`, { session: s.outsider })).status).toBe(404);

  // ------------------------------------------------------------------ measurements (ADR-0030 §2, §3, §5)
  const M = `${b.base}/benefits/${ben.id}/measurements`;
  const draft = await m("POST", M, {
    session: s.bo,
    body: { periodStart: "2039-01-01", periodEnd: "2039-01-31", formulaVersionId: formula.versionId },
  });
  expect([draft.status, draft.body.amount, draft.body.inputs.length]).toEqual([201, "100000.0000", 4]);
  expect(
    (await m("POST", M, { session: s.bo, body: { periodStart: "2039-01-01", periodEnd: "2039-01-31", amount: "1" } }))
      .status,
  ).toBe(409);
  expect(
    (await m("POST", M, { session: s.bo, body: { periodStart: "2039-02-01", periodEnd: "2039-02-28" } })).status,
  ).toBe(422);
  expect((await m("POST", M, { session: s.auditor, body: { amount: "1" } })).status).toBe(403);
  expect((await m("POST", M, { session: s.bo, body: { amount: 1 } })).status).toBe(400);
  const MI = `${b.base}/benefit-measurements/${draft.body.id}`;
  expect((await m("GET", MI, { session: s.auditor })).status).toBe(200);
  expect((await m("GET", MI, { session: s.outsider })).status).toBe(404);
  const ev = await evidenceItem(ctx.api, b, m);
  expect((await m("PATCH", MI, { session: s.bo, body: { evidenceIds: [ev] } })).status).toBe(428);
  expect((await m("PATCH", MI, { session: s.bo, headers: ifm(4), body: { evidenceIds: [ev] } })).status).toBe(409);
  const upd = await m("PATCH", MI, {
    session: s.bo,
    headers: ifm(1),
    body: { evidenceIds: [ev], attribution: "Synthetic" },
  });
  expect([upd.status, upd.body.version]).toEqual([200, 2]);
  expect((await m("POST", `${MI}/submit`, { session: s.bo })).status).toBe(428);
  expect((await m("POST", `${MI}/submit`, { session: s.bo, headers: ifm(1) })).status).toBe(409);
  expect((await m("POST", `${MI}/submit`, { session: s.auditor, headers: ifm(2) })).status).toBe(403);
  const sub = await m("POST", `${MI}/submit`, { session: s.bo, headers: ifm(2) });
  expect([sub.status, sub.body.status]).toEqual([200, "submitted"]);
  expect((await m("POST", `${MI}/submit`, { session: s.bo, headers: ifm(3) })).status).toBe(422);
  expect((await m("PATCH", MI, { session: s.bo, headers: ifm(3), body: { attribution: "x" } })).status).toBe(422);
  const list = await m("GET", M, { session: s.auditor });
  expect([list.status, list.body.items.length]).toEqual([200, 1]);

  // ------------------------------------------------------------------ the Finance queue and decision (ADR-0030 §3, §4)
  await runFinanceQueue(ctx.api, draft.body.id);
  const item = (await queueItemOf(ctx.api, draft.body.id))!;
  const FVS = `${b.base}/finance-validations`;
  const queue = await m("GET", `${FVS}?status=queued`, { session: s.auditor });
  expect([queue.status, queue.body.items[0].id]).toEqual([200, item.id]);
  expect((await m("GET", `${FVS}?status=pending`, { session: s.auditor })).status).toBe(400);
  const FV = `${FVS}/${item.id}`;
  expect((await m("GET", FV, { session: s.auditor })).status).toBe(200);
  expect((await m("GET", FV, { session: s.outsider })).status).toBe(404);
  const approveBody = { decision: "approved", items: ALL_ACCEPTED, approvedAmount: "100000" };
  expect((await m("POST", `${FV}/decision`, { session: s.bo, headers: ifm(1), body: approveBody })).status).toBe(403);
  expect((await m("POST", `${FV}/decision`, { session: s.fin, body: approveBody })).status).toBe(428);
  expect((await m("POST", `${FV}/decision`, { session: s.fin, headers: ifm(3), body: approveBody })).status).toBe(409);
  const { measurementPeriod: _skip, ...five } = ALL_ACCEPTED;
  expect(
    (await m("POST", `${FV}/decision`, { session: s.fin, headers: ifm(1), body: { ...approveBody, items: five } }))
      .status,
  ).toBe(422);
  expect(
    (await m("POST", `${FV}/decision`, { session: s.fin, headers: ifm(1), body: { decision: "yes" } })).status,
  ).toBe(400);
  const decided = await m("POST", `${FV}/decision`, { session: s.fin, headers: ifm(1), body: approveBody });
  expect([decided.status, decided.body.status, decided.body.approvedAmount]).toEqual([200, "approved", "100000.0000"]);
  // The validated value is never edited in place: the BenefitValueConflict 409.
  const immutable = await m("PATCH", MI, { session: s.bo, headers: ifm(4), body: { attribution: "x" } });
  expect([immutable.status, immutable.body.code]).toEqual([409, "benefit_measurement.validated_immutable"]);

  // ------------------------------------------------------------------ corrections (ADR-0030 §4)
  const amend = await m("POST", `${FV}/amendments`, {
    session: s.fin,
    headers: ifm(decided.body.version),
    body: { correctedAmount: "99500", reason: "Synthetic correction" },
  });
  expect([amend.status, amend.body.approvedAmount]).toEqual([201, "-500.0000"]);
  expect(
    (
      await m("POST", `${FV}/amendments`, {
        session: s.fin,
        headers: ifm(decided.body.version),
        body: { correctedAmount: "99500", reason: "Synthetic correction" },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await m("POST", `${FV}/amendments`, {
        session: s.bo,
        headers: ifm(2),
        body: { correctedAmount: "1", reason: "abc" },
      })
    ).status,
  ).toBe(403);
  expect(
    (await m("POST", `${FV}/amendments`, { session: s.fin, body: { correctedAmount: "1", reason: "abc" } })).status,
  ).toBe(428);
  expect(
    (await m("POST", `${FV}/amendments`, { session: s.fin, headers: ifm(2), body: { correctedAmount: 1 } })).status,
  ).toBe(400);
  expect((await m("POST", `${FV}/reversals`, { session: s.fin, body: { reason: "Synthetic reversal" } })).status).toBe(
    428,
  );
  expect(
    (await m("POST", `${FV}/reversals`, { session: s.fin, headers: ifm(9), body: { reason: "Synthetic reversal" } }))
      .status,
  ).toBe(409);
  expect(
    (
      await m("POST", `${FV}/reversals`, {
        session: s.auditor,
        headers: ifm(2),
        body: { reason: "Synthetic reversal" },
      })
    ).status,
  ).toBe(403);
  expect((await m("POST", `${FV}/reversals`, { session: s.fin, headers: ifm(2), body: {} })).status).toBe(400);
  const rev = await m("POST", `${FV}/reversals`, {
    session: s.fin,
    headers: ifm(decided.body.version),
    body: { reason: "Synthetic reversal" },
  });
  expect([rev.status, rev.body.approvedAmount]).toEqual([201, "-99500.0000"]);
  expect(
    (
      await m("POST", `${FV}/reversals`, {
        session: s.fin,
        headers: ifm(decided.body.version),
        body: { reason: "Again please" },
      })
    ).status,
  ).toBe(422);
  expect(
    (await m("POST", `${FVS}/${uuidv7()}/reversals`, { session: s.fin, headers: ifm(1), body: { reason: "abc" } }))
      .status,
  ).toBe(404);

  // ------------------------------------------------------------------ totals (ADR-0030 §7)
  const T = `${b.base}/benefit-totals`;
  const totals = await m("GET", T, { session: s.auditor });
  expect([totals.status, totals.body.scope]).toEqual([200, "transformation"]);
  expect((await m("GET", T, { session: s.outsider })).status).toBe(404);
  expect((await m("GET", `${T}?initiativeId=not-a-uuid`, { session: s.auditor })).status).toBe(400);
  const O = `/api/v1/organizations/${b.organizationId}/benefit-totals`;
  const portfolio = await m("GET", O, { session: s.auditor });
  expect([portfolio.status, portfolio.body.scope]).toEqual([200, "organization"]);
  expect((await m("GET", O, { session: s.outsider })).status).toBe(404);
  expect((await m("GET", "/api/v1/organizations/not-a-uuid/benefit-totals", { session: s.auditor })).status).toBe(400);
}
