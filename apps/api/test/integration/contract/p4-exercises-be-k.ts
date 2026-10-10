// P4 contract exercises of BE-K (T-DG4-BE-K; p4-work-split §H H.1, §1 S-10): the six slice H operations of the G5 scale
// scope, scale transitions and risk dispositions, plus listScaleScopeBusinessUnits (ADR-0035 amendment R1, T-DG4-BE-R4). Every call goes through `ctx.mirrored` (OpenAPI status/body/headers +
// problem mirror) and every success body is parsed with the zod mirror in P4_MIRRORS_BE_K. BE-K2 appends its gate-review
// and gate-exception exercises to this file after BE-K (no new seam file). The fixtures below are shared with
// test/integration/workflows/{g5-g6,scale,risk-dispositions,gate-events}.test.ts and the worker's gates test.
// All data is SYNTHETIC. The gate decisions and the disposition approval here are synthetic in-product business
// approvals of test data, made by test persons; they approve nothing real, and nothing here touches DG0-DG7.
import { insertAuditEvent, sql } from "@mth/db";
import {
  gateCriterionReview,
  gateCriterionReviewPage,
  gateCriterionRowList,
  gateException,
  gateExceptionPage,
  riskDisposition,
  riskDispositionPage,
  scaleScope,
  scaleScopeBusinessUnitPage,
  scaleTransition,
  scaleTransitionPage,
} from "@mth/shared/schemas";
import { businessDateOf } from "@mth/shared/time";
import { expect } from "vitest";
import type { z } from "zod";
import {
  call,
  createUser,
  grant,
  signIn,
  type P4ExerciseContext,
  type Res,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import type { P2World } from "../../support/p2-fixtures.ts";
import { extraUser, insertInitiative, type BenefitWorld, type Caller } from "../benefits/fixtures.ts";
import { pendingSubmission, setGateStatus } from "../portfolio/fixtures.ts";
import { seedSustainmentWorld, type SustainmentWorld } from "./p4-exercises-be-i.ts";

export const P4_MIRRORS_BE_K: Readonly<Record<string, z.ZodType>> = {
  getScaleScope: scaleScope,
  listScaleScopeBusinessUnits: scaleScopeBusinessUnitPage,
  listScaleTransitions: scaleTransitionPage,
  createScaleTransition: scaleTransition,
  listRiskDispositions: riskDispositionPage,
  createRiskDisposition: riskDisposition,
  getRiskDisposition: riskDisposition,
  // T-DG4-BE-K2 (p4-work-split §H H.2): gate reviews and gate exceptions.
  listGateSubmissionCriteria: gateCriterionRowList,
  listGateCriterionReviews: gateCriterionReviewPage,
  createGateCriterionReview: gateCriterionReview,
  listGateExceptions: gateExceptionPage,
  createGateException: gateException,
  getGateException: gateException,
  decideGateException: gateException,
  withdrawGateException: gateException,
  revokeGateException: gateException,
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

  // listScaleScopeBusinessUnits (ADR-0035 amendment R1): the Sponsor, with a transformation grant only, reads the
  // organization's active units (never org B's); cursor-paged by code, then id; 404 outside scope (ADM-only).
  const BUS = `${b.base}/scale-scope/business-units`;
  const units = await m("GET", BUS, { session: g.sp.session });
  expect(units.status, JSON.stringify(units.body)).toBe(200);
  const unitIds = units.body.items.map((u: { id: string }) => u.id);
  expect(unitIds).toEqual(expect.arrayContaining([ctx.world.a1, ctx.world.a1x, ctx.world.a2]));
  expect(unitIds).not.toContain(ctx.world.b1);
  expect(units.body.items.find((u: { id: string }) => u.id === g.businessUnitId)).toMatchObject({
    status: "active",
    selectable: true,
  });
  const first = await m("GET", `${BUS}?limit=1`, { session: g.sp.session });
  expect([first.status, first.body.items.length, typeof first.body.nextCursor]).toEqual([200, 1, "string"]);
  const next = await m("GET", `${BUS}?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`, {
    session: g.sp.session,
  });
  expect([next.status, next.body.items[0].id]).toEqual([200, unitIds[1]]);
  expect((await m("GET", BUS, { session: b.s.admin })).status).toBe(404);

  // T-DG4-BE-K2 (p4-work-split §H H.2): the gate-review and gate-exception operations, appended here (no new seam).
  await exerciseP4BeK2Operations(ctx);
}

// ================================================================================================ T-DG4-BE-K2
// Gate exceptions (waivers) and per-criterion gate reviews (ADR-0035 §3, §4; REQ-S04-009/010/012/013). The fixtures
// below are shared with test/integration/workflows/{gate-exceptions,gate-reviews}.test.ts and the worker's gates test.
// Every exception decision and gate submission here is a synthetic in-product action by a test person.

/** The business date `n` calendar days after `date` (YYYY-MM-DD; UTC arithmetic on a plain date). */
export const plusDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Today's business date in the transformation's timezone (the API's exception clock without injection). */
export async function todayOf(api: TestApi, g: GateWorld): Promise<string> {
  const t = await api.db
    .selectFrom("transformation")
    .select("timezone")
    .where("id", "=", g.b.transformationId)
    .executeTakeFirstOrThrow();
  return businessDateOf(new Date(), t.timezone);
}

/** The live gate view's missing mandatory criterion keys (GET .../gates/{code}). */
export async function missingMandatory(send: Caller, g: GateWorld, gateCode: string): Promise<string[]> {
  const view = (await send("GET", `${g.gates}/${gateCode}`, { session: g.b.s.tl })) as Res<{
    criteria: { key: string; mandatory: boolean; completeness: string }[];
  }>;
  expect(view.status, JSON.stringify(view.body)).toBe(200);
  return view.body.criteria.filter((c) => c.mandatory && c.completeness !== "complete").map((c) => c.key);
}

/** The request body of an exception with all five REQ-S04-013 fields (synthetic). */
export const exceptionBody = (
  g: GateWorld,
  gateCode: string,
  criterionKey: string,
  expiresOn: string,
  extra: Record<string, unknown> = {},
) => ({
  gateCode,
  criterionKey,
  reason: "Synthetic: the evidence is produced by the vendor after the pilot.",
  scope: `Synthetic: only ${criterionKey} for this ${gateCode} submission.`,
  compensatingAction: "Synthetic: weekly interim report reviewed by the BO.",
  compensatingOwnerUserId: g.b.users.bo.id,
  expiresOn,
  ...extra,
});

/** The TL requests an exception (201 asserted); returns the body. */
export async function requestException(
  send: Caller,
  g: GateWorld,
  gateCode: string,
  criterionKey: string,
  expiresOn: string,
) {
  const r = (await send("POST", `${g.b.base}/gate-exceptions`, {
    session: g.b.s.tl,
    body: exceptionBody(g, gateCode, criterionKey, expiresOn),
  })) as Res<{ id: string; version: number; status: string }>;
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

/** The gate's approver (the Sponsor by default) accepts a pending exception (200 asserted). */
export async function acceptException(send: Caller, g: GateWorld, e: { id: string; version: number }) {
  const r = (await send("POST", `${g.b.base}/gate-exceptions/${e.id}/decision`, {
    session: g.sp.session,
    headers: { "if-match": `"${e.version}"` },
    body: { outcome: "accepted", note: "Synthetic: accepted with the compensating report." },
  })) as Res<{ id: string; version: number; status: string; covering: boolean }>;
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

/** Requests and accepts one exception per missing mandatory criterion of `gateCode`, expiring on `expiresOn`. */
export async function coverGate(send: Caller, g: GateWorld, gateCode: string, expiresOn: string) {
  const out: { key: string; id: string }[] = [];
  for (const key of await missingMandatory(send, g, gateCode)) {
    const e = await acceptException(send, g, await requestException(send, g, gateCode, key, expiresOn));
    out.push({ key, id: e.id });
  }
  return out;
}

/** The TL submits `gateCode` through the API with the gate's current ETag. */
export async function submitThroughApi(api: TestApi, send: Caller, g: GateWorld, gateCode: string) {
  const v = await api.db
    .selectFrom("gate_instance")
    .select("version")
    .where("transformation_id", "=", g.b.transformationId)
    .where("gate_code", "=", gateCode)
    .executeTakeFirstOrThrow();
  return (await send("POST", `${g.gates}/${gateCode}/submissions`, {
    session: g.b.s.tl,
    headers: { "if-match": `"${v.version}"` },
    body: { submissionNote: "Synthetic submission" },
  })) as Res<{ id: string; submissionNo: number; snapshot: Record<string, unknown>; snapshotSha256: string }>;
}

/** A user holding TL and SP on the transformation (to prove the requester never decides their own exception). */
export async function requesterApprover(api: TestApi, w: World, g: GateWorld) {
  const u = await createUser(api.db, w.orgA.id);
  for (const role of ["TL", "SP"])
    await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: g.b.transformationId }, w.orgA.id);
  return { ...u, session: await signIn(api.app, u.subject) };
}

export async function exerciseP4BeK2Operations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const g = await seedGateWorld(ctx.api, ctx.world, m);
  const { b } = g;
  const EXC = `${b.base}/gate-exceptions`;
  const today = await todayOf(ctx.api, g);
  const missing = await missingMandatory(m, g, "G1");
  expect(missing.length).toBeGreaterThan(0);

  // ------------------------------------------------------------------ exceptions (ADR-0035 §4)
  const noExpiry = await m("POST", EXC, {
    session: b.s.tl,
    body: { ...exceptionBody(g, "G1", missing[0]!, today), expiresOn: undefined },
  });
  expect([noExpiry.status, noExpiry.body.code]).toEqual([400, "validation"]);
  const audDenied = await m("POST", EXC, { session: b.s.auditor, body: exceptionBody(g, "G1", missing[0]!, today) });
  expect(audDenied.status).toBe(403);
  const created = await m("POST", EXC, { session: b.s.tl, body: exceptionBody(g, "G1", missing[0]!, today) });
  expect([created.status, created.body.status, created.body.covering, created.body.version]).toEqual([
    201,
    "pending",
    false,
    1,
  ]);
  expect(created.headers.etag).toBe('"1"');
  const dup = await m("POST", EXC, { session: b.s.tl, body: exceptionBody(g, "G1", missing[0]!, today) });
  expect([dup.status, dup.body.code]).toEqual([409, "gate_exception.already_pending"]);
  const one = await m("GET", `${EXC}/${created.body.id}`, { session: b.s.auditor });
  expect([one.status, one.headers.etag]).toEqual([200, '"1"']);
  const withdrawn = await m("POST", `${EXC}/${created.body.id}/withdraw`, { session: b.s.tl, headers: ifmOf(1) });
  expect([withdrawn.status, withdrawn.body.status]).toEqual([200, "withdrawn"]);
  const notApprover = await m("POST", `${EXC}/${created.body.id}/decision`, {
    session: b.s.bo,
    headers: ifmOf(2),
    body: { outcome: "accepted", note: "Synthetic decision" },
  });
  expect([notApprover.status, notApprover.body.code]).toEqual([403, "gate_exception.not_approver"]);
  const late = await m("POST", `${EXC}/${created.body.id}/decision`, {
    session: g.sp.session,
    headers: ifmOf(2),
    body: { outcome: "accepted", note: "Synthetic decision" },
  });
  expect([late.status, late.body.code]).toEqual([422, "gate_exception.not_pending"]);
  const covered = await coverGate(m, g, "G1", plusDays(today, 30));
  expect(covered.map((c) => c.key)).toEqual(missing);
  const revokeNoReason = await m("POST", `${EXC}/${covered[0]!.id}/revoke`, {
    session: g.sp.session,
    headers: ifmOf(2),
    body: {},
  });
  expect([revokeNoReason.status, revokeNoReason.body.errors[0].code]).toEqual([
    400,
    "gate_exception.revoke_reason_required",
  ]);
  const list = await m("GET", `${EXC}?gateCode=G1&status=accepted`, { session: b.s.auditor });
  expect([list.status, list.body.items.length]).toEqual([200, missing.length]);
  expect(list.body.items.every((e: { covering: boolean }) => e.covering)).toBe(true);

  // ------------------------------------------------------------------ a covered G1 submission, reviews (ADR-0035 §3)
  const submitted = await submitThroughApi(ctx.api, m, g, "G1");
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  const CRIT = `${g.gates}/G1/submissions/${submitted.body.submissionNo}/criteria`;
  const table = await m("GET", CRIT, { session: b.s.auditor });
  expect([table.status, table.body.gateStatus, table.body.items.length]).toEqual([200, "submitted", 6]);
  const key = missing[0]!;
  const gv = async () =>
    (
      await ctx.api.db
        .selectFrom("gate_instance")
        .select("version")
        .where("transformation_id", "=", b.transformationId)
        .where("gate_code", "=", "G1")
        .executeTakeFirstOrThrow()
    ).version;
  const review = await m("POST", `${CRIT}/${key}/reviews`, {
    session: b.s.bo,
    headers: ifmOf(await gv()),
    body: {
      finding: "Synthetic: covered by an accepted exception until the vendor report.",
      recommendation: "meets_with_conditions",
      openCondition: "Synthetic: vendor report before the G2 submission.",
      rationale: "Synthetic: the compensating report is adequate.",
    },
  });
  expect([review.status, review.body.reviewNo]).toEqual([201, 1]);
  const bySubmitter = await m("POST", `${CRIT}/${key}/reviews`, {
    session: b.s.tl,
    headers: ifmOf(await gv()),
    body: { finding: "Synthetic", recommendation: "meets", rationale: "Synthetic" },
  });
  expect(bySubmitter.status).toBe(403);
  const reviews = await m("GET", `${CRIT}/${key}/reviews`, { session: b.s.auditor });
  expect([reviews.status, reviews.body.items.length]).toEqual([200, 1]);
  const revoked = await m("POST", `${EXC}/${covered[0]!.id}/revoke`, {
    session: g.sp.session,
    headers: ifmOf(2),
    body: { reason: "Synthetic: the vendor report was cancelled." },
  });
  expect([revoked.status, revoked.body.status, revoked.body.covering]).toEqual([200, "revoked", false]);
}

const ifmOf = (v: number) => ({ "if-match": `"${v}"` });
