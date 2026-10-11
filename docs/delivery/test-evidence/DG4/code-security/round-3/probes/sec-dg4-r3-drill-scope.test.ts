// code-security-reviewer DG4 ROUND-3 probe DS, revision 2 (rev 1 used limit=200 > PAGINATION.maxLimit and got 400 on every call: probe-DS-node22-lang-unset.log) (T-DG4-REV-SEC-R3): scope sweep of the value drill-downs after the
// round-2 repair (drilldown.ts `asBuilt` branch removed; ADR-0037 amendment N3), with and without `valueClass`.
// NOT product code; runs only in a disposable clone, copied to apps/api/test/integration/zz-sec-dg4/. All data is
// synthetic; a Finance approval here is a synthetic in-product approval of test data that approves nothing real.
//
// World: two transformations T1 and T2 of org A, each with benefits of all five financial classes (margin_uplift with
// a Finance-validated measurement, cash_saving with a submitted one, working_capital_release, revenue_uplift,
// avoided_cost). T2's amounts are 1000x T1's so any leak into a sum is visible.
// Callers: TL1 = TL scoped to T1 only; AUD (org-wide read); ADM-only (org A admin, no transformation grant);
// OUT (office user of org B).
// Assertions:
//  1. TL1, every value metric (7 value states + value.gap) x valueClass {none, 6 classes} x transformation filter
//     {none, T1, T2, T1+T2}: no id/code of T2 or of any T2 row in the body; T2 or T1+T2 filter -> 404; with no filter
//     or T1 the response equals AUD's response filtered to T1 (value, items, calculation, headlineBasis).
//  2. TL1, subjectId = a T2 benefit, every value-state metric x valueClass: never 200; no T2 id in the body.
//  3. ADM-only and OUT: every metric x valueClass: no id of any org-A transformation-scoped row (T1 or T2).
//  4. Control: AUD with no filter sees T1+T2 (the probe can detect a leak): planned P&C = 92.5 + 92500.
//  5. TL1 follows every value headline drilldownHref of T1's T10 dashboard and of the T1 workspace header: no T2 id.
import { sql } from "@mth/db";
import { Decimal } from "decimal.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { financialBody, type BenefitWorld } from "../benefits/fixtures.ts";
import { approve, measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import { benefitWorldIn, planValue } from "../contract/p4-exercises-kbe-g.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let b1: BenefitWorld;
let b2: BenefitWorld;
let tl1: Session;
let aud: Session;
let adm: Session;
let out: Session;
let t2Protected: Set<string>;
let orgProtected: Set<string>;
const t2Benefits: string[] = [];
const H1 = { start: "2026-01-01", end: "2026-06-30" };
const METRICS = [
  "value.planned",
  "value.forecast",
  "value.submitted",
  "value.validated",
  "value.measured",
  "value.rejected",
  "value.sustained",
  "value.gap",
];
const CLASSES = [
  undefined,
  "margin_uplift",
  "cash_saving",
  "working_capital_release",
  "revenue_uplift",
  "avoided_cost",
  "non_financial_valued",
];

function classBody(b: BenefitWorld, valueClass: string) {
  const cost = { benefitType: "cost", financialStatementLine: "Opex - care" };
  const shape: Record<string, Record<string, unknown>> = {
    revenue_uplift: { benefitType: "revenue" },
    margin_uplift: { benefitType: "revenue" },
    cash_saving: cost,
    avoided_cost: { ...cost, financialStatementLine: "Opex - network" },
    working_capital_release: { benefitType: "working_capital", financialStatementLine: "Working capital - inventory" },
  };
  return financialBody(b, { valueClass, ...shape[valueClass] });
}
async function benefit(b: BenefitWorld, valueClass: string): Promise<string> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: classBody(b, valueClass) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
/** One transformation with all five classes; amounts x `k`. Returns the benefit ids. */
async function populate(b: BenefitWorld, k: number): Promise<string[]> {
  const m = (x: string) => new Decimal(x).times(k).toFixed();
  const ids: string[] = [];
  const margin = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
  ids.push(margin.id);
  await planValue(api, b, margin.id, m("70"), H1.start, H1.end);
  await approve(api, b, await submittedValue(api, b, margin.id, m("30"), { periodStart: "2026-02-01", periodEnd: "2026-02-28" }), m("30"));
  const cash = await measuredBenefit(api, b, {
    extra: { valueClass: "cash_saving", benefitType: "cost", financialStatementLine: "Opex - care" },
  });
  ids.push(cash.id);
  await planValue(api, b, cash.id, m("20"), H1.start, H1.end);
  await submittedValue(api, b, cash.id, m("5"), { periodStart: "2026-03-01", periodEnd: "2026-03-31" });
  for (const [c, a] of [
    ["working_capital_release", "2.5"],
    ["revenue_uplift", "300"],
    ["avoided_cost", "45"],
  ] as const) {
    const id = await benefit(b, c);
    ids.push(id);
    await planValue(api, b, id, m(a), H1.start, H1.end);
  }
  return ids;
}

async function idsOfRows(where: "t2" | "org"): Promise<Set<string>> {
  const cols = await sql<{ table_name: string }>`
    SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name = 'transformation_id'
       AND EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema='public' AND i.table_name=c.table_name AND i.column_name='id')`.execute(api.db);
  const out = new Set<string>();
  for (const { table_name } of cols.rows) {
    const r =
      where === "t2"
        ? await sql<{ id: string }>`SELECT id::text AS id FROM ${sql.table(table_name)} WHERE transformation_id = ${b2.transformationId}::uuid`.execute(api.db)
        : await sql<{ id: string }>`SELECT x.id::text AS id FROM ${sql.table(table_name)} x JOIN transformation t ON t.id = x.transformation_id WHERE t.organization_id = ${w.orgA.id}::uuid`.execute(api.db);
    for (const x of r.rows) out.add(x.id);
  }
  const tx =
    where === "t2"
      ? await sql<{ id: string; code: string }>`SELECT id::text AS id, code FROM transformation WHERE id = ${b2.transformationId}::uuid`.execute(api.db)
      : await sql<{ id: string; code: string }>`SELECT id::text AS id, code FROM transformation WHERE organization_id = ${w.orgA.id}::uuid`.execute(api.db);
  for (const x of tx.rows) {
    out.add(x.id);
    out.add(x.code);
  }
  return out;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b1 = await benefitWorldIn(api, w, w.a1);
  b2 = await benefitWorldIn(api, w, w.a1);
  await populate(b1, 1);
  t2Benefits.push(...(await populate(b2, 1000)));
  tl1 = b1.s.tl;
  aud = await signIn(api.app, w.auditor.subject);
  adm = await signIn(api.app, w.admin.subject);
  out = await signIn(api.app, w.officeB.subject);
  t2Protected = await idsOfRows("t2");
  orgProtected = await idsOfRows("org");
  console.log(`[probe-DS] T1=${b1.transformationId} T2=${b2.transformationId} t2Protected=${t2Protected.size} orgProtected=${orgProtected.size}`);
}, 600_000);
afterAll(() => api?.close());

const url = (metric: string, vc: string | undefined, tids: string[], extra = "") =>
  `/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${w.orgA.id}${tids.map((t) => `&transformationId=${t}`).join("")}${vc ? `&valueClass=${vc}` : ""}${extra}&limit=100`;
const leak = (body: unknown, prot: Set<string>) => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return [...prot].filter((x) => text.includes(x));
};
const core = (b: Body) => ({ value: b.value, items: b.items, calculation: b.calculation, headlineBasis: b.headlineBasis, evidence: b.evidence });

describe("SEC-DG4-R3 probe DS: value drill-down scope, with and without valueClass", () => {
  it("control: AUD without a filter sees T1 + T2 (the probe detects a leak)", async () => {
    const all = await call<Body>(api.app, "GET", url("value.planned", undefined, []), { session: aud });
    const one = await call<Body>(api.app, "GET", url("value.planned", undefined, [b1.transformationId]), { session: aud });
    console.log(`[probe-DS control] AUD all=${JSON.stringify(all.body.value)} T1=${JSON.stringify(one.body.value)}`);
    expect(all.status).toBe(200);
    expect(new Decimal(all.body.value.value).toFixed()).toBe("92592.5");
    expect(new Decimal(one.body.value.value).toFixed()).toBe("92.5");
    expect(leak(all.body, t2Protected).length).toBeGreaterThan(0);
  });

  const cases = METRICS.flatMap((m) => CLASSES.map((c) => [m, c ?? "-"] as const));
  it.each(cases)("TL1 %s valueClass=%s: T1 only, T2 refused, nothing of T2 disclosed", async (metric, c) => {
    const vc = c === "-" ? undefined : c;
    const ref = await call<Body>(api.app, "GET", url(metric, vc, [b1.transformationId]), { session: aud });
    for (const [label, tids] of [
      ["none", []],
      ["T1", [b1.transformationId]],
      ["T2", [b2.transformationId]],
      ["T1+T2", [b1.transformationId, b2.transformationId]],
    ] as const) {
      const r = await call<Body>(api.app, "GET", url(metric, vc, [...tids]), { session: tl1, contract: false });
      const l = leak(r.body, t2Protected);
      console.log(`[probe-DS TL1] ${metric} vc=${c} filter=${label} -> ${r.status} ${r.body?.code ?? ""} value=${JSON.stringify(r.body?.value ?? null)} basis=${r.body?.headlineBasis ?? "-"} items=${r.body?.items?.length ?? "-"} leaked=${l.length}`);
      expect(l, `${metric} ${c} ${label}`).toEqual([]);
      if (label === "T2" || label === "T1+T2") expect(r.status, `${metric} ${c} ${label}`).toBe(404);
      else {
        expect(r.status, `${metric} ${c} ${label}`).toBe(ref.status);
        if (r.status === 200) expect(core(r.body)).toEqual(core(ref.body));
      }
    }
  });

  const subjectCases = METRICS.filter((m) => m !== "value.gap").flatMap((m) => CLASSES.map((c) => [m, c ?? "-"] as const));
  it.each(subjectCases)("TL1 %s valueClass=%s subjectId=<T2 benefit>: refused, nothing disclosed", async (metric, c) => {
    const vc = c === "-" ? undefined : c;
    for (const sid of t2Benefits) {
      const r = await call<Body>(api.app, "GET", url(metric, vc, [], `&subjectId=${sid}`), { session: tl1, contract: false });
      const l = leak(r.body, t2Protected);
      console.log(`[probe-DS SUBJ] ${metric} vc=${c} subject=${sid} -> ${r.status} ${r.body?.code ?? ""} leaked=${l.length}`);
      expect(r.status, `${metric} ${c}`).not.toBe(200);
      expect(r.status).toBeLessThan(500);
      expect(l).toEqual([]);
    }
  });

  it.each(cases)("ADM-only and OUT %s valueClass=%s: nothing of org A disclosed", async (metric, c) => {
    const vc = c === "-" ? undefined : c;
    for (const [who, s] of [["ADM", adm], ["OUT", out]] as const) {
      for (const tids of [[], [b1.transformationId]]) {
        const r = await call<Body>(api.app, "GET", url(metric, vc, tids), { session: s, contract: false });
        const l = leak(r.body, orgProtected);
        console.log(`[probe-DS ${who}] ${metric} vc=${c} filter=${tids.length ? "T1" : "none"} -> ${r.status} ${r.body?.code ?? ""} leaked=${l.length}`);
        expect(r.status).toBeGreaterThanOrEqual(400);
        expect(r.status).toBeLessThan(500);
        expect(l).toEqual([]);
      }
    }
  });

  it("TL1 follows every value headline href of the T1 dashboard and header: nothing of T2", async () => {
    const dash = await call<Body>(api.app, "GET", `${b1.base}/dashboard`, { session: tl1 });
    const head = await call<Body>(api.app, "GET", `${b1.base}/summary`, { session: tl1 });
    expect(dash.status).toBe(200);
    expect(head.status).toBe(200);
    expect(leak(dash.body, t2Protected)).toEqual([]);
    expect(leak(head.body, t2Protected)).toEqual([]);
    const hrefs = new Set<string>();
    for (const a of dash.body.areas) for (const h of a.headlines) if (String(h.metric).startsWith("value.")) hrefs.add(h.drilldownHref);
    for (const h of head.body.benefits.headlines) hrefs.add(h.drilldownHref);
    let n = 0;
    for (const href of hrefs) {
      const r = await call<Body>(api.app, "GET", href, { session: tl1 });
      const l = leak(r.body, t2Protected);
      console.log(`[probe-DS HREF] ${href} -> ${r.status} value=${JSON.stringify(r.body?.value)} basis=${r.body?.headlineBasis} leaked=${l.length}`);
      expect(r.status).toBe(200);
      expect(l).toEqual([]);
      n += 1;
    }
    expect(n).toBeGreaterThanOrEqual(10);
  });
});
