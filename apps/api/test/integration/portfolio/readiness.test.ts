// Readiness view (REQ-PB-007, B0012; ADR-0021 §9) and the P3 instantiation switch (T-DG3-BE-A) against a real
// PostgreSQL. A fresh transformation lists all five B0012 areas as missing and both sequencing blockers; completing the
// T01 content of a dimension covers its area (technology needs both technology and data); G1 approval clears the
// submit blocker; the outcome hierarchy returns the five levels. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { setGateStatus } from "./fixtures.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
});
afterAll(() => api.close());

const G1_TEXT =
  "Case for change not yet approved (G1): leadership agreement on problem, baseline and material value pools is required before an initiative enters the portfolio";
const DIRECTION_TEXT = "North Star, outcomes and target state not yet approved";
const AREAS = ["economics", "customer", "operations", "capability", "technology"];

const readiness = (p: P2World, session = p.lead.session) =>
  call(api.app, "GET", `/api/v1/transformations/${p.transformationId}/readiness`, { session });

async function fillT01(p: P2World, dimensions: readonly string[]) {
  const T = `/api/v1/transformations/${p.transformationId}`;
  const items = await call<{ items: { id: string; version: number; isSeeded: boolean; dimensionCode: string }[] }>(
    api.app,
    "GET",
    `${T}/diagnostic-items?limit=50`,
    { session: p.lead.session },
  );
  for (const item of items.body.items.filter((i) => i.isSeeded && dimensions.includes(i.dimensionCode))) {
    const res = await call(api.app, "PATCH", `${T}/diagnostic-items/${item.id}`, {
      session: p.lead.session,
      headers: ifm(item.version),
      body: {
        currentState: "Synthetic current state.",
        rootCause: "Synthetic root cause.",
        impactText: "Synthetic impact.",
        confidence: "M",
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
}

describe("POST /transformations uses p3_instantiate_transformation (T-DG3-BE-A)", () => {
  it("a new transformation gets the four B0079 waves and the T06 weight set v1 at the source defaults, audited", async () => {
    const p = await setupP2World(api, w);
    const waves = await api.db
      .selectFrom("roadmap_wave")
      .select(["code", "name_en", "is_source_seeded"])
      .where("transformation_id", "=", p.transformationId)
      .orderBy("ordinal")
      .execute();
    expect(waves.map((x) => [x.code, x.name_en, x.is_source_seeded])).toEqual([
      ["wave_0", "Wave 0 — Mobilize", true],
      ["wave_1", "Wave 1 — Prove", true],
      ["wave_2", "Wave 2 — Scale", true],
      ["wave_3", "Wave 3 — Embed", true],
    ]);
    const sets = await api.db
      .selectFrom("scoring_weight_set")
      .select(["id", "version_no", "status"])
      .where("transformation_id", "=", p.transformationId)
      .execute();
    expect(sets.map((s) => [s.version_no, s.status])).toEqual([[1, "active"]]);
    const weights = await api.db
      .selectFrom("scoring_weight")
      .select(["criterion_code", "weight_percent"])
      .where("weight_set_id", "=", sets[0]!.id)
      .orderBy("criterion_code")
      .execute();
    expect(weights.map((x) => [x.criterion_code, String(x.weight_percent)])).toEqual([
      ["customer_impact", "20.00"],
      ["feasibility", "15.00"],
      ["financial_value", "25.00"],
      ["strategic_fit", "25.00"],
      ["time_to_value", "15.00"],
    ]);
    const audited = await api.db
      .selectFrom("audit_event")
      .select("action")
      .where("transformation_id", "=", p.transformationId)
      .where("action", "in", ["roadmap_wave.create", "scoring_weight_set.create"])
      .execute();
    expect(audited).toHaveLength(5);
  });
});

describe("GET /transformations/{id}/readiness (REQ-PB-007)", () => {
  it("a fresh transformation: every B0012 area missing, both blockers with the exact §3 texts, gates G1-G4 draft", async () => {
    const p = await setupP2World(api, w);
    const res = await readiness(p);
    expect(res.status).toBe(200);
    expect(res.body.missingDiagnosticAreas).toEqual(AREAS);
    expect(res.body.diagnostic.map((a: { area: string; dimensions: string[] }) => [a.area, a.dimensions])).toEqual([
      ["economics", ["financial"]],
      ["customer", ["customer"]],
      ["operations", ["process"]],
      ["capability", ["people_org"]],
      ["technology", ["technology", "data"]],
    ]);
    expect(res.body).toMatchObject({ mode: "end_to_end", entryPhase: null, currentPhase: "diagnose" });
    expect(res.body.gates.map((g: { gateCode: string; status: string }) => [g.gateCode, g.status])).toEqual([
      ["G1", "draft"],
      ["G2", "draft"],
      ["G3", "draft"],
      ["G4", "draft"],
    ]);
    expect(res.body.sequencing).toEqual({
      canSubmitInitiatives: false,
      canLaunchInitiatives: false,
      blockers: [
        { code: "initiative.g1_not_approved", message: G1_TEXT },
        { code: "initiative.direction_not_approved", message: DIRECTION_TEXT },
      ],
    });
  });

  it("T01 content covers areas (content half of g1.diagnostic; technology needs technology AND data)", async () => {
    const p = await setupP2World(api, w);
    await fillT01(p, ["financial", "customer", "technology"]);
    const res = await readiness(p);
    expect(res.body.missingDiagnosticAreas).toEqual(["operations", "capability", "technology"]);
    const tech = res.body.diagnostic.find((a: { area: string }) => a.area === "technology");
    expect(tech).toEqual({ area: "technology", covered: false, dimensions: ["technology", "data"], missing: ["data"] });
    await fillT01(p, ["process", "people_org", "data"]);
    expect((await readiness(p)).body.missingDiagnosticAreas).toEqual([]);
  });

  it("G1 approved clears the submit blocker; G2+G3 approved clear the launch blocker (End-to-End)", async () => {
    const p = await setupP2World(api, w);
    await setGateStatus(api, p, "G1", "approved");
    const afterG1 = await readiness(p);
    expect(afterG1.body.sequencing).toMatchObject({ canSubmitInitiatives: true, canLaunchInitiatives: false });
    expect(afterG1.body.sequencing.blockers.map((b: { code: string }) => b.code)).toEqual([
      "initiative.direction_not_approved",
    ]);
    await setGateStatus(api, p, "G2", "approved");
    await setGateStatus(api, p, "G3", "approved");
    expect((await readiness(p)).body.sequencing).toEqual({
      canSubmitInitiatives: true,
      canLaunchInitiatives: true,
      blockers: [],
    });
  });

  it("read access only: the auditor reads it; a user outside the transformation gets 404; a malformed id 400", async () => {
    const p = await setupP2World(api, w);
    expect((await readiness(p, p.auditor.session)).status).toBe(200);
    const outsider = await call(api.app, "GET", `/api/v1/transformations/${p.transformationId}/readiness`, {
      session: await signIn(api.app, w.officeB.subject),
    });
    expect(outsider.status).toBe(404);
    expect(
      (await call(api.app, "GET", "/api/v1/transformations/nope/readiness", { session: p.lead.session })).status,
    ).toBe(400);
  });
});

describe("GET /transformations/{id}/outcome-hierarchy (REQ-PB-032)", () => {
  it("returns North Star -> outcomes -> KPIs -> targets -> contributions as one tree (read only)", async () => {
    const p = await setupP2World(api, w);
    const T = `/api/v1/transformations/${p.transformationId}`;
    const empty = await call(api.app, "GET", `${T}/outcome-hierarchy`, { session: p.lead.session });
    expect(empty.body).toEqual({ northStar: null, outcomes: [] });
    const ns = await call(api.app, "PUT", `${T}/north-star`, {
      session: p.lead.session,
      body: { statement: "Synthetic North Star: the most trusted digital telco." },
    });
    expect([200, 201]).toContain(ns.status);
    const outcome = await call(api.app, "POST", `${T}/outcomes`, {
      session: p.lead.session,
      body: { statement: "Cut postpaid churn from 1.8% to 1.2% monthly (synthetic)", isTopOutcome: true, topRank: 1 },
    });
    expect(outcome.status, JSON.stringify(outcome.body)).toBe(201);
    const res = await call(api.app, "GET", `${T}/outcome-hierarchy`, { session: p.auditor.session });
    expect(res.status).toBe(200);
    expect(res.body.northStar.statement).toBe("Synthetic North Star: the most trusted digital telco.");
    expect(res.body.outcomes).toHaveLength(1);
    expect(res.body.outcomes[0]).toMatchObject({ outcome: { id: outcome.body.id }, kpis: [], contributions: [] });
  });
});
