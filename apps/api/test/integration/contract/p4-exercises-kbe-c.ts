// P4 contract exercises of KBE-C (T-DG4-KBE-C; p4-work-split §A.3, §1 S-10): every operation it routes, through
// `ctx.mirrored` (OpenAPI status/body/headers + problem mirror), each success body parsed with its zod mirror below.
// T-DG4-KBE-R2 adds listTransformationReportingPeriods (ADR-0027 amendment A1). First item (D-095): requestKpiVersionApproval, carried from KBE-B (its pending list is now empty). All data is
// SYNTHETIC; the approval requested here is a synthetic in-product business approval that nobody decides, and nothing
// touches the engineering gates DG0-DG7.
import {
  approval,
  calculationRun,
  calculationRunPage,
  kpiActual,
  kpiActualPage,
  kpiActualSubmission,
  kpiStatus,
  kpiStatusPage,
  ragOverride,
  ragOverridePage,
  reportingPeriod,
  reportingPeriodPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import type { P4ExerciseContext } from "../../support/harness.ts";
import { call, signIn } from "../../support/harness.ts";
import { seedKpiWorld } from "../kpi/fixtures.ts";
import { createKpi, FLOW_VERSION, ifMatch, postVersion } from "../kpi-p4/kbe-b-fixtures.ts";
import {
  DIRECT_FLOW,
  evidenceItem,
  monthlyPeriod,
  ownedKpi,
  REVIEW_FLOW,
  runRecalculation,
} from "../kpi-p4/kbe-c-fixtures.ts";

export const P4_MIRRORS_KBE_C: Readonly<Record<string, z.ZodType>> = {
  requestKpiVersionApproval: approval,
  listReportingPeriods: reportingPeriodPage,
  listTransformationReportingPeriods: reportingPeriodPage,
  createReportingPeriod: reportingPeriod,
  getReportingPeriod: reportingPeriod,
  openReportingPeriod: reportingPeriod,
  closeReportingPeriod: reportingPeriod,
  listKpiActuals: kpiActualPage,
  submitKpiActual: kpiActualSubmission,
  getKpiActual: kpiActual,
  addKpiActualValue: kpiActualSubmission,
  submitKpiActualDraft: kpiActualSubmission,
  acceptKpiActual: kpiActual,
  rejectKpiActual: kpiActual,
  listKpiActualReviewQueue: kpiActualPage,
  listCalculationRuns: calculationRunPage,
  getCalculationRun: calculationRun,
  listKpiStatus: kpiStatusPage,
  getKpiStatus: kpiStatus,
  listRagOverrides: ragOverridePage,
  createRagOverride: ragOverride,
  revokeRagOverride: ragOverride,
};

export async function exerciseP4KbeCOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const k = await seedKpiWorld(ctx.api, ctx.world);
  const b = k.base;

  // ------------------------------------------------------------------ requestKpiVersionApproval (ADR-0027 §2 step 3)
  const mapped = await call(ctx.api.app, "POST", `${b}/role-mappings`, {
    session: k.s.tl,
    body: { partyCode: "BO", targetKind: "user", userId: k.users.bo.id },
  });
  expect(mapped.status, JSON.stringify(mapped.body)).toBe(201);
  const kpi = await createKpi(ctx.api, k, { name: "Contract KPI under business approval" });
  const draft = await postVersion(ctx.api, k, kpi.id, { ...FLOW_VERSION, definitionApproval: "business_approval" });
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  const AR = `${b}/kpi-versions/${draft.body.id}/approval-requests`;
  expect((await m("POST", AR, { session: k.s.auditor, headers: ifMatch(1), body: {} })).status).toBe(403);
  expect((await m("POST", AR, { session: k.s.kds, body: {} })).status).toBe(428);
  expect((await m("POST", AR, { session: k.s.kds, headers: ifMatch(9), body: {} })).status).toBe(409);
  expect((await m("POST", AR, { session: k.s.kds, headers: ifMatch(1), body: { other: 1 } })).status).toBe(400);
  const requested = await m("POST", AR, { session: k.s.kds, headers: ifMatch(1), body: { requestNote: "Synthetic" } });
  expect([requested.status, requested.body.status], JSON.stringify(requested.body)).toEqual([201, "pending"]);
  const again = await m("POST", AR, { session: k.s.kds, headers: ifMatch(1), body: {} });
  expect([again.status, again.body.code]).toEqual([409, "approval.already_open"]);
  const direct = await postVersion(ctx.api, k, (await createKpi(ctx.api, k)).id, FLOW_VERSION);
  expect(
    (
      await m("POST", `${b}/kpi-versions/${direct.body.id}/approval-requests`, {
        session: k.s.kds,
        headers: ifMatch(1),
        body: {},
      })
    ).status,
  ).toBe(422);

  // ------------------------------------------------------------------ reporting periods (ADR-0027 §3)
  const to = await signIn(ctx.api.app, ctx.world.office.subject);
  const RP = `/api/v1/organizations/${ctx.world.orgA.id}/reporting-periods`;
  expect((await m("POST", RP, { session: k.s.auditor, body: {} })).status).toBe(403);
  expect((await m("POST", RP, { session: to, body: { frequency: "monthly" } })).status).toBe(400);
  expect(
    (
      await m("POST", RP, {
        session: to,
        body: { frequency: "annual", periodLabel: "CT-BAD", periodStart: "2060-02-01", periodEnd: "2060-01-01" },
      })
    ).status,
  ).toBe(422);
  const created = await m("POST", RP, {
    session: to,
    body: { frequency: "quarterly", periodLabel: "2061-Q1", periodStart: "2061-01-01", periodEnd: "2061-03-31" },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(
    (
      await m("POST", RP, {
        session: to,
        body: { frequency: "quarterly", periodLabel: "2061-Q1", periodStart: "2062-01-01", periodEnd: "2062-03-31" },
      })
    ).status,
  ).toBe(409);
  const RPI = `${RP}/${created.body.id}`;
  expect((await m("GET", RP, { session: k.s.auditor })).status).toBe(200);
  expect((await m("GET", RPI, { session: k.s.auditor })).status).toBe(200);
  expect((await m("POST", `${RPI}/open`, { session: to })).status).toBe(428);
  expect((await m("POST", `${RPI}/close`, { session: to, headers: ifMatch(1) })).status).toBe(422);
  expect((await m("POST", `${RPI}/open`, { session: to, headers: ifMatch(9) })).status).toBe(409);
  expect((await m("POST", `${RPI}/open`, { session: to, headers: ifMatch(1) })).status).toBe(200);
  expect((await m("POST", `${RPI}/close`, { session: to, headers: ifMatch(2) })).status).toBe(200);

  // ------------------------------------------------------------------ listTransformationReportingPeriods (ADR-0027
  // amendment A1; T-DG4-KBE-R2): the Lead and the KPI owner (KDS) hold only transformation.read; same page as the
  // organization list; AUD reads; outsiders 404.
  const TRP = `${b}/reporting-periods`;
  expect((await m("GET", RP, { session: k.s.tl })).status).toBe(404);
  const orgPage = await m("GET", `${RP}?frequency=quarterly&status=closed`, { session: to });
  for (const session of [k.s.tl, k.s.kds, k.s.auditor]) {
    const tPage = await m("GET", `${TRP}?frequency=quarterly&status=closed`, { session });
    expect(tPage.status, JSON.stringify(tPage.body)).toBe(200);
    expect(tPage.body).toEqual(orgPage.body);
    expect(tPage.body.items.map((p: { id: string }) => p.id)).toContain(created.body.id);
  }
  expect((await m("GET", TRP, { session: k.s.outsider })).status).toBe(404);
  expect((await m("GET", `${TRP}?frequency=hourly`, { session: k.s.tl })).status).toBe(400);

  // ------------------------------------------------------------------ actuals (ADR-0027 §6)
  const period = await monthlyPeriod(ctx.api, ctx.world);
  const directKpi = await ownedKpi(ctx.api, k, DIRECT_FLOW);
  const review = await ownedKpi(ctx.api, k, REVIEW_FLOW);
  const A = (id: string) => `${b}/kpi-definitions/${id}/actuals`;
  const entry = {
    scopeKind: "transformation",
    scopeId: k.transformationId,
    reportingPeriodId: period.id,
    dataAsOf: period.end,
  };
  expect(
    (await m("POST", A(directKpi.id), { session: k.s.auditor, body: { ...entry, action: "submit", value: "1" } }))
      .status,
  ).toBe(403);
  expect(
    (await m("POST", A(directKpi.id), { session: k.s.kds, body: { ...entry, action: "submit", value: 1 } })).status,
  ).toBe(400);
  expect((await m("POST", A(directKpi.id), { session: k.s.kds, body: { ...entry, action: "submit" } })).status).toBe(
    422,
  );
  const accepted = await m("POST", A(directKpi.id), {
    session: k.s.kds,
    body: { ...entry, action: "submit", value: "12" },
  });
  expect([accepted.status, accepted.body.actual?.status], JSON.stringify(accepted.body)).toEqual([201, "accepted"]);
  expect(
    (await m("POST", A(directKpi.id), { session: k.s.kds, body: { ...entry, action: "submit", value: "13" } })).status,
  ).toBe(409);
  expect((await m("GET", A(directKpi.id), { session: k.s.auditor })).status).toBe(200);
  const AI = (id: string) => `${b}/kpi-actuals/${id}`;
  expect((await m("GET", AI(accepted.body.actual.id), { session: k.s.auditor })).status).toBe(200);
  // A draft, then submit it (the review route), then reject and accept the corrected value.
  const evidenceId = await evidenceItem(ctx.api, k);
  const draftSlot = await m("POST", A(review.id), {
    session: k.s.kds,
    body: { ...entry, action: "save_draft", value: "5", evidenceIds: [evidenceId] },
  });
  expect([draftSlot.status, draftSlot.body.actual?.status], JSON.stringify(draftSlot.body)).toEqual([201, "draft"]);
  const d = draftSlot.body.actual;
  expect((await m("POST", `${AI(d.id)}/submit`, { session: k.s.kds })).status).toBe(428);
  expect(
    (await m("POST", `${AI(d.id)}/accept`, { session: k.s.bo, headers: ifMatch(d.version), body: {} })).status,
  ).toBe(422);
  const submitted = await m("POST", `${AI(d.id)}/submit`, { session: k.s.kds, headers: ifMatch(d.version) });
  expect([submitted.status, submitted.body.reviewPending], JSON.stringify(submitted.body)).toEqual([200, true]);
  const queue = await m("GET", `${b}/kpi-actual-reviews`, { session: k.s.bo });
  expect([queue.status, queue.body.items.length]).toEqual([200, 1]);
  const sv = submitted.body.actual.version;
  expect(
    (
      await m("POST", `${AI(d.id)}/reject`, {
        session: k.s.sp,
        headers: ifMatch(sv),
        body: { reason: "Synthetic: not mine" },
      })
    ).status,
  ).toBe(403);
  const rejected = await m("POST", `${AI(d.id)}/reject`, {
    session: k.s.bo,
    headers: ifMatch(sv),
    body: { reason: "Synthetic: wrong source" },
  });
  expect([rejected.status, rejected.body.status], JSON.stringify(rejected.body)).toEqual([200, "rejected"]);
  expect(
    (
      await m("POST", `${AI(d.id)}/values`, {
        session: k.s.kds,
        body: { action: "submit", value: "6", dataAsOf: period.end },
      })
    ).status,
  ).toBe(428);
  const corrected = await m("POST", `${AI(d.id)}/values`, {
    session: k.s.kds,
    headers: ifMatch(rejected.body.version),
    body: { action: "submit", value: "6", dataAsOf: period.end, evidenceIds: [evidenceId] },
  });
  expect([corrected.status, corrected.body.actual?.currentValueNo], JSON.stringify(corrected.body)).toEqual([200, 2]);
  const acc = await m("POST", `${AI(d.id)}/accept`, {
    session: k.s.bo,
    headers: ifMatch(corrected.body.actual.version),
    body: { comment: "Synthetic check" },
  });
  expect([acc.status, acc.body.status], JSON.stringify(acc.body)).toEqual([200, "accepted"]);

  // ------------------------------------------------------------------ runs and status (ADR-0027 §7; ADR-0028 §6)
  await runRecalculation(ctx.api, accepted.body.actual.id);
  const runs = await m("GET", `${b}/calculation-runs?kpiDefinitionId=${directKpi.id}`, { session: k.s.auditor });
  expect([runs.status, runs.body.items.length]).toEqual([200, 1]);
  expect((await m("GET", `${b}/calculation-runs/${runs.body.items[0].id}`, { session: k.s.auditor })).status).toBe(200);
  expect((await m("GET", `${b}/calculation-runs/${period.id}`, { session: k.s.auditor })).status).toBe(404);
  const st = await m("GET", `${b}/kpi-definitions/${directKpi.id}/status`, { session: k.s.auditor });
  expect([st.status, st.body.actual], JSON.stringify(st.body)).toEqual([200, "12"]);
  expect((await m("GET", `${b}/kpi-status`, { session: k.s.auditor })).status).toBe(200);

  // ------------------------------------------------------------------ RAG overrides (ADR-0027 §10)
  const O = `${b}/kpi-definitions/${directKpi.id}/rag-overrides`;
  const ov = {
    scopeKind: "transformation",
    scopeId: k.transformationId,
    reportingPeriodId: period.id,
    overrideRag: "amber",
    reason: "Synthetic: data delayed",
    evidenceId,
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };
  expect((await m("POST", O, { session: k.s.auditor, body: ov })).status).toBe(403);
  expect((await m("POST", O, { session: k.s.tl, body: { ...ov, expiresAt: null } })).status).toBe(422);
  const override = await m("POST", O, { session: k.s.tl, body: ov });
  expect([override.status, override.body.inForce], JSON.stringify(override.body)).toEqual([201, true]);
  expect((await m("POST", O, { session: k.s.tl, body: ov })).status).toBe(409);
  expect((await m("GET", O, { session: k.s.auditor })).status).toBe(200);
  const R = `${b}/rag-overrides/${override.body.id}/revoke`;
  expect((await m("POST", R, { session: k.s.tl, body: { reason: "Synthetic" } })).status).toBe(428);
  const revoked = await m("POST", R, {
    session: k.s.tl,
    headers: ifMatch(1),
    body: { reason: "Synthetic: data arrived" },
  });
  expect([revoked.status, revoked.body.status]).toEqual([200, "revoked"]);
  expect(
    (await m("POST", R, { session: k.s.tl, headers: ifMatch(2), body: { reason: "Synthetic again" } })).status,
  ).toBe(422);
}
