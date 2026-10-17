// T-DG5-BE-T5 (D-167, Rule A clarified; REQ-S06-003): a step that adopted the transformation T its organization-scope
// intake produced is read and acted on with T's authorization and the step's assignee role, through the API against
// the run's disposable PostgreSQL:
//  - T's Lead (TL on T only; nobody holds TL at organization scope for them) reads the instance and completes the
//    adopted `draft_charter`, links T's evidence to it (another transformation's evidence is refused), and the intake
//    goes on to `confirm_sponsor`;
//  - a user without TL on T is refused as for any other step: WL on T -> 403; TL on
//    another transformation -> 404 (existence not disclosed); nothing written;
//  - before the adoption, T's Lead cannot read the instance or act on `capture_intake` (404);
//  - the instance's other operations and its list keep organization scope: T's Lead cannot cancel it (404) or change an
//    input its step does not require (403), and does not see it in the instance list; the organization-scope Lead
//    lists and reads it unchanged and still completes an adopted step (organization-scope actors keep their rights).
// Every value is SYNTHETIC; nothing approves anything real and nothing touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const I = "/api/v1/procedure-instances";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const INPUTS = { transformationName: "Synthetic intake", caseForChange: "Synthetic case for change." };

let api: TestApi;
let w: World;
type Person = { id: string; session: Session };
let orgTl: Person;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const u = await createUser(api.db, w.orgA.id);
  // The organization-scope Lead captures the intake (the instance is organization-scope) and creates T in the BU.
  await grant(api.db, w.grantor.id, u.id, "TL", { type: "organization", id: w.orgA.id }, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  orgTl = { id: u.id, session: await signIn(api.app, u.subject) };
}, 180_000);
afterAll(() => api.close());

async function person(role: string, transformationId: string): Promise<Person> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: transformationId }, w.orgA.id);
  return { id: u.id, session: await signIn(api.app, u.subject) };
}

async function newTransformation(name: string): Promise<string> {
  const t = await call<Body>(api.app, "POST", "/api/v1/transformations", {
    session: orgTl.session,
    body: { businessUnitId: w.a1, name, mode: "end_to_end" },
  });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  return t.body.id as string;
}

async function launchIntake(): Promise<string> {
  const res = await call<Body>(api.app, "POST", I, {
    session: orgTl.session,
    body: { procedureCode: "new_transformation_intake", transformationId: null, inputValues: INPUTS },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

const get = (session: Session, id: string) => call<Body>(api.app, "GET", `${I}/${id}`, { session });
const complete = (session: Session, id: string, key: string, version: number, body: Body = {}) =>
  call<Body>(api.app, "POST", `${I}/${id}/steps/${key}/complete`, { session, headers: ifm(version), body });

async function charterOf(t: string, session: Session): Promise<string> {
  const c = await call<Body>(api.app, "POST", `/api/v1/transformations/${t}/charter`, { session, body: INPUTS });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  return (c.body.charter ?? c.body).id as string;
}

async function evidenceOf(t: string, owner: Person): Promise<string> {
  const e = await call<Body>(api.app, "POST", `/api/v1/transformations/${t}/evidence`, {
    session: owner.session,
    body: { kind: "note", title: "Synthetic step evidence", noteBody: "Synthetic", ownerUserId: owner.id },
  });
  expect(e.status, JSON.stringify(e.body)).toBe(201);
  return e.body.id as string;
}

/** The audit events of the instance and its steps (a refusal writes none of them). */
const auditOfInstance = async (instanceId: string) => {
  const ids = (
    await api.db
      .selectFrom("procedure_step_instance")
      .select("id")
      .where("procedure_instance_id", "=", instanceId)
      .execute()
  ).map((r) => r.id);
  return (
    await api.db
      .selectFrom("audit_event")
      .select("id")
      .where("record_id", "in", [instanceId, ...ids])
      .execute()
  ).length;
};

describe("D-167: an adopted step is read and acted on with T's authorization and its assignee role", () => {
  it("T's Lead completes draft_charter; a user without TL on T gets 403 or 404; other operations keep organization scope", async () => {
    const id = await launchIntake();
    const t = await newTransformation("Synthetic adopted intake");
    const lead = await person("TL", t);
    const wl = await person("WL", t);
    const otherLead = await person("TL", await newTransformation("Synthetic other transformation"));

    // Before the adoption: T's Lead neither reads the instance nor acts on the organization-scope capture step.
    expect((await get(lead.session, id)).status).toBe(404);
    expect((await complete(lead.session, id, "capture_intake", 1, { outputRecordId: t })).status).toBe(404);

    // The organization-scope Lead captures the intake: the later steps adopt T.
    const captured = await complete(orgTl.session, id, "capture_intake", 1, { outputRecordId: t });
    expect(captured.status, JSON.stringify(captured.body)).toBe(200);
    expect([captured.body.transformationId, captured.body.currentStepKeys]).toEqual([null, ["draft_charter"]]);

    // T's Lead reads the instance now (the read that acting on the adopted step needs).
    const seen = await get(lead.session, id);
    expect([seen.status, seen.body.version]).toEqual([200, captured.body.version]);
    // A user without TL on T: WL on T -> 403 not_assignee; TL elsewhere -> 404 (read and act). Nothing written.
    const charter = await charterOf(t, lead.session);
    const before = await auditOfInstance(id);
    const byWl = await complete(wl.session, id, "draft_charter", seen.body.version, { outputRecordId: charter });
    // WL holds no procedure.act on T (403 forbidden); a role holder that is not TL would get not_assignee (403).
    expect(byWl.status).toBe(403);
    expect(["forbidden", "procedure_step.not_assignee"]).toContain(byWl.body.code);
    expect((await get(otherLead.session, id)).status).toBe(404);
    const byOther = await complete(otherLead.session, id, "draft_charter", seen.body.version, {
      outputRecordId: charter,
    });
    expect(byOther.status).toBe(404);
    // The refusals wrote nothing on the instance or its steps.
    const steps = await api.db
      .selectFrom("procedure_step_instance")
      .select(["step_key", "status", "version"])
      .where("procedure_instance_id", "=", id)
      .orderBy("ordinal")
      .execute();
    expect(steps.map((s) => [s.step_key, s.status])).toEqual([
      ["capture_intake", "completed"],
      ["draft_charter", "active"],
      ["confirm_sponsor", "pending"],
    ]);
    expect(await auditOfInstance(id)).toBe(before);

    // The instance's other operations keep organization scope: cancel 404; an input its step does not require 403.
    const cancel = await call<Body>(api.app, "POST", `${I}/${id}/cancel`, {
      session: lead.session,
      headers: ifm(seen.body.version),
      body: { reason: "Synthetic" },
    });
    expect(cancel.status).toBe(404);
    const input = await call<Body>(api.app, "PATCH", `${I}/${id}/inputs`, {
      session: lead.session,
      headers: ifm(seen.body.version),
      body: { inputValues: { transformationName: "Synthetic renamed" } },
    });
    expect([input.status, input.body.code]).toEqual([403, "procedure_step.not_assignee"]);
    // ... and the list: T's Lead does not list the organization-scope instance.
    const listed = await call<Body>(api.app, "GET", `${I}?limit=100`, { session: lead.session });
    expect((listed.body.items ?? []).map((x: Body) => x.id)).not.toContain(id);

    // Evidence of the step is evidence of T: another transformation's is refused; T's is linked.
    const otherT = (
      await api.db
        .selectFrom("transformation")
        .select("id")
        .where("id", "<>", t)
        .where("organization_id", "=", w.orgA.id)
        .executeTakeFirstOrThrow()
    ).id;
    const foreign = await evidenceOf(otherT, await person("TL", otherT));
    const wrong = await call<Body>(api.app, "POST", `${I}/${id}/steps/draft_charter/evidence`, {
      session: lead.session,
      headers: ifm(seen.body.version),
      body: { evidenceId: foreign },
    });
    expect([wrong.status, wrong.body.code]).toEqual([422, "procedure_step.output_record_invalid"]);
    const linked = await call<Body>(api.app, "POST", `${I}/${id}/steps/draft_charter/evidence`, {
      session: lead.session,
      headers: ifm(seen.body.version),
      body: { evidenceId: await evidenceOf(t, lead) },
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);

    // T's Lead completes the adopted draft_charter (If-Match on the instance; 409 when stale).
    const stale = await complete(lead.session, id, "draft_charter", seen.body.version, { outputRecordId: charter });
    expect(stale.status).toBe(409);
    const done = await complete(lead.session, id, "draft_charter", linked.body.version, { outputRecordId: charter });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.currentStepKeys).toEqual(["confirm_sponsor"]);
    const audit = await api.db
      .selectFrom("audit_event")
      .select(["actor_user_id", "transformation_id"])
      .where("record_type", "=", "procedure_step_instance")
      .where("action", "=", "procedure_step_instance.complete")
      .where("actor_user_id", "=", lead.id)
      .execute();
    expect(audit).toHaveLength(1);
  });

  it("the organization-scope Lead keeps its rights: lists and reads the instance, and completes an adopted step", async () => {
    const id = await launchIntake();
    const t = await newTransformation("Synthetic adopted intake, organization actor");
    const c1 = await complete(orgTl.session, id, "capture_intake", 1, { outputRecordId: t });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    const listed = await call<Body>(api.app, "GET", `${I}?limit=100`, { session: orgTl.session });
    expect(listed.status).toBe(200);
    expect((listed.body.items as Body[]).map((x) => x.id)).toContain(id);
    expect((await get(orgTl.session, id)).status).toBe(200);
    const c2 = await complete(orgTl.session, id, "draft_charter", c1.body.version, {
      outputRecordId: await charterOf(t, orgTl.session),
    });
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    expect(c2.body.currentStepKeys).toEqual(["confirm_sponsor"]);
  });
});
