// Corrective-action cases through the API (T-DG4-BE-D2; ADR-0031 §5.1, §5.5, §5.6, §9-§11; REQ-PB-085, REQ-S12-016).
// Proves, against the run's disposable PostgreSQL:
//  - BO, TL and FIN may create a Value Review case (owner and follow-up date required); AUD 403; ADM-only and outsiders
//    404; a second open case for the same finding (trimmed, case-insensitive) is 409 corrective_case.already_open with
//    the open case's code; a follow-up date before today is 422 corrective_case.follow_up_past;
//  - the owner gets one corrective_case_follow_up work item; an owner change cancels it and creates the new owner's;
//    closing the case closes it;
//  - a worker case without an owner (ownerStatus unassigned, followUpUnknownReason when no date) cannot be closed:
//    422 corrective_case.owner_required; after an owner is assigned it closes; a closed case is final (422
//    corrective_case.closed) and a new open case for the same finding is then allowed;
//  - status Open <-> In progress only (422 corrective_case.status_transition for "closed" in a PATCH);
//  - If-Match 428/409; one audit event per change; commit-time authorisation (403 after revocation, nothing written);
//  - the signals and actions of a case: createCorrectiveCaseAction through BE-D's createLinkedAction (correctiveCaseId,
//    sourceKind corrective_case), refused on a closed case; the benefit's lifecycle step is shown, never changed.
// All data is SYNTHETIC; closing a case is never a business approval, and nothing touches DG0-DG7.
import { insertAuditEvent } from "@mth/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, financialBody, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let C: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  C = `${b.base}/corrective-actions`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const FUTURE = "2030-01-15";
const body = (extra: Record<string, unknown> = {}) => ({
  findingRef: `VR-2026-Q3 item ${randomUUID().slice(0, 8)}`,
  title: "Synthetic: churn benefit behind plan",
  recoveryPlan: "Synthetic: retention campaign for the at-risk segment",
  ownerUserId: b.users.bo.id,
  followUpDate: FUTURE,
  ...extra,
});
const create = async (extra: Record<string, unknown> = {}, session = b.s.tl) => {
  const r = await call(api.app, "POST", C, { session, body: body(extra) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; code: string; version: number; ownerUserId: string; sourceScopeKey: string };
};
const tasksOf = (caseId: string) =>
  api.db
    .selectFrom("work_item")
    .select(["kind", "assignee_user_id", "status", "due_date", "dedupe_key", "message_key"])
    .where("subject_type", "=", "corrective_case")
    .where("subject_id", "=", caseId)
    .orderBy("created_at")
    .execute();
const caseCount = async () =>
  (
    await api.db
      .selectFrom("corrective_case")
      .select("id")
      .where("transformation_id", "=", b.transformationId)
      .execute()
  ).length;

/** A worker-created case (the consumer's rows: created_source worker, no author, service audit actor). */
async function insertWorkerCase(opts: { owner: string | null; followUp: string | null; benefitId?: string }) {
  const id = randomUUID();
  const checkId = randomUUID();
  const code = `CA-9${String(Math.floor(Math.random() * 90000) + 10000)}`;
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("corrective_case")
      .values({
        id,
        organization_id: b.organizationId,
        transformation_id: b.transformationId,
        code,
        source_kind: opts.benefitId ? "benefit_variance" : "control_check",
        source_scope_key: opts.benefitId ?? checkId,
        benefit_id: opts.benefitId ?? null,
        source_record_type: opts.benefitId ? null : "control_check",
        source_record_id: opts.benefitId ? null : checkId,
        title: "Synthetic control",
        owner_user_id: opts.owner,
        follow_up_date: opts.followUp,
        consecutive_off_track: 1,
        signal_count: 1,
        created_source: "worker",
        created_by: null,
        updated_by: null,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "service", actorUserId: null, onBehalfOfUserId: null, requestId: "job:test", source: "worker" },
      {
        action: "corrective_case.created",
        recordType: "corrective_case",
        recordId: id,
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

describe("createCorrectiveCase: a Value Review finding (ADR-0031 §5.5; REQ-PB-085 create:BO,TL,FIN)", () => {
  it("BO, TL and FIN create a case with owner and follow-up date; one audit event; the owner's work item", async () => {
    for (const session of [b.s.bo, b.s.tl, b.s.fin]) {
      const r = await call(api.app, "POST", C, { session, body: body() });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.headers.etag).toBe('"1"');
      expect(r.headers.location).toBe(`${C}/${r.body.id}`);
      expect(r.body).toMatchObject({
        sourceKind: "value_review",
        status: "open",
        ownerUserId: b.users.bo.id,
        ownerStatus: "assigned",
        followUpDate: FUTURE,
        followUpUnknownReason: null,
        createdSource: "api",
        signalCount: 0,
        consecutiveOffTrack: null,
        version: 1,
      });
      expect(r.body.code).toMatch(/^CA-[0-9]{2,6}$/);
      expect(r.body.sourceScopeKey).toMatch(/^value_review:vr-2026-q3 item /);
      expect((await auditOf(api.db, r.body.id)).map((a) => [a.action, a.new_version])).toEqual([
        ["corrective_case.created", 1],
      ]);
      expect(await tasksOf(r.body.id)).toEqual([
        {
          kind: "corrective_case_follow_up",
          assignee_user_id: b.users.bo.id,
          status: "open",
          due_date: FUTURE,
          dedupe_key: `corrective.follow_up:${r.body.id}:${b.users.bo.id}`,
          message_key: "raid.task.corrective_follow_up",
        },
      ]);
    }
  });

  it("a second open case for the same finding is 409 corrective_case.already_open (trimmed, case-insensitive)", async () => {
    const first = await create({ findingRef: "VR-2026-Q3 Duplicate finding" });
    const before = await caseCount();
    const dup = await call(api.app, "POST", C, {
      session: b.s.fin,
      body: body({ findingRef: "  vr-2026-q3 duplicate FINDING " }),
    });
    expect([dup.status, dup.body.type, dup.body.code, dup.body.detail]).toEqual([
      409,
      "urn:mth:problem:duplicate",
      "corrective_case.already_open",
      `An open corrective action already exists for this finding: ${first.code}.`,
    ]);
    expect(await caseCount()).toBe(before);
  });

  it("AUD 403; ADM-only and outsiders 404 on every operation; nothing written", async () => {
    const c = await create();
    const before = await caseCount();
    expect((await call(api.app, "POST", C, { session: b.s.auditor, body: body() })).status).toBe(403);
    expect(
      (await call(api.app, "PATCH", `${C}/${c.id}`, { session: b.s.auditor, headers: ifm(1), body: { title: "x" } }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(api.app, "POST", `${C}/${c.id}/close`, {
          session: b.s.auditor,
          headers: ifm(1),
          body: { closureNote: "Synthetic" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(api.app, "POST", `${C}/${c.id}/actions`, {
          session: b.s.auditor,
          body: { title: "Synthetic", ownerUserId: b.users.auditor.id },
        })
      ).status,
    ).toBe(403);
    // AUD reads everything in its scope.
    for (const path of [C, `${C}/${c.id}`, `${C}/${c.id}/signals`, `${C}/${c.id}/actions`])
      expect((await call(api.app, "GET", path, { session: b.s.auditor })).status).toBe(200);
    for (const session of [b.s.admin, b.s.outsider]) {
      for (const path of [C, `${C}/${c.id}`, `${C}/${c.id}/signals`, `${C}/${c.id}/actions`])
        expect((await call(api.app, "GET", path, { session })).status).toBe(404);
      expect((await call(api.app, "POST", C, { session, body: body() })).status).toBe(404);
      expect(
        (await call(api.app, "PATCH", `${C}/${c.id}`, { session, headers: ifm(1), body: { title: "x" } })).status,
      ).toBe(404);
      expect(
        (
          await call(api.app, "POST", `${C}/${c.id}/close`, {
            session,
            headers: ifm(1),
            body: { closureNote: "Synthetic" },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call(api.app, "POST", `${C}/${c.id}/actions`, {
            session,
            body: { title: "Synthetic", ownerUserId: b.users.tl.id },
          })
        ).status,
      ).toBe(404);
    }
    expect(await caseCount()).toBe(before);
    expect((await call(api.app, "GET", `${C}/${randomUUID()}`, { session: b.s.tl })).status).toBe(404);
  });

  it("validation: a past follow-up date is 422 corrective_case.follow_up_past; missing owner or date is 400", async () => {
    const past = await call(api.app, "POST", C, { session: b.s.tl, body: body({ followUpDate: "2020-01-01" }) });
    expect([past.status, past.body.code, past.body.detail, past.body.errors[0].pointer]).toEqual([
      422,
      "corrective_case.follow_up_past",
      "The follow-up date cannot be before today.",
      "/followUpDate",
    ]);
    const { ownerUserId: _o, ...noOwner } = body();
    expect((await call(api.app, "POST", C, { session: b.s.tl, body: noOwner })).status).toBe(400);
    const { followUpDate: _f, ...noDate } = body();
    expect((await call(api.app, "POST", C, { session: b.s.tl, body: noDate })).status).toBe(400);
    expect((await call(api.app, "POST", C, { session: b.s.tl, body: body({ title: "   " }) })).status).toBe(400);
    const stranger = await call(api.app, "POST", C, { session: b.s.tl, body: body({ ownerUserId: randomUUID() }) });
    expect([stranger.status, stranger.body.code]).toEqual([422, "validation.user_invalid"]);
  });
});

describe("updateCorrectiveCase and closeCorrectiveCase (ADR-0031 §5.5, §5.6)", () => {
  it("an owner change cancels the previous owner's item and creates the new owner's; Open <-> In progress", async () => {
    const c = await create();
    const r = await call(api.app, "PATCH", `${C}/${c.id}`, {
      session: b.s.fin,
      headers: ifm(1),
      body: { ownerUserId: b.users.bo2.id, status: "in_progress", recoveryPlan: "Synthetic: revised plan" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect([r.body.ownerUserId, r.body.status, r.body.version, r.headers.etag, r.body.updatedBy]).toEqual([
      b.users.bo2.id,
      "in_progress",
      2,
      '"2"',
      b.users.fin.id,
    ]);
    expect((await tasksOf(c.id)).map((t) => [t.assignee_user_id, t.status])).toEqual([
      [b.users.bo.id, "cancelled"],
      [b.users.bo2.id, "open"],
    ]);
    const back = await call(api.app, "PATCH", `${C}/${c.id}`, {
      session: b.s.tl,
      headers: ifm(2),
      body: { status: "open" },
    });
    expect([back.status, back.body.status]).toEqual([200, "open"]);
    const closing = await call(api.app, "PATCH", `${C}/${c.id}`, {
      session: b.s.tl,
      headers: ifm(3),
      body: { status: "closed" },
    });
    expect([closing.status, closing.body.code, closing.body.detail]).toEqual([
      422,
      "corrective_case.status_transition",
      "A corrective action moves between Open and In progress; use Close to close it.",
    ]);
    expect((await auditOf(api.db, c.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["corrective_case.created", 1],
      ["corrective_case.updated", 2],
      ["corrective_case.updated", 3],
    ]);
  });

  it("If-Match: 428 when missing, 409 when stale; a past follow-up date is 422; nothing written", async () => {
    const c = await create();
    const missing = await call(api.app, "PATCH", `${C}/${c.id}`, { session: b.s.tl, body: { title: "Synthetic B" } });
    expect(missing.status).toBe(428);
    const stale = await call(api.app, "PATCH", `${C}/${c.id}`, {
      session: b.s.tl,
      headers: ifm(7),
      body: { title: "Synthetic B" },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const past = await call(api.app, "PATCH", `${C}/${c.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { followUpDate: "2020-02-02" },
    });
    expect([past.status, past.body.code]).toEqual([422, "corrective_case.follow_up_past"]);
    expect(
      (await call(api.app, "POST", `${C}/${c.id}/close`, { session: b.s.tl, body: { closureNote: "x y" } })).status,
    ).toBe(428);
    const read = await call(api.app, "GET", `${C}/${c.id}`, { session: b.s.auditor });
    expect([read.body.version, read.body.title, read.headers.etag]).toEqual([
      1,
      "Synthetic: churn benefit behind plan",
      '"1"',
    ]);
  });

  it("closing: owner required for a worker case without owner; closed is final; the item closes; a new case may open", async () => {
    const id = await insertWorkerCase({ owner: null, followUp: null });
    const read = await call(api.app, "GET", `${C}/${id}`, { session: b.s.auditor });
    expect(read.body).toMatchObject({
      ownerUserId: null,
      ownerStatus: "unassigned",
      followUpDate: null,
      followUpUnknownReason: "calendar_not_configured",
      createdSource: "worker",
      createdBy: null,
    });
    const refused = await call(api.app, "POST", `${C}/${id}/close`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { closureNote: "Synthetic: fixed" },
    });
    expect([refused.status, refused.body.code, refused.body.detail]).toEqual([
      422,
      "corrective_case.owner_required",
      "Assign an owner before closing this corrective action.",
    ]);
    const assigned = await call(api.app, "PATCH", `${C}/${id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { ownerUserId: b.users.fin.id, followUpDate: FUTURE },
    });
    expect([assigned.status, assigned.body.ownerStatus, assigned.body.followUpUnknownReason]).toEqual([
      200,
      "assigned",
      null,
    ]);
    expect((await tasksOf(id)).map((t) => [t.assignee_user_id, t.status, t.due_date])).toEqual([
      [b.users.fin.id, "open", FUTURE],
    ]);
    const closed = await call(api.app, "POST", `${C}/${id}/close`, {
      session: b.s.bo,
      headers: ifm(2),
      body: { closureNote: "Synthetic: control re-performed and passed" },
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect([closed.body.status, closed.body.closedBy, closed.body.closureNote, closed.body.version]).toEqual([
      "closed",
      b.users.bo.id,
      "Synthetic: control re-performed and passed",
      3,
    ]);
    expect(closed.body.closedAt).not.toBeNull();
    expect((await tasksOf(id)).map((t) => t.status)).toEqual(["done"]);
    for (const [method, path, payload] of [
      ["PATCH", `${C}/${id}`, { title: "Synthetic again" }],
      ["POST", `${C}/${id}/close`, { closureNote: "Twice" }],
    ] as const) {
      const r = await call(api.app, method, path, { session: b.s.tl, headers: ifm(3), body: payload });
      expect([r.status, r.body.code, r.body.detail]).toEqual([
        422,
        "corrective_case.closed",
        "This corrective action is closed and can no longer be changed.",
      ]);
    }
    expect((await auditOf(api.db, id)).map((a) => a.action)).toEqual([
      "corrective_case.created",
      "corrective_case.updated",
      "corrective_case.closed",
    ]);

    // After closure, a new case for the same Value Review finding is allowed (never reopened).
    const vr = await create({ findingRef: "VR closed then new" });
    await call(api.app, "POST", `${C}/${vr.id}/close`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { closureNote: "Synthetic: done" },
    });
    const again = await create({ findingRef: "VR closed then new" });
    expect(again.id).not.toBe(vr.id);
  });

  it("commit-time: corrective_action.manage revoked while the request waited is 403; nothing written", async () => {
    const u = await extraUser(api, w, b, "BO");
    const before = await caseCount();
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", C, { session: u.session, body: body(), contract: false }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await caseCount()).toBe(before);

    const c = await create();
    const u2 = await extraUser(api, w, b, "FIN");
    const upd = await afterIdentity(
      api,
      u2.id,
      () =>
        call(api.app, "PATCH", `${C}/${c.id}`, {
          session: u2.session,
          headers: ifm(1),
          body: { title: "Synthetic revoked" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u2.id),
    );
    expect(upd.status).toBe(403);
    const row = await api.db
      .selectFrom("corrective_case")
      .select(["title", "version"])
      .where("id", "=", c.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ title: "Synthetic: churn benefit behind plan", version: 1 });
  });
});

describe("lists, signals and case actions", () => {
  it("filters by source kind, status and owner; cursor pagination visits every row once", async () => {
    const owner = await extraUser(api, w, b, "BO");
    const a = await create({ ownerUserId: owner.id });
    const c2 = await create({ ownerUserId: owner.id });
    await call(api.app, "PATCH", `${C}/${c2.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { status: "in_progress" },
    });
    const worker = await insertWorkerCase({ owner: owner.id, followUp: FUTURE });
    const mine = await call(api.app, "GET", `${C}?ownerUserId=${owner.id}`, { session: b.s.auditor });
    expect(mine.body.items.map((x: { id: string }) => x.id)).toEqual([a.id, c2.id, worker]);
    const control = await call(api.app, "GET", `${C}?ownerUserId=${owner.id}&sourceKind=control_check`, {
      session: b.s.auditor,
    });
    expect(control.body.items.map((x: { id: string }) => x.id)).toEqual([worker]);
    const prog = await call(api.app, "GET", `${C}?ownerUserId=${owner.id}&status=in_progress`, {
      session: b.s.auditor,
    });
    expect(prog.body.items.map((x: { id: string }) => x.id)).toEqual([c2.id]);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = `${C}?ownerUserId=${owner.id}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = await call(api.app, "GET", q, { session: b.s.auditor });
      seen.push(...page.body.items.map((x: { id: string }) => x.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual([a.id, c2.id, worker]);
    expect((await call(api.app, "GET", `${C}?sourceKind=opportunity`, { session: b.s.auditor })).status).toBe(400);
  });

  it("signals: the case's lineage, newest first (empty for a person's case)", async () => {
    const c = await create();
    const s = await call(api.app, "GET", `${C}/${c.id}/signals`, { session: b.s.auditor });
    expect([s.status, s.body.items, s.body.nextCursor]).toEqual([200, [], null]);
    const id = await insertWorkerCase({ owner: b.users.tl.id, followUp: FUTURE });
    const caseRow = await api.db
      .selectFrom("corrective_case")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    for (const n of [1, 2])
      await api.db
        .insertInto("corrective_signal")
        .values({
          id: randomUUID(),
          organization_id: b.organizationId,
          transformation_id: b.transformationId,
          source_kind: "control_check",
          source_scope_key: caseRow.source_scope_key,
          source_event_key: `control_check.failed:${caseRow.source_scope_key}:${n}`,
          period_key: caseRow.source_scope_key,
          off_track: true,
          rule_persistence: 1,
          consecutive_off_track: 1,
          outcome: n === 1 ? "case_created" : "case_updated",
          corrective_case_id: id,
          payload: JSON.stringify({ n }),
        })
        .execute();
    const listed = await call(api.app, "GET", `${C}/${id}/signals`, { session: b.s.auditor });
    expect(listed.body.items.map((x: { outcome: string }) => x.outcome)).toEqual(["case_updated", "case_created"]);
    expect(listed.body.items[0]).toMatchObject({ sourceKind: "control_check", offTrack: true, correctiveCaseId: id });
    const first = await call(api.app, "GET", `${C}/${id}/signals?limit=1`, { session: b.s.auditor });
    const second = await call(
      api.app,
      "GET",
      `${C}/${id}/signals?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      {
        session: b.s.auditor,
      },
    );
    expect([...first.body.items, ...second.body.items].map((x: { outcome: string }) => x.outcome)).toEqual([
      "case_updated",
      "case_created",
    ]);
    expect(second.body.nextCursor).toBeNull();
  });

  it("createCorrectiveCaseAction: an owned action linked to the case (action.edit); refused once the case is closed", async () => {
    const c = await create();
    const r = await call(api.app, "POST", `${C}/${c.id}/actions`, {
      session: b.s.tl,
      body: { title: "Synthetic: call the top 50 accounts", ownerUserId: b.users.bo.id, dueDate: "2030-01-10" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.headers.location).toBe(`${b.base}/action-register/${r.body.id}`);
    expect(r.body).toMatchObject({
      sourceKind: "corrective_case",
      correctiveCaseId: c.id,
      raidEntryId: null,
      ownerUserId: b.users.bo.id,
      createdBy: b.users.tl.id,
      version: 1,
    });
    const listed = await call(api.app, "GET", `${C}/${c.id}/actions`, { session: b.s.auditor });
    expect(listed.body.items.map((x: { id: string }) => x.id)).toEqual([r.body.id]);
    // BO holds action.update_own only (no action.edit): an action for itself, never for someone else (ADR-0031 §9).
    const own = await call(api.app, "POST", `${C}/${c.id}/actions`, {
      session: b.s.bo,
      body: { title: "Synthetic: my own follow-up", ownerUserId: b.users.bo.id },
    });
    expect([own.status, own.body.correctiveCaseId]).toEqual([201, c.id]);
    const other = await call(api.app, "POST", `${C}/${c.id}/actions`, {
      session: b.s.bo,
      body: { title: "Synthetic", ownerUserId: b.users.fin.id },
    });
    expect(other.status).toBe(403);
    await call(api.app, "POST", `${C}/${c.id}/close`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { closureNote: "Synthetic: recovered" },
    });
    const late = await call(api.app, "POST", `${C}/${c.id}/actions`, {
      session: b.s.tl,
      body: { title: "Synthetic late", ownerUserId: b.users.bo.id },
    });
    expect([late.status, late.body.code]).toEqual([422, "corrective_case.closed"]);
    expect((await call(api.app, "GET", `${C}/${randomUUID()}/actions`, { session: b.s.tl })).status).toBe(404);
  });

  it("a benefit case shows the benefit's lifecycle step and never changes it", async () => {
    const benefit = await call(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b) });
    expect(benefit.status, JSON.stringify(benefit.body)).toBe(201);
    const id = await insertWorkerCase({ owner: b.users.bo.id, followUp: FUTURE, benefitId: benefit.body.id });
    const read = await call(api.app, "GET", `${C}/${id}`, { session: b.s.auditor });
    expect([read.body.benefitId, read.body.benefitLifecycleStep]).toEqual([benefit.body.id, "identify"]);
    await call(api.app, "POST", `${C}/${id}/close`, {
      session: b.s.bo,
      headers: ifm(1),
      body: { closureNote: "Synthetic: back on plan" },
    });
    const after = await api.db
      .selectFrom("benefit")
      .select("lifecycle_step")
      .where("id", "=", benefit.body.id)
      .executeTakeFirstOrThrow();
    expect(after.lifecycle_step).toBe("identify");
  });
});
