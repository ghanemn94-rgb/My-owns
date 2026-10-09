// The dashboard RAG policy against a real PostgreSQL (T-DG4-KBE-G; ADR-0037 §3, §10, §13; REQ-PB-063 "configurable
// thresholds"; S-4):
//  - no row: version 0, every threshold null and the labelled defaults effective (policySource default; D-106 (a));
//  - a configured threshold changes the area's RAG and its policySource;
//  - the write: AUD (and any caller without dashboard.configure) 403 and nothing written; If-Match missing 428, stale
//    409; "0" creates; one audit event per change; amber beyond red 422 with the exact text; out-of-range 400;
//    commit-time re-authorization (a revoked grant is refused).
// All data is synthetic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import type { KpiWorld } from "../kpi/fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { areaOf, askDue, dashboardWorld, riyadhToday, type Body } from "../contract/p4-exercises-kbe-g.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let office: Session;
let P: string;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await dashboardWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  P = `/api/v1/organizations/${w.orgA.id}/dashboard-rag-policy`;
}, 120_000);
afterAll(() => api.close());

const put = (body: object, headers: Record<string, string> = ifm(0), session: Session = office) =>
  call<Body>(api.app, "PUT", P, { session, headers, body });

describe("the dashboard RAG policy (ADR-0037 §3, §10)", () => {
  it("without a row: version 0, null thresholds, the documented defaults effective, policySource default", async () => {
    // ETag "0" is admitted by the ETagOrZero header (ARCH-R1), so this read is contract-checked.
    const res = await call<Body>(api.app, "GET", P, { session: k.s.auditor });
    expect([res.status, res.headers.etag]).toEqual([200, '"0"']);
    expect(res.body).toMatchObject({
      organizationId: w.orgA.id,
      policySource: "default",
      valueGapAmberRatio: null,
      topInitiativeCount: null,
      version: 0,
      updatedAt: null,
      updatedBy: null,
      effective: {
        valueGapAmberRatio: "0.05",
        valueGapRedRatio: "0.15",
        milestoneSlipAmberWorkingDays: 1,
        milestoneSlipRedWorkingDays: 10,
        dependencyDueSoonWorkingDays: 10,
        decisionDueSoonWorkingDays: 3,
        topInitiativeCount: 10,
        deadlineHorizonWorkingDays: 10,
      },
    });
    expect(
      (await call(api.app, "GET", `/api/v1/organizations/${w.orgB.id}/dashboard-rag-policy`, { session: office }))
        .status,
    ).toBe(404);
  });

  it("AUD is 403 (reads only), a transformation-scoped TL 404 (no organization read), nothing written; 428; 409", async () => {
    const aud = await put({ topInitiativeCount: 3 }, ifm(0), k.s.auditor);
    expect(aud.status, JSON.stringify(aud.body)).toBe(403);
    expect((await put({ topInitiativeCount: 3 }, ifm(0), k.s.tl)).status).toBe(404);
    expect(
      await api.db.selectFrom("dashboard_rag_policy").select("id").where("organization_id", "=", w.orgA.id).execute(),
    ).toEqual([]);
    expect((await put({ topInitiativeCount: 3 }, {})).status).toBe(428);
    expect((await put({ topInitiativeCount: 3 }, ifm(4))).status).toBe(409);
  });

  it("a configured threshold changes the area's RAG and policySource; one audit event per change", async () => {
    const { today } = await riyadhToday(api);
    const plus = (d: string, n: number) =>
      new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    // An ask due in about two weeks: green with the default 3 working days, amber when the organization configures 20.
    await askDue(api, k, plus(today, 15));
    const before = await call<Body>(api.app, "GET", `${k.base}/dashboard`, { session: k.s.auditor });
    expect(areaOf(before.body, "decisions").rag).toMatchObject({ status: "green", policySource: "default" });

    const created = await put({ decisionDueSoonWorkingDays: 20, note: "Synthetic: longer executive horizon" });
    expect([created.status, created.headers.etag, created.body.version], JSON.stringify(created.body)).toEqual([
      200,
      '"1"',
      1,
    ]);
    expect(created.body).toMatchObject({
      policySource: "configured",
      decisionDueSoonWorkingDays: 20,
      valueGapAmberRatio: null,
      effective: { decisionDueSoonWorkingDays: 20, valueGapAmberRatio: "0.05" },
      updatedBy: w.office.id,
    });
    const after = await call<Body>(api.app, "GET", `${k.base}/dashboard`, { session: k.s.auditor });
    expect(areaOf(after.body, "decisions").rag).toMatchObject({
      status: "amber",
      policySource: "configured",
      ruleParams: { dueSoonWorkingDays: 20 },
    });
    // Every area names the policy source.
    expect((after.body.areas as Body[]).every((a) => a.rag.policySource === "configured")).toBe(true);

    const updated = await put({ valueGapAmberRatio: "0.1", valueGapRedRatio: "0.2" }, ifm(1));
    expect([
      updated.status,
      updated.body.version,
      updated.body.valueGapAmberRatio,
      updated.body.decisionDueSoonWorkingDays,
    ]).toEqual([
      200,
      2,
      "0.1",
      20, // a member left out keeps its value
    ]);
    const row = await api.db
      .selectFrom("dashboard_rag_policy")
      .select("id")
      .where("organization_id", "=", w.orgA.id)
      .executeTakeFirstOrThrow();
    const audit = await auditOf(api.db, row.id);
    expect(audit.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["dashboard_rag_policy.create", null, 1],
      ["dashboard_rag_policy.update", 1, 2],
    ]);
    // null resets one threshold to its default.
    const reset = await put({ decisionDueSoonWorkingDays: null }, ifm(2));
    expect([reset.body.decisionDueSoonWorkingDays, reset.body.effective.decisionDueSoonWorkingDays]).toEqual([null, 3]);
  });

  it("amber beyond red is 422 at the amber field with the exact text; out-of-range values are 400; nothing written", async () => {
    const current = await call<Body>(api.app, "GET", P, { session: office });
    const v = current.body.version as number;
    const order = await put({ valueGapAmberRatio: "0.3" }, ifm(v)); // red stays 0.2
    expect([order.status, order.body.code, order.body.detail, order.body.errors[0].pointer]).toEqual([
      422,
      "dashboard_rag_policy.threshold_order",
      "The amber threshold cannot be beyond the red threshold.",
      "/valueGapAmberRatio",
    ]);
    const slip = await put({ milestoneSlipAmberWorkingDays: 11 }, ifm(v)); // default red 10
    expect([slip.status, slip.body.errors[0].pointer]).toEqual([422, "/milestoneSlipAmberWorkingDays"]);
    for (const body of [
      { valueGapRedRatio: "1.5" },
      { valueGapRedRatio: "0.1234567" },
      { topInitiativeCount: 0 },
      { dependencyDueSoonWorkingDays: 251 },
      { deadlineHorizonWorkingDays: 0 },
      { unknownField: 1 },
    ])
      expect((await put(body, ifm(v))).status, JSON.stringify(body)).toBe(400);
    const again = await call<Body>(api.app, "GET", P, { session: office });
    expect(again.body.version).toBe(v);
  });

  it("re-authorizes at commit time: a grant revoked while the request runs is refused and nothing is written", async () => {
    const kds = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, kds.id, "KDS", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const session = await signIn(api.app, kds.subject);
    const current = await call<Body>(api.app, "GET", P, { session: office });
    const v = current.body.version as number;
    const res = await afterIdentity(
      api,
      kds.id,
      () => call(api.app, "PUT", P, { session, headers: ifm(v), body: { topInitiativeCount: 7 }, contract: false }),
      () => revokeAll(api, w.grantor.id, kds.id),
    );
    expect(res.status).toBe(403);
    const after = await call<Body>(api.app, "GET", P, { session: office });
    expect([after.body.version, after.body.topInitiativeCount]).toEqual([v, current.body.topInitiativeCount]);
  });
});
