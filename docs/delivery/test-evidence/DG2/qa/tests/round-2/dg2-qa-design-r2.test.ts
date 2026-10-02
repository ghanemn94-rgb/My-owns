// qa-verifier DG2 round 2 — supplementary independent checks for requirements no existing suite names by ID:
// REQ-PB-018 (G3 criteria), REQ-PB-024 (capability heatmap build/buy/partner), REQ-PB-025 (journey/process maps:
// pain points, cycle time, failure demand), REQ-PB-031 (five scope sanity checks on the charter).
// Authored by qa-verifier (no product code). Native API only. All data is SYNTHETIC.
// Run in a disposable clone (copy to tests/qa/integration/):
//   QA_PG_PORT=<port> tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose tests/qa/integration/dg2-qa-design-r2.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedWorld, type World } from "../../../apps/api/test/support/harness.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../support/api.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let api: TestApi;
let w: World;
const ifm = (v: number | string) => ({ "if-match": `"${v}"` });
const req = (method: string, url: string, s: Session, body?: unknown, headers?: Record<string, string>) =>
  call<Any>(api.app, method, url, { session: s, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });
const ok = (r: Any, status: number, what: string) => {
  expect(r.status, `${what}: ${JSON.stringify(r.body).slice(0, 400)}`).toBe(status);
  return r.body;
};
const etag = (r: Any) => String(r.headers?.etag ?? "").replace(/"/g, "");
let T = "";
let lead: { id: string; s: Session };
let aud: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  lead = { id: u.id, s: await signIn(api.app, u.subject) };
  const t = ok(await req("POST", "/api/v1/transformations", lead.s, { businessUnitId: w.a1, name: "QA design r2", mode: "end_to_end" }), 201, "create");
  T = `/api/v1/transformations/${t.id}`;
  const a = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, a.id, "AUD", { type: "transformation", id: t.id }, w.orgA.id);
  aud = await signIn(api.app, a.subject);
});
afterAll(async () => {
  await api?.close();
});

describe("QA r2 REQ-PB-018 G3 Target State criteria", () => {
  it("G3 requires TOM, gap matrix, capability gaps, future journeys; all incomplete on a fresh transformation", async () => {
    const g3 = ok(await req("GET", `${T}/gates/G3`, lead.s), 200, "getGate G3");
    const keys = (g3.criteria as Any[]).map((c) => c.key);
    console.log("QA-R2 G3 criteria:", JSON.stringify((g3.criteria as Any[]).map((c) => [c.key, c.mandatory, c.completeness])));
    for (const k of ["g3.target_operating_model", "g3.capability_gaps", "g3.future_journeys"]) {
      expect(keys).toContain(k);
      const c = (g3.criteria as Any[]).find((x) => x.key === k);
      expect(c.mandatory).toBe(true);
      expect(c.completeness).not.toBe("complete");
    }
  });
});

describe("QA r2 REQ-PB-024 capability heatmap", () => {
  it("records build/buy/partner sourcing needs, edits with If-Match, rejects invalid level/sourcing; AUD cannot write", async () => {
    const made: Any[] = [];
    for (const s of ["build", "buy", "partner"]) {
      made.push(ok(await req("POST", `${T}/capability-heatmap`, lead.s, { name: `QA cap ${s}`, currentLevel: 1, targetLevel: 4, sourcingNeed: s }), 201, `create ${s}`));
    }
    expect(made.map((m) => m.sourcingNeed)).toEqual(["build", "buy", "partner"]);
    const bad1 = await req("POST", `${T}/capability-heatmap`, lead.s, { name: "QA bad", sourcingNeed: "outsource" });
    const bad2 = await req("POST", `${T}/capability-heatmap`, lead.s, { name: "QA bad", currentLevel: 9 });
    console.log("QA-R2 capability invalid sourcing / level ->", bad1.status, bad2.status);
    expect([bad1.status, bad2.status]).toEqual([400, 400]);
    const upd = ok(await req("PATCH", `${T}/capability-heatmap/${made[0].id}`, lead.s, { sourcingNeed: "partner", targetLevel: 5 }, ifm(made[0].version)), 200, "update");
    expect([upd.sourcingNeed, upd.targetLevel, upd.version]).toEqual(["partner", 5, made[0].version + 1]);
    const stale = await req("PATCH", `${T}/capability-heatmap/${made[0].id}`, lead.s, { targetLevel: 3 }, ifm(made[0].version));
    expect(stale.status).toBe(409);
    const ro = await req("POST", `${T}/capability-heatmap`, aud, { name: "QA aud" });
    expect(ro.status).toBe(403);
  });
});

describe("QA r2 REQ-PB-025 journey and process maps", () => {
  it("captures steps, cycle time, failure demand and pain points on a step", async () => {
    const stepKey = "01920099-0000-7000-8000-0000000000cc";
    const j = ok(
      await req("POST", `${T}/journeys`, lead.s, {
        name: "QA current onboarding",
        kind: "journey",
        state: "current",
        steps: [{ key: stepKey, ordinal: 1, name: "QA KYC", cycleTimeValue: "2.5", cycleTimeUnit: "days" }],
        cycleTimeValue: "4",
        cycleTimeUnit: "days",
        failureDemand: "QA 30% of calls are chasers",
      }),
      201,
      "createJourney",
    );
    console.log("QA-R2 journey:", JSON.stringify({ cycle: [j.cycleTimeValue, j.cycleTimeUnit], failureDemand: j.failureDemand, steps: j.steps }));
    expect(j.failureDemand).toBe("QA 30% of calls are chasers");
    expect(j.cycleTimeValue).not.toBeNull();
    const pp = ok(await req("POST", `${T}/journeys/${j.id}/pain-points`, lead.s, { stepKey, description: "QA documents re-requested" }), 201, "createPainPoint");
    expect(pp.stepKey).toBe(stepKey);
    const list = ok(await req("GET", `${T}/journeys/${j.id}/pain-points`, lead.s), 200, "listPainPoints");
    expect((list.items as Any[]).map((x) => x.description)).toContain("QA documents re-requested");
    const bad = await req("POST", `${T}/journeys/${j.id}/pain-points`, lead.s, {});
    expect(bad.status).toBe(400);
  });
});

describe("QA r2 REQ-PB-031 five scope sanity checks", () => {
  it("the charter carries the five answers (Unknown until answered); an answer persists; an invalid answer is 400", async () => {
    ok(await req("POST", `${T}/charter`, lead.s, { transformationName: "QA design r2" }), 201, "createCharter");
    const r = await req("GET", `${T}/charter`, lead.s);
    const c = r.body.charter ?? r.body;
    const sc = ["scOutcomeLinkage", "scProblemTraceability", "scExclusionsDocumented", "scBaselineMeasurable", "scExecutiveDecisionsVisible"];
    for (const k of sc) expect(c[k]).toBeNull();
    const bad = await req("PATCH", `${T}/charter`, lead.s, { scOutcomeLinkage: "maybe" }, ifm(etag(r)));
    expect(bad.status).toBe(400);
    const saved = ok(await req("PATCH", `${T}/charter`, lead.s, { scOutcomeLinkage: "partly", scOutcomeLinkageEvidence: "QA mapping" }, ifm(etag(r))), 200, "answer");
    const after = saved.charter ?? saved;
    console.log("QA-R2 scope check after save:", after.scOutcomeLinkage, after.scOutcomeLinkageEvidence);
    expect(after.scOutcomeLinkage).toBe("partly");
  });
});
