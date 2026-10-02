// qa-verifier DG2 round 1 — independent end-to-end WORKFLOW test of the Diagnose -> Define -> Design journey through
// the native API (REQ-DLV-034, REQ-S04-003/004/005, REQ-PB-016/017/018). Authored by qa-verifier. Every step uses only
// public API operations (docs/api/openapi.yaml) as the role the permissions matrix names; NO direct database writes are
// used to complete any gate output, so a gap in the native workflow shows up as a failure here.
// Run in a disposable clone (copy to tests/qa/integration/):
//   QA_PG_PORT=<port> tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/dg2-qa-journey.test.ts
// All data is SYNTHETIC; gate approvals are demo business decisions on synthetic data (product gates G1-G3, never DGx).
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

interface Actor {
  id: string;
  s: Session;
}
let T = "";
let tid = "";
let lead: Actor, sponsor: Actor, kds: Actor, bo: Actor, office: Session;

async function actor(role: string, scope: { type: "transformation" | "business_unit"; id: string }): Promise<Actor> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, role, scope, w.orgA.id);
  return { id: u.id, s: await signIn(api.app, u.subject) };
}
async function gate(code: string) {
  return ok(await req("GET", `${T}/gates/${code}`, lead.s), 200, `getGate ${code}`);
}
function incomplete(view: Any) {
  return (view.criteria as Any[])
    .filter((c) => c.mandatory && c.completeness !== "complete")
    .map((c) => ({ key: c.key, missing: (c.missing as Any[]).map((m) => m.code) }));
}
async function submitAndApprove(code: string) {
  const v = await gate(code);
  const sub = ok(
    await req("POST", `${T}/gates/${code}/submissions`, lead.s, { submissionNote: `QA ${code}` }, ifm(v.gate.version)),
    201,
    `submit ${code}`,
  );
  ok(
    await req("POST", `${T}/gates/${code}/decision`, sponsor.s, {
      submissionNo: sub.submissionNo,
      outcome: "approved",
      rationale: `QA synthetic demo approval of ${code}`,
    }),
    201,
    `decide ${code}`,
  );
}
const phase = async () => ok(await req("GET", T, lead.s), 200, "getTransformation").currentPhase;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  lead = await actor("TL", { type: "business_unit", id: w.a1 });
  const t = ok(
    await req("POST", "/api/v1/transformations", lead.s, { businessUnitId: w.a1, name: "QA journey", mode: "end_to_end" }),
    201,
    "createTransformation",
  );
  tid = t.id;
  T = `/api/v1/transformations/${tid}`;
  sponsor = await actor("SP", { type: "transformation", id: tid });
  kds = await actor("KDS", { type: "transformation", id: tid });
  bo = await actor("BO", { type: "transformation", id: tid });
});
afterAll(async () => {
  await api?.close();
});

/** Diagnose outputs (G1) through the API. */
async function diagnose() {
  ok(
    await req("POST", `${T}/charter`, lead.s, {
      transformationName: "QA journey",
      executiveSponsorUserId: sponsor.id,
      transformationLeadUserId: lead.id,
      caseForChange: "QA case for change",
      inScope: "QA in scope",
      outOfScope: "QA out of scope",
      baselineDate: "2026-01-31",
    }),
    201,
    "createCharter",
  );
  const b = ok(
    await req("POST", `${T}/baselines`, lead.s, {
      metric: "QA revenue",
      unit: "SAR",
      scope: "revenue",
      value: "1000000",
      currency: "SAR",
      source: "QA ledger",
      baselineDate: "2026-01-31",
    }),
    201,
    "createBaseline",
  );
  ok(
    await req("POST", `${T}/value-pools`, lead.s, {
      name: "QA pool",
      quantificationStatus: "unquantified",
      unquantifiedReason: "QA",
      materiality: "material",
    }),
    201,
    "createValuePool",
  );
  ok(
    await req("POST", `${T}/diagnostic-findings`, lead.s, {
      workstreamCode: "business_financial",
      kind: "root_cause",
      statement: "QA root cause",
      status: "confirmed",
    }),
    201,
    "createDiagnosticFinding",
  );
  const e = ok(
    await req("POST", `${T}/evidence`, lead.s, { kind: "note", title: "QA notes", noteBody: "QA", ownerUserId: lead.id }),
    201,
    "createEvidence",
  );
  ok(
    await req(
      "POST",
      `${T}/evidence/${e.id}/review`,
      office,
      { result: "verified", accessibilityStatus: "accessible", note: "QA" },
      ifm(e.version),
    ),
    200,
    "reviewEvidence",
  );
  const items = ok(await req("GET", `${T}/diagnostic-items?limit=50`, lead.s), 200, "listDiagnosticItems").items as Any[];
  for (const i of items) {
    ok(
      await req(
        "PATCH",
        `${T}/diagnostic-items/${i.id}`,
        lead.s,
        { currentState: "QA", rootCause: "QA", impactText: "QA", confidence: "M" },
        ifm(i.version),
      ),
      200,
      "updateDiagnosticItem",
    );
    ok(
      await req("POST", `${T}/evidence-links`, lead.s, { evidenceId: e.id, recordType: "diagnostic_item", recordId: i.id }),
      201,
      "link",
    );
  }
  ok(
    await req("POST", `${T}/evidence-links`, lead.s, { evidenceId: e.id, recordType: "baseline", recordId: b.id }),
    201,
    "link baseline",
  );
}

/** Define outputs (G2) through the API, as TL / KDS / SP per the permissions matrix. */
async function define() {
  ok(await req("PUT", `${T}/north-star`, lead.s, { statement: "QA double roaming revenue by 2028." }), 200, "setNorthStar");
  ok(
    await req("POST", `${T}/strategic-guardrails`, lead.s, { title: "QA", category: "capex", statement: "QA cap" }),
    201,
    "createGuardrail",
  );
  const kpi = ok(
    await req("POST", `${T}/kpi-definitions`, kds.s, {
      name: "QA roaming revenue",
      unitKind: "currency",
      currency: "SAR",
      polarity: "higher_is_better",
      ownerUserId: bo.id,
    }),
    201,
    "createKpiDefinition",
  );
  for (let i = 1; i <= 3; i++) {
    const o = ok(
      await req("POST", `${T}/outcomes`, lead.s, {
        statement: `QA roaming revenue grows ${i * 10}%`,
        isTopOutcome: true,
        topRank: i,
        ownerUserId: bo.id,
        specificConfirmed: true,
        strategicallyRelevantConfirmed: true,
        causalChain: "QA bundles -> uptake -> revenue",
      }),
      201,
      "createOutcome",
    );
    const row = ok(
      await req("POST", `${T}/outcome-kpis`, kds.s, {
        outcomeId: o.id,
        kpiDefinitionId: kpi.id,
        baselineValue: "1000000",
        targetValue: "1500000",
        targetDate: "2027-12-31",
        ownerUserId: bo.id,
        leadingIndicatorText: "QA weekly activations",
        trajectoryPoints: [
          { date: "2026-12-31", value: "1200000" },
          { date: "2027-12-31", value: "1500000" },
        ],
      }),
      201,
      "createOutcomeKpi",
    );
    ok(
      await req("POST", `${T}/outcome-kpis/${row.id}/trajectory-approval`, sponsor.s, { note: "QA" }, ifm(row.version)),
      200,
      "approveTrajectory",
    );
  }
  return kpi;
}

/** Design outputs (G3) through the API. */
async function design() {
  const canvas = ok(await req("GET", `${T}/tom-canvas`, lead.s), 200, "getTomCanvas");
  const cells = (canvas.cells ?? canvas.items) as Any[];
  for (const c of cells) {
    const code = c.dimensionCode ?? c.cell?.dimensionCode;
    const cur = ok(await req("GET", `${T}/tom-canvas/${code}`, lead.s), 200, "getTomCanvasCell");
    ok(
      await req(
        "PATCH",
        `${T}/tom-canvas/${code}`,
        lead.s,
        { targetDesign: `QA target ${code}`, ownerUserId: bo.id, status: "ready" },
        ifm(cur.cell.version),
      ),
      200,
      `updateTomCanvasCell ${code}`,
    );
  }
  const d = ok(
    await req("POST", "/api/v1/decisions", lead.s, { transformationId: tid, title: "QA decision", ownerUserId: bo.id }),
    201,
    "createDecision",
  );
  ok(
    await req("POST", `${T}/tom-gaps`, lead.s, {
      dimensionCode: "technology",
      currentState: "QA",
      targetState: "QA",
      gap: "QA",
      designDecisionId: d.id,
      ownerUserId: bo.id,
    }),
    201,
    "createTomGap",
  );
  ok(
    await req("POST", `${T}/capability-heatmap`, lead.s, { name: "QA cap", currentLevel: 1, targetLevel: 3, sourcingNeed: "buy" }),
    201,
    "createCapability",
  );
  ok(
    await req("POST", `${T}/journeys`, lead.s, {
      name: "QA future journey",
      kind: "journey",
      state: "future",
      steps: [{ key: "01920099-0000-7000-8000-0000000000bb", ordinal: 1, name: "QA step" }],
    }),
    201,
    "createJourney",
  );
}

describe("QA REQ-DLV-034 Diagnose -> Define -> Design through native workflows", () => {
  it("G1: complete through the API, submit, approve -> phase define", async () => {
    expect(await phase()).toBe("diagnose");
    await diagnose();
    expect(incomplete(await gate("G1"))).toEqual([]);
    await submitAndApprove("G1");
    expect(await phase()).toBe("define");
  });

  it("G2: every Define output can be completed through the API (no direct DB writes)", async () => {
    const kpi = await define();
    const view = await gate("G2");
    const open = incomplete(view);
    console.log("QA-JOURNEY G2 incomplete mandatory criteria:", JSON.stringify(open));
    // Probe the only plausible native ways to activate the KPI definition the T02 rows use:
    const patchActive = await req("PATCH", `${T}/kpi-definitions/${kpi.id}`, kds.s, { status: "active" }, ifm(kpi.version));
    console.log("QA-JOURNEY PATCH kpi-definition {status:active} ->", patchActive.status, patchActive.body?.code);
    const createActive = await req("POST", `${T}/kpi-definitions`, kds.s, {
      name: "QA active at create",
      unitKind: "count",
      polarity: "higher_is_better",
      status: "active",
    });
    console.log("QA-JOURNEY POST kpi-definition {status:active} ->", createActive.status, createActive.body?.code);
    const k = ok(await req("GET", `${T}/kpi-definitions/${kpi.id}`, kds.s), 200, "getKpiDefinition");
    console.log("QA-JOURNEY kpi-definition status after the Define steps:", k.status);
    expect(open, "G2 must be completable through native workflows").toEqual([]);
    await submitAndApprove("G2");
    expect(await phase()).toBe("design");
  });

  it("G3: every Design output can be completed through the API; approval advances the phase", async () => {
    await design();
    const open = incomplete(await gate("G3"));
    console.log("QA-JOURNEY G3 incomplete mandatory criteria:", JSON.stringify(open));
    expect(open).toEqual([]);
    const before = await phase();
    await submitAndApprove("G3");
    const after = await phase();
    console.log("QA-JOURNEY phase before/after G3 approval:", before, after);
    expect(after).toBe("mobilize");
  });
});
