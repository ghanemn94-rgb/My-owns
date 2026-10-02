// qa-verifier DG2 round 2 — independent re-verification of F-DG2-201/203/204/205 through the native API only.
// Authored by qa-verifier (no product code). Diagnose -> Define -> Design to a G2 and G3 decision on an End-to-End
// transformation, with negative probes for KPI activation (permission, concurrency, already-active) and gate sequence.
// Run in a disposable clone (copy to tests/qa/integration/):
//   QA_PG_PORT=<port> tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose tests/qa/integration/dg2-qa-journey-r2.test.ts
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
const etag = (r: Any) => String(r.headers?.etag ?? "").replace(/"/g, "");

interface Actor {
  id: string;
  s: Session;
}
let T = "";
let tid = "";
let lead: Actor, sponsor: Actor, kds: Actor, bo: Actor, office: Session;
let kpi: Any;
let firstStar: Any;

async function actor(role: string, scope: { type: "transformation" | "business_unit"; id: string }): Promise<Actor> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, role, scope, w.orgA.id);
  return { id: u.id, s: await signIn(api.app, u.subject) };
}
const gate = async (code: string, t = T) => ok(await req("GET", `${t}/gates/${code}`, lead.s), 200, `getGate ${code}`);
function incomplete(view: Any) {
  return (view.criteria as Any[])
    .filter((c) => c.mandatory && c.completeness !== "complete")
    .map((c) => ({ key: c.key, missing: (c.missing as Any[]).map((m) => m.code) }));
}
async function submit(code: string, t = T) {
  const v = await gate(code, t);
  return req("POST", `${t}/gates/${code}/submissions`, lead.s, { submissionNote: `QA ${code}` }, ifm(v.gate.version));
}
async function approve(code: string, submissionNo: number, t = T) {
  return req("POST", `${t}/gates/${code}/decision`, sponsor.s, {
    submissionNo,
    outcome: "approved",
    rationale: `QA synthetic demo approval of ${code}`,
  });
}
async function submitAndApprove(code: string) {
  const sub = ok(await submit(code), 201, `submit ${code}`);
  ok(await approve(code, sub.submissionNo), 201, `decide ${code}`);
}
const phaseOf = async (t = T) => ok(await req("GET", t, lead.s), 200, "getTransformation").currentPhase;
const auditCount = async (action: string, recordId: string) =>
  Number(
    (
      await api.db
        .selectFrom("audit_event")
        .select((eb: Any) => eb.fn.countAll().as("n"))
        .where("action", "=", action)
        .where("record_id", "=", recordId)
        .executeTakeFirstOrThrow()
    ).n,
  );

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  lead = await actor("TL", { type: "business_unit", id: w.a1 });
  const t = ok(
    await req("POST", "/api/v1/transformations", lead.s, { businessUnitId: w.a1, name: "QA journey r2", mode: "end_to_end" }),
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

/** Diagnose outputs (G1) through the API; the charter links the FIRST North Star (to probe F-DG2-204 later). */
async function diagnose() {
  firstStar = ok(await req("PUT", `${T}/north-star`, lead.s, { statement: "QA original star." }), 200, "setNorthStar 1");
  ok(
    await req("POST", `${T}/charter`, lead.s, {
      transformationName: "QA journey r2",
      executiveSponsorUserId: sponsor.id,
      transformationLeadUserId: lead.id,
      caseForChange: "QA case for change",
      northStarId: firstStar.id,
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

describe("QA r2 F-DG2-205 sequence (REQ-S04-005): before G1 is approved", () => {
  it("G2 and G3 submissions are refused 422 gate.out_of_sequence while G1 is unapproved; phase unchanged", async () => {
    expect(await phaseOf()).toBe("diagnose");
    for (const code of ["G2", "G3"]) {
      const before = await gate(code);
      const r = await submit(code);
      console.log(`QA-R2 submit ${code} while G1 unapproved ->`, r.status, r.body?.code);
      expect([r.status, r.body?.code]).toEqual([422, "gate.out_of_sequence"]);
      const after = await gate(code);
      expect(after.gate.version).toBe(before.gate.version);
      expect(after.gate.status).toBe(before.gate.status);
    }
    expect(await phaseOf()).toBe("diagnose");
  });
});

describe("QA r2 Diagnose -> Define -> Design through native workflows (F-DG2-201, REQ-DLV-034, REQ-PB-017)", () => {
  it("G1: complete through the API, submit, approve -> phase define (exactly one step)", async () => {
    await diagnose();
    expect(incomplete(await gate("G1"))).toEqual([]);
    await submitAndApprove("G1");
    expect(await phaseOf()).toBe("define");
  });

  it("F-DG2-205: G3 cannot be submitted while G2 is unapproved (422), nothing written", async () => {
    const before = await gate("G3");
    const r = await submit("G3");
    console.log("QA-R2 submit G3 while G2 unapproved ->", r.status, r.body?.code);
    expect([r.status, r.body?.code]).toEqual([422, "gate.out_of_sequence"]);
    expect((await gate("G3")).gate.version).toBe(before.gate.version);
    expect(await phaseOf()).toBe("define");
  });

  it("F-DG2-204: after refining the North Star, the charter shows the CURRENT one, never the superseded one as current", async () => {
    const refined = ok(
      await req("PUT", `${T}/north-star`, lead.s, { statement: "QA refined star: double roaming revenue by 2028." }, ifm(firstStar.version)),
      200,
      "setNorthStar refine",
    );
    const view = ok(await req("GET", `${T}/charter`, lead.s), 200, "getCharter");
    console.log("QA-R2 charter.northStar after refine:", JSON.stringify(view.northStar), "warnings:", JSON.stringify(view.warnings));
    expect(view.northStar?.statement).toBe("QA refined star: double roaming revenue by 2028.");
    expect(view.northStar?.status).toBe("current");
    expect(view.northStar?.id).toBe(refined.id);
    expect((view.warnings as Any[]).map((x) => x.code)).toContain("charter.north_star_superseded");
    // Negative: explicitly linking the superseded one is refused.
    const raw = await req("GET", `${T}/charter`, lead.s);
    const stale = await req("PATCH", `${T}/charter`, lead.s, { northStarId: firstStar.id }, ifm(etag(raw)));
    console.log("QA-R2 PATCH charter northStarId=<superseded> ->", stale.status, stale.body?.code);
    expect(stale.status).toBe(422);
  });

  it("F-DG2-203: the thesis is flagged incomplete (4 parts) on the charter and in G2 until all four B0037 parts exist", async () => {
    const view = ok(await req("GET", `${T}/charter`, lead.s), 200, "getCharter");
    const thesisWarn = (ws: Any[]) => ws.filter((x) => x.code === "charter.thesis_incomplete").length;
    expect(thesisWarn(view.warnings)).toBe(4);
    const g2 = await gate("G2");
    const ot = (g2.criteria as Any[]).find((c) => c.key === "g2.outcome_tree");
    expect((ot.missing as Any[]).filter((m) => m.code === "g2.outcome_tree.thesis_incomplete").length).toBe(4);
    const r = await req("GET", `${T}/charter`, lead.s);
    const saved = ok(
      await req(
        "PATCH",
        `${T}/charter`,
        lead.s,
        {
          thesisChange: "QA roaming bundles and the digital top-up journey",
          thesisOutcomes: "roaming uptake and NPS",
          thesisBenefits: "roaming revenue",
          thesisBecause: "QA synthetic diagnostic: price and discoverability block uptake",
        },
        ifm(etag(r)),
      ),
      200,
      "updateCharter thesis",
    );
    expect(thesisWarn(saved.warnings)).toBe(0);
    // A save re-links the current North Star (F-DG2-204).
    expect((saved.warnings as Any[]).map((x) => x.code)).not.toContain("charter.north_star_superseded");
  });

  it("F-DG2-201: a KPI definition can be ACTIVATED natively (KDS), with authz, concurrency, audit and rule checks", async () => {
    ok(await req("POST", `${T}/strategic-guardrails`, lead.s, { title: "QA", category: "capex", statement: "QA cap" }), 201, "createGuardrail");
    kpi = ok(
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
    expect(kpi.status).toBe("draft");
    const url = `${T}/kpi-definitions/${kpi.id}/activate`;
    // Authorization: the Sponsor has no kpi_definition.edit.
    const denied = await req("POST", url, sponsor.s, undefined, ifm(kpi.version));
    console.log("QA-R2 activate as SP ->", denied.status, denied.body?.code);
    expect(denied.status).toBe(403);
    // Precondition: no If-Match -> 428.
    const noIfm = await req("POST", url, kds.s);
    console.log("QA-R2 activate without If-Match ->", noIfm.status, noIfm.body?.code);
    expect(noIfm.status).toBe(428);
    // Concurrency: two activations with the same version -> exactly one 200, the other 409/422.
    const [a, b] = await Promise.all([req("POST", url, kds.s, undefined, ifm(kpi.version)), req("POST", url, kds.s, undefined, ifm(kpi.version))]);
    console.log("QA-R2 concurrent activations ->", a.status, b.status);
    expect([a.status, b.status].filter((s) => s === 200).length).toBe(1);
    expect([a.status, b.status].filter((s) => s !== 200).every((s) => s === 409 || s === 422)).toBe(true);
    const k = ok(await req("GET", `${T}/kpi-definitions/${kpi.id}`, kds.s), 200, "getKpiDefinition");
    expect(k.status).toBe("active");
    expect(k.version).toBe(kpi.version + 1);
    expect(await auditCount("kpi_definition.activate", kpi.id)).toBe(1);
    // Already active -> 422.
    const again = await req("POST", url, kds.s, undefined, ifm(k.version));
    console.log("QA-R2 activate already-active ->", again.status, again.body?.code);
    expect(again.status).toBe(422);
    kpi = k;
  });

  it("G2: every Define output completes through the API; G2 submitted and approved -> phase design", async () => {
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
      ok(await req("POST", `${T}/outcome-kpis/${row.id}/trajectory-approval`, sponsor.s, { note: "QA" }, ifm(row.version)), 200, "approveTrajectory");
    }
    const open = incomplete(await gate("G2"));
    console.log("QA-R2 G2 incomplete mandatory criteria:", JSON.stringify(open));
    expect(open).toEqual([]);
    await submitAndApprove("G2");
    const p = await phaseOf();
    console.log("QA-R2 phase after G2 approval:", p);
    expect(p).toBe("design");
  });

  it("G3: every Design output completes through the API; approval advances exactly one step design -> mobilize", async () => {
    const canvas = ok(await req("GET", `${T}/tom-canvas`, lead.s), 200, "getTomCanvas");
    for (const c of (canvas.cells ?? canvas.items) as Any[]) {
      const code = c.dimensionCode ?? c.cell?.dimensionCode;
      const cur = ok(await req("GET", `${T}/tom-canvas/${code}`, lead.s), 200, "getTomCanvasCell");
      ok(
        await req("PATCH", `${T}/tom-canvas/${code}`, lead.s, { targetDesign: `QA target ${code}`, ownerUserId: bo.id, status: "ready" }, ifm(cur.cell.version)),
        200,
        `updateTomCanvasCell ${code}`,
      );
    }
    const d = ok(await req("POST", "/api/v1/decisions", lead.s, { transformationId: tid, title: "QA decision", ownerUserId: bo.id }), 201, "createDecision");
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
    ok(await req("POST", `${T}/capability-heatmap`, lead.s, { name: "QA cap", currentLevel: 1, targetLevel: 3, sourcingNeed: "buy" }), 201, "createCapability");
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
    const open = incomplete(await gate("G3"));
    console.log("QA-R2 G3 incomplete mandatory criteria:", JSON.stringify(open));
    expect(open).toEqual([]);
    const before = await phaseOf();
    await submitAndApprove("G3");
    const after = await phaseOf();
    console.log("QA-R2 phase before/after G3 approval:", before, after);
    expect([before, after]).toEqual(["design", "mobilize"]);
    expect(await auditCount("transformation.phase_advance", tid)).toBe(3);
  });
});
