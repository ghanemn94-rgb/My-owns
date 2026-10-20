// code-security-reviewer DG5 round 1 reproduction (NOT product code; run only in a disposable clone, copied to
// apps/api/test/integration/procedures/zz-sec-r1-intake-foreign.test.ts). Synthetic data only.
//
// Claim: the `create` output check of procedures/outputs/kit.ts (inScope + producedHere) accepts, as the output of an
// organization-scope `new_transformation_intake` instance's `capture_intake` step, ANY transformation of the
// organization created after the launch and not yet another instance's output. It never checks that the acting person
// can read that transformation. With D-166 Rule A (0096) the instance's remaining steps then adopt it. So a TL who
// acts at organization scope (TL does not inherit downward) can claim a transformation of another business unit that
// they cannot read: the intake's steps move into it, its readers see the intake, and its own intake can no longer
// take it as output ("not already another instance's output").
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

describe("SEC-R1 repro: an intake claims a transformation its actor cannot read", () => {
  it("capture_intake naming another BU's transformation should be refused (422 output_record_invalid)", async () => {
    const launched = await call<Body>(api.app, "POST", I, {
      session: tl1.session,
      body: { procedureCode: "new_transformation_intake", transformationId: null, inputValues: INPUTS },
    });
    expect(launched.status, JSON.stringify(launched.body)).toBe(201);
    const id = launched.body.id as string;

    // After the launch, TL2 creates X in BU a2.
    const x = await call<Body>(api.app, "POST", "/api/v1/transformations", {
      session: tl2.session,
      body: { businessUnitId: w.a2, name: "Synthetic foreign transformation X", mode: "end_to_end" },
    });
    expect(x.status, JSON.stringify(x.body)).toBe(201);
    const X = x.body.id as string;

    // TL1 cannot read X.
    const read = await call<Body>(api.app, "GET", `/api/v1/transformations/${X}`, { session: tl1.session });
    console.log("TL1 GET X ->", read.status);
    expect(read.status).toBe(404);

    // TL1 completes capture_intake naming X.
    const c1 = await call<Body>(api.app, "POST", `${I}/${id}/steps/capture_intake/complete`, {
      session: tl1.session,
      headers: ifm(1),
      body: { outputRecordId: X },
    });
    console.log("TL1 capture_intake with X ->", c1.status, c1.body?.code ?? "");
    const steps = await api.db
      .selectFrom("procedure_step_instance")
      .select(["step_key", "status", "transformation_id"])
      .where("procedure_instance_id", "=", id)
      .orderBy("ordinal")
      .execute();
    console.log("steps after:", JSON.stringify(steps.map((s) => [s.step_key, s.status, s.transformation_id === X ? "X" : s.transformation_id])));
    const link = await api.db
      .selectFrom("procedure_instance_link")
      .select(["record_type", "record_id", "link_kind"])
      .where("procedure_instance_id", "=", id)
      .execute();
    console.log("links:", JSON.stringify(link.map((l) => [l.link_kind, l.record_type, l.record_id === X ? "X" : l.record_id])));

    // TL2 (X's own lead) now reads TL1's intake through the adopted steps (D-167).
    const seen = await call<Body>(api.app, "GET", `${I}/${id}`, { session: tl2.session });
    console.log("TL2 GET TL1's intake ->", seen.status);

    expect([c1.status, c1.body?.code]).toEqual([422, "procedure_step.output_record_invalid"]);
  });
});
