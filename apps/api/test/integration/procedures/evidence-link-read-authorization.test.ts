// F-DG5-101's rule on the evidence link (D-170; REQ-S06-002; T-DG5-BE-V2B): a person never links a record they cannot
// read. `POST /procedure-instances/{id}/steps/{key}/evidence` (linkProcedureStepEvidence) names an evidence record by
// id and writes a procedure_instance_link to it. On an adopted step (D-167) the path already requires the evidence to
// belong to T, the step's transformation; it now also requires the acting person's read of the evidence in its own
// scope (transformation.read on the evidence's transformation, the evidence GET's own read gate), on the grants
// reloaded inside the linking transaction, after the instance and step locks. Otherwise the link is refused exactly
// like an unknown evidence record (422 procedure_step.output_record_invalid, the same body): nothing is linked, and the
// refusal is audited as the existing `authorization.denied` failed-mutation event (no new event type).
// Every value is SYNTHETIC; no business approval is decided here, and nothing relates to DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const UNKNOWN_EVIDENCE = "01920000-0000-7000-8000-00000000beef";

let api: TestApi;
let w: World;
type Person = { id: string; session: Session };

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 180_000);
afterAll(() => api.close());

/** An organization-scope Lead (TL in the organization, and at BU a1, so it can create and read T there). */
async function orgLead(): Promise<Person> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "TL", { type: "organization", id: w.orgA.id }, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  return { id: u.id, session: await signIn(api.app, u.subject) };
}

const readT = (p: Person, t: string) =>
  call<Body>(api.app, "GET", `/api/v1/transformations/${t}`, { session: p.session });

const linkEvidence = (p: Person, id: string, key: string, version: number, evidenceId: string) =>
  call<Body>(api.app, "POST", `${I}/${id}/steps/${key}/evidence`, {
    session: p.session,
    headers: ifm(version),
    body: { evidenceId },
  });

const evidenceLinks = (id: string) =>
  api.db
    .selectFrom("procedure_instance_link")
    .select(["record_type", "record_id"])
    .where("procedure_instance_id", "=", id)
    .where("link_kind", "=", "evidence")
    .execute();

/**
 * The intake launched and captured by `p`, so its later steps adopt T (D-166 Rule A), and one evidence record of T
 * written by `p`. Returns the instance, T, the evidence and the instance version after the capture.
 */
async function adoptedIntakeWithEvidence(p: Person) {
  const launched = await call<Body>(api.app, "POST", I, {
    session: p.session,
    body: { procedureCode: "new_transformation_intake", transformationId: null, inputValues: INPUTS },
  });
  expect(launched.status, JSON.stringify(launched.body)).toBe(201);
  const id = launched.body.id as string;
  const t = await call<Body>(api.app, "POST", "/api/v1/transformations", {
    session: p.session,
    body: { businessUnitId: w.a1, name: "Synthetic evidence transformation", mode: "end_to_end" },
  });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  const T = t.body.id as string;
  const captured = await call<Body>(api.app, "POST", `${I}/${id}/steps/capture_intake/complete`, {
    session: p.session,
    headers: ifm(1),
    body: { outputRecordId: T },
  });
  expect(captured.status, JSON.stringify(captured.body)).toBe(200);
  expect(captured.body.currentStepKeys).toEqual(["draft_charter"]);
  const e = await call<Body>(api.app, "POST", `/api/v1/transformations/${T}/evidence`, {
    session: p.session,
    body: { kind: "note", title: "Synthetic step evidence", noteBody: "Synthetic", ownerUserId: p.id },
  });
  expect(e.status, JSON.stringify(e.body)).toBe(201);
  return { id, T, evidenceId: e.body.id as string, version: captured.body.version as number };
}

/** Revokes `p`'s transformation-scope and BU grants: `p` still acts at organization scope, but cannot read T. */
async function revokeReadOfT(p: Person, T: string): Promise<void> {
  await api.db
    .updateTable("scoped_assignment")
    .set({ revoked_at: new Date(), revoked_by: w.grantor.id, revoke_reason: "Synthetic revocation" })
    .where("user_id", "=", p.id)
    .where("scope_type", "in", ["transformation", "business_unit"])
    .where("revoked_at", "is", null)
    .execute();
  expect((await readT(p, T)).status).toBe(404);
}

describe("F-DG5-101 rule on the evidence link: a person never links evidence they cannot read", () => {
  it("an organization-scope actor who cannot read T links T's evidence: refused like an unknown record, nothing linked", async () => {
    const lead = await orgLead();
    const { id, T, evidenceId, version } = await adoptedIntakeWithEvidence(lead);
    await revokeReadOfT(lead, T);
    // The actor still reaches the adopted step through its organization scope (the instance is readable to it).
    expect((await call<Body>(api.app, "GET", `${I}/${id}`, { session: lead.session })).status).toBe(200);

    const refused = await linkEvidence(lead, id, "draft_charter", version, evidenceId);
    expect([refused.status, refused.body?.code, refused.body?.detail]).toEqual([422, INVALID, INVALID_DETAIL]);
    expect(JSON.stringify(refused.body)).not.toContain(evidenceId);
    expect(JSON.stringify(refused.body)).not.toContain(T);

    // The same answer as an evidence record that does not exist (the same code, detail and problem keys).
    const unknown = await linkEvidence(lead, id, "draft_charter", version, UNKNOWN_EVIDENCE);
    expect([unknown.status, unknown.body.code, unknown.body.detail]).toEqual([422, INVALID, INVALID_DETAIL]);
    expect(Object.keys(refused.body).sort()).toEqual(Object.keys(unknown.body).sort());

    // Nothing is linked; the instance did not move.
    expect(await evidenceLinks(id)).toEqual([]);
    const after = await call<Body>(api.app, "GET", `${I}/${id}`, { session: lead.session });
    expect([after.body.version, after.body.currentStepKeys]).toEqual([version, ["draft_charter"]]);

    // Audited as the existing failed-mutation event on the existing target; an unknown record writes none.
    const rows = await auditOfRequest(api.db, refused.body.requestId as string);
    expect(rows.map((r) => [r.action, r.record_type, r.record_id, r.transformation_id])).toEqual([
      ["authorization.denied", "transformation", T, T],
    ]);
    expect(rows[0]!.reason).toContain("requires transformation.read");
    expect(await auditOfRequest(api.db, unknown.body.requestId as string)).toEqual([]);

    // Read restored on T: the same request now links the evidence (the refusal was the read, nothing else).
    await grant(api.db, w.grantor.id, lead.id, "TL", { type: "transformation", id: T }, w.orgA.id);
    const linked = await linkEvidence(lead, id, "draft_charter", version, evidenceId);
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(await evidenceLinks(id)).toEqual([{ record_type: "evidence", record_id: evidenceId }]);
  });

  it("positive: an organization-scope actor who can read T links T's evidence to the adopted step", async () => {
    const lead = await orgLead();
    const { id, T, evidenceId, version } = await adoptedIntakeWithEvidence(lead);
    expect((await readT(lead, T)).status).toBe(200);
    const linked = await linkEvidence(lead, id, "draft_charter", version, evidenceId);
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.version).toBe(version + 1);
    expect(await evidenceLinks(id)).toEqual([{ record_type: "evidence", record_id: evidenceId }]);
    const rows = await auditOfRequest(api.db, linked.headers["x-request-id"] as string);
    expect(rows.map((r) => r.action)).toContain("procedure_instance_link.evidence");
    expect(rows.map((r) => r.action)).not.toContain("authorization.denied");
  });
});
