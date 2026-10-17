// T-DG5-BE-C3 (D-163; F-DG5-QA-A-1; REQ-S06-004, REQ-S20-006; ADR-0039 §3, ADR-0015 §2) against a real PostgreSQL:
// every read that names a gate's approver names the EFFECTIVE one, the approver `routedApproverOf` routes a new
// submission to (runtime resolution; nothing stored is rewritten):
//  - a transformation pinned to a methodology version whose G3 default approver is BO reports BO for G3 (single read,
//    list read, PATCH response), and the list and the single read agree on every gate;
//  - a transformation pinned to v1 keeps SP, byte-identical before and after the newer version is published (R2);
//  - a configured approver is kept: a named user, and a configured role;
//  - the gate exception of that G3 is routed to (work items) and decided by the BO, not the Sponsor;
//  - the worker's SQL twin (expiry-notice recipients) resolves the same approver as the API for every gate.
// All data is synthetic; the decisions are demo BUSINESS decisions in a test world and approve nothing real. Nothing
// here touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { effectiveGateApproverOf } from "../../../../worker/src/handlers/gates.ts";
import { call, seedWorld, startApi, type RequestOptions, type TestApi, type World } from "../../support/harness.ts";
import { gateVersion, ifm } from "../../support/p2-fixtures.ts";
import { setupApprovalWorld, type ApprovalWorld } from "../approvals/approval-world.ts";
import { freshKey, pinFixture, seedPublishedVersion } from "./migration-fixtures.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const req = (m: string, u: string, o?: RequestOptions) => call<Body>(api.app, m, u, o);
const T = (t: string) => `/api/v1/transformations/${t}`;

/** The synthetic newer version: G3's and G5's default approver BO (both inside their DG2 allowed set {SP, BO}). */
const V2_ELEMENTS = [
  { elementType: "gate", stableKey: "G3", attributes: { defaultApproverRoleCode: "BO" } },
  { elementType: "gate", stableKey: "G5", attributes: { defaultApproverRoleCode: "BO" } },
];

/** An approval world pinned to `versionId` (as if created on it). */
async function worldOn(versionId: string): Promise<ApprovalWorld> {
  const p = await setupApprovalWorld(api, w);
  await pinFixture(api, {
    organizationId: w.orgA.id,
    transformationId: p.transformationId,
    kind: "methodology",
    versionId,
    by: p.lead.id,
  });
  return p;
}

const single = async (p: ApprovalWorld, gate: string) => {
  const r = await req("GET", `${T(p.transformationId)}/gates/${gate}`, { session: p.lead.session });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const list = async (p: ApprovalWorld) => {
  const r = await req("GET", `${T(p.transformationId)}/gates`, { session: p.lead.session });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.items as Body[];
};
const approversOf = (items: Body[]) =>
  Object.fromEntries(items.map((v) => [v.gate.gateCode, [v.gate.approverRoleCode, v.gate.approverUserId]]));
const storedOf = async (transformationId: string) =>
  Object.fromEntries(
    (
      await api.db
        .selectFrom("gate_instance")
        .select(["gate_code", "approver_role_code", "approver_user_id"])
        .where("transformation_id", "=", transformationId)
        .execute()
    ).map((g) => [g.gate_code, [g.approver_role_code, g.approver_user_id]]),
  );
const workerOf = async (transformationId: string) => {
  const rows = await api.db
    .selectFrom("gate_instance")
    .select(["id", "gate_code"])
    .where("transformation_id", "=", transformationId)
    .execute();
  const out: Record<string, [string, string | null]> = {};
  for (const r of rows) {
    const a = await api.db.transaction().execute((tx) => effectiveGateApproverOf(tx, r.id));
    out[r.gate_code] = [a.roleCode, a.userId];
  }
  return out;
};

let key: string;
let v1: string;
let v2: string;
let oldWorld: ApprovalWorld;
let oldBefore: Body[];
let newWorld: ApprovalWorld;
beforeAll(async () => {
  key = freshKey("methodology");
  v1 = await seedPublishedVersion(api, "methodology", key, 1);
  oldWorld = await worldOn(v1);
  oldBefore = await list(oldWorld);
  v2 = await seedPublishedVersion(api, "methodology", key, 2, V2_ELEMENTS);
  newWorld = await worldOn(v2);
}, 120_000);

describe("F-DG5-QA-A-1: a gate names the approver its submissions are routed to", () => {
  it("the NEW transformation's G3 and G5 report BO; the stored row is not rewritten", async () => {
    const g3 = await single(newWorld, "G3");
    expect(g3.definition.defaultApproverRoleCode).toBe("BO");
    expect([g3.gate.approverRoleCode, g3.gate.approverUserId]).toEqual(["BO", null]);
    expect((await single(newWorld, "G5")).gate.approverRoleCode).toBe("BO");
    expect((await single(newWorld, "G1")).gate.approverRoleCode).toBe("SP");
    // Runtime resolution: gate_instance still holds the catalogue default (nothing rewritten, no version bump).
    const stored = await storedOf(newWorld.transformationId);
    expect(stored["G3"]).toEqual(["SP", null]);
    expect(g3.gate.version).toBe(
      (
        await api.db
          .selectFrom("gate_instance")
          .select("version")
          .where("transformation_id", "=", newWorld.transformationId)
          .where("gate_code", "=", "G3")
          .executeTakeFirstOrThrow()
      ).version,
    );
  });

  it("the list and the single read agree on every gate", async () => {
    const items = await list(newWorld);
    expect(items).toHaveLength(6);
    for (const v of items) {
      const one = await single(newWorld, v.gate.gateCode);
      expect([v.gate.gateCode, v.gate]).toEqual([v.gate.gateCode, one.gate]);
    }
    expect(approversOf(items)).toEqual({
      G1: ["SP", null],
      G2: ["SP", null],
      G3: ["BO", null],
      G4: ["SP", null],
      G5: ["BO", null],
      G6: ["SP", null],
    });
  });

  it("the OLD (v1-pinned) transformation keeps SP, its gate list byte-identical after the newer version is published", async () => {
    const after = await list(oldWorld);
    expect(JSON.stringify(after)).toBe(JSON.stringify(oldBefore));
    expect(approversOf(after)).toEqual(await storedOf(oldWorld.transformationId));
    expect((await single(oldWorld, "G3")).gate.approverRoleCode).toBe("SP");
  });

  it("a configured approver is kept: a named user on the new transformation, a configured role on the old one", async () => {
    // Named user: the Sponsor (holds SP with gate.decide there) as G3's approver, although the pinned default is BO.
    const named = await req("PATCH", `${T(newWorld.transformationId)}/gates/G3`, {
      session: newWorld.office.session,
      headers: ifm(await gateVersion(api, newWorld, "G3")),
      body: { approverRoleCode: "SP", approverUserId: newWorld.sponsor.id },
    });
    expect(named.status, JSON.stringify(named.body)).toBe(200);
    expect([named.body.gate.approverRoleCode, named.body.gate.approverUserId]).toEqual(["SP", newWorld.sponsor.id]);
    const g3 = await single(newWorld, "G3");
    expect([g3.gate.approverRoleCode, g3.gate.approverUserId]).toEqual(["SP", newWorld.sponsor.id]);
    expect(approversOf(await list(newWorld))["G3"]).toEqual(["SP", newWorld.sponsor.id]);
    expect((await workerOf(newWorld.transformationId))["G3"]).toEqual(["SP", newWorld.sponsor.id]);

    // Configured role (not the catalogue default) on the v1-pinned transformation: kept exactly as stored.
    const role = await req("PATCH", `${T(oldWorld.transformationId)}/gates/G5`, {
      session: oldWorld.office.session,
      headers: ifm(await gateVersion(api, oldWorld, "G5")),
      body: { approverRoleCode: "BO" },
    });
    expect(role.status, JSON.stringify(role.body)).toBe(200);
    expect([role.body.gate.approverRoleCode, role.body.gate.approverUserId]).toEqual(["BO", null]);
    expect(approversOf(await list(oldWorld))).toEqual(await storedOf(oldWorld.transformationId));
    // ... and back to the Sponsor: still the stored value (v1: the routed approver IS the stored one).
    const back = await req("PATCH", `${T(oldWorld.transformationId)}/gates/G5`, {
      session: oldWorld.office.session,
      headers: ifm(role.body.gate.version),
      body: { approverRoleCode: "SP" },
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.gate.approverRoleCode).toBe("SP");
  });

  it("the approver check of the configuration reads the resolved definition: a role outside the allowed set is refused", async () => {
    const r = await req("PATCH", `${T(newWorld.transformationId)}/gates/G1`, {
      session: newWorld.office.session,
      headers: ifm(await gateVersion(api, newWorld, "G1")),
      body: { approverRoleCode: "BO" },
    });
    expect([r.status, r.body.code]).toEqual([422, "gate.approver_role_not_allowed"]);
  });

  it("the worker's SQL twin resolves the same approver as the API's gate reads (old and new transformation)", async () => {
    for (const p of [newWorld, oldWorld]) {
      const fromApi = approversOf(await list(p));
      expect(await workerOf(p.transformationId)).toEqual(fromApi);
    }
  });
});

describe("F-DG5-QA-A-1: the gate exception of the new transformation's G3 is routed to and decided by its effective approver", () => {
  it("the to-decide work items go to the BO holders, never the Sponsor; the Sponsor gets 403, the BO decides", async () => {
    const p = await worldOn(v2);
    const t = p.transformationId;
    const created = await req("POST", `${T(t)}/gate-exceptions`, {
      session: p.lead.session,
      body: {
        gateCode: "G3",
        criterionKey: "g3.target_operating_model",
        reason: "Synthetic exception for the effective-approver test",
        scope: "Synthetic scope of the exception",
        compensatingAction: "Synthetic compensating action",
        compensatingOwnerUserId: p.lead.id,
        expiresOn: "2099-12-31",
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const items = await api.db
      .selectFrom("work_item")
      .select("assignee_user_id")
      .where("subject_type", "=", "gate_exception")
      .where("subject_id", "=", created.body.id)
      .where("kind", "=", "gate_exception_to_decide")
      .execute();
    const assignees = items.map((i) => i.assignee_user_id);
    expect(assignees).toContain(p.bo.id);
    expect(assignees).not.toContain(p.sponsor.id);

    const decide = (session: Body) =>
      req("POST", `${T(t)}/gate-exceptions/${created.body.id}/decision`, {
        session,
        headers: ifm(created.body.version),
        body: { outcome: "accepted", note: "Synthetic demo decision; approves nothing real." },
      });
    const bySponsor = await decide(p.sponsor.session);
    expect([bySponsor.status, bySponsor.body.code]).toEqual([403, "gate_exception.not_approver"]);
    const byBo = await decide(p.bo.session);
    expect(byBo.status, JSON.stringify(byBo.body)).toBe(200);
    expect(byBo.body.status).toBe("accepted");
  });

  it("on the v1-pinned transformation the exception still goes to the Sponsor (unchanged)", async () => {
    const p = await worldOn(v1);
    const created = await req("POST", `${T(p.transformationId)}/gate-exceptions`, {
      session: p.lead.session,
      body: {
        gateCode: "G3",
        criterionKey: "g3.target_operating_model",
        reason: "Synthetic exception for the effective-approver test",
        scope: "Synthetic scope of the exception",
        compensatingAction: "Synthetic compensating action",
        compensatingOwnerUserId: p.lead.id,
        expiresOn: "2099-12-31",
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const assignees = (
      await api.db
        .selectFrom("work_item")
        .select("assignee_user_id")
        .where("subject_id", "=", created.body.id)
        .where("kind", "=", "gate_exception_to_decide")
        .execute()
    ).map((i) => i.assignee_user_id);
    expect(assignees).toContain(p.sponsor.id);
    expect(assignees).not.toContain(p.bo.id);
  });
});
