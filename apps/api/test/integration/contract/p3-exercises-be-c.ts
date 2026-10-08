// P3 contract exercises of BE-C (T-DG3-BE-C; p3-work-split §5): roadmap waves, deliverables, milestones, the roadmap
// read model, the T08 dependency map and the dependency types - all 25 operations through `ctx.mirrored` (OpenAPI
// status/body/headers + problem mirror), every success body parsed with the zod mirror listed in P3_MIRRORS_BE_C.
// Also exports the synthetic-initiative fixture the BE-C integration suites share (the initiative create route is
// BE-B's; these rows are inserted with their audit event, as the database's audit guard requires).
// All data is synthetic; a deliverable acceptance or an approved milestone date below is a demo business decision by
// a synthetic user and approves nothing real; nothing here touches the engineering gates DG0-DG7.
import {
  deliverable,
  deliverableList,
  dependencyType,
  dependencyTypeList,
  milestone,
  milestoneList,
  roadmapView,
  roadmapWave,
  roadmapWaveList,
  t08Dependency,
  t08DependencyPage,
} from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import { record } from "../../../src/modules/audit/index.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { uniq, type P3ExerciseContext, type TestApi } from "../../support/harness.ts";

// The roadmap, T08 and dependency-type mirrors are the shared ones (`@mth/shared/schemas` roadmap.ts, T-DG3-ARCH-04);
// RoadmapView used to be defined here.

export const P3_MIRRORS_BE_C: Readonly<Record<string, z.ZodType>> = {
  listRoadmapWaves: roadmapWaveList,
  createRoadmapWave: roadmapWave,
  getRoadmapWave: roadmapWave,
  updateRoadmapWave: roadmapWave,
  getRoadmap: roadmapView,
  listDeliverables: deliverableList,
  createDeliverable: deliverable,
  getDeliverable: deliverable,
  updateDeliverable: deliverable,
  submitDeliverable: deliverable,
  decideDeliverable: deliverable,
  listMilestones: milestoneList,
  createMilestone: milestone,
  getMilestone: milestone,
  updateMilestone: milestone,
  approveMilestoneDate: milestone,
  listT08Dependencies: t08DependencyPage,
  createT08Dependency: t08Dependency,
  getT08Dependency: t08Dependency,
  updateT08Dependency: t08Dependency,
  archiveT08Dependency: t08Dependency,
  listDependencyTypes: dependencyTypeList,
  createDependencyType: dependencyType,
  updateDependencyType: dependencyType,
  retireDependencyType: dependencyType,
};

// ------------------------------------------------------------------------------------------------ fixture

export interface SyntheticInitiative {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * Inserts synthetic initiatives (draft) into the world's transformation, each with its `initiative.create` audit event
 * in the same transaction. Codes come from the transformation's INI counter (INI-01, INI-02, …).
 */
export async function insertInitiatives(
  api: TestApi,
  p: P2World,
  specs: ReadonlyArray<{
    readonly name?: string;
    readonly executiveOwnerUserId?: string | null;
    readonly plannedStart?: string | null;
    readonly plannedEnd?: string | null;
    readonly waveId?: string | null;
  }>,
): Promise<SyntheticInitiative[]> {
  return api.db.transaction().execute(async (tx) => {
    const t = await tx
      .selectFrom("transformation")
      .select("organization_id")
      .where("id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    const out: SyntheticInitiative[] = [];
    for (const spec of specs) {
      const counter = await tx
        .insertInto("record_code_counter")
        .values({ transformation_id: p.transformationId, prefix: "INI", last_value: 1 })
        .onConflict((oc) =>
          oc
            .columns(["transformation_id", "prefix"])
            .doUpdateSet((eb) => ({ last_value: eb("record_code_counter.last_value", "+", 1) })),
        )
        .returning("last_value")
        .executeTakeFirstOrThrow();
      const code = `INI-${String(counter.last_value).padStart(2, "0")}`;
      const id = uuidv7();
      const name = spec.name ?? `Synthetic initiative ${code}`;
      await tx
        .insertInto("initiative")
        .values({
          id,
          organization_id: t.organization_id,
          transformation_id: p.transformationId,
          code,
          name,
          executive_owner_user_id: spec.executiveOwnerUserId ?? null,
          planned_start: spec.plannedStart ?? null,
          planned_end: spec.plannedEnd ?? null,
          wave_id: spec.waveId ?? null,
          created_by: p.lead.id,
          updated_by: p.lead.id,
        })
        .execute();
      await record(
        tx,
        { actorUserId: p.lead.id, requestId: `fixture-${uuidv7()}` },
        {
          action: "initiative.create",
          recordType: "initiative",
          recordId: id,
          organizationId: t.organization_id,
          transformationId: p.transformationId,
          newVersion: 1,
          changes: { name: { from: null, to: name } },
        },
      );
      out.push({ id, code, name });
    }
    return out;
  });
}

// ------------------------------------------------------------------------------------------------ exercises

/** A synthetic non-source wave (Arabic text is synthetic and provisional). */
export const WAVE_BODY = Object.freeze({
  code: "wave_hypercare",
  nameEn: "Synthetic hypercare wave",
  nameAr: "موجة اصطناعية",
  purposeEn: "Synthetic purpose",
  purposeAr: "غرض اصطناعي",
  horizonEn: "2-4 months",
  horizonAr: "٢-٤ أشهر",
  entryCriteriaEn: "Synthetic entry",
  entryCriteriaAr: "دخول اصطناعي",
  exitEvidenceEn: "Synthetic exit",
  exitEvidenceAr: "خروج اصطناعي",
  horizonFromWeeks: 8,
  horizonToWeeks: 17,
});

export async function exerciseP3BeCOperations(ctx: P3ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const p = await setupP2World(ctx.api, ctx.world, m);
  const T = `/api/v1/transformations/${p.transformationId}`;

  // Waves: the four source waves verbatim, an added one, read and edit.
  const waves = await m("GET", `${T}/waves`, { session: p.auditor.session });
  expect(waves.status).toBe(200);
  expect(waves.body.items.map((w: { nameEn: string }) => w.nameEn).slice(0, 4)).toEqual([
    "Wave 0 — Mobilize",
    "Wave 1 — Prove",
    "Wave 2 — Scale",
    "Wave 3 — Embed",
  ]);
  const added = await m("POST", `${T}/waves`, { session: p.lead.session, body: WAVE_BODY });
  expect(added.status, JSON.stringify(added.body)).toBe(201);
  const dup = await m("POST", `${T}/waves`, {
    session: p.lead.session,
    body: { ...WAVE_BODY, code: "wave_0" },
  });
  expect([dup.status, dup.body.code]).toEqual([409, "roadmap_wave.duplicate_code"]);
  const wave0 = waves.body.items[0];
  expect((await m("GET", `${T}/waves/${wave0.id}`, { session: p.auditor.session })).status).toBe(200);
  const patched = await m("PATCH", `${T}/waves/${wave0.id}`, {
    session: p.lead.session,
    headers: ifm(wave0.version),
    body: { plannedStart: "2026-01-04", plannedEnd: "2026-02-12", notes: "Synthetic note" },
  });
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  expect(
    (await m("PATCH", `${T}/waves/${wave0.id}`, { session: p.auditor.session, headers: ifm(2), body: { notes: "x" } }))
      .status,
  ).toBe(403);

  // Initiatives (synthetic rows; the Sponsor is the executive owner of INI-01).
  const [a, b] = await insertInitiatives(ctx.api, p, [
    { executiveOwnerUserId: p.sponsor.id, plannedEnd: "2026-07-01", waveId: wave0.id },
    { plannedStart: "2026-08-01" },
  ]);

  // Deliverables: create, list, read, edit, submit (lead), accept (the Sponsor, executive owner).
  const D = `/api/v1/initiatives/${a!.id}/deliverables`;
  const del = await m("POST", D, { session: p.lead.session, body: { title: "Synthetic deliverable" } });
  expect(del.status, JSON.stringify(del.body)).toBe(201);
  const list = await m("GET", D, { session: p.auditor.session });
  expect([list.status, list.body.countWarning?.code]).toEqual([200, "initiative.deliverable_count"]);
  expect((await m("GET", `/api/v1/deliverables/${del.body.id}`, { session: p.auditor.session })).status).toBe(200);
  const edited = await m("PATCH", `/api/v1/deliverables/${del.body.id}`, {
    session: p.lead.session,
    headers: ifm(1),
    body: { dueDate: "2026-06-30" },
  });
  expect(edited.status).toBe(200);
  const submitted = await m("POST", `/api/v1/deliverables/${del.body.id}/submit`, {
    session: p.lead.session,
    headers: ifm(2),
    body: {},
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  const accepted = await m("POST", `/api/v1/deliverables/${del.body.id}/acceptance`, {
    session: p.sponsor.session,
    headers: ifm(3),
    body: { result: "accepted", note: "Synthetic demo acceptance." },
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);

  // Milestones: create, list, read, move the forecast (stale If-Match 409), approve the date.
  const M = `/api/v1/initiatives/${a!.id}/milestones`;
  const ms = await m("POST", M, {
    session: p.contributor.session,
    body: { title: "Synthetic milestone", forecastDate: "2026-05-01" },
  });
  expect(ms.status, JSON.stringify(ms.body)).toBe(201);
  expect((await m("GET", M, { session: p.auditor.session })).status).toBe(200);
  expect((await m("GET", `/api/v1/milestones/${ms.body.id}`, { session: p.auditor.session })).status).toBe(200);
  const moved = await m("PATCH", `/api/v1/milestones/${ms.body.id}`, {
    session: p.lead.session,
    headers: ifm(1),
    body: { forecastDate: "2026-05-20" },
  });
  expect(moved.status).toBe(200);
  const stale = await m("PATCH", `/api/v1/milestones/${ms.body.id}`, {
    session: p.lead.session,
    headers: ifm(1),
    body: { forecastDate: "2026-05-25" },
  });
  expect([stale.status, stale.body.currentVersion]).toEqual([409, 2]);
  const approved = await m("POST", `/api/v1/milestones/${ms.body.id}/approve-date`, {
    session: p.lead.session,
    headers: ifm(2),
    body: { approvedDate: "2026-05-01", reason: "Synthetic baseline" },
  });
  expect([approved.status, approved.body.varianceDays]).toEqual([200, 19]);

  // Dependency types: list, add, relabel, retire; a system type is never retired (422).
  const types = await m("GET", "/api/v1/dependency-types", { session: p.auditor.session });
  expect(types.status).toBe(200);
  const code = uniq("ct_").toLowerCase();
  const created = await m("POST", "/api/v1/dependency-types", {
    session: p.methodologyAdmin.session,
    body: { code, labelEn: "Synthetic type", labelAr: "نوع اصطناعي" },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const relabelled = await m("PATCH", `/api/v1/dependency-types/${code}`, {
    session: p.methodologyAdmin.session,
    headers: ifm(1),
    body: { labelEn: "Synthetic type (renamed)" },
  });
  expect(relabelled.status).toBe(200);
  expect(
    (await m("DELETE", "/api/v1/dependency-types/tech", { session: p.methodologyAdmin.session, headers: ifm(1) }))
      .status,
  ).toBe(422);

  // T08: create (initiative and external From), list, read, update, archive; unknown type 422; cycle 422.
  const dep = await m("POST", "/api/v1/dependencies", {
    session: p.lead.session,
    body: {
      transformationId: p.transformationId,
      description: "Synthetic: INI-02 needs INI-01's data platform",
      from: { kind: "initiative", initiativeId: a!.id },
      toInitiativeId: b!.id,
      dependencyType: code,
      neededBy: "2026-06-01",
    },
  });
  expect(dep.status, JSON.stringify(dep.body)).toBe(201);
  const ext = await m("POST", "/api/v1/dependencies", {
    session: p.lead.session,
    body: {
      transformationId: p.transformationId,
      description: "Synthetic vendor delivery",
      from: { kind: "external", label: "Synthetic vendor" },
      toInitiativeId: a!.id,
      dependencyType: "vendor",
    },
  });
  expect(ext.status, JSON.stringify(ext.body)).toBe(201);
  const cycle = await m("POST", "/api/v1/dependencies", {
    session: p.lead.session,
    body: {
      transformationId: p.transformationId,
      description: "Synthetic back edge",
      from: { kind: "initiative", initiativeId: b!.id },
      toInitiativeId: a!.id,
      dependencyType: "tech",
    },
  });
  expect([cycle.status, cycle.body.code]).toEqual([422, "dependency.cycle"]);
  const unknown = await m("POST", "/api/v1/dependencies", {
    session: p.lead.session,
    body: {
      transformationId: p.transformationId,
      description: "Synthetic",
      from: { kind: "external", label: "Synthetic" },
      toInitiativeId: a!.id,
      dependencyType: "no_such_type",
    },
  });
  expect([unknown.status, unknown.body.code]).toEqual([422, "dependency.unknown_type"]);
  const page = await m("GET", `/api/v1/dependencies?transformationId=${p.transformationId}`, {
    session: p.auditor.session,
  });
  expect(page.status).toBe(200);
  expect((await m("GET", `/api/v1/dependencies/${dep.body.id}`, { session: p.auditor.session })).status).toBe(200);
  const updated = await m("PATCH", `/api/v1/dependencies/${dep.body.id}`, {
    session: p.lead.session,
    headers: ifm(1),
    body: { mitigation: "Synthetic mitigation", status: "at_risk" },
  });
  expect(updated.status, JSON.stringify(updated.body)).toBe(200);

  // The roadmap: one read model.
  const roadmap = await m("GET", `${T}/roadmap`, { session: p.auditor.session });
  expect(roadmap.status, JSON.stringify(roadmap.body)).toBe(200);

  const archived = await m("POST", `/api/v1/dependencies/${ext.body.id}/archive`, {
    session: p.lead.session,
    headers: ifm(1),
    body: { reason: "Synthetic: no longer needed" },
  });
  expect(archived.status).toBe(200);
  const retired = await m("DELETE", `/api/v1/dependency-types/${code}`, {
    session: p.methodologyAdmin.session,
    headers: ifm(2),
  });
  expect([retired.status, retired.body.status]).toEqual([200, "retired"]);
}

// ------------------------------------------------------------------------------------------------ lock helper

/**
 * Commit-time authorisation probe (BE18A): runs `lockSql` in a separate owner-role transaction, starts `request`
 * (which must wait on that lock), waits until PostgreSQL reports the request's connection as blocked by the holder
 * (pg_blocking_pids), runs `meanwhile` (e.g. revokes the caller's grant), then commits the holder and returns the
 * request's result. Proves the write decided on grants reloaded AFTER the wait, i.e. at commit time.
 */
export async function whileBlocked<T>(
  api: TestApi,
  lockSql: string,
  params: readonly unknown[],
  request: () => Promise<T>,
  meanwhile: () => Promise<void>,
): Promise<T> {
  const holder = await api.owner.connect();
  try {
    await holder.query("begin");
    await holder.query(lockSql, [...params]);
    const pid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    const pending = request();
    let blocked = 0;
    for (let i = 0; i < 300 && blocked === 0; i++) {
      blocked = (
        await api.owner.query<{ n: number }>(
          "select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
          [pid],
        )
      ).rows[0]!.n;
      if (blocked === 0) await new Promise((r) => setTimeout(r, 20));
    }
    expect(blocked, "the request never waited on the held lock").toBeGreaterThan(0);
    await meanwhile();
    await holder.query("commit");
    return await pending;
  } catch (err) {
    await holder.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    holder.release();
  }
}
