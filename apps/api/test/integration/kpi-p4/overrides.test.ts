// Manual RAG overrides against a real PostgreSQL (T-DG4-KBE-C; ADR-0027 §10, §13; ADR-0028 §6; REQ-S07-009):
//  - "an override without evidence or expiry is rejected (422); an unauthorized user gets 403; after expiry the
//    calculated RAG is displayed again" - the 422s each with its own code and text, nothing written; AUD, ADM-only and
//    KDS (no rag.override) get 403; inForce turns false at expiry with no job, and getKpiStatus then displays the
//    calculated RAG (status.test.ts covers the panel);
//  - the calculated RAG is preserved on the override; one in force per slot (409); revoke with If-Match and a reason.
// All data is synthetic; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import { DIRECT_FLOW, evidenceItem, ifMatch, monthlyPeriod, ownedKpi, type Body } from "./kbe-c-fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let adm: Session;
let period: { id: string; label: string };
let evidenceId: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  adm = await signIn(api.app, w.admin.subject);
  period = await monthlyPeriod(api, w);
  evidenceId = await evidenceItem(api, k);
}, 60_000);
afterAll(() => api.close());

const problem = (res: { status: number; body: Body }, status: number, code: string, detail?: string) => {
  expect([res.status, res.body.code], JSON.stringify(res.body)).toEqual([status, code]);
  if (detail !== undefined) expect(res.body.detail).toBe(detail);
};
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const post = (kpiId: string, body: object, session?: Session) =>
  call<Body>(api.app, "POST", `${k.base}/kpi-definitions/${kpiId}/rag-overrides`, {
    session: session ?? k.s.tl,
    body: {
      scopeKind: "transformation",
      scopeId: k.transformationId,
      reportingPeriodId: period.id,
      overrideRag: "green",
      ...body,
    },
  });
const full = () => ({ reason: "Synthetic: data delayed by the source", evidenceId, expiresAt: inDays(30) });
const overridesOf = (kpiId: string) =>
  api.db.selectFrom("rag_override").select("id").where("kpi_definition_id", "=", kpiId).execute();

describe("RAG overrides (REQ-S07-009)", () => {
  it("refuses a missing reason, evidence or expiry and an invalid expiry with their own 422, nothing written", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    problem(
      await post(kpi.id, { ...full(), reason: null }),
      422,
      "rag_override.reason_required",
      "A RAG override needs a reason.",
    );
    problem(await post(kpi.id, { ...full(), reason: "ab" }), 422, "rag_override.reason_required");
    problem(
      await post(kpi.id, { ...full(), evidenceId: null }),
      422,
      "rag_override.evidence_required",
      "A RAG override needs evidence.",
    );
    const { evidenceId: _e, ...noEvidence } = full();
    problem(await post(kpi.id, noEvidence), 422, "rag_override.evidence_required");
    problem(
      await post(kpi.id, { ...full(), expiresAt: null }),
      422,
      "rag_override.expiry_required",
      "A RAG override needs an expiry date and time.",
    );
    problem(
      await post(kpi.id, { ...full(), expiresAt: inDays(-1) }),
      422,
      "rag_override.expiry_invalid",
      "The expiry must be in the future and at most 366 days away.",
    );
    problem(await post(kpi.id, { ...full(), expiresAt: inDays(367) }), 422, "rag_override.expiry_invalid");
    expect(await overridesOf(kpi.id)).toEqual([]);
  });

  it("an unauthorized user gets 403 (KDS, AUD, ADM-only), nothing written", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    for (const s of [k.s.kds, k.s.auditor, adm]) expect((await post(kpi.id, full(), s)).status).toBe(403);
    expect(await overridesOf(kpi.id)).toEqual([]);
  });

  it("creates one override in force (preserving the calculated RAG), refuses a second, revokes it", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    const created = await post(kpi.id, full());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.headers.location).toBe(`${k.base}/rag-overrides/${created.body.id}`);
    expect(created.body).toMatchObject({
      overrideRag: "green",
      calculatedRag: "unknown",
      kpiEvaluationId: null,
      inForce: true,
      status: "active",
      evidenceId,
      version: 1,
    });
    expect((await auditOf(api.db, created.body.id)).map((e) => e.action)).toEqual(["rag_override.create"]);
    problem(
      await post(kpi.id, { ...full(), overrideRag: "red" }),
      409,
      "rag_override.already_in_force",
      "An override is already in force for this KPI, scope and period. Revoke it first.",
    );
    const R = `${k.base}/rag-overrides/${created.body.id}/revoke`;
    expect((await call(api.app, "POST", R, { session: k.s.tl, body: { reason: "Synthetic" } })).status).toBe(428);
    expect(
      (await call(api.app, "POST", R, { session: k.s.tl, headers: ifMatch(5), body: { reason: "Synthetic" } })).status,
    ).toBe(409);
    expect(
      (await call(api.app, "POST", R, { session: k.s.auditor, headers: ifMatch(1), body: { reason: "Synthetic" } }))
        .status,
    ).toBe(403);
    const revoked = await call<Body>(api.app, "POST", R, {
      session: k.s.bo,
      headers: ifMatch(1),
      body: { reason: "Synthetic: data arrived" },
    });
    expect([revoked.status, revoked.body.status, revoked.body.inForce, revoked.body.revokedBy]).toEqual([
      200,
      "revoked",
      false,
      k.users.bo.id,
    ]);
    problem(
      await call<Body>(api.app, "POST", R, { session: k.s.tl, headers: ifMatch(2), body: { reason: "Again" } }),
      422,
      "rag_override.not_active",
      "Only an override in force can be revoked.",
    );
    // After a revoke a new override is allowed.
    expect((await post(kpi.id, full())).status).toBe(201);
    const list = await call<Body>(api.app, "GET", `${k.base}/kpi-definitions/${kpi.id}/rag-overrides`, {
      session: k.s.auditor,
    });
    expect(list.body.items.map((o: Body) => o.inForce)).toEqual([true, false]);
  });

  it("is no longer in force after its expiry, with no job (the read compares the expiry with the current time)", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    const created = await post(kpi.id, { ...full(), expiresAt: new Date(Date.now() + 1500).toISOString() });
    expect([created.status, created.body.inForce]).toEqual([201, true]);
    await new Promise((r) => setTimeout(r, 1700));
    const list = await call<Body>(api.app, "GET", `${k.base}/kpi-definitions/${kpi.id}/rag-overrides`, {
      session: k.s.auditor,
    });
    expect(list.body.items[0]).toMatchObject({ id: created.body.id, status: "active", inForce: false });
    // A new override is allowed after expiry (probe O08).
    expect((await post(kpi.id, full())).status).toBe(201);
  });
});
