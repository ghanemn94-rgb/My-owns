// Round-2 copy (T-DG4-REV-QA-R2B) of the round-1 probe, re-run unchanged on candidate 3f51b79d.
// qa-verifier DG4 round 1 (T-DG4-REV-QA-R1): independent probe of REQ-S13-001's "no tile, TOTAL or drill-down contains
// a transformation Y record or FIGURE". The candidate's tests look for Y ids, codes and distinctive Y numbers in the
// responses; a Y amount folded into an X total would not appear as its own number. This probe therefore compares
// figures: what a user granted at transformation X only sees on the organization-level dashboards must equal, figure for
// figure, what the organization-wide auditor sees with the dashboard filter transformationId=X. A leaked Y figure makes
// the two differ. Sanity: the auditor's unfiltered view differs from the X-filtered one (Y holds non-zero figures), so
// the probe can fail. Volatile keys (timestamps, request ids, applied filters, hrefs) are removed before comparing.
// This file lives OUTSIDE the frozen candidate and is copied into a disposable clone only to run.
// All data is SYNTHETIC; every Finance approval is a synthetic in-product approval of test data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  benefitWorldIn,
  validatedBenefit,
  type Body,
} from "../../../apps/api/test/integration/contract/p4-exercises-kbe-g.ts";
import type { BenefitWorld } from "../../../apps/api/test/integration/benefits/fixtures.ts";
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
} from "../../../apps/api/test/support/harness.ts";

let api: TestApi;
let w: World;
let bx: BenefitWorld;
let by: BenefitWorld;
let xUser: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  bx = await benefitWorldIn(api, w, w.a1);
  by = await benefitWorldIn(api, w, w.a2);
  await validatedBenefit(api, bx, [{ amount: "1000", start: "2026-02-01", end: "2026-02-28" }], {
    amount: "700",
    start: "2026-02-01",
    end: "2026-02-28",
  });
  await validatedBenefit(api, by, [{ amount: "987654.32", start: "2026-02-01", end: "2026-02-28" }], {
    amount: "55555.5",
    start: "2026-02-01",
    end: "2026-02-28",
  });
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "TL", { type: "transformation", id: bx.transformationId }, w.orgA.id);
  xUser = await signIn(api.app, u.subject);
}, 300_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const VOLATILE = /^(generatedAt|computedAt|asOf|dataAsOf|requestId|appliedFilters|filters|drilldownHref|href|.*Href)$/;
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !VOLATILE.test(k))
        .map(([k, x]) => [k, strip(x)]),
    );
  return v;
}

const get = async (url: string, session: Session) => {
  const r = await call<Body>(api.app, "GET", url, { session });
  expect(r.status, `${url}: ${JSON.stringify(r.body).slice(0, 500)}`).toBe(200);
  return r.body;
};

describe("REQ-S13-001 figures: the X-scoped user's organization dashboards equal the auditor's X-filtered view", () => {
  for (const path of ["/api/v1/overview", "/api/v1/dashboards/finance", "/api/v1/dashboards/adoption"]) {
    it(`${path}: no Y figure in any tile or total`, async () => {
      const org = `organizationId=${w.orgA.id}`;
      const mine = strip(await get(`${path}?${org}`, xUser));
      const auditorX = strip(await get(`${path}?${org}&transformationId=${bx.transformationId}`, bx.s.auditor));
      const auditorAll = strip(await get(`${path}?${org}`, bx.s.auditor));
      console.log(`QA-P3 ${path} mine=${JSON.stringify(mine).slice(0, 1200)}`);
      // Sanity (finance and overview carry the validated amounts): the unfiltered organization view differs.
      if (path !== "/api/v1/dashboards/adoption") expect(JSON.stringify(auditorAll)).not.toBe(JSON.stringify(auditorX));
      expect(mine).toEqual(auditorX);
      // And no Y amount, alone or summed with X's, appears.
      const text = JSON.stringify(mine);
      for (const mark of ["55555.5", "987654.32", "56255.5", "988654.32", by.transformationId])
        expect(text.includes(mark), `${path} contains ${mark}`).toBe(false);
    });
  }
});
