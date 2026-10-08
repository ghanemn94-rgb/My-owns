// T09 benefit formulas, versions, calculations, Finance validation of the benefit logic and the kpi G4 facts
// (ADR-0024 §5-§6, ADR-0021 §7; REQ-PB-055, REQ-PB-056, REQ-PB-057, REQ-S08-007; T-DG3-KBE-C) against a real
// PostgreSQL. All data is SYNTHETIC: the B0087 examples are illustrative calculations with synthetic values, and every
// Finance validation is a demo decision by a synthetic FIN user that approves nothing real. Product gates G1-G6 are
// business approvals inside the product; nothing here touches DG0-DG7.
//  - the six T09 columns persist; confidence outside H/M/L -> 400; BF-nn codes;
//  - an expression is parsed and type-checked before anything is written: an undefined variable -> 422, nothing
//    written; monthly ARPU x annual customers -> 422 formula.period_mismatch;
//  - both seeded examples: verbatim B0087 text, instantiation, exact results 100000 and 500000 SAR per year;
//  - lineage rows: inputs with kind/unit/currency/period/source, assumptions, period, result (null = Unknown, never 0),
//    append-only; versions immutable;
//  - FIN validates; the author gets 403; final once recorded;
//  - every mutation: AUD 403 (audited), If-Match 428/409, audit events, authorization re-checked at commit time;
//  - loadKpiP3GateFacts: cases, sections, baseline state incl. Stale, the current formula version's validation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadKpiP3GateFacts } from "../../../src/modules/kpi/index.ts";
import {
  auditOf,
  auditOfRequest,
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
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { COST_VERSION } from "../contract/p3-exercises-kbe-c.ts";
import { financeUser, insertInitiative } from "../contract/p3-exercises-kbe-b.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close(), 60_000);

const F = "/api/v1/benefit-formulas";
const B = "/api/v1/business-cases";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const REVENUE_VERSION = {
  expression: "(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu",
  variables: [
    { name: "baseline_attach_rate", kind: "fraction", period: "none", value: "0.10", source: "Synthetic CRM extract" },
    { name: "target_attach_rate", kind: "fraction", period: "none", value: "0.12" },
    { name: "eligible_customers", kind: "count", unit: "customers", period: "year", value: "100000" },
    { name: "arpu", kind: "currency", currency: "SAR", unit: "per customer", period: "year", value: "50" },
  ],
};

const create = (session: Session, body: Record<string, unknown>) => call<Body>(api.app, "POST", F, { session, body });
const get = (session: Session, id: string) => call<Body>(api.app, "GET", `${F}/${id}`, { session });

async function formula(p: P2World, over: Record<string, unknown> = {}) {
  const res = await create(p.lead.session, {
    transformationId: p.transformationId,
    benefitName: "Synthetic revenue uplift",
    initialVersion: REVENUE_VERSION,
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Body;
}

const counts = async (transformationId: string) => ({
  formulas: (
    await api.db.selectFrom("benefit_formula").select("id").where("transformation_id", "=", transformationId).execute()
  ).length,
  versions: (
    await api.db
      .selectFrom("benefit_formula_version")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .execute()
  ).length,
  variables: (
    await api.db
      .selectFrom("benefit_formula_variable")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .execute()
  ).length,
  calculations: (
    await api.db
      .selectFrom("benefit_calculation")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .execute()
  ).length,
});

describe("T09 register (REQ-PB-056)", () => {
  it("the six T09 columns persist; BF-nn codes; the formula is the current version's expression", async () => {
    const p = await setupP2World(api, w);
    const f = await formula(p, {
      baselineDriver: "Customers × attach rate × ARPU",
      changeAssumption: "Attach +2 pp",
      ramp: "Q1-Q4",
      confidence: "M",
      ownerUserId: p.sponsor.id,
    });
    expect(f).toMatchObject({
      code: "BF-01",
      benefitName: "Synthetic revenue uplift",
      baselineDriver: "Customers × attach rate × ARPU",
      changeAssumption: "Attach +2 pp",
      ramp: "Q1-Q4",
      confidence: "M",
      ownerUserId: p.sponsor.id,
      currentVersionNo: 1,
      isIllustrative: false,
      exampleCode: null,
      status: "active",
      // The row and its version 1 reference each other: the row is written, then pointed at version 1 (row v2).
      version: 2,
    });
    expect(f.currentVersion).toMatchObject({
      versionNo: 1,
      expression: REVENUE_VERSION.expression,
      resultKind: "currency",
      resultCurrency: "SAR",
      resultPeriod: "year",
      previewResult: "100000",
      engineVersion: "mth-formula/1.0.0",
      validationStatus: "unvalidated",
    });
    expect(f.currentVersion.variables[0]).toEqual({
      name: "baseline_attach_rate",
      kind: "fraction",
      unit: null,
      currency: null,
      period: "none",
      value: "0.1",
      description: null,
      source: "Synthetic CRM extract",
    });
    // Read back from the database: all six columns (Formula = current version's expression).
    const row = await api.db.selectFrom("benefit_formula").selectAll().where("id", "=", f.id).executeTakeFirstOrThrow();
    const version = await api.db
      .selectFrom("benefit_formula_version")
      .selectAll()
      .where("formula_id", "=", f.id)
      .where("version_no", "=", row.current_version_no!)
      .executeTakeFirstOrThrow();
    expect([
      row.benefit_name,
      row.baseline_driver,
      version.expression,
      row.change_assumption,
      row.ramp,
      row.confidence,
    ]).toEqual([
      "Synthetic revenue uplift",
      "Customers × attach rate × ARPU",
      REVENUE_VERSION.expression,
      "Attach +2 pp",
      "Q1-Q4",
      "M",
    ]);
    expect(version.preview_result).toBe("100000.000000");
    expect(version.expression_sha256).toMatch(/^[0-9a-f]{64}$/);
    const second = await formula(p, { benefitName: "Synthetic second" });
    expect(second.code).toBe("BF-02");
    // GET returns the same representation with its ETag.
    const read = await get(p.auditor.session, f.id);
    expect([read.status, read.headers["etag"], read.body.currentVersion.previewResult]).toEqual([200, '"2"', "100000"]);
    // Audit: create (v1) and the current-version pointer (v2), plus the version's own create event.
    expect((await auditOf(api.db, f.id)).map((e) => [e.action, e.new_version])).toEqual([
      ["benefit_formula.create", 1],
      ["benefit_formula.version_set", 2],
    ]);
    expect((await auditOf(api.db, f.currentVersion.id)).map((e) => e.action)).toEqual([
      "benefit_formula_version.create",
    ]);
  });

  it("confidence outside H/M/L -> 400 (create and PATCH), nothing written; the DB CHECK refuses it too", async () => {
    const p = await setupP2World(api, w);
    const before = await counts(p.transformationId);
    for (const confidence of ["X", "h", "High", ""]) {
      const res = await create(p.lead.session, {
        transformationId: p.transformationId,
        benefitName: "Synthetic",
        confidence,
      });
      expect([res.status, res.body.errors?.[0]?.pointer], confidence).toEqual([400, "/confidence"]);
    }
    expect(await counts(p.transformationId)).toEqual(before);
    const f = await formula(p);
    const patch = await call<Body>(api.app, "PATCH", `${F}/${f.id}`, {
      session: p.lead.session,
      headers: ifm(f.version),
      body: { confidence: "X" },
    });
    expect(patch.status).toBe(400);
    await expect(
      api.owner.query(`update benefit_formula set confidence = 'X', version = version + 1 where id = $1`, [f.id]),
    ).rejects.toThrow(/check constraint/);
    // null clears; H/M/L are accepted.
    const ok = await call<Body>(api.app, "PATCH", `${F}/${f.id}`, {
      session: p.lead.session,
      headers: ifm(f.version),
      body: { confidence: "L", ramp: null },
    });
    expect([ok.status, ok.body.confidence, ok.body.ramp, ok.body.version]).toEqual([200, "L", null, 3]);
  });

  it("an undefined variable -> 422 'Undefined variable: {name}'; an invalid expression writes nothing", async () => {
    const p = await setupP2World(api, w);
    const before = await counts(p.transformationId);
    const counter = async () =>
      (
        await api.db
          .selectFrom("record_code_counter")
          .select("last_value")
          .where("transformation_id", "=", p.transformationId)
          .where("prefix", "=", "BF")
          .executeTakeFirst()
      )?.last_value ?? 0;
    const counterBefore = await counter();
    const bad = await create(p.lead.session, {
      transformationId: p.transformationId,
      benefitName: "Synthetic",
      initialVersion: { ...REVENUE_VERSION, expression: `${REVENUE_VERSION.expression} * churn_factor` },
    });
    expect([bad.status, bad.body.code, bad.body.detail, bad.body.errors[0].pointer]).toEqual([
      422,
      "formula.undefined_variable",
      "Undefined variable: churn_factor",
      "/initialVersion/expression",
    ]);
    expect(bad.body.type).toBe("urn:mth:problem:validation");
    // Syntax error and kind mismatch: 422 with the engine's code; schema errors are 400.
    const syntax = await create(p.lead.session, {
      transformationId: p.transformationId,
      benefitName: "Synthetic",
      initialVersion: { expression: "a ** 2", variables: [{ name: "a", kind: "number", period: "none" }] },
    });
    expect([syntax.status, syntax.body.code]).toEqual([422, "formula.syntax"]);
    const schema = await create(p.lead.session, {
      transformationId: p.transformationId,
      benefitName: "Synthetic",
      initialVersion: { expression: "a", variables: [{ name: "A", kind: "number", period: "none" }] },
    });
    expect(schema.status).toBe(400);
    expect(await counts(p.transformationId)).toEqual(before);
    expect(await counter()).toBe(counterBefore);
    // On a new version: 422 and nothing written (the row keeps version and current version).
    const f = await formula(p);
    const afterCreate = await counts(p.transformationId);
    const v = await call<Body>(api.app, "POST", `${F}/${f.id}/versions`, {
      session: p.lead.session,
      headers: ifm(f.version),
      body: { expression: "eligible_customers * missing_rate", variables: REVENUE_VERSION.variables },
    });
    expect([v.status, v.body.code, v.body.detail]).toEqual([
      422,
      "formula.undefined_variable",
      "Undefined variable: missing_rate",
    ]);
    expect(await counts(p.transformationId)).toEqual(afterCreate);
    expect((await get(p.lead.session, f.id)).body).toMatchObject({ version: f.version, currentVersionNo: 1 });
  });
});

describe("the two seeded B0087 examples (REQ-PB-057, REQ-S08-007)", () => {
  it("reading the examples shows the B0087 text verbatim, marked illustrative", async () => {
    const p = await setupP2World(api, w);
    const res = await call<Body>(api.app, "GET", "/api/v1/benefit-formula-examples", { session: p.auditor.session });
    expect(res.status).toBe(200);
    const [rev, cost] = res.body.items;
    expect(rev).toMatchObject({
      code: "revenue_uplift",
      sourceBenefitEn: "Revenue uplift",
      sourceBaselineDriverEn: "Customers × attach rate × ARPU",
      sourceChangeAssumptionEn: "Attach +X pp",
      sourceFormulaEn: "Δ attach × customers × ARPU",
      sourceRampEn: "Q1-Q4",
      sourceConfidence: "M",
      expression: "(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu",
      resultKind: "currency",
      resultCurrency: "SAR",
      resultPeriod: "year",
      exampleResult: "100000",
      isIllustrative: true,
      sourceRef: "B0087",
    });
    expect(cost).toMatchObject({
      code: "cost_reduction",
      sourceBenefitEn: "Cost reduction",
      sourceBaselineDriverEn: "Volume × unit cost",
      sourceChangeAssumptionEn: "Unit cost -X%",
      sourceFormulaEn: "Volume × Δ unit cost",
      sourceRampEn: "Q2-Q3",
      sourceConfidence: "H",
      exampleResult: "500000",
      isIllustrative: true,
    });
    expect(rev.variables.map((v: Body) => [v.name, v.kind, v.period, v.value])).toEqual([
      ["baseline_attach_rate", "fraction", "none", "0.1"],
      ["target_attach_rate", "fraction", "none", "0.12"],
      ["eligible_customers", "count", "year", "100000"],
      ["arpu", "currency", "year", "50"],
    ]);
    expect(rev.variables.every((v: Body) => /illustrative calculation, synthetic values/.test(v.source))).toBe(true);
    // Unauthenticated: 401.
    expect((await call<Body>(api.app, "GET", "/api/v1/benefit-formula-examples")).status).toBe(401);
  });

  it("instantiating revenue_uplift and previewing gives exactly 100000 SAR per year; cost_reduction 500000", async () => {
    const p = await setupP2World(api, w);
    const rev = await create(p.lead.session, {
      transformationId: p.transformationId,
      benefitName: "Synthetic roaming attach uplift",
      fromExample: "revenue_uplift",
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect(rev.body).toMatchObject({
      isIllustrative: true,
      exampleCode: "revenue_uplift",
      baselineDriver: "Customers × attach rate × ARPU",
      changeAssumption: "Attach +X pp",
      ramp: "Q1-Q4",
      confidence: "M",
      currentVersionNo: 1,
    });
    expect(rev.body.currentVersion).toMatchObject({ previewResult: "100000", validationStatus: "unvalidated" });
    const calc = await call<Body>(api.app, "POST", `${F}/${rev.body.id}/versions/1/calculations`, {
      session: p.lead.session,
      body: {},
    });
    expect([
      calc.status,
      calc.body.result,
      calc.body.resultCurrency,
      calc.body.resultPeriod,
      calc.body.rounded,
    ]).toEqual([201, "100000", "SAR", "year", false]);
    const stored = await api.db
      .selectFrom("benefit_calculation")
      .select(["result", "rounding"])
      .where("id", "=", calc.body.id)
      .executeTakeFirstOrThrow();
    expect(stored.result).toBe("100000.000000");
    // ADR-0024 §6 item 11 (migration 0027): the engine's full rounding record is on the lineage row as is, and the
    // response returns the same object.
    const revenueRounding = {
      column: "numeric(24,6)",
      scale: 6,
      mode: "ROUND_HALF_UP",
      precision: 80,
      exact: "100000",
      stored: "100000.000000",
      rounded: false,
      inexactIntermediate: false,
    };
    expect(stored.rounding).toStrictEqual(revenueRounding);
    expect(calc.body.rounding).toStrictEqual(revenueRounding);
    const listed = await call<Body>(api.app, "GET", `${F}/${rev.body.id}/versions/1/calculations`, {
      session: p.lead.session,
    });
    expect(listed.body.items.map((c: Body) => c.rounding)).toStrictEqual([revenueRounding]);

    const cost = await create(p.lead.session, {
      transformationId: p.transformationId,
      benefitName: "Synthetic unit cost reduction",
      fromExample: "cost_reduction",
    });
    expect([cost.status, cost.body.confidence, cost.body.ramp]).toEqual([201, "H", "Q2-Q3"]);
    const costCalc = await call<Body>(api.app, "POST", `${F}/${cost.body.id}/versions/1/calculations`, {
      session: p.lead.session,
      body: { assumptions: "Synthetic: 200000 transactions per year." },
    });
    expect([costCalc.status, costCalc.body.result]).toEqual([201, "500000"]);

    // Both at once is refused; an edit ends the illustrative mark.
    const both = await create(p.lead.session, {
      transformationId: p.transformationId,
      benefitName: "Synthetic",
      fromExample: "cost_reduction",
      initialVersion: COST_VERSION,
    });
    expect([both.status, both.body.code]).toEqual([422, "benefit_formula.example_and_version"]);
    const edited = await call<Body>(api.app, "PATCH", `${F}/${cost.body.id}`, {
      session: p.lead.session,
      headers: ifm(cost.body.version),
      body: { benefitName: "Synthetic unit cost reduction (team)" },
    });
    expect([edited.status, edited.body.isIllustrative, edited.body.exampleCode]).toEqual([
      200,
      false,
      "cost_reduction",
    ]);
  });

  it("changing arpu to period = month while eligible_customers stays year -> 422 formula.period_mismatch", async () => {
    const p = await setupP2World(api, w);
    const rev = (
      await create(p.lead.session, {
        transformationId: p.transformationId,
        benefitName: "Synthetic roaming attach uplift",
        fromExample: "revenue_uplift",
      })
    ).body;
    const variables = rev.currentVersion.variables.map((v: Body) =>
      v.name === "arpu" ? { ...v, period: "month" } : v,
    );
    const res = await call<Body>(api.app, "POST", `${F}/${rev.id}/versions`, {
      session: p.lead.session,
      headers: ifm(rev.version),
      body: { expression: rev.currentVersion.expression, variables },
    });
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "formula.period_mismatch",
      "Period mismatch: arpu is per month but eligible_customers is per year; convert with to_period(arpu, year)",
    ]);
    // The same through POST /benefit-formulas/validate (writes nothing).
    const check = await call<Body>(api.app, "POST", `${F}/validate`, {
      session: p.lead.session,
      body: { expression: rev.currentVersion.expression, variables },
    });
    expect([check.status, check.body.code]).toEqual([422, "formula.period_mismatch"]);
    // With the explicit conversion the new version is accepted: 0.02 × 100000 × (50 × 12) = 1200000 SAR per year.
    const ok = await call<Body>(api.app, "POST", `${F}/${rev.id}/versions`, {
      session: p.lead.session,
      headers: ifm(rev.version),
      body: {
        expression: "(target_attach_rate - baseline_attach_rate) * eligible_customers * to_period(arpu, year)",
        variables,
        changeNote: "Synthetic: monthly ARPU converted to a year.",
      },
    });
    expect([ok.status, ok.headers["location"], ok.body.versionNo, ok.body.previewResult]).toEqual([
      201,
      `${F}/${rev.id}/versions/2`,
      2,
      "1200000",
    ]);
    const after = (await get(p.lead.session, rev.id)).body;
    expect([after.currentVersionNo, after.isIllustrative, after.version]).toEqual([2, false, rev.version + 1]);
  });
});

describe("calculations and lineage", () => {
  it("records inputs with kind/unit/currency/period/source, assumptions and period; Unknown never 0; append-only", async () => {
    const p = await setupP2World(api, w);
    const f = await formula(p);
    const C = `${F}/${f.id}/versions/1/calculations`;
    const res = await call<Body>(api.app, "POST", C, {
      session: p.lead.session,
      body: {
        inputs: { eligible_customers: "120000" },
        assumptions: "Synthetic: customer base grows 20%.",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.headers["location"]).toBe(`${C}/${res.body.id}`);
    expect(res.body).toMatchObject({
      formulaVersionId: f.currentVersion.id,
      assumptions: "Synthetic: customer base grows 20%.",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      outcome: "ok",
      result: "120000",
      resultKind: "currency",
      resultCurrency: "SAR",
      resultPeriod: "year",
      errorCode: null,
      engineVersion: "mth-formula/1.0.0",
      computedBy: p.lead.id,
    });
    expect(res.body.inputs.eligible_customers).toEqual({
      name: "eligible_customers",
      kind: "count",
      unit: "customers",
      currency: null,
      period: "year",
      value: "120000",
      description: null,
      source: "Calculation input (overrides the version value)",
    });
    expect(res.body.inputs.arpu).toMatchObject({ kind: "currency", currency: "SAR", period: "year", value: "50" });
    expect(res.body.inputs.baseline_attach_rate.source).toBe("Synthetic CRM extract");
    // The engine's rounding record is on the row and in the response (0027), and the audit event repeats it.
    const overrideRounding = {
      column: "numeric(24,6)",
      scale: 6,
      mode: "ROUND_HALF_UP",
      precision: 80,
      exact: "120000",
      stored: "120000.000000",
      rounded: false,
      inexactIntermediate: false,
    };
    expect(res.body.rounding).toStrictEqual(overrideRounding);
    const [event] = await auditOf(api.db, res.body.id);
    expect(event).toMatchObject({ action: "benefit_calculation.create", record_type: "benefit_calculation" });
    expect((event!.changes as Body).rounding.to).toEqual(overrideRounding);

    // Missing input -> Unknown (null), outcome error, never 0.
    const missing = await call<Body>(api.app, "POST", C, { session: p.lead.session, body: {} });
    expect(missing.status).toBe(201);
    const unknownVersion = await call<Body>(api.app, "POST", `${F}/${f.id}/versions`, {
      session: p.lead.session,
      headers: ifm(f.version),
      body: {
        expression: "saving / volume",
        variables: [
          { name: "saving", kind: "currency", currency: "SAR", period: "year", value: "1000" },
          { name: "volume", kind: "number", period: "none", value: "0" },
        ],
      },
    });
    expect([unknownVersion.status, unknownVersion.body.previewResult]).toEqual([201, null]);
    const div = await call<Body>(api.app, "POST", `${F}/${f.id}/versions/2/calculations`, {
      session: p.lead.session,
      body: {},
    });
    expect([div.status, div.body.outcome, div.body.result, div.body.errorCode]).toEqual([
      201,
      "error",
      null,
      "formula.division_by_zero",
    ]);
    const third = await call<Body>(api.app, "POST", `${F}/${f.id}/versions`, {
      session: p.lead.session,
      headers: ifm(f.version + 1),
      body: {
        expression: "a * b",
        variables: [
          { name: "a", kind: "number", period: "none", value: "2" },
          { name: "b", kind: "number", period: "none" },
        ],
      },
    });
    const miss = await call<Body>(api.app, "POST", `${F}/${f.id}/versions/${third.body.versionNo}/calculations`, {
      session: p.lead.session,
      body: {},
    });
    expect([miss.body.outcome, miss.body.result, miss.body.errorCode]).toEqual([
      "error",
      null,
      "formula.missing_input",
    ]);
    const row = await api.db
      .selectFrom("benefit_calculation")
      .select(["result", "outcome", "rounding"])
      .where("id", "=", miss.body.id)
      .executeTakeFirstOrThrow();
    // Unknown: no exact or stored value in the rounding record either (never 0).
    const unknownRounding = {
      column: "numeric(24,6)",
      scale: 6,
      mode: "ROUND_HALF_UP",
      precision: 80,
      exact: null,
      stored: null,
      rounded: false,
      inexactIntermediate: false,
    };
    expect(row).toStrictEqual({ result: null, outcome: "error", rounding: unknownRounding });
    expect(miss.body.rounding).toStrictEqual(unknownRounding);
    // 0027: a new row without the record, or with a record that disagrees with its own columns, is refused by the
    // database (the CHECKs fire on INSERT, before the audit trigger is reached).
    const copy = (rounding: string) =>
      api.owner.query(
        `insert into benefit_calculation (id, organization_id, transformation_id, formula_version_id, inputs, outcome,
           result, result_kind, result_unit, result_currency, result_period, error_code, rounded, engine_version,
           computed_by, rounding)
         select gen_random_uuid(), organization_id, transformation_id, formula_version_id, inputs, outcome, result,
           result_kind, result_unit, result_currency, result_period, error_code, rounded, engine_version, computed_by,
           ${rounding}
         from benefit_calculation where id = $1`,
        [res.body.id],
      );
    await expect(copy("NULL")).rejects.toThrow(/benefit_calculation_rounding_required/);
    await expect(copy(`'[]'::jsonb`)).rejects.toThrow(/benefit_calculation_rounding_check/);
    await expect(copy(`rounding || '{"rounded": true}'::jsonb`)).rejects.toThrow(/benefit_calculation_rounding_shape/);
    await expect(copy(`rounding || '{"stored": "120000.000001"}'::jsonb`)).rejects.toThrow(
      /benefit_calculation_rounding_shape/,
    );
    await expect(copy(`rounding - 'inexactIntermediate'`)).rejects.toThrow(/benefit_calculation_rounding_shape/);

    // An input that is not a variable -> 422; a reversed period -> 422; nothing written.
    const before = await counts(p.transformationId);
    const undef = await call<Body>(api.app, "POST", C, { session: p.lead.session, body: { inputs: { churn: "1" } } });
    expect([undef.status, undef.body.code, undef.body.detail]).toEqual([
      422,
      "formula.undefined_variable",
      "Undefined variable: churn",
    ]);
    const range = await call<Body>(api.app, "POST", C, {
      session: p.lead.session,
      body: { periodStart: "2026-12-31", periodEnd: "2026-01-01" },
    });
    expect([range.status, range.body.code]).toEqual([422, "benefit_calculation.period_range"]);
    const notDecimal = await call<Body>(api.app, "POST", C, {
      session: p.lead.session,
      body: { inputs: { arpu: 50 } },
    });
    expect(notDecimal.status).toBe(400);
    expect(await counts(p.transformationId)).toEqual(before);

    // The lineage of version 1, newest first; rows are append-only (UPDATE, DELETE refused by the database).
    const list = await call<Body>(api.app, "GET", `${C}?limit=1`, { session: p.auditor.session });
    expect([list.status, list.body.items[0].id, typeof list.body.nextCursor]).toEqual([200, missing.body.id, "string"]);
    const next = await call<Body>(api.app, "GET", `${C}?limit=1&cursor=${encodeURIComponent(list.body.nextCursor)}`, {
      session: p.auditor.session,
    });
    expect(next.body.items.map((c: Body) => c.id)).toEqual([res.body.id]);
    await expect(
      api.owner.query(`update benefit_calculation set result = 0 where id = $1`, [res.body.id]),
    ).rejects.toThrow(/append-only/);
    await expect(api.owner.query(`delete from benefit_calculation where id = $1`, [res.body.id])).rejects.toThrow(
      /append-only/,
    );
    await expect(
      api.owner.query(`update benefit_formula_variable set value = 1 where formula_version_id = $1`, [
        f.currentVersion.id,
      ]),
    ).rejects.toThrow(/append-only/);
    // Versions are immutable: the expression cannot change.
    await expect(
      api.owner.query(`update benefit_formula_version set expression = 'a', version = version + 1 where id = $1`, [
        f.currentVersion.id,
      ]),
    ).rejects.toThrow(/immutable/);
  });
});

describe("Finance validation of the benefit logic (REQ-PB-055)", () => {
  it("FIN validates or rejects with a note; the author gets 403; final once recorded; If-Match 428/409", async () => {
    const p = await setupP2World(api, w);
    const fin = await financeUser(api, w, p);
    // A FIN who is also TL authors a formula version: they cannot validate it.
    const author = await createUser(api.db, w.orgA.id);
    for (const role of ["FIN", "TL"])
      await grant(api.db, w.grantor.id, author.id, role, { type: "transformation", id: p.transformationId }, w.orgA.id);
    const finSession = await signIn(api.app, author.subject);
    const own = await create(finSession, {
      transformationId: p.transformationId,
      benefitName: "Synthetic authored by FIN",
      initialVersion: COST_VERSION,
    });
    expect(own.status).toBe(201);
    const V = (id: string, n = 1) => `${F}/${id}/versions/${n}/validation`;
    const selfCheck = await call<Body>(api.app, "POST", V(own.body.id), {
      session: finSession,
      headers: ifm(1),
      body: { result: "validated", note: "Synthetic self-validation attempt" },
    });
    expect([selfCheck.status, selfCheck.body.code]).toEqual([403, "finance.validator_is_author"]);
    expect(await auditOfRequest(api.db, String(selfCheck.headers["x-request-id"]))).toEqual([
      expect.objectContaining({ action: "authorization.denied" }),
    ]);
    // The DB CHECK says the same.
    await expect(
      api.owner.query(
        `update benefit_formula_version set validation_status = 'validated', validated_by = created_by, validated_at = now(), version = version + 1 where id = $1`,
        [own.body.currentVersion.id],
      ),
    ).rejects.toThrow(/validator_not_author/);

    const f = await formula(p);
    // A TL (no finance.validate) -> 403; missing If-Match -> 428; stale -> 409.
    expect(
      (
        await call<Body>(api.app, "POST", V(f.id), {
          session: p.lead.session,
          headers: ifm(1),
          body: { result: "validated", note: "x" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call<Body>(api.app, "POST", V(f.id), { session: fin.session, body: { result: "validated", note: "x" } }))
        .status,
    ).toBe(428);
    expect(
      (
        await call<Body>(api.app, "POST", V(f.id), {
          session: fin.session,
          headers: ifm(4),
          body: { result: "validated", note: "x" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call<Body>(api.app, "POST", V(f.id), {
          session: fin.session,
          headers: ifm(1),
          body: { result: "maybe", note: "x" },
        })
      ).status,
    ).toBe(400);
    const ok = await call<Body>(api.app, "POST", V(f.id), {
      session: fin.session,
      headers: ifm(1),
      body: { result: "validated", note: "Synthetic demo validation; approves nothing real." },
    });
    expect([
      ok.status,
      ok.headers["etag"],
      ok.body.validationStatus,
      ok.body.validatedBy,
      ok.body.validationNote,
    ]).toEqual([200, '"2"', "validated", fin.id, "Synthetic demo validation; approves nothing real."]);
    expect((await auditOf(api.db, f.currentVersion.id)).map((e) => e.action)).toEqual([
      "benefit_formula_version.create",
      "benefit_formula_version.validate",
    ]);
    const again = await call<Body>(api.app, "POST", V(f.id), {
      session: fin.session,
      headers: ifm(2),
      body: { result: "rejected", note: "Synthetic second thoughts" },
    });
    expect([again.status, again.body.code]).toEqual([422, "benefit_formula_version.validation_final"]);
    // A new version starts unvalidated and becomes current; FIN may reject it.
    const v2 = await call<Body>(api.app, "POST", `${F}/${f.id}/versions`, {
      session: p.lead.session,
      headers: ifm(f.version),
      body: COST_VERSION,
    });
    expect([v2.status, v2.body.validationStatus]).toEqual([201, "unvalidated"]);
    const rejected = await call<Body>(api.app, "POST", V(f.id, 2), {
      session: fin.session,
      headers: ifm(1),
      body: { result: "rejected", note: "Synthetic: volume source not evidenced." },
    });
    expect([rejected.status, rejected.body.validationStatus]).toEqual([200, "rejected"]);
    const versions = await call<Body>(api.app, "GET", `${F}/${f.id}/versions`, { session: p.auditor.session });
    expect(versions.body.items.map((v: Body) => [v.versionNo, v.validationStatus])).toEqual([
      [2, "rejected"],
      [1, "validated"],
    ]);
  });
});

describe("every mutation: AUD 403, If-Match, audit, archive", () => {
  it("the read-only auditor gets 403 (audited) on every T09 mutation, whatever the body", async () => {
    const p = await setupP2World(api, w);
    const f = await formula(p);
    const aud = p.auditor.session;
    const attempts: [string, string, Record<string, unknown>, Record<string, string>?][] = [
      ["POST", F, { transformationId: p.transformationId, benefitName: "x" }],
      ["POST", F, { transformationId: p.transformationId, benefitName: "x", fromExample: "revenue_uplift" }],
      ["POST", F, { nonsense: true }],
      ["PATCH", `${F}/${f.id}`, { ramp: "x" }, ifm(f.version)],
      ["POST", `${F}/${f.id}/archive`, { reason: "Synthetic" }, ifm(f.version)],
      ["POST", `${F}/${f.id}/versions`, COST_VERSION, ifm(f.version)],
      ["POST", `${F}/${f.id}/versions/1/calculations`, {}],
      ["POST", `${F}/${f.id}/versions/1/validation`, { result: "validated", note: "x" }, ifm(1)],
      ["POST", `${F}/validate`, COST_VERSION],
      ["POST", `${F}/validate`, { nonsense: true }],
    ];
    for (const [method, url, body, headers] of attempts) {
      const res = await call<Body>(api.app, method, url, { session: aud, body, ...(headers ? { headers } : {}) });
      expect(res.status, `${method} ${url}`).toBe(403);
      if (!("nonsense" in body) && !url.endsWith("/validate"))
        expect(await auditOfRequest(api.db, String(res.headers["x-request-id"])), `${method} ${url}`).toEqual([
          expect.objectContaining({ action: "authorization.denied" }),
        ]);
    }
    expect(await counts(p.transformationId)).toEqual({ formulas: 1, versions: 1, variables: 4, calculations: 0 });
    expect((await get(aud, f.id)).body.version).toBe(f.version);
  });

  it("If-Match: 428 without, 409 stale on PATCH, archive and new version; archive guards; audit events", async () => {
    const p = await setupP2World(api, w);
    const f = await formula(p);
    const s = p.lead.session;
    for (const [method, url, body] of [
      ["PATCH", `${F}/${f.id}`, { ramp: "Q3" }],
      ["POST", `${F}/${f.id}/archive`, { reason: "Synthetic" }],
      ["POST", `${F}/${f.id}/versions`, COST_VERSION],
    ] as const) {
      expect((await call<Body>(api.app, method, url, { session: s, body })).status, url).toBe(428);
      const stale = await call<Body>(api.app, method, url, { session: s, body, headers: ifm(9) });
      expect([stale.status, stale.body.currentVersion], url).toEqual([409, f.version]);
    }
    // A formula backing an active business case line cannot be archived.
    const kase = await call<Body>(api.app, "POST", B, {
      session: s,
      body: { transformationId: p.transformationId, level: "transformation", title: "Synthetic case" },
    });
    const line = await call<Body>(api.app, "POST", `${B}/${kase.body.id}/lines`, {
      session: s,
      body: {
        lineKind: "benefit",
        class: "revenue",
        valueBasis: "revenue_uplift",
        title: "Synthetic attach",
        amount: "100000",
        currency: "SAR",
        benefitFormulaId: f.id,
      },
    });
    expect(line.status, JSON.stringify(line.body)).toBe(201);
    const inUse = await call<Body>(api.app, "POST", `${F}/${f.id}/archive`, {
      session: s,
      headers: ifm(f.version),
      body: { reason: "Synthetic" },
    });
    expect([inUse.status, inUse.body.code]).toEqual([422, "benefit_formula.in_use"]);
    const other = await formula(p, { benefitName: "Synthetic other" });
    const archived = await call<Body>(api.app, "POST", `${F}/${other.id}/archive`, {
      session: s,
      headers: ifm(other.version),
      body: { reason: "Synthetic duplicate" },
    });
    expect([archived.status, archived.body.status, archived.body.archiveReason]).toEqual([
      200,
      "archived",
      "Synthetic duplicate",
    ]);
    expect((await auditOf(api.db, other.id)).map((e) => e.action)).toEqual([
      "benefit_formula.create",
      "benefit_formula.version_set",
      "benefit_formula.archive",
    ]);
    // Archived: read-only (PATCH, version, calculation) and listed only with includeArchived.
    const ro = await call<Body>(api.app, "PATCH", `${F}/${other.id}`, {
      session: s,
      headers: ifm(archived.body.version),
      body: { ramp: "Q1" },
    });
    expect([ro.status, ro.body.code]).toEqual([422, "benefit_formula.archived"]);
    const calcOnArchived = await call<Body>(api.app, "POST", `${F}/${other.id}/versions/1/calculations`, {
      session: s,
      body: {},
    });
    expect([calcOnArchived.status, calcOnArchived.body.code]).toEqual([422, "benefit_formula.archived"]);
    const list = await call<Body>(api.app, "GET", `${F}?transformationId=${p.transformationId}`, { session: s });
    expect(list.body.items.map((x: Body) => x.id)).toEqual([f.id]);
    const all = await call<Body>(api.app, "GET", `${F}?transformationId=${p.transformationId}&includeArchived=true`, {
      session: s,
    });
    expect(all.body.items.map((x: Body) => x.id)).toEqual([other.id, f.id]);
    // The update diff is audited.
    const upd = await call<Body>(api.app, "PATCH", `${F}/${f.id}`, {
      session: s,
      headers: ifm(f.version),
      body: { ramp: "Q2-Q4" },
    });
    expect(upd.headers["etag"]).toBe(`"${f.version + 1}"`);
    const events = await auditOf(api.db, f.id);
    expect(events.at(-1)).toMatchObject({
      action: "benefit_formula.update",
      changes: { ramp: { from: null, to: "Q2-Q4" } },
    });
    // A signed-in user without a read right on the transformation sees 404, never the formula.
    const stranger = await createUser(api.db, w.orgA.id);
    expect((await get(await signIn(api.app, stranger.subject), f.id)).status).toBe(404);
  });

  const RACES: [string, string, string, (f: Body) => [url: string, body: Record<string, unknown>, version?: number]][] =
    [
      ["update", "TL", "PATCH", (f) => [`${F}/${f.id}`, { ramp: "Racing" }, f.version]],
      ["archive", "TL", "POST", (f) => [`${F}/${f.id}/archive`, { reason: "Racing" }, f.version]],
      ["new version", "TL", "POST", (f) => [`${F}/${f.id}/versions`, COST_VERSION, f.version]],
      ["calculation", "TL", "POST", (f) => [`${F}/${f.id}/versions/1/calculations`, {}]],
      [
        "validation",
        "FIN",
        "POST",
        (f) => [`${F}/${f.id}/versions/1/validation`, { result: "validated", note: "x" }, 1],
      ],
    ];
  it.each(RACES)(
    "authorization is re-checked at commit time (%s): a grant revoked after authentication -> 403, nothing written",
    async (_name, role, method, target) => {
      const p = await setupP2World(api, w);
      const f = await formula(p);
      const before = await counts(p.transformationId);
      const user = await createUser(api.db, w.orgA.id);
      const assignment = await grant(
        api.db,
        w.grantor.id,
        user.id,
        role,
        { type: "transformation", id: p.transformationId },
        w.orgA.id,
      );
      const session = await signIn(api.app, user.subject);
      const [url, body, version] = target(f);
      const locker = await api.owner.connect();
      let res: Awaited<ReturnType<typeof call<Body>>>;
      try {
        await locker.query("BEGIN");
        await locker.query("LOCK TABLE benefit_formula IN ACCESS EXCLUSIVE MODE");
        const pending = call<Body>(api.app, method, url, {
          session,
          body,
          ...(version !== undefined ? { headers: ifm(version) } : {}),
        });
        let blocked = false;
        for (let i = 0; i < 250 && !blocked; i++) {
          const r = await api.owner.query<{ n: number }>(
            `select count(*)::int as n from pg_locks where relation = 'benefit_formula'::regclass and not granted`,
          );
          blocked = r.rows[0]!.n > 0;
          if (!blocked) await new Promise((r2) => setTimeout(r2, 20));
        }
        expect(blocked).toBe(true);
        const revoked = await api.owner.query(
          `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic commit-time probe' where id = $2`,
          [w.grantor.id, assignment],
        );
        expect(revoked.rowCount).toBe(1);
        await locker.query("COMMIT");
        res = await pending;
      } finally {
        locker.release();
      }
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([
        expect.objectContaining({ action: "authorization.denied" }),
      ]);
      // Nothing written.
      expect(await counts(p.transformationId)).toEqual(before);
      const after = await api.db
        .selectFrom("benefit_formula_version")
        .select(["version", "validation_status"])
        .where("formula_id", "=", f.id)
        .execute();
      expect(after).toEqual([{ version: 1, validation_status: "unvalidated" }]);
      expect((await get(p.lead.session, f.id)).body.version).toBe(f.version);
    },
    30_000,
  );
});

describe("loadKpiP3GateFacts: the kpi half of the G4 GateFactsProvider", () => {
  it("cases with sections and baseline state (incl. Stale); each financial benefit line's current version state", async () => {
    const p = await setupP2World(api, w);
    const fin = await financeUser(api, w, p);
    const s = p.lead.session;
    expect(await loadKpiP3GateFacts(api.db, p.transformationId)).toEqual({
      transformationId: p.transformationId,
      transformationCase: null,
      initiativeCases: [],
      benefitLines: [],
    });
    const top = (
      await call<Body>(api.app, "POST", B, {
        session: s,
        body: {
          transformationId: p.transformationId,
          level: "transformation",
          title: "Synthetic case",
          sections: { baselineSummary: "Synthetic baseline: attach 10%." },
        },
      })
    ).body;
    const ini = await insertInitiative(api.db, p, { name: "Synthetic roaming bundle" });
    const iniCase = (
      await call<Body>(api.app, "POST", B, {
        session: s,
        body: { transformationId: p.transformationId, level: "initiative", initiativeId: ini, title: "Synthetic ini" },
      })
    ).body;
    const f = await formula(p);
    const benefitLine = (formulaId: string | undefined, klass = "revenue", basis = "revenue_uplift") => ({
      lineKind: "benefit",
      class: klass,
      valueBasis: basis,
      title: `Synthetic ${klass}`,
      currency: "SAR",
      ...(klass === "strategic_non_financial" ? {} : { amount: "100000" }),
      ...(formulaId ? { benefitFormulaId: formulaId } : {}),
    });
    const withFormula = await call<Body>(api.app, "POST", `${B}/${iniCase.id}/lines`, {
      session: s,
      body: benefitLine(f.id),
    });
    const without = await call<Body>(api.app, "POST", `${B}/${iniCase.id}/lines`, {
      session: s,
      body: benefitLine(undefined, "cost_reduction", "cash_saving"),
    });
    await call<Body>(api.app, "POST", `${B}/${iniCase.id}/lines`, {
      session: s,
      body: benefitLine(undefined, "strategic_non_financial", "non_financial"),
    });
    expect([withFormula.status, without.status]).toEqual([201, 201]);

    let facts = await loadKpiP3GateFacts(api.db, p.transformationId);
    expect(facts.transformationCase).toMatchObject({ id: top.id, baselineValidation: "unvalidated" });
    expect(facts.transformationCase!.missingSections).toContain("risks");
    expect(facts.initiativeCases.map((c) => [c.id, c.initiativeId])).toEqual([[iniCase.id, ini]]);
    expect(facts.benefitLines.map((l) => [l.lineId, l.formulaValidation, l.currentVersionNo])).toEqual(
      [
        [withFormula.body.id, "unvalidated", 1],
        [without.body.id, "no_formula", null],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );

    // FIN validates the baseline and the formula's current version: both read validated.
    await call<Body>(api.app, "POST", `${B}/${top.id}/baseline-validation`, {
      session: fin.session,
      headers: ifm(top.version),
      body: { result: "validated", note: "Synthetic demo" },
    });
    await call<Body>(api.app, "POST", `${F}/${f.id}/versions/1/validation`, {
      session: fin.session,
      headers: ifm(1),
      body: { result: "validated", note: "Synthetic demo" },
    });
    facts = await loadKpiP3GateFacts(api.db, p.transformationId);
    expect(facts.transformationCase!.baselineValidation).toBe("validated");
    expect(facts.benefitLines.find((l) => l.lineId === withFormula.body.id)).toMatchObject({
      formulaValidation: "validated",
      formulaCode: f.code,
      pointer: `/benefit-formulas/${f.id}/versions/1`,
    });

    // A baseline edit makes it Stale; a new formula version makes the line unvalidated again (current version only).
    const current = (await call<Body>(api.app, "GET", `${B}/${top.id}`, { session: s })).body;
    await call<Body>(api.app, "PATCH", `${B}/${top.id}`, {
      session: s,
      headers: ifm(current.version),
      body: { sections: { baselineSummary: "Synthetic baseline: attach 11%." } },
    });
    await call<Body>(api.app, "POST", `${F}/${f.id}/versions`, {
      session: s,
      headers: ifm(f.version),
      body: REVENUE_VERSION,
    });
    facts = await loadKpiP3GateFacts(api.db, p.transformationId);
    expect(facts.transformationCase!.baselineValidation).toBe("stale");
    expect(facts.benefitLines.find((l) => l.lineId === withFormula.body.id)).toMatchObject({
      formulaValidation: "unvalidated",
      currentVersionNo: 2,
    });
  });
});
