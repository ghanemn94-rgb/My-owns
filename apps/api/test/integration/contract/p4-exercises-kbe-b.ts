// P4 contract exercises of KBE-B (T-DG4-KBE-B; p4-work-split §A.2, §1 S-10): the 18 slice A operations it routes (KPI
// dictionary v2, KPI versions, RAG thresholds, target trajectories, data-quality findings). Every call goes through
// `ctx.mirrored` (OpenAPI status/body/headers + problem mirror) and every success body is parsed with the zod mirror in
// P4_MIRRORS_KBE_B. requestKpiVersionApproval stays pending (BE-B's approval service; p4-pending-kbe-b.ts). All data is
// synthetic; the trajectory approval below is a synthetic in-product business approval by a seeded SP user, not a
// real one, and nothing touches the engineering gates DG0-DG7.
import {
  dataQualityFinding,
  dataQualityFindingPage,
  kpiDictionaryEntry,
  kpiDictionaryPage,
  kpiRagThreshold,
  kpiRagThresholdPage,
  kpiVersion,
  kpiVersionPage,
  targetTrajectory,
  targetTrajectoryPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import type { P4ExerciseContext } from "../../support/harness.ts";
import { seedKpiWorld } from "../kpi/fixtures.ts";
import { createKpi, ifMatch, insertFinding } from "../kpi-p4/kbe-b-fixtures.ts";

export const P4_MIRRORS_KBE_B: Readonly<Record<string, z.ZodType>> = {
  listKpiDictionary: kpiDictionaryPage,
  getKpiDictionaryEntry: kpiDictionaryEntry,
  listKpiVersions: kpiVersionPage,
  createKpiVersion: kpiVersion,
  getKpiVersion: kpiVersion,
  updateKpiVersion: kpiVersion,
  activateKpiVersion: kpiVersion,
  withdrawKpiVersion: kpiVersion,
  listKpiRagThresholds: kpiRagThresholdPage,
  createKpiRagThreshold: kpiRagThreshold,
  listTargetTrajectories: targetTrajectoryPage,
  createTargetTrajectory: targetTrajectory,
  getTargetTrajectory: targetTrajectory,
  approveTargetTrajectory: targetTrajectory,
  withdrawTargetTrajectory: targetTrajectory,
  listDataQualityFindings: dataQualityFindingPage,
  getDataQualityFinding: dataQualityFinding,
  resolveDataQualityFinding: dataQualityFinding,
};

export async function exerciseP4KbeBOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const k = await seedKpiWorld(ctx.api, ctx.world);
  const b = k.base;
  const kpi = await createKpi(ctx.api, k, { name: "Contract prepaid activations" });

  // ------------------------------------------------------------------ KPI versions (ADR-0027 §1-§2)
  const V = `${b}/kpi-definitions/${kpi.id}/versions`;
  // Declared problems first: AUD 403, the empty body 400, a measure that does not fit the polarity 422.
  expect(
    (await m("POST", V, { session: k.s.auditor, body: { measureType: "higher_is_better", valueNature: "flow" } }))
      .status,
  ).toBe(403);
  expect((await m("POST", V, { session: k.s.kds, body: {} })).status).toBe(400);
  expect(
    (await m("POST", V, { session: k.s.kds, body: { measureType: "lower_is_better", valueNature: "flow" } })).status,
  ).toBe(422);
  const draft = await m("POST", V, {
    session: k.s.kds,
    body: { measureType: "higher_is_better", valueNature: "flow", submissionRoute: "direct_accept" },
  });
  expect([draft.status, draft.body.status, draft.body.aggregationRule], JSON.stringify(draft.body)).toEqual([
    201,
    "draft",
    null,
  ]);
  // A second draft is 409 kpi_version.draft_exists.
  expect(
    (await m("POST", V, { session: k.s.kds, body: { measureType: "higher_is_better", valueNature: "flow" } })).status,
  ).toBe(409);
  const VI = `${b}/kpi-versions/${draft.body.id}`;
  expect((await m("GET", VI, { session: k.s.auditor })).status).toBe(200);
  expect((await m("GET", V, { session: k.s.auditor })).status).toBe(200);
  // Activation without an aggregation rule: 422 (D-089 Q1); then 428, 409 and the update.
  expect((await m("POST", `${VI}/activate`, { session: k.s.kds, headers: ifMatch(1) })).status).toBe(422);
  expect((await m("PATCH", VI, { session: k.s.kds, body: { aggregationRule: "sum" } })).status).toBe(428);
  expect(
    (await m("PATCH", VI, { session: k.s.kds, headers: ifMatch(7), body: { aggregationRule: "sum" } })).status,
  ).toBe(409);
  const updated = await m("PATCH", VI, { session: k.s.kds, headers: ifMatch(1), body: { aggregationRule: "sum" } });
  expect([updated.status, updated.body.version]).toEqual([200, 2]);
  expect((await m("POST", `${VI}/activate`, { session: k.s.auditor, headers: ifMatch(2) })).status).toBe(403);
  const active = await m("POST", `${VI}/activate`, { session: k.s.kds, headers: ifMatch(2) });
  expect([active.status, active.body.status], JSON.stringify(active.body)).toEqual([200, "active"]);
  // A second version, then withdrawn.
  const second = await m("POST", V, {
    session: k.s.kds,
    body: {
      measureType: "higher_is_better",
      valueNature: "flow",
      aggregationRule: "sum",
      submissionRoute: "direct_accept",
      changeReason: "Contract check of a second version.",
    },
  });
  expect(second.status, JSON.stringify(second.body)).toBe(201);
  const W = `${b}/kpi-versions/${second.body.id}/withdraw`;
  expect((await m("POST", W, { session: k.s.kds, body: { reason: "Not needed" } })).status).toBe(428);
  const withdrawn = await m("POST", W, {
    session: k.s.kds,
    headers: ifMatch(1),
    body: { reason: "Not needed in the contract run." },
  });
  expect([withdrawn.status, withdrawn.body.status]).toEqual([200, "withdrawn"]);
  expect((await m("POST", W, { session: k.s.kds, headers: ifMatch(2), body: { reason: "Again please" } })).status).toBe(
    422,
  );

  // ------------------------------------------------------------------ dictionary (REQ-S07-001)
  const dict = await m("GET", `${b}/kpi-dictionary?limit=5`, { session: k.s.auditor });
  expect(dict.status).toBe(200);
  const entry = await m("GET", `${b}/kpi-definitions/${kpi.id}/dictionary-entry`, { session: k.s.auditor });
  expect([entry.status, entry.body.activeVersion.id, entry.body.missingForUse]).toEqual([
    200,
    draft.body.id,
    ["approved_trajectory"],
  ]);

  // ------------------------------------------------------------------ RAG thresholds (ADR-0028 §5)
  const R = `${b}/kpi-definitions/${kpi.id}/rag-thresholds`;
  expect(
    (
      await m("POST", R, {
        session: k.s.kds,
        body: { toleranceMode: "relative", amberThreshold: "0.2", redThreshold: "0.1", reason: "Wrong order" },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await m("POST", R, {
        session: k.s.auditor,
        body: { toleranceMode: "relative", amberThreshold: "0.05", redThreshold: "0.1", reason: "AUD" },
      })
    ).status,
  ).toBe(403);
  const threshold = await m("POST", R, {
    session: k.s.kds,
    body: {
      toleranceMode: "relative",
      amberThreshold: "0.05",
      redThreshold: "0.15",
      reason: "Contract threshold version 1.",
    },
  });
  expect([threshold.status, threshold.body.status, threshold.body.versionNo]).toEqual([201, "active", 1]);
  expect((await m("GET", R, { session: k.s.auditor })).status).toBe(200);

  // ------------------------------------------------------------------ target trajectories (ADR-0027 §5)
  const TJ = `${b}/kpi-definitions/${kpi.id}/trajectories`;
  const scope = { scopeKind: "transformation", scopeId: k.transformationId };
  expect((await m("POST", TJ, { session: k.s.kds, body: { ...scope, scopeId: ctx.world.b1 } })).status).toBe(400);
  expect(
    (
      await m("POST", TJ, {
        session: k.s.kds,
        body: {
          scopeKind: "business_unit",
          scopeId: ctx.world.b1,
          points: [{ pointDate: "2026-12-31", expectedValue: "10" }],
        },
      })
    ).status,
  ).toBe(422);
  const tj = await m("POST", TJ, {
    session: k.s.kds,
    body: {
      ...scope,
      points: [
        { pointDate: "2026-10-31", expectedValue: "100" },
        { pointDate: "2026-12-31", expectedValue: "300" },
      ],
    },
  });
  expect([tj.status, tj.body.status, tj.body.points.length], JSON.stringify(tj.body)).toEqual([201, "draft", 2]);
  expect(
    (
      await m("POST", TJ, {
        session: k.s.kds,
        body: { ...scope, points: [{ pointDate: "2026-11-30", expectedValue: "1" }] },
      })
    ).status,
  ).toBe(409);
  expect((await m("GET", `${TJ}?scopeKind=transformation`, { session: k.s.auditor })).status).toBe(200);
  const TI = `${b}/target-trajectories/${tj.body.id}`;
  expect((await m("GET", TI, { session: k.s.auditor })).status).toBe(200);
  expect((await m("POST", `${TI}/approve`, { session: k.s.sp, body: {} })).status).toBe(428);
  expect((await m("POST", `${TI}/approve`, { session: k.s.kds, headers: ifMatch(1), body: {} })).status).toBe(403);
  const approved = await m("POST", `${TI}/approve`, {
    session: k.s.sp,
    headers: ifMatch(1),
    body: { comment: "Synthetic SP approval in the contract run." },
  });
  expect([approved.status, approved.body.status, approved.body.approvedBy]).toEqual([200, "approved", k.users.sp.id]);
  expect((await m("POST", `${TI}/approve`, { session: k.s.bo, headers: ifMatch(2), body: {} })).status).toBe(422);
  const tj2 = await m("POST", TJ, {
    session: k.s.kds,
    body: { ...scope, points: [{ pointDate: "2026-12-31", expectedValue: "250" }] },
  });
  expect(tj2.status).toBe(201);
  const wd = await m("POST", `${b}/target-trajectories/${tj2.body.id}/withdraw`, {
    session: k.s.kds,
    headers: ifMatch(1),
    body: { reason: "Superseded by a planning change." },
  });
  expect([wd.status, wd.body.status]).toEqual([200, "withdrawn"]);

  // ------------------------------------------------------------------ data-quality findings (ADR-0027 §9)
  const findingId = await insertFinding(ctx.api.db, k, ctx.world.orgA.id, kpi.id);
  const DQ = `${b}/data-quality-findings`;
  expect((await m("GET", `${DQ}?status=open&kpiDefinitionId=${kpi.id}`, { session: k.s.auditor })).status).toBe(200);
  const F = `${DQ}/${findingId}`;
  expect((await m("GET", F, { session: k.s.auditor })).status).toBe(200);
  expect(
    (
      await m("POST", `${F}/resolve`, {
        session: k.s.auditor,
        headers: ifMatch(1),
        body: { outcome: "resolved", note: "AUD" },
      })
    ).status,
  ).toBe(403);
  expect(
    (await m("POST", `${F}/resolve`, { session: k.s.kds, body: { outcome: "resolved", note: "No If-Match" } })).status,
  ).toBe(428);
  const resolved = await m("POST", `${F}/resolve`, {
    session: k.s.kds,
    headers: ifMatch(1),
    body: { outcome: "resolved", note: "Source system backfilled the value." },
  });
  expect([resolved.status, resolved.body.status]).toEqual([200, "resolved"]);
  expect(
    (
      await m("POST", `${F}/resolve`, {
        session: k.s.kds,
        headers: ifMatch(2),
        body: { outcome: "dismissed", note: "Again" },
      })
    ).status,
  ).toBe(422);
}
