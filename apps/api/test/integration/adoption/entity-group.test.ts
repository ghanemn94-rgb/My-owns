// REQ-S16-020 A11, the people and adoption entity group (T-DG4-BE-H2; ADR-0033 §11; D-102 (3)): "an integration test
// creates and reads each one through the API with authorization enforced". This file covers StakeholderGroup,
// AdoptionIntervention and Training/AssessmentRecord (a training record and an assessment record); KBE-F adds the
// AdoptionMetricLink case in its own file (D-102: the two tasks run concurrently). For each entity, through the API:
// create (201) and read back (200, with its primary key, owner and status), AUD 403 on the write with nothing written,
// and 404 outside scope (an ADM-only user, an outsider, and the same id under another transformation).
// All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let other: BenefitWorld;
let wl: Awaited<ReturnType<typeof extraUser>>;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  other = await seedBenefitWorld(api, w);
  wl = await extraUser(api, w, b, "WL");
}, 90_000);
afterAll(async () => {
  await api.close();
}, 60_000);

/** Rows of `table` in the transformation: an AUD write must leave the count unchanged. */
const count = async (table: "stakeholder_group" | "adoption_intervention" | "training_record" | "assessment_record") =>
  Number(
    (
      await api.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("transformation_id", "=", b.transformationId)
        .executeTakeFirstOrThrow()
    ).n,
  );

/** The scope checks of a read: ADM-only and outsider 404, and 404 for the id under another transformation. */
async function outsideScope(collection: string, single: string | null, otherSingle: string | null) {
  for (const session of [b.s.admin, b.s.outsider]) {
    expect((await call(api.app, "GET", collection, { session })).status).toBe(404);
    if (single !== null) expect((await call(api.app, "GET", single, { session })).status).toBe(404);
  }
  if (otherSingle !== null) expect((await call(api.app, "GET", otherSingle, { session: other.s.bo })).status).toBe(404);
}

describe("REQ-S16-020 A11: create and read each entity through the API with authorization enforced", () => {
  let groupId: string;

  it("StakeholderGroup: primary key, owner and status; AUD 403; 404 outside scope", async () => {
    const SG = `${b.base}/stakeholder-groups`;
    const body = {
      name: "Synthetic billing analysts",
      impact: "H",
      influence: "L",
      currentStance: "support",
      requiredBehavior: "Synthetic: raise disputes in the new portal",
      interventionTypes: ["comms"],
      ownerUserId: b.users.bo.id,
    };
    const before = await count("stakeholder_group");
    expect((await call(api.app, "POST", SG, { session: b.s.auditor, body })).status).toBe(403);
    expect(await count("stakeholder_group")).toBe(before);
    const c = await call(api.app, "POST", SG, { session: b.s.tl, body });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    groupId = c.body.id;
    const r = await call(api.app, "GET", `${SG}/${groupId}`, { session: b.s.auditor });
    expect([r.status, r.body.id, r.body.ownerUserId, r.body.status]).toEqual([200, groupId, b.users.bo.id, "active"]);
    await outsideScope(SG, `${SG}/${groupId}`, `${other.base}/stakeholder-groups/${groupId}`);
  });

  it("AdoptionIntervention: primary key, owner and status; AUD 403; 404 outside scope", async () => {
    const AI = `${b.base}/adoption-interventions`;
    const body = {
      stakeholderGroupId: groupId,
      interventionType: "training",
      title: "Synthetic portal walkthrough",
      ownerUserId: wl.id,
      dueDate: "2026-11-15",
    };
    const before = await count("adoption_intervention");
    expect((await call(api.app, "POST", AI, { session: b.s.auditor, body })).status).toBe(403);
    expect(await count("adoption_intervention")).toBe(before);
    const c = await call(api.app, "POST", AI, { session: b.s.tl, body });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const r = await call(api.app, "GET", `${AI}/${c.body.id}`, { session: b.s.auditor });
    expect([r.status, r.body.id, r.body.ownerUserId, r.body.status]).toEqual([200, c.body.id, wl.id, "planned"]);
    await outsideScope(AI, `${AI}/${c.body.id}`, `${other.base}/adoption-interventions/${c.body.id}`);
  });

  it("Training record (Training/AssessmentRecord): primary key, owner (recorded_by) and status; AUD 403; 404", async () => {
    const TR = `${b.base}/training-records`;
    const body = { stakeholderGroupId: groupId, participantUserId: b.users.fin.id, trainingTitle: "Synthetic portal" };
    const before = await count("training_record");
    expect((await call(api.app, "POST", TR, { session: b.s.auditor, body })).status).toBe(403);
    expect(await count("training_record")).toBe(before);
    const c = await call(api.app, "POST", TR, { session: b.s.bo, body });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const done = await call(api.app, "PATCH", `${TR}/${c.body.id}`, {
      session: b.s.bo,
      headers: ifm(1),
      body: { status: "completed", completedOn: "2026-10-23" },
    });
    expect(done.status).toBe(200);
    expect(
      (
        await call(api.app, "PATCH", `${TR}/${c.body.id}`, {
          session: b.s.auditor,
          headers: ifm(2),
          body: { status: "withdrawn" },
        })
      ).status,
    ).toBe(403);
    // The contract has no single-record read for training: the list is the read.
    const r = await call(api.app, "GET", `${TR}?stakeholderGroupId=${groupId}`, { session: b.s.auditor });
    expect(r.status).toBe(200);
    const row = r.body.items.find((x: { id: string }) => x.id === c.body.id);
    expect([row.id, row.recordedBy, row.status]).toEqual([c.body.id, b.users.bo.id, "completed"]);
    await outsideScope(TR, null, null);
    // Under another transformation the record is never listed, and its update is 404.
    const foreign = await call(api.app, "GET", `${other.base}/training-records?stakeholderGroupId=${groupId}`, {
      session: other.s.bo,
    });
    expect([foreign.status, foreign.body.items]).toEqual([200, []]);
    expect(
      (
        await call(api.app, "PATCH", `${other.base}/training-records/${c.body.id}`, {
          session: other.s.bo,
          headers: ifm(2),
          body: { status: "withdrawn" },
        })
      ).status,
    ).toBe(404);
  });

  it("Assessment record (Training/AssessmentRecord): primary key, owner (respondent) and status; AUD 403; 404", async () => {
    const form = await call(api.app, "POST", `${b.base}/assessment-forms`, {
      session: b.s.bo,
      body: {
        kind: "proficiency_assessment",
        name: "Synthetic portal proficiency",
        stakeholderGroupId: groupId,
        schema: {
          questions: [
            {
              key: "level",
              type: "scale",
              label_en: "Level",
              label_ar: "المستوى",
              required: true,
              min: 1,
              max: 5,
              proficiency: true,
              pass_min: 3,
            },
          ],
        },
      },
    });
    expect(form.status, JSON.stringify(form.body)).toBe(201);
    expect(
      (
        await call(api.app, "POST", `${b.base}/assessment-forms/${form.body.id}/publish`, {
          session: b.s.bo,
          headers: ifm(2),
        })
      ).status,
    ).toBe(200);
    const AR = `${b.base}/assessment-records`;
    const body = {
      formId: form.body.id,
      stakeholderGroupId: groupId,
      subjectUserId: b.users.fin.id,
      observedOn: "2026-10-24",
      answers: { level: 3 },
    };
    const before = await count("assessment_record");
    expect((await call(api.app, "POST", AR, { session: b.s.auditor, body })).status).toBe(403);
    expect(await count("assessment_record")).toBe(before);
    const c = await call(api.app, "POST", AR, { session: wl.session, body });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const r = await call(api.app, "GET", `${AR}/${c.body.id}`, { session: b.s.auditor });
    expect([r.status, r.body.id, r.body.respondentUserId, r.body.status, r.body.proficiencyResult]).toEqual([
      200,
      c.body.id,
      wl.id,
      "submitted",
      "proficient",
    ]);
    await outsideScope(AR, `${AR}/${c.body.id}`, `${other.base}/assessment-records/${c.body.id}`);
  });
});
