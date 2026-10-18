// F-DG5-101 (REQ-S06-002; D-170; T-DG5-BE-V2): a step's output must be a record the acting person may read. Every
// output adapter (procedures/outputs/kit.ts) requires the acting principal's read permission of the named record's
// type in that record's own scope (transformation.read on the record's transformation, through the same resolver the
// record's GET uses), on grants reloaded inside the completing transaction. Otherwise the completion is refused
// exactly like an unknown record (422 procedure_step.output_record_invalid, no disclosure): nothing is linked and,
// for an intake, nothing is adopted (D-166 Rule A only follows a valid link). The refusal is audited as the existing
// `authorization.denied` failed-mutation event (denials.ts; ADR-0004), never as a new event type.
//
// The first test is the code-security reviewer's round-1 reproduction
// (docs/delivery/test-evidence/DG5/code-security/round-1/repro/intake-foreign-transformation.test.ts), kept with its
// final assertion, plus the post-conditions the finding expects. Against the round-1 candidate it failed with
// [200, undefined]. Every value is SYNTHETIC; no business approval is decided here, and nothing relates to DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { charterOutput } from "../../../src/modules/procedures/outputs/transformations.ts";
import {
  registerProcedureOutputAdapter,
  unregisterProcedureOutputAdapter,
} from "../../../src/modules/procedures/steps.ts";
import {
  auditOfRequest,
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
const INVALID = "procedure_step.output_record_invalid";
const INVALID_DETAIL = "The linked record is not of the expected type or not in this scope.";

let api: TestApi;
let w: World;
let tl1: { id: string; session: Session };
let tl2: { id: string; session: Session };

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  // TL1: as in intake-adoption.test.ts (TL in the organization, and at BU a1).
  const u1 = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u1.id, "TL", { type: "organization", id: w.orgA.id }, w.orgA.id);
  await grant(api.db, w.grantor.id, u1.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  tl1 = { id: u1.id, session: await signIn(api.app, u1.subject) };
  // TL2: another business unit (a2) only.
  const u2 = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u2.id, "TL", { type: "business_unit", id: w.a2 }, w.orgA.id);
  tl2 = { id: u2.id, session: await signIn(api.app, u2.subject) };
}, 180_000);
afterAll(() => api.close());

const complete = (session: Session, id: string, key: string, version: number, body: Body = {}) =>
  call<Body>(api.app, "POST", `${I}/${id}/steps/${key}/complete`, { session, headers: ifm(version), body });

async function launchIntake(): Promise<string> {
  const launched = await call<Body>(api.app, "POST", I, {
    session: tl1.session,
    body: { procedureCode: "new_transformation_intake", transformationId: null, inputValues: INPUTS },
  });
  expect(launched.status, JSON.stringify(launched.body)).toBe(201);
  return launched.body.id as string;
}

async function newTransformation(session: Session, businessUnitId: string, name: string): Promise<string> {
  const t = await call<Body>(api.app, "POST", "/api/v1/transformations", {
    session,
    body: { businessUnitId, name, mode: "end_to_end" },
  });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  return t.body.id as string;
}

const stepRows = (id: string) =>
  api.db
    .selectFrom("procedure_step_instance")
    .select(["step_key", "status", "transformation_id"])
    .where("procedure_instance_id", "=", id)
    .orderBy("ordinal")
    .execute();

const outputLinks = (id: string) =>
  api.db
    .selectFrom("procedure_instance_link")
    .select(["record_type", "record_id"])
    .where("procedure_instance_id", "=", id)
    .where("link_kind", "=", "output")
    .execute();

/** The refused completion's audit: exactly the failed-mutation `authorization.denied`, no domain or link event. */
async function expectDeniedAudit(requestId: string, transformationId: string): Promise<void> {
  const rows = await auditOfRequest(api.db, requestId);
  expect(rows.map((r) => [r.action, r.record_type, r.record_id, r.transformation_id])).toEqual([
    ["authorization.denied", "transformation", transformationId, transformationId],
  ]);
  expect(rows[0]!.reason).toContain("requires transformation.read");
}

describe("F-DG5-101: an intake claims a transformation its actor cannot read", () => {
  it("capture_intake naming another BU's transformation should be refused (422 output_record_invalid)", async () => {
    const id = await launchIntake();

    // After the launch, TL2 creates X in BU a2.
    const X = await newTransformation(tl2.session, w.a2, "Synthetic foreign transformation X");

    // TL1 cannot read X.
    const read = await call<Body>(api.app, "GET", `/api/v1/transformations/${X}`, { session: tl1.session });
    expect(read.status).toBe(404);

    // TL1 completes capture_intake naming X.
    const c1 = await complete(tl1.session, id, "capture_intake", 1, { outputRecordId: X });

    // The reviewer's final assertion (kept).
    expect([c1.status, c1.body?.code]).toEqual([422, "procedure_step.output_record_invalid"]);

    // Refused exactly like an unknown record: the same body text, nothing that names or discloses X.
    expect(c1.body.detail).toBe(INVALID_DETAIL);
    expect(JSON.stringify(c1.body)).not.toContain(X);
    const unknown = await complete(tl1.session, id, "capture_intake", 1, {
      outputRecordId: "01920000-0000-7000-8000-00000000dead",
    });
    expect([unknown.status, unknown.body.code, unknown.body.detail]).toEqual([422, INVALID, INVALID_DETAIL]);
    expect(Object.keys(c1.body).sort()).toEqual(Object.keys(unknown.body).sort());

    // Nothing is linked and nothing is adopted; the instance did not move.
    expect(await outputLinks(id)).toEqual([]);
    expect((await stepRows(id)).map((s) => [s.step_key, s.status, s.transformation_id])).toEqual([
      ["capture_intake", "active", null],
      ["draft_charter", "pending", null],
      ["confirm_sponsor", "pending", null],
    ]);
    const after = await call<Body>(api.app, "GET", `${I}/${id}`, { session: tl1.session });
    expect([after.body.version, after.body.currentStepKeys]).toEqual([1, ["capture_intake"]]);

    // X's own lead still cannot read TL1's intake (no adopted step points into X).
    const seen = await call<Body>(api.app, "GET", `${I}/${id}`, { session: tl2.session });
    expect(seen.status).toBe(404);

    // Audited as the existing failed-mutation event on the existing target; an unknown record writes none.
    await expectDeniedAudit(c1.body.requestId as string, X);
    expect(await auditOfRequest(api.db, unknown.body.requestId as string)).toEqual([]);
  });

  it("positive: TL1 names a transformation it can read; it is linked and the later steps adopt it", async () => {
    const id = await launchIntake();
    const T = await newTransformation(tl1.session, w.a1, "Synthetic readable transformation T");
    expect((await call<Body>(api.app, "GET", `/api/v1/transformations/${T}`, { session: tl1.session })).status).toBe(
      200,
    );
    const c1 = await complete(tl1.session, id, "capture_intake", 1, { outputRecordId: T });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(c1.body.currentStepKeys).toEqual(["draft_charter"]);
    expect(await outputLinks(id)).toEqual([{ record_type: "transformation", record_id: T }]);
    expect((await stepRows(id)).map((s) => [s.step_key, s.status, s.transformation_id])).toEqual([
      ["capture_intake", "completed", null],
      ["draft_charter", "active", T],
      ["confirm_sponsor", "pending", T],
    ]);
  });
});

describe("F-DG5-101: every output adapter requires read on the named record (charter)", () => {
  it("draft_charter naming a charter the actor can no longer read is refused at commit time; nothing is linked", async () => {
    const id = await launchIntake();
    const T = await newTransformation(tl1.session, w.a1, "Synthetic charter transformation");
    const c1 = await complete(tl1.session, id, "capture_intake", 1, { outputRecordId: T });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    const drafted = await call<Body>(api.app, "POST", `/api/v1/transformations/${T}/charter`, {
      session: tl1.session,
      body: INPUTS,
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    const charter = await api.db
      .selectFrom("charter")
      .select("id")
      .where("transformation_id", "=", T)
      .executeTakeFirstOrThrow();

    // TL1's transformation-scope grant (the creator's, derived from BU a1) and the BU grant are revoked: TL1 still
    // acts on the instance at organization scope (TL there), but can no longer read T or its charter.
    await api.db
      .updateTable("scoped_assignment")
      .set({ revoked_at: new Date(), revoked_by: w.grantor.id, revoke_reason: "Synthetic revocation" })
      .where("user_id", "=", tl1.id)
      .where("scope_type", "in", ["transformation", "business_unit"])
      .where("revoked_at", "is", null)
      .execute();
    expect((await call<Body>(api.app, "GET", `/api/v1/transformations/${T}`, { session: tl1.session })).status).toBe(
      404,
    );

    const c2 = await complete(tl1.session, id, "draft_charter", c1.body.version, { outputRecordId: charter.id });
    expect([c2.status, c2.body.code, c2.body.detail]).toEqual([422, INVALID, INVALID_DETAIL]);
    expect(JSON.stringify(c2.body)).not.toContain(charter.id);
    expect(await outputLinks(id)).toEqual([{ record_type: "transformation", record_id: T }]);
    expect((await stepRows(id)).map((s) => [s.step_key, s.status])).toEqual([
      ["capture_intake", "completed"],
      ["draft_charter", "active"],
      ["confirm_sponsor", "pending"],
    ]);
    await expectDeniedAudit(c2.body.requestId as string, T);

    // The engine's generic `link` (no adapter registered for the type) applies the same rule.
    unregisterProcedureOutputAdapter("charter");
    try {
      const generic = await complete(tl1.session, id, "draft_charter", c1.body.version, {
        outputRecordId: charter.id,
      });
      expect([generic.status, generic.body.code, generic.body.detail]).toEqual([422, INVALID, INVALID_DETAIL]);
      await expectDeniedAudit(generic.body.requestId as string, T);
    } finally {
      registerProcedureOutputAdapter(charterOutput);
    }
    expect(await outputLinks(id)).toEqual([{ record_type: "transformation", record_id: T }]);

    // Restored read: the same completion now links the charter (the refusal was the read, nothing else).
    await grant(api.db, w.grantor.id, tl1.id, "TL", { type: "transformation", id: T }, w.orgA.id);
    const c3 = await complete(tl1.session, id, "draft_charter", c1.body.version, { outputRecordId: charter.id });
    expect(c3.status, JSON.stringify(c3.body)).toBe(200);
    expect(await outputLinks(id)).toEqual(expect.arrayContaining([{ record_type: "charter", record_id: charter.id }]));
  });
});
