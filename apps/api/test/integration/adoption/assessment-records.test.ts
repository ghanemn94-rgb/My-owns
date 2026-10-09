// Assessment records: responses and proficiency observations (T-DG4-BE-H2; ADR-0033 §5, §6, §9, §10; REQ-S11-002 A11
// "a proficiency observation submitted via the form links to the stakeholder group and counts in the proficiency
// indicator"; REQ-PB-072 records; REQ-S16-020 Training/AssessmentRecord, the assessment half). Proves, against the run's
// disposable PostgreSQL:
//  - an invited respondent answers the PUBLISHED version; the observation links to its stakeholder group, the result is
//    derived from the proficiency answer (never sent by the client), the invitation becomes responded and its work
//    item done, and the form's creator gets one assessment_to_review item; the group's non-withdrawn observations (the
//    rows ADR-0033 §6's observed-proficiency measure counts; the computed indicator is KBE-F's) include it until it is
//    withdrawn;
//  - an assessor holding proficiency.record records an observation without invitation; an uninvited non-assessor is
//    403 assessment_record.not_invited; a response to a draft or retired form is 422 assessment_form.not_published;
//  - answers are checked against the published version (400 answer_required / answer_invalid at /answers/<key>), an
//    observation names its subject (400 subject_required at /subjectUserId); nothing is written on a refusal;
//  - review (assessment.review; BO) and withdrawal (a reviewer, or the respondent), with the exact refusals, If-Match
//    428/409, one audit event per change, AUD 403, ADM-only and outsiders 404 and commit-time authorisation.
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
let subject: Extra;
let groupId: string;
let profForm: string;
let feedbackForm: string;
let AR: string;

const PROFICIENCY = {
  questions: [
    {
      key: "can_do",
      type: "yes_no",
      label_en: "Resolved the ticket unaided?",
      label_ar: "هل حل التذكرة دون مساعدة؟",
      required: true,
      proficiency: true,
    },
    { key: "notes", type: "text", label_en: "Notes", label_ar: "ملاحظات", required: false },
  ],
};
const FEEDBACK = {
  questions: [
    {
      key: "clarity",
      type: "single_choice",
      label_en: "Was the launch clear?",
      label_ar: "هل كان الإطلاق واضحاً؟",
      required: true,
      options: [
        { value: "yes", label_en: "Yes", label_ar: "نعم" },
        { value: "no", label_en: "No", label_ar: "لا" },
      ],
    },
  ],
};

const createForm = async (kind: string, schema: unknown, session = b.s.bo, publish = true) => {
  const f = await call(api.app, "POST", `${b.base}/assessment-forms`, {
    session,
    body: { kind, name: `Synthetic ${kind}`, stakeholderGroupId: groupId, schema },
  });
  expect(f.status, JSON.stringify(f.body)).toBe(201);
  if (publish) {
    const p = await call(api.app, "POST", `${b.base}/assessment-forms/${f.body.id}/publish`, {
      session,
      headers: ifm(2),
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
  }
  return f.body.id as string;
};
const invite = async (formId: string, userIds: string[], subjectUserId?: string) => {
  const r = await call(api.app, "POST", `${b.base}/assessment-forms/${formId}/invitations`, {
    session: b.s.bo,
    body: { userIds, stakeholderGroupId: groupId, ...(subjectUserId ? { subjectUserId } : {}) },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.items as { id: string; userId: string }[];
};
/** The rows the observed-proficiency measure counts for a group (ADR-0033 §6): non-withdrawn observations. */
const countedObservations = async (group: string) =>
  (
    await api.db
      .selectFrom("assessment_record")
      .select(["id", "proficiency_result"])
      .where("stakeholder_group_id", "=", group)
      .where("kind", "=", "proficiency_observation")
      .where("status", "<>", "withdrawn")
      .execute()
  ).map((r) => r.id);
const recordCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("assessment_record")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("transformation_id", "=", b.transformationId)
        .executeTakeFirstOrThrow()
    ).n,
  );

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  other = await seedBenefitWorld(api, w);
  wl = await extraUser(api, w, b, "WL");
  subject = await extraUser(api, w, b, "TO");
  AR = `${b.base}/assessment-records`;
  const g = await call(api.app, "POST", `${b.base}/stakeholder-groups`, {
    session: b.s.tl,
    body: {
      name: "Synthetic retail store staff",
      impact: "H",
      currentStance: "resist",
      requiredBehavior: "Synthetic: sell bundles in the new POS",
      interventionTypes: ["training"],
      ownerUserId: b.users.bo.id,
    },
  });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  groupId = g.body.id;
  profForm = await createForm("proficiency_assessment", PROFICIENCY, wl.session);
  feedbackForm = await createForm("feedback", FEEDBACK);
}, 90_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("REQ-S11-002 A11: a proficiency observation submitted via the form links to the stakeholder group", () => {
  it("invited respondent; group link; derived result; invitation responded; review item for the form's creator", async () => {
    const [inv] = await invite(profForm, [b.users.fin.id], subject.id);
    const before = await countedObservations(groupId);
    const r = await call(api.app, "POST", AR, {
      session: b.s.fin,
      body: {
        formId: profForm,
        invitationId: inv!.id,
        stakeholderGroupId: groupId,
        subjectUserId: subject.id,
        observedOn: "2026-10-08",
        answers: { can_do: true, notes: "Synthetic: handled a refund alone" },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([r.headers.location, r.headers.etag]).toEqual([`${AR}/${r.body.id}`, '"1"']);
    expect(r.body).toMatchObject({
      formId: profForm,
      formVersionNo: 1,
      invitationId: inv!.id,
      stakeholderGroupId: groupId,
      kind: "proficiency_observation",
      respondentUserId: b.users.fin.id,
      subjectUserId: subject.id,
      subjectLabel: null,
      observedOn: "2026-10-08",
      answers: { can_do: true, notes: "Synthetic: handled a refund alone" },
      proficiencyResult: "proficient",
      status: "submitted",
      createdBy: b.users.fin.id,
      version: 1,
    });
    // Linked to the group, and counted with the group's observations from submission.
    expect(await countedObservations(groupId)).toEqual([...before, r.body.id]);
    const byGroup = await call(api.app, "GET", `${AR}?stakeholderGroupId=${groupId}&kind=proficiency_observation`, {
      session: b.s.auditor,
    });
    expect(byGroup.body.items.map((x: { id: string }) => x.id)).toContain(r.body.id);
    // Invitation responded, its work item done; the form's creator (WL) has one review item.
    const invRow = await api.db
      .selectFrom("assessment_invitation")
      .select(["status", "version"])
      .where("id", "=", inv!.id)
      .executeTakeFirstOrThrow();
    expect(invRow).toEqual({ status: "responded", version: 2 });
    const tasks = await api.db
      .selectFrom("work_item")
      .select(["kind", "assignee_user_id", "status", "dedupe_key"])
      .where("subject_id", "in", [inv!.id, r.body.id])
      .orderBy("kind")
      .execute();
    expect(tasks).toEqual([
      {
        kind: "assessment_invitation",
        assignee_user_id: b.users.fin.id,
        status: "done",
        dedupe_key: `assessment.invitation:${inv!.id}`,
      },
      {
        kind: "assessment_to_review",
        assignee_user_id: wl.id,
        status: "open",
        dedupe_key: `assessment.review:${r.body.id}`,
      },
    ]);
    expect((await auditOf(api.db, r.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["assessment_record.create", 1],
    ]);
    expect((await auditOf(api.db, inv!.id)).map((a) => a.action)).toEqual([
      "assessment_invitation.create",
      "assessment_invitation.respond",
    ]);
    const read = await call(api.app, "GET", `${AR}/${r.body.id}`, { session: b.s.auditor });
    expect([read.status, read.headers.etag, read.body.proficiencyResult]).toEqual([200, '"1"', "proficient"]);
    // The invitation is answered: a second response through it is refused.
    const again = await call(api.app, "POST", AR, {
      session: b.s.fin,
      body: {
        formId: profForm,
        invitationId: inv!.id,
        stakeholderGroupId: groupId,
        subjectUserId: subject.id,
        observedOn: "2026-10-08",
        answers: { can_do: false },
      },
    });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "assessment_invitation.final",
      "This invitation is responded and can no longer be changed.",
    ]);
  });

  it("the open invitation is found without its id; an assessor records an observation without invitation", async () => {
    await invite(profForm, [b.users.tl.id], subject.id);
    const found = await call(api.app, "POST", AR, {
      session: b.s.tl,
      body: {
        formId: profForm,
        stakeholderGroupId: groupId,
        subjectUserId: subject.id,
        observedOn: "2026-10-07",
        answers: { can_do: false },
      },
    });
    expect(found.status, JSON.stringify(found.body)).toBe(201);
    expect([found.body.invitationId === null, found.body.proficiencyResult]).toEqual([false, "not_yet_proficient"]);
    // WL holds proficiency.record: an assessor's observation, subject by label.
    const assessor = await call(api.app, "POST", AR, {
      session: wl.session,
      body: {
        formId: profForm,
        stakeholderGroupId: groupId,
        subjectLabel: "Synthetic store 12 cashier",
        observedOn: "2026-10-06",
        answers: { can_do: true },
      },
    });
    expect(assessor.status, JSON.stringify(assessor.body)).toBe(201);
    expect(assessor.body).toMatchObject({
      invitationId: null,
      subjectUserId: null,
      subjectLabel: "Synthetic store 12 cashier",
      proficiencyResult: "proficient",
      respondentUserId: wl.id,
    });
  });

  it("an uninvited non-assessor is 403 assessment_record.not_invited; nothing written", async () => {
    const before = await recordCount();
    // TL holds assessment.respond but not proficiency.record, and has no open invitation for this subject.
    const obs = await call(api.app, "POST", AR, {
      session: b.s.tl,
      body: {
        formId: profForm,
        stakeholderGroupId: groupId,
        subjectUserId: b.users.bo2.id,
        observedOn: "2026-10-07",
        answers: { can_do: true },
      },
    });
    expect([obs.status, obs.body.code, obs.body.detail]).toEqual([
      403,
      "assessment_record.not_invited",
      "You are not invited to answer this form.",
    ]);
    // Feedback needs an invitation even for an assessor.
    const fb = await call(api.app, "POST", AR, {
      session: wl.session,
      body: {
        formId: feedbackForm,
        stakeholderGroupId: groupId,
        observedOn: "2026-10-07",
        answers: { clarity: "yes" },
      },
    });
    expect([fb.status, fb.body.code]).toEqual([403, "assessment_record.not_invited"]);
    // Somebody else's invitation is not the caller's.
    const [finInv] = await invite(feedbackForm, [b.users.fin.id]);
    const stolen = await call(api.app, "POST", AR, {
      session: b.s.tl,
      body: {
        formId: feedbackForm,
        invitationId: finInv!.id,
        stakeholderGroupId: groupId,
        observedOn: "2026-10-07",
        answers: { clarity: "yes" },
      },
    });
    expect([stolen.status, stolen.body.code]).toEqual([403, "assessment_record.not_invited"]);
    expect(await recordCount()).toBe(before);
  });

  it("a response to a draft or retired form is 422 assessment_form.not_published", async () => {
    const draft = await createForm("proficiency_assessment", PROFICIENCY, b.s.bo, false);
    const body = (formId: string) => ({
      formId,
      stakeholderGroupId: groupId,
      subjectUserId: subject.id,
      observedOn: "2026-10-07",
      answers: { can_do: true },
    });
    const r = await call(api.app, "POST", AR, { session: b.s.bo, body: body(draft) });
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      422,
      "assessment_form.not_published",
      "Only a published form takes invitations and responses.",
    ]);
    const retired = await createForm("proficiency_assessment", PROFICIENCY);
    expect(
      (
        await call(api.app, "POST", `${b.base}/assessment-forms/${retired}/retire`, {
          session: b.s.bo,
          headers: ifm(3),
        })
      ).status,
    ).toBe(200);
    expect((await call(api.app, "POST", AR, { session: b.s.bo, body: body(retired) })).body.code).toBe(
      "assessment_form.not_published",
    );
  });

  it("answers are checked against the published version; an observation names its subject; nothing written", async () => {
    const before = await recordCount();
    const base = { formId: profForm, stakeholderGroupId: groupId, subjectUserId: subject.id, observedOn: "2026-10-07" };
    const missing = await call(api.app, "POST", AR, {
      session: wl.session,
      body: { ...base, answers: { notes: "x" } },
    });
    expect([missing.status, missing.body.code, missing.body.detail, missing.body.errors]).toEqual([
      400,
      "assessment_record.answer_required",
      "This question requires an answer.",
      [
        {
          pointer: "/answers/can_do",
          code: "assessment_record.answer_required",
          message: "This question requires an answer.",
        },
      ],
    ]);
    const wrong = await call(api.app, "POST", AR, {
      session: wl.session,
      body: { ...base, answers: { can_do: "yes", extra: 1 } },
    });
    expect([wrong.status, wrong.body.code, wrong.body.detail]).toEqual([
      400,
      "assessment_record.answer_invalid",
      "This answer is not valid for the question.",
    ]);
    expect(wrong.body.errors.map((e: { pointer: string }) => e.pointer)).toEqual(["/answers/can_do", "/answers/extra"]);
    const blank = await call(api.app, "POST", AR, {
      session: wl.session,
      body: { ...base, answers: { can_do: true, notes: "   " } },
    });
    expect([blank.status, blank.body.errors[0].pointer]).toEqual([400, "/answers/notes"]);
    const { subjectUserId: _s, ...noSubject } = base;
    const nobody = await call(api.app, "POST", AR, {
      session: wl.session,
      body: { ...noSubject, answers: { can_do: true } },
    });
    expect([nobody.status, nobody.body.code, nobody.body.detail, nobody.body.errors[0].pointer]).toEqual([
      400,
      "assessment_record.subject_required",
      "A proficiency observation names the person observed.",
      "/subjectUserId",
    ]);
    // The client never sends the result.
    const sent = await call(api.app, "POST", AR, {
      session: wl.session,
      body: { ...base, answers: { can_do: false }, proficiencyResult: "proficient" },
    });
    // The shared strict parser (S-2) reports an unknown member at its parent pointer, the body root.
    expect([sent.status, sent.body.errors[0].pointer, sent.body.errors[0].code]).toEqual([
      400,
      "",
      "validation.unknown_field",
    ]);
    expect(await recordCount()).toBe(before);
  });

  it("a new form version answers only after it is published: responses name the published version", async () => {
    const f = await createForm("feedback", FEEDBACK);
    const v2 = {
      questions: [
        ...FEEDBACK.questions,
        { key: "useful", type: "yes_no", label_en: "Useful?", label_ar: "مفيد؟", required: true },
      ],
    };
    const edit = await call(api.app, "PATCH", `${b.base}/assessment-forms/${f}`, {
      session: b.s.bo,
      headers: ifm(3),
      body: { schema: v2 },
    });
    expect([edit.status, edit.body.currentVersion.versionNo, edit.body.publishedVersionNo]).toEqual([200, 2, 1]);
    await invite(f, [b.users.fin.id]);
    const v1Answer = await call(api.app, "POST", AR, {
      session: b.s.fin,
      body: { formId: f, stakeholderGroupId: groupId, observedOn: "2026-10-07", answers: { clarity: "no" } },
    });
    expect(v1Answer.status, JSON.stringify(v1Answer.body)).toBe(201);
    expect([v1Answer.body.kind, v1Answer.body.formVersionNo, v1Answer.body.proficiencyResult]).toEqual([
      "feedback",
      1,
      null,
    ]);
  });
});

describe("review and withdrawal (ADR-0033 §5, §9)", () => {
  const observe = async (session = wl.session) => {
    const r = await call(api.app, "POST", AR, {
      session,
      body: {
        formId: profForm,
        stakeholderGroupId: groupId,
        subjectLabel: "Synthetic agent",
        observedOn: "2026-10-05",
        answers: { can_do: true },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };

  it("BO reviews with a note; the review item is done; reviewing again or by WL is refused", async () => {
    const id = await observe();
    const R = `${AR}/${id}/review`;
    expect((await call(api.app, "POST", R, { session: b.s.bo, body: {} })).status).toBe(428);
    expect((await call(api.app, "POST", R, { session: b.s.bo, headers: ifm(2), body: {} })).status).toBe(409);
    const wlReview = await call(api.app, "POST", R, { session: wl.session, headers: ifm(1), body: {} });
    expect(wlReview.status).toBe(403);
    const ok = await call(api.app, "POST", R, {
      session: b.s.bo,
      headers: ifm(1),
      body: { note: "Synthetic: matches the floor walk" },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      status: "reviewed",
      reviewedBy: b.users.bo.id,
      reviewNote: "Synthetic: matches the floor walk",
      version: 2,
      answers: { can_do: true },
      proficiencyResult: "proficient",
    });
    const task = await api.db
      .selectFrom("work_item")
      .select("status")
      .where("subject_id", "=", id)
      .executeTakeFirstOrThrow();
    expect(task.status).toBe("done");
    const twice = await call(api.app, "POST", R, { session: b.s.bo, headers: ifm(2), body: {} });
    expect([twice.status, twice.body.code, twice.body.detail]).toEqual([
      422,
      "assessment_record.status_transition",
      "This response cannot move from reviewed to reviewed.",
    ]);
    expect((await auditOf(api.db, id)).map((a) => a.action)).toEqual([
      "assessment_record.create",
      "assessment_record.review",
    ]);
  });

  it("the respondent or a reviewer withdraws; it stops counting; others 403; withdrawn is final", async () => {
    const id = await observe();
    expect(await countedObservations(groupId)).toContain(id);
    const W = `${AR}/${id}/withdraw`;
    // FIN neither reviews nor responded to this record.
    const notMine = await call(api.app, "POST", W, {
      session: b.s.fin,
      headers: ifm(1),
      body: { reason: "Synthetic: not mine" },
    });
    expect([notMine.status, notMine.body.code, notMine.body.detail]).toEqual([
      403,
      "assessment_record.not_withdrawable_by_caller",
      "Only the respondent or a reviewer can withdraw this response.",
    ]);
    const aud = await call(api.app, "POST", W, {
      session: b.s.auditor,
      headers: ifm(1),
      body: { reason: "Synthetic" },
    });
    expect([aud.status, aud.body.code]).toEqual([403, "assessment_record.not_withdrawable_by_caller"]);
    expect((await call(api.app, "POST", W, { session: wl.session, body: { reason: "Synthetic" } })).status).toBe(428);
    expect(
      (await call(api.app, "POST", W, { session: wl.session, headers: ifm(2), body: { reason: "Synthetic" } })).status,
    ).toBe(409);
    const own = await call(api.app, "POST", W, {
      session: wl.session,
      headers: ifm(1),
      body: { reason: "Synthetic: wrong person observed" },
    });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body).toMatchObject({
      status: "withdrawn",
      withdrawnBy: wl.id,
      withdrawReason: "Synthetic: wrong person observed",
      version: 2,
    });
    expect(await countedObservations(groupId)).not.toContain(id);
    const task = await api.db
      .selectFrom("work_item")
      .select("status")
      .where("subject_id", "=", id)
      .executeTakeFirstOrThrow();
    expect(task.status).toBe("cancelled");
    const again = await call(api.app, "POST", W, { session: wl.session, headers: ifm(2), body: { reason: "Again" } });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "assessment_record.withdrawn",
      "This response is withdrawn and can no longer be changed.",
    ]);
    const review = await call(api.app, "POST", `${AR}/${id}/review`, { session: b.s.bo, headers: ifm(2), body: {} });
    expect([review.status, review.body.code]).toEqual([422, "assessment_record.withdrawn"]);
    // A reviewer withdraws someone else's (reviewed) record.
    const other2 = await observe();
    const reviewed = await call(api.app, "POST", `${AR}/${other2}/review`, {
      session: b.s.bo,
      headers: ifm(1),
      body: {},
    });
    expect(reviewed.status).toBe(200);
    const byReviewer = await call(api.app, "POST", `${AR}/${other2}/withdraw`, {
      session: b.s.bo,
      headers: ifm(2),
      body: { reason: "Synthetic: duplicate observation" },
    });
    expect([byReviewer.status, byReviewer.body.status, byReviewer.body.withdrawnBy]).toEqual([
      200,
      "withdrawn",
      b.users.bo.id,
    ]);
  });
});

describe("authorisation (ADR-0033 §9)", () => {
  it("AUD 403 on writes; ADM-only and outsiders 404; another transformation 404; commit-time 403", async () => {
    const body = {
      formId: profForm,
      stakeholderGroupId: groupId,
      subjectLabel: "Synthetic",
      observedOn: "2026-10-05",
      answers: { can_do: true },
    };
    expect((await call(api.app, "POST", AR, { session: b.s.auditor, body })).status).toBe(403);
    const id = (await call(api.app, "POST", AR, { session: wl.session, body })).body.id as string;
    expect(
      (await call(api.app, "POST", `${AR}/${id}/review`, { session: b.s.auditor, headers: ifm(1), body: {} })).status,
    ).toBe(403);
    expect((await call(api.app, "GET", AR, { session: b.s.auditor })).status).toBe(200);
    for (const session of [b.s.admin, b.s.outsider]) {
      expect((await call(api.app, "GET", AR, { session })).status).toBe(404);
      expect((await call(api.app, "GET", `${AR}/${id}`, { session })).status).toBe(404);
      expect((await call(api.app, "POST", AR, { session, body })).status).toBe(404);
      expect((await call(api.app, "POST", `${AR}/${id}/review`, { session, headers: ifm(1), body: {} })).status).toBe(
        404,
      );
      expect(
        (
          await call(api.app, "POST", `${AR}/${id}/withdraw`, {
            session,
            headers: ifm(1),
            body: { reason: "Synthetic" },
          })
        ).status,
      ).toBe(404);
    }
    expect((await call(api.app, "GET", `${other.base}/assessment-records/${id}`, { session: other.s.bo })).status).toBe(
      404,
    );
    const u = await extraUser(api, w, b, "BO");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", `${AR}/${id}/review`, { session: u.session, headers: ifm(1), body: {}, contract: false }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("assessment_record")
      .select(["status", "version"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "submitted", version: 1 });
    expect((await auditOf(api.db, id)).length).toBe(1);
  });

  it("commit-time 403 on a response and on the respondent's own withdrawal; nothing written", async () => {
    const body = {
      formId: profForm,
      stakeholderGroupId: groupId,
      subjectLabel: "Synthetic commit-time subject",
      observedOn: "2026-10-05",
      answers: { can_do: false },
    };
    const records = async () =>
      Number(
        (
          await api.db
            .selectFrom("assessment_record")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .where("transformation_id", "=", b.transformationId)
            .executeTakeFirstOrThrow()
        ).n,
      );
    // An assessor (WL: assessment.respond + proficiency.record) loses the grant between identity and commit.
    const assessor = await extraUser(api, w, b, "WL");
    const before = await records();
    const created = await afterIdentity(
      api,
      assessor.id,
      () => call(api.app, "POST", AR, { session: assessor.session, body, contract: false }),
      () => revokeAll(api, w.grantor.id, assessor.id),
    );
    expect(created.status).toBe(403);
    expect(await records()).toBe(before);
    // The respondent withdraws their own record, but loses the grant before commit.
    const respondent = await extraUser(api, w, b, "WL");
    const mine = await call(api.app, "POST", AR, { session: respondent.session, body });
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
    const withdrawn = await afterIdentity(
      api,
      respondent.id,
      () =>
        call(api.app, "POST", `${AR}/${mine.body.id}/withdraw`, {
          session: respondent.session,
          headers: ifm(1),
          body: { reason: "Synthetic: commit-time" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, respondent.id),
    );
    expect(withdrawn.status).toBe(403);
    const row = await api.db
      .selectFrom("assessment_record")
      .select(["status", "version"])
      .where("id", "=", mine.body.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "submitted", version: 1 });
    expect((await auditOf(api.db, mine.body.id)).length).toBe(1);
  });
});
