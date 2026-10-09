// P4 contract exercises of BE-J (T-DG4-BE-J; p4-work-split §F+G FG.6, §1 S-10): the 12 slice G operations of the
// status model, transition decisions and the governed closure. Every call of a BE-J operation goes through
// `ctx.mirrored` (OpenAPI status/body/headers + problem mirror) and every success body is parsed with the zod mirror in
// P4_MIRRORS_BE_J. The fixtures below are shared with test/integration/sustainment/{status-model,transition-decisions,
// closure}.test.ts and the worker scan test.
//
// All data is SYNTHETIC. The transition-decision approval decided here is a synthetic in-product business approval of
// test data, decided by a person-shaped test user (never the requester); it approves nothing real. The approved G6 of
// `approveG6Synthetic` is a SYNTHETIC fixture (G5/G6 decisions are routed by slice H, BE-K): it is written through the
// app role with its audit events, exactly like the DG3 portfolio fixture `setGateStatus`, and approves nothing. Product
// G6 never implies the engineering gate DG7, and nothing here reads or writes DG0-DG7.
import { insertAuditEvent, sql, type Db } from "@mth/db";
import {
  closureRecord,
  closureRecordPage,
  initiativeStatusModel,
  transformationStatusModel,
  transitionDecision,
  transitionDecisionPage,
} from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import { wireTransitionDecisionApprovals } from "../../../src/modules/sustainment/transition-decisions.ts";
import { registerApprovalSubject, requestApprovalInTx } from "../../../src/modules/workflows/approvals.ts";
import { call, type P4ExerciseContext, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm, type P2World } from "../../support/p2-fixtures.ts";
import { extraUser, financialBody, type BenefitWorld, type Caller } from "../benefits/fixtures.ts";
import { approve, decideBaseline, revenueFormula, submittedValue } from "../benefits/value-fixtures.ts";
import { setGateStatus } from "../portfolio/fixtures.ts";
import { seedSustainmentWorld, type SustainmentWorld } from "./p4-exercises-be-i.ts";

export const P4_MIRRORS_BE_J: Readonly<Record<string, z.ZodType>> = {
  completeInitiativeDelivery: initiativeStatusModel,
  setInitiativeAdoptionStatus: initiativeStatusModel,
  getInitiativeStatusModel: initiativeStatusModel,
  closeInitiative: closureRecord,
  getTransformationStatusModel: transformationStatusModel,
  closeTransformation: closureRecord,
  listClosureRecords: closureRecordPage,
  listTransitionDecisions: transitionDecisionPage,
  createTransitionDecision: transitionDecision,
  getTransitionDecision: transitionDecision,
  updateTransitionDecision: transitionDecision,
  submitTransitionDecision: transitionDecision,
};

// ------------------------------------------------------------------------------------------------ shared fixtures

/**
 * Wires workflows' approval service into the sustainment module's port, as the composition root must (handback: the
 * one server.ts line is the orchestrator's). Idempotent; the port is module state of this test process.
 */
export function wireApprovals(): void {
  wireTransitionDecisionApprovals({ requestApproval: requestApprovalInTx, registerSubject: registerApprovalSubject });
}

export interface ClosureWorld {
  readonly s: SustainmentWorld;
  readonly b: BenefitWorld;
  /** Sponsor (approval.decide), mapped as the SP party of the transformation. */
  readonly sp: { id: string; session: Session };
  readonly status: (initiativeId: string) => string;
  readonly transitions: string;
}

/**
 * The sustainment world (slice B benefit world plus WL and TO) with an SP user mapped as the transformation's SP party
 * (the transition-decision approver) and the transformation made `active` (with its audit event).
 */
export async function seedClosureWorld(api: TestApi, w: World, send?: Caller): Promise<ClosureWorld> {
  wireApprovals();
  const s = await seedSustainmentWorld(api, w, send);
  const { b } = s;
  const sp = await extraUser(api, w, b, "SP");
  const mapped = await call(api.app, "POST", `${b.base}/role-mappings`, {
    session: b.s.tl,
    body: { partyCode: "SP", targetKind: "user", userId: sp.id },
  });
  expect(mapped.status, JSON.stringify(mapped.body)).toBe(201);
  await setTransformationStatus(api.db, b, "active");
  return {
    s,
    b,
    sp: { id: sp.id, session: sp.session },
    status: (initiativeId) => `/api/v1/initiatives/${initiativeId}`,
    transitions: `${b.base}/transition-decisions`,
  };
}

/** Sets the fixture transformation's status directly (version + 1, audited; synthetic setup only). */
export async function setTransformationStatus(db: Db, b: BenefitWorld, status: "active" | "on_hold" | "draft") {
  await db.transaction().execute(async (tx) => {
    const t = await tx
      .updateTable("transformation")
      .set({ status, version: sql<number>`version + 1`, updated_at: sql<Date>`now()` })
      .where("id", "=", b.transformationId)
      .returning("version")
      .executeTakeFirstOrThrow();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: b.users.tl.id, requestId: `fixture-status-${uuidv7()}`, source: "api" },
      {
        action: "transformation.fixture_status",
        recordType: "transformation",
        recordId: b.transformationId,
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        priorVersion: t.version - 1,
        newVersion: t.version,
      },
    );
  });
}

let launchSeq = 0;

/** A LAUNCHED initiative written directly with its audit event (launch belongs to portfolio; synthetic setup). */
export async function launchedInitiative(db: Db, b: BenefitWorld): Promise<string> {
  const id = uuidv7();
  const by = b.users.tl.id;
  launchSeq += 1;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("initiative")
      .values({
        id,
        organization_id: b.organizationId,
        transformation_id: b.transformationId,
        code: `INI-${String(7000 + launchSeq).padStart(4, "0")}`,
        name: `Synthetic launched initiative ${launchSeq}`,
        status: "launched",
        launched_at: new Date(),
        launched_by: by,
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: by, requestId: `fixture-${id}`, source: "api" },
      {
        action: "initiative.create",
        recordType: "initiative",
        recordId: id,
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

/** An initiative at delivery complete through completeInitiativeDelivery (WL). */
export async function deliveredInitiative(api: TestApi, c: ClosureWorld, send?: Caller): Promise<string> {
  const req: Caller = send ?? ((m, u, o) => call(api.app, m, u, o));
  const id = await launchedInitiative(api.db, c.b);
  const r = await req("POST", `${c.status(id)}/complete-delivery`, {
    session: c.s.wl.session,
    headers: ifm(1),
    body: {},
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return id;
}

/**
 * A financial benefit of the world at Identify, enabled by `initiativeId` (its benefit of ADR-0034 §2): validation
 * pending. Returns its id and version.
 */
export async function pendingBenefit(api: TestApi, c: ClosureWorld, initiativeId: string) {
  const created = await call(api.app, "POST", `${c.b.base}/benefits`, { session: c.b.s.bo, body: financialBody(c.b) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = (created.body as { id: string }).id;
  const e = await call(api.app, "POST", `${c.b.base}/benefits/${id}/enablers`, {
    session: c.b.s.bo,
    body: { initiativeId },
  });
  expect(e.status, JSON.stringify(e.body)).toBe(201);
  return { id, code: (created.body as { code: string }).code };
}

/**
 * A benefit enabled by `initiativeId` with a Finance-VALIDATED measurement, through the real slice B path: revenue
 * formula, Plan -> Enable -> Measure, baseline validated by FIN, a value submitted by BO and approved by FIN (synthetic
 * Finance decision of test data). `bauOwner`: also set the benefit's BAU owner (BO) and control cadence.
 */
export async function validatedBenefit(api: TestApi, c: ClosureWorld, initiativeId: string, bauOwner = true) {
  const { b } = c;
  const send: Caller = (m, u, o) => call(api.app, m, u, o);
  const formula = await revenueFormula(api, b);
  const created = await send("POST", `${b.base}/benefits`, {
    session: b.s.bo,
    body: financialBody(b, {
      baselineValue: "1000000",
      baselineUnit: "SAR",
      targetValue: "1200000",
      benefitFormulaId: formula.id,
    }),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = (created.body as { id: string }).id;
  let version = (created.body as { version: number }).version;
  const e = await send("POST", `${b.base}/benefits/${id}/enablers`, { session: b.s.bo, body: { initiativeId } });
  expect(e.status, JSON.stringify(e.body)).toBe(201);
  for (const toStep of ["plan", "enable", "measure"]) {
    const r = await send("POST", `${b.base}/benefits/${id}/lifecycle`, {
      session: b.s.bo,
      headers: ifm(version),
      body: { toStep },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    version = (r.body as { version: number }).version;
  }
  await decideBaseline(api, b, id, version);
  const v = await submittedValue(api, b, id, "250000");
  await approve(api, b, v, "250000");
  if (bauOwner) {
    const cur = await send("GET", `${b.base}/benefits/${id}`, { session: b.s.bo });
    const p = await send("PATCH", `${b.base}/benefits/${id}`, {
      session: b.s.bo,
      headers: ifm((cur.body as { version: number }).version),
      body: { bauOwnerUserId: b.users.bo.id, controlCadence: "quarterly" },
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
  }
  return { id, code: (created.body as { code: string }).code };
}

/**
 * A SYNTHETIC approved G6 (Sustain) gate instance of the world's transformation: the instance (with its audit event),
 * then the DG3 portfolio fixture's pending submission and status (app role, audited). Slice H routes real G5/G6
 * decisions; this approves nothing, and never implies DG7.
 */
export async function approveG6Synthetic(api: TestApi, b: BenefitWorld): Promise<string> {
  const existing = await api.db
    .selectFrom("gate_instance")
    .select("id")
    .where("transformation_id", "=", b.transformationId)
    .where("gate_code", "=", "G6")
    .executeTakeFirst();
  let id = existing?.id;
  if (id === undefined) {
    const def = await api.db
      .selectFrom("gate_definition")
      .select("default_approver_role_code")
      .where("code", "=", "G6")
      .executeTakeFirstOrThrow();
    const newId = uuidv7();
    await api.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("gate_instance")
        .values({
          id: newId,
          organization_id: b.organizationId,
          transformation_id: b.transformationId,
          gate_code: "G6",
          approver_role_code: def.default_approver_role_code,
          created_by: b.users.tl.id,
          updated_by: b.users.tl.id,
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: b.users.tl.id, requestId: `fixture-g6-${newId}`, source: "api" },
        {
          action: "gate_instance.create",
          recordType: "gate_instance",
          recordId: newId,
          organizationId: b.organizationId,
          transformationId: b.transformationId,
          newVersion: 1,
        },
      );
    });
    id = newId;
  }
  const p = { transformationId: b.transformationId, lead: { id: b.users.tl.id } } as unknown as P2World;
  await setGateStatus(api, p, "G6", "approved");
  return id;
}

/**
 * A transition decision for `benefitId` drafted by BO (residual owner the second BO), monthly from 2030-01-15 to
 * 2031-12-31: far beyond the 7-day horizon, so approval schedules no review until a test moves the dates.
 */
export async function draftDecision(
  send: Caller,
  c: ClosureWorld,
  benefitId: string,
  body: Record<string, unknown> = {},
) {
  const r = await send("POST", c.transitions, {
    session: c.b.s.bo,
    body: {
      benefitId,
      residualOwnerUserId: c.b.users.bo2.id,
      rationale: "Synthetic: the churn benefit realizes over 18 months after delivery",
      expectedRealizationEnd: "2031-12-31",
      monitoringFrequency: "monthly",
      firstMonitoringDate: "2030-01-15",
      ...body,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; code: string; version: number; status: string };
}

/** Submits the draft (BO) and has the SP decide its approval (`outcome`); returns the approval id. */
export async function decideDecision(
  send: Caller,
  c: ClosureWorld,
  decision: { id: string; version: number },
  outcome: "approve" | "reject" | "request_changes" = "approve",
): Promise<string> {
  const D = `${c.transitions}/${decision.id}`;
  const sub = await send("POST", `${D}/submit`, { session: c.b.s.bo, headers: ifm(decision.version) });
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  const approvalId = (sub.body as { approvalId: string }).approvalId;
  const a = await send("GET", `/api/v1/approvals/${approvalId}`, { session: c.sp.session });
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  const d = await send("POST", `/api/v1/approvals/${approvalId}/decisions`, {
    session: c.sp.session,
    headers: ifm((a.body as { version: number }).version),
    body: {
      outcome,
      rationale: "Synthetic decision on synthetic data",
      subjectVersion: (a.body as { subjectVersion: number }).subjectVersion,
    },
  });
  expect(d.status, JSON.stringify(d.body)).toBe(200);
  return approvalId;
}

// ------------------------------------------------------------------------------------------------ the exercises

export async function exerciseP4BeJOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const c = await seedClosureWorld(ctx.api, ctx.world);
  const { b } = c;

  // ------------------------------------------------------------------ status model (ADR-0034 §1, §2)
  const ini = await launchedInitiative(ctx.api.db, b);
  const I = c.status(ini);
  const sm = await m("GET", `${I}/status-model`, { session: b.s.auditor });
  expect([sm.status, sm.body.label, sm.body.value, sm.headers.etag]).toEqual([200, "In delivery", "no_benefit", '"1"']);
  expect((await m("GET", `${I}/status-model`, { session: b.s.admin })).status).toBe(404);
  expect((await m("POST", `${I}/complete-delivery`, { session: c.s.wl.session, body: {} })).status).toBe(428);
  expect((await m("POST", `${I}/complete-delivery`, { session: b.s.auditor, headers: ifm(1), body: {} })).status).toBe(
    403,
  );
  const done = await m("POST", `${I}/complete-delivery`, {
    session: c.s.wl.session,
    headers: ifm(1),
    body: { note: "Synthetic: delivered" },
  });
  expect([done.status, done.body.delivery, done.body.adoption, done.body.closure, done.body.label]).toEqual([
    200,
    "completed",
    "not_assessed",
    "open",
    "Delivered — value validation pending",
  ]);
  const again = await m("POST", `${I}/complete-delivery`, { session: c.s.wl.session, headers: ifm(2), body: {} });
  expect([again.status, again.body.code]).toEqual([422, "initiative.delivery_not_launched"]);
  const bad = await m("POST", `${I}/adoption-status`, {
    session: b.s.bo,
    headers: ifm(2),
    body: { adoptionStatus: "not_assessed" },
  });
  expect([bad.status, bad.body.code]).toEqual([422, "initiative.adoption_status_invalid"]);
  const adopted = await m("POST", `${I}/adoption-status`, {
    session: b.s.bo,
    headers: ifm(2),
    body: { adoptionStatus: "on_track", note: "Synthetic: pilot users on the new flow" },
  });
  expect([adopted.status, adopted.body.adoption, adopted.body.adoptionSource]).toEqual([200, "on_track", "owner"]);
  const tsm = await m("GET", `${b.base}/status-model`, { session: b.s.auditor });
  expect([tsm.status, tsm.body.label]).toEqual([200, "Delivery complete - value validation pending"]);

  // ------------------------------------------------------------------ closure refusals (ADR-0034 §7)
  const pending = await m("POST", `${I}/close`, { session: b.s.tl, body: {} });
  expect([pending.status, pending.body.code]).toEqual([422, "closure.value_validation_pending"]);
  const notG6 = await m("POST", `${b.base}/close`, { session: b.s.tl, body: {} });
  expect([notG6.status, notG6.body.code]).toEqual([422, "closure.g6_not_approved"]);

  // ------------------------------------------------------------------ transition decisions (ADR-0034 §3)
  const ben = await pendingBenefit(ctx.api, c, ini);
  expect((await m("GET", c.transitions, { session: b.s.auditor })).status).toBe(200);
  const td = await draftDecision(m, c, ben.id);
  expect([td.code, td.status, td.version]).toEqual(["TD-01", "draft", 1]);
  const dup = await m("POST", c.transitions, {
    session: b.s.fin,
    body: {
      benefitId: ben.id,
      residualOwnerUserId: b.users.bo2.id,
      rationale: "Synthetic duplicate",
      expectedRealizationEnd: "2027-12-31",
      monitoringFrequency: "quarterly",
      firstMonitoringDate: "2026-12-01",
    },
  });
  expect([dup.status, dup.body.code]).toEqual([409, "transition_decision.exists"]);
  const D = `${c.transitions}/${td.id}`;
  expect((await m("GET", D, { session: b.s.auditor })).headers.etag).toBe('"1"');
  const upd = await m("PATCH", D, { session: b.s.bo, headers: ifm(1), body: { monitoringInterval: 2 } });
  expect([upd.status, upd.body.version]).toEqual([200, 2]);
  expect((await m("PATCH", D, { session: b.s.bo, body: { monitoringInterval: 1 } })).status).toBe(428);
  const sub = await m("POST", `${D}/submit`, { session: b.s.bo, headers: ifm(2) });
  expect([sub.status, sub.body.status, typeof sub.body.approvalId]).toEqual([200, "submitted", "string"]);
  const frozen = await m("PATCH", D, { session: b.s.bo, headers: ifm(2), body: { rationale: "Synthetic edit" } });
  expect([frozen.status, frozen.body.code]).toEqual([422, "transition_decision.frozen"]);
  const a = await call(ctx.api.app, "GET", `/api/v1/approvals/${sub.body.approvalId}`, { session: c.sp.session });
  const decided = await call(ctx.api.app, "POST", `/api/v1/approvals/${sub.body.approvalId}/decisions`, {
    session: c.sp.session,
    headers: ifm(a.body.version),
    body: { outcome: "approve", rationale: "Synthetic decision", subjectVersion: a.body.subjectVersion },
  });
  expect(decided.status, JSON.stringify(decided.body)).toBe(200);
  const approved = await m("GET", D, { session: b.s.auditor });
  expect([approved.body.status, approved.body.nextMonitoringDate]).toEqual(["approved", "2030-01-15"]);
  const fin = await m("PATCH", D, {
    session: b.s.bo,
    headers: ifm(approved.body.version),
    body: { status: "withdrawn" },
  });
  expect([fin.status, fin.body.code]).toEqual([422, "transition_decision.final"]);
  const listed = await m("GET", `${c.transitions}?status=approved&benefitId=${ben.id}`, { session: b.s.auditor });
  expect(listed.body.items.map((x: { id: string }) => x.id)).toEqual([td.id]);

  // ------------------------------------------------------------------ closures
  const closedI = await m("POST", `${I}/close`, { session: b.s.tl, body: { note: "Synthetic: value covered" } });
  expect([closedI.status, closedI.body.subjectKind, closedI.body.basis]).toEqual([
    201,
    "initiative",
    "transition_decision",
  ]);
  const twice = await m("POST", `${I}/close`, { session: b.s.tl, body: {} });
  expect([twice.status, twice.body.code]).toEqual([409, "closure.already_closed"]);
  await approveG6Synthetic(ctx.api, b);
  const closedT = await m("POST", `${b.base}/close`, { session: b.s.tl, body: {} });
  expect([closedT.status, closedT.body.subjectKind]).toEqual([201, "transformation"]);
  const records = await m("GET", `${b.base}/closure-records`, { session: b.s.auditor });
  expect(records.body.items).toHaveLength(2);
  const after = await m("GET", `${b.base}/status-model`, { session: b.s.auditor });
  expect([after.body.closureState, after.body.label]).toEqual(["closed", "Closed"]);
}

/**
 * Closes a world's transformation through the GOVERNED closure (closeTransformation, TL), replacing BE-I's direct
 * closure-record fixture where a test only needs a closed transformation (assignment T-DG4-BE-J): the SP party mapped
 * (a new SP user) if unmapped, the transformation made active if it is a draft, the SYNTHETIC approved G6
 * (approveG6Synthetic), and every pending active benefit (one synthetic benefit if there is none) covered by an
 * approved transition decision (BO proposes, SP decides; synthetic). Every area must already be in BAU or retired
 * (the closure refuses otherwise, as it must). Returns the closure record id and time, as the old fixture did.
 */
export async function closeTransformationGoverned(
  api: TestApi,
  w: World,
  b: BenefitWorld,
): Promise<{ closureRecordId: string; closedAt: string }> {
  wireApprovals();
  const send: Caller = (m, u, o) => call(api.app, m, u, o);
  const mapping = await api.db
    .selectFrom("role_mapping")
    .select(["user_id"])
    .where("transformation_id", "=", b.transformationId)
    .where("party_code", "=", "SP")
    .where("status", "=", "active")
    .executeTakeFirst();
  // The worlds this replaces map no SP; a world that already maps one decides through it (decideDecision) instead.
  if (mapping) throw new Error("closeTransformationGoverned: the SP party is already mapped in this transformation");
  const u = await extraUser(api, w, b, "SP");
  const mapped = await send("POST", `${b.base}/role-mappings`, {
    session: b.s.tl,
    body: { partyCode: "SP", targetKind: "user", userId: u.id },
  });
  expect(mapped.status, JSON.stringify(mapped.body)).toBe(201);
  const sp = { id: u.id, session: u.session };
  const t = await api.db
    .selectFrom("transformation")
    .select("status")
    .where("id", "=", b.transformationId)
    .executeTakeFirstOrThrow();
  if (t.status === "draft") await setTransformationStatus(api.db, b, "active");
  await approveG6Synthetic(api, b);
  const c: ClosureWorld = {
    s: undefined as unknown as SustainmentWorld,
    b,
    sp,
    status: (id) => `/api/v1/initiatives/${id}`,
    transitions: `${b.base}/transition-decisions`,
  };
  const pending = async () =>
    api.db
      .selectFrom("benefit as bf")
      .select("bf.id")
      .where("bf.transformation_id", "=", b.transformationId)
      .where("bf.status", "=", "active")
      .where((eb) =>
        eb.not(
          eb.or([
            eb.exists(
              eb
                .selectFrom("benefit_measurement as m")
                .select("m.id")
                .whereRef("m.benefit_id", "=", "bf.id")
                .where("m.status", "=", "validated"),
            ),
            eb.exists(
              eb
                .selectFrom("transition_decision as d")
                .select("d.id")
                .whereRef("d.benefit_id", "=", "bf.id")
                .where("d.status", "=", "approved"),
            ),
          ]),
        ),
      )
      .execute();
  let open = await pending();
  if (open.length === 0) {
    const any = await api.db
      .selectFrom("benefit")
      .select("id")
      .where("transformation_id", "=", b.transformationId)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!any) {
      const created = await send("POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b) });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      open = await pending();
    }
  }
  for (const { id } of open) {
    const td = await draftDecision(send, c, id, { residualOwnerUserId: b.users.bo.id });
    await decideDecision(send, c, td);
  }
  const r = await send("POST", `${b.base}/close`, { session: b.s.tl, body: {} });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { closureRecordId: (r.body as { id: string }).id, closedAt: (r.body as { closedAt: string }).closedAt };
}
