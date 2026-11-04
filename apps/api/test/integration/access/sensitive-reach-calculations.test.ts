// The calculation lineage of a sensitive benefit's measurements (T-DG6-BE-Z1; F-DG6-180; ADR-0051 §2; REQ-S10-002),
// against the run's disposable PostgreSQL. Every value is SYNTHETIC. Marking a record or granting access is an access
// decision, never a business approval (G1-G6), and nothing here touches the engineering gates DG0-DG7.
//
// A measurement computed with a formula version writes a benefit_calculation row holding its inputs and its result (the
// measured amount), and GET /benefit-formulas/{formulaId}/versions/{n}/calculations lists the rows of the version on
// transformation.read. Ported from the code-security reviewer's round-2 reproduction 'P-CALC'
// (docs/delivery/test-evidence/DG6/code-security/round-2/repro/zz-cs-r2-sens-reach.test.ts) onto the product fixtures:
//   - negative: after a TO marks the formula-backed benefit sensitive, TL and AUD (no grant, not a named party) get 404
//     on the benefit AND the lineage row of its measurement is absent from the list (not 403; the other rows, a plain
//     benefit's lineage and a stand-alone T09 calculation, are still listed, so nothing else is hidden);
//   - positive: the TO (sensitive_record.grant), the owner (a named party) and TL after an explicit grant still list the
//     row with its inputs and result.
// It fails on the round-2 candidate (the row is listed to TL and AUD) and passes with the benefit_calculation `via`
// source of access/sensitive-reach.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { measuredBenefit, revenueFormula, type RevenueFormula } from "../benefits/value-fixtures.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { call, seedWorld, signIn, startApi, type Res, type Session, type TestApi } from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let b: BenefitWorld;
let office: Session; // TO @ organization A: sensitive_record.grant (admitted by §2 rule 3)
let tl: Session; // TL @ the transformation: not a named party of the benefit
let aud: Session; // AUD @ organization A: AUD alone admits nothing
let formula: RevenueFormula;
let sensitiveId = "";
let sensitiveCalcId = "";
let plainCalcId = "";
let standaloneCalcId = "";

const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Body;
};
/** The formula's version-1 lineage rows, every page (limit 2, so the filter is exercised across cursor pages). */
async function lineage(s: Session): Promise<Body[]> {
  const out: Body[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i += 1) {
    const q: string = cursor === null ? "?limit=2" : `?limit=2&cursor=${encodeURIComponent(cursor)}`;
    const page = ok(
      await call<Body>(api.app, "GET", `/api/v1/benefit-formulas/${formula.id}/versions/1/calculations${q}`, {
        session: s,
      }),
    );
    out.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  return out;
}
const ids = (rows: Body[]) => rows.map((r) => r.id as string);
/** Records a formula-computed measurement on the benefit (BO, the owner) and returns its lineage row id. */
async function formulaMeasurement(benefitId: string): Promise<string> {
  const m = ok(
    await call<Body>(api.app, "POST", `${b.base}/benefits/${benefitId}/measurements`, {
      session: b.s.bo,
      body: {
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        formulaVersionId: formula.versionId,
        assumptions: "Synthetic: attach measured on the base",
      },
    }),
    201,
  );
  expect(m.amount).toBe("100000.0000");
  expect(typeof m.benefitCalculationId).toBe("string");
  return m.benefitCalculationId as string;
}

beforeAll(async () => {
  api = await startApi();
  const w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  tl = b.s.tl;
  aud = b.s.auditor;
  formula = await revenueFormula(api, b);
  // Two benefits measured through the SAME formula version, so one list holds both lineage rows.
  sensitiveId = (await measuredBenefit(api, b, { formula, extra: { title: "Synthetic confidential attach uplift" } }))
    .id;
  const plainId = (await measuredBenefit(api, b, { formula, extra: { title: "Synthetic open attach uplift" } })).id;
  sensitiveCalcId = await formulaMeasurement(sensitiveId);
  plainCalcId = await formulaMeasurement(plainId);
  // A stand-alone T09 calculation of the version (no measurement references it: it has no sensitive owner).
  standaloneCalcId = ok(
    await call<Body>(api.app, "POST", `/api/v1/benefit-formulas/${formula.id}/versions/1/calculations`, {
      session: tl,
      body: { periodStart: "2026-09-01", periodEnd: "2026-09-30" },
    }),
    201,
  ).id as string;
}, 120_000);
afterAll(() => api?.close());

describe("before marking: every reader lists all lineage rows (DG3-DG5 unchanged)", () => {
  it("TL and AUD list the measurement lineage of both benefits and the stand-alone calculation", async () => {
    for (const s of [tl, aud]) {
      const rows = await lineage(s);
      expect(ids(rows)).toEqual(expect.arrayContaining([sensitiveCalcId, plainCalcId, standaloneCalcId]));
      expect(rows).toHaveLength(3);
    }
  });
});

describe("after marking the formula-backed benefit sensitive (F-DG6-180)", () => {
  beforeAll(async () => {
    ok(
      await call<Body>(api.app, "PUT", `${b.base}/records/benefit/${sensitiveId}/sensitivity`, {
        session: office,
        headers: ifm(0),
        body: { isSensitive: true, reason: "Synthetic commercially sensitive figure" },
      }),
    );
  });

  it("control: TL and AUD get 404 on the benefit itself", async () => {
    for (const s of [tl, aud])
      expect((await call(api.app, "GET", `${b.base}/benefits/${sensitiveId}`, { session: s })).status).toBe(404);
  });

  it("P-CALC: TL and AUD list the calculations 200 WITHOUT the sensitive measurement's lineage row", async () => {
    for (const s of [tl, aud]) {
      const rows = await lineage(s);
      expect(rows.find((r) => r.id === sensitiveCalcId)).toBeUndefined();
      // Nothing else is hidden: the plain benefit's lineage and the stand-alone calculation remain, with their values.
      expect(ids(rows).sort()).toEqual([plainCalcId, standaloneCalcId].sort());
      expect(rows.find((r) => r.id === plainCalcId)?.result).toBe("100000");
    }
  });

  it("positive: the TO and the owner (a named party) still list the row with its inputs and result", async () => {
    for (const s of [office, b.s.bo]) {
      const rows = await lineage(s);
      expect(rows).toHaveLength(3);
      const row = rows.find((r) => r.id === sensitiveCalcId);
      expect(row).toMatchObject({ formulaVersionId: formula.versionId, outcome: "ok", result: "100000" });
      expect(Object.keys(row.inputs).sort()).toEqual([
        "arpu",
        "baseline_attach_rate",
        "eligible_customers",
        "target_attach_rate",
      ]);
    }
  });

  it("positive: TL with an explicit grant on the benefit lists the row again (next request)", async () => {
    ok(
      await call<Body>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
        session: office,
        body: {
          transformationId: b.transformationId,
          recordType: "benefit",
          recordId: sensitiveId,
          granteeUserId: b.users.tl.id,
          reason: "Synthetic need to know",
        },
      }),
      201,
    );
    expect(ids(await lineage(tl))).toContain(sensitiveCalcId);
    // AUD still has no grant: the row stays absent for it.
    expect(ids(await lineage(aud))).not.toContain(sensitiveCalcId);
  });
});
