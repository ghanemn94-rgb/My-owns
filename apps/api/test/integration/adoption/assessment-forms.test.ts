// Short native feedback and assessment forms and their invitations (T-DG4-BE-H2; ADR-0033 §5, §9, §10; REQ-S11-002
// "Owners publish short forms"). Proves, against the run's disposable PostgreSQL:
//  - a form is created with question version 1; editing its questions inserts the next version and steps
//    current_version_no in the same transaction; the published version stays until published again;
//  - a form with an unknown member or a duplicate key is 400 assessment_form.schema_invalid at the failing pointer,
//    with the exact ADR-0033 §10 text, and nothing is written;
//  - draft -> published -> retired with the exact refusals (status_transition, retired);
//  - invitations only for a published form (422 assessment_form.not_published), one open per invitee (409
//    assessment_invitation.exists), one My Work item each, cancel closes it (422 assessment_invitation.final after);
//  - If-Match 428/409; one audit event per row change; AUD and roles without assessment_form.manage 403; ADM-only and
//    outsiders 404; commit-time authorisation; the database last-line mappings of the BE-H2 constraints.
// All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "../../../src/modules/platform/db-errors.ts";
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
let AF: string;

const PROFICIENCY = {
  questions: [
    {
      key: "can_do",
      type: "yes_no",
      label_en: "Completed the task unaided?",
      label_ar: "هل أنجز المهمة دون مساعدة؟",
      required: true,
      proficiency: true,
    },
  ],
};
const FEEDBACK = {
  questions: [
    { key: "clarity", type: "scale", label_en: "Clarity", label_ar: "الوضوح", required: true, min: 1, max: 5 },
    { key: "comment", type: "text", label_en: "Comment", label_ar: "تعليق", required: false },
  ],
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  other = await seedBenefitWorld(api, w);
  wl = await extraUser(api, w, b, "WL");
  AF = `${b.base}/assessment-forms`;
  const g = await call(api.app, "POST", `${b.base}/stakeholder-groups`, {
    session: b.s.tl,
    body: {
      name: "Synthetic contact-centre agents",
      impact: "H",
      currentStance: "neutral",
      requiredBehavior: "Synthetic: resolve tickets in the new console",
      interventionTypes: ["training"],
      ownerUserId: b.users.bo.id,
    },
  });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  groupId = g.body.id;
}, 90_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const newForm = async (kind = "proficiency_assessment", schema: unknown = PROFICIENCY, session = b.s.bo) => {
  const r = await call(api.app, "POST", AF, {
    session,
    body: { kind, name: `Synthetic ${kind} form`, stakeholderGroupId: groupId, schema },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number };
};
const publish = async (id: string, version: number) => {
  const r = await call(api.app, "POST", `${AF}/${id}/publish`, { session: b.s.bo, headers: ifm(version) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as { id: string; version: number };
};
const formCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("assessment_form")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("transformation_id", "=", b.transformationId)
        .executeTakeFirstOrThrow()
    ).n,
  );

describe("forms and versions (ADR-0033 §5)", () => {
  it("creates a draft with question version 1; one audit event per row state; readable by AUD", async () => {
    const r = await call(api.app, "POST", AF, {
      session: wl.session,
      body: {
        kind: "proficiency_assessment",
        name: "Synthetic console proficiency",
        description: "Synthetic: observed on the floor",
        stakeholderGroupId: groupId,
        schema: PROFICIENCY,
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([r.headers.location, r.headers.etag]).toEqual([`${AF}/${r.body.id}`, '"2"']);
    expect(r.body).toMatchObject({
      kind: "proficiency_assessment",
      status: "draft",
      stakeholderGroupId: groupId,
      currentVersion: { versionNo: 1, schema: PROFICIENCY, createdBy: wl.id },
      publishedVersionNo: null,
      createdBy: wl.id,
      version: 2,
    });
    expect((await auditOf(api.db, r.body.id)).map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["assessment_form.create", null, 1],
      ["assessment_form.version_create", 1, 2],
    ]);
    const read = await call(api.app, "GET", `${AF}/${r.body.id}`, { session: b.s.auditor });
    expect([read.status, read.headers.etag, read.body.currentVersion.versionNo]).toEqual([200, '"2"', 1]);
    const list = await call(api.app, "GET", `${AF}?status=draft`, { session: b.s.auditor });
    expect(list.body.items.map((f: { id: string }) => f.id)).toContain(r.body.id);
  });

  it("a form with an unknown member or a duplicate key is 400 assessment_form.schema_invalid at the pointer; no write", async () => {
    const before = await formCount();
    const unknown = await call(api.app, "POST", AF, {
      session: b.s.bo,
      body: {
        kind: "feedback",
        name: "Synthetic bad form",
        schema: { questions: [{ ...FEEDBACK.questions[1], colour: "red" }] },
      },
    });
    expect([unknown.status, unknown.body.code, unknown.body.detail, unknown.body.errors]).toEqual([
      400,
      "assessment_form.schema_invalid",
      'The form is not valid: unknown member "colour".',
      [
        {
          pointer: "/schema/questions/0/colour",
          code: "assessment_form.schema_invalid",
          message: 'The form is not valid: unknown member "colour".',
        },
      ],
    ]);
    const dup = await call(api.app, "POST", AF, {
      session: b.s.bo,
      body: {
        kind: "feedback",
        name: "Synthetic dup",
        schema: { questions: [FEEDBACK.questions[0], FEEDBACK.questions[0]] },
      },
    });
    expect([dup.status, dup.body.code, dup.body.errors[0].pointer, dup.body.detail]).toEqual([
      400,
      "assessment_form.schema_invalid",
      "/schema/questions/1/key",
      'The form is not valid: duplicate question key "clarity".',
    ]);
    const noProf = await call(api.app, "POST", AF, {
      session: b.s.bo,
      body: { kind: "proficiency_assessment", name: "Synthetic", schema: FEEDBACK },
    });
    expect([noProf.status, noProf.body.errors[0].pointer]).toEqual([400, "/schema/questions"]);
    expect(await formCount()).toBe(before);
  });

  it("editing the questions inserts the next version; the published version stays until published again", async () => {
    const f = await newForm("feedback", FEEDBACK);
    const p = await publish(f.id, f.version);
    expect(p).toMatchObject({ status: "published", publishedVersionNo: 1, version: 3 });
    const again = await call(api.app, "POST", `${AF}/${f.id}/publish`, { session: b.s.bo, headers: ifm(3) });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "assessment_form.status_transition",
      "This form cannot move from published to published.",
    ]);
    const v2 = {
      questions: [
        ...FEEDBACK.questions,
        { key: "useful", type: "yes_no", label_en: "Useful?", label_ar: "مفيد؟", required: false },
      ],
    };
    const edited = await call(api.app, "PATCH", `${AF}/${f.id}`, {
      session: b.s.bo,
      headers: ifm(3),
      body: { name: "Synthetic launch feedback v2", schema: v2 },
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({
      name: "Synthetic launch feedback v2",
      status: "published",
      publishedVersionNo: 1,
      currentVersion: { versionNo: 2, schema: v2 },
      version: 4,
    });
    const versions = await api.db
      .selectFrom("assessment_form_version")
      .select("version_no")
      .where("form_id", "=", f.id)
      .orderBy("version_no")
      .execute();
    expect(versions.map((v) => v.version_no)).toEqual([1, 2]);
    const repub = await publish(f.id, 4);
    expect(repub).toMatchObject({ publishedVersionNo: 2, version: 5 });
    // A name-only edit is no new version.
    const named = await call(api.app, "PATCH", `${AF}/${f.id}`, {
      session: b.s.bo,
      headers: ifm(5),
      body: { description: "Synthetic note" },
    });
    expect([named.status, named.body.currentVersion.versionNo, named.body.version]).toEqual([200, 2, 6]);
    expect((await auditOf(api.db, f.id)).map((a) => a.action)).toEqual([
      "assessment_form.create",
      "assessment_form.version_create",
      "assessment_form.publish",
      "assessment_form.update",
      "assessment_form.publish",
      "assessment_form.update",
    ]);
    // An invalid new version is refused at its pointer and writes nothing.
    const bad = await call(api.app, "PATCH", `${AF}/${f.id}`, {
      session: b.s.bo,
      headers: ifm(6),
      body: { schema: { questions: [{ ...FEEDBACK.questions[0], max: 11 }] } },
    });
    expect([bad.status, bad.body.code, bad.body.errors[0].pointer]).toEqual([
      400,
      "assessment_form.schema_invalid",
      "/schema/questions/0/max",
    ]);
    expect((await call(api.app, "GET", `${AF}/${f.id}`, { session: b.s.bo })).body.version).toBe(6);
  });

  it("If-Match 428/409; draft cannot retire; retired is final (retired / status_transition)", async () => {
    const f = await newForm();
    expect((await call(api.app, "PATCH", `${AF}/${f.id}`, { session: b.s.bo, body: { name: "x" } })).status).toBe(428);
    expect(
      (await call(api.app, "PATCH", `${AF}/${f.id}`, { session: b.s.bo, headers: ifm(1), body: { name: "x" } })).status,
    ).toBe(409);
    expect((await call(api.app, "POST", `${AF}/${f.id}/publish`, { session: b.s.bo })).status).toBe(428);
    expect((await call(api.app, "POST", `${AF}/${f.id}/publish`, { session: b.s.bo, headers: ifm(1) })).status).toBe(
      409,
    );
    const draftRetire = await call(api.app, "POST", `${AF}/${f.id}/retire`, { session: b.s.bo, headers: ifm(2) });
    expect([draftRetire.status, draftRetire.body.code, draftRetire.body.detail]).toEqual([
      422,
      "assessment_form.status_transition",
      "This form cannot move from draft to retired.",
    ]);
    await publish(f.id, 2);
    expect((await call(api.app, "POST", `${AF}/${f.id}/retire`, { session: b.s.bo })).status).toBe(428);
    expect((await call(api.app, "POST", `${AF}/${f.id}/retire`, { session: b.s.bo, headers: ifm(2) })).status).toBe(
      409,
    );
    const retired = await call(api.app, "POST", `${AF}/${f.id}/retire`, { session: b.s.bo, headers: ifm(3) });
    expect([retired.status, retired.body.status, retired.body.retiredBy]).toEqual([200, "retired", b.users.bo.id]);
    const edit = await call(api.app, "PATCH", `${AF}/${f.id}`, {
      session: b.s.bo,
      headers: ifm(4),
      body: { name: "x" },
    });
    expect([edit.status, edit.body.code, edit.body.detail]).toEqual([
      422,
      "assessment_form.retired",
      "This form is retired and can no longer be changed.",
    ]);
    const pub = await call(api.app, "POST", `${AF}/${f.id}/publish`, { session: b.s.bo, headers: ifm(4) });
    expect([pub.status, pub.body.code]).toEqual([422, "assessment_form.retired"]);
    const twice = await call(api.app, "POST", `${AF}/${f.id}/retire`, { session: b.s.bo, headers: ifm(4) });
    expect([twice.status, twice.body.detail]).toEqual([422, "This form cannot move from retired to retired."]);
    expect((await auditOf(api.db, f.id)).length).toBe(4);
  });
});

describe("invitations (ADR-0033 §5: one open per invitee, one My Work item each)", () => {
  it("a draft form takes no invitation (422 assessment_form.not_published)", async () => {
    const f = await newForm();
    const r = await call(api.app, "POST", `${AF}/${f.id}/invitations`, {
      session: b.s.bo,
      body: { userIds: [b.users.fin.id], stakeholderGroupId: groupId },
    });
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      422,
      "assessment_form.not_published",
      "Only a published form takes invitations and responses.",
    ]);
  });

  it("invites, gives each invitee one work item, refuses a second open invitation, cancels", async () => {
    const f = await newForm();
    await publish(f.id, 2);
    const r = await call(api.app, "POST", `${AF}/${f.id}/invitations`, {
      session: b.s.bo,
      body: {
        userIds: [b.users.fin.id, b.users.tl.id],
        stakeholderGroupId: groupId,
        subjectUserId: wl.id,
        dueDate: "2026-11-30",
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.items[0]).toMatchObject({
      formId: f.id,
      userId: b.users.fin.id,
      stakeholderGroupId: groupId,
      subjectUserId: wl.id,
      dueDate: "2026-11-30",
      status: "open",
      version: 1,
    });
    const [finInv, tlInv] = r.body.items as { id: string }[];
    const items = await api.db
      .selectFrom("work_item")
      .select(["kind", "assignee_user_id", "status", "due_date", "dedupe_key", "subject_type"])
      .where("subject_id", "in", [finInv!.id, tlInv!.id])
      .orderBy("assignee_user_id")
      .execute();
    expect(items).toEqual(
      [
        { user: b.users.fin.id, inv: finInv!.id },
        { user: b.users.tl.id, inv: tlInv!.id },
      ]
        .map((x) => ({
          kind: "assessment_invitation",
          assignee_user_id: x.user,
          status: "open",
          due_date: "2026-11-30",
          dedupe_key: `assessment.invitation:${x.inv}`,
          subject_type: "assessment_invitation",
        }))
        .sort((p, q) => p.assignee_user_id.localeCompare(q.assignee_user_id)),
    );
    const mine = await call(api.app, "GET", "/api/v1/me/work-items", { session: b.s.fin });
    expect(mine.body.items.some((x: { subjectId: string }) => x.subjectId === finInv!.id)).toBe(true);
    expect((await auditOf(api.db, finInv!.id)).map((a) => a.action)).toEqual(["assessment_invitation.create"]);

    const dup = await call(api.app, "POST", `${AF}/${f.id}/invitations`, {
      session: b.s.bo,
      body: { userIds: [b.users.fin.id], stakeholderGroupId: groupId, subjectUserId: wl.id },
    });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "assessment_invitation.exists",
      "This person already has an open invitation to this form.",
    ]);
    // Another observed person is another invitation.
    const otherSubject = await call(api.app, "POST", `${AF}/${f.id}/invitations`, {
      session: b.s.bo,
      body: { userIds: [b.users.fin.id], stakeholderGroupId: groupId, subjectUserId: b.users.bo2.id },
    });
    expect(otherSubject.status).toBe(201);

    const list = await call(api.app, "GET", `${AF}/${f.id}/invitations`, { session: b.s.auditor });
    expect([list.status, list.body.items.length]).toEqual([200, 3]);

    const C = `${b.base}/assessment-invitations/${tlInv!.id}/cancel`;
    expect((await call(api.app, "POST", C, { session: b.s.bo })).status).toBe(428);
    expect((await call(api.app, "POST", C, { session: b.s.bo, headers: ifm(2) })).status).toBe(409);
    const cancelled = await call(api.app, "POST", C, { session: b.s.bo, headers: ifm(1) });
    expect([cancelled.status, cancelled.body.status, cancelled.headers.etag]).toEqual([200, "cancelled", '"2"']);
    const task = await api.db
      .selectFrom("work_item")
      .select("status")
      .where("subject_id", "=", tlInv!.id)
      .executeTakeFirstOrThrow();
    expect(task.status).toBe("cancelled");
    const again = await call(api.app, "POST", C, { session: b.s.bo, headers: ifm(2) });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "assessment_invitation.final",
      "This invitation is cancelled and can no longer be changed.",
    ]);
    // After the cancellation the person can be invited again.
    const reinvite = await call(api.app, "POST", `${AF}/${f.id}/invitations`, {
      session: b.s.bo,
      body: { userIds: [b.users.tl.id], stakeholderGroupId: groupId, subjectUserId: wl.id },
    });
    expect(reinvite.status).toBe(201);
  });

  it("a feedback form names no observed person; an unknown group or user is refused", async () => {
    const f = await newForm("feedback", FEEDBACK);
    await publish(f.id, 2);
    const subj = await call(api.app, "POST", `${AF}/${f.id}/invitations`, {
      session: b.s.bo,
      body: { userIds: [b.users.fin.id], stakeholderGroupId: groupId, subjectUserId: wl.id },
    });
    expect([subj.status, subj.body.errors[0].pointer]).toEqual([400, "/subjectUserId"]);
    const foreignGroup = await call(api.app, "POST", `${AF}/${f.id}/invitations`, {
      session: b.s.bo,
      body: { userIds: [b.users.fin.id], stakeholderGroupId: other.transformationId },
    });
    expect([foreignGroup.status, foreignGroup.body.errors[0].pointer]).toEqual([422, "/stakeholderGroupId"]);
    const ghost = await call(api.app, "POST", `${AF}/${f.id}/invitations`, {
      session: b.s.bo,
      body: { userIds: [b.users.fin.id, other.transformationId], stakeholderGroupId: groupId },
    });
    expect([ghost.status, ghost.body.code]).toEqual([422, "validation.user_invalid"]);
    expect(
      (await api.db.selectFrom("assessment_invitation").select("id").where("form_id", "=", f.id).execute()).length,
    ).toBe(0);
  });
});

describe("authorisation (ADR-0033 §9)", () => {
  it("AUD, TL and FIN 403 on writes; ADM-only and outsiders 404; another transformation 404; commit-time 403", async () => {
    const f = await newForm();
    const body = { kind: "feedback", name: "Synthetic", schema: FEEDBACK };
    for (const session of [b.s.auditor, b.s.tl, b.s.fin]) {
      expect((await call(api.app, "POST", AF, { session, body })).status).toBe(403);
      expect(
        (await call(api.app, "PATCH", `${AF}/${f.id}`, { session, headers: ifm(2), body: { name: "x" } })).status,
      ).toBe(403);
      expect((await call(api.app, "POST", `${AF}/${f.id}/publish`, { session, headers: ifm(2) })).status).toBe(403);
      expect((await call(api.app, "POST", `${AF}/${f.id}/retire`, { session, headers: ifm(2) })).status).toBe(403);
      expect(
        (
          await call(api.app, "POST", `${AF}/${f.id}/invitations`, {
            session,
            body: { userIds: [b.users.fin.id], stakeholderGroupId: groupId },
          })
        ).status,
      ).toBe(403);
    }
    for (const session of [b.s.admin, b.s.outsider]) {
      expect((await call(api.app, "GET", AF, { session })).status).toBe(404);
      expect((await call(api.app, "GET", `${AF}/${f.id}`, { session })).status).toBe(404);
      expect((await call(api.app, "GET", `${AF}/${f.id}/invitations`, { session })).status).toBe(404);
      expect((await call(api.app, "POST", AF, { session, body })).status).toBe(404);
      expect(
        (await call(api.app, "PATCH", `${AF}/${f.id}`, { session, headers: ifm(2), body: { name: "x" } })).status,
      ).toBe(404);
      expect((await call(api.app, "POST", `${AF}/${f.id}/publish`, { session, headers: ifm(2) })).status).toBe(404);
    }
    expect((await call(api.app, "GET", `${other.base}/assessment-forms/${f.id}`, { session: other.s.bo })).status).toBe(
      404,
    );
    expect(
      (
        await call(api.app, "POST", `${other.base}/assessment-forms/${f.id}/publish`, {
          session: other.s.bo,
          headers: ifm(2),
        })
      ).status,
    ).toBe(404);
    const u = await extraUser(api, w, b, "BO");
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", `${AF}/${f.id}/publish`, { session: u.session, headers: ifm(2), contract: false }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("assessment_form")
      .select(["status", "version"])
      .where("id", "=", f.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "draft", version: 2 });
    expect((await auditOf(api.db, f.id)).length).toBe(2);
  });

  it("commit-time 403 on create, edit, retire, invite and cancel; nothing written", async () => {
    // Each call runs as a fresh BO whose grants are revoked between identity resolution and commit.
    const revokedCall = async (
      method: string,
      url: string,
      init: { headers?: Record<string, string>; body?: unknown },
    ) => {
      const u = await extraUser(api, w, b, "BO");
      return afterIdentity(
        api,
        u.id,
        () => call(api.app, method, url, { session: u.session, ...init, contract: false }),
        () => revokeAll(api, w.grantor.id, u.id),
      );
    };
    const before = await formCount();
    const created = await revokedCall("POST", AF, {
      body: { kind: "feedback", name: "Synthetic commit-time form", schema: FEEDBACK },
    });
    expect(created.status).toBe(403);
    expect(await formCount()).toBe(before);

    const draft = await newForm();
    const edited = await revokedCall("PATCH", `${AF}/${draft.id}`, { headers: ifm(2), body: { schema: PROFICIENCY } });
    expect(edited.status).toBe(403);
    const pub = await publish(draft.id, 2);
    const retired = await revokedCall("POST", `${AF}/${draft.id}/retire`, { headers: ifm(pub.version) });
    expect(retired.status).toBe(403);
    const formRow = await api.db
      .selectFrom("assessment_form")
      .select(["status", "version", "current_version_no"])
      .where("id", "=", draft.id)
      .executeTakeFirstOrThrow();
    expect(formRow).toEqual({ status: "published", version: 3, current_version_no: 1 });

    const invited = await revokedCall("POST", `${AF}/${draft.id}/invitations`, {
      body: { userIds: [b.users.fin.id], stakeholderGroupId: groupId },
    });
    expect(invited.status).toBe(403);
    const invitationsOf = () =>
      api.db
        .selectFrom("assessment_invitation")
        .select(["id", "status", "version"])
        .where("form_id", "=", draft.id)
        .execute();
    expect(await invitationsOf()).toEqual([]);

    const inv = await call(api.app, "POST", `${AF}/${draft.id}/invitations`, {
      session: b.s.bo,
      body: { userIds: [b.users.fin.id], stakeholderGroupId: groupId },
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const invId = inv.body.items[0].id as string;
    const cancelled = await revokedCall("POST", `${b.base}/assessment-invitations/${invId}/cancel`, {
      headers: ifm(1),
    });
    expect(cancelled.status).toBe(403);
    expect(await invitationsOf()).toEqual([{ id: invId, status: "open", version: 1 }]);
    expect((await auditOf(api.db, invId)).length).toBe(1);
  });
});

describe("database last lines of the BE-H2 constraints (S-11)", () => {
  const map = (constraint: string, message = "") => mapDatabaseGuardError({ code: "23514", constraint, message })!;
  const triple = (p: ReturnType<typeof map>) => [p.status, p.code, p.detail];
  it("maps each guard to its ADR-0033 §10 code and exact text", () => {
    expect(triple(map("assessment_form_retired_final"))).toEqual([
      422,
      "assessment_form.retired",
      "This form is retired and can no longer be changed.",
    ]);
    expect(
      triple(map("assessment_form_transition", "assessment_form x: draft -> retired is not a legal transition")),
    ).toEqual([422, "assessment_form.status_transition", "This form cannot move from draft to retired."]);
    expect(map("assessment_form_version_schema_valid").status).toBe(400);
    expect(map("assessment_form_version_schema_valid").code).toBe("assessment_form.schema_invalid");
    expect(triple(map("assessment_record_form_published"))[1]).toBe("assessment_form.not_published");
    expect(triple(map("assessment_invitation_open_key"))).toEqual([
      409,
      "assessment_invitation.exists",
      "This person already has an open invitation to this form.",
    ]);
    expect(
      triple(map("assessment_invitation_final", "assessment_invitation x: a responded invitation is final")),
    ).toEqual([422, "assessment_invitation.final", "This invitation is responded and can no longer be changed."]);
    expect(triple(map("assessment_record_invitation_matches"))).toEqual([
      403,
      "assessment_record.not_invited",
      "You are not invited to answer this form.",
    ]);
    expect(triple(map("assessment_record_withdrawn_final"))[1]).toBe("assessment_record.withdrawn");
    expect(
      triple(
        map("assessment_record_transition", "assessment_record x: reviewed -> reviewed is not a legal transition"),
      ),
    ).toEqual([422, "assessment_record.status_transition", "This response cannot move from reviewed to reviewed."]);
    expect(triple(map("training_record_final", "training_record x: a no_show record is final"))).toEqual([
      422,
      "training_record.final",
      "This training record is no_show and can no longer be changed.",
    ]);
    expect(triple(map("training_record_intervention_training"))[1]).toBe("training_record.intervention_not_training");
    expect(map("training_record_completed_complete").errors![0]!.pointer).toBe("/completedOn");
    for (const c of ["assessment_record_immutable", "assessment_record_proficiency_shape", "training_record_identity"])
      expect(map(c).status).toBe(500);
    // The generic optimistic-concurrency rule still answers the form's own version step.
    expect(map("assessment_form_version_step").status).toBe(409);
  });
});
