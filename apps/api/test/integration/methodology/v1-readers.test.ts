// p5-plan R2 (ADR-0039 §3 "Pinned v1 is byte-identical"; p5-work-split §A.5; T-DG5-BE-C): every DG2-DG4 reader that
// BE-C rewired through the ConfigResolver returns, for a transformation pinned to the seeded `playbook` v1 (every
// DG2-DG4 transformation), exactly what it returned before: the gate definitions (labels, help, default approver,
// submission switch, criteria), the gate list and gate view, the approver a submission routes to and its basis, the
// gate decision's approver basis, and the DG2 refusal of an approved gate. "Before" is the DG2 catalogue reader
// (loadGateDefinitions, unchanged) and the catalogue the DG2 route GET /transformations/{id}/methodology returns.
// The positive control: a pin to a version WITH rows changes exactly the overridden fields. All data is synthetic; the
// G1 decision is a demo business decision that approves nothing real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadGateDefinitions } from "../../../src/modules/methodology/index.ts";
import { resolveGateDefinitions } from "../../../src/modules/workflows/criteria.ts";
import { call, seedWorld, startApi, type RequestOptions, type TestApi, type World } from "../../support/harness.ts";
import { G1_AGREEMENTS, gateVersion, ifm, makeG1Ready, setupP2World } from "../../support/p2-fixtures.ts";
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
const PLAYBOOK_V1 = "01920002-0000-7000-8000-000000000001";

describe("v1-pinned readers are byte-identical (p5-plan R2)", () => {
  it("a new transformation is pinned to playbook v1 and its resolved gate definitions are the catalogue, byte for byte", async () => {
    const p = await setupP2World(api, w);
    const pin = await api.db
      .selectFrom("transformation_config_pin")
      .select("methodology_version_id")
      .where("transformation_id", "=", p.transformationId)
      .where("kind", "=", "methodology")
      .executeTakeFirstOrThrow();
    expect(pin.methodology_version_id).toBe(PLAYBOOK_V1);
    const catalogue = await loadGateDefinitions(api.db);
    const resolved = await resolveGateDefinitions(api.db, p.transformationId, catalogue);
    expect(JSON.stringify(resolved)).toBe(JSON.stringify(catalogue));
    // Without a passed catalogue the reader loads the same one.
    expect(JSON.stringify(await resolveGateDefinitions(api.db, p.transformationId))).toBe(JSON.stringify(catalogue));
  });

  it("the gate list and gate views carry exactly the DG2 catalogue definitions (GET /methodology)", async () => {
    const p = await setupP2World(api, w);
    const T = `/api/v1/transformations/${p.transformationId}`;
    const methodology = await req("GET", `${T}/methodology`, { session: p.lead.session });
    expect(methodology.status).toBe(200);
    const list = await req("GET", `${T}/gates`, { session: p.lead.session });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body.items.map((i: Body) => i.definition))).toBe(
      JSON.stringify(methodology.body.gateDefinitions),
    );
    for (const def of methodology.body.gateDefinitions) {
      const one = await req("GET", `${T}/gates/${def.code}`, { session: p.lead.session });
      expect(JSON.stringify(one.body.definition)).toBe(JSON.stringify(def));
      // canSubmit / submissionEnabled are those of DG2 (no re-approval row exists for this transformation).
      expect(one.body.submissionEnabled).toBe(def.submissionEnabled);
    }
    expect(list.body.items.map((i: Body) => [i.gate.gateCode, i.canSubmit])).toEqual([
      ["G1", false],
      ["G2", false],
      ["G3", false],
      ["G4", false],
      ["G5", false],
      ["G6", false],
    ]);
  });

  it("a v1 submission routes to the catalogue default approver (SP, default_role); the decision and the DG2 refusal are unchanged", async () => {
    const p = await setupP2World(api, w);
    const T = `/api/v1/transformations/${p.transformationId}`;
    await makeG1Ready(api, p);
    const ready = await req("GET", `${T}/gates/G1`, { session: p.lead.session });
    expect(ready.body.canSubmit).toBe(true);
    const sub = await req("POST", `${T}/gates/G1/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, "G1")),
      body: {},
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    expect([sub.body.approverRoleCode, sub.body.approverUserId]).toEqual(["SP", null]);
    const snapshot = await api.db
      .selectFrom("gate_submission")
      .select("snapshot")
      .where("id", "=", sub.body.id)
      .executeTakeFirstOrThrow();
    expect((snapshot.snapshot as Body).approver).toEqual({ roleCode: "SP", userId: null, basis: "default_role" });
    const decided = await req("POST", `${T}/gates/G1/decision`, {
      session: p.sponsor.session,
      body: {
        submissionNo: sub.body.submissionNo,
        outcome: "approved",
        rationale: "Synthetic demo decision; approves nothing real.",
        agreements: G1_AGREEMENTS,
      },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(201);
    expect([decided.body.approverBasis, decided.body.approverRoleCode]).toEqual(["default_role", "SP"]);
    const again = await req("POST", `${T}/gates/G1/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, "G1")),
      body: {},
    });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "gate.already_approved",
      "This gate is already approved; it cannot be resubmitted.",
    ]);
    // No re-approval exists for a transformation that was never migrated.
    expect((await req("GET", `${T}/gate-reapprovals`, { session: p.lead.session })).body).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("control: a version without rows reads as the catalogue; one with rows changes exactly the overridden fields", async () => {
    const p = await setupP2World(api, w);
    const catalogue = await loadGateDefinitions(api.db);
    const key = freshKey("methodology");
    const empty = await seedPublishedVersion(api, "methodology", key, 1);
    await pinFixture(api, {
      organizationId: w.orgA.id,
      transformationId: p.transformationId,
      kind: "methodology",
      versionId: empty,
      by: p.lead.id,
    });
    expect(JSON.stringify(await resolveGateDefinitions(api.db, p.transformationId))).toBe(JSON.stringify(catalogue));
    const withRows = await seedPublishedVersion(api, "methodology", key, 2, [
      {
        elementType: "gate",
        stableKey: "G3",
        attributes: { labelEn: "G3 (synthetic)", defaultApproverRoleCode: "BO" },
      },
      { elementType: "gate", stableKey: "G2", attributes: { defaultApproverRoleCode: "BO" } },
      { elementType: "gate_criterion", stableKey: "g1.baseline", attributes: { labelEn: "Baseline (synthetic)" } },
    ]);
    await pinFixture(api, {
      organizationId: w.orgA.id,
      transformationId: p.transformationId,
      kind: "methodology",
      versionId: withRows,
      by: p.lead.id,
    });
    const resolved = await resolveGateDefinitions(api.db, p.transformationId);
    const g3 = resolved.find((d) => d.code === "G3")!;
    const g3c = catalogue.find((d) => d.code === "G3")!;
    expect({ ...g3, sourceNameEn: g3c.sourceNameEn, defaultApproverRoleCode: g3c.defaultApproverRoleCode }).toEqual(
      g3c,
    );
    expect([g3.sourceNameEn, g3.defaultApproverRoleCode]).toEqual(["G3 (synthetic)", "BO"]);
    // An approver outside the DG2 allowed set is never resolved (the Studio refuses it first).
    expect(resolved.find((d) => d.code === "G2")!.defaultApproverRoleCode).toBe("SP");
    const g1 = resolved.find((d) => d.code === "G1")!;
    expect(g1.criteria.find((c) => c.key === "g1.baseline")!.labelEn).toBe("Baseline (synthetic)");
    expect(resolved.filter((d) => !["G1", "G3"].includes(d.code))).toEqual(
      catalogue.filter((d) => !["G1", "G3"].includes(d.code)),
    );
  });
});
