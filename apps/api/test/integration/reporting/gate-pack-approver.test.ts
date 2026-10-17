// T-DG5-KBE-D4 (D-164 c; BE-C3 handback §5.1; ADR-0039 §3, ADR-0045 §3) against a real PostgreSQL: the gate pack
// names the EFFECTIVE approver of the gate, the one its submissions are routed to:
//  - a new transformation pinned to a methodology version whose G3 default approver is BO prints BO for its G3 pack
//    without a submission (through reporting's WorkflowsReadPort, wired in server.ts to workflows'
//    `effectiveGateApprover`), although the stored `gate_instance.approver_role_code` is still the catalogue's SP;
//  - with a submission, the pack prints the submission's recorded approver, ahead of the port's answer;
//  - a v1-pinned transformation's pack is unchanged (SP);
//  - an unwired port (null) falls back to the stored value.
// All data is SYNTHETIC. Product gates G1-G6 are business approvals inside the product; the G1 submission below is a
// demo action on synthetic data and approves nothing real. Nothing here touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setWorkflowsReadPort, workflowsReadPort } from "../../../src/modules/reporting/ports.ts";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { gateVersion, ifm, makeG1Ready, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { freshKey, pinFixture, seedPublishedVersion } from "../methodology/migration-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let v1: string;
let v2: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const key = freshKey("methodology");
  v1 = await seedPublishedVersion(api, "methodology", key, 1);
  // The synthetic newer version: G3's default approver BO (inside its DG2 allowed set {SP, BO}).
  v2 = await seedPublishedVersion(api, "methodology", key, 2, [
    { elementType: "gate", stableKey: "G3", attributes: { defaultApproverRoleCode: "BO" } },
  ]);
}, 120_000);
afterAll(() => api.close());

const T = (p: P2World) => `/api/v1/transformations/${p.transformationId}`;

/** A P2 world pinned to `versionId` (as if created on it). */
async function worldOn(versionId: string): Promise<P2World> {
  const p = await setupP2World(api, w);
  await pinFixture(api, {
    organizationId: w.orgA.id,
    transformationId: p.transformationId,
    kind: "methodology",
    versionId,
    by: p.lead.id,
  });
  return p;
}

const gateId = async (p: P2World, code: string): Promise<string> =>
  (
    await api.db
      .selectFrom("gate_instance")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .where("gate_code", "=", code)
      .executeTakeFirstOrThrow()
  ).id;

const storedRole = async (p: P2World, code: string): Promise<string> =>
  (
    await api.db
      .selectFrom("gate_instance")
      .select("approver_role_code")
      .where("transformation_id", "=", p.transformationId)
      .where("gate_code", "=", code)
      .executeTakeFirstOrThrow()
  ).approver_role_code;

/** The live gate pack's `approver_role` field and the pack's subject code. */
async function packApprover(p: P2World, code: string): Promise<{ value: Body; subjectCode: string }> {
  const r = await call<Body>(api.app, "GET", `${T(p)}/reports/gate_pack/live?subjectId=${await gateId(p, code)}`, {
    session: p.lead.session,
  });
  expect(r.status, JSON.stringify(r.body).slice(0, 800)).toBe(200);
  const gate = r.body.document.sections.find((s: Body) => s.key === "gate");
  return {
    value: gate.fields.find((f: Body) => f.key === "approver_role").value,
    subjectCode: r.body.document.subject.code,
  };
}

describe("D-164 c: the gate pack names the effective approver", () => {
  it("a new transformation pinned to the BO version: its G3 pack prints BO without a submission (stored row is SP)", async () => {
    const p = await worldOn(v2);
    expect(await storedRole(p, "G3")).toBe("SP");
    const g3 = await packApprover(p, "G3");
    expect(g3.subjectCode).toBe("G3");
    expect(g3.value).toMatchObject({ value: "BO", labelKey: "report.role.BO" });
    // The pack agrees with the gate view (the same routing rule).
    const view = await call<Body>(api.app, "GET", `${T(p)}/gates/G3`, { session: p.lead.session });
    expect(view.body.gate.approverRoleCode).toBe(g3.value.value);
    // A gate the version does not override stays SP.
    expect((await packApprover(p, "G1")).value.value).toBe("SP");
  });

  it("a v1-pinned transformation's G3 pack is unchanged: SP", async () => {
    const p = await worldOn(v1);
    expect((await packApprover(p, "G3")).value).toMatchObject({ value: "SP", labelKey: "report.role.SP" });
  });

  it("with a submission the pack prints the submission's recorded approver, ahead of the port", async () => {
    const p = await worldOn(v2);
    await makeG1Ready(api, p);
    const sub = await call<Body>(api.app, "POST", `${T(p)}/gates/G1/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, "G1")),
      body: {},
    });
    expect(sub.status, JSON.stringify(sub.body).slice(0, 800)).toBe(201);
    const recorded = (
      await api.db
        .selectFrom("gate_submission")
        .select("approver_role_code")
        .where("gate_instance_id", "=", await gateId(p, "G1"))
        .where("submission_no", "=", sub.body.submissionNo)
        .executeTakeFirstOrThrow()
    ).approver_role_code;
    expect(recorded).toBe("SP");
    // A port that answers another role for every gate: the submission's approver still wins.
    const wired = workflowsReadPort();
    setWorkflowsReadPort({ ...wired, gateApprover: async () => ({ roleCode: "BO", userId: null }) });
    try {
      expect((await packApprover(p, "G1")).value.value).toBe(recorded);
      // ... while a gate without a submission takes the port's answer.
      expect((await packApprover(p, "G2")).value.value).toBe("BO");
    } finally {
      setWorkflowsReadPort(wired);
    }
  });

  it("an unwired port (null) falls back to the stored approver", async () => {
    const p = await worldOn(v2);
    const wired = workflowsReadPort();
    setWorkflowsReadPort({ ...wired, gateApprover: async () => null });
    try {
      expect((await packApprover(p, "G3")).value.value).toBe(await storedRole(p, "G3"));
    } finally {
      setWorkflowsReadPort(wired);
    }
  });
});
