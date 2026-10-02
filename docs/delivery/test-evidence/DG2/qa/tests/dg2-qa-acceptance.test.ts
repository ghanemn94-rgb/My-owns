// qa-verifier DG2 round 1 — independent acceptance tests (T-DG2-REV-QA-R1). Authored by qa-verifier, NOT by an
// implementer. Derived from the acceptance criteria in docs/delivery/requirements.csv for the 32 DG2-final requirements
// and docs/api/openapi.yaml. Runs against the REAL Fastify app (inject) on a disposable PostgreSQL via the backend's
// test harness (tests/qa/support/api.ts). Copy to tests/qa/integration/ in a disposable clone to run:
//   QA_PG_PORT=<port> tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/dg2-qa-acceptance.test.ts
// All data is SYNTHETIC. Product gate decisions here are demo business decisions on synthetic data; they approve
// nothing real and are unrelated to the engineering delivery gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedWorld, type World } from "../../../apps/api/test/support/harness.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../support/api.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let api: TestApi;
let w: World;
const ifm = (v: number | string) => ({ "if-match": `"${v}"` });

interface Actor {
  id: string;
  s: Session;
}
interface Tx {
  id: string;
  T: string;
  lead: Actor;
  sponsor: Actor;
  wl: Actor;
  fin: Actor;
  bo: Actor;
}

async function actor(role: string | null, scope?: { type: "transformation" | "organization"; id: string }) {
  const u = await createUser(api.db, w.orgA.id);
  if (role && scope) await grant(api.db, w.grantor.id, u.id, role, scope, w.orgA.id);
  return { id: u.id, s: await signIn(api.app, u.subject) };
}

const req = (method: string, url: string, s: Session, body?: unknown, headers?: Record<string, string>) =>
  call<Any>(api.app, method, url, { session: s, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });

/** A fresh transformation created THROUGH THE API by a TL (business unit a1), plus SP/WL/FIN/BO at the transformation. */
async function newTx(body: Record<string, unknown> = { mode: "end_to_end" }): Promise<Tx> {
  const leadU = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, leadU.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  const lead = { id: leadU.id, s: await signIn(api.app, leadU.subject) };
  const t = await req("POST", "/api/v1/transformations", lead.s, {
    businessUnitId: w.a1,
    name: "QA synthetic transformation",
    ...body,
  });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  const id = t.body.id as string;
  const scope = { type: "transformation" as const, id };
  return {
    id,
    T: `/api/v1/transformations/${id}`,
    lead,
    sponsor: await actor("SP", scope),
    wl: await actor("WL", scope),
    fin: await actor("FIN", scope),
    bo: await actor("BO", scope),
  };
}

async function gateView(x: Tx, code: string) {
  const g = await req("GET", `${x.T}/gates/${code}`, x.lead.s);
  expect(g.status).toBe(200);
  return g.body;
}
const crit = (view: Any, key: string) => (view.criteria as Any[]).find((c) => c.key === key);

/** Completes G1 except the evidence; returns ids. */
async function g1Base(x: Tx, withCharter = true) {
  if (withCharter)
    expect(
      (
        await req("POST", `${x.T}/charter`, x.lead.s, {
          transformationName: "QA roaming uplift",
          executiveSponsorUserId: x.sponsor.id,
          transformationLeadUserId: x.lead.id,
          caseForChange: "QA synthetic case for change.",
          inScope: "QA consumer roaming.",
          outOfScope: "QA enterprise.",
          baselineDate: "2026-01-31",
        })
      ).status,
    ).toBe(201);
  const b = await req("POST", `${x.T}/baselines`, x.lead.s, {
    metric: "QA roaming revenue",
    unit: "SAR",
    scope: "revenue",
    value: "1000",
    currency: "SAR",
    source: "QA extract",
    baselineDate: "2026-01-31",
  });
  expect(b.status).toBe(201);
  expect(
    (
      await req("POST", `${x.T}/value-pools`, x.lead.s, {
        name: "QA pool",
        quantificationStatus: "unquantified",
        unquantifiedReason: "QA pending sizing",
        materiality: "material",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await req("POST", `${x.T}/diagnostic-findings`, x.lead.s, {
        workstreamCode: "business_financial",
        kind: "root_cause",
        statement: "QA root cause",
        status: "confirmed",
      })
    ).status,
  ).toBe(201);
  const items = (await req("GET", `${x.T}/diagnostic-items?limit=50`, x.lead.s)).body.items as Any[];
  for (const it of items.filter((i) => i.isSeeded)) {
    const r = await req(
      "PATCH",
      `${x.T}/diagnostic-items/${it.id}`,
      x.lead.s,
      { currentState: "QA cs", rootCause: "QA rc", impactText: "QA impact", confidence: "M" },
      ifm(it.version),
    );
    expect(r.status).toBe(200);
  }
  return { baselineId: b.body.id as string, items: items.filter((i) => i.isSeeded) };
}

async function linkEvidence(x: Tx, evidenceId: string, base: { baselineId: string; items: Any[] }) {
  for (const it of base.items)
    expect(
      (await req("POST", `${x.T}/evidence-links`, x.lead.s, { evidenceId, recordType: "diagnostic_item", recordId: it.id }))
        .status,
    ).toBe(201);
  expect(
    (
      await req("POST", `${x.T}/evidence-links`, x.lead.s, {
        evidenceId,
        recordType: "baseline",
        recordId: base.baselineId,
      })
    ).status,
  ).toBe(201);
}

async function verifiedNote(x: Tx, reviewer: Session) {
  const e = await req("POST", `${x.T}/evidence`, x.lead.s, {
    kind: "note",
    title: "QA interview notes",
    noteBody: "QA notes",
    ownerUserId: x.lead.id,
  });
  expect(e.status).toBe(201);
  const r = await req(
    "POST",
    `${x.T}/evidence/${e.body.id}/review`,
    reviewer,
    { result: "verified", accessibilityStatus: "accessible", note: "QA read" },
    ifm(e.body.version),
  );
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return e.body.id as string;
}

let office: Session;
let auditor: Session;

/** Exact decimal-string equality independent of trailing zeros (no float conversion). */
function decEq(a: string | null, b: string | null): boolean {
  const norm = (s: string) => {
    const [i, f = ""] = s.split(".");
    const ff = f.replace(/0+$/, "");
    return ff ? `${i}.${ff}` : `${i}`;
  };
  return a !== null && b !== null && norm(a) === norm(b);
}
/** A rejected request: 400 schema validation or 422 validation problem, with a pointer to the offending field. */
function expectRejected(res: Any, pointer: string) {
  expect([400, 422], JSON.stringify(res.body)).toContain(res.status);
  expect(String(res.body.type)).toContain("validation");
  expect(JSON.stringify(res.body.errors ?? [])).toContain(pointer);
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  auditor = await signIn(api.app, w.auditor.subject);
});
afterAll(async () => {
  await api?.close();
});

// ------------------------------------------------------------------------------------------------ T01-T04 registers
describe("QA REQ-PB-026 T01 current-state diagnostic", () => {
  it("pre-seeds the six dimensions, persists all six source columns, rejects Confidence outside H/M/L", async () => {
    const x = await newTx();
    const items = (await req("GET", `${x.T}/diagnostic-items?limit=50`, x.lead.s)).body.items as Any[];
    const seeded = items.filter((i) => i.isSeeded);
    expect(seeded).toHaveLength(6);
    expect(new Set(seeded.map((i) => i.dimensionCode)).size).toBe(6);
    const row = seeded[0];
    const patch = {
      currentState: "QA current state",
      evidenceBaseline: "QA evidence / baseline",
      rootCause: "QA root cause",
      impactText: "QA impact",
      impactAmount: "1234567.89",
      impactCurrency: "SAR",
      confidence: "H",
    };
    const r = await req("PATCH", `${x.T}/diagnostic-items/${row.id}`, x.lead.s, patch, ifm(row.version));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const g = (await req("GET", `${x.T}/diagnostic-items/${row.id}`, x.lead.s)).body;
    // Decimal is exact; the server pads the scale ("1234567.8900"), so compare as decimals, not strings.
    const { impactAmount, ...rest } = patch;
    expect(g).toMatchObject({ ...rest, dimensionCode: row.dimensionCode });
    expect(decEq(g.impactAmount, impactAmount)).toBe(true);
    for (const bad of ["X", "h", "High", "", 3]) {
      const b = await req("PATCH", `${x.T}/diagnostic-items/${row.id}`, x.lead.s, { confidence: bad }, ifm(2));
      expect(b.status, `confidence ${JSON.stringify(bad)}`).toBe(400);
    }
    const c = await req("POST", `${x.T}/diagnostic-items`, x.lead.s, { dimensionCode: "customer", confidence: "Z" });
    expect(c.status).toBe(400);
    // seeded rows cannot be archived
    const a = await req("POST", `${x.T}/diagnostic-items/${row.id}/archive`, x.lead.s, { reason: "QA try" }, ifm(2));
    expect(a.status).toBeGreaterThanOrEqual(400);
    expect((await req("GET", `${x.T}/diagnostic-items/${row.id}`, x.lead.s)).body.status).toBe("active");
  });
});

async function kpiDef(x: Tx, name = "QA KPI") {
  const k = await req("POST", `${x.T}/kpi-definitions`, x.lead.s, {
    name,
    unitKind: "currency",
    currency: "SAR",
    polarity: "higher_is_better",
    ownerUserId: x.bo.id,
  });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  return k.body.id as string;
}

describe("QA REQ-PB-034 T02 outcome & KPI tree", () => {
  it("persists all seven columns and rejects a row without a target date", async () => {
    const x = await newTx();
    const o = await req("POST", `${x.T}/outcomes`, x.lead.s, { statement: "QA roaming revenue grows" });
    expect(o.status).toBe(201);
    const kpi = await kpiDef(x);
    const b = await req("POST", `${x.T}/baselines`, x.lead.s, {
      metric: "QA",
      unit: "SAR",
      scope: "revenue",
      value: "10",
      source: "QA",
      baselineDate: "2026-01-01",
    });
    const base = { outcomeId: o.body.id, kpiDefinitionId: kpi, baselineId: b.body.id, targetValue: "20.5" };
    const noDate = await req("POST", `${x.T}/outcome-kpis`, x.lead.s, base);
    expectRejected(noDate, "/targetDate");
    const nullDate = await req("POST", `${x.T}/outcome-kpis`, x.lead.s, { ...base, targetDate: null });
    expectRejected(nullDate, "/targetDate");
    expect(((await req("GET", `${x.T}/outcome-kpis`, x.lead.s)).body.items as Any[]).length).toBe(0);
    const full = {
      ...base,
      targetDate: "2027-12-31",
      ownerUserId: x.bo.id,
      leadingIndicatorText: "QA weekly activations",
    };
    const r = await req("POST", `${x.T}/outcome-kpis`, x.lead.s, full);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const g = (await req("GET", `${x.T}/outcome-kpis/${r.body.id}`, x.lead.s)).body;
    const { targetValue, ...restFull } = full;
    expect(g).toMatchObject(restFull);
    expect(decEq(g.targetValue, targetValue)).toBe(true);
  });
});

describe("QA REQ-PB-039 T03 TOM gap matrix", () => {
  it("persists all six columns; a row without a (valid) dimension is rejected", async () => {
    const x = await newTx();
    expectRejected(await req("POST", `${x.T}/tom-gaps`, x.lead.s, { currentState: "QA" }), "/dimensionCode");
    expectRejected(await req("POST", `${x.T}/tom-gaps`, x.lead.s, { dimensionCode: null }), "/dimensionCode");
    const unknownDim = await req("POST", `${x.T}/tom-gaps`, x.lead.s, { dimensionCode: "not_a_dimension" });
    expect([400, 422]).toContain(unknownDim.status);
    const d = await req("POST", "/api/v1/decisions", x.lead.s, { transformationId: x.id, title: "QA decision" });
    expect(d.status).toBe(201);
    const full = {
      dimensionCode: "technology",
      currentState: "QA legacy",
      targetState: "QA modern",
      gap: "QA gap",
      designDecisionId: d.body.id,
      ownerUserId: x.bo.id,
    };
    const r = await req("POST", `${x.T}/tom-gaps`, x.lead.s, full);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await req("GET", `${x.T}/tom-gaps/${r.body.id}`, x.lead.s)).body).toMatchObject(full);
  });
});

describe("QA REQ-PB-043 T04 design decision log", () => {
  it("generates D-01, D-02 …; Status defaults to Open; options A/B/C; all columns persist", async () => {
    const x = await newTx();
    const first = await req("POST", "/api/v1/decisions", x.lead.s, {
      transformationId: x.id,
      title: "QA build or buy",
      ownerUserId: x.bo.id,
      dueDate: "2026-12-31",
      recommendationText: "QA recommend buy",
      options: [{ title: "Build" }, { title: "Buy" }, { title: "Partner" }],
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({
      code: "D-01",
      status: "open",
      kind: "design",
      title: "QA build or buy",
      ownerUserId: x.bo.id,
      dueDate: "2026-12-31",
      recommendationText: "QA recommend buy",
    });
    expect((first.body.options as Any[]).map((o) => o.label)).toEqual(["A", "B", "C"]);
    const second = await req("POST", "/api/v1/decisions", x.wl.s, { transformationId: x.id, title: "QA second" });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body).toMatchObject({ code: "D-02", status: "open" });
    const list = await req("GET", `/api/v1/decisions?transformationId=${x.id}&kind=design`, x.lead.s);
    expect((list.body.items as Any[]).map((d) => d.code).sort()).toEqual(["D-01", "D-02"]);
  });
});

// ------------------------------------------------------------------------------------------------ charter
describe("QA REQ-PB-029/030/031/035 charter", () => {
  it("persists the 14 fields, versions every save with retained history, rejects an invalid baseline date, warns outside 3-5 top outcomes", async () => {
    const x = await newTx();
    expect((await req("POST", `${x.T}/charter`, x.lead.s, { baselineDate: "2026-02-30" })).status).toBe(400);
    expect((await req("POST", `${x.T}/charter`, x.lead.s, { baselineDate: "31/01/2026" })).status).toBe(400);
    const ns = await req("PUT", `${x.T}/north-star`, x.lead.s, { statement: "QA double roaming revenue." });
    expect(ns.status).toBe(200);
    const fields = {
      northStarId: ns.body.id,
      transformationName: "QA charter",
      executiveSponsorUserId: x.sponsor.id,
      transformationLeadUserId: x.lead.id,
      caseForChange: "QA case",
      inScope: "QA in",
      outOfScope: "QA out",
      baselineDate: "2026-01-31",
      targetHorizonValue: 3,
      targetHorizonUnit: "years",
      governanceForum: "QA SteerCo",
      decisionRights: "QA rights",
      successDefinition: "QA success",
      thesisChange: "QA change",
      thesisOutcomes: "QA outcomes",
      thesisBenefits: "QA benefits",
      thesisBecause: "QA because",
    };
    const c = await req("POST", `${x.T}/charter`, x.lead.s, fields);
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.charter).toMatchObject({ ...fields, version: 1 });
    expect(c.body.charter.northStarId).toBeTruthy();
    expect(c.body.northStar.statement).toBe("QA double roaming revenue.");
    // guardrails and top outcomes are linked fields (13th/14th)
    await req("POST", `${x.T}/strategic-guardrails`, x.lead.s, { title: "QA", category: "capex", statement: "QA cap" });
    for (let i = 1; i <= 2; i++)
      expect(
        (await req("POST", `${x.T}/outcomes`, x.lead.s, { statement: `QA top ${i}`, isTopOutcome: true, topRank: i }))
          .status,
      ).toBe(201);
    let v = (await req("GET", `${x.T}/charter`, x.lead.s)).body;
    expect(v.topOutcomes).toHaveLength(2);
    expect(v.guardrails).toHaveLength(1);
    expect((v.warnings as Any[]).map((wn) => wn.code)).toContain("charter.top_outcomes_count");
    for (let i = 3; i <= 4; i++)
      await req("POST", `${x.T}/outcomes`, x.lead.s, { statement: `QA top ${i}`, isTopOutcome: true, topRank: i });
    v = (await req("GET", `${x.T}/charter`, x.lead.s)).body;
    expect(v.topOutcomes).toHaveLength(4);
    expect((v.warnings as Any[]).map((wn) => wn.code)).not.toContain("charter.top_outcomes_count");
    expect(v.scopeCheckPrechecks.length).toBeGreaterThan(0);
    // save -> version 2; history keeps version 1 unchanged
    const u = await req(
      "PATCH",
      `${x.T}/charter`,
      x.lead.s,
      { governanceForum: "QA Board", changeSummary: "QA forum change" },
      ifm(1),
    );
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect(u.body.charter.version).toBe(2);
    const stale = await req("PATCH", `${x.T}/charter`, x.lead.s, { governanceForum: "QA stale" }, ifm(1));
    expect(stale.status).toBe(409);
    const bad = await req("PATCH", `${x.T}/charter`, x.lead.s, { baselineDate: "2026-13-01" }, ifm(2));
    expect(bad.status).toBe(400);
    const versions = (await req("GET", `${x.T}/charter/versions`, x.lead.s)).body.items as Any[];
    expect(versions.map((vv) => vv.versionNo).sort()).toEqual([1, 2]);
    const v1 = (await req("GET", `${x.T}/charter/versions/1`, x.lead.s)).body;
    expect(v1.governanceForum).toBe("QA SteerCo");
    const v2 = (await req("GET", `${x.T}/charter/versions/2`, x.lead.s)).body;
    expect(v2.governanceForum).toBe("QA Board");
    // charter history rows are immutable at the DB level
    let dbErr: unknown = null;
    try {
      await api.db.updateTable("charter_version" as Any).set({ governance_forum: "tamper" } as Any).execute();
    } catch (e) {
      dbErr = e;
    }
    expect(dbErr, "charter_version must reject UPDATE").not.toBeNull();
    // a non-editor (WL) cannot save the charter
    expect((await req("PATCH", `${x.T}/charter`, x.wl.s, { governanceForum: "QA WL" }, ifm(2))).status).toBe(403);
  });
});

describe("QA REQ-PB-033/029 charter North Star after refinement (probe)", () => {
  it("the charter's North Star (field 5) follows the CURRENT North Star after it is refined", async () => {
    const x = await newTx();
    const ns = await req("PUT", `${x.T}/north-star`, x.lead.s, { statement: "QA original star." });
    expect(ns.status).toBe(200);
    expect(
      (await req("POST", `${x.T}/charter`, x.lead.s, { transformationName: "QA", northStarId: ns.body.id })).status,
    ).toBe(201);
    const refined = await req("PUT", `${x.T}/north-star`, x.lead.s, { statement: "QA refined star." }, ifm(1));
    expect(refined.status).toBe(200);
    expect((await req("GET", `${x.T}/north-star`, x.lead.s)).body.statement).toBe("QA refined star.");
    const view = (await req("GET", `${x.T}/charter`, x.lead.s)).body;
    // Observed for the record (asserted below): which North Star the charter shows after refinement.
    console.log(
      "QA-PROBE charter.northStar after refine:",
      JSON.stringify({ charterNorthStarId: view.charter.northStarId, shown: view.northStar }),
    );
    expect(view.northStar?.statement, "charter shows a superseded North Star").toBe("QA refined star.");
  });
});

// ------------------------------------------------------------------------------------------------ good outcome test
describe("QA REQ-PB-036 good outcome test", () => {
  it("'Launch new app' with no KPI fails with reasons; G2 lists it; goodOutcomePass false while unknown; true when all pass", async () => {
    const x = await newTx();
    const bad = await req("POST", `${x.T}/outcomes`, x.lead.s, { statement: "Launch new app", isTopOutcome: true });
    expect(bad.status).toBe(201);
    expect(bad.body.goodOutcomePass).toBe(false);
    const res = Object.fromEntries((bad.body.goodOutcomeTest as Any[]).map((r) => [r.criterionCode, r]));
    expect(Object.keys(res).sort()).toEqual(
      ["causal_chain", "measurable", "owned_by_business_leader", "specific", "strategically_relevant"].sort(),
    );
    expect(res["specific"].result).toBe("fail");
    expect(res["specific"].reason).toMatch(/launch/i);
    expect(res["measurable"].result).toBe("fail");
    expect(res["measurable"].reason).toBeTruthy();
    const g2 = await gateView(x, "G2");
    const ot = crit(g2, "g2.outcome_tree");
    expect(ot.completeness).toBe("incomplete");
    const listed = (ot.missing as Any[]).filter((m) => m.code === "g2.outcome_tree.good_outcome_test_not_passing");
    expect(listed.some((m) => String(m.pointer).includes(bad.body.id))).toBe(true);
    // A well-formed outcome with only system criteria passing but attestations missing is still not a pass (unknown).
    const mid = await req("POST", `${x.T}/outcomes`, x.lead.s, {
      statement: "QA roaming revenue grows 20%",
      ownerUserId: x.bo.id,
    });
    expect(mid.body.goodOutcomePass).toBe(false);
    const kpi = await kpiDef(x);
    expect(
      (
        await req("POST", `${x.T}/outcome-kpis`, x.lead.s, {
          outcomeId: mid.body.id,
          kpiDefinitionId: kpi,
          targetDate: "2027-12-31",
        })
      ).status,
    ).toBe(201);
    let m = (await req("GET", `${x.T}/outcomes/${mid.body.id}`, x.lead.s)).body;
    expect(m.goodOutcomePass).toBe(false);
    expect((m.goodOutcomeTest as Any[]).some((r) => r.result === "unknown")).toBe(true);
    const upd = await req(
      "PATCH",
      `${x.T}/outcomes/${mid.body.id}`,
      x.lead.s,
      { specificConfirmed: true, strategicallyRelevantConfirmed: true, causalChain: "QA bundles -> uptake -> revenue" },
      ifm(m.version),
    );
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    m = (await req("GET", `${x.T}/outcomes/${mid.body.id}`, x.lead.s)).body;
    expect((m.goodOutcomeTest as Any[]).every((r) => r.result === "pass")).toBe(true);
    expect(m.goodOutcomePass).toBe(true);
    // The "Launch" outcome cannot be made to pass by attestation alone (the verb rule is system-checked)
    const b2 = (await req("GET", `${x.T}/outcomes/${bad.body.id}`, x.lead.s)).body;
    const att = await req(
      "PATCH",
      `${x.T}/outcomes/${bad.body.id}`,
      x.lead.s,
      { specificConfirmed: true, strategicallyRelevantConfirmed: true, ownerUserId: x.bo.id, causalChain: "QA" },
      ifm(b2.version),
    );
    expect(att.body.goodOutcomePass).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ North Star
describe("QA REQ-PB-033 one current North Star", () => {
  it("a second concurrent first North Star is refused (409), never two current rows; DB guard holds", async () => {
    const x = await newTx();
    const [a, b] = await Promise.all([
      req("PUT", `${x.T}/north-star`, x.lead.s, { statement: "QA star A." }),
      req("PUT", `${x.T}/north-star`, x.lead.s, { statement: "QA star B." }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([409, 428]).toContain(statuses[1]);
    // second set without If-Match while one exists -> refused (428 per contract), stale If-Match -> 409
    const again = await req("PUT", `${x.T}/north-star`, x.lead.s, { statement: "QA star C." });
    expect([409, 428]).toContain(again.status);
    const ok = await req("PUT", `${x.T}/north-star`, x.lead.s, { statement: "QA star D." }, ifm(1));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const stale = await req("PUT", `${x.T}/north-star`, x.lead.s, { statement: "QA star E." }, ifm(99));
    expect(stale.status).toBe(409);
    const multi = await req("PUT", `${x.T}/north-star`, x.lead.s, { statement: "line1\nline2" }, ifm(1));
    expect(multi.status).toBe(400);
    const rows = await api.db
      .selectFrom("north_star" as Any)
      .select(["status"] as Any)
      .where("transformation_id" as Any, "=", x.id)
      .execute();
    expect(rows.filter((r: Any) => r.status === "current")).toHaveLength(1);
    expect((await req("GET", `${x.T}/north-star`, x.lead.s)).body.statement).toBe("QA star D.");
    const hist = (await req("GET", `${x.T}/north-star/history`, x.lead.s)).body.items as Any[];
    expect(hist.length).toBeGreaterThanOrEqual(2);
  });
});

// ------------------------------------------------------------------------------------------------ baselines / value pools
describe("QA REQ-PB-027/028 baselines and value pools", () => {
  it("unknown is null never 0; Finance validation by non-creator; a later edit makes it stale; unquantified never 0", async () => {
    const x = await newTx();
    const b = await req("POST", `${x.T}/baselines`, x.lead.s, { metric: "QA NPS", unit: "pts", scope: "customer" });
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ value: null, source: null, baselineDate: null, validationStatus: "unvalidated" });
    expect((await req("POST", `${x.T}/baselines`, x.lead.s, { metric: "QA", unit: "x", scope: "nonsense" })).status).toBe(
      400,
    );
    expect(
      (await req("POST", `${x.T}/baselines`, x.lead.s, { metric: "QA", unit: "x", scope: "cost", value: "abc" })).status,
    ).toBe(400);
    const full = await req("POST", `${x.T}/baselines`, x.fin.s, {
      metric: "QA cost",
      unit: "SAR",
      scope: "cost",
      value: "0.10",
      source: "QA ledger",
      baselineDate: "2026-01-31",
    });
    // FIN may or may not create; use the lead's record for validation either way
    const rec = full.status === 201 && full.body.createdBy !== x.fin.id ? full.body : null;
    const base = rec ?? (
      await req("POST", `${x.T}/baselines`, x.lead.s, {
        metric: "QA cost",
        unit: "SAR",
        scope: "cost",
        value: "0.10",
        source: "QA ledger",
        baselineDate: "2026-01-31",
      })
    ).body;
    expect(decEq(base.value, "0.10")).toBe(true);
    // not FIN -> 403; FIN validates
    const notFin = await req(
      "POST",
      `${x.T}/baselines/${base.id}/validation`,
      x.wl.s,
      { result: "validated", note: "QA" },
      ifm(base.version),
    );
    expect(notFin.status).toBe(403);
    const val = await req(
      "POST",
      `${x.T}/baselines/${base.id}/validation`,
      x.fin.s,
      { result: "validated", note: "QA checked" },
      ifm(base.version),
    );
    expect(val.status, JSON.stringify(val.body)).toBe(200);
    expect(val.body).toMatchObject({ validationStatus: "validated", validatedBy: x.fin.id });
    expect(val.body.validatedRecordVersion).toBe(val.body.version);
    const edited = await req("PATCH", `${x.T}/baselines/${base.id}`, x.lead.s, { value: "0.11" }, ifm(val.body.version));
    expect(edited.status).toBe(200);
    expect(edited.body.validatedRecordVersion).toBeLessThan(edited.body.version); // stale
    // the creator never validates own record (FIN+creator)
    const finOwn = await req("POST", `${x.T}/baselines`, x.fin.s, { metric: "QA own", unit: "x", scope: "cost" });
    if (finOwn.status === 201) {
      const self = await req(
        "POST",
        `${x.T}/baselines/${finOwn.body.id}/validation`,
        x.fin.s,
        { result: "validated", note: "QA self" },
        ifm(1),
      );
      expect([403, 422]).toContain(self.status);
    }
    // value pools
    const un = await req("POST", `${x.T}/value-pools`, x.lead.s, {
      name: "QA unquantified",
      quantificationStatus: "unquantified",
      unquantifiedReason: "QA",
    });
    expect(un.status).toBe(201);
    expect(un.body).toMatchObject({ quantificationStatus: "unquantified", upsideAmount: null, downsideAmount: null });
    const zeroUn = await req("POST", `${x.T}/value-pools`, x.lead.s, {
      name: "QA bad",
      quantificationStatus: "unquantified",
      upsideAmount: "0",
    });
    expect([400, 422]).toContain(zeroUn.status);
    const q = await req("POST", `${x.T}/value-pools`, x.lead.s, {
      name: "QA quantified",
      quantificationStatus: "quantified",
      driver: "QA price",
      upsideAmount: "2500000.50",
      downsideAmount: "1000000",
      materiality: "material",
      confidence: "M",
    });
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    expect(q.body.currency).toBe("SAR");
    expect(decEq(q.body.upsideAmount, "2500000.50")).toBe(true);
    expect(decEq(q.body.downsideAmount, "1000000")).toBe(true);
    const vUn = await req(
      "POST",
      `${x.T}/value-pools/${un.body.id}/validation`,
      x.fin.s,
      { result: "validated", note: "QA" },
      ifm(1),
    );
    expect(vUn.status).toBe(422);
    const vq = await req(
      "POST",
      `${x.T}/value-pools/${q.body.id}/validation`,
      x.fin.s,
      { result: "validated", note: "QA" },
      ifm(1),
    );
    expect(vq.status, JSON.stringify(vq.body)).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------------ gates
describe("QA REQ-PB-016/017/018 REQ-S13-012 REQ-S04-003/004/005 product gates", () => {
  it("G1 without a charter is rejected listing the charter; filename-only and inaccessible evidence stay incomplete", async () => {
    const x = await newTx();
    const base = await g1Base(x, false);
    const fileRef = await req("POST", `${x.T}/evidence`, x.lead.s, {
      kind: "file_reference",
      title: "QA filename only",
      fileName: "diagnostic.xlsx",
      ownerUserId: x.lead.id,
    });
    expect(fileRef.status, JSON.stringify(fileRef.body)).toBe(201);
    // A filename can never be "verified"
    const tryVerify = await req(
      "POST",
      `${x.T}/evidence/${fileRef.body.id}/review`,
      office,
      { result: "verified", accessibilityStatus: "accessible", note: "QA" },
      ifm(fileRef.body.version),
    );
    expect(tryVerify.status).toBeGreaterThanOrEqual(400);
    const link = await req("POST", `${x.T}/evidence`, x.lead.s, {
      kind: "external_link",
      title: "QA dead link",
      url: "https://intranet.invalid/x",
      ownerUserId: x.lead.id,
    });
    expect(link.status).toBe(201);
    const inacc = await req(
      "POST",
      `${x.T}/evidence/${link.body.id}/review`,
      office,
      { result: "rejected", accessibilityStatus: "inaccessible", note: "QA cannot open" },
      ifm(link.body.version),
    );
    expect(inacc.status, JSON.stringify(inacc.body)).toBe(200);
    // verified + inaccessible is not allowed
    await linkEvidence(x, fileRef.body.id, base);
    await linkEvidence(x, link.body.id, base);
    const g1 = await gateView(x, "G1");
    expect(crit(g1, "g1.initial_charter").completeness).toBe("incomplete");
    const diag = crit(g1, "g1.diagnostic");
    expect(diag.completeness).toBe("incomplete");
    expect(diag.unverifiedEvidenceIds).toEqual(expect.arrayContaining([fileRef.body.id, link.body.id]));
    expect(g1.canSubmit).toBe(false);
    const sub = await req("POST", `${x.T}/gates/G1/submissions`, x.lead.s, {}, ifm(g1.gate.version));
    expect(sub.status).toBe(422);
    const errs = JSON.stringify(sub.body.errors ?? sub.body);
    expect(errs).toContain("g1.initial_charter");
    expect(errs).toContain("g1.diagnostic");
    // gate is a business approval, not a DG
    expect(JSON.stringify(g1.definition)).not.toMatch(/\bDG[0-7]\b/);
  });

  it("non-approver 403, submitter 403, superseded submission 409, approval advances the phase; G2 without guardrails rejected", async () => {
    const x = await newTx();
    await grant(api.db, w.grantor.id, x.lead.id, "SP", { type: "transformation", id: x.id }, w.orgA.id); // lead also SP
    const base = await g1Base(x, true);
    await linkEvidence(x, await verifiedNote(x, office), base);
    let g1 = await gateView(x, "G1");
    expect(g1.criteria.filter((c: Any) => c.mandatory && c.completeness !== "complete")).toEqual([]);
    const s1 = await req("POST", `${x.T}/gates/G1/submissions`, x.lead.s, { submissionNote: "QA 1" }, ifm(g1.gate.version));
    expect(s1.status, JSON.stringify(s1.body)).toBe(201);
    g1 = await gateView(x, "G1");
    const s2 = await req("POST", `${x.T}/gates/G1/submissions`, x.lead.s, { submissionNote: "QA 2" }, ifm(g1.gate.version));
    expect(s2.status, JSON.stringify(s2.body)).toBe(201);
    const subs = (await req("GET", `${x.T}/gates/G1/submissions`, x.lead.s)).body.items as Any[];
    expect(subs.find((s) => s.submissionNo === 1).status).toBe("superseded");
    // concurrent submit with the same (stale) If-Match -> 409
    const staleSub = await req("POST", `${x.T}/gates/G1/submissions`, x.lead.s, {}, ifm(g1.gate.version));
    expect(staleSub.status).toBe(409);
    const decide = (s: Session, n: number, outcome = "approved") =>
      req("POST", `${x.T}/gates/G1/decision`, s, { submissionNo: n, outcome, rationale: "QA synthetic demo decision" });
    const wlTry = await decide(x.wl.s, 2);
    expect(wlTry.status).toBe(403);
    expect(wlTry.body.code).toBe("gate.not_approver");
    const finTry = await decide(x.fin.s, 2);
    expect(finTry.status).toBe(403);
    const self = await decide(x.lead.s, 2);
    expect(self.status).toBe(403);
    expect(self.body.code).toBe("gate.submitter_cannot_decide");
    const aud = await decide(auditor, 2);
    expect(aud.status).toBe(403);
    const superseded = await decide(x.sponsor.s, 1);
    expect(superseded.status).toBe(409);
    expect(superseded.body.code).toBe("gate.submission_superseded");
    const before = (await req("GET", x.T, x.lead.s)).body;
    expect(before.currentPhase).toBe("diagnose");
    const ok = await decide(x.sponsor.s, 2);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const after = (await req("GET", x.T, x.lead.s)).body;
    expect(after.currentPhase).toBe("define");
    expect((await decide(x.sponsor.s, 2)).status).toBe(409); // already decided
    // canonical decision row kind gate
    const gd = (await req("GET", `/api/v1/decisions?transformationId=${x.id}&kind=gate`, x.lead.s)).body.items as Any[];
    expect(gd.length).toBe(1);
    expect(gd[0].code).toMatch(/^GD-\d+/);

    // G2 without guardrails
    const g2 = await gateView(x, "G2");
    expect(crit(g2, "g2.guardrails").completeness).toBe("incomplete");
    const g2s = await req("POST", `${x.T}/gates/G2/submissions`, x.lead.s, {}, ifm(g2.gate.version));
    expect(g2s.status).toBe(422);
    expect(JSON.stringify(g2s.body)).toContain("g2.guardrails");
    // G3 without future journey
    const g3 = await gateView(x, "G3");
    expect(crit(g3, "g3.future_journeys").completeness).toBe("incomplete");
    // G4-G6 not enabled in P2
    const g4 = await gateView(x, "G4");
    expect(g4.submissionEnabled).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ roles / access
const B0018: Record<string, string> = {
  SP: "Owns enterprise outcome, removes constraints, approves major trade-offs.",
  TL: "Integrates workstreams, drives cadence, ensures outcome realization.",
  BO: "Own target-state capabilities and BAU adoption.",
  WL: "Deliver initiatives and manage dependencies.",
  FIN: "Validates baseline, benefit logic, value realization.",
  TO: "Governance, reporting, risks, dependencies, decisions, standards.",
};

describe("QA REQ-S10-001 / REQ-PB-012 roles and access", () => {
  it("exposes the expanded role catalogue and B0018 accountability text verbatim", async () => {
    const roles = (await req("GET", "/api/v1/roles", office)).body.items as Any[];
    const codes = roles.map((r) => r.code);
    for (const c of ["SP", "TL", "BO", "WL", "FIN", "TO", "KDS", "TD", "CM", "SEC", "AUD", "ADM_TECH", "ADM_ACCESS"])
      expect(codes).toContain(c);
    const acc = (await req("GET", "/api/v1/role-accountabilities", office)).body.items as Any[];
    for (const [code, text] of Object.entries(B0018)) {
      const a = acc.find((r) => r.roleCode === code);
      expect(a, code).toBeTruthy();
      expect(a.accountabilityEn).toBe(text);
      expect(a.isSourceText).toBe(true);
      expect(a.sourceRef).toContain("B0018");
      expect(a.accountabilityAr.length).toBeGreaterThan(0);
    }
  });

  it("a Workstream Lead on X cannot read Y; AUD is read-only on every P2 mutation sampled", async () => {
    const x = await newTx();
    const y = await newTx();
    const own = await req("GET", `${x.T}/diagnostic-items`, x.wl.s);
    expect(own.status).toBe(200);
    for (const path of ["", "/diagnostic-items", "/charter", "/outcomes", "/gates", "/evidence", "/tom-canvas"]) {
      const r = await req("GET", `${y.T}${path}`, x.wl.s);
      expect(r.status, `WL(X) GET Y${path}`).toBe(404);
    }
    const list = (await req("GET", "/api/v1/transformations", x.wl.s)).body.items as Any[];
    expect(list.map((t) => t.id)).not.toContain(y.id);
    // AUD reads X but every mutation is 403
    expect((await req("GET", `${x.T}/diagnostic-items`, auditor)).status).toBe(200);
    const item = ((await req("GET", `${x.T}/diagnostic-items`, auditor)).body.items as Any[])[0];
    const muts: [string, string, unknown, Record<string, string>?][] = [
      ["POST", `${x.T}/outcomes`, { statement: "AUD" }],
      ["POST", `${x.T}/strategic-guardrails`, { title: "A", category: "capex", statement: "A" }],
      ["POST", `${x.T}/baselines`, { metric: "A", unit: "x", scope: "cost" }],
      ["POST", `${x.T}/value-pools`, { name: "A" }],
      ["POST", `${x.T}/diagnostic-findings`, { workstreamCode: "customer", kind: "symptom", statement: "A" }],
      ["PATCH", `${x.T}/diagnostic-items/${item.id}`, { confidence: "H" }, ifm(item.version)],
      ["POST", `${x.T}/charter`, { transformationName: "A" }],
      ["PUT", `${x.T}/north-star`, { statement: "A." }],
      ["POST", `${x.T}/tom-gaps`, { dimensionCode: "technology" }],
      ["POST", `${x.T}/capability-heatmap`, { name: "A", currentLevel: 1, targetLevel: 2 }],
      ["POST", `${x.T}/journeys`, { name: "A", kind: "journey", state: "future", steps: [] }],
      ["POST", `${x.T}/evidence`, { kind: "note", title: "A", noteBody: "A", ownerUserId: w.auditor.id }],
      ["POST", "/api/v1/decisions", { transformationId: x.id, title: "A" }],
      ["POST", `${x.T}/tom-workshops`, { title: "A", workshopDate: "2026-11-01", durationMinutes: 90 }],
      ["POST", `${x.T}/kpi-definitions`, { name: "A", unitKind: "count", polarity: "higher_is_better" }],
      ["POST", `${x.T}/scoped-assignments`, { userId: w.nobody.id, roleCode: "WL", reason: "AUD try" }],
      ["POST", `${x.T}/gates/G1/submissions`, {}, ifm(1)],
      ["PATCH", "/api/v1/methodology/tom-dimensions/technology", { labelEn: "A" }, ifm(1)],
    ];
    for (const [m, u, body, h] of muts) {
      const r = await req(m, u, auditor, body, h);
      expect(r.status, `AUD ${m} ${u}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(403);
    }
  });
});

// ------------------------------------------------------------------------------------------------ modes
describe("QA REQ-PB-003 End-to-End / Modular", () => {
  it("Modular requires an entry phase; End-to-End rejects one", async () => {
    // TL does not inherit downward (role catalogue), so grant it at the business unit, as for every TL here.
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
    const lead = { id: u.id, s: await signIn(api.app, u.subject) };
    const mk = (b: Record<string, unknown>) =>
      req("POST", "/api/v1/transformations", lead.s, { businessUnitId: w.a1, name: "QA mode", ...b });
    expect((await mk({ mode: "modular" })).status).toBe(400);
    expect((await mk({ mode: "end_to_end", entryPhase: "design" })).status).toBe(400);
    expect((await mk({ mode: "sideways" })).status).toBe(400);
    const m = await mk({ mode: "modular", entryPhase: "design" });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    expect(m.body).toMatchObject({ mode: "modular", entryPhase: "design" });
    const e = await mk({ mode: "end_to_end" });
    expect(e.body).toMatchObject({ mode: "end_to_end", entryPhase: null, currentPhase: "diagnose" });
  });
});

// ------------------------------------------------------------------------------------------------ TOM / design
describe("QA REQ-PB-023/024/025/038/041/042 REQ-S05-003 TOM and design", () => {
  it("methodology: six workstreams, ten TOM dimensions with design questions; canvas has ten boxes with linked records", async () => {
    const x = await newTx();
    const meth = (await req("GET", `${x.T}/methodology`, x.lead.s)).body;
    expect(meth.tomDimensions).toHaveLength(10);
    for (const d of meth.tomDimensions as Any[]) {
      expect(JSON.stringify(d)).toMatch(/question/i);
      expect(d.labelAr ?? d.labelEn).toBeTruthy();
    }
    const ws = meth.workstreams ?? meth.diagnosticWorkstreams;
    expect(ws, `methodology keys: ${Object.keys(meth)}`).toBeTruthy();
    expect(ws).toHaveLength(6);
    const canvas = (await req("GET", `${x.T}/tom-canvas`, x.lead.s)).body;
    const cells = canvas.cells ?? canvas.items ?? canvas;
    expect(cells).toHaveLength(10);
    // linked records: gap + decision + dependency + evidence show in the dimension view
    const d = await req("POST", "/api/v1/decisions", x.lead.s, {
      transformationId: x.id,
      title: "QA tech decision",
      tomDimensionCode: "technology",
    });
    await req("POST", `${x.T}/tom-gaps`, x.lead.s, { dimensionCode: "technology", designDecisionId: d.body.id });
    await req("POST", `${x.T}/dependencies`, x.lead.s, {
      description: "QA dep",
      fromKind: "tom_dimension",
      toKind: "external",
      toLabel: "QA vendor",
      dependencyType: "vendor",
      tomDimensionCode: "technology",
    });
    const cell = (await req("GET", `${x.T}/tom-canvas/technology`, x.lead.s)).body;
    expect(cell.gaps.length).toBe(1);
    expect(cell.decisions.length).toBe(1);
    expect(cell.dependencies.length).toBe(1);
    expect(Array.isArray(cell.evidence)).toBe(true);
    const noOwner = await req("PATCH", `${x.T}/tom-canvas/technology`, x.lead.s, { status: "ready" }, ifm(cell.cell.version));
    expect([400, 422]).toContain(noOwner.status);
    // no-owner dimensions flagged in G3 readiness
    const g3 = await gateView(x, "G3");
    expect(crit(g3, "g3.target_operating_model").completeness).toBe("incomplete");
  });

  it("capability heatmap (build/buy/partner), journeys with pain points, workshop conversion to an owned T04 decision", async () => {
    const x = await newTx();
    const cap = await req("POST", `${x.T}/capability-heatmap`, x.lead.s, {
      name: "QA rating",
      currentLevel: 1,
      targetLevel: 4,
      sourcingNeed: "partner",
    });
    expect(cap.status, JSON.stringify(cap.body)).toBe(201);
    expect(cap.body).toMatchObject({ currentLevel: 1, targetLevel: 4, sourcingNeed: "partner" });
    expect(
      (await req("POST", `${x.T}/capability-heatmap`, x.lead.s, { name: "QA", currentLevel: 1, targetLevel: 2, sourcingNeed: "steal" }))
        .status,
    ).toBe(400);
    const key = "01920099-0000-7000-8000-0000000000aa";
    const j = await req("POST", `${x.T}/journeys`, x.lead.s, {
      name: "QA activation",
      kind: "journey",
      state: "future",
      steps: [{ key, ordinal: 1, name: "Activate", actor: "Customer", systems: ["App"] }],
    });
    expect(j.status, JSON.stringify(j.body)).toBe(201);
    const pp = await req("POST", `${x.T}/journeys/${j.body.id}/pain-points`, x.lead.s, { description: "QA wait", stepKey: key });
    expect(pp.status, JSON.stringify(pp.body)).toBe(201);
    const g3 = await gateView(x, "G3");
    expect(crit(g3, "g3.future_journeys").completeness).toBe("complete");
    const ws = await req("POST", `${x.T}/tom-workshops`, x.lead.s, {
      title: "QA workshop",
      workshopDate: "2026-11-02",
      durationMinutes: 120,
      facilitatorUserId: x.lead.id,
    });
    expect(ws.status).toBe(201);
    const W = `${x.T}/tom-workshops/${ws.body.id}`;
    const item = await req("POST", `${W}/items`, x.lead.s, { kind: "unresolved", body: "QA who owns?", dimensionCode: "governance_decision_rights" });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    expect((await req("PATCH", W, x.lead.s, { status: "closed" }, ifm(1))).status).toBe(422);
    const conv = await req(
      "POST",
      `${W}/items/${item.body.id}/convert`,
      x.lead.s,
      { target: "design_decision", title: "QA owner decision", ownerUserId: x.bo.id },
      ifm(1),
    );
    expect(conv.status, JSON.stringify(conv.body)).toBe(200);
    const decs = (await req("GET", `/api/v1/decisions?transformationId=${x.id}&kind=design`, x.lead.s)).body.items as Any[];
    const dd = decs.find((d) => d.title === "QA owner decision");
    expect(dd).toMatchObject({ status: "open", ownerUserId: x.bo.id, code: "D-01" });
    // a second conversion of the same item is refused
    expect(
      (
        await req(
          "POST",
          `${W}/items/${item.body.id}/convert`,
          x.lead.s,
          { target: "design_decision", title: "QA dup", ownerUserId: x.bo.id },
          ifm(conv.body.version),
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
  });
});

// ------------------------------------------------------------------------------------------------ entity group
describe("QA REQ-S16-013 diagnosis/direction entity group", () => {
  it("creates and reads each entity through the API; out-of-scope readers get 404; audit event per create", async () => {
    const x = await newTx();
    const outsider = await signIn(api.app, w.officeB.subject);
    const creates: [string, Record<string, unknown>][] = [
      ["diagnostic-findings", { workstreamCode: "customer", kind: "symptom", statement: "QA churn" }],
      ["baselines", { metric: "QA", unit: "x", scope: "operational" }],
      ["evidence", { kind: "note", title: "QA", noteBody: "QA", ownerUserId: x.lead.id }],
      ["value-pools", { name: "QA pool" }],
      ["outcomes", { statement: "QA outcome" }],
      ["strategic-guardrails", { title: "QA", category: "regulatory", statement: "QA" }],
    ];
    for (const [path, body] of creates) {
      const c = await req("POST", `${x.T}/${path}`, x.lead.s, body);
      expect(c.status, `${path}: ${JSON.stringify(c.body)}`).toBe(201);
      const g = await req("GET", `${x.T}/${path}/${c.body.id}`, x.lead.s);
      expect(g.status).toBe(200);
      expect(g.body.id).toBe(c.body.id);
      expect((await req("GET", `${x.T}/${path}/${c.body.id}`, outsider)).status).toBe(404);
      expect((await req("GET", `${x.T}/${path}/${c.body.id}`, x.wl.s)).status).toBe(200);
      const audit = await api.db
        .selectFrom("audit_event" as Any)
        .select(["action"] as Any)
        .where("record_id" as Any, "=", c.body.id)
        .execute();
      expect(audit.length, `${path} audit`).toBeGreaterThanOrEqual(1);
    }
  });
});
