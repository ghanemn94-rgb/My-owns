// REVISION 2 (v2) of sec-r4-evalerror-api.test.ts: identical, except that the two MARKED requests pass
// `contract: false`. Revision 1 failed both tests before its assertions ran, because the harness's contract check refuses
// any status an operation does not declare, and no operation of the 270 declares 500 (the project-wide convention for
// an unexpected error). Unmarked requests keep the contract check.
// code-security-reviewer DG3 round-4 (T-DG3-REV-SEC-R4) probe, run ONLY in a disposable clone (copied to
// apps/api/test/integration/zz-sec-r4/ by checks-extra.sh and removed afterwards). SYNTHETIC data.
// Question (assignment §2): "Does the EvalError rethrow change any API or web behaviour? A 500 can only occur if code
// generation is refused, so check that the API callers handle it safely."
// The real engine never throws EvalError without --disallow-code-generation-from-strings, and the API cannot run under
// that flag (Fastify's serializers compile with new Function). So @mth/shared/calc is wrapped: for a marker expression
// validateFormula / evaluateFormula throw a real EvalError (what the engine now rethrows); every other call goes to the
// real engine. Expected: a generic 500 `internal` problem with no internal detail (no "EvalError", no message, no
// stack), nothing written (the create transaction rolls back / never starts), and the unmarked request unchanged.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { setupP2World } from "../../support/p2-fixtures.ts";

vi.mock("@mth/shared/calc", async (importOriginal) => {
  const m = await importOriginal<typeof import("@mth/shared/calc")>();
  const marked = (e: unknown) => typeof e === "string" && e.includes("r4_evalerror_marker");
  const refuse = () => {
    throw new EvalError("Code generation from strings disallowed for this context");
  };
  return {
    ...m,
    validateFormula: (e: unknown, v: unknown) => (marked(e) ? refuse() : m.validateFormula(e, v)),
    evaluateFormula: (e: unknown, v: unknown, i?: Record<string, string>) =>
      marked(e) ? refuse() : m.evaluateFormula(e, v, i),
  };
});

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close(), 60_000);

const F = "/api/v1/benefit-formulas";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const VARS = [
  { name: "a", kind: "number", period: "none", value: "6" },
  { name: "r4_evalerror_marker", kind: "number", period: "none", value: "7" },
];
const LEAK = /EvalError|Code generation|disallowed|stack|at .*\.ts/;

describe("sec-r4: an EvalError from the engine is a generic 500 at the API, never a formula problem", () => {
  it("POST /benefit-formulas/validate: marked -> 500 internal without detail; unmarked -> 200 unchanged", async () => {
    const p = await setupP2World(api, w);
    const bad = await call<Body>(api.app, "POST", `${F}/validate`, {
      session: p.lead.session,
      contract: false,
      body: { expression: "a * r4_evalerror_marker", variables: VARS },
    });
    console.log("validate marked:", bad.status, JSON.stringify(bad.body));
    expect(bad.status).toBe(500);
    expect(bad.body).toMatchObject({ code: "internal" });
    expect(JSON.stringify(bad.body)).not.toMatch(LEAK);
    const good = await call<Body>(api.app, "POST", `${F}/validate`, {
      session: p.lead.session,
      body: { expression: "a * b", variables: [VARS[0], { ...VARS[1], name: "b" }] },
    });
    console.log("validate unmarked:", good.status, JSON.stringify(good.body));
    expect([good.status, good.body.valid, good.body.result]).toEqual([200, true, "42"]);
  });

  it("POST /benefit-formulas (create): marked -> 500 internal, nothing written; unmarked -> 201", async () => {
    const p = await setupP2World(api, w);
    const count = async () =>
      (
        await api.db
          .selectFrom("benefit_formula")
          .select("id")
          .where("transformation_id", "=", p.transformationId)
          .execute()
      ).length;
    const before = await count();
    const bad = await call<Body>(api.app, "POST", F, {
      session: p.lead.session,
      contract: false,
      body: {
        transformationId: p.transformationId,
        benefitName: "Synthetic r4 probe",
        initialVersion: { expression: "a * r4_evalerror_marker", variables: VARS },
      },
    });
    console.log("create marked:", bad.status, JSON.stringify(bad.body));
    expect(bad.status).toBe(500);
    expect(bad.body).toMatchObject({ code: "internal" });
    expect(JSON.stringify(bad.body)).not.toMatch(LEAK);
    expect(await count()).toBe(before);
    const good = await call<Body>(api.app, "POST", F, {
      session: p.lead.session,
      body: {
        transformationId: p.transformationId,
        benefitName: "Synthetic r4 probe",
        initialVersion: { expression: "a * b", variables: [VARS[0], { ...VARS[1], name: "b" }] },
      },
    });
    console.log("create unmarked:", good.status, good.body?.currentVersion?.previewResult);
    expect(good.status).toBe(201);
    expect(await count()).toBe(before + 1);
  });
});
