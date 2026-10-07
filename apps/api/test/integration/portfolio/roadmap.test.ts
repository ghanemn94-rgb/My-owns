// Roadmap waves, deliverables, milestones and the roadmap read model (ADR-0023 §1-§3, §5; REQ-PB-050, REQ-PB-045,
// REQ-S09-006, REQ-S09-007 increment, REQ-S16-016; T-DG3-BE-C) against a real PostgreSQL:
//  - a new transformation has the four B0079 waves verbatim; the source text is immutable (API 400, DB trigger);
//    editable columns are edited with If-Match; teams add non-source waves; overlap is accepted;
//  - deliverables: submit, then acceptance by the initiative's executive owner (or their delegate) holding
//    deliverable.accept, never by the submitter;
//  - milestones: the approved date only through approve-date (roadmap.approve; a re-approval has its own reason and
//    audit event); the forecast is movable; variance is computed, never stored; a stale If-Match is 409;
//  - GET /roadmap: one read model with versions and flags; a moved milestone shows in it at once;
//  - every mutation: AUD 403, If-Match 428/409 (creates are version 1), an audit event, and authorisation re-checked
//    at commit time on reloaded grants.
// All data is synthetic; acceptances and approved dates are demo business decisions that approve nothing real, and
// nothing here touches the engineering gates DG0-DG7.
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { record } from "../../../src/modules/audit/index.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { insertInitiatives, WAVE_BODY, whileBlocked } from "../contract/p3-exercises-be-c.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T = (p: P2World) => `/api/v1/transformations/${p.transformationId}`;

/** A fresh Workstream Lead on the transformation (initiative.edit, roadmap.edit), for commit-time revocation tests. */
async function freshWl(p: P2World): Promise<{ id: string; session: Session }> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "WL", { type: "transformation", id: p.transformationId }, w.orgA.id);
  return { id: u.id, session: await signIn(api.app, u.subject) };
}
const revokeAll = (userId: string) =>
  api.owner
    .query(
      "update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic BE18A' where user_id = $2 and revoked_at is null",
      [w.grantor.id, userId],
    )
    .then(() => undefined);
const deniedFor = async (userId: string) =>
  (
    await api.db
      .selectFrom("audit_event")
      .select("action")
      .where("actor_user_id", "=", userId)
      .where("action", "=", "authorization.denied")
      .execute()
  ).length;

// ------------------------------------------------------------------------------------------------ waves

describe("roadmap waves (T07, REQ-PB-050)", () => {
  it("a new transformation shows the four B0079 waves verbatim, bilingual, source-seeded", async () => {
    const p = await setupP2World(api, w);
    const res = await call<Body>(api.app, "GET", `${T(p)}/waves`, { session: p.auditor.session });
    expect(res.status).toBe(200);
    expect(
      res.body.items.map((x: Body) => [
        x.code,
        x.ordinal,
        x.nameEn,
        x.purposeEn,
        x.horizonEn,
        x.entryCriteriaEn,
        x.exitEvidenceEn,
        x.horizonFromWeeks,
        x.horizonToWeeks,
        x.isSourceSeeded,
        x.sourceRef !== null,
        x.version,
      ]),
    ).toEqual([
      [
        "wave_0",
        0,
        "Wave 0 — Mobilize",
        "Baseline, governance, design decisions",
        "0-6 weeks",
        "Sponsor + charter",
        "Approved case, owners, stage gates",
        0,
        6,
        true,
        true,
        1,
      ],
      [
        "wave_1",
        1,
        "Wave 1 — Prove",
        "Quick wins / pilots / de-risking",
        "1-3 months",
        "Prioritized initiatives",
        "Measured pilot results",
        4,
        13,
        true,
        true,
        1,
      ],
      [
        "wave_2",
        2,
        "Wave 2 — Scale",
        "Scale validated changes",
        "3-9 months",
        "Evidence + capacity",
        "Adoption + KPI movement",
        13,
        39,
        true,
        true,
        1,
      ],
      [
        "wave_3",
        3,
        "Wave 3 — Embed",
        "BAU integration / optimization",
        "6-18 months",
        "Stable solution",
        "Benefits sustained, ownership transferred",
        26,
        78,
        true,
        true,
        1,
      ],
    ]);
    // Arabic text is present for every wave (a provisional translation).
    for (const x of res.body.items)
      for (const k of ["nameAr", "purposeAr", "horizonAr", "entryCriteriaAr", "exitEvidenceAr"])
        expect(x[k].length).toBeGreaterThan(0);
    const one = await call<Body>(api.app, "GET", `${T(p)}/waves/${res.body.items[0].id}`, {
      session: p.auditor.session,
    });
    expect([one.status, one.headers["etag"], one.body.nameEn]).toEqual([200, '"1"', "Wave 0 — Mobilize"]);
  });

  it("editable columns only: dates, owner, notes with If-Match (428/409), audited; source text 400 and DB-immutable; AUD 403; seeded not archivable", async () => {
    const p = await setupP2World(api, w);
    const waves = (await call<Body>(api.app, "GET", `${T(p)}/waves`, { session: p.lead.session })).body.items;
    const W = `${T(p)}/waves/${waves[1].id}`;
    const edit = {
      plannedStart: "2026-02-01",
      plannedEnd: "2026-05-01",
      ownerUserId: p.lead.id,
      notes: "Synthetic note",
    };
    expect((await call(api.app, "PATCH", W, { session: p.auditor.session, headers: ifm(1), body: edit })).status).toBe(
      403,
    );
    expect((await call(api.app, "PATCH", W, { session: p.lead.session, body: edit })).status).toBe(428);
    const stale = await call<Body>(api.app, "PATCH", W, { session: p.lead.session, headers: ifm(3), body: edit });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const src = await call<Body>(api.app, "PATCH", W, {
      session: p.lead.session,
      headers: ifm(1),
      body: { nameEn: "Renamed" },
    });
    expect(src.status).toBe(400);
    const range = await call<Body>(api.app, "PATCH", W, {
      session: p.lead.session,
      headers: ifm(1),
      body: { plannedStart: "2026-05-01", plannedEnd: "2026-02-01" },
    });
    expect([range.status, range.body.code]).toEqual([422, "roadmap_wave.planned_range"]);
    const ok = await call<Body>(api.app, "PATCH", W, { session: p.contributor.session, headers: ifm(1), body: edit });
    expect([ok.status, ok.body.version, ok.body.plannedStart, ok.body.notes, ok.body.nameEn]).toEqual([
      200,
      2,
      "2026-02-01",
      "Synthetic note",
      "Wave 1 — Prove",
    ]);
    const audit = await auditOf(api.db, waves[1].id);
    expect(audit.at(-1)).toMatchObject({ action: "roadmap_wave.update", prior_version: 1, new_version: 2 });
    expect(Object.keys(audit.at(-1)!.changes as object).sort()).toEqual([
      "notes",
      "owner_user_id",
      "planned_end",
      "planned_start",
    ]);
    const archive = await call<Body>(api.app, "PATCH", W, {
      session: p.lead.session,
      headers: ifm(2),
      body: { status: "archived" },
    });
    expect([archive.status, archive.body.code]).toEqual([422, "roadmap_wave.seeded_not_archivable"]);
    // The database refuses a change of the verbatim source text even from the application role.
    await expect(
      api.db
        .updateTable("roadmap_wave")
        .set((eb) => ({ horizon_en: "0-8 weeks", version: eb("version", "+", 1) }))
        .where("id", "=", waves[0].id)
        .execute(),
    ).rejects.toMatchObject({ code: "23514", constraint: "roadmap_wave_source_immutable" });
  });

  it("teams add non-source waves (201, version 1, audited); overlapping horizons and dates are accepted; duplicate code 409; AUD 403", async () => {
    const p = await setupP2World(api, w);
    expect((await call(api.app, "POST", `${T(p)}/waves`, { session: p.auditor.session, body: WAVE_BODY })).status).toBe(
      403,
    );
    // Horizon 8-17 weeks overlaps Wave 1 (4-13) and Wave 2 (13-39): accepted.
    const res = await call<Body>(api.app, "POST", `${T(p)}/waves`, {
      session: p.contributor.session,
      body: { ...WAVE_BODY, plannedStart: "2026-01-01", plannedEnd: "2026-12-31" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.body).toMatchObject({
      code: "wave_hypercare",
      ordinal: 4,
      isSourceSeeded: false,
      sourceRef: null,
      version: 1,
    });
    expect((await auditOf(api.db, res.body.id)).map((e) => e.action)).toEqual(["roadmap_wave.create"]);
    const dup = await call<Body>(api.app, "POST", `${T(p)}/waves`, { session: p.lead.session, body: WAVE_BODY });
    expect([dup.status, dup.body.code]).toEqual([409, "roadmap_wave.duplicate_code"]);
    const backwards = await call<Body>(api.app, "POST", `${T(p)}/waves`, {
      session: p.lead.session,
      body: { ...WAVE_BODY, code: "wave_x", horizonFromWeeks: 10, horizonToWeeks: 2 },
    });
    expect([backwards.status, backwards.body.code]).toEqual([422, "roadmap_wave.horizon_range"]);
    // A non-source wave can be archived (and restored).
    const archived = await call<Body>(api.app, "PATCH", `${T(p)}/waves/${res.body.id}`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { status: "archived" },
    });
    expect([archived.status, archived.body.status]).toEqual([200, "archived"]);
  });

  it("commit-time authorisation on wave create and update (403 after the lock wait, audited, nothing written)", async () => {
    const p = await setupP2World(api, w);
    const a = await freshWl(p);
    const created = await whileBlocked(
      api,
      "select id from transformation where id = $1 for update",
      [p.transformationId],
      () =>
        call<Body>(api.app, "POST", `${T(p)}/waves`, { session: a.session, body: { ...WAVE_BODY, code: "wave_race" } }),
      () => revokeAll(a.id),
    );
    expect(created.status).toBe(403);
    expect(await deniedFor(a.id)).toBe(1);
    const waves = (await call<Body>(api.app, "GET", `${T(p)}/waves`, { session: p.lead.session })).body.items;
    expect(waves.map((x: Body) => x.code)).not.toContain("wave_race");
    const b = await freshWl(p);
    const updated = await whileBlocked(
      api,
      "select id from roadmap_wave where id = $1 for update",
      [waves[0].id],
      () =>
        call<Body>(api.app, "PATCH", `${T(p)}/waves/${waves[0].id}`, {
          session: b.session,
          headers: ifm(1),
          body: { notes: "x" },
        }),
      () => revokeAll(b.id),
    );
    expect(updated.status).toBe(403);
    expect(
      (
        await api.db
          .selectFrom("roadmap_wave")
          .select("version")
          .where("id", "=", waves[0].id)
          .executeTakeFirstOrThrow()
      ).version,
    ).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------ deliverables

describe("deliverables: submit and acceptance (ADR-0023 §2)", () => {
  it("create (version 1, audited, AUD 403), list with the 3-7 count warning, read, edit with If-Match, archive", async () => {
    const p = await setupP2World(api, w);
    const [ini] = await insertInitiatives(api, p, [{ executiveOwnerUserId: p.sponsor.id }]);
    const D = `/api/v1/initiatives/${ini!.id}/deliverables`;
    expect((await call(api.app, "POST", D, { session: p.auditor.session, body: { title: "x" } })).status).toBe(403);
    expect((await call(api.app, "POST", D, { session: p.lead.session, body: { title: "" } })).status).toBe(400);
    const ids: string[] = [];
    for (const title of ["Synthetic design", "Synthetic build", "Synthetic rollout"]) {
      const r = await call<Body>(api.app, "POST", D, { session: p.contributor.session, body: { title } });
      expect([r.status, r.body.version, r.body.acceptanceStatus, r.headers["etag"]]).toEqual([
        201,
        1,
        "pending",
        '"1"',
      ]);
      ids.push(r.body.id);
    }
    expect((await auditOf(api.db, ids[0]!)).map((e) => e.action)).toEqual(["deliverable.create"]);
    const list = await call<Body>(api.app, "GET", D, { session: p.auditor.session });
    expect([list.status, list.body.items.map((d: Body) => d.ordinal), list.body.countWarning]).toEqual([
      200,
      [1, 2, 3],
      null,
    ]);
    const U = `/api/v1/deliverables/${ids[2]}`;
    expect(
      (await call(api.app, "PATCH", U, { session: p.auditor.session, headers: ifm(1), body: { title: "x" } })).status,
    ).toBe(403);
    expect((await call(api.app, "PATCH", U, { session: p.lead.session, body: { title: "x" } })).status).toBe(428);
    expect(
      (await call<Body>(api.app, "PATCH", U, { session: p.lead.session, headers: ifm(2), body: { title: "x" } })).body
        .currentVersion,
    ).toBe(1);
    const archived = await call<Body>(api.app, "PATCH", U, {
      session: p.lead.session,
      headers: ifm(1),
      body: { archiveReason: "Synthetic: merged into build" },
    });
    expect([archived.status, archived.body.status, archived.body.archiveReason]).toEqual([
      200,
      "archived",
      "Synthetic: merged into build",
    ]);
    expect((await auditOf(api.db, ids[2]!)).map((e) => [e.action, e.reason])).toEqual([
      ["deliverable.create", null],
      ["deliverable.archive", "Synthetic: merged into build"],
    ]);
    // Two active deliverables: outside 3-7 is a WARNING, never a rejection.
    const after = await call<Body>(api.app, "GET", D, { session: p.lead.session });
    expect([after.body.items.length, after.body.countWarning.code]).toEqual([2, "initiative.deliverable_count"]);
    expect(
      (await call<Body>(api.app, "GET", `${D}?includeArchived=true`, { session: p.lead.session })).body.items,
    ).toHaveLength(3);
    expect((await call(api.app, "GET", `/api/v1/deliverables/${ids[0]}`, { session: p.auditor.session })).status).toBe(
      200,
    );
  });

  it("submit (initiative.edit, If-Match, audited) then acceptance by the executive owner; never the submitter; not-owner 403; AUD 403", async () => {
    const p = await setupP2World(api, w);
    // The lead (TL holds deliverable.accept) is the executive owner of INI-01; the Sponsor of INI-02.
    const [own, other] = await insertInitiatives(api, p, [
      { executiveOwnerUserId: p.lead.id },
      { executiveOwnerUserId: p.sponsor.id },
    ]);
    const make = async (iniId: string) =>
      (
        await call<Body>(api.app, "POST", `/api/v1/initiatives/${iniId}/deliverables`, {
          session: p.lead.session,
          body: { title: "Synthetic" },
        })
      ).body;
    const d1 = await make(own!.id);
    const S = (id: string) => `/api/v1/deliverables/${id}/submit`;
    const A = (id: string) => `/api/v1/deliverables/${id}/acceptance`;
    expect(
      (await call(api.app, "POST", S(d1.id), { session: p.auditor.session, headers: ifm(1), body: {} })).status,
    ).toBe(403);
    expect((await call(api.app, "POST", S(d1.id), { session: p.lead.session, body: {} })).status).toBe(428);
    const sub = await call<Body>(api.app, "POST", S(d1.id), {
      session: p.lead.session,
      headers: ifm(1),
      body: { note: "Synthetic: ready" },
    });
    expect([sub.status, sub.body.acceptanceStatus, sub.body.submittedBy]).toEqual([200, "submitted", p.lead.id]);
    expect(
      (await call<Body>(api.app, "POST", S(d1.id), { session: p.lead.session, headers: ifm(2), body: {} })).body.code,
    ).toBe("deliverable.not_submittable");
    // The owner submitted it: separation of duties refuses the owner's own acceptance (403).
    const self = await call<Body>(api.app, "POST", A(d1.id), {
      session: p.lead.session,
      headers: ifm(2),
      body: { result: "accepted" },
    });
    expect([self.status, self.body.code]).toEqual([403, "deliverable.acceptor_is_submitter"]);
    // INI-02: the Sponsor owns it; the lead (deliverable.accept, not the owner) is refused; AUD 403.
    const d2 = await make(other!.id);
    await call(api.app, "POST", S(d2.id), { session: p.contributor.session, headers: ifm(1), body: {} });
    const notOwner = await call<Body>(api.app, "POST", A(d2.id), {
      session: p.lead.session,
      headers: ifm(2),
      body: { result: "accepted" },
    });
    expect([notOwner.status, notOwner.body.code]).toEqual([403, "deliverable.not_owner"]);
    expect(
      (
        await call(api.app, "POST", A(d2.id), {
          session: p.auditor.session,
          headers: ifm(2),
          body: { result: "accepted" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(api.app, "POST", A(d2.id), { session: p.sponsor.session, body: { result: "accepted" } })).status,
    ).toBe(428);
    expect(
      (
        await call<Body>(api.app, "POST", A(d2.id), {
          session: p.sponsor.session,
          headers: ifm(5),
          body: { result: "accepted" },
        })
      ).body.currentVersion,
    ).toBe(2);
    // Rejected, resubmitted, accepted: a recorded human decision with decider, time and note.
    const rejected = await call<Body>(api.app, "POST", A(d2.id), {
      session: p.sponsor.session,
      headers: ifm(2),
      body: { result: "rejected", note: "Synthetic: evidence missing" },
    });
    expect([rejected.status, rejected.body.acceptanceStatus, rejected.body.decidedBy]).toEqual([
      200,
      "rejected",
      p.sponsor.id,
    ]);
    expect(
      (await call(api.app, "POST", S(d2.id), { session: p.contributor.session, headers: ifm(3), body: {} })).status,
    ).toBe(200);
    const accepted = await call<Body>(api.app, "POST", A(d2.id), {
      session: p.sponsor.session,
      headers: ifm(4),
      body: { result: "accepted", note: "Synthetic demo acceptance." },
    });
    expect([accepted.status, accepted.body.acceptanceStatus, accepted.body.acceptanceNote]).toEqual([
      200,
      "accepted",
      "Synthetic demo acceptance.",
    ]);
    expect((await auditOf(api.db, d2.id)).map((e) => e.action)).toEqual([
      "deliverable.create",
      "deliverable.submit",
      "deliverable.decide",
      "deliverable.submit",
      "deliverable.decide",
    ]);
    expect(
      (
        await call<Body>(api.app, "POST", A(d2.id), {
          session: p.sponsor.session,
          headers: ifm(5),
          body: { result: "accepted" },
        })
      ).body.code,
    ).toBe("deliverable.not_submitted");
  });

  it("a delegate of the executive owner accepts on their behalf (audited as such); never for the submitter", async () => {
    const p = await setupP2World(api, w);
    const [ini] = await insertInitiatives(api, p, [{ executiveOwnerUserId: p.sponsor.id }]);
    const delegate = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, delegate.id, "SP", { type: "transformation", id: p.transformationId }, w.orgA.id);
    const dSession = await signIn(api.app, delegate.subject);
    await api.owner.query(
      `insert into delegation (id, organization_id, delegator_user_id, delegate_user_id, scope_type, scope_id, record_types,
         reason_code, effective_from, effective_to)
       values ($1, $2, $3, $4, 'transformation', $5, null, 'absence', now() - interval '1 day', now() + interval '7 days')`,
      [uuidv7(), w.orgA.id, p.sponsor.id, delegate.id, p.transformationId],
    );
    const d = (
      await call<Body>(api.app, "POST", `/api/v1/initiatives/${ini!.id}/deliverables`, {
        session: p.lead.session,
        body: { title: "Synthetic" },
      })
    ).body;
    await call(api.app, "POST", `/api/v1/deliverables/${d.id}/submit`, {
      session: p.lead.session,
      headers: ifm(1),
      body: {},
    });
    // Without naming whom they act for, the delegate is not the owner (403).
    const bare = await call<Body>(api.app, "POST", `/api/v1/deliverables/${d.id}/acceptance`, {
      session: dSession,
      headers: ifm(2),
      body: { result: "accepted" },
    });
    expect([bare.status, bare.body.code]).toEqual([403, "deliverable.not_owner"]);
    const res = await call<Body>(api.app, "POST", `/api/v1/deliverables/${d.id}/acceptance`, {
      session: dSession,
      headers: ifm(2),
      body: { result: "accepted", onBehalfOfUserId: p.sponsor.id, note: "Synthetic: on behalf of the Sponsor" },
    });
    expect([res.status, res.body.decidedBy]).toEqual([200, delegate.id]);
    const ev = (await auditOf(api.db, d.id)).at(-1)!;
    expect([ev.action, ev.actor_user_id, ev.on_behalf_of_user_id]).toEqual([
      "deliverable.decide",
      delegate.id,
      p.sponsor.id,
    ]);
    // The submitter cannot accept through a delegation from the owner either: the Sponsor submits, the delegate acts
    // for the Sponsor -> separation of duties (403).
    const d2 = (
      await call<Body>(api.app, "POST", `/api/v1/initiatives/${ini!.id}/deliverables`, {
        session: p.lead.session,
        body: { title: "Synthetic 2" },
      })
    ).body;
    await grant(
      api.db,
      w.grantor.id,
      p.sponsor.id,
      "WL",
      { type: "transformation", id: p.transformationId },
      w.orgA.id,
    );
    const sub = await call<Body>(api.app, "POST", `/api/v1/deliverables/${d2.id}/submit`, {
      session: p.sponsor.session,
      headers: ifm(1),
      body: {},
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const sod = await call<Body>(api.app, "POST", `/api/v1/deliverables/${d2.id}/acceptance`, {
      session: dSession,
      headers: ifm(2),
      body: { result: "accepted", onBehalfOfUserId: p.sponsor.id },
    });
    expect([sod.status, sod.body.code]).toEqual([403, "deliverable.acceptor_is_submitter"]);
  });

  it("commit-time authorisation on deliverable create, update, submit and acceptance", async () => {
    const p = await setupP2World(api, w);
    const [ini] = await insertInitiatives(api, p, [{ executiveOwnerUserId: p.sponsor.id }]);
    const a = await freshWl(p);
    const create = await whileBlocked(
      api,
      "select id from initiative where id = $1 for update",
      [ini!.id],
      () =>
        call<Body>(api.app, "POST", `/api/v1/initiatives/${ini!.id}/deliverables`, {
          session: a.session,
          body: { title: "Synthetic race" },
        }),
      () => revokeAll(a.id),
    );
    expect(create.status).toBe(403);
    expect(
      (await call<Body>(api.app, "GET", `/api/v1/initiatives/${ini!.id}/deliverables`, { session: p.lead.session }))
        .body.items,
    ).toEqual([]);
    const d = (
      await call<Body>(api.app, "POST", `/api/v1/initiatives/${ini!.id}/deliverables`, {
        session: p.lead.session,
        body: { title: "Synthetic" },
      })
    ).body;
    for (const [suffix, method, body, version] of [
      ["", "PATCH", { title: "Synthetic edit" }, 1],
      ["/submit", "POST", {}, 1],
    ] as const) {
      const u = await freshWl(p);
      const res = await whileBlocked(
        api,
        "select id from deliverable where id = $1 for update",
        [d.id],
        () =>
          call<Body>(api.app, method, `/api/v1/deliverables/${d.id}${suffix}`, {
            session: u.session,
            headers: ifm(version),
            body,
          }),
        () => revokeAll(u.id),
      );
      expect(res.status, suffix).toBe(403);
    }
    await call(api.app, "POST", `/api/v1/deliverables/${d.id}/submit`, {
      session: p.lead.session,
      headers: ifm(1),
      body: {},
    });
    // The Sponsor (executive owner) loses the transformation grant while the acceptance waits.
    const sp = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, sp.id, "SP", { type: "transformation", id: p.transformationId }, w.orgA.id);
    await api.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("initiative")
        .set({ executive_owner_user_id: sp.id, version: 2, updated_by: p.lead.id })
        .where("id", "=", ini!.id)
        .execute();
      await record(
        tx,
        { actorUserId: p.lead.id, requestId: `fixture-${uuidv7()}` },
        {
          action: "initiative.update",
          recordType: "initiative",
          recordId: ini!.id,
          organizationId: w.orgA.id,
          transformationId: p.transformationId,
          priorVersion: 1,
          newVersion: 2,
          changes: { executive_owner_user_id: { from: p.sponsor.id, to: sp.id } },
        },
      );
    });
    const spSession = await signIn(api.app, sp.subject);
    const acc = await whileBlocked(
      api,
      "select id from deliverable where id = $1 for update",
      [d.id],
      () =>
        call<Body>(api.app, "POST", `/api/v1/deliverables/${d.id}/acceptance`, {
          session: spSession,
          headers: ifm(2),
          body: { result: "accepted" },
        }),
      () => revokeAll(sp.id),
    );
    expect(acc.status).toBe(403);
    const row = await api.db
      .selectFrom("deliverable")
      .select(["version", "acceptance_status"])
      .where("id", "=", d.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ version: 2, acceptance_status: "submitted" });
  });
});

// ------------------------------------------------------------------------------------------------ milestones

describe("milestones: approved vs forecast (ADR-0023 §2-§3, REQ-S09-006)", () => {
  it("create (initiative.edit or roadmap.edit; no approved date), approve-date (roadmap.approve, reason), re-approval audited, variance computed", async () => {
    const p = await setupP2World(api, w);
    const [ini] = await insertInitiatives(api, p, [{}]);
    const M = `/api/v1/initiatives/${ini!.id}/milestones`;
    expect((await call(api.app, "POST", M, { session: p.auditor.session, body: { title: "x" } })).status).toBe(403);
    expect(
      (await call(api.app, "POST", M, { session: p.lead.session, body: { title: "x", approvedDate: "2026-01-01" } }))
        .status,
    ).toBe(400);
    const ms = await call<Body>(api.app, "POST", M, {
      session: p.contributor.session,
      body: { title: "Synthetic go-live", forecastDate: "2026-06-10" },
    });
    expect([ms.status, ms.body.version, ms.body.approvedDate, ms.body.varianceDays, ms.headers["etag"]]).toEqual([
      201,
      1,
      null,
      null,
      '"1"',
    ]);
    const AD = `/api/v1/milestones/${ms.body.id}/approve-date`;
    const body = { approvedDate: "2026-06-01", reason: "Synthetic baseline" };
    // WL holds roadmap.edit but not roadmap.approve; AUD nothing.
    expect((await call(api.app, "POST", AD, { session: p.contributor.session, headers: ifm(1), body })).status).toBe(
      403,
    );
    expect((await call(api.app, "POST", AD, { session: p.auditor.session, headers: ifm(1), body })).status).toBe(403);
    expect((await call(api.app, "POST", AD, { session: p.lead.session, body })).status).toBe(428);
    expect(
      (
        await call(api.app, "POST", AD, {
          session: p.lead.session,
          headers: ifm(1),
          body: { approvedDate: "2026-06-01" },
        })
      ).status,
    ).toBe(400);
    const approved = await call<Body>(api.app, "POST", AD, { session: p.lead.session, headers: ifm(1), body });
    expect([
      approved.status,
      approved.body.approvedDate,
      approved.body.approvedBy,
      approved.body.approvalReason,
      approved.body.varianceDays,
    ]).toEqual([200, "2026-06-01", p.lead.id, "Synthetic baseline", 9]);
    const re = await call<Body>(api.app, "POST", AD, {
      session: p.lead.session,
      headers: ifm(2),
      body: { approvedDate: "2026-06-20", reason: "Synthetic re-approval after scope change" },
    });
    expect([re.status, re.body.approvedDate, re.body.varianceDays]).toEqual([200, "2026-06-20", -10]);
    expect((await auditOf(api.db, ms.body.id)).map((e) => [e.action, e.reason])).toEqual([
      ["milestone.create", null],
      ["milestone.approve_date", "Synthetic baseline"],
      ["milestone.reapprove_date", "Synthetic re-approval after scope change"],
    ]);
    // Variance is computed, never stored.
    const cols = await api.db.introspection.getTables();
    expect(cols.find((t) => t.name === "milestone")!.columns.map((c) => c.name)).not.toContain("variance_days");
    // A PATCH cannot set the approved date.
    expect(
      (
        await call(api.app, "PATCH", `/api/v1/milestones/${ms.body.id}`, {
          session: p.lead.session,
          headers: ifm(3),
          body: { approvedDate: "2026-01-01" },
        })
      ).status,
    ).toBe(400);
  });

  it("moving the forecast: If-Match 428, stale 409 with currentVersion, AUD 403, achieved needs an actual date, audited", async () => {
    const p = await setupP2World(api, w);
    const [ini] = await insertInitiatives(api, p, [{}]);
    const ms = (
      await call<Body>(api.app, "POST", `/api/v1/initiatives/${ini!.id}/milestones`, {
        session: p.lead.session,
        body: { title: "Synthetic" },
      })
    ).body;
    const U = `/api/v1/milestones/${ms.id}`;
    expect(
      (
        await call(api.app, "PATCH", U, {
          session: p.auditor.session,
          headers: ifm(1),
          body: { forecastDate: "2026-07-01" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(api.app, "PATCH", U, { session: p.lead.session, body: { forecastDate: "2026-07-01" } })).status,
    ).toBe(428);
    const first = await call<Body>(api.app, "PATCH", U, {
      session: p.lead.session,
      headers: ifm(1),
      body: { forecastDate: "2026-07-01" },
    });
    expect([first.status, first.body.version, first.body.forecastDate]).toEqual([200, 2, "2026-07-01"]);
    // A second editor still holding version 1 (e.g. another tab's timeline) gets 409 with the current version.
    const stale = await call<Body>(api.app, "PATCH", U, {
      session: p.contributor.session,
      headers: ifm(1),
      body: { forecastDate: "2026-08-01" },
    });
    expect([stale.status, stale.body.type, stale.body.currentVersion]).toEqual([
      409,
      "urn:mth:problem:version-conflict",
      2,
    ]);
    const achieved = await call<Body>(api.app, "PATCH", U, {
      session: p.lead.session,
      headers: ifm(2),
      body: { status: "achieved" },
    });
    expect([achieved.status, achieved.body.code]).toEqual([422, "milestone.actual_date_status"]);
    const done = await call<Body>(api.app, "PATCH", U, {
      session: p.lead.session,
      headers: ifm(2),
      body: { status: "achieved", actualDate: "2026-06-28" },
    });
    expect([done.status, done.body.status, done.body.actualDate]).toEqual([200, "achieved", "2026-06-28"]);
    const audit = await auditOf(api.db, ms.id);
    expect(audit.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["milestone.create", null, 1],
      ["milestone.update", 1, 2],
      ["milestone.update", 2, 3],
    ]);
    expect(audit[1]!.changes).toEqual({ forecast_date: { from: null, to: "2026-07-01" } });
    expect(
      (await call(api.app, "GET", `/api/v1/initiatives/${ini!.id}/milestones`, { session: p.auditor.session })).status,
    ).toBe(200);
  });

  it("commit-time authorisation on milestone create, update and approve-date", async () => {
    const p = await setupP2World(api, w);
    const [ini] = await insertInitiatives(api, p, [{}]);
    const a = await freshWl(p);
    const create = await whileBlocked(
      api,
      "select id from initiative where id = $1 for update",
      [ini!.id],
      () =>
        call<Body>(api.app, "POST", `/api/v1/initiatives/${ini!.id}/milestones`, {
          session: a.session,
          body: { title: "Synthetic race" },
        }),
      () => revokeAll(a.id),
    );
    expect(create.status).toBe(403);
    const ms = (
      await call<Body>(api.app, "POST", `/api/v1/initiatives/${ini!.id}/milestones`, {
        session: p.lead.session,
        body: { title: "Synthetic" },
      })
    ).body;
    const b = await freshWl(p);
    const upd = await whileBlocked(
      api,
      "select id from milestone where id = $1 for update",
      [ms.id],
      () =>
        call<Body>(api.app, "PATCH", `/api/v1/milestones/${ms.id}`, {
          session: b.session,
          headers: ifm(1),
          body: { forecastDate: "2026-09-01" },
        }),
      () => revokeAll(b.id),
    );
    expect(upd.status).toBe(403);
    const tl = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, tl.id, "TL", { type: "transformation", id: p.transformationId }, w.orgA.id);
    const tlSession = await signIn(api.app, tl.subject);
    const appr = await whileBlocked(
      api,
      "select id from milestone where id = $1 for update",
      [ms.id],
      () =>
        call<Body>(api.app, "POST", `/api/v1/milestones/${ms.id}/approve-date`, {
          session: tlSession,
          headers: ifm(1),
          body: { approvedDate: "2026-09-01", reason: "Synthetic" },
        }),
      () => revokeAll(tl.id),
    );
    expect(appr.status).toBe(403);
    expect(await deniedFor(tl.id)).toBe(1);
    const row = await api.db
      .selectFrom("milestone")
      .select(["version", "approved_date"])
      .where("id", "=", ms.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ version: 1, approved_date: null });
  });
});

// ------------------------------------------------------------------------------------------------ the read model

describe("GET /transformations/{id}/roadmap: one read model (REQ-S09-006)", () => {
  it("waves, initiatives, milestones, deliverables and initiative dependencies with versions and flags; a moved milestone shows at once", async () => {
    const p = await setupP2World(api, w);
    const waves = (await call<Body>(api.app, "GET", `${T(p)}/waves`, { session: p.lead.session })).body.items;
    const [a, b] = await insertInitiatives(api, p, [
      { name: "Synthetic platform", plannedEnd: "2026-05-31", waveId: waves[1].id, executiveOwnerUserId: p.sponsor.id },
      { name: "Synthetic rollout", plannedStart: "2026-09-01", waveId: waves[2].id },
    ]);
    const ms = (
      await call<Body>(api.app, "POST", `/api/v1/initiatives/${a!.id}/milestones`, {
        session: p.lead.session,
        body: { title: "Synthetic go-live", forecastDate: "2026-05-15" },
      })
    ).body;
    await call(api.app, "POST", `/api/v1/initiatives/${a!.id}/deliverables`, {
      session: p.lead.session,
      body: { title: "Synthetic deliverable" },
    });
    const dep = (
      await call<Body>(api.app, "POST", "/api/v1/dependencies", {
        session: p.lead.session,
        body: {
          transformationId: p.transformationId,
          description: "Synthetic: rollout needs the platform",
          from: { kind: "initiative", initiativeId: a!.id },
          toInitiativeId: b!.id,
          dependencyType: "tech",
          neededBy: "2026-06-01",
        },
      })
    ).body;
    await call(api.app, "POST", "/api/v1/dependencies", {
      session: p.lead.session,
      body: {
        transformationId: p.transformationId,
        description: "Synthetic: vendor contract",
        from: { kind: "external", label: "Synthetic vendor" },
        toInitiativeId: a!.id,
        dependencyType: "vendor",
      },
    });
    const R = `${T(p)}/roadmap`;
    const view = await call<Body>(api.app, "GET", R, { session: p.auditor.session });
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body.transformationId).toBe(p.transformationId);
    expect(view.body.waves.map((x: Body) => x.nameEn)).toEqual([
      "Wave 0 — Mobilize",
      "Wave 1 — Prove",
      "Wave 2 — Scale",
      "Wave 3 — Embed",
    ]);
    expect(
      view.body.initiatives.map((i: Body) => [i.code, i.waveId, i.version, i.fundingState, i.displayStatus]),
    ).toEqual([
      ["INI-01", waves[1].id, 1, "not_applicable", "initiative.status.draft"],
      ["INI-02", waves[2].id, 1, "not_applicable", "initiative.status.draft"],
    ]);
    expect(view.body.initiatives[0].warnings.map((x: Body) => x.code)).toEqual([
      "initiative.deliverable_count",
      "initiative.no_gap_link",
    ]);
    expect(view.body.initiatives[1].warnings.map((x: Body) => x.code)).toEqual([
      "initiative.deliverable_count",
      "initiative.no_gap_link",
      "initiative.no_owner",
    ]);
    expect(view.body.milestones.map((m: Body) => [m.id, m.version, m.forecastDate])).toEqual([
      [ms.id, 1, "2026-05-15"],
    ]);
    expect(view.body.deliverables).toHaveLength(1);
    // Only initiative-to-initiative dependencies; the external one shows as a flag on INI-01 (Unknown).
    expect(view.body.dependencies.map((d: Body) => [d.id, d.version, d.flags])).toEqual([[dep.id, 1, []]]);
    expect(view.body.initiatives[0].flags.map((f: Body) => f.code)).toEqual(["schedule.unknown"]);
    expect(view.body.initiatives[1].flags).toEqual([]);

    // Move the milestone past the needed-by date: the same read model now shows the conflict on the dependency and
    // on the successor - one source for the timeline, the table and the board.
    const moved = await call<Body>(api.app, "PATCH", `/api/v1/milestones/${ms.id}`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { forecastDate: "2026-06-20" },
    });
    expect(moved.status).toBe(200);
    const after = await call<Body>(api.app, "GET", R, { session: p.lead.session });
    expect(after.body.milestones.map((m: Body) => [m.version, m.forecastDate])).toEqual([[2, "2026-06-20"]]);
    const conflict = {
      code: "schedule.needed_by_conflict",
      message: "INI-01 finishes after INI-02 needs it (2026-06-01)",
      dependencyId: dep.id,
      initiativeId: b!.id,
    };
    expect(after.body.dependencies[0].flags).toEqual([conflict]);
    expect(after.body.initiatives[1].flags).toEqual([conflict]);
    // Sequenced before its predecessor: INI-02 moved to Wave 0 while INI-01 stays in Wave 1.
    await api.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("initiative")
        .set({ wave_id: waves[0].id, version: 2, updated_by: p.lead.id })
        .where("id", "=", b!.id)
        .execute();
      await record(
        tx,
        { actorUserId: p.lead.id, requestId: `fixture-${uuidv7()}` },
        {
          action: "initiative.update",
          recordType: "initiative",
          recordId: b!.id,
          organizationId: w.orgA.id,
          transformationId: p.transformationId,
          priorVersion: 1,
          newVersion: 2,
          changes: { wave_id: { from: waves[2].id, to: waves[0].id } },
        },
      );
    });
    const seq = await call<Body>(api.app, "GET", R, { session: p.lead.session });
    expect(seq.body.dependencies[0].flags.map((f: Body) => f.code)).toEqual([
      "schedule.needed_by_conflict",
      "schedule.before_predecessor",
    ]);
    // No access: 404 (existence not disclosed).
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await call(api.app, "GET", R, { session: nobody })).status).toBe(404);
  });
});
