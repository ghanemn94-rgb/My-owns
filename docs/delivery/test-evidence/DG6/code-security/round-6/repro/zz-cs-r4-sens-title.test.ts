// code-security-reviewer, DG6 round 4 (T-DG6-REV-CS-R4): reproduction for REQ-S10-002 "a sensitive benefit is hidden
// from a workstream member without the grant" (ADR-0051 §2). Run ONLY in a disposable clone (copied into
// tests/qa/integration by checks.sh repro and removed afterwards). Every value is SYNTHETIC. Marking a record sensitive
// is an access decision, never a business approval (G1-G6); nothing here touches DG0-DG7.
//
// Setup (the product fixtures of sensitive-reach-registers.test.ts): a benefit is created by BO on a launched
// initiative and marked sensitive by the TO. TL, AUD and BO2 (no grant, not a named party) get 404 on it. Then every
// transformation-level read below is made as each of them, and the response body is searched for the benefit's
// unique title and its id. Expected: the title appears in none of them (the benefit is hidden). The probe records what
// each route returns, and asserts the hidden-benefit expectation per route so that each failing route is reported.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type Res, type Session, type TestApi, type World } from "../../../apps/api/test/support/harness.ts";
import { ifm } from "../../../apps/api/test/support/p2-fixtures.ts";
import {
  launchedInitiative,
  pendingBenefit,
  seedClosureWorld,
  type ClosureWorld,
} from "../../../apps/api/test/integration/contract/p4-exercises-be-j.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let c: ClosureWorld;
const S = { benefitId: "", code: "", title: "", plainId: "", plainTitle: "" };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Body;
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  const ini = await launchedInitiative(api.db, c.b);
  const sb = await pendingBenefit(api, c, ini);
  const pb = await pendingBenefit(api, c, ini);
  S.benefitId = sb.id;
  S.code = sb.code;
  S.plainId = pb.id;
  // Give the sensitive benefit a unique title through the product route (BO, If-Match).
  const cur = ok(await send("GET", `${c.b.base}/benefits/${sb.id}`, { session: c.b.s.bo }));
  S.title = "Synthetic CONFIDENTIAL CS-R4 tariff uplift";
  ok(
    await send("PATCH", `${c.b.base}/benefits/${sb.id}`, {
      session: c.b.s.bo,
      headers: ifm(cur.version),
      body: { title: S.title },
    }),
  );
  S.plainTitle = ok(await send("GET", `${c.b.base}/benefits/${pb.id}`, { session: c.b.s.bo })).title;
  ok(
    await send("PUT", `${c.b.base}/records/benefit/${sb.id}/sensitivity`, {
      session: c.s.to.session,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit" },
    }),
  );
}, 240_000);
afterAll(() => api?.close());

const routes = () => [
  ["getTraceability", `${c.b.base}/traceability`],
  ["missing-links", `${c.b.base}/missing-links`],
  ["gate G6 (live readiness)", `${c.b.base}/gates/G6`],
  ["gates (all six)", `${c.b.base}/gates`],
  ["benefit-groups", `${c.b.base}/benefit-groups`],
  ["benefits list (control)", `${c.b.base}/benefits?limit=100`],
];

describe("REQ-S10-002: a sensitive benefit's title on transformation-level reads (CS-R4)", () => {
  it("control: TL, AUD and BO2 get 404 on the benefit; the TO and BO read it", async () => {
    for (const s of [c.b.s.tl, c.b.s.auditor, c.b.s.bo2])
      expect((await send("GET", `${c.b.base}/benefits/${S.benefitId}`, { session: s })).status).toBe(404);
    for (const s of [c.s.to.session, c.b.s.bo])
      expect((await send("GET", `${c.b.base}/benefits/${S.benefitId}`, { session: s })).status).toBe(200);
  });

  for (const who of ["TL", "AUD", "BO2"] as const) {
    it(`${who}: no transformation-level read discloses the sensitive benefit's title`, async () => {
      const s: Session = who === "TL" ? c.b.s.tl : who === "AUD" ? c.b.s.auditor : c.b.s.bo2;
      const seen: Record<string, { status: number; title: boolean; id: boolean; code: boolean; plainTitle: boolean }> =
        {};
      for (const [name, url] of routes()) {
        const r = await send("GET", url, { session: s });
        const text = JSON.stringify(r.body);
        seen[name] = {
          status: r.status,
          title: text.includes(S.title),
          id: text.includes(S.benefitId),
          code: text.includes(`${S.code} `) || text.includes(`"${S.code}"`),
          plainTitle: text.includes(S.plainTitle),
        };
        if (text.includes(S.title)) {
          const i = text.indexOf(S.title);
          console.log(`[CS-R4] ${who} ${name} ${r.status}: ...${text.slice(Math.max(0, i - 300), i + 200)}...`);
        }
      }
      console.log(`[CS-R4] ${who} ${JSON.stringify(seen)}`);
      const leaking = Object.entries(seen)
        .filter(([, v]) => v.title)
        .map(([k]) => k);
      expect(leaking, `${who}: routes whose body holds the sensitive benefit's title`).toEqual([]);
    });
  }
});
