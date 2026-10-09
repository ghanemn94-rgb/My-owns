// KPI formulas and the KPI reference graph against a real PostgreSQL (T-DG4-KBE-B; ADR-0027 §4, ADR-0028 §8;
// REQ-S07-011 A05 "KPI A = B + 1 and B = A * 2 is rejected as circular; adding SAR to a count is rejected"):
//  - the cycle walk under lock 730228 names the path by KPI names (422 kpi_formula.circular, exact text), for the
//    literal A05 example, a self-reference, a longer cycle, and two drafts that reference each other (the first
//    activation succeeds, the second is refused);
//  - units through the unchanged DG3 engine and KBE-A's binding: SAR + count is 422 formula.kind_mismatch (engine
//    text), a result in another unit 422 kpi_formula.unit_mismatch, an unknown input KPI 422
//    kpi_formula.input_unknown_kpi; nothing is written on any refusal;
//  - the database's last line (trigger kpi_formula_no_cycle) maps to 422 kpi_formula.circular (platform/db-errors.ts).
// All data is synthetic; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "../../../src/modules/platform/db-errors.ts";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import { createKpi, ifMatch, postVersion } from "./kbe-b-fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let adm: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  adm = await signIn(api.app, w.admin.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const problem = (res: { status: number; body: Body }, status: number, code: string, detail?: string) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.code).toBe(code);
  if (detail !== undefined) expect(res.body.detail).toBe(detail);
};
/** Ad-hoc score KPIs: engine kind number, period none (so `b + 1` type-checks; ADR-0028 §8 table). */
const scoreKpi = (name: string) => createKpi(api, k, { name, unitKind: "score", unitLabel: null, frequency: "ad_hoc" });
const formulaVersion = (
  expression: string,
  inputs: { variableName: string; sourceKpiDefinitionId: string; inputBasis: "period" }[],
  extra: object = {},
) => ({
  measureType: "higher_is_better",
  valueNature: "flow",
  aggregationRule: "sum",
  submissionRoute: "direct_accept",
  calculationMethod: "formula",
  formulaExpression: expression,
  formulaInputs: inputs,
  ...extra,
});
const activate = (id: string, version = 1, session = k.s.kds) =>
  call(api.app, "POST", `${k.base}/kpi-versions/${id}/activate`, { session, headers: ifMatch(version) });
const versionCount = async (kpiId: string) =>
  (await api.db.selectFrom("kpi_version").select("id").where("kpi_definition_id", "=", kpiId).execute()).length;

describe("REQ-S07-011: circular references", () => {
  it("A05: KPI A = B + 1 and B = A * 2 is rejected as circular, naming the path", async () => {
    const a = await scoreKpi("KPI A");
    const b = await scoreKpi("KPI B");
    const av = await postVersion(
      api,
      k,
      a.id,
      formulaVersion("b + 1", [{ variableName: "b", sourceKpiDefinitionId: b.id, inputBasis: "period" }]),
    );
    expect([av.status, av.body.formulaEngineVersion, av.body.formulaInputs], JSON.stringify(av.body)).toEqual([
      201,
      "mth-formula/1.0.0",
      [{ variableName: "b", sourceKpiDefinitionId: b.id, inputBasis: "period" }],
    ]);
    expect((await activate(av.body.id)).status).toBe(200);
    const bv = await postVersion(
      api,
      k,
      b.id,
      formulaVersion("a * 2", [{ variableName: "a", sourceKpiDefinitionId: a.id, inputBasis: "period" }]),
    );
    problem(bv, 422, "kpi_formula.circular", "The formula would create a circular reference: KPI B → KPI A → KPI B.");
    expect(bv.body.errors[0].pointer).toBe("/formulaInputs");
    expect(await versionCount(b.id)).toBe(0);
  });

  it("a self-reference and a three-KPI cycle are refused; a chain without a cycle is accepted", async () => {
    const x = await scoreKpi("KPI X");
    problem(
      await postVersion(
        api,
        k,
        x.id,
        formulaVersion("x + 1", [{ variableName: "x", sourceKpiDefinitionId: x.id, inputBasis: "period" }]),
      ),
      422,
      "kpi_formula.circular",
      "The formula would create a circular reference: KPI X → KPI X.",
    );
    const p = await scoreKpi("KPI P");
    const q = await scoreKpi("KPI Q");
    const r = await scoreKpi("KPI R");
    // P = q, Q = r (active): a chain, no cycle.
    for (const [kpi, src, name] of [
      [p, q, "q"],
      [q, r, "r"],
    ] as const) {
      const v = await postVersion(
        api,
        k,
        kpi.id,
        formulaVersion(name, [{ variableName: name, sourceKpiDefinitionId: src.id, inputBasis: "period" }]),
      );
      expect(v.status, JSON.stringify(v.body)).toBe(201);
      expect((await activate(v.body.id)).status).toBe(200);
    }
    // R = p closes R -> P -> Q -> R.
    problem(
      await postVersion(
        api,
        k,
        r.id,
        formulaVersion("p", [{ variableName: "p", sourceKpiDefinitionId: p.id, inputBasis: "period" }]),
      ),
      422,
      "kpi_formula.circular",
      "The formula would create a circular reference: KPI R → KPI P → KPI Q → KPI R.",
    );
  });

  it("two drafts that reference each other: the first activation succeeds, the second is refused", async () => {
    const c = await scoreKpi("KPI C");
    const d = await scoreKpi("KPI D");
    const cv = await postVersion(
      api,
      k,
      c.id,
      formulaVersion("d + 1", [{ variableName: "d", sourceKpiDefinitionId: d.id, inputBasis: "period" }]),
    );
    const dv = await postVersion(
      api,
      k,
      d.id,
      formulaVersion("c * 2", [{ variableName: "c", sourceKpiDefinitionId: c.id, inputBasis: "period" }]),
    );
    expect([cv.status, dv.status]).toEqual([201, 201]);
    expect((await activate(cv.body.id)).status).toBe(200);
    problem(
      await activate(dv.body.id),
      422,
      "kpi_formula.circular",
      "The formula would create a circular reference: KPI D → KPI C → KPI D.",
    );
    expect((await call(api.app, "GET", `${k.base}/kpi-versions/${dv.body.id}`, { session: k.s.kds })).body.status).toBe(
      "draft",
    );
  });

  it("the database's last line (trigger kpi_formula_no_cycle) maps to 422 kpi_formula.circular", async () => {
    const e = await scoreKpi("KPI E");
    const f = await scoreKpi("KPI F");
    const ev = await postVersion(
      api,
      k,
      e.id,
      formulaVersion("f", [{ variableName: "f", sourceKpiDefinitionId: f.id, inputBasis: "period" }]),
    );
    expect((await activate(ev.body.id)).status).toBe(200);
    const fv = await postVersion(api, k, f.id, formulaVersion("2", []));
    expect(fv.status, JSON.stringify(fv.body)).toBe(201);
    let caught: unknown;
    try {
      await api.db
        .insertInto("kpi_formula_input")
        .values({
          id: uuidv7(),
          organization_id: w.orgA.id,
          transformation_id: k.transformationId,
          kpi_version_id: fv.body.id,
          variable_name: "e",
          source_kpi_definition_id: e.id,
          created_by: k.users.kds.id,
        })
        .execute();
    } catch (err) {
      caught = err;
    }
    const mapped = mapDatabaseGuardError(caught as { code?: string; constraint?: string; message?: string });
    expect([mapped?.status, mapped?.code, mapped?.detail]).toEqual([
      422,
      "kpi_formula.circular",
      "The formula would create a circular reference: e.",
    ]);
  });
});

describe("REQ-S07-011: invalid units (the DG3 engine, unchanged)", () => {
  it("A05: adding SAR to a count is rejected with the engine's formula.kind_mismatch", async () => {
    const rev = await createKpi(api, k, { name: "Revenue", unitKind: "currency", currency: "SAR", unitLabel: null });
    const lines = await createKpi(api, k, { name: "Lines", unitKind: "count", unitLabel: "lines" });
    const total = await createKpi(api, k, {
      name: "Revenue plus lines",
      unitKind: "currency",
      currency: "SAR",
      unitLabel: null,
    });
    const res = await postVersion(
      api,
      k,
      total.id,
      formulaVersion("r + c", [
        { variableName: "r", sourceKpiDefinitionId: rev.id, inputBasis: "period" },
        { variableName: "c", sourceKpiDefinitionId: lines.id, inputBasis: "period" },
      ]),
    );
    problem(res, 422, "formula.kind_mismatch", "Kind mismatch: r (currency) + c (count) is not allowed");
    expect(res.body.errors[0].pointer).toBe("/formulaExpression");
    // A result in another unit: kpi_formula.unit_mismatch (ADR-0027 §13 text).
    problem(
      await postVersion(
        api,
        k,
        total.id,
        formulaVersion("c", [{ variableName: "c", sourceKpiDefinitionId: lines.id, inputBasis: "period" }]),
      ),
      422,
      "kpi_formula.unit_mismatch",
      "The formula gives count (lines), but the KPI is measured in SAR.",
    );
    // A consistent formula is accepted: SAR = SAR * number.
    const ok = await postVersion(
      api,
      k,
      total.id,
      formulaVersion("r * 2", [{ variableName: "r", sourceKpiDefinitionId: rev.id, inputBasis: "period" }]),
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it("on publish the units are checked again: a source whose unit changed since the draft was saved is refused", async () => {
    const src = await createKpi(api, k, { name: "Source lines", unitKind: "count", unitLabel: "lines" });
    const sum = await createKpi(api, k, { name: "Lines copy", unitKind: "count", unitLabel: "lines" });
    const draft = await postVersion(
      api,
      k,
      sum.id,
      formulaVersion("s", [{ variableName: "s", sourceKpiDefinitionId: src.id, inputBasis: "period" }]),
    );
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    // The source has no version, so its unit can still change (DG2 behaviour, D-091 (2)).
    const changed = await call(api.app, "PATCH", `${k.base}/kpi-definitions/${src.id}`, {
      session: k.s.kds,
      headers: ifMatch(src.version),
      body: { unitKind: "currency", currency: "SAR", unitLabel: null },
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    problem(
      await activate(draft.body.id),
      422,
      "kpi_formula.unit_mismatch",
      "The formula gives SAR, but the KPI is measured in count (lines).",
    );
    expect(
      (await call(api.app, "GET", `${k.base}/kpi-versions/${draft.body.id}`, { session: k.s.kds })).body.status,
    ).toBe("draft");
  });

  it("an input that is not a KPI of this transformation, an undefined variable and a formula shape error are refused", async () => {
    const s = await scoreKpi("KPI S");
    problem(
      await postVersion(
        api,
        k,
        s.id,
        formulaVersion("z", [{ variableName: "z", sourceKpiDefinitionId: uuidv7(), inputBasis: "period" }]),
      ),
      422,
      "kpi_formula.input_unknown_kpi",
      "The formula input z must name a KPI of this transformation.",
    );
    problem(
      await postVersion(api, k, s.id, formulaVersion("y + 1", [])),
      422,
      "formula.undefined_variable",
      "Undefined variable: y",
    );
    problem(
      await postVersion(api, k, s.id, {
        measureType: "higher_is_better",
        valueNature: "flow",
        calculationMethod: "formula",
        submissionRoute: "direct_accept",
      }),
      422,
      "validation.constraint",
    );
    problem(
      await postVersion(api, k, s.id, {
        measureType: "higher_is_better",
        valueNature: "flow",
        submissionRoute: "direct_accept",
        formulaInputs: [{ variableName: "a", sourceKpiDefinitionId: s.id, inputBasis: "period" }],
      }),
      422,
      "validation.constraint",
    );
    expect(await versionCount(s.id)).toBe(0);
  });

  it("AUD and an ADM-only user cannot create a formula version (403)", async () => {
    const g = await scoreKpi("KPI G");
    const h = await scoreKpi("KPI H");
    for (const session of [k.s.auditor, adm])
      expect(
        (
          await postVersion(
            api,
            k,
            g.id,
            formulaVersion("h", [{ variableName: "h", sourceKpiDefinitionId: h.id, inputBasis: "period" }]),
            session,
          )
        ).status,
      ).toBe(403);
    expect(await versionCount(g.id)).toBe(0);
  });
});
