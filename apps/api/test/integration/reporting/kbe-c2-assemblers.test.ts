// The diagnostic, TOM, business-case, roadmap and gate-pack assemblers (T-DG5-KBE-C2; ADR-0045 §1, §3, §5;
// p5-work-split §F.2). Proves, against the run's disposable PostgreSQL:
//  - REQ-S13-004: each of the five outputs generates from a seeded transformation and contains its ID and records; each
//    section holds exactly the rows of the DG2-DG4 route the screen reads, in that route's order;
//  - the gate pack lists every criterion of the gate with its state and evidence (the content REQ-S13-005's PPTX gate
//    pack renders); an unsubmitted gate's criteria are Unknown, never complete;
//  - REQ-S13-008: a business case whose formula version is not validated has provisional values; an unvalidated
//    baseline is provisional; a missing amount is Unknown with no number, never 0;
//  - the snapshot records one `formula_version` row per formula used and the `calculation_engine` row;
//  - value bases are never summed together (D-117, D-119, D-122): each decimal column holds one value basis, no table
//    carries a report total, and the business-case totals are exactly the DG3 totals engine's figures, row by row.
// All data is SYNTHETIC. Product gates G1-G6 are business approvals inside the product; the G1 submission and decision
// below are demo actions on synthetic data and approve nothing real. Nothing here touches DG0-DG7.
import { ENGINE_VERSION } from "@mth/shared/calc";
import { reportSnapshot } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { G1_AGREEMENTS, gateVersion, ifm, makeG1Ready, setupP2World, type P2World } from "../../support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let fin: { id: string; session: Session };
let evidenceId: string;
let baselineId: string;

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};
const get = async (url: string, session: Session = p.lead.session): Promise<Body> =>
  ok(await call<Body>(api.app, "GET", url, { session }), 200, `GET ${url}`);
const post = (url: string, body: Record<string, unknown>, headers: Record<string, string> = {}, s = p.lead.session) =>
  call<Body>(api.app, "POST", url, { session: s, headers, body });

/** Generates a snapshot, checks it against the API mirror and returns it with its content. */
async function generated(code: string, body: Record<string, unknown> = {}): Promise<Body> {
  const s = ok(await post(`${T}/reports/${code}/generate`, body), 201, `generate ${code}`);
  expect(reportSnapshot.safeParse(s).success, JSON.stringify(reportSnapshot.safeParse(s).error?.issues ?? [])).toBe(
    true,
  );
  expect(s.content.definitionCode).toBe(code);
  expect(s.content.transformation.id).toBe(p.transformationId);
  return s;
}
const section = (s: Body, key: string): Body => {
  const found = s.content.sections.find((x: Body) => x.key === key);
  expect(found, `section ${key}`).toBeDefined();
  return found;
};
const rowIds = (sec: Body): string[] => sec.rows.map((r: Body) => r.recordId);
const cell = (sec: Body, row: Body, key: string): Body => row.cells[sec.columns.findIndex((c: Body) => c.key === key)];
const rowOf = (sec: Body, id: string): Body => sec.rows.find((r: Body) => r.recordId === id);

/** Every decimal column of every table holds one value basis and one unit kind; no table carries a report total. */
function assertBasesNeverMixed(s: Body): void {
  for (const sec of s.content.sections) {
    if (sec.kind !== "table") continue;
    expect(sec.totals, `${sec.key} totals`).toEqual([]);
    sec.columns.forEach((c: Body, j: number) => {
      if (c.valueKind !== "decimal") return;
      const bases = new Set(sec.rows.map((r: Body) => r.cells[j].valueBasis));
      const units = new Set(sec.rows.map((r: Body) => r.cells[j].unitKind));
      expect(bases.size, `${sec.key}.${c.key} bases`).toBeLessThanOrEqual(1);
      expect(units.size, `${sec.key}.${c.key} units`).toBeLessThanOrEqual(1);
    });
  }
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "FIN", { type: "transformation", id: p.transformationId }, w.orgA.id);
  fin = { id: u.id, session: await signIn(api.app, u.subject) };
  ({ evidenceId, baselineId } = await makeG1Ready(api, p));
});

afterAll(() => api.close());

describe("gate_pack: every criterion of the gate with its state and evidence (REQ-S13-004; REQ-S13-005 content)", () => {
  it("an unsubmitted gate: every catalogue criterion, state Unknown (never complete), no evidence, not_submitted", async () => {
    const view = await get(`${T}/gates/G2`);
    const s = await generated("gate_pack", { subjectId: view.gate.id });
    expect(s.subjectType).toBe("gate_instance");
    expect(s.subjectId).toBe(view.gate.id);
    expect(s.approvalState).toBe("not_submitted");
    const criteria = section(s, "criteria");
    expect(criteria.rows.map((r: Body) => cell(criteria, r, "criterion").value)).toEqual(
      view.definition.criteria.map((c: Body) => c.key),
    );
    for (const r of criteria.rows)
      expect(cell(criteria, r, "state")).toMatchObject({
        value: null,
        validation: "unknown",
        reason: "not_computable",
      });
    expect(section(s, "evidence").rows).toEqual([]);
    expect(s.unknownValueCount).toBeGreaterThanOrEqual(view.definition.criteria.length);
  });

  it("a submitted G1: the criteria recorded with the submission, each with its state, and the submission's evidence", async () => {
    const ready = await get(`${T}/gates/G1`);
    expect(ready.canSubmit).toBe(true);
    const sub = ok(
      await post(`${T}/gates/G1/submissions`, {}, ifm(await gateVersion(api, p, "G1"))),
      201,
      "submit G1 (synthetic demo submission)",
    );
    const recorded = await get(`${T}/gates/G1/submissions/${sub.submissionNo}`);
    const s = await generated("gate_pack", { subjectId: ready.gate.id });
    expect(s.approvalState).toBe("pending");
    expect(s.content.subject).toMatchObject({ type: "gate_instance", id: ready.gate.id, code: "G1" });
    const criteria = section(s, "criteria");
    // Every criterion of the gate definition, in order, as the evaluator recorded it.
    expect(criteria.rows.map((r: Body) => cell(criteria, r, "criterion").value)).toEqual(
      ready.definition.criteria.map((c: Body) => c.key),
    );
    expect(rowIds(criteria)).toEqual(recorded.criteria.map((c: Body) => c.id));
    for (const c of recorded.criteria) {
      const row = rowOf(criteria, c.id);
      expect(cell(criteria, row, "state")).toMatchObject({ value: c.completeness, validation: "not_applicable" });
      expect(cell(criteria, row, "mandatory").value).toBe(c.mandatory ? "mandatory" : "optional");
      expect(cell(criteria, row, "missing_count").value).toBe(c.detail.missing.length);
      const def = ready.definition.criteria.find((d: Body) => d.key === c.criterionKey);
      expect(cell(criteria, row, "label_en").value).toBe(def.labelEn);
      expect(cell(criteria, row, "label_ar").value).toBe(def.labelAr);
    }
    // The submission's evidence (snapshot.evidence): the verified note of makeG1Ready, cited by the pack.
    const evidence = section(s, "evidence");
    expect(rowIds(evidence)).toContain(evidenceId);
    const row = rowOf(evidence, evidenceId);
    expect(cell(evidence, row, "verified_at_submission").value).toBe("verified");
    expect(cell(evidence, row, "review_status").value).toBe("verified");
    // A note has no content revision: n/a, not Unknown and never 0.
    expect(cell(evidence, row, "content_revision")).toMatchObject({ value: null, validation: "not_applicable" });
    const cited = await get(`${T}/report-snapshots/${s.id}/evidence`);
    expect(cited.items.map((e: Body) => e.evidenceId)).toContain(evidenceId);
    const sources = await get(`${T}/report-snapshots/${s.id}/sources?limit=100`);
    expect(sources.items.map((x: Body) => x.recordType)).toEqual(
      expect.arrayContaining(["gate_instance", "gate_submission", "gate_submission_criterion"]),
    );
    const gate = section(s, "gate");
    const field = (k: string) => gate.fields.find((f: Body) => f.key === k).value;
    expect(field("submission_no").value).toBe(sub.submissionNo);
    expect(field("decision_outcome")).toMatchObject({ value: null, validation: "not_applicable" });

    // The Sponsor's demo decision (synthetic; approves nothing real): the live pack shows the recorded decision.
    ok(
      await post(
        `${T}/gates/G1/decision`,
        {
          submissionNo: sub.submissionNo,
          outcome: "approved",
          rationale: "Synthetic demo decision; approves nothing real.",
          agreements: G1_AGREEMENTS,
        },
        {},
        p.sponsor.session,
      ),
      201,
      "G1 decision (synthetic)",
    );
    const live = await get(`${T}/reports/gate_pack/live?subjectId=${ready.gate.id}`);
    expect(live.snapshotId).toBeNull();
    expect(live.document.approvalState).toBe("approved");
    const liveGate = live.document.sections.find((x: Body) => x.key === "gate");
    expect(liveGate.fields.find((f: Body) => f.key === "decision_outcome").value.value).toBe("approved");
    // The generated snapshot keeps what it said (a snapshot never changes).
    expect((await get(`${T}/report-snapshots/${s.id}`)).approvalState).toBe("pending");
  });

  it("refuses a gate pack without a gate instance of this transformation (422 report.subject_invalid)", async () => {
    const none = await post(`${T}/reports/gate_pack/generate`, {});
    expect([none.status, none.body.code]).toEqual([422, "report.subject_invalid"]);
    const other = await post(`${T}/reports/gate_pack/generate`, { subjectId: p.transformationId });
    expect([other.status, other.body.code]).toEqual([422, "report.subject_invalid"]);
  });
});

describe("diagnostic (REQ-S13-004, REQ-S13-008)", () => {
  it("contains the transformation's T01 items, findings, baselines and value pools exactly as their routes list them", async () => {
    const s = await generated("diagnostic");
    expect(s.approvalState).toBe("not_applicable");
    const items = await get(`${T}/diagnostic-items?limit=100`);
    const findings = await get(`${T}/diagnostic-findings?limit=100`);
    const baselines = await get(`${T}/baselines?limit=100`);
    const pools = await get(`${T}/value-pools?limit=100`);
    expect(rowIds(section(s, "items"))).toEqual(items.items.map((i: Body) => i.id));
    expect(items.items.length).toBeGreaterThanOrEqual(6);
    expect(rowIds(section(s, "findings"))).toEqual(findings.items.map((i: Body) => i.id));
    expect(rowIds(section(s, "baselines"))).toEqual(baselines.items.map((i: Body) => i.id));
    expect(rowIds(section(s, "value_pools"))).toEqual(pools.items.map((i: Body) => i.id));
    // The T01 rows written by makeG1Ready, as authored.
    const itemSec = section(s, "items");
    const first = items.items[0];
    expect(cell(itemSec, rowOf(itemSec, first.id), "root_cause").value).toBe(first.rootCause);
    // An unknown impact amount is Unknown, never 0.
    expect(cell(itemSec, rowOf(itemSec, first.id), "impact_amount")).toMatchObject({
      value: null,
      validation: "unknown",
      reason: "missing",
    });
    // Rule 3: the baseline is not validated by Finance -> provisional, with its basis and its unit stated.
    const b = section(s, "baselines");
    const route = baselines.items.find((x: Body) => x.id === baselineId);
    expect(route.validationStatus).toBe("unvalidated");
    expect(cell(b, rowOf(b, baselineId), "value")).toEqual({
      type: "decimal",
      value: route.value,
      unitKind: "other",
      currency: "SAR",
      valueBasis: "baseline",
      validation: "provisional",
      reason: null,
    });
    expect(cell(b, rowOf(b, baselineId), "unit").value).toBe("SAR");
    // The unquantified value pool: no amount, Unknown (missing), never 0.
    const v = section(s, "value_pools");
    const pool = pools.items[0];
    expect(pool.quantificationStatus).toBe("unquantified");
    expect(cell(v, rowOf(v, pool.id), "upside_amount")).toMatchObject({ value: null, validation: "unknown" });
    expect(s.provisionalValueCount).toBeGreaterThanOrEqual(1);
    expect(s.unknownValueCount).toBeGreaterThanOrEqual(2);
    // Evidence: the verified note linked to the T01 rows and the baseline.
    const cited = await get(`${T}/report-snapshots/${s.id}/evidence`);
    expect(new Set(cited.items.map((e: Body) => e.sectionKey))).toEqual(new Set(["items", "baselines"]));
    expect(cited.items.every((e: Body) => e.evidenceId === evidenceId)).toBe(true);
    assertBasesNeverMixed(s);
  });

  it("after Finance validates the baseline it is validated; a later edit makes it provisional again (rule 3)", async () => {
    const cur = await get(`${T}/baselines/${baselineId}`);
    ok(
      await post(
        `${T}/baselines/${baselineId}/validation`,
        { result: "validated", note: "Synthetic demo validation; approves nothing real." },
        ifm(cur.version),
        fin.session,
      ),
      200,
      "validate baseline (synthetic)",
    );
    const live = await get(`${T}/reports/diagnostic/live`);
    const b = live.document.sections.find((x: Body) => x.key === "baselines");
    expect(cell(b, rowOf(b, baselineId), "value").validation).toBe("validated");
    const now = await get(`${T}/baselines/${baselineId}`);
    ok(
      await call<Body>(api.app, "PATCH", `${T}/baselines/${baselineId}`, {
        session: p.lead.session,
        headers: ifm(now.version),
        body: { source: "Synthetic finance extract (revised)" },
      }),
      200,
      "edit baseline",
    );
    const after = await get(`${T}/reports/diagnostic/live`);
    const b2 = after.document.sections.find((x: Body) => x.key === "baselines");
    expect(cell(b2, rowOf(b2, baselineId), "value").validation).toBe("provisional");
  });
});

describe("tom (REQ-S13-004)", () => {
  it("contains the ten canvas boxes, the T03 gaps, design decisions, dependencies and the capability heatmap", async () => {
    const gap = ok(
      await post(`${T}/tom-gaps`, {
        dimensionCode: "journeys_processes",
        currentState: "Synthetic: manual roaming activation.",
        targetState: "Synthetic: one-tap activation.",
        gap: "Synthetic: no self-service journey.",
      }),
      201,
      "createTomGap",
    );
    const cap = ok(
      await post(`${T}/capability-heatmap`, { name: "Synthetic roaming pricing", dimensionCode: "products_services" }),
      201,
      "createCapability",
    );
    const s = await generated("tom");
    const canvas = await get(`${T}/tom-canvas`);
    expect(canvas.cells).toHaveLength(10);
    expect(rowIds(section(s, "canvas"))).toEqual(canvas.cells.map((c: Body) => c.cell.id));
    expect(rowIds(section(s, "gaps"))).toEqual(canvas.cells.flatMap((c: Body) => c.gaps.map((g: Body) => g.id)).sort());
    expect(rowIds(section(s, "gaps"))).toContain(gap.id);
    expect(rowIds(section(s, "design_decisions"))).toEqual(
      canvas.cells.flatMap((c: Body) => c.decisions.map((d: Body) => d.id)).sort(),
    );
    expect(rowIds(section(s, "dependencies"))).toEqual(
      canvas.cells.flatMap((c: Body) => c.dependencies.map((d: Body) => d.id)).sort(),
    );
    const heatmap = await get(`${T}/capability-heatmap?limit=100`);
    expect(rowIds(section(s, "capabilities"))).toEqual(heatmap.items.map((c: Body) => c.id));
    const caps = section(s, "capabilities");
    // An unassessed level is Unknown, never 0.
    expect(cell(caps, rowOf(caps, cap.id), "current_level")).toMatchObject({ value: null, validation: "unknown" });
    const gaps = section(s, "gaps");
    expect(cell(gaps, rowOf(gaps, gap.id), "gap").value).toBe("Synthetic: no self-service journey.");
    expect(s.approvalState).toBe("not_applicable");
  });
});

describe("business_cases (REQ-S13-004, REQ-S13-008; D-117, D-119, D-122)", () => {
  it("lines and totals as the DG3 routes show them; unvalidated formula -> provisional; formula and engine versions", async () => {
    const kase = ok(
      await post("/api/v1/business-cases", {
        transformationId: p.transformationId,
        level: "transformation",
        title: "Synthetic transformation case",
        sections: { strategicRationale: "Synthetic rationale.", baselineSummary: "Synthetic baseline: 1.2m SAR." },
      }),
      201,
      "createBusinessCase",
    );
    const C = `/api/v1/business-cases/${kase.id}`;
    // Two T09 formulas from the playbook examples: Δ attach × customers × ARPU (left unvalidated) and
    // volume × Δ unit cost (validated by FIN, never the author; a synthetic demo validation).
    const attach = ok(
      await post("/api/v1/benefit-formulas", {
        transformationId: p.transformationId,
        benefitName: "Synthetic attach uplift",
        fromExample: "revenue_uplift",
      }),
      201,
      "formula revenue_uplift",
    );
    const unitCost = ok(
      await post("/api/v1/benefit-formulas", {
        transformationId: p.transformationId,
        benefitName: "Synthetic unit-cost reduction",
        fromExample: "cost_reduction",
      }),
      201,
      "formula cost_reduction",
    );
    ok(
      await post(
        `/api/v1/benefit-formulas/${unitCost.id}/versions/1/validation`,
        { result: "validated", note: "Synthetic demo validation; approves nothing real." },
        ifm(1),
        fin.session,
      ),
      200,
      "validate formula (synthetic)",
    );
    const line = (body: Record<string, unknown>) => post(`${C}/lines`, { currency: "SAR", ...body });
    const capex = ok(
      await line({ lineKind: "investment", class: "capex", valueBasis: "cash", title: "Platform", amount: "40000" }),
      201,
      "capex",
    );
    const revenue = ok(
      await line({
        lineKind: "benefit",
        class: "revenue",
        valueBasis: "revenue_uplift",
        title: "Attach",
        amount: "100000",
        benefitFormulaId: attach.id,
      }),
      201,
      "revenue",
    );
    const saving = ok(
      await line({
        lineKind: "benefit",
        class: "cost_reduction",
        valueBasis: "cash_saving",
        title: "Unit cost",
        amount: "25000",
        benefitFormulaId: unitCost.id,
      }),
      201,
      "saving",
    );
    const unknownAmount = ok(
      await line({ lineKind: "investment", class: "opex", valueBasis: "cash", title: "Run cost (unknown)" }),
      201,
      "unknown opex",
    );

    const s = await generated("business_cases");
    expect(s.approvalState).toBe("not_applicable");
    const cases = await get(`/api/v1/business-cases?transformationId=${p.transformationId}&limit=100`);
    expect(rowIds(section(s, "cases"))).toEqual(cases.items.map((c: Body) => c.id));
    const routeLines = await get(`${C}/lines`);
    const lines = section(s, "lines");
    expect(rowIds(lines)).toEqual(routeLines.items.map((l: Body) => l.id));
    // Rule 2: the unvalidated formula's line is provisional; the validated one is validated; investment n/a.
    expect(cell(lines, rowOf(lines, revenue.id), "amount")).toMatchObject({
      value: "100000.0000",
      currency: "SAR",
      valueBasis: "planned",
      validation: "provisional",
    });
    expect(cell(lines, rowOf(lines, revenue.id), "formula_validation").value).toBe("unvalidated");
    expect(cell(lines, rowOf(lines, saving.id), "amount").validation).toBe("validated");
    expect(cell(lines, rowOf(lines, capex.id), "amount").validation).toBe("not_applicable");
    // Rule 5: a missing amount is Unknown, never 0.
    expect(cell(lines, rowOf(lines, unknownAmount.id), "amount")).toMatchObject({
      value: null,
      validation: "unknown",
      reason: "missing",
    });
    // Rule 3: the case baseline is not validated -> provisional.
    const secs = section(s, "case_sections");
    const baselineRow = secs.rows.find((r: Body) => cell(secs, r, "section").value === "baseline_summary");
    expect(cell(secs, baselineRow, "content")).toMatchObject({
      value: "Synthetic baseline: 1.2m SAR.",
      validation: "provisional",
    });

    // Totals: exactly the DG3 engine's figures, each measure its own row (never added together by the report).
    const totals = await get(`${C}/totals`);
    const t = section(s, "totals");
    const measure = (m: string, basis: string | null) =>
      t.rows.find(
        (r: Body) =>
          r.recordId === kase.id && cell(t, r, "measure").value === m && cell(t, r, "value_basis").value === basis,
      );
    const gross = measure("gross_benefits", null);
    expect(cell(t, gross, "amount").value).toBe(totals.grossBenefits[0].amount);
    expect(cell(t, gross, "amount").validation).toBe("provisional"); // one of its lines is provisional
    expect(cell(t, measure("gross_benefits_by_value_basis", "revenue_uplift"), "amount")).toMatchObject({
      value: totals.grossBenefitsByValueBasis.revenue_uplift[0].amount,
      validation: "provisional",
    });
    expect(cell(t, measure("gross_benefits_by_value_basis", "cash_saving"), "amount")).toMatchObject({
      value: totals.grossBenefitsByValueBasis.cash_saving[0].amount,
      validation: "validated",
    });
    const cost = measure("implementation_cost", null);
    expect(cell(t, cost, "amount")).toMatchObject({
      value: totals.implementationCost[0].amount,
      validation: "not_applicable",
    });
    expect(cell(t, cost, "unknown_line_count").value).toBe(totals.implementationCost[0].unknownLineCount);
    expect(cell(t, measure("net_value", null), "amount").value).toBe(totals.netValue[0].amount);
    // Worked figures (synthetic): gross 100000 + 25000; cost 40000 (+1 unknown line); net as the engine states it.
    expect(totals.grossBenefits[0].amount).toBe("125000");
    expect(totals.grossBenefitsByValueBasis.revenue_uplift[0].amount).toBe("100000");
    expect(totals.grossBenefitsByValueBasis.cash_saving[0].amount).toBe("25000");
    assertBasesNeverMixed(s);

    // Versions: one formula_version row per formula used, and the calculation_engine row.
    const versions = (await get(`${T}/report-snapshots/${s.id}/versions`)).items;
    const formulaRows = versions.filter((v: Body) => v.versionKind === "formula_version");
    expect(formulaRows.map((v: Body) => [v.referenceKey, v.versionLabel]).sort()).toEqual(
      [
        [attach.code, "v1"],
        [unitCost.code, "v1"],
      ].sort(),
    );
    expect(versions.filter((v: Body) => v.versionKind === "calculation_engine")).toEqual([
      {
        versionKind: "calculation_engine",
        referenceId: null,
        referenceKey: "formula_engine",
        versionLabel: ENGINE_VERSION,
      },
    ]);
    const sources = (await get(`${T}/report-snapshots/${s.id}/sources?limit=100`)).items;
    const src = (id: string) => sources.find((x: Body) => x.recordId === id);
    expect(src(revenue.id).validationState).toBe("provisional");
    expect(src(saving.id).validationState).toBe("validated");
    expect(sources.filter((x: Body) => x.recordType === "benefit_formula_version")).toHaveLength(2);
    expect(s.provisionalValueCount).toBeGreaterThanOrEqual(3);
  });
});

describe("roadmap (REQ-S13-004)", () => {
  it("contains the waves, initiatives, milestones and initiative dependencies exactly as GET /roadmap lists them", async () => {
    const a = ok(
      await post("/api/v1/initiatives", { transformationId: p.transformationId, name: "Synthetic roaming bundles" }),
      201,
      "initiative A",
    );
    ok(
      await post("/api/v1/initiatives", { transformationId: p.transformationId, name: "Synthetic roaming app" }),
      201,
      "initiative B",
    );
    const ms = ok(
      await post(`/api/v1/initiatives/${a.id}/milestones`, { title: "Synthetic pricing approved" }),
      201,
      "milestone",
    );
    const s = await generated("roadmap");
    const roadmap = await get(`${T}/roadmap`);
    expect(rowIds(section(s, "waves"))).toEqual(roadmap.waves.map((x: Body) => x.id));
    expect(rowIds(section(s, "initiatives"))).toEqual(roadmap.initiatives.map((x: Body) => x.id));
    expect(rowIds(section(s, "milestones"))).toEqual(roadmap.milestones.map((x: Body) => x.id));
    expect(rowIds(section(s, "dependencies"))).toEqual(roadmap.dependencies.map((x: Body) => x.id));
    const ini = section(s, "initiatives");
    expect(cell(ini, rowOf(ini, a.id), "code").value).toBe(a.code);
    expect(cell(ini, rowOf(ini, a.id), "name").value).toBe("Synthetic roaming bundles");
    const m = section(s, "milestones");
    // A planned milestone has no actual date yet: n/a; no forecast date: Unknown, never a guessed date.
    expect(cell(m, rowOf(m, ms.id), "actual_date")).toMatchObject({ value: null, validation: "not_applicable" });
    expect(cell(m, rowOf(m, ms.id), "forecast_date")).toMatchObject({ value: null, validation: "unknown" });
    expect(s.approvalState).toBe("not_applicable");
  });
});
