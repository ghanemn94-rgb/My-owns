// code-security-reviewer DG4 ROUND-3 probe RM (T-DG4-REV-SEC-R3): the three ARCH-R5 members are REQUIRED and the
// contract validator (apps/api/test/support/contract.ts, used by every integration `call`) and the shared zod mirror
// reject a response without them. Mutation test: take a VALID live response, delete the member, validate again.
// NOT product code; runs only in a disposable clone. All data synthetic.
import { dashboardDrilldown, dashboardHeadline, workspaceHeader } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchesComponent, openapi } from "../../support/contract.ts";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { benefitWorldIn, planValue } from "../contract/p4-exercises-kbe-g.ts";
import { financialBody, type BenefitWorld } from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let b: BenefitWorld;
let header: Body;
let drill: Body;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await benefitWorldIn(api, w, w.a1);
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, {
    session: b.s.bo,
    body: financialBody(b, { valueClass: "revenue_uplift", benefitType: "revenue" }),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  await planValue(api, b, r.body.id, "10", "2026-01-01", "2026-06-30");
  header = (await call<Body>(api.app, "GET", `${b.base}/summary`, { session: b.s.auditor })).body;
  const href = header.benefits.headlines.find((h: Body) => h.headlineBasis === "top_line").drilldownHref;
  drill = (await call<Body>(api.app, "GET", href, { session: b.s.auditor })).body;
}, 300_000);
afterAll(() => api?.close());

describe("SEC-DG4-R3 probe RM: required members enforced", () => {
  it("openapi required lists contain the three members", () => {
    const s = openapi.components.schemas;
    console.log(`[probe-RM] DashboardHeadline.required=${JSON.stringify(s.DashboardHeadline.required)} DashboardDrilldown.required=${JSON.stringify(s.DashboardDrilldown.required)} WorkspaceHeader.benefits.required=${JSON.stringify(s.WorkspaceHeader.properties.benefits.required)}`);
    expect(s.DashboardHeadline.required).toContain("headlineBasis");
    expect(s.DashboardDrilldown.required).toContain("headlineBasis");
    expect(s.WorkspaceHeader.properties.benefits.required).toContain("headlines");
  });
  it("live responses are valid; each with the member deleted is rejected by ajv and by zod", () => {
    expect(matchesComponent("WorkspaceHeader", header).ok).toBe(true);
    expect(matchesComponent("DashboardDrilldown", drill).ok).toBe(true);
    expect(workspaceHeader.safeParse(header).success).toBe(true);
    expect(dashboardDrilldown.safeParse(drill).success).toBe(true);
    const h0 = structuredClone(header.benefits.headlines[0]);
    delete h0.headlineBasis;
    const d0 = structuredClone(drill);
    delete d0.headlineBasis;
    const w0 = structuredClone(header);
    delete w0.benefits.headlines;
    const res = {
      headline_ajv: matchesComponent("DashboardHeadline", h0),
      drill_ajv: matchesComponent("DashboardDrilldown", d0),
      header_ajv: matchesComponent("WorkspaceHeader", w0),
      headline_zod: dashboardHeadline.safeParse(h0).success,
      drill_zod: dashboardDrilldown.safeParse(d0).success,
      header_zod: workspaceHeader.safeParse(w0).success,
      bad_basis_ajv: matchesComponent("DashboardHeadline", { ...header.benefits.headlines[0], headlineBasis: "everything" }).ok,
    };
    console.log(`[probe-RM] ${JSON.stringify(res)}`);
    expect(res.headline_ajv.ok).toBe(false);
    expect(res.drill_ajv.ok).toBe(false);
    expect(res.header_ajv.ok).toBe(false);
    expect(res.headline_zod).toBe(false);
    expect(res.drill_zod).toBe(false);
    expect(res.header_zod).toBe(false);
    expect(res.bad_basis_ajv).toBe(false);
  });
});
