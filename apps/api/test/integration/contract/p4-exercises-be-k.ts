// P4 contract exercises of BE-K (T-DG4-BE-K; p4-work-split §H H.1, §1 S-10): the six slice H operations of the G5 scale
// scope, scale transitions and risk dispositions. Every call goes through `ctx.mirrored` (OpenAPI status/body/headers +
// problem mirror) and every success body is parsed with the zod mirror in P4_MIRRORS_BE_K. BE-K2 appends its gate-review
// and gate-exception exercises to this file after BE-K (no new seam file). The fixtures below are shared with
// test/integration/workflows/{g5-g6,scale,risk-dispositions,gate-events}.test.ts and the worker's gates test.
// All data is SYNTHETIC. The gate decisions and the disposition approval here are synthetic in-product business
// approvals of test data, made by test persons; they approve nothing real, and nothing here touches DG0-DG7.
import { insertAuditEvent, sql } from "@mth/db";
import {
  riskDisposition,
  riskDispositionPage,
  scaleScope,
  scaleTransition,
  scaleTransitionPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { call, type P4ExerciseContext, type Res, type TestApi, type World } from "../../support/harness.ts";
import type { P2World } from "../../support/p2-fixtures.ts";
import { extraUser, insertInitiative, type BenefitWorld, type Caller } from "../benefits/fixtures.ts";
import { pendingSubmission, setGateStatus } from "../portfolio/fixtures.ts";
import { seedSustainmentWorld, type SustainmentWorld } from "./p4-exercises-be-i.ts";

export const P4_MIRRORS_BE_K: Readonly<Record<string, z.ZodType>> = {
  getScaleScope: scaleScope,
  listScaleTransitions: scaleTransitionPage,
  createScaleTransition: scaleTransition,
  listRiskDispositions: riskDispositionPage,
  createRiskDisposition: riskDisposition,
  getRiskDisposition: riskDisposition,
};

// ------------------------------------------------------------------------------------------------ shared fixtures

type Extra = Awaited<ReturnType<typeof extraUser>>;

export interface GateWorld {
  readonly s: SustainmentWorld;
  readonly b: BenefitWorld;
  /** The Sponsor (G5/G6 default approver; risk dispositions are routed to the party SP mapped to this person). */
  readonly sp: Extra;
  /** A Workstream Lead (proposes dispositions; owns risks). */
  readonly wl: Extra;
  /** An initiative of the transformation (scope items name it). */
  readonly initiativeId: string;
  /** A business unit of the organization (BU a1). */
  readonly businessUnitId: string;
  /** /api/v1/transformations/{id}/gates */
  readonly gates: string;
}

/** As a P2World for the portfolio gate fixtures (they read only the transformation id and the lead's id). */
export const asP2 = (g: GateWorld): P2World =>
  ({ transformationId: g.b.transformationId, lead: { id: g.b.users.tl.id } }) as unknown as P2World;

/**
 * The slice B/G world (TL, BO, BO2, FIN, AUD, ADM-only) plus the P4 transformation structure (six gate instances,
 * governance matrices; p4_instantiate_transformation), a Sponsor mapped to the party SP, a WL and one initiative.
 */
export async function seedGateWorld(api: TestApi, w: World, send?: Caller): Promise<GateWorld> {
  const req: Caller = send ?? ((m, u, o) => call(api.app, m, u, o));
  const s = await seedSustainmentWorld(api, w, req);
  const b = s.b;
  await sql`SELECT p4_instantiate_transformation(${b.transformationId}::uuid, ${b.users.tl.id}::uuid, 'test:gate-world', 'api')`.execute(
    api.db,
  );
  const sp = await extraUser(api, w, b, "SP");
  const mapped = await req("POST", `${b.base}/role-mappings`, {
    session: b.s.tl,
    body: { partyCode: "SP", targetKind: "user", userId: sp.id },
  });
  expect(mapped.status, JSON.stringify(mapped.body)).toBe(201);
  return {
    s,
    b,
    sp,
    wl: s.wl,
    initiativeId: await insertInitiative(api.db, b),
    businessUnitId: w.a1,
    gates: `${b.base}/gates`,
  };
}

/**
 * Stages G1..G(n) approved and the transformation at `phase` with audited fixture writes (the DG3 g4.test precedent):
 * reaching G5/G6 through every earlier business approval is out of this suite's scope. Synthetic; approves nothing.
 */
export async function stageGates(
  api: TestApi,
  g: GateWorld,
  approved: readonly string[],
  phase: string,
): Promise<void> {
  for (const code of approved) await setGateStatus(api, asP2(g), code, "approved");
  await api.db.transaction().execute(async (tx) => {
    const t = await tx
      .selectFrom("transformation")
      .select(["current_phase", "version"])
      .where("id", "=", g.b.transformationId)
      .executeTakeFirstOrThrow();
    await tx
      .updateTable("transformation")
      .set({ current_phase: phase, version: sql<number>`version + 1`, updated_by: g.b.users.tl.id })
      .where("id", "=", g.b.transformationId)
      .execute();
    await insertAuditEvent(
      tx,
      {
        actorType: "user",
        actorUserId: g.b.users.tl.id,
        requestId: `fixture-phase-${g.b.transformationId}`,
        source: "api",
      },
      {
        action: "transformation.fixture_phase",
        recordType: "transformation",
        recordId: g.b.transformationId,
        organizationId: g.b.organizationId,
        transformationId: g.b.transformationId,
        priorVersion: t.version,
        newVersion: t.version + 1,
        changes: { current_phase: { from: t.current_phase, to: phase } },
      },
    );
  });
}

/** A pending fixture submission of `gateCode` by the TL (the criteria are not evaluated); returns its number. */
export const pendingGate = (api: TestApi, g: GateWorld, gateCode: string, submitterId = g.b.users.tl.id) =>
  pendingSubmission(api, asP2(g), gateCode, submitterId);

/** An open High-impact RAID risk of the transformation, through the API (TL). */
export async function highRisk(send: Caller, g: GateWorld, impact = "high") {
  const r = (await send("POST", `${g.b.base}/raid`, {
    session: g.b.s.tl,
    body: {
      type: "risk",
      description: "Synthetic vendor delay on the scaled billing platform",
      impact,
      probability: "medium",
      ownerUserId: g.wl.id,
      dueDate: "2026-12-15",
      mitigation: "Synthetic: qualify a second supplier",
    },
  })) as Res<{ id: string; code: string; version: number }>;
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

/** The decision body of a G5 approval with one scope item (the world's initiative in BU a1) and one condition. */
export const g5Approval = (g: GateWorld, submissionNo: number, extra: Record<string, unknown> = {}) => ({
  submissionNo,
  outcome: "approved",
  rationale: "Synthetic: pilot results justify scaling to BU a1 only.",
  scaleScope: {
    items: [{ initiativeId: g.initiativeId, businessUnitId: g.businessUnitId, note: "Synthetic pilot BU" }],
    conditions: [
      { text: "Synthetic: weekly churn review for 8 weeks", ownerUserId: g.b.users.bo.id, dueDate: "2026-12-31" },
    ],
  },
  ...extra,
});

// ------------------------------------------------------------------------------------------------ the exercises

export async function exerciseP4BeKOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const g = await seedGateWorld(ctx.api, ctx.world, m);
  const { b } = g;
  const SCOPE = `${b.base}/scale-scope`;
  const TRANS = `${b.base}/scale-transitions`;
  const DISP = `${b.base}/risk-dispositions`;
  const item = { initiativeId: g.initiativeId, businessUnitId: g.businessUnitId };

  // ------------------------------------------------------------------ before G5 (ADR-0035 §5)
  const empty = await m("GET", SCOPE, { session: b.s.auditor });
  expect([empty.status, empty.body]).toEqual([
    200,
    { approved: false, gateDecisionId: null, decidedAt: null, items: [], conditions: [] },
  ]);
  const early = await m("POST", TRANS, { session: b.s.tl, body: item });
  expect([early.status, early.body.code]).toEqual([422, "gate.g5_not_approved"]);
  expect((await m("POST", TRANS, { session: b.s.auditor, body: item })).status).toBe(403);

  // ------------------------------------------------------------------ risk dispositions (ADR-0035 §6)
  const risk = await highRisk(m, g);
  const proposed = await m("POST", DISP, {
    session: g.wl.session,
    body: {
      raidEntryId: risk.id,
      disposition: "carry_into_bau",
      rationale: "Synthetic: residual vendor risk owned by BAU operations.",
      residualOwnerUserId: b.users.bo.id,
    },
  });
  expect([proposed.status, proposed.body.approvalStatus, proposed.body.version]).toEqual([201, "pending", 1]);
  expect(proposed.headers.etag).toBe('"1"');
  expect((await m("GET", `${DISP}?raidEntryId=${risk.id}`, { session: b.s.auditor })).body.items).toHaveLength(1);
  const one = await m("GET", `${DISP}/${proposed.body.id}`, { session: b.s.auditor });
  expect([one.status, one.body.approvalId]).toEqual([200, proposed.body.approvalId]);
  const audDenied = await m("POST", DISP, {
    session: b.s.auditor,
    body: { raidEntryId: risk.id, disposition: "accept", rationale: "Synthetic", residualOwnerUserId: b.users.bo.id },
  });
  expect(audDenied.status).toBe(403);

  // ------------------------------------------------------------------ an approved G5 with its scope
  await stageGates(ctx.api, g, ["G1", "G2", "G3", "G4"], "transform");
  const no = await pendingGate(ctx.api, g, "G5");
  const decided = await m("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no) });
  expect(decided.status, JSON.stringify(decided.body)).toBe(201);
  const approved = await m("GET", SCOPE, { session: b.s.auditor });
  expect([approved.body.approved, approved.body.items.length, approved.body.conditions.length]).toEqual([true, 1, 1]);
  const scaled = await m("POST", TRANS, { session: b.s.tl, body: { ...item, note: "Synthetic go-live wave 1" } });
  expect([scaled.status, scaled.body.gateDecisionId]).toEqual([201, approved.body.gateDecisionId]);
  const twice = await m("POST", TRANS, { session: b.s.tl, body: item });
  expect([twice.status, twice.body.code]).toEqual([409, "scale.already_scaled"]);
  const outside = await m("POST", TRANS, {
    session: b.s.tl,
    body: { initiativeId: g.initiativeId, businessUnitId: ctx.world.a2 },
  });
  expect([outside.status, outside.body.code]).toEqual([422, "scale.outside_approved_scope"]);
  const list = await m("GET", TRANS, { session: b.s.auditor });
  expect([list.status, list.body.items.length]).toEqual([200, 1]);
}
