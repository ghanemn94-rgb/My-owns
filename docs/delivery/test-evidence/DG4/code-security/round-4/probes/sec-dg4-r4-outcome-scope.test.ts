// code-security-reviewer DG4 ROUND-4 probe OS (T-DG4-REV-SEC-R4): after KBE-R8 (kpi/dashboard-facts.ts loadOutcomeRows
// reads non-archived outcomes, D-124 item 1), no outcome outside the caller's scope is exposed. World: T1 and T2 (org A),
// each with a draft outcome and an outcome KPI created THROUGH THE API by that transformation's TL, plus one archived
// outcome in T1. Callers: TL1 (T1 only), AUD, ADM-only, OUT. Reads: T10 dashboard of T1 and T2, overview (no filter,
// T1, T2), outcomes.area / outcomes.kpi_status drill-downs (no filter, T1, T2; subjectId = the T2 outcome KPI), My Work.
// NOT product code; disposable clone only. All data synthetic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import type { BenefitWorld } from "../benefits/fixtures.ts";
import { areaOf, benefitWorldIn } from "../contract/p4-exercises-kbe-g.ts";

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
const ids: Record<string, string> = {};
async function outcome(b: BenefitWorld, statement: string) {
  const r = await call<Body>(api.app, "POST", `${b.base}/outcomes`, { session: b.s.tl, body: { statement, ownerUserId: b.users.tl.id } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const k = await call<Body>(api.app, "POST", `${b.base}/outcome-kpis`, { session: b.s.tl, body: { outcomeId: r.body.id, kpiDefinitionId: b.kpiDefinitionId, targetDate: "2026-12-31" } });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  return { id: r.body.id as string, version: r.body.version as number, status: r.body.status as string, kpi: k.body.id as string };
}
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b1 = await benefitWorldIn(api, w, w.a1);
  b2 = await benefitWorldIn(api, w, w.a1);
  const o1 = await outcome(b1, "Synthetic T1 outcome SEC-R4-ALPHA");
  const o2 = await outcome(b2, "Synthetic T2 outcome SEC-R4-BRAVO");
  const o3 = await outcome(b1, "Synthetic T1 archived SEC-R4-CHARLIE");
  // archive o3 through the API
  const cur = await call<Body>(api.app, "GET", `${b1.base}/outcomes/${o3.id}`, { session: b1.s.tl });
  const arch = await call<Body>(api.app, "POST", `${b1.base}/outcomes/${o3.id}/archive`, { session: b1.s.tl, headers: ifm(cur.body.version), body: { reason: "Synthetic probe archive" } });
  expect(arch.status, JSON.stringify(arch.body)).toBe(200);
  console.log(`[probe-OS] statuses o1=${o1.status} o2=${o2.status} archive o3 -> ${arch.status} ${arch.body?.status ?? arch.body?.code ?? ""}`);
  Object.assign(ids, { o1: o1.id, k1: o1.kpi, o2: o2.id, k2: o2.kpi, o3: o3.id, k3: o3.kpi, archived: String(arch.status) });
  tl1 = b1.s.tl;
  aud = await signIn(api.app, w.auditor.subject);
  adm = await signIn(api.app, w.admin.subject);
  out = await signIn(api.app, w.officeB.subject);
}, 600_000);
afterAll(() => api?.close());

const T2 = () => [ids.o2!, ids.k2!, b2.transformationId, "SEC-R4-BRAVO"];
const has = (body: unknown, needles: string[]) => needles.filter((n) => JSON.stringify(body ?? null).includes(n));
const drill = (metric: string, tids: string[], extra = "") =>
  `/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${w.orgA.id}${tids.map((t) => `&transformationId=${t}`).join("")}${extra}&limit=100`;
const ov = (tids: string[]) => `/api/v1/overview?organizationId=${w.orgA.id}${tids.map((t) => `&transformationId=${t}`).join("")}`;

describe("SEC-DG4-R4 probe OS: non-archived outcomes stay in scope", () => {
  it("control: AUD sees the T1 and T2 draft outcomes (the probe detects a leak); the archived one is hidden", async () => {
    const d1 = (await call<Body>(api.app, "GET", `${b1.base}/dashboard`, { session: aud })).body;
    const d2 = (await call<Body>(api.app, "GET", `${b2.base}/dashboard`, { session: aud })).body;
    const all = (await call<Body>(api.app, "GET", drill("outcomes.area", []), { session: aud })).body;
    console.log(`[probe-OS control] T1 outcomes items=${JSON.stringify(areaOf(d1, "outcomes").items.map((i: Body) => i.recordId))} T2 items=${areaOf(d2, "outcomes").items.length} drill(all) items=${all.items.length} ids=${JSON.stringify(ids)}`);
    expect(has(d1, [ids.o1!, ids.k1!]).length).toBeGreaterThan(0);
    expect(has(d2, T2()).length).toBeGreaterThan(0);
    expect(has(all, [ids.k2!, ids.o2!]).length).toBeGreaterThan(0);
    if (ids.archived === "200") expect(has([d1, all], [ids.o3!, ids.k3!, "SEC-R4-CHARLIE"])).toEqual([]);
  });
  it("TL1: T1 dashboard, overview, outcome drill-downs and My Work disclose nothing of T2; T2 reads are 404", async () => {
    const reads: [string, string, number | null][] = [
      ["T1 dashboard", `${b1.base}/dashboard`, 200],
      ["T2 dashboard", `${b2.base}/dashboard`, 404],
      ["overview none", ov([]), 200],
      ["overview T1", ov([b1.transformationId]), 200],
      ["overview T2", ov([b2.transformationId]), 404],
      ["overview T1+T2", ov([b1.transformationId, b2.transformationId]), 404],
      ["my work", "/api/v1/me/work", 200],
      ["T1 summary", `${b1.base}/summary`, 200],
    ];
    for (const m of ["outcomes.area", "outcomes.kpi_status"]) {
      if (m === "outcomes.area") {
        reads.push([`${m} none`, drill(m, []), 200], [`${m} T1`, drill(m, [b1.transformationId]), 200]);
      }
      reads.push([`${m} T2`, drill(m, [b2.transformationId], m === "outcomes.kpi_status" ? `&subjectId=${ids.k1}` : ""), 404]);
      reads.push([`${m} subject=T2 kpi`, drill(m, [], `&subjectId=${ids.k2}`), null]);
      reads.push([`${m} subject=T2 outcome`, drill(m, [], `&subjectId=${ids.o2}`), null]);
    }
    const bad: string[] = [];
    for (const [name, u, want] of reads) {
      const r = await call<Body>(api.app, "GET", u, { session: tl1, contract: false });
      const l = has(r.body, T2());
      console.log(`[probe-OS TL1] ${name} -> ${r.status} ${r.body?.code ?? ""} leaked=${JSON.stringify(l)}`);
      if (l.length) bad.push(`${name} leaked ${l}`);
      if (want !== null && r.status !== want) bad.push(`${name} status ${r.status} != ${want}`);
      if (want === null && (r.status === 200 || r.status >= 500)) bad.push(`${name} status ${r.status}`);
    }
    expect(bad).toEqual([]);
  });
  it("ADM-only and OUT: nothing of either transformation's outcomes", async () => {
    const needles = [ids.o1!, ids.k1!, "SEC-R4-ALPHA", ...T2()];
    const bad: string[] = [];
    for (const [who, s] of [["ADM", adm], ["OUT", out]] as const) {
      for (const u of [`${b1.base}/dashboard`, `${b2.base}/dashboard`, ov([]), ov([b1.transformationId]), drill("outcomes.area", []), drill("outcomes.kpi_status", [], `&subjectId=${ids.k1}`), "/api/v1/me/work"]) {
        const r = await call<Body>(api.app, "GET", u, { session: s, contract: false });
        const l = has(r.body, needles);
        console.log(`[probe-OS ${who}] ${u.replace(/[0-9a-f-]{36}/g, "<id>")} -> ${r.status} ${r.body?.code ?? ""} leaked=${l.length}`);
        if (l.length || r.status >= 500) bad.push(`${who} ${u} ${r.status} ${l}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
