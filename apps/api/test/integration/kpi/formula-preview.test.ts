// Formula preview (REQ-S08-005, M0168; ADR-0047 §4; p5-work-split §G.3, T-DG5-KBE-F) against a real PostgreSQL. The
// B0087 examples are the seeded illustrative rows of 0023 (synthetic values). Nothing here writes; nothing touches
// the engineering gates DG0-DG7.
//  - REQ-S08-005: {exampleCode: "revenue_uplift"} gives unit kind `currency`, currency `SAR`, and the edge case `arpu`
//    missing -> `not_computable` with `formula.missing_input`, never 0;
//  - the playbook's two examples, worked by hand: Δ attach × customers × ARPU = (0.12 - 0.10) × 100000 × 50 = 100000
//    SAR; volume × Δ unit cost = 200000 × (12.50 - 10.00) = 500000 SAR;
//  - zero / missing / negative edge cases (negative only for kinds that admit a sign), division by zero;
//  - an invalid expression is 422 with the engine's own first code and text (ADR-0024 §6, the engine unchanged).
import { validateFormula } from "@mth/shared/calc";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOfRequest,
  call,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const PREVIEW = "/api/v1/formula-previews";

let api: TestApi;
let w: World;
let auditor: Session;
let office: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  auditor = await signIn(api.app, w.auditor.subject);
  office = await signIn(api.app, w.office.subject);
}, 60_000);
afterAll(() => api.close(), 60_000);

const preview = (body: unknown, session: Session | null = office) =>
  call<Body>(api.app, "POST", PREVIEW, { session, body });
const edge = (b: Body, variable: string, kind: string) =>
  (b.edgeCases as Body[]).find((e) => e.variable === variable && e.case === kind);

describe("REQ-S08-005: the revenue uplift example shows SAR as the unit and 'Not computable' for a missing ARPU", () => {
  it("unit currency SAR (year); the source example is 100000; arpu missing is not_computable formula.missing_input", async () => {
    const res = await preview({ exampleCode: "revenue_uplift" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.errors).toEqual([]);
    // unitLabel is the engine's own result type (ADR-0024 §6 unit propagation, unchanged): arpu's "per customer".
    const engine = validateFormula("(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu", [
      { name: "target_attach_rate", kind: "fraction", period: "none" },
      { name: "baseline_attach_rate", kind: "fraction", period: "none" },
      { name: "eligible_customers", kind: "count", period: "year", unit: "customers" },
      { name: "arpu", kind: "currency", period: "year", currency: "SAR", unit: "per customer" },
    ]);
    expect(engine.ok && engine.resultType.unit).toBe("per customer");
    expect(res.body.unit).toEqual({ kind: "currency", currency: "SAR", period: "year", unitLabel: "per customer" });
    expect(res.body.engineVersion).toBe("mth-formula/1.0.0");
    expect(res.body.examples).toEqual([
      {
        label: "Source example",
        inputs: { target_attach_rate: "0.12", baseline_attach_rate: "0.1", eligible_customers: "100000", arpu: "50" },
        status: "ok",
        result: "100000",
        reasonCode: null,
      },
    ]);
    expect(edge(res.body, "arpu", "missing")).toEqual({
      variable: "arpu",
      case: "missing",
      status: "not_computable",
      result: null,
      reasonCode: "formula.missing_input",
    });
  });

  it("every edge case, worked: zero, missing, and negative only for the signed kind (arpu, currency)", async () => {
    const res = await preview({ exampleCode: "revenue_uplift" });
    const cases = (res.body.edgeCases as Body[]).map((e) => [e.variable, e.case, e.status, e.result, e.reasonCode]);
    expect(cases).toEqual([
      // (0 - 0.10) × 100000 × 50 = -500000
      ["target_attach_rate", "zero", "ok", "-500000", null],
      ["target_attach_rate", "missing", "not_computable", null, "formula.missing_input"],
      // (0.12 - 0) × 100000 × 50 = 600000
      ["baseline_attach_rate", "zero", "ok", "600000", null],
      ["baseline_attach_rate", "missing", "not_computable", null, "formula.missing_input"],
      ["eligible_customers", "zero", "ok", "0", null],
      ["eligible_customers", "missing", "not_computable", null, "formula.missing_input"],
      ["arpu", "zero", "ok", "0", null],
      ["arpu", "missing", "not_computable", null, "formula.missing_input"],
      // 0.02 × 100000 × -50 = -100000
      ["arpu", "negative", "ok", "-100000", null],
    ]);
    // Never 0 for Unknown: every not_computable outcome has a null result.
    for (const e of res.body.edgeCases as Body[]) if (e.status === "not_computable") expect(e.result).toBeNull();
  });

  it("named examples: a missing input is not_computable (never 0); given inputs override the seeded values", async () => {
    const res = await preview({
      exampleCode: "revenue_uplift",
      examples: [
        { label: "Synthetic: +3 pp", inputs: { target_attach_rate: "0.13" } },
        { label: "Synthetic: ARPU unknown", inputs: { arpu: null } },
      ],
      edgeCases: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.edgeCases).toEqual([]);
    expect(res.body.examples.map((e: Body) => [e.label, e.status, e.result, e.reasonCode])).toEqual([
      ["Source example", "ok", "100000", null],
      // (0.13 - 0.10) × 100000 × 50 = 150000
      ["Synthetic: +3 pp", "ok", "150000", null],
      ["Synthetic: ARPU unknown", "not_computable", null, "formula.missing_input"],
    ]);
    expect(res.body.examples[2].inputs.arpu).toBeNull();
  });
});

describe("the playbook's second example and an expression with typed variables", () => {
  it("cost_reduction: volume × Δ unit cost = 200000 × (12.50 - 10.00) = 500000 SAR; negatives for both unit costs", async () => {
    const res = await preview({ exampleCode: "cost_reduction" });
    expect(res.status).toBe(200);
    expect(res.body.unit).toEqual({ kind: "currency", currency: "SAR", period: "year", unitLabel: "per transaction" });
    expect(res.body.examples[0]).toMatchObject({ label: "Source example", status: "ok", result: "500000" });
    // 200000 × (-12.5 - 10) = -4500000; 200000 × (12.5 - (-10)) = 4500000; a count has no negative case.
    expect(edge(res.body, "baseline_unit_cost", "negative")).toMatchObject({ status: "ok", result: "-4500000" });
    expect(edge(res.body, "target_unit_cost", "negative")).toMatchObject({ status: "ok", result: "4500000" });
    expect(edge(res.body, "eligible_volume", "negative")).toBeUndefined();
  });

  it("division by zero is not_computable formula.division_by_zero; a missing declared value warns and uses -1 for negative", async () => {
    const variables = [
      { name: "saving", kind: "currency", currency: "SAR", period: "year", value: "1200" },
      { name: "months", kind: "number", period: "none", value: null },
    ];
    const res = await preview({ expression: "saving / months", variables });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.unit).toMatchObject({ kind: "currency", currency: "SAR", period: "year" });
    expect(res.body.examples).toEqual([]);
    expect(res.body.errors.map((e: Body) => e.code)).toEqual(["formula.missing_input"]);
    expect(edge(res.body, "months", "zero")).toMatchObject({
      status: "not_computable",
      result: null,
      reasonCode: "formula.division_by_zero",
    });
    // months has no value: the negative case uses -1 (1200 / -1 = -1200); saving's negative is -1200 / missing months.
    expect(edge(res.body, "months", "negative")).toMatchObject({ status: "ok", result: "-1200" });
    expect(edge(res.body, "saving", "negative")).toMatchObject({
      status: "not_computable",
      reasonCode: "formula.missing_input",
    });
  });
});

describe("refusals and side effects", () => {
  it("an expression the engine refuses is 422 with the engine's own first code and text (unchanged)", async () => {
    const variables = [
      { name: "a", kind: "currency", currency: "SAR", period: "none", value: "1" },
      { name: "b", kind: "currency", currency: "USD", period: "none", value: "1" },
    ];
    for (const expression of ["a +", "a + b", "a * b", "c"]) {
      const engine = validateFormula(expression, variables);
      if (engine.ok) throw new Error(`the engine accepted ${expression}`);
      const first = engine.errors[0]!;
      const res = await preview({ expression, variables });
      expect([res.status, res.body.code, res.body.detail]).toEqual([422, first.code, first.message]);
    }
  });

  it("an example input naming no variable is 422 formula.undefined_variable; both or neither source is 400", async () => {
    const res = await preview({ exampleCode: "revenue_uplift", examples: [{ label: "x", inputs: { nope: "1" } }] });
    expect([res.status, res.body.code]).toEqual([422, "formula.undefined_variable"]);
    expect((await preview({ exampleCode: "revenue_uplift", expression: "1" })).status).toBe(400);
    expect((await preview({})).status).toBe(400);
    expect((await preview({ exampleCode: "revenue_uplift", variables: [] })).status).toBe(400);
    expect((await preview({ exampleCode: "nope" })).status).toBe(400);
  });

  it("session only: AUD may preview (writes nothing); no session is 401; no audit event is written", async () => {
    const res = await preview({ exampleCode: "revenue_uplift" }, auditor);
    expect(res.status).toBe(200);
    expect(await auditOfRequest(api.db, res.headers["x-request-id"] as string)).toEqual([]);
    expect((await preview({ exampleCode: "revenue_uplift" }, null)).status).toBe(401);
  });
});
