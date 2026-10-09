// P4 contract exercises of KBE-D2 (T-DG4-KBE-D2; p4-work-split §B.2, §1 S-10): the 13 slice B operations of overlap
// warnings, scenarios and valuation methods. Every call goes through `ctx.mirrored` (OpenAPI status/body/headers +
// problem mirror) and every success body is parsed with the zod mirror in P4_MIRRORS_KBE_D2. All data is synthetic;
// nothing here grants a real business or Finance approval or touches the engineering gates DG0-DG7.
import {
  benefitOverlap,
  benefitOverlapPage,
  benefitScenario,
  benefitScenarioPage,
  benefitScenarioValue,
  benefitValuationMethod,
  benefitValuationMethodPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { ifm } from "../../support/p2-fixtures.ts";
import type { P4ExerciseContext } from "../../support/harness.ts";
import { cxBody, financialBody, seedBenefitWorld } from "../benefits/fixtures.ts";

export const P4_MIRRORS_KBE_D2: Readonly<Record<string, z.ZodType>> = {
  listBenefitOverlaps: benefitOverlapPage,
  createBenefitOverlap: benefitOverlap,
  getBenefitOverlap: benefitOverlap,
  resolveBenefitOverlap: benefitOverlap,
  listBenefitScenarios: benefitScenarioPage,
  createBenefitScenario: benefitScenario,
  getBenefitScenario: benefitScenario,
  updateBenefitScenario: benefitScenario,
  createBenefitScenarioValue: benefitScenarioValue,
  updateBenefitScenarioValue: benefitScenarioValue,
  listBenefitValuationMethods: benefitValuationMethodPage,
  createBenefitValuationMethod: benefitValuationMethod,
  decideBenefitValuationMethod: benefitValuationMethod,
};

export async function exerciseP4KbeD2Operations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const b = await seedBenefitWorld(ctx.api, ctx.world, m);
  const s = b.s;
  const B = `${b.base}/benefits`;

  // ------------------------------------------------------------------ overlap warnings (ADR-0029 §7)
  const O = `${b.base}/benefit-overlaps`;
  const one = await m("POST", B, { session: s.bo, body: financialBody(b, { driverKey: "synthetic.churn" }) });
  const two = await m("POST", B, { session: s.bo, body: financialBody(b, { driverKey: "synthetic.churn" }) });
  expect([one.status, two.status]).toEqual([201, 201]);
  const listed = await m("GET", `${O}?status=open`, { session: s.auditor });
  expect(listed.status).toBe(200);
  const ruleWarning = (listed.body.items as { id: string; detectedBy: string }[])[0]!;
  expect(ruleWarning.detectedBy).toBe("rule");
  const got = await m("GET", `${O}/${ruleWarning.id}`, { session: s.auditor });
  expect([got.status, got.headers.etag]).toEqual([200, '"1"']);
  expect((await m("GET", `${O}/${ruleWarning.id}`, { session: s.outsider })).status).toBe(404);
  const R = `${O}/${ruleWarning.id}/resolve`;
  expect(
    (await m("POST", R, { session: s.bo, headers: ifm(1), body: { resolution: "no_economic_overlap", note: "x y z" } }))
      .status,
  ).toBe(403);
  expect(
    (await m("POST", R, { session: s.fin, body: { resolution: "no_economic_overlap", note: "Synthetic" } })).status,
  ).toBe(428);
  expect(
    (
      await m("POST", R, {
        session: s.fin,
        headers: ifm(9),
        body: { resolution: "no_economic_overlap", note: "Synthetic" },
      })
    ).status,
  ).toBe(409);
  expect(
    (await m("POST", R, { session: s.fin, headers: ifm(1), body: { resolution: "duplicate", note: "Synthetic" } }))
      .status,
  ).toBe(422);
  expect((await m("POST", R, { session: s.fin, headers: ifm(1), body: { resolution: "merge" } })).status).toBe(400);
  const resolved = await m("POST", R, {
    session: s.fin,
    headers: ifm(1),
    body: { resolution: "duplicate", excludedBenefitId: two.body.id, note: "Synthetic duplicate claim" },
  });
  expect([resolved.status, resolved.body.status]).toEqual([200, "resolved"]);
  const three = await m("POST", B, { session: s.bo, body: financialBody(b) });
  const raised = await m("POST", O, {
    session: s.tl,
    body: { benefitAId: one.body.id, benefitBId: three.body.id, dimensions: ["population"] },
  });
  expect([raised.status, raised.body.detectedBy]).toEqual([201, "user"]);
  expect(
    (
      await m("POST", O, {
        session: s.tl,
        body: { benefitAId: one.body.id, benefitBId: three.body.id, dimensions: ["population"] },
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await m("POST", O, {
        session: s.tl,
        body: { benefitAId: one.body.id, benefitBId: one.body.id, dimensions: ["driver"] },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await m("POST", O, {
        session: s.auditor,
        body: { benefitAId: one.body.id, benefitBId: three.body.id, dimensions: ["driver"] },
      })
    ).status,
  ).toBe(403);

  // ------------------------------------------------------------------ valuation methods (ADR-0029 §8)
  const M = `${b.base}/benefit-valuation-methods`;
  const vm = await m("POST", M, {
    session: s.bo,
    body: {
      name: "Synthetic NPS point value",
      method: "SAR per NPS point (synthetic)",
      appliesToType: "cx",
      unitValue: "1000",
      currency: "SAR",
    },
  });
  expect([vm.status, vm.body.status]).toEqual([201, "proposed"]);
  expect(
    (await m("POST", M, { session: s.fin, body: { name: "x", method: "y", appliesToType: "cx", currency: "SAR" } }))
      .status,
  ).toBe(403);
  expect(
    (
      await m("POST", M, {
        session: s.bo,
        body: { name: "x", method: "y", appliesToType: "cx", currency: "SAR", unitValue: 1 },
      })
    ).status,
  ).toBe(400);
  const D = `${M}/${vm.body.id}/decision`;
  expect((await m("POST", D, { session: s.bo, headers: ifm(1), body: { decision: "approved" } })).status).toBe(403);
  expect((await m("POST", D, { session: s.fin, body: { decision: "approved" } })).status).toBe(428);
  expect((await m("POST", D, { session: s.fin, headers: ifm(3), body: { decision: "approved" } })).status).toBe(409);
  expect((await m("POST", D, { session: s.fin, headers: ifm(1), body: { decision: "retired" } })).status).toBe(422);
  const approved = await m("POST", D, { session: s.fin, headers: ifm(1), body: { decision: "approved" } });
  expect([approved.status, approved.body.status]).toEqual([200, "approved"]);
  expect((await m("GET", M, { session: s.auditor })).status).toBe(200);

  // ------------------------------------------------------------------ scenarios (ADR-0029 §10)
  const S = `${b.base}/benefit-scenarios`;
  const sc = await m("POST", S, {
    session: s.tl,
    body: { kind: "upside", title: "Synthetic upside", assumptions: "Synthetic" },
  });
  expect([sc.status, sc.body.kind]).toEqual([201, "upside"]);
  expect((await m("POST", S, { session: s.fin, body: { kind: "upside", title: "Second upside" } })).status).toBe(409);
  expect((await m("POST", S, { session: s.bo, body: { kind: "base", title: "x" } })).status).toBe(403);
  expect((await m("GET", S, { session: s.auditor })).status).toBe(200);
  const SI = `${S}/${sc.body.id}`;
  const value = await m("POST", `${SI}/values`, {
    session: s.fin,
    body: { benefitId: one.body.id, periodStart: "2026-01-01", periodEnd: "2026-12-31", amount: "7777777" },
  });
  expect([value.status, value.body.scenarioKind]).toEqual([201, "upside"]);
  const cx = await m("POST", B, { session: s.bo, body: cxBody(b) });
  expect(
    (
      await m("POST", `${SI}/values`, {
        session: s.tl,
        body: { benefitId: cx.body.id, periodStart: "2026-01-01", periodEnd: "2026-12-31", amount: "1" },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await m("POST", `${SI}/values`, {
        session: s.tl,
        body: { benefitId: one.body.id, periodStart: "2026-01-01", periodEnd: "2026-03-31", amount: "1" },
      })
    ).status,
  ).toBe(409);
  expect(
    (await m("POST", `${SI}/values`, { session: s.tl, body: { benefitId: one.body.id, periodStart: "2026-01-01" } }))
      .status,
  ).toBe(400);
  const VI = `${b.base}/benefit-scenario-values/${value.body.id}`;
  expect((await m("PATCH", VI, { session: s.tl, body: { amount: "1" } })).status).toBe(428);
  expect((await m("PATCH", VI, { session: s.tl, headers: ifm(4), body: { amount: "1" } })).status).toBe(409);
  const changed = await m("PATCH", VI, { session: s.tl, headers: ifm(1), body: { amount: "7000000" } });
  expect([changed.status, changed.body.amount]).toEqual([200, "7000000.0000"]);
  const read = await m("GET", SI, { session: s.auditor });
  expect([read.status, read.headers.etag, (read.body.values as unknown[]).length]).toEqual([200, '"1"', 1]);
  expect((await m("PATCH", SI, { session: s.tl, body: { title: "x" } })).status).toBe(428);
  expect((await m("PATCH", SI, { session: s.tl, headers: ifm(1), body: {} })).status).toBe(400);
  const renamed = await m("PATCH", SI, { session: s.tl, headers: ifm(1), body: { title: "Synthetic upside renamed" } });
  expect([renamed.status, renamed.body.version]).toEqual([200, 2]);
  const archived = await m("PATCH", SI, {
    session: s.tl,
    headers: ifm(2),
    body: { archiveReason: "Synthetic archive" },
  });
  expect([archived.status, archived.body.status]).toEqual([200, "archived"]);
  expect((await m("PATCH", SI, { session: s.tl, headers: ifm(3), body: { title: "late" } })).status).toBe(422);
}
