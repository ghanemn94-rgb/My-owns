// Training attendance records (T-DG4-BE-H2; ADR-0033 §6, §9, §10; REQ-PB-072 "Proficiency is recorded by observation
// separately from completion; completion alone does not count as adoption"; REQ-S16-020 Training/AssessmentRecord, the
// training half). Proves, against the run's disposable PostgreSQL:
//  - enrolment with a user or a label (exactly one), an optional TRAINING intervention (422
//    training_record.intervention_not_training otherwise, exact text);
//  - a completed record needs its completion date (400 validation.required at /completedOn; nothing written);
//    completed, no_show and withdrawn are final (422 training_record.final, exact text);
//  - 100% completion writes no proficiency observation: the group's observation rows stay empty (the
//    observed-proficiency measure is then Unknown, KBE-F's computation; ADR-0033 §6);
//  - If-Match 428/409; one audit event per change; AUD and TL (no proficiency.record) 403; ADM-only and outsiders 404;
//    an archived group 422; commit-time authorisation.
// All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

type Extra = Awaited<ReturnType<typeof extraUser>>;
let api: TestApi;
let w: World;
let b: BenefitWorld;
let other: BenefitWorld;
let wl: Extra;
let groupId: string;
let trainingIv: string;
let commsIv: string;
let TR: string;

const group = async (name: string) => {
  const g = await call(api.app, "POST", `${b.base}/stakeholder-groups`, {
    session: b.s.tl,
    body: {
      name,
      impact: "M",
      currentStance: "neutral",
      requiredBehavior: "Synthetic: approve orders in the new workflow",
      interventionTypes: ["training"],
      ownerUserId: b.users.bo.id,
    },
  });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  return g.body.id as string;
};
const intervention = async (interventionType: string) => {
  const r = await call(api.app, "POST", `${b.base}/adoption-interventions`, {
    session: b.s.tl,
    body: {
      stakeholderGroupId: groupId,
      interventionType,
      title: `Synthetic ${interventionType}`,
      ownerUserId: wl.id,
      dueDate: "2026-12-01",
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
};
const enrol = async (extra: Record<string, unknown> = {}, session = b.s.bo) => {
  const r = await call(api.app, "POST", TR, {
    session,
    body: {
      stakeholderGroupId: groupId,
      participantUserId: b.users.fin.id,
      trainingTitle: "Synthetic workflow basics",
      ...extra,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number };
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  other = await seedBenefitWorld(api, w);
  wl = await extraUser(api, w, b, "WL");
  TR = `${b.base}/training-records`;
  groupId = await group("Synthetic procurement approvers");
  trainingIv = await intervention("training");
  commsIv = await intervention("comms");
}, 90_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("training records (ADR-0033 §6)", () => {
  it("enrols a user or a label, optionally linked to a training intervention; one audit event", async () => {
    const r = await call(api.app, "POST", TR, {
      session: wl.session,
      body: {
        stakeholderGroupId: groupId,
        interventionId: trainingIv,
        participantUserId: b.users.fin.id,
        trainingTitle: "Synthetic: approvals in the new workflow",
        scheduledOn: "2026-10-20",
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([r.headers.location, r.headers.etag]).toEqual([`${TR}/${r.body.id}`, '"1"']);
    expect(r.body).toMatchObject({
      stakeholderGroupId: groupId,
      interventionId: trainingIv,
      participantUserId: b.users.fin.id,
      participantLabel: null,
      scheduledOn: "2026-10-20",
      status: "enrolled",
      completedOn: null,
      recordedBy: null,
      createdBy: wl.id,
      version: 1,
    });
    expect((await auditOf(api.db, r.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["training_record.create", 1],
    ]);
    const label = await enrol({ participantUserId: undefined, participantLabel: "Synthetic contractor 7" });
    expect(label.id).toBeTruthy();
    const list = await call(api.app, "GET", `${TR}?stakeholderGroupId=${groupId}&status=enrolled`, {
      session: b.s.auditor,
    });
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([r.body.id, label.id]));
  });

  it("refuses a non-training intervention, a missing or double participant, an unknown intervention", async () => {
    const comms = await call(api.app, "POST", TR, {
      session: b.s.bo,
      body: { stakeholderGroupId: groupId, interventionId: commsIv, participantLabel: "Synthetic", trainingTitle: "T" },
    });
    expect([comms.status, comms.body.code, comms.body.detail, comms.body.errors[0].pointer]).toEqual([
      422,
      "training_record.intervention_not_training",
      "Only a training intervention can be linked to a training record.",
      "/interventionId",
    ]);
    const none = await call(api.app, "POST", TR, {
      session: b.s.bo,
      body: { stakeholderGroupId: groupId, trainingTitle: "T" },
    });
    expect([none.status, none.body.errors[0].pointer, none.body.errors[0].code]).toEqual([
      400,
      "/participantUserId",
      "validation.required",
    ]);
    const both = await call(api.app, "POST", TR, {
      session: b.s.bo,
      body: {
        stakeholderGroupId: groupId,
        participantUserId: b.users.fin.id,
        participantLabel: "x",
        trainingTitle: "T",
      },
    });
    expect([both.status, both.body.errors[0].pointer]).toEqual([400, "/participantLabel"]);
    const ghost = await call(api.app, "POST", TR, {
      session: b.s.bo,
      body: {
        stakeholderGroupId: groupId,
        interventionId: other.transformationId,
        participantLabel: "x",
        trainingTitle: "T",
      },
    });
    expect([ghost.status, ghost.body.errors[0].pointer]).toEqual([422, "/interventionId"]);
  });

  it("a completed training record needs its completion date; completed is final; If-Match 428/409", async () => {
    const t = await enrol();
    const R = `${TR}/${t.id}`;
    const noDate = await call(api.app, "PATCH", R, { session: b.s.bo, headers: ifm(1), body: { status: "completed" } });
    expect([noDate.status, noDate.body.errors]).toEqual([
      400,
      [{ pointer: "/completedOn", code: "validation.required", message: "validation.required" }],
    ]);
    const row = await api.db
      .selectFrom("training_record")
      .select(["status", "version"])
      .where("id", "=", t.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "enrolled", version: 1 });
    expect((await call(api.app, "PATCH", R, { session: b.s.bo, body: { status: "no_show" } })).status).toBe(428);
    expect(
      (await call(api.app, "PATCH", R, { session: b.s.bo, headers: ifm(2), body: { status: "no_show" } })).status,
    ).toBe(409);
    const done = await call(api.app, "PATCH", R, {
      session: b.s.bo,
      headers: ifm(1),
      body: { status: "completed", completedOn: "2026-10-21" },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({
      status: "completed",
      completedOn: "2026-10-21",
      recordedBy: b.users.bo.id,
      version: 2,
    });
    const again = await call(api.app, "PATCH", R, { session: b.s.bo, headers: ifm(2), body: { status: "withdrawn" } });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "training_record.final",
      "This training record is completed and can no longer be changed.",
    ]);
    const ns = await enrol();
    const dated = await call(api.app, "PATCH", `${TR}/${ns.id}`, {
      session: b.s.bo,
      headers: ifm(1),
      body: { status: "no_show", completedOn: "2026-10-21" },
    });
    expect([dated.status, dated.body.errors[0].pointer]).toEqual([400, "/completedOn"]);
    const noShow = await call(api.app, "PATCH", `${TR}/${ns.id}`, {
      session: b.s.bo,
      headers: ifm(1),
      body: { status: "no_show" },
    });
    expect([noShow.status, noShow.body.status, noShow.body.completedOn]).toEqual([200, "no_show", null]);
    expect((await auditOf(api.db, t.id)).map((a) => a.action)).toEqual([
      "training_record.create",
      "training_record.update",
    ]);
  });

  it("REQ-PB-072: 100% training completion records no proficiency observation (completion is not adoption)", async () => {
    const g = await group("Synthetic warehouse pickers");
    for (const label of ["Synthetic picker A", "Synthetic picker B"]) {
      const t = await enrol({ stakeholderGroupId: g, participantUserId: undefined, participantLabel: label });
      const c = await call(api.app, "PATCH", `${TR}/${t.id}`, {
        session: b.s.bo,
        headers: ifm(1),
        body: { status: "completed", completedOn: "2026-10-22" },
      });
      expect(c.status).toBe(200);
    }
    const completed = await call(api.app, "GET", `${TR}?stakeholderGroupId=${g}`, { session: b.s.auditor });
    expect(completed.body.items.map((x: { status: string }) => x.status)).toEqual(["completed", "completed"]);
    const observations = await call(
      api.app,
      "GET",
      `${b.base}/assessment-records?stakeholderGroupId=${g}&kind=proficiency_observation`,
      { session: b.s.auditor },
    );
    expect([observations.status, observations.body.items]).toEqual([200, []]);
  });
});

describe("authorisation (ADR-0033 §9)", () => {
  it("AUD and TL 403; ADM-only and outsiders 404; archived group 422; commit-time 403", async () => {
    const t = await enrol();
    const body = { stakeholderGroupId: groupId, participantLabel: "Synthetic", trainingTitle: "T" };
    for (const session of [b.s.auditor, b.s.tl]) {
      expect((await call(api.app, "POST", TR, { session, body })).status).toBe(403);
      expect(
        (await call(api.app, "PATCH", `${TR}/${t.id}`, { session, headers: ifm(1), body: { status: "no_show" } }))
          .status,
      ).toBe(403);
    }
    expect((await call(api.app, "GET", TR, { session: b.s.auditor })).status).toBe(200);
    for (const session of [b.s.admin, b.s.outsider]) {
      expect((await call(api.app, "GET", TR, { session })).status).toBe(404);
      expect((await call(api.app, "POST", TR, { session, body })).status).toBe(404);
      expect(
        (await call(api.app, "PATCH", `${TR}/${t.id}`, { session, headers: ifm(1), body: { status: "no_show" } }))
          .status,
      ).toBe(404);
    }
    expect(
      (
        await call(api.app, "PATCH", `${other.base}/training-records/${t.id}`, {
          session: other.s.bo,
          headers: ifm(1),
          body: { status: "no_show" },
        })
      ).status,
    ).toBe(404);
    const archivedGroup = await group("Synthetic archived team");
    expect(
      (
        await call(api.app, "POST", `${b.base}/stakeholder-groups/${archivedGroup}/archive`, {
          session: b.s.tl,
          headers: ifm(1),
          body: { reason: "Synthetic: merged" },
        })
      ).status,
    ).toBe(200);
    const onArchived = await call(api.app, "POST", TR, {
      session: b.s.bo,
      body: { ...body, stakeholderGroupId: archivedGroup },
    });
    expect([onArchived.status, onArchived.body.code]).toEqual([422, "stakeholder_group.archived"]);
    const u = await extraUser(api, w, b, "WL");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "PATCH", `${TR}/${t.id}`, {
          session: u.session,
          headers: ifm(1),
          body: { status: "no_show" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("training_record")
      .select(["status", "version"])
      .where("id", "=", t.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "enrolled", version: 1 });
    expect((await auditOf(api.db, t.id)).length).toBe(1);
  });
});
