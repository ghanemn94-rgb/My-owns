// code-security-reviewer DG4 round-2 probe E (T-DG4-REV-SEC-R2): KBE-R5 made requirePermissionSomewhere (register.ts)
// read the path's transformation (resolveTarget) BEFORE any other gate, to attach the denial. This probe checks that the
// added read discloses nothing and fails closed, for createBenefit (slice B) and decideFinanceValidation:
//   E1 malformed transformation id (AUD): 400 validation, no 500, no audit row
//   E2 well-formed unknown transformation id (AUD): 403 forbidden, NO denial row (a missing record is not an authz event)
//   E3 existing transformation (AUD, org A): 403 forbidden, exactly one denial
//   E4 outsider (TO of org B) on org A's transformation: 403 forbidden (identical body to E2), one denial attributed to the outsider
//   E5 the 403 bodies of E2, E3 and E4 are identical except for instance/request ids: existence is not disclosed
// NOT product code; disposable clone only (apps/api/test/integration/zz-sec-dg4/). All data is synthetic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest, call, createUser, grant, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { measuredBenefit, submittedValue, type Body } from "../benefits/value-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
}, 120_000);
afterAll(() => api.close(), 60_000);

const strip = (body: Body) => {
  const { instance: _i, requestId: _r, traceId: _t, ...rest } = body ?? {};
  return JSON.stringify(rest);
};
const rowsOf = async (res: { headers: Record<string, unknown> }) =>
  (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => [e.action, e.actor_user_id, e.organization_id, e.transformation_id]);

describe("SEC-DG4-R2 probe E: the slice B denial lookup discloses nothing and fails closed", () => {
  it("E1-E5 createBenefit and decideFinanceValidation", async () => {
    const u = await createUser(api.db, w.orgB.id);
    await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgB.id }, w.orgB.id);
    const outsider = await signIn(api.app, u.subject);
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "10", { periodStart: "2032-01-01", periodEnd: "2032-01-31" });
    const unknown = "01a00000-0000-7000-8000-000000000000";
    const cases: [string, string, string, unknown, Record<string, string>?][] = [
      ["E1 createBenefit malformed (AUD)", "POST", "/api/v1/transformations/not-a-uuid/benefits", b.s.auditor],
      ["E2 createBenefit unknown (AUD)", "POST", `/api/v1/transformations/${unknown}/benefits`, b.s.auditor],
      ["E3 createBenefit existing (AUD)", "POST", `${b.base}/benefits`, b.s.auditor],
      ["E4 createBenefit existing (outsider)", "POST", `${b.base}/benefits`, outsider],
      ["E1 decideFV malformed (AUD)", "POST", `/api/v1/transformations/not-a-uuid/finance-validations/${v.validationId}/decision`, b.s.auditor, ifm(1)],
      ["E2 decideFV unknown (AUD)", "POST", `/api/v1/transformations/${unknown}/finance-validations/${v.validationId}/decision`, b.s.auditor, ifm(1)],
      ["E3 decideFV existing (AUD)", "POST", `${b.base}/finance-validations/${v.validationId}/decision`, b.s.auditor, ifm(1)],
      ["E4 decideFV existing (outsider)", "POST", `${b.base}/finance-validations/${v.validationId}/decision`, outsider, ifm(1)],
    ];
    const out: Record<string, { status: number; code: string; body: string; rows: unknown[][] }> = {};
    for (const [label, m, url, session, headers] of cases) {
      const res = await call<Body>(api.app, m, url, { session: session as never, headers, body: {}, contract: false });
      const rows = await rowsOf(res);
      out[label] = { status: res.status, code: res.body?.code, body: strip(res.body), rows };
      console.log(`[probe-E] ${label} -> ${res.status} ${res.body?.code}; audit ${JSON.stringify(rows)}`);
    }
    for (const op of ["createBenefit", "decideFV"]) {
      const e1 = out[`E1 ${op} malformed (AUD)`]!, e2 = out[`E2 ${op} unknown (AUD)`]!, e3 = out[`E3 ${op} existing (AUD)`]!, e4 = out[`E4 ${op} existing (outsider)`]!;
      expect([e1.status, e1.rows]).toEqual([e1.status < 500 ? e1.status : -1, []]);
      expect(e1.status).toBeLessThan(500);
      expect([e2.status, e2.code, e2.rows]).toEqual([403, "forbidden", []]);
      expect([e3.status, e3.code, e3.rows.map((r) => r[0])]).toEqual([403, "forbidden", ["authorization.denied"]]);
      expect([e4.status, e4.code, e4.rows.map((r) => [r[0], r[1]])]).toEqual([403, "forbidden", [["authorization.denied", u.id]]]);
      expect(new Set([e2.body, e3.body, e4.body]).size, `${op} 403 bodies identical`).toBe(1);
    }
  });
});
