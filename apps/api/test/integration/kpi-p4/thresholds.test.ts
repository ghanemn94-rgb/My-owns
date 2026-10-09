// Versioned RAG thresholds against a real PostgreSQL (T-DG4-KBE-B; ADR-0027 §8 step 5, ADR-0028 §5; REQ-S07-007 threshold
// half: "changing the threshold version recomputes RAG"):
//  - a new version is active at once and supersedes the previous one in the same transaction (one audit event each);
//    exactly one kpi.threshold_changed outbox event per new version (key kpi.threshold_changed:<id>:<versionNo>), which
//    KBE-C's kpi.recalculate consumer turns into one calculation run;
//  - the stored versions, fed to KBE-A's evaluator with an approved trajectory, give a new RAG for the same actual
//    (Red under 0.05/0.10, Amber under 0.10/0.20); the evaluator has no task-completion input (RAG never reads it);
//  - 422 kpi_threshold.order (exact text), negative thresholds and over-scale decimals are refused; nothing written;
//  - AUD, an ADM-only user and roles without kpi_threshold.configure get 403.
// All data is synthetic; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { evaluateRag, expectedToDate } from "@mth/shared/calc";
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
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { createKpi, freshUser, ifMatch } from "./kbe-b-fixtures.ts";

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
const R = (kpiId: string) => `${k.base}/kpi-definitions/${kpiId}/rag-thresholds`;
const post = (kpiId: string, body: object, session = k.s.kds) => call(api.app, "POST", R(kpiId), { session, body });
const rows = (kpiId: string) =>
  api.db
    .selectFrom("kpi_rag_threshold")
    .selectAll()
    .where("kpi_definition_id", "=", kpiId)
    .orderBy("version_no")
    .execute();

describe("REQ-S07-007: threshold versions", () => {
  it("a new version supersedes the previous one; one audit event each and one kpi.threshold_changed event per version", async () => {
    const kpi = await createKpi(api, k);
    const v1 = await post(kpi.id, {
      toleranceMode: "relative",
      amberThreshold: "0.05",
      redThreshold: "0.10",
      reason: "Initial thresholds.",
    });
    expect([v1.status, v1.body.versionNo, v1.body.status, v1.body.amberThreshold, v1.body.redThreshold]).toEqual([
      201,
      1,
      "active",
      "0.05",
      "0.1",
    ]);
    expect(v1.headers.location).toBe(`${R(kpi.id)}/${v1.body.id}`);
    const v2 = await post(
      kpi.id,
      { toleranceMode: "absolute", amberThreshold: "10", redThreshold: "25.5", reason: "Tighter absolute bands." },
      k.s.tl,
    );
    expect([v2.status, v2.body.versionNo, v2.body.status, v2.body.createdBy]).toEqual([
      201,
      2,
      "active",
      k.users.tl.id,
    ]);
    const stored = await rows(kpi.id);
    expect(stored.map((r) => [r.version_no, r.status, r.superseded_at === null])).toEqual([
      [1, "superseded", false],
      [2, "active", true],
    ]);
    expect((await auditOf(api.db, v1.body.id)).map((a) => a.action)).toEqual([
      "kpi_rag_threshold.create",
      "kpi_rag_threshold.supersede",
    ]);
    expect((await auditOf(api.db, v2.body.id)).map((a) => a.action)).toEqual(["kpi_rag_threshold.create"]);
    const events = await api.db
      .selectFrom("outbox_event")
      .select(["event_type", "idempotency_key", "aggregate_id", "payload"])
      .where("event_type", "=", "kpi.threshold_changed")
      .where("aggregate_id", "in", [v1.body.id, v2.body.id])
      .orderBy("created_at")
      .execute();
    expect(events.map((e) => e.idempotency_key)).toEqual([
      `kpi.threshold_changed:${v1.body.id}:1`,
      `kpi.threshold_changed:${v2.body.id}:2`,
    ]);
    expect(events[1]!.payload).toMatchObject({ kpiRagThresholdId: v2.body.id, kpiDefinitionId: kpi.id, versionNo: 2 });
    const list = await call(api.app, "GET", `${R(kpi.id)}?limit=1`, { session: k.s.auditor });
    expect([list.status, list.body.items.map((t: Body) => t.versionNo)]).toEqual([200, [2]]);
    const rest = await call(api.app, "GET", `${R(kpi.id)}?limit=1&cursor=${list.body.nextCursor}`, {
      session: k.s.auditor,
    });
    expect([rest.body.items.map((t: Body) => [t.versionNo, t.status]), rest.body.nextCursor]).toEqual([
      [[1, "superseded"]],
      null,
    ]);
  });

  it("changing the threshold version gives a new RAG for the same actual and approved trajectory (KBE-A evaluator)", async () => {
    const kpi = await createKpi(api, k);
    const tj = await call(api.app, "POST", `${k.base}/kpi-definitions/${kpi.id}/trajectories`, {
      session: k.s.kds,
      body: {
        scopeKind: "transformation",
        scopeId: k.transformationId,
        points: [{ pointDate: "2026-10-31", expectedValue: "100" }],
      },
    });
    const approved = await call(api.app, "POST", `${k.base}/target-trajectories/${tj.body.id}/approve`, {
      session: k.s.sp,
      headers: ifMatch(1),
      body: { comment: "Synthetic SP approval." },
    });
    expect(approved.status).toBe(200);
    const expected = expectedToDate({
      trajectory: {
        id: approved.body.id,
        versionNo: approved.body.versionNo,
        basis: "period",
        interpolation: "linear",
        points: approved.body.points.map((p: Body) => ({ date: p.pointDate, value: p.expectedValue })),
      },
      at: "2026-10-31",
    });
    const rag = (t: Body) =>
      evaluateRag({
        measureType: "higher_is_better",
        actual: { status: "ok", value: "85", reason: null },
        expected: expected.result,
        trajectoryVersion: approved.body.versionNo,
        thresholds: {
          id: t.id,
          versionNo: t.versionNo,
          toleranceMode: t.toleranceMode,
          amberThreshold: t.amberThreshold,
          redThreshold: t.redThreshold,
        },
      });
    const t1 = await post(kpi.id, {
      toleranceMode: "relative",
      amberThreshold: "0.05",
      redThreshold: "0.10",
      reason: "Version 1.",
    });
    const before = rag(t1.body);
    expect([before.calculatedRag, before.adverseDeviation, before.explanationParams.thresholdVersion]).toEqual([
      "red",
      "0.15",
      1,
    ]);
    const t2 = await post(kpi.id, {
      toleranceMode: "relative",
      amberThreshold: "0.10",
      redThreshold: "0.20",
      reason: "Version 2.",
    });
    const after = rag(t2.body);
    expect([after.calculatedRag, after.explanationParams.thresholdVersion]).toEqual(["amber", 2]);
  });
});

describe("refusals", () => {
  it("red below amber is 422 kpi_threshold.order; negative and over-scale values are refused; nothing written", async () => {
    const kpi = await createKpi(api, k);
    const order = await post(kpi.id, {
      toleranceMode: "relative",
      amberThreshold: "0.2",
      redThreshold: "0.1",
      reason: "Wrong order.",
    });
    expect([order.status, order.body.code, order.body.detail]).toEqual([
      422,
      "kpi_threshold.order",
      "The red threshold cannot be below the amber threshold.",
    ]);
    const negative = await post(kpi.id, {
      toleranceMode: "absolute",
      amberThreshold: "-1",
      redThreshold: "2",
      reason: "Negative.",
    });
    expect([negative.status, negative.body.code]).toEqual([422, "validation.constraint"]);
    expect(
      (
        await post(kpi.id, {
          toleranceMode: "relative",
          amberThreshold: "0.0000001",
          redThreshold: "0.1",
          reason: "Scale.",
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(kpi.id, { toleranceMode: "relative", amberThreshold: 0.05, redThreshold: "0.1", reason: "Number." }))
        .status,
    ).toBe(400);
    expect(
      (await post(kpi.id, { toleranceMode: "relative", amberThreshold: "0.05", redThreshold: "0.1", reason: "   " }))
        .status,
    ).toBe(400);
    expect(await rows(kpi.id)).toEqual([]);
  });

  it("AUD, an ADM-only user and roles without kpi_threshold.configure get 403; a read outside the scope is 404", async () => {
    const kpi = await createKpi(api, k);
    const body = { toleranceMode: "relative", amberThreshold: "0.05", redThreshold: "0.1", reason: "No right." };
    for (const session of [k.s.auditor, adm, k.s.sp, k.s.bo, k.s.fin])
      expect((await post(kpi.id, body, session)).status).toBe(403);
    // A write is authorized at commit time (openWrite atCommit, the F-DG2-440 platform rule): no right is 403; a read
    // outside the scope stays 404 (existence not disclosed).
    expect((await post(kpi.id, body, k.s.outsider)).status).toBe(403);
    expect((await call(api.app, "GET", R(kpi.id), { session: k.s.outsider })).status).toBe(404);
    expect((await call(api.app, "GET", R(kpi.id), { session: k.s.auditor })).status).toBe(200);
    expect(await rows(kpi.id)).toEqual([]);
  });

  it("authorization is re-checked at commit time: a grant revoked meanwhile is 403; nothing written", async () => {
    const kpi = await createKpi(api, k);
    const tl = await freshUser(api, k, w.orgA.id, w.grantor.id, "TL");
    const res = await afterIdentity(
      api,
      tl.id,
      () =>
        post(
          kpi.id,
          { toleranceMode: "relative", amberThreshold: "0.05", redThreshold: "0.1", reason: "Revoked meanwhile." },
          tl.session,
        ),
      () => revokeAll(api, w.grantor.id, tl.id),
    );
    expect(res.status).toBe(403);
    expect(await rows(kpi.id)).toEqual([]);
  });
});
