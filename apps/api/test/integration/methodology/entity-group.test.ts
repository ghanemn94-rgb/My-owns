// REQ-S16-012 (ADR-0039 §10, ADR-0040 §9; D-142 Q4; p5-work-split §A.5; T-DG5-BE-C): the transformation, methodology
// and gates entity group through the API against a real PostgreSQL. Each entity is created and read with
// authorization enforced: the auditor gets 403 on every write, and a caller outside the scope gets 404 on every read.
//   Transformation (createTransformation / getTransformation), PerformanceArea (createPerformanceArea / get),
//   Charter (createCharter / getCharter), MethodologyVersion (a Studio draft: createConfigDraft / getConfigVersion),
//   Phase and GateDefinition (version-scoped rows in that draft, D-142 Q4: putConfigElement / listConfigElements; a
//   seventh gate or a new phase is not creatable, S02-001), GateInstance (created by instantiation; getGate),
//   GateDecision (a synthetic G1 decision by a person: decideGate / getGateSubmission).
// All data is synthetic; the G1 decision is a demo business decision that approves nothing real, and nothing touches
// the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  seedWorld,
  signIn,
  startApi,
  type RequestOptions,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { G1_AGREEMENTS, gateVersion, ifm, makeG1Ready, setupP2World } from "../../support/p2-fixtures.ts";
import { seedStudioBase } from "../../support/studio-fixtures.ts";
import { createArea, seedSustainmentWorld } from "../contract/p4-exercises-be-i.ts";

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
const RATIONALE = "Synthetic demo decision; approves nothing real.";
const V = "/api/v1/admin/methodology-versions";

describe("REQ-S16-012: the transformation, methodology and gates entity group through the API", () => {
  it("Transformation, Charter, GateInstance and GateDecision: created and read; AUD 403 on writes; 404 outside scope", async () => {
    const p = await setupP2World(api, w);
    const t = p.transformationId;
    const T = `/api/v1/transformations/${t}`;
    const outsider = await signIn(api.app, w.nobody.subject);
    const auditor = p.auditor.session;

    // Transformation (created by setupP2World through POST /transformations).
    const tr = await req("GET", T, { session: p.lead.session });
    expect([tr.status, tr.body.id, tr.body.status]).toEqual([200, t, tr.body.status]);
    expect((await req("GET", T, { session: outsider })).status).toBe(404);
    expect(
      (
        await req("POST", "/api/v1/transformations", {
          session: auditor,
          body: { businessUnitId: w.a1, name: "Synthetic AUD attempt", mode: "end_to_end" },
        })
      ).status,
    ).toBe(403);

    // Charter.
    const charterBody = {
      transformationName: "Synthetic entity-group charter",
      executiveSponsorUserId: p.sponsor.id,
      transformationLeadUserId: p.lead.id,
      caseForChange: "Synthetic case for change.",
      inScope: "Synthetic scope.",
      outOfScope: "Synthetic exclusions.",
      baselineDate: "2026-01-31",
    };
    expect((await req("POST", `${T}/charter`, { session: auditor, body: charterBody })).status).toBe(403);
    // (makeG1Ready below creates the charter through POST /charter as the lead.)
    await makeG1Ready(api, p);
    const charter = await req("GET", `${T}/charter`, { session: p.lead.session });
    expect([charter.status, charter.body.charter.transformationName]).toEqual([200, "Synthetic roaming uplift"]);
    expect((await req("GET", `${T}/charter`, { session: outsider })).status).toBe(404);

    // GateInstance (created by instantiation) and GateDecision (a person's synthetic G1 decision).
    const gate = await req("GET", `${T}/gates/G1`, { session: p.lead.session });
    expect([gate.status, gate.body.gate.gateCode, gate.body.gate.status]).toEqual([200, "G1", "draft"]);
    expect((await req("GET", `${T}/gates/G1`, { session: outsider })).status).toBe(404);
    expect(
      (
        await req("POST", `${T}/gates/G1/submissions`, {
          session: auditor,
          headers: ifm(await gateVersion(api, p, "G1")),
          body: {},
        })
      ).status,
    ).toBe(403);
    const sub = await req("POST", `${T}/gates/G1/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, "G1")),
      body: {},
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const decisionBody = {
      submissionNo: sub.body.submissionNo,
      outcome: "approved",
      rationale: RATIONALE,
      agreements: G1_AGREEMENTS,
    };
    expect((await req("POST", `${T}/gates/G1/decision`, { session: auditor, body: decisionBody })).status).toBe(403);
    const decided = await req("POST", `${T}/gates/G1/decision`, { session: p.sponsor.session, body: decisionBody });
    expect(decided.status, JSON.stringify(decided.body)).toBe(201);
    expect([decided.body.outcome, decided.body.decidedBy]).toEqual(["approved", p.sponsor.id]);
    const read = await req("GET", `${T}/gates/G1/submissions/${sub.body.submissionNo}`, { session: auditor });
    expect([read.status, read.body.decision.id, read.body.decision.outcome]).toEqual([
      200,
      decided.body.id,
      "approved",
    ]);
    expect((await req("GET", `${T}/gates/G1/submissions/1`, { session: outsider })).status).toBe(404);
  }, 90_000);

  it("MethodologyVersion, Phase and GateDefinition: a draft with version-scoped rows; AUD 403; outsiders 403/404", async () => {
    const p = await setupP2World(api, w);
    const admin = p.methodologyAdmin.session;
    const auditor = p.auditor.session;
    const outsider = await signIn(api.app, w.nobody.subject);
    const base = await seedStudioBase(api, "methodology");
    expect((await req("POST", V, { session: auditor, body: { basedOnVersionId: base.id } })).status).toBe(403);
    const draft = await req("POST", V, { session: admin, body: { basedOnVersionId: base.id } });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const id = draft.body.id;
    const got = await req("GET", `${V}/${id}`, { session: auditor });
    expect([got.status, got.body.status, got.body.configKind]).toEqual([200, "draft", "methodology"]);
    expect((await req("GET", `${V}/${id}`, { session: outsider })).status).toBe(403);
    expect((await req("GET", `${V}/${crypto.randomUUID()}`, { session: admin })).status).toBe(404);

    // Phase and GateDefinition: version-scoped rows of existing identities (D-142 Q4).
    const put = (type: string, key: string, version: number, attributes: Record<string, unknown>, s = admin) =>
      req("PUT", `${V}/${id}/elements/${type}/${key}`, { session: s, headers: ifm(version), body: { attributes } });
    expect((await put("phase", "define", 1, { labelEn: "Define (synthetic)" }, auditor)).status).toBe(403);
    const phase = await put("phase", "define", 1, { labelEn: "Define (synthetic)" });
    expect(phase.status, JSON.stringify(phase.body)).toBe(200);
    const gate = await put("gate", "G3", phase.body.version, { labelEn: "G3 - Target State (synthetic)" });
    expect(gate.status, JSON.stringify(gate.body)).toBe(200);
    // A seventh gate cannot be created (S02-001, S06-006).
    const g7 = await put("gate", "G7", gate.body.version, { labelEn: "Synthetic seventh gate" });
    expect([g7.status, g7.body.code]).toEqual([422, "config_version.source_element_protected"]);
    const phases = await req("GET", `${V}/${id}/elements?elementType=phase`, { session: auditor });
    expect(phases.status).toBe(200);
    expect(phases.body.items.find((e: Body) => e.stableKey === "define").attributes.labelEn).toBe("Define (synthetic)");
    const gates = await req("GET", `${V}/${id}/elements?elementType=gate`, { session: admin });
    expect(gates.body.items.map((e: Body) => e.stableKey)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6"]);
    expect(gates.body.items.find((e: Body) => e.stableKey === "G3").attributes.labelEn).toBe(
      "G3 - Target State (synthetic)",
    );
    expect((await req("GET", `${V}/${id}/elements?elementType=gate`, { session: outsider })).status).toBe(403);
  }, 60_000);

  it("PerformanceArea: created and read by its owner; AUD 403 on create; 404 outside scope", async () => {
    const s = await seedSustainmentWorld(api, w);
    const outsider = await signIn(api.app, w.nobody.subject);
    const auditor = await signIn(api.app, w.auditor.subject);
    expect((await req("POST", s.areas, { session: auditor, body: { name: "Synthetic AUD attempt" } })).status).toBe(
      403,
    );
    const area = await createArea((m, u, o) => call(api.app, m, u, o), s);
    const got = await req("GET", `${s.areas}/${area.id}`, { session: s.b.s.bo });
    expect([got.status, got.body.id, got.body.code]).toEqual([200, area.id, area.code]);
    expect((await req("GET", `${s.areas}/${area.id}`, { session: outsider })).status).toBe(404);
    expect((await req("GET", s.areas, { session: outsider })).status).toBe(404);
  }, 90_000);
});
