// Fixtures of the KBE-E integration tests and contract exercises (T-DG4-KBE-E; p4-work-split §B.3), on top of KBE-D's
// fixtures.ts. All data is SYNTHETIC: the playbook B0087 revenue example (Δ attach × customers × ARPU = 0.02 × 100000 ×
// 50 = 100000 SAR) as a T09 formula created by TL and Finance-validated by FIN through the DG3 API; evidence through
// the evidence API; benefits at Measure through the register and lifecycle API; the baseline validated by FIN through
// decideBenefitBaseline. The worker's benefits handlers run in-process on the outbox rows, as the relay would deliver
// them. Nothing here grants a real business or Finance approval, and nothing touches the engineering gates DG0-DG7.
import { expect } from "vitest";
import { call, type TestApi } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { queueFinanceValidation, recalculatePending } from "../../../../worker/src/handlers/benefits.ts";
import { benefitAt, financialBody, type BenefitWorld, type Caller } from "./fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;

/** Playbook B0087 "Δ attach × customers × ARPU" (the DG3 seeded example's variables; synthetic values). */
export const REVENUE_VERSION = Object.freeze({
  expression: "(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu",
  variables: [
    { name: "baseline_attach_rate", kind: "fraction", period: "none", value: "0.10", source: "Synthetic CRM extract" },
    { name: "target_attach_rate", kind: "fraction", period: "none", value: "0.12" },
    { name: "eligible_customers", kind: "count", unit: "customers", period: "year", value: "100000" },
    { name: "arpu", kind: "currency", currency: "SAR", unit: "per customer", period: "year", value: "50" },
  ],
});

export interface RevenueFormula {
  readonly id: string;
  readonly versionId: string;
}

/** A T09 formula with the revenue example as version 1 (TL), optionally Finance-validated (FIN; synthetic). */
export async function revenueFormula(
  api: TestApi,
  b: BenefitWorld,
  opts: { validated?: boolean; send?: Caller } = {},
): Promise<RevenueFormula> {
  const send: Caller = opts.send ?? ((m, u, o) => call(api.app, m, u, o));
  const f = await send("POST", "/api/v1/benefit-formulas", {
    session: b.s.tl,
    body: {
      transformationId: b.transformationId,
      benefitName: "Synthetic attach uplift",
      initialVersion: REVENUE_VERSION,
    },
  });
  expect(f.status, JSON.stringify(f.body)).toBe(201);
  const versionId = (f.body as Body).currentVersion.id as string;
  if (opts.validated !== false) {
    const v = await send("POST", `/api/v1/benefit-formulas/${(f.body as Body).id}/versions/1/validation`, {
      session: b.s.fin,
      headers: ifm(1),
      body: { result: "validated", note: "Synthetic Finance check of the formula logic" },
    });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
  }
  return { id: (f.body as Body).id, versionId };
}

/** A synthetic note evidence item of the transformation (created by TL). */
export async function evidenceItem(api: TestApi, b: BenefitWorld, send?: Caller): Promise<string> {
  const req: Caller = send ?? ((m, u, o) => call(api.app, m, u, o));
  const res = await req("POST", `${b.base}/evidence`, {
    session: b.s.tl,
    body: { kind: "note", title: "Synthetic finance extract", noteBody: "Synthetic", ownerUserId: b.users.tl.id },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as Body).id;
}

/** Finance validates (or rejects) the benefit's baseline through decideBenefitBaseline; returns the new version. */
export async function decideBaseline(
  api: TestApi,
  b: BenefitWorld,
  benefitId: string,
  version: number,
  decision: "validated" | "rejected" = "validated",
  send?: Caller,
): Promise<number> {
  const req: Caller = send ?? ((m, u, o) => call(api.app, m, u, o));
  const res = await req("POST", `${b.base}/benefits/${benefitId}/baseline-validation`, {
    session: b.s.fin,
    headers: ifm(version),
    body: decision === "validated" ? { decision } : { decision, note: "Synthetic: the baseline source is outdated" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as Body).version;
}

export interface MeasuredBenefit {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly formula: RevenueFormula;
}

/**
 * A financial benefit at Measure using the revenue formula; its baseline Finance-validated unless `baseline: false`.
 * `extra` overrides the register body (e.g. valueClass, plannedValue).
 */
export async function measuredBenefit(
  api: TestApi,
  b: BenefitWorld,
  opts: { baseline?: boolean; formula?: RevenueFormula; extra?: Record<string, unknown> } = {},
): Promise<MeasuredBenefit> {
  const formula = opts.formula ?? (await revenueFormula(api, b));
  const body = financialBody(b, {
    baselineValue: "1000000",
    baselineUnit: "SAR",
    targetValue: "1200000",
    benefitFormulaId: formula.id,
    ...opts.extra,
  });
  const created = await benefitAt(api, b, "measure", body);
  let version = created.version;
  if (opts.baseline !== false) version = await decideBaseline(api, b, created.id, version);
  return { id: created.id, code: created.code, version, formula };
}

/** The outbox row of an event for an aggregate, as the relay's envelope (or undefined). */
export async function envelopeOf(api: TestApi, aggregateId: string, eventType: string) {
  const r = await api.db
    .selectFrom("outbox_event")
    .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
    .where("aggregate_id", "=", aggregateId)
    .where("event_type", "=", eventType)
    .orderBy("seq")
    .executeTakeFirst();
  if (!r) return undefined;
  return {
    outboxEventId: r.id,
    eventType: r.event_type,
    schemaVersion: r.schema_version,
    idempotencyKey: r.idempotency_key,
    organizationId: r.organization_id,
    payload: r.payload as Record<string, unknown>,
  };
}

/** Runs benefits.finance_queue for a submitted measurement's benefit.evidence_submitted event (as the relay would). */
export async function runFinanceQueue(api: TestApi, measurementId: string) {
  const env = await envelopeOf(api, measurementId, "benefit.evidence_submitted");
  expect(env, "benefit.evidence_submitted written by the submit transaction").toBeDefined();
  return queueFinanceValidation(api.db, env, `test-${env!.outboxEventId}`);
}

/** Runs benefits.recalculate_pending for a calculation run's kpi.values_recalculated event. */
export async function runRecalculatePending(api: TestApi, runId: string) {
  const env = await envelopeOf(api, runId, "kpi.values_recalculated");
  expect(env, "kpi.values_recalculated written by the run").toBeDefined();
  return recalculatePending(api.db, env, `test-${env!.outboxEventId}`);
}

/** The queue item (kind validation) of a measurement, or undefined. */
export async function queueItemOf(api: TestApi, measurementId: string) {
  return api.db
    .selectFrom("finance_validation")
    .selectAll()
    .where("benefit_measurement_id", "=", measurementId)
    .where("kind", "=", "validation")
    .executeTakeFirst();
}

/** Six accepted items (an approval body's `items`). */
export const ALL_ACCEPTED = Object.freeze({
  baseline: { decision: "accepted" },
  attribution: { decision: "accepted" },
  calculation: { decision: "accepted" },
  evidence: { decision: "accepted" },
  measurementPeriod: { decision: "accepted" },
  assumptions: { decision: "accepted" },
});

export interface SubmittedValue {
  readonly measurementId: string;
  readonly validationId: string;
  readonly validationVersion: number;
}

/**
 * A manual measurement submitted by BO with evidence for `period` (default 2026-09), and its queue item (the
 * finance_queue handler run in the test). Returns the measurement and queue item ids.
 */
export async function submittedValue(
  api: TestApi,
  b: BenefitWorld,
  benefitId: string,
  amount: string | null,
  opts: { periodStart?: string; periodEnd?: string; kpiValue?: string; send?: Caller } = {},
): Promise<SubmittedValue> {
  const req: Caller = opts.send ?? ((m, u, o) => call(api.app, m, u, o));
  const ev = await evidenceItem(api, b, req);
  const res = await req("POST", `${b.base}/benefits/${benefitId}/measurements`, {
    session: b.s.bo,
    body: {
      periodStart: opts.periodStart ?? "2026-09-01",
      periodEnd: opts.periodEnd ?? "2026-09-30",
      ...(amount === null ? {} : { amount }),
      ...(opts.kpiValue === undefined ? {} : { kpiValue: opts.kpiValue }),
      attribution: "Synthetic: control group of untreated prepaid customers",
      assumptions: "Synthetic: ARPU stable over the period",
      evidenceIds: [ev],
      submit: true,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const measurementId = (res.body as Body).id as string;
  const queued = await runFinanceQueue(api, measurementId);
  expect(queued.item).toBe("created");
  const item = await queueItemOf(api, measurementId);
  return { measurementId, validationId: item!.id, validationVersion: item!.version };
}

/** FIN approves a queued value with all six items accepted. */
export async function approve(
  api: TestApi,
  b: BenefitWorld,
  v: SubmittedValue,
  approvedAmount: string | null,
  send?: Caller,
) {
  const req: Caller = send ?? ((m, u, o) => call(api.app, m, u, o));
  const res = await req("POST", `${b.base}/finance-validations/${v.validationId}/decision`, {
    session: b.s.fin,
    headers: ifm(v.validationVersion),
    body: { decision: "approved", items: ALL_ACCEPTED, approvedAmount },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Body;
}

/** The transformation totals (AUD reads) and the line of one class and state in a currency. */
export async function totalsOf(api: TestApi, b: BenefitWorld, query = "") {
  const res = await call<Body>(api.app, "GET", `${b.base}/benefit-totals${query}`, { session: b.s.auditor });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Body;
}

export function lineOf(totals: Body, valueClass: string, state: string, currency = "SAR") {
  const c = (totals.currencies as Body[]).find((x) => x.currency === currency);
  return (c?.lines as Body[] | undefined)?.find((l) => l.valueClass === valueClass && l.state === state);
}
