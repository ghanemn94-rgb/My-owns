// P4 contract exercises of BE-I (T-DG4-BE-I; p4-work-split §F+G FG.4, §1 S-10): the 17 slice G operations of
// performance areas, their links and cycles, BAU handovers and receiving-owner acceptance. Every call goes through
// `ctx.mirrored` (OpenAPI status/body/headers + problem mirror) and every success body is parsed with the zod mirror in
// P4_MIRRORS_BE_I. BE-I2 appends its controls, checks, reviews, CI and lesson exercises to this file after BE-I (no new
// seam file). The fixtures below are shared with test/integration/sustainment/*.test.ts. All data is SYNTHETIC; the
// handover acceptance here is a synthetic in-product business approval of test data, never a real one, and nothing here
// touches the engineering gates DG0-DG7.
import { createDb, insertAuditEvent, sql, type Db } from "@mth/db";
import {
  bauHandover,
  bauHandoverPage,
  control,
  controlCheck,
  controlCheckPage,
  controlPage,
  improvementItem,
  improvementItemPage,
  lesson,
  lessonPage,
  lessonSearchPage,
  performanceArea,
  performanceAreaLink,
  performanceAreaLinkPage,
  performanceAreaPage,
  sustainmentReview,
  sustainmentReviewPage,
} from "@mth/shared/schemas";
import { runControlCheckScan } from "../../../../worker/src/handlers/sustainment.ts";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import {
  call,
  type P4ExerciseContext,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser, financialBody, seedBenefitWorld, type BenefitWorld, type Caller } from "../benefits/fixtures.ts";

export const P4_MIRRORS_BE_I: Readonly<Record<string, z.ZodType>> = {
  listPerformanceAreas: performanceAreaPage,
  createPerformanceArea: performanceArea,
  getPerformanceArea: performanceArea,
  updatePerformanceArea: performanceArea,
  reopenPerformanceArea: performanceArea,
  retirePerformanceArea: performanceArea,
  listPerformanceAreaLinks: performanceAreaLinkPage,
  createPerformanceAreaLink: performanceAreaLink,
  removePerformanceAreaLink: performanceAreaLink,
  listBauHandovers: bauHandoverPage,
  createBauHandover: bauHandover,
  getBauHandover: bauHandover,
  updateBauHandover: bauHandover,
  addBauHandoverEvidence: bauHandover,
  submitBauHandover: bauHandover,
  acceptBauHandover: bauHandover,
  returnBauHandover: bauHandover,
  // T-DG4-BE-I2: controls, control checks, reviews, the CI backlog and lessons.
  listControls: controlPage,
  createControl: control,
  updateControl: control,
  listControlChecks: controlCheckPage,
  recordControlCheck: controlCheck,
  listSustainmentReviews: sustainmentReviewPage,
  completeSustainmentReview: sustainmentReview,
  listImprovementItems: improvementItemPage,
  createImprovementItem: improvementItem,
  updateImprovementItem: improvementItem,
  listLessons: lessonPage,
  createLesson: lesson,
  updateLesson: lesson,
  publishLesson: lesson,
  searchLessons: lessonSearchPage,
};

// ------------------------------------------------------------------------------------------------ shared fixtures

type Extra = Awaited<ReturnType<typeof extraUser>>;

export interface SustainmentWorld {
  readonly b: BenefitWorld;
  /** Workstream Lead (bau_handover.prepare). */
  readonly wl: Extra;
  /** Transformation Office (performance_area.manage, no bau_handover.accept). */
  readonly to: Extra;
  /** A second BO in the transformation: holds bau_handover.accept but is not the receiving owner. */
  readonly bo2: { id: string; session: Session };
  readonly areas: string;
  readonly handovers: string;
}

/** The slice B benefit world plus a WL and a TO, and the slice G paths. */
export async function seedSustainmentWorld(api: TestApi, w: World, send?: Caller): Promise<SustainmentWorld> {
  const b = await seedBenefitWorld(api, w, send);
  return {
    b,
    wl: await extraUser(api, w, b, "WL"),
    to: await extraUser(api, w, b, "TO"),
    bo2: { id: b.users.bo2.id, session: b.s.bo2 },
    areas: `${b.base}/performance-areas`,
    handovers: `${b.base}/bau-handovers`,
  };
}

/**
 * An active control of an area (BE-I2 routes createControl; until then a direct write with its audit event, as the P2
 * audit guard demands). `owner` null = without an owner (acceptance transfers it to the receiving owner).
 */
export async function insertControl(db: Db, b: BenefitWorld, areaId: string, owner: string | null): Promise<string> {
  const id = uuidv7();
  const by = b.users.bo.id;
  await db.transaction().execute(async (tx) => {
    const code = `CTL-${String(Math.floor(Math.random() * 900000) + 100).padStart(6, "0")}`;
    await tx
      .insertInto("control")
      .values({
        id,
        organization_id: b.organizationId,
        transformation_id: b.transformationId,
        performance_area_id: areaId,
        code,
        name: "Synthetic monthly churn reconciliation",
        owner_user_id: owner,
        frequency: "monthly",
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: by, requestId: `fixture-${id}`, source: "api" },
      {
        action: "control.create",
        recordType: "control",
        recordId: id,
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

/** A note evidence item of the transformation, through the API. */
export async function createNoteEvidence(send: Caller, b: BenefitWorld, session: Session, owner: string) {
  const r = await send("POST", `${b.base}/evidence`, {
    session,
    body: {
      kind: "note",
      title: "Synthetic SOP sign-off note",
      noteBody: "Synthetic: SOP v1 reviewed",
      ownerUserId: owner,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return (r.body as { id: string }).id;
}

/** Every M0217 content field of a handover (synthetic). */
export const fullContent = (kpiOwnerUserId: string) => ({
  kpiOwnerUserId,
  operatingProcedures: "Synthetic SOP: month-end churn reconciliation",
  capabilityReadiness: "Synthetic: team trained, tooling live",
  unresolvedAcceptedRisks: "Synthetic: vendor data delay accepted (R-01)",
  benefitMonitoringCadence: "monthly",
  dataAccess: "Synthetic: read access to the churn mart granted",
  improvementBacklogSummary: "Synthetic: automate the reconciliation extract",
});

/** An area created through the API by the BO; returns its id. */
export async function createArea(send: Caller, s: SustainmentWorld, body: Record<string, unknown> = {}) {
  const r = await send("POST", s.areas, {
    session: s.b.s.bo,
    body: { name: "Synthetic prepaid churn performance", ...body },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; code: string; version: number };
}

/**
 * An area in BAU through the API: create, a control (direct), evidence, a complete handover prepared by the WL,
 * submitted and accepted by the receiving owner (the BO). Returns the area and the accepted handover.
 */
export async function areaInBau(api: TestApi, s: SustainmentWorld, send: Caller = (m, u, o) => call(api.app, m, u, o)) {
  const area = await createArea(send, s);
  await insertControl(api.db, s.b, area.id, null);
  const evidenceId = await createNoteEvidence(send, s.b, s.wl.session, s.wl.id);
  type Body = { id: string; version: number };
  const created = (await send("POST", s.handovers, {
    session: s.wl.session,
    body: { performanceAreaId: area.id, receivingOwnerUserId: s.b.users.bo.id, ...fullContent(s.b.users.bo.id) },
  })) as Res<Body>;
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const H = `${s.handovers}/${created.body.id}`;
  const ev = (await send("POST", `${H}/evidence`, {
    session: s.wl.session,
    headers: ifm(1),
    body: { evidenceId },
  })) as Res<Body>;
  expect(ev.status, JSON.stringify(ev.body)).toBe(201);
  const sub = (await send("POST", `${H}/submit`, {
    session: s.wl.session,
    headers: ifm(ev.body.version),
  })) as Res<Body>;
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  const acc = await send("POST", `${H}/accept`, { session: s.b.s.bo, headers: ifm(sub.body.version), body: {} });
  expect(acc.status, JSON.stringify(acc.body)).toBe(200);
  return { area, handover: acc.body as { id: string; version: number; acceptedAt: string; acceptedBy: string } };
}

/**
 * A SYNTHETIC closed transformation (BE-J routes closeTransformation; until then the direct closure-record fixture of
 * p4-work-split FG.5). As the schema owner (mth_owner), in ONE transaction: the `closure_record_guard` trigger (its G6
 * check) is disabled, the transformation's `closure_record` is written with its audit event, the trigger is enabled
 * again, and `status = 'closed'` is set (version + 1, audited; never `archived_at`). No G6 approval is created or
 * implied: the fixture approves nothing, real or synthetic, and touches no DG0-DG7 record.
 */
export async function closeTransformationSynthetic(
  api: TestApi,
  b: BenefitWorld,
): Promise<{ closureRecordId: string; closedAt: string }> {
  const owner = createDb(api.owner); // never destroyed here: the harness ends api.owner in close()
  const actor = {
    actorType: "user" as const,
    actorUserId: b.users.tl.id,
    requestId: `fixture-closure-${b.transformationId}`,
    source: "api" as const,
  };
  return owner.transaction().execute(async (tx) => {
    const id = uuidv7();
    await sql`ALTER TABLE closure_record DISABLE TRIGGER closure_record_guard`.execute(tx);
    const cr = await tx
      .insertInto("closure_record")
      .values({
        id,
        organization_id: b.organizationId,
        transformation_id: b.transformationId,
        subject_kind: "transformation",
        basis: "validated_value",
        snapshot: JSON.stringify({ synthetic: true }),
        closed_by: b.users.tl.id,
        created_by: b.users.tl.id,
      })
      .returning("closed_at")
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, actor, {
      action: "closure_record.create",
      recordType: "closure_record",
      recordId: id,
      organizationId: b.organizationId,
      transformationId: b.transformationId,
    });
    // Fire the deferred audit check now (its event is written), so the table has no pending trigger events.
    await sql`SET CONSTRAINTS ALL IMMEDIATE`.execute(tx);
    await sql`ALTER TABLE closure_record ENABLE TRIGGER closure_record_guard`.execute(tx);
    await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
    const t = await tx
      .updateTable("transformation")
      .set({ status: "closed", version: sql<number>`version + 1`, updated_at: sql<Date>`now()` })
      .where("id", "=", b.transformationId)
      .returning("version")
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, actor, {
      action: "transformation.closed",
      recordType: "transformation",
      recordId: b.transformationId,
      organizationId: b.organizationId,
      transformationId: b.transformationId,
      priorVersion: t.version - 1,
      newVersion: t.version,
    });
    return { closureRecordId: id, closedAt: new Date(cr.closed_at as unknown as string).toISOString() };
  });
}

// ------------------------------------------------------------------------------------------------ the exercises

export async function exerciseP4BeIOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const s = await seedSustainmentWorld(ctx.api, ctx.world, m);
  const { b } = s;

  // ------------------------------------------------------------------ performance areas (ADR-0034 §4)
  expect((await m("GET", s.areas, { session: b.s.auditor })).status).toBe(200);
  expect((await m("GET", s.areas, { session: b.s.admin })).status).toBe(404);
  const area = await createArea(m, s, { reviewFrequency: "quarterly", reviewInterval: 1 });
  const A = `${s.areas}/${area.id}`;
  expect([area.code, area.version]).toEqual(["PA-01", 1]);
  const got = await m("GET", A, { session: b.s.auditor });
  expect([got.status, got.body.status, got.body.cycles.length]).toEqual([200, "establishing", 1]);
  const upd = await m("PATCH", A, { session: s.to.session, headers: ifm(1), body: { description: "Synthetic" } });
  expect([upd.status, upd.body.version]).toEqual([200, 2]);
  expect((await m("PATCH", A, { session: s.to.session, body: { name: "x" } })).status).toBe(428);
  expect((await m("GET", `${s.areas}?status=establishing`, { session: b.s.tl })).body.items.length).toBeGreaterThan(0);

  // ------------------------------------------------------------------ links
  const benefit = await m("POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b) });
  expect(benefit.status, JSON.stringify(benefit.body)).toBe(201);
  const kpiLink = await m("POST", `${A}/links`, {
    session: b.s.bo,
    body: { linkKind: "kpi", kpiDefinitionId: b.kpiDefinitionId },
  });
  expect([kpiLink.status, kpiLink.body.status]).toEqual([201, "active"]);
  const dup = await m("POST", `${A}/links`, {
    session: b.s.bo,
    body: { linkKind: "kpi", kpiDefinitionId: b.kpiDefinitionId },
  });
  expect([dup.status, dup.body.code]).toEqual([409, "performance_area_link.exists"]);
  const benLink = await m("POST", `${A}/links`, {
    session: b.s.bo,
    body: { linkKind: "benefit", benefitId: benefit.body.id },
  });
  expect(benLink.status).toBe(201);
  expect((await m("GET", `${A}/links`, { session: b.s.auditor })).body.items).toHaveLength(2);
  const removed = await m("POST", `${A}/links/${benLink.body.id}/remove`, { session: b.s.bo, headers: ifm(1) });
  expect([removed.status, removed.body.status]).toEqual([200, "removed"]);

  // ------------------------------------------------------------------ the handover (ADR-0034 §5)
  await insertControl(ctx.api.db, b, area.id, null);
  const evidenceId = await createNoteEvidence(m, b, s.wl.session, s.wl.id);
  const { dataAccess: _omitted, ...withoutDataAccess } = fullContent(b.users.bo.id);
  const ho = await m("POST", s.handovers, {
    session: s.wl.session,
    body: { performanceAreaId: area.id, receivingOwnerUserId: b.users.bo.id, ...withoutDataAccess },
  });
  expect([ho.status, ho.body.code, ho.body.status]).toEqual([201, "HO-01", "draft"]);
  const H = `${s.handovers}/${ho.body.id}`;
  expect((await m("GET", H, { session: b.s.auditor })).body.missingItems).toEqual(["evidence", "data_access"]);
  expect((await m("GET", `${s.handovers}?performanceAreaId=${area.id}`, { session: b.s.tl })).status).toBe(200);
  const ev = await m("POST", `${H}/evidence`, { session: s.wl.session, headers: ifm(1), body: { evidenceId } });
  expect([ev.status, ev.body.evidenceIds]).toEqual([201, [evidenceId]]);
  const incomplete = await m("POST", `${H}/submit`, { session: s.wl.session, headers: ifm(ev.body.version) });
  expect([incomplete.status, incomplete.body.code, incomplete.body.detail]).toEqual([
    422,
    "bau_handover.incomplete",
    "The BAU handover is incomplete. Missing: data access.",
  ]);
  const edited = await m("PATCH", H, {
    session: s.wl.session,
    headers: ifm(ev.body.version),
    body: { dataAccess: "Synthetic: read access granted" },
  });
  expect([edited.status, edited.body.missingItems]).toEqual([200, []]);
  const sub = await m("POST", `${H}/submit`, { session: s.wl.session, headers: ifm(edited.body.version) });
  expect([sub.status, sub.body.status]).toEqual([200, "submitted"]);
  const notOwner = await m("POST", `${H}/accept`, { session: s.bo2.session, headers: ifm(sub.body.version), body: {} });
  expect([notOwner.status, notOwner.body.code]).toEqual([403, "bau_handover.not_receiving_owner"]);
  const adm = await m("POST", `${H}/accept`, { session: b.s.admin, headers: ifm(sub.body.version), body: {} });
  expect(adm.status).toBe(403);
  const acc = await m("POST", `${H}/accept`, {
    session: b.s.bo,
    headers: ifm(sub.body.version),
    body: { note: "Synthetic acceptance" },
  });
  expect([acc.status, acc.body.status, acc.body.acceptedBy]).toEqual([200, "accepted", b.users.bo.id]);
  const inBau = await m("GET", A, { session: b.s.auditor });
  expect([inBau.body.status, inBau.body.bauOwnerUserId, inBau.body.currentHandoverId]).toEqual([
    "bau",
    b.users.bo.id,
    ho.body.id,
  ]);

  // ------------------------------------------------------------------ reopen, a cycle-2 handover returned, retire
  const reopened = await m("POST", `${A}/reopen`, {
    session: b.s.tl,
    headers: ifm(inBau.body.version),
    body: { reason: "Synthetic: churn deteriorating for two months" },
  });
  expect([reopened.status, reopened.body.status, reopened.body.cycleNo]).toEqual([200, "reopened", 2]);
  const ho2 = await m("POST", s.handovers, {
    session: s.wl.session,
    body: { performanceAreaId: area.id, receivingOwnerUserId: b.users.bo.id, ...fullContent(b.users.bo.id) },
  });
  expect([ho2.status, ho2.body.cycleNo]).toEqual([201, 2]);
  const H2 = `${s.handovers}/${ho2.body.id}`;
  const ev2 = await m("POST", `${H2}/evidence`, { session: s.wl.session, headers: ifm(1), body: { evidenceId } });
  const sub2 = await m("POST", `${H2}/submit`, { session: s.wl.session, headers: ifm(ev2.body.version) });
  expect(sub2.status).toBe(200);
  const ret = await m("POST", `${H2}/return`, {
    session: b.s.bo,
    headers: ifm(sub2.body.version),
    body: { reason: "Synthetic: SOP missing the escalation step" },
  });
  expect([ret.status, ret.body.status]).toEqual([200, "returned"]);
  const noReason = await m("POST", `${H2}/return`, { session: b.s.bo, headers: ifm(ret.body.version), body: {} });
  expect([noReason.status, noReason.body.errors[0].code]).toEqual([400, "bau_handover.return_reason_required"]);

  const other = await createArea(m, s, { name: "Synthetic area to retire" });
  const retired = await m("POST", `${s.areas}/${other.id}/retire`, {
    session: s.to.session,
    headers: ifm(1),
    body: { reason: "Synthetic: merged into PA-01" },
  });
  expect([retired.status, retired.body.status]).toEqual([200, "retired"]);

  await exerciseP4BeI2Operations(ctx, s);
}

// ------------------------------------------------------------------------------------------------ BE-I2 (appended)

/**
 * T-DG4-BE-I2 (p4-work-split §F+G FG.5): the 15 operations of controls, control checks, sustainment reviews, the CI
 * backlog and lessons, through the validating client. Checks are created by the worker's control-check scan (called
 * in-process for this organization, ADR-0002: the test, not the API, imports the worker).
 */
async function exerciseP4BeI2Operations(ctx: P4ExerciseContext, s: SustainmentWorld): Promise<void> {
  const m = ctx.mirrored;
  const { b } = s;
  const { area } = await areaInBau(ctx.api, s, m);
  const controls = `${b.base}/controls`;
  const checks = `${b.base}/control-checks`;
  const reviews = `${b.base}/sustainment-reviews`;
  const items = `${b.base}/improvement-items`;
  const lessons = `${b.base}/lessons`;

  // ------------------------------------------------------------------ controls (ADR-0034 §6)
  expect((await m("GET", controls, { session: b.s.auditor })).status).toBe(200);
  expect((await m("GET", controls, { session: b.s.admin })).status).toBe(404);
  const ctl = await m("POST", controls, {
    session: s.to.session,
    body: {
      performanceAreaId: area.id,
      name: "Synthetic weekly SIM-swap fraud review",
      ownerUserId: b.users.bo.id,
      frequency: "monthly",
      nextCheckDate: "2026-01-05",
    },
  });
  expect([ctl.status, ctl.body.status, ctl.body.nextCheckDate]).toEqual([201, "active", "2026-01-05"]);
  const C = `${controls}/${ctl.body.id}`;
  const edited = await m("PATCH", C, { session: b.s.bo, headers: ifm(1), body: { description: "Synthetic" } });
  expect([edited.status, edited.body.version]).toEqual([200, 2]);
  expect(
    (
      await m("POST", controls, {
        session: b.s.auditor,
        body: { performanceAreaId: area.id, name: "x", frequency: "monthly" },
      })
    ).status,
  ).toBe(403);
  expect((await m("GET", `${controls}?performanceAreaId=${area.id}&status=active`, { session: b.s.tl })).status).toBe(
    200,
  );

  // ------------------------------------------------------------------ control checks (the worker scan creates them)
  const scan = await runControlCheckScan(ctx.api.db, "contract-be-i2", {
    asOf: "2026-01-05",
    organizationId: b.organizationId,
  });
  const step = scan.steps.find((x) => x.subjectId === ctl.body.id)!;
  expect([step.outcome, step.dueDate]).toEqual(["created", "2026-01-05"]);
  const listed = await m("GET", `${checks}?performanceAreaId=${area.id}&status=due`, { session: b.s.auditor });
  expect(listed.status).toBe(200);
  const check = listed.body.items.find((k: { controlId: string }) => k.controlId === ctl.body.id);
  const K = `${checks}/${check.id}/record`;
  const noNote = await m("POST", K, { session: s.to.session, headers: ifm(1), body: { result: "failed" } });
  expect([noNote.status, noNote.body.errors[0].code]).toEqual([400, "control_check.result_note_required"]);
  const failed = await m("POST", K, {
    session: s.to.session,
    headers: ifm(1),
    body: { result: "failed", resultNote: "Synthetic: 3 unreviewed swaps found" },
  });
  expect([failed.status, failed.body.status, failed.body.correctiveCaseId]).toEqual([200, "failed", null]);
  const again = await m("POST", K, { session: s.to.session, headers: ifm(2), body: { result: "passed" } });
  expect([again.status, again.body.code]).toEqual([422, "control_check.final"]);

  // ------------------------------------------------------------------ reviews (acceptance created the first one)
  const rv = await m("GET", `${reviews}?performanceAreaId=${area.id}&status=due`, { session: b.s.auditor });
  expect([rv.status, rv.body.items.length]).toEqual([200, 1]);
  const R = `${reviews}/${rv.body.items[0].id}/complete`;
  const notMine = await m("POST", R, {
    session: b.s.fin,
    headers: ifm(1),
    body: { outcomeNote: "Synthetic", performanceSignal: "on_track" },
  });
  expect([notMine.status, notMine.body.code]).toEqual([403, "sustainment_review.not_assignee"]);
  const done = await m("POST", R, {
    session: b.s.bo,
    headers: ifm(1),
    body: { outcomeNote: "Synthetic: churn stable", performanceSignal: "unknown" },
  });
  expect([done.status, done.body.status, done.body.performanceSignal]).toEqual([200, "done", "unknown"]);

  const retiredCtl = await m("PATCH", C, {
    session: b.s.bo,
    headers: ifm(edited.body.version),
    body: { status: "retired", retireReason: "Synthetic: replaced by automated monitoring" },
  });
  expect([retiredCtl.status, retiredCtl.body.status]).toEqual([200, "retired"]);

  // ------------------------------------------------------------------ the CI backlog (ADR-0034 §8)
  const ci = await m("POST", items, {
    session: s.to.session,
    body: {
      title: "Synthetic: automate the swap review",
      sourceKind: "control_check",
      sourceId: check.id,
      priority: "H",
    },
  });
  expect([ci.status, ci.body.code, ci.body.status, ci.body.sourceId]).toEqual([201, "CI-01", "open", check.id]);
  expect((await m("GET", `${items}?status=open`, { session: b.s.auditor })).body.items).toHaveLength(1);
  const prog = await m("PATCH", `${items}/${ci.body.id}`, {
    session: b.s.bo,
    headers: ifm(1),
    body: { status: "in_progress" },
  });
  expect([prog.status, prog.body.status]).toEqual([200, "in_progress"]);
  const closed = await m("PATCH", `${items}/${ci.body.id}`, {
    session: b.s.bo,
    headers: ifm(2),
    body: { status: "done", resolutionNote: "Synthetic: rule deployed" },
  });
  expect([closed.status, closed.body.status]).toEqual([200, "done"]);

  // ------------------------------------------------------------------ lessons and the search (REQ-S11-008)
  const ll = await m("POST", lessons, {
    session: s.to.session,
    body: {
      title: "Synthetic reconciliation lesson",
      lessonText: "Synthetic: reconcile prepaid churn before month-end close",
      tags: ["churn", "reconciliation"],
    },
  });
  expect([ll.status, ll.body.code, ll.body.status]).toEqual([201, "LL-01", "draft"]);
  const L = `${lessons}/${ll.body.id}`;
  const lu = await m("PATCH", L, { session: b.s.bo, headers: ifm(1), body: { recommendation: "Synthetic: automate" } });
  expect([lu.status, lu.body.version]).toEqual([200, 2]);
  expect((await m("GET", `${lessons}?status=draft`, { session: b.s.auditor })).body.items).toHaveLength(1);
  const pub = await m("POST", `${L}/publish`, { session: b.s.bo, headers: ifm(2) });
  expect([pub.status, pub.body.status]).toEqual([200, "published"]);
  const found = await m("GET", "/api/v1/lessons/search?q=reconcile%20prepaid&tag=churn", { session: b.s.auditor });
  expect(found.status).toBe(200);
  expect(found.body.items.map((h: { lesson: { id: string } }) => h.lesson.id)).toContain(ll.body.id);
  expect((await m("GET", "/api/v1/lessons/search?q=x", { session: b.s.admin })).status).toBe(403);
  const archived = await m("PATCH", L, { session: b.s.bo, headers: ifm(3), body: { status: "archived" } });
  expect([archived.status, archived.body.status]).toEqual([200, "archived"]);
}
