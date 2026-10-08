// Outcome hierarchy depth (REQ-PB-032, B0048; ADR-0021 §2; T-DG3-BE-G, AN-P3 handback §5 O-1) against a real
// PostgreSQL. One synthetic world holds all five levels: a North Star, one outcome, one outcome KPI with a target value
// and a target date, one initiative contribution to that KPI and one contribution with no KPI (plus a second KPI whose
// target is unset). GET /transformations/{id}/outcome-hierarchy is asserted field by field:
//   North Star -> outcomes[] -> kpis[] (targetValue as a decimal string, targetDate) -> kpis[].contributions[], and the
//   outcome-level contributions without a KPI; an unset target is null (Unknown), never 0; a contribution without an
//   outcome is refused (400 at /outcomeId) and writes nothing. Read access: AUD reads; another org and an unscoped
//   user do not. All data is SYNTHETIC; nothing here approves anything (never DG0-DG7).
import { outcomeHierarchy } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, signIn, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { createInitiative } from "../contract/p3-exercises-be-b.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);

async function made(url: string, body: unknown, session = p.lead.session) {
  const res = await send(url.endsWith("/north-star") ? "PUT" : "POST", url, { session, body });
  expect([200, 201], `${url}: ${JSON.stringify(res.body)}`).toContain(res.status);
  return res.body as { id: string; version: number } & Record<string, unknown>;
}

const NS = "Synthetic North Star: the most trusted digital telco in the Kingdom.";
const OUTCOME = "Synthetic: postpaid churn falls from 1.8% to 1.2% monthly.";
let northStarId: string;
let outcomeId: string;
let kpiDefinitionId: string;
let otherKpiDefinitionId: string;
let outcomeKpiId: string;
let unsetKpiId: string;
let initiativeId: string;
let viaKpiId: string;
let noKpiId: string;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  northStarId = (await made(`${T}/north-star`, { statement: NS })).id;
  outcomeId = (await made(`${T}/outcomes`, { statement: OUTCOME })).id;
  kpiDefinitionId = (
    await made(`${T}/kpi-definitions`, {
      name: "Synthetic monthly postpaid churn",
      unitKind: "count",
      polarity: "lower_is_better",
    })
  ).id;
  otherKpiDefinitionId = (
    await made(`${T}/kpi-definitions`, {
      name: "Synthetic digital NPS",
      unitKind: "count",
      polarity: "higher_is_better",
    })
  ).id;
  outcomeKpiId = (
    await made(`${T}/outcome-kpis`, { outcomeId, kpiDefinitionId, targetValue: "1250.5", targetDate: "2027-12-31" })
  ).id;
  // A second KPI row with no target value: the hierarchy must show it as Unknown (null), never 0.
  unsetKpiId = (
    await made(`${T}/outcome-kpis`, { outcomeId, kpiDefinitionId: otherKpiDefinitionId, targetDate: "2028-06-30" })
  ).id;
  initiativeId = (await createInitiative(send, p)).id;
  const C = `/api/v1/initiatives/${initiativeId}/outcome-contributions`;
  viaKpiId = (
    await made(C, { outcomeId, outcomeKpiId, contributionStatement: "Synthetic: retention offers cut churn." })
  ).id;
  noKpiId = (await made(C, { outcomeId, contributionStatement: "Synthetic: no KPI chosen yet." })).id;
}, 60_000);
afterAll(() => api.close());

describe("GET /transformations/{id}/outcome-hierarchy, full nested shape (REQ-PB-032)", () => {
  it("returns all five levels, linked, field by field", async () => {
    const res = await send("GET", `${T}/outcome-hierarchy`, { session: p.lead.session });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // The response conforms to the shared contract mirror (strict: no extra or missing fields).
    const tree = outcomeHierarchy.parse(res.body);

    // Level 1: the North Star.
    expect(tree.northStar).not.toBeNull();
    expect([tree.northStar!.id, tree.northStar!.statement, tree.northStar!.status]).toEqual([
      northStarId,
      NS,
      "current",
    ]);
    expect(tree.northStar!.transformationId).toBe(p.transformationId);

    // Level 2: exactly one outcome.
    expect(tree.outcomes).toHaveLength(1);
    const [node] = tree.outcomes;
    expect([node!.outcome.id, node!.outcome.statement, node!.outcome.transformationId]).toEqual([
      outcomeId,
      OUTCOME,
      p.transformationId,
    ]);

    // Levels 3 and 4: the KPIs (T02 rows, in ordinal order) with their targets.
    expect(node!.kpis.map((k) => k.outcomeKpiId)).toEqual([outcomeKpiId, unsetKpiId]);
    const [kpi, unset] = node!.kpis;
    expect(kpi!.kpiDefinitionId).toBe(kpiDefinitionId);
    expect(typeof kpi!.targetValue).toBe("string"); // a decimal string, never a JS number
    expect(kpi!.targetValue).toMatch(/^-?\d+(\.\d+)?$/);
    expect(kpi!.targetValue).toBe("1250.500000"); // numeric(24,6) as stored: exact, no float rounding
    expect(kpi!.targetDate).toBe("2027-12-31");
    // Unset target: null (Unknown), never 0 or "0".
    expect(unset!.kpiDefinitionId).toBe(otherKpiDefinitionId);
    expect(unset!.targetValue).toBeNull();
    expect(unset!.targetDate).toBe("2028-06-30");
    expect(unset!.contributions).toEqual([]);

    // Level 5: the contribution to the KPI hangs under that KPI only.
    expect(kpi!.contributions).toHaveLength(1);
    expect(kpi!.contributions[0]).toMatchObject({
      id: viaKpiId,
      initiativeId,
      transformationId: p.transformationId,
      outcomeId,
      outcomeKpiId,
      contributionStatement: "Synthetic: retention offers cut churn.",
      status: "active",
      removedAt: null,
      version: 1,
    });
    // The contribution without a KPI hangs under the outcome, not under any KPI.
    expect(node!.contributions).toHaveLength(1);
    expect(node!.contributions[0]).toMatchObject({
      id: noKpiId,
      initiativeId,
      outcomeId,
      outcomeKpiId: null,
      contributionStatement: "Synthetic: no KPI chosen yet.",
      status: "active",
    });
    // No contribution appears twice anywhere in the tree.
    const all = [...node!.kpis.flatMap((k) => k.contributions), ...node!.contributions].map((c) => c.id);
    expect(all.sort()).toEqual([viaKpiId, noKpiId].sort());

    // The hierarchy agrees with the T02 row it reads (same decimal string, same date).
    const row = await send("GET", `${T}/outcome-kpis/${outcomeKpiId}`, { session: p.lead.session });
    expect(row.status).toBe(200);
    expect([row.body.targetValue, row.body.targetDate]).toEqual([kpi!.targetValue, kpi!.targetDate]);
  });

  it("refuses a contribution without an outcome (400 at /outcomeId) and the tree is unchanged", async () => {
    const before = (await send("GET", `${T}/outcome-hierarchy`, { session: p.lead.session })).body;
    const C = `/api/v1/initiatives/${initiativeId}/outcome-contributions`;
    for (const body of [
      { contributionStatement: "Synthetic: no outcome." },
      { outcomeKpiId, contributionStatement: "Synthetic: a KPI but no outcome." },
      { outcomeId: null, contributionStatement: "Synthetic: null outcome." },
    ]) {
      const res = await send("POST", C, { session: p.lead.session, body });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.errors.map((e: { pointer: string }) => e.pointer)).toContain("/outcomeId");
    }
    const rows = await api.db
      .selectFrom("initiative_outcome_contribution")
      .select("id")
      .where("initiative_id", "=", initiativeId)
      .execute();
    expect(rows.map((r) => r.id).sort()).toEqual([viaKpiId, noKpiId].sort());
    const after = (await send("GET", `${T}/outcome-hierarchy`, { session: p.lead.session })).body;
    expect(after).toEqual(before);
  });

  it("is readable by AUD (same tree) and not by another organization or an unscoped user", async () => {
    const lead = (await send("GET", `${T}/outcome-hierarchy`, { session: p.lead.session })).body;
    const aud = await send("GET", `${T}/outcome-hierarchy`, { session: p.auditor.session });
    expect(aud.status).toBe(200);
    expect(aud.body).toEqual(lead);
    // Another organization's TO (holds transformation.read, not on this record) and a user with no role at all: both
    // 404 not_found, the read-denial shape that does not reveal the record exists (requireRead, access/policy.ts).
    for (const subject of [w.officeB.subject, w.nobody.subject]) {
      const res = await send("GET", `${T}/outcome-hierarchy`, { session: await signIn(api.app, subject) });
      expect([res.status, res.body.code], subject).toEqual([404, "not_found"]);
      expect(JSON.stringify(res.body)).not.toContain(OUTCOME);
      expect(JSON.stringify(res.body)).not.toContain(NS);
    }
  });
});
