// kpi resources against a real PostgreSQL (REQ-PB-027 baselines, REQ-PB-028 value pools, REQ-PB-034 T02,
// REQ-S16-013 create+read with authorization; ADR-0019). Every mutation is checked for authorization (positive and
// negative), validation, optimistic concurrency (If-Match / 428 / 409, version + 1) and exactly one audit event.
// Every response is also validated against docs/api/openapi.yaml by the harness. All data is synthetic.
import { totalValuePools, validationState } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadKpiGateFacts } from "../../../src/modules/kpi/index.ts";
import {
  auditOf,
  auditOfRequest,
  call,
  seedWorld,
  startApi,
  type Session,
  type TestApi,
} from "../../support/harness.ts";
import { ifMatch, seedKpiWorld, type KpiWorld } from "./fixtures.ts";

let api: TestApi;
let k: KpiWorld;

beforeAll(async () => {
  api = await startApi();
  const w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
});
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const post = (url: string, session: Session, body: unknown, headers: Record<string, string> = {}) =>
  call<Body>(api.app, "POST", url, { session, body, headers });
const patch = (url: string, session: Session, body: unknown, version?: number) =>
  call<Body>(api.app, "PATCH", url, { session, body, headers: version === undefined ? {} : ifMatch(version) });
const get = (url: string, session: Session) => call<Body>(api.app, "GET", url, { session });

const errorCode = (res: { body: Body }) => res.body?.errors?.[0]?.code ?? res.body?.code;

async function newKpi(session = k.s.kds, body: Record<string, unknown> = {}) {
  const res = await post(`${k.base}/kpi-definitions`, session, {
    name: `Churn rate ${Math.random().toString(36).slice(2, 8)}`,
    unitKind: "percentage",
    polarity: "lower_is_better",
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

// ------------------------------------------------------------------------------------------------ KPI definitions

describe("kpi-definitions", () => {
  it("creates a draft entry with version 1, ETag, Location and exactly one audit event", async () => {
    const res = await post(`${k.base}/kpi-definitions`, k.s.kds, {
      name: "Monthly ARPU",
      unitKind: "currency",
      currency: "SAR",
      polarity: "higher_is_better",
      ownerUserId: k.users.bo.id,
    });
    expect(res.status).toBe(201);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.headers["location"]).toBe(`${k.base}/kpi-definitions/${res.body.id}`);
    expect(res.body).toMatchObject({ status: "draft", version: 1, frequency: "monthly", isLeading: false });
    const audit = await auditOf(api.db, res.body.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "kpi_definition.create",
      record_type: "kpi_definition",
      new_version: 1,
      actor_user_id: k.users.kds.id,
      transformation_id: k.transformationId,
    });
  });

  it("enforces the currency/unit rule (422), the unique name (409) and active owners (422)", async () => {
    const noCurrency = await post(`${k.base}/kpi-definitions`, k.s.kds, {
      name: "Revenue",
      unitKind: "currency",
      polarity: "higher_is_better",
    });
    expect([noCurrency.status, errorCode(noCurrency)]).toEqual([422, "kpi_definition.currency_required"]);
    const a = await newKpi();
    const dup = await post(`${k.base}/kpi-definitions`, k.s.kds, {
      name: a.name.toUpperCase(),
      unitKind: "count",
      polarity: "higher_is_better",
    });
    expect([dup.status, dup.body.code]).toEqual([409, "duplicate.name"]);
    const badOwner = await post(`${k.base}/kpi-definitions`, k.s.kds, {
      name: "Owned by a stranger",
      unitKind: "count",
      polarity: "higher_is_better",
      ownerUserId: k.users.outsider.id,
    });
    expect([badOwner.status, badOwner.body.errors[0]]).toEqual([
      422,
      expect.objectContaining({ pointer: "/ownerUserId", code: "kpi.user_invalid" }),
    ]);
  });

  it("updates with If-Match: 428 without it, 409 when stale, version steps by exactly 1 with a field diff", async () => {
    const d = await newKpi();
    const url = `${k.base}/kpi-definitions/${d.id}`;
    expect((await patch(url, k.s.kds, { unitLabel: "%" })).status).toBe(428);
    const ok = await patch(url, k.s.kds, { unitLabel: "%", isLeading: true }, 1);
    expect(ok.status).toBe(200);
    expect(ok.headers["etag"]).toBe('"2"');
    expect(ok.body).toMatchObject({ version: 2, unitLabel: "%", isLeading: true });
    const stale = await patch(url, k.s.kds, { unitLabel: "pct" }, 1);
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 2]);
    const audit = await auditOf(api.db, d.id);
    expect(audit.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["kpi_definition.create", null, 1],
      ["kpi_definition.update", 1, 2],
    ]);
    expect(audit[1]!.changes).toMatchObject({
      unit_label: { from: null, to: "%" },
      is_leading: { from: false, to: true },
    });
    // Switching to currency needs a currency in the same change (merged-state rule).
    const toCurrency = await patch(url, k.s.kds, { unitKind: "currency" }, 2);
    expect([toCurrency.status, errorCode(toCurrency)]).toEqual([422, "kpi_definition.currency_required"]);
  });

  it("lists newest change first with cursor pagination; archived only with includeArchived", async () => {
    const d1 = await newKpi();
    const d2 = await newKpi();
    const first = await get(`${k.base}/kpi-definitions?limit=1`, k.s.auditor);
    expect(first.status).toBe(200);
    expect(first.body.items[0].id).toBe(d2.id);
    const second = await get(`${k.base}/kpi-definitions?limit=1&cursor=${first.body.nextCursor}`, k.s.auditor);
    expect(second.body.items[0].id).toBe(d1.id);
    const badCursor = await get(
      `${k.base}/kpi-definitions?includeArchived=true&cursor=${first.body.nextCursor}`,
      k.s.auditor,
    );
    expect(badCursor.status).toBe(400);
    const archived = await post(
      `${k.base}/kpi-definitions/${d1.id}/archive`,
      k.s.kds,
      { reason: "Duplicate KPI" },
      ifMatch(1),
    );
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ status: "archived", version: 2, archiveReason: "Duplicate KPI" });
    const active = await get(`${k.base}/kpi-definitions?limit=100`, k.s.tl);
    expect(active.body.items.map((i: Body) => i.id)).not.toContain(d1.id);
    const all = await get(`${k.base}/kpi-definitions?includeArchived=true&limit=100`, k.s.tl);
    expect(all.body.items.map((i: Body) => i.id)).toContain(d1.id);
    const again = await patch(`${k.base}/kpi-definitions/${d1.id}`, k.s.kds, { name: "x" }, 2);
    expect([again.status, again.body.code]).toEqual([422, "kpi_definition.archived"]);
  });

  it("refuses to archive a KPI still used by an active T02 row (422 in_use)", async () => {
    const d = await newKpi();
    const row = await post(`${k.base}/outcome-kpis`, k.s.kds, {
      outcomeId: k.outcomeId,
      kpiDefinitionId: d.id,
      targetDate: "2027-12-31",
    });
    expect(row.status).toBe(201);
    const res = await post(`${k.base}/kpi-definitions/${d.id}/archive`, k.s.kds, { reason: "Retire it" }, ifMatch(1));
    expect([res.status, res.body.code]).toEqual([422, "kpi_definition.in_use"]);
  });

  it("replays an Idempotency-Key with the original response", async () => {
    const key = `kpi-idem-${Date.now()}`;
    const body = { name: `Idempotent ${key}`, unitKind: "count", polarity: "higher_is_better" };
    const a = await post(`${k.base}/kpi-definitions`, k.s.kds, body, { "idempotency-key": key });
    const b = await post(`${k.base}/kpi-definitions`, k.s.kds, body, { "idempotency-key": key });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(await auditOf(api.db, a.body.id)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------ baselines

describe("baselines (REQ-PB-027)", () => {
  it("a missing value is Unknown (null), never 0; decimals round-trip exactly at numeric(24,6)", async () => {
    const unknown = await post(`${k.base}/baselines`, k.s.kds, { metric: "NPS", unit: "points", scope: "customer" });
    expect(unknown.status).toBe(201);
    expect(unknown.body).toMatchObject({
      value: null,
      source: null,
      baselineDate: null,
      validationStatus: "unvalidated",
    });
    const exact = await post(`${k.base}/baselines`, k.s.kds, {
      metric: "Annual revenue",
      unit: "SAR",
      currency: "SAR",
      scope: "revenue",
      value: "123456789012345678.123456",
      source: "Finance ledger FY2025 (synthetic)",
      baselineDate: "2025-12-31",
    });
    expect(exact.status).toBe(201);
    expect(exact.body.value).toBe("123456789012345678.123456");
    expect((await get(`${k.base}/baselines/${exact.body.id}`, k.s.auditor)).body.value).toBe(
      "123456789012345678.123456",
    );
  });

  it("refuses floats, values that do not fit, impossible dates (400) and future baseline dates (422)", async () => {
    const asNumber = await post(`${k.base}/baselines`, k.s.kds, { metric: "m", unit: "u", scope: "cost", value: 0.1 });
    expect(asNumber.status).toBe(400);
    const tooPrecise = await post(`${k.base}/baselines`, k.s.kds, {
      metric: "m",
      unit: "u",
      scope: "cost",
      value: "1.1234567",
    });
    expect(tooPrecise.status).toBe(400);
    const impossible = await post(`${k.base}/baselines`, k.s.kds, {
      metric: "m",
      unit: "u",
      scope: "cost",
      baselineDate: "2026-02-30",
    });
    expect([impossible.status, impossible.body.errors[0].pointer]).toEqual([400, "/baselineDate"]);
    const future = await post(`${k.base}/baselines`, k.s.kds, {
      metric: "m",
      unit: "u",
      scope: "cost",
      baselineDate: "2999-01-01",
    });
    expect([future.status, errorCode(future)]).toEqual([422, "baseline.date_in_future"]);
  });

  it("Finance validates a measurable baseline; the creator, non-FIN roles and unmeasurable baselines are refused", async () => {
    const own = await post(`${k.base}/baselines`, k.s.finKds, {
      metric: "Cost to serve",
      unit: "SAR",
      scope: "cost",
      value: "42.5",
      source: "Cost model v3 (synthetic)",
      baselineDate: "2026-06-30",
    });
    expect(own.status).toBe(201);
    const url = `${k.base}/baselines/${own.body.id}/validation`;
    const decision = { result: "validated", note: "Checked against the cost model." };
    const byCreator = await post(url, k.s.finKds, decision, ifMatch(1));
    expect([byCreator.status, byCreator.body.code]).toEqual([403, "kpi.creator_cannot_validate"]);
    const denied = (await auditOfRequest(api.db, String(byCreator.headers["x-request-id"]))).map((e) => e.action);
    expect(denied).toEqual(["authorization.denied"]);
    const byTl = await post(url, k.s.tl, decision, ifMatch(1));
    expect(byTl.status).toBe(403);
    const ok = await post(url, k.s.fin, decision, ifMatch(1));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      validationStatus: "validated",
      validatedBy: k.users.fin.id,
      validatedRecordVersion: 2,
      version: 2,
      validationNote: decision.note,
    });
    expect(validationState(ok.body)).toBe("validated");
    const audit = await auditOf(api.db, own.body.id);
    expect(audit.at(-1)).toMatchObject({
      action: "baseline.validate",
      prior_version: 1,
      new_version: 2,
      reason: decision.note,
    });

    const unmeasurable = await post(`${k.base}/baselines`, k.s.kds, {
      metric: "Unknown yet",
      unit: "u",
      scope: "operational",
    });
    const refused = await post(`${k.base}/baselines/${unmeasurable.body.id}/validation`, k.s.fin, decision, ifMatch(1));
    expect([refused.status, errorCode(refused)]).toEqual([422, "baseline.not_measurable"]);
    // A rejection does not need a measurable baseline.
    const rejected = await post(
      `${k.base}/baselines/${unmeasurable.body.id}/validation`,
      k.s.fin,
      { result: "rejected", note: "No source yet." },
      ifMatch(1),
    );
    expect(rejected.body).toMatchObject({ validationStatus: "rejected", validatedRecordVersion: 2 });
  });

  it("an edit after validation makes it STALE (never validated); clearing the value withdraws it", async () => {
    const b = await post(`${k.base}/baselines`, k.s.kds, {
      metric: "Churn",
      unit: "%",
      scope: "customer",
      value: "2.1",
      source: "BI churn cube (synthetic)",
      baselineDate: "2026-05-31",
    });
    const v = await post(
      `${k.base}/baselines/${b.body.id}/validation`,
      k.s.fin,
      { result: "validated", note: "ok" },
      ifMatch(1),
    );
    expect(v.status).toBe(200);
    const corrected = await patch(`${k.base}/baselines/${b.body.id}`, k.s.kds, { value: "2.3" }, 2);
    expect(corrected.body).toMatchObject({
      value: "2.300000",
      validationStatus: "validated",
      validatedRecordVersion: 2,
      version: 3,
    });
    expect(validationState(corrected.body)).toBe("stale");
    const facts = await loadKpiGateFacts(api.db, k.transformationId);
    expect(facts.baselines.find((f) => f.id === b.body.id)).toMatchObject({
      validationStatus: "stale",
      hasValue: true,
    });
    // The correction is linked to the original through the audit trail (prior and new value).
    expect((await auditOf(api.db, b.body.id)).at(-1)!.changes).toMatchObject({
      value: { from: "2.100000", to: "2.300000" },
    });
    const cleared = await patch(`${k.base}/baselines/${b.body.id}`, k.s.kds, { value: null }, 3);
    expect(cleared.body).toMatchObject({ value: null, validationStatus: "unvalidated", validatedRecordVersion: null });
  });

  it("archives with a reason; an archived baseline is read-only and cannot be validated", async () => {
    const b = await post(`${k.base}/baselines`, k.s.tl, { metric: "Old metric", unit: "u", scope: "capability" });
    const noReason = await post(`${k.base}/baselines/${b.body.id}/archive`, k.s.tl, {}, ifMatch(1));
    expect(noReason.status).toBe(400);
    const a = await post(`${k.base}/baselines/${b.body.id}/archive`, k.s.tl, { reason: "Superseded" }, ifMatch(1));
    expect(a.body).toMatchObject({ status: "archived", version: 2 });
    const v = await post(
      `${k.base}/baselines/${b.body.id}/validation`,
      k.s.fin,
      { result: "rejected", note: "n" },
      ifMatch(2),
    );
    expect([v.status, v.body.code]).toEqual([422, "baseline.archived"]);
  });
});

// ------------------------------------------------------------------------------------------------ T02

describe("outcome-kpis (T02, REQ-PB-034)", () => {
  it("a row without a target date is rejected with 422 (targets are time-bound)", async () => {
    const d = await newKpi();
    const res = await post(`${k.base}/outcome-kpis`, k.s.kds, { outcomeId: k.outcomeId, kpiDefinitionId: d.id });
    expect([res.status, res.body.errors[0]]).toEqual([
      422,
      expect.objectContaining({ pointer: "/targetDate", code: "outcome_kpi.target_date_required" }),
    ]);
    const nulled = await post(`${k.base}/outcome-kpis`, k.s.kds, {
      outcomeId: k.outcomeId,
      kpiDefinitionId: d.id,
      targetDate: null,
    });
    expect(nulled.status).toBe(422);
  });

  it("persists all seven source columns: outcome, KPI, baseline, target, target date, owner, leading indicator", async () => {
    const kpi = await newKpi();
    const lead = await newKpi(k.s.kds, { isLeading: true, unitKind: "count", polarity: "higher_is_better" });
    const res = await post(`${k.base}/outcome-kpis`, k.s.bo, {
      outcomeId: k.outcomeId,
      kpiDefinitionId: kpi.id,
      baselineValue: "2.4",
      targetValue: "1.8",
      targetDate: "2027-12-31",
      ownerUserId: k.users.bo.id,
      leadingIndicatorText: "Weekly retention offers accepted",
      leadingKpiDefinitionId: lead.id,
      trajectoryPoints: [
        { date: "2026-12-31", value: "2.2" },
        { date: "2027-06-30", value: "2.0" },
        { date: "2027-12-31", value: "1.8" },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const read = await get(`${k.base}/outcome-kpis/${res.body.id}`, k.s.auditor);
    expect(read.body).toMatchObject({
      outcomeId: k.outcomeId,
      kpiDefinitionId: kpi.id,
      baselineValue: "2.400000",
      targetValue: "1.800000",
      targetDate: "2027-12-31",
      ownerUserId: k.users.bo.id,
      leadingIndicatorText: "Weekly retention offers accepted",
      leadingKpiDefinitionId: lead.id,
      trajectoryStatus: "draft",
      trajectoryPoints: [
        { date: "2026-12-31", value: "2.2" },
        { date: "2027-06-30", value: "2.0" },
        { date: "2027-12-31", value: "1.8" },
      ],
    });
  });

  it("refuses missing or archived references, two baseline sources, disordered trajectories (422)", async () => {
    const d = await newKpi();
    const body = { outcomeId: k.outcomeId, kpiDefinitionId: d.id, targetDate: "2027-12-31" };
    const archivedOutcome = await post(`${k.base}/outcome-kpis`, k.s.kds, { ...body, outcomeId: k.archivedOutcomeId });
    expect([archivedOutcome.status, archivedOutcome.body.errors[0].pointer]).toEqual([422, "/outcomeId"]);
    const missingKpi = await post(`${k.base}/outcome-kpis`, k.s.kds, {
      ...body,
      kpiDefinitionId: "01920000-0000-7000-8000-00000000dead",
    });
    expect([missingKpi.status, missingKpi.body.errors[0].pointer]).toEqual([422, "/kpiDefinitionId"]);
    const baseline = await post(`${k.base}/baselines`, k.s.kds, {
      metric: "Churn",
      unit: "%",
      scope: "customer",
      value: "2",
      baselineDate: "2026-06-30",
    });
    const both = await post(`${k.base}/outcome-kpis`, k.s.kds, {
      ...body,
      baselineId: baseline.body.id,
      baselineValue: "2",
    });
    expect(errorCode(both)).toBe("outcome_kpi.one_baseline_source");
    const beforeBaseline = await post(`${k.base}/outcome-kpis`, k.s.kds, {
      ...body,
      baselineId: baseline.body.id,
      targetDate: "2026-06-30",
    });
    expect(errorCode(beforeBaseline)).toBe("outcome_kpi.target_not_after_baseline");
    const order = await post(`${k.base}/outcome-kpis`, k.s.kds, {
      ...body,
      trajectoryPoints: [
        { date: "2027-06-30", value: "1" },
        { date: "2027-01-31", value: "2" },
      ],
    });
    expect([order.status, errorCode(order)]).toEqual([422, "outcome_kpi.trajectory_order"]);
    const after = await post(`${k.base}/outcome-kpis`, k.s.kds, {
      ...body,
      trajectoryPoints: [{ date: "2028-01-31", value: "2" }],
    });
    expect(errorCode(after)).toBe("outcome_kpi.trajectory_after_target");
    const clear = await post(`${k.base}/outcome-kpis`, k.s.kds, body);
    const cleared = await patch(`${k.base}/outcome-kpis/${clear.body.id}`, k.s.kds, { targetDate: null }, 1);
    expect([cleared.status, errorCode(cleared)]).toEqual([422, "outcome_kpi.target_date_required"]);
  });

  it("SP/BO approve the trajectory (never the creator, never TL); any later edit returns it to draft", async () => {
    const d = await newKpi();
    const row = await post(`${k.base}/outcome-kpis`, k.s.bo, {
      outcomeId: k.outcomeId,
      kpiDefinitionId: d.id,
      targetDate: "2027-12-31",
    });
    const url = `${k.base}/outcome-kpis/${row.body.id}/trajectory-approval`;
    const noTarget = await post(url, k.s.sp, {}, ifMatch(1));
    expect([noTarget.status, noTarget.body.code]).toEqual([422, "outcome_kpi.target_value_required"]);
    const withTarget = await patch(`${k.base}/outcome-kpis/${row.body.id}`, k.s.bo, { targetValue: "1.5" }, 1);
    expect(withTarget.body.version).toBe(2);
    const byCreator = await post(url, k.s.bo, { note: "mine" }, ifMatch(2));
    expect([byCreator.status, byCreator.body.code]).toEqual([403, "kpi.creator_cannot_approve"]);
    const byTl = await post(url, k.s.tl, {}, ifMatch(2));
    expect(byTl.status).toBe(403);
    const ok = await post(url, k.s.sp, { note: "Agreed at the steering forum (synthetic)." }, ifMatch(2));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      trajectoryStatus: "approved",
      trajectoryApprovedBy: k.users.sp.id,
      trajectoryApprovedVersion: 3,
      version: 3,
    });
    expect((await auditOf(api.db, row.body.id)).at(-1)).toMatchObject({
      action: "outcome_kpi.trajectory_approve",
      reason: "Agreed at the steering forum (synthetic).",
      new_version: 3,
    });
    const twice = await post(url, k.s.sp, {}, ifMatch(3));
    expect([twice.status, twice.body.code]).toEqual([422, "outcome_kpi.already_approved"]);
    let facts = await loadKpiGateFacts(api.db, k.transformationId);
    expect(facts.outcomeKpis.find((f) => f.id === row.body.id)).toMatchObject({
      trajectoryStatus: "approved",
      hasTarget: true,
    });
    const edited = await patch(`${k.base}/outcome-kpis/${row.body.id}`, k.s.kds, { targetValue: "1.4" }, 3);
    expect(edited.body).toMatchObject({
      trajectoryStatus: "draft",
      trajectoryApprovedBy: null,
      trajectoryApprovedVersion: null,
      version: 4,
    });
    facts = await loadKpiGateFacts(api.db, k.transformationId);
    expect(facts.outcomeKpis.find((f) => f.id === row.body.id)!.trajectoryStatus).toBe("draft");
  });
});

// ------------------------------------------------------------------------------------------------ value pools

describe("value-pools (REQ-PB-028, ADR-0019)", () => {
  it("defaults to unquantified with null amounts (never 0) and the transformation currency (SAR)", async () => {
    const res = await post(`${k.base}/value-pools`, k.s.to, { name: "Roaming leakage (synthetic)" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      quantificationStatus: "unquantified",
      upsideAmount: null,
      downsideAmount: null,
      currency: "SAR",
      materiality: "not_assessed",
      validationStatus: "unvalidated",
    });
  });

  it("quantified by driver with exact decimal upside/downside", async () => {
    const [ws] = await api.db.selectFrom("diagnostic_workstream").select("code").orderBy("ordinal").limit(1).execute();
    const res = await post(`${k.base}/value-pools`, k.s.tl, {
      name: "Prepaid churn reduction (synthetic)",
      driver: "Churn rate x active base x ARPU",
      workstreamCode: ws!.code,
      quantificationStatus: "quantified",
      downsideAmount: "1234567890123.4567",
      upsideAmount: "12345678901234.5678",
      materiality: "material",
      confidence: "M",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ downsideAmount: "1234567890123.4567", upsideAmount: "12345678901234.5678" });
    const bad = await post(`${k.base}/value-pools`, k.s.tl, { name: "x", workstreamCode: "no_such_workstream" });
    expect([bad.status, bad.body.errors[0].pointer]).toEqual([422, "/workstreamCode"]);
  });

  it("refuses downside > upside, amounts without quantification, and money beyond numeric(20,4)", async () => {
    const order = await post(`${k.base}/value-pools`, k.s.tl, {
      name: "x",
      quantificationStatus: "quantified",
      downsideAmount: "200",
      upsideAmount: "100",
    });
    expect(errorCode(order)).toBe("value_pool.downside_above_upside");
    const implicit = await post(`${k.base}/value-pools`, k.s.tl, { name: "x", upsideAmount: "100" });
    expect(errorCode(implicit)).toBe("value_pool.unquantified_has_amount");
    const scale = await post(`${k.base}/value-pools`, k.s.tl, {
      name: "x",
      quantificationStatus: "quantified",
      downsideAmount: "1.00001",
      upsideAmount: "2",
    });
    expect(scale.status).toBe(400);
  });

  it("FIN cannot validate an unquantified pool (422); a validation goes stale on edit; un-quantifying withdraws it", async () => {
    const u = await post(`${k.base}/value-pools`, k.s.to, { name: "Unsized (synthetic)" });
    const refused = await post(
      `${k.base}/value-pools/${u.body.id}/validation`,
      k.s.fin,
      { result: "validated", note: "n" },
      ifMatch(1),
    );
    expect([refused.status, refused.body.code]).toEqual([422, "value_pool.unquantified"]);

    const q = await post(`${k.base}/value-pools`, k.s.to, {
      name: "Sized (synthetic)",
      quantificationStatus: "quantified",
      downsideAmount: "100",
      upsideAmount: "200",
    });
    const byTo = await post(
      `${k.base}/value-pools/${q.body.id}/validation`,
      k.s.to,
      { result: "validated", note: "n" },
      ifMatch(1),
    );
    expect(byTo.status).toBe(403);
    const v = await post(
      `${k.base}/value-pools/${q.body.id}/validation`,
      k.s.fin,
      { result: "validated", note: "Reviewed." },
      ifMatch(1),
    );
    expect(v.body).toMatchObject({ validationStatus: "validated", validatedRecordVersion: 2, version: 2 });

    // Totals: all pools vs only Finance-validated current versions (a submission never raises the validated total).
    const page = await get(`${k.base}/value-pools?limit=100`, k.s.auditor);
    const pools = page.body.items.filter((p: Body) => [u.body.id, q.body.id].includes(p.id));
    const [all] = totalValuePools(pools);
    expect(all).toMatchObject({ quantifiedTotal: { downside: "100.0000", upside: "200.0000" }, unquantifiedCount: 1 });
    expect(totalValuePools(pools, { basis: "validated" })[0]!.quantifiedTotal).toEqual({
      downside: "100.0000",
      upside: "200.0000",
    });

    const edited = await patch(`${k.base}/value-pools/${q.body.id}`, k.s.to, { upsideAmount: "900" }, 2);
    expect(validationState(edited.body)).toBe("stale");
    expect(totalValuePools([edited.body], { basis: "validated" })[0]!.quantifiedTotal).toBeNull();

    const unq = await patch(`${k.base}/value-pools/${q.body.id}`, k.s.to, { quantificationStatus: "unquantified" }, 3);
    expect(unq.body).toMatchObject({
      quantificationStatus: "unquantified",
      upsideAmount: null,
      downsideAmount: null,
      validationStatus: "unvalidated",
      validatedRecordVersion: null,
    });
    const audit = await auditOf(api.db, q.body.id);
    expect(audit.map((e) => e.new_version)).toEqual([1, 2, 3, 4]);
    expect(audit.at(-1)!.changes).toMatchObject({ validation_status: { from: "validated", to: "unvalidated" } });
  });

  it("the creator cannot validate their own pool; a real zero is quantified, not Unknown", async () => {
    const q = await post(`${k.base}/value-pools`, k.s.finTl, {
      name: "SoD probe (synthetic)",
      quantificationStatus: "quantified",
      downsideAmount: "0",
      upsideAmount: "0",
    });
    expect(q.body).toMatchObject({ downsideAmount: "0.0000", upsideAmount: "0.0000" });
    const url = `${k.base}/value-pools/${q.body.id}/validation`;
    const own = await post(url, k.s.finTl, { result: "validated", note: "Mine." }, ifMatch(1));
    expect([own.status, own.body.code]).toEqual([403, "kpi.creator_cannot_validate"]);
    const ok = await post(url, k.s.fin, { result: "rejected", note: "Zero is implausible." }, ifMatch(1));
    expect(ok.body).toMatchObject({ validationStatus: "rejected", validatedBy: k.users.fin.id });
    expect(totalValuePools([ok.body], { basis: "validated" })[0]).toMatchObject({
      quantifiedTotal: null,
      notValidatedCount: 1,
    });
  });
});

// ------------------------------------------------------------------------------------------------ cross-cutting

describe("scope and gate facts", () => {
  it("another organization's user and a user without grants get 404 on reads and writes", async () => {
    for (const s of [k.s.outsider, k.s.nobody]) {
      expect((await get(`${k.base}/baselines`, s)).status).toBe(404);
      expect((await post(`${k.base}/baselines`, s, { metric: "m", unit: "u", scope: "cost" })).status).toBe(404);
    }
  });

  it("an archived transformation makes its kpi records read-only (422)", async () => {
    await api.owner.query(
      "UPDATE transformation SET archived_at = now(), archived_by = created_by, archive_reason = 'kpi fixture' WHERE id = $1",
      [k.transformationId],
    );
    try {
      const res = await post(`${k.base}/value-pools`, k.s.tl, { name: "late" });
      expect([res.status, res.body.code]).toEqual([422, "kpi.transformation_archived"]);
      expect((await get(`${k.base}/value-pools`, k.s.tl)).status).toBe(200);
    } finally {
      await api.owner.query(
        "UPDATE transformation SET archived_at = NULL, archived_by = NULL, archive_reason = NULL WHERE id = $1",
        [k.transformationId],
      );
    }
  });

  it("loadKpiGateFacts returns the work-split shape, excluding archived rows", async () => {
    const facts = await loadKpiGateFacts(api.db, k.transformationId);
    expect(Object.keys(facts).sort()).toEqual(["baselines", "kpiDefinitions", "outcomeKpis", "valuePools"]);
    expect(facts.kpiDefinitions.every((f) => f.status !== "archived")).toBe(true);
    expect(facts.valuePools.some((p) => p.quantificationStatus === "unquantified")).toBe(true);
    for (const b of facts.baselines)
      expect(Object.keys(b).sort()).toEqual(["hasDate", "hasSource", "hasValue", "id", "status", "validationStatus"]);
    for (const o of facts.outcomeKpis) expect(o.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const empty = await loadKpiGateFacts(api.db, "01920000-0000-7000-8000-00000000beef");
    expect(empty).toEqual({ baselines: [], valuePools: [], outcomeKpis: [], kpiDefinitions: [] });
  });
});
