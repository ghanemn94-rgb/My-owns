// P3 contract exercises of BE-D (T-DG3-BE-D; p3-work-split §5): the 17 prioritization operations (weight sets, scores,
// ranking snapshots and history, overrides, the prioritization view, incl. its `funding` filter and 422 added by
// T-DG3-ARCH-03). Every call goes through `ctx.mirrored` (OpenAPI status/body/headers + problem mirror) and every
// success body is parsed with the zod mirror in P3_MIRRORS_BE_D, imported from `@mth/shared/schemas`
// (prioritization.ts).
// All data is SYNTHETIC. The weight-set and override approvals below are demo business decisions by a synthetic
// Sponsor on synthetic data and approve nothing real; nothing here touches the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import {
  initiativeScore,
  initiativeScoreSheet,
  prioritizationView,
  rankingHistoryPage,
  rankingOverride,
  rankingOverridePage,
  rankingSnapshotPage,
  rankingSnapshotView,
  weightSet,
  weightSetList,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import { record } from "../../../src/modules/audit/index.ts";
import type { P3ExerciseContext, TestApi } from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";

export const P3_MIRRORS_BE_D: Readonly<Record<string, z.ZodType>> = {
  getPrioritization: prioritizationView,
  listWeightSets: weightSetList,
  createWeightSet: weightSet,
  getWeightSet: weightSet,
  approveWeightSet: weightSet,
  withdrawWeightSet: weightSet,
  getInitiativeScores: initiativeScoreSheet,
  createInitiativeScore: initiativeScore,
  updateInitiativeScore: initiativeScore,
  listRankingSnapshots: rankingSnapshotPage,
  createRankingSnapshot: rankingSnapshotView,
  getRankingSnapshot: rankingSnapshotView,
  getRankingHistory: rankingHistoryPage,
  listRankingOverrides: rankingOverridePage,
  createRankingOverride: rankingOverride,
  decideRankingOverride: rankingOverride,
  revokeRankingOverride: rankingOverride,
};

/**
 * Inserts a SYNTHETIC initiative with its audit event (the state BE-B's API writes; BE-D does not own the initiative
 * routes). `status` defaults to `submitted` (in the portfolio, ready to be ranked).
 */
export async function insertInitiative(
  api: TestApi,
  transformationId: string,
  actorUserId: string,
  opts: { code?: string; name?: string; status?: string } = {},
): Promise<{ id: string; code: string }> {
  return api.db.transaction().execute(async (tx) => {
    const t = await tx
      .selectFrom("transformation")
      .select("organization_id")
      .where("id", "=", transformationId)
      .executeTakeFirstOrThrow();
    const n = await tx
      .selectFrom("initiative")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("transformation_id", "=", transformationId)
      .executeTakeFirstOrThrow();
    const code = opts.code ?? `INI-${String(BigInt(n.n) + 1n).padStart(3, "0")}`;
    const id = uuidv7();
    await tx
      .insertInto("initiative")
      .values({
        id,
        organization_id: t.organization_id,
        transformation_id: transformationId,
        code,
        name: opts.name ?? `Synthetic initiative ${code}`,
        status: opts.status ?? "submitted",
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .execute();
    await record(
      tx,
      { actorUserId, requestId: `fixture-${uuidv7()}` },
      {
        action: "initiative.fixture_create",
        recordType: "initiative",
        recordId: id,
        organizationId: t.organization_id,
        transformationId,
        newVersion: 1,
      },
    );
    return { id, code };
  });
}

/** Moves a synthetic initiative to `cancelled` with its audit event (fixture; BE-B owns the real transition). */
export async function cancelInitiative(api: TestApi, initiativeId: string, actorUserId: string): Promise<void> {
  await api.db.transaction().execute(async (tx) => {
    const row = await tx.selectFrom("initiative").selectAll().where("id", "=", initiativeId).executeTakeFirstOrThrow();
    const updated = await tx
      .updateTable("initiative")
      .set({
        status: "cancelled",
        cancelled_at: new Date(),
        cancelled_by: actorUserId,
        cancel_reason: "Synthetic fixture cancellation",
        version: sql<number>`version + 1`,
        updated_by: actorUserId,
      })
      .where("id", "=", initiativeId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(
      tx,
      { actorUserId, requestId: `fixture-${uuidv7()}` },
      {
        action: "initiative.fixture_cancel",
        recordType: "initiative",
        recordId: initiativeId,
        organizationId: row.organization_id,
        transformationId: row.transformation_id,
        priorVersion: row.version,
        newVersion: updated.version,
      },
    );
  });
}

/**
 * Inserts `count` SYNTHETIC submitted initiatives in one transaction, each with its audit event (fixture; BE-B owns the
 * real create). Codes continue after the transformation's existing ones (INI-003, INI-004, ...). Used to push one
 * transformation's eligible portfolio above PORTFOLIO_VIEW_MAX (500) for the getPrioritization 422 (T-DG3-ARCH-03).
 */
export async function insertInitiatives(
  api: TestApi,
  transformationId: string,
  actorUserId: string,
  count: number,
): Promise<void> {
  await api.db.transaction().execute(async (tx) => {
    const t = await tx
      .selectFrom("transformation")
      .select("organization_id")
      .where("id", "=", transformationId)
      .executeTakeFirstOrThrow();
    const n = await tx
      .selectFrom("initiative")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("transformation_id", "=", transformationId)
      .executeTakeFirstOrThrow();
    const first = BigInt(n.n) + 1n;
    const rows = Array.from({ length: count }, (_, i) => {
      const code = `INI-${String(first + BigInt(i)).padStart(3, "0")}`;
      return {
        id: uuidv7(),
        organization_id: t.organization_id,
        transformation_id: transformationId,
        code,
        name: `Synthetic initiative ${code}`,
        status: "submitted",
        created_by: actorUserId,
        updated_by: actorUserId,
      };
    });
    await tx.insertInto("initiative").values(rows).execute();
    const requestId = `fixture-${uuidv7()}`;
    for (const r of rows)
      await record(
        tx,
        { actorUserId, requestId },
        {
          action: "initiative.fixture_create",
          recordType: "initiative",
          recordId: r.id,
          organizationId: t.organization_id,
          transformationId,
          newVersion: 1,
        },
      );
  });
}

export async function exerciseP3BeDOperations(ctx: P3ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const p = await setupP2World(ctx.api, ctx.world, m);
  const T = `/api/v1/transformations/${p.transformationId}/prioritization`;
  const ini = await insertInitiative(ctx.api, p.transformationId, p.lead.id);
  const I = `/api/v1/initiatives/${ini.id}/scores`;

  // Weight sets: v1 seeded (source defaults), v2 proposed by the lead and approved by the Sponsor.
  const list = await m("GET", `${T}/weight-sets`, { session: p.auditor.session });
  expect([list.status, list.body.items.length, list.body.items[0].versionNo]).toEqual([200, 1, 1]);
  expect((await m("GET", `${T}/weight-sets/1`, { session: p.auditor.session })).status).toBe(200);
  const bad = await m("POST", `${T}/weight-sets`, {
    session: p.lead.session,
    body: {
      rationale: "Synthetic 95%",
      weights: [
        { criterionCode: "strategic_fit", weightPercent: "50" },
        { criterionCode: "feasibility", weightPercent: "45" },
      ],
    },
  });
  expect([bad.status, bad.body.code]).toEqual([422, "prioritization.weights_total"]);
  const v2Weights = [
    { criterionCode: "strategic_fit", weightPercent: "15" },
    { criterionCode: "financial_value", weightPercent: "25" },
    { criterionCode: "customer_impact", weightPercent: "20" },
    { criterionCode: "feasibility", weightPercent: "15" },
    { criterionCode: "time_to_value", weightPercent: "15" },
    { criterionCode: "risk_compliance", weightPercent: "10" },
  ];
  const v2 = await m("POST", `${T}/weight-sets`, {
    session: p.lead.session,
    body: { rationale: "Synthetic: regulated transformation (B0077).", weights: v2Weights },
  });
  expect([v2.status, v2.body.versionNo, v2.body.status]).toEqual([201, 2, "proposed"]);
  expect(
    (await m("POST", `${T}/weight-sets`, { session: p.auditor.session, body: { rationale: "x", weights: v2Weights } }))
      .status,
  ).toBe(403);
  expect((await m("POST", `${T}/weight-sets/2/approve`, { session: p.sponsor.session, body: {} })).status).toBe(428);
  expect(
    (await m("POST", `${T}/weight-sets/2/approve`, { session: p.sponsor.session, headers: ifm(7), body: {} })).status,
  ).toBe(409);
  const approved = await m("POST", `${T}/weight-sets/2/approve`, {
    session: p.sponsor.session,
    headers: ifm(v2.body.version),
    body: { note: "Synthetic demo approval." },
  });
  expect([approved.status, approved.body.status]).toEqual([200, "active"]);
  const v3 = await m("POST", `${T}/weight-sets`, {
    session: p.office.session,
    body: { rationale: "Synthetic proposal to withdraw.", weights: v2Weights },
  });
  expect(v3.status).toBe(201);
  const withdrawn = await m("POST", `${T}/weight-sets/3/withdraw`, {
    session: p.office.session,
    headers: ifm(v3.body.version),
    body: { reason: "Synthetic: superseded by discussion." },
  });
  expect([withdrawn.status, withdrawn.body.status]).toEqual([200, "withdrawn"]);

  // Scores: create (6 -> 400), patch (If-Match), read the sheet.
  expect(
    (await m("POST", I, { session: p.lead.session, body: { criterionCode: "feasibility", score: 6 } })).status,
  ).toBe(400);
  const codes = [
    "strategic_fit",
    "financial_value",
    "customer_impact",
    "feasibility",
    "time_to_value",
    "risk_compliance",
  ];
  let created: { body: { version: number } } | null = null;
  for (const [i, c] of codes.entries()) {
    const r = await m("POST", I, { session: p.contributor.session, body: { criterionCode: c, score: 5 - (i % 5) } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    created = r;
  }
  const patched = await m("PATCH", `${I}/risk_compliance`, {
    session: p.contributor.session,
    headers: ifm(created!.body.version),
    body: { score: 4, note: "Synthetic re-assessment." },
  });
  expect([patched.status, patched.body.score]).toEqual([200, 4]);
  const sheet = await m("GET", I, { session: p.auditor.session });
  expect([sheet.status, sheet.body.result.completeness]).toEqual([200, "complete"]);

  // Overrides: propose (lead), approve (Sponsor), a second one revoked after approval.
  const ini2 = await insertInitiative(ctx.api, p.transformationId, p.lead.id);
  const O = `${T}/overrides`;
  expect(
    (await m("POST", O, { session: p.lead.session, body: { initiativeId: ini2.id, overrideRank: 1 } })).status,
  ).toBe(400);
  const o = await m("POST", O, {
    session: p.lead.session,
    body: { initiativeId: ini.id, overrideRank: 1, reason: "Synthetic: regulatory deadline." },
  });
  expect(o.status, JSON.stringify(o.body)).toBe(201);
  const decided = await m("POST", `${O}/${o.body.id}/decision`, {
    session: p.sponsor.session,
    headers: ifm(o.body.version),
    body: { result: "approved", note: "Synthetic demo decision." },
  });
  expect([decided.status, decided.body.status]).toEqual([200, "approved"]);
  expect((await m("GET", O, { session: p.auditor.session })).status).toBe(200);

  // Rankings: propose, list, read, history; then revoke the override.
  const snap = await m("POST", `${T}/rankings`, { session: p.lead.session, body: { note: "Synthetic proposal." } });
  expect([snap.status, snap.body.snapshot.snapshotNo]).toEqual([201, 1]);
  expect((await m("GET", `${T}/rankings`, { session: p.auditor.session })).status).toBe(200);
  expect((await m("GET", `${T}/rankings/1`, { session: p.auditor.session })).status).toBe(200);
  const hist = await m("GET", `${T}/ranking-history`, { session: p.auditor.session });
  expect([hist.status, hist.body.items.length > 0]).toEqual([200, true]);
  const revoked = await m("POST", `${O}/${o.body.id}/revoke`, {
    session: p.sponsor.session,
    headers: ifm(decided.body.version),
    body: { reason: "Synthetic: deadline moved." },
  });
  expect([revoked.status, revoked.body.status]).toEqual([200, "revoked"]);

  // The comparison view (REQ-S09-004) with its labelled 0-100 view.
  const view = await m("GET", `${T}?completeness=complete`, { session: p.auditor.session });
  expect([view.status, view.body.items.length, view.body.conversionLabel]).toEqual([
    200,
    1,
    "0–100 view = (weighted score − 1) ÷ 4 × 100",
  ]);

  // T-DG3-ARCH-03 (BE-D §6.2): the `funding` filter through HTTP. Nothing is selected, so both initiatives are
  // `not_applicable` and none is `funded` (selection and funding stay separate columns, REQ-S09-003).
  const notApplicable = await m("GET", `${T}?funding=not_applicable`, { session: p.auditor.session });
  expect([notApplicable.status, notApplicable.body.items.length]).toEqual([200, 2]);
  expect(notApplicable.body.items.every((i: { funding: string }) => i.funding === "not_applicable")).toBe(true);
  const funded = await m("GET", `${T}?funding=funded`, { session: p.auditor.session });
  expect([funded.status, funded.body.items.length]).toEqual([200, 0]);
  expect((await m("GET", `${T}?funding=approved`, { session: p.auditor.session })).status).toBe(400);

  // ... and the declared 422 above PORTFOLIO_VIEW_MAX (500) eligible initiatives: 2 + 499 synthetic = 501.
  await insertInitiatives(ctx.api, p.transformationId, p.lead.id, 499);
  const tooLarge = await m("GET", T, { session: p.auditor.session });
  expect([tooLarge.status, tooLarge.body.code, tooLarge.body.detail]).toEqual([
    422,
    "prioritization.portfolio_too_large",
    "The prioritization view covers at most 500 initiatives (got 501).",
  ]);
}
