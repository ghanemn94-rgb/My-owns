// Benefit measurements, submission and calculation lineage (T-DG4-KBE-E; ADR-0030 §2, §3, §5, §8, §11). Proves, against
// the run's disposable PostgreSQL:
//  - REQ-S08-016 "submitting a value leaves the validated total unchanged": a submitted value is pending (submitted
//    series), validated stays 0.0000; exactly one benefit.evidence_submitted outbox event per submission;
//  - REQ-S08-017 "an in-place edit of a validated value is 409": PATCH on a validated measurement answers 409
//    benefit_measurement.validated_immutable (urn:mth:problem:invalid-transition) and writes nothing;
//  - REQ-S08-006 lineage: getBenefitMeasurement returns the formula version, the input values (rates and variables,
//    the KPI actual version when bound), the assumptions and the period; the benefit_calculation row exists;
//  - REQ-S08-004: the DG3 engine is reused unchanged: a stored formula version holding a non-whitelisted call or a
//    JavaScript payload is refused at parse time by createBenefitMeasurement (422 formula.*), nothing written;
//  - REQ-S08-008 basis: provisional until the baseline (and formula version) are Finance-validated;
//  - the exact ADR-0030 §11 refusals; benefit.measure only (AUD and ADM-only 403; outsider 404); If-Match 428/409;
//    one audit event per change; commit-time authorisation.
// All data is SYNTHETIC; nothing here grants a real business or Finance approval or touches DG0-DG7.
import { insertAuditEvent } from "@mth/db";
import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { benefitAt, cxBody, extraUser, seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";
import {
  approve,
  evidenceItem,
  measuredBenefit,
  REVENUE_VERSION,
  revenueFormula,
  runFinanceQueue,
  submittedValue,
  type Body,
} from "./value-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const M = (benefitId: string) => `${b.base}/benefits/${benefitId}/measurements`;
const ITEM = (id: string) => `${b.base}/benefit-measurements/${id}`;
let month = 0;
/** A fresh monthly period per call (no two tests share a live period). */
const period = () => {
  month += 1;
  const y = 2030 + Math.floor((month - 1) / 12);
  const m = String(((month - 1) % 12) + 1).padStart(2, "0");
  const end = new Date(Date.UTC(y, Number(m), 0)).getUTCDate();
  return { periodStart: `${y}-${m}-01`, periodEnd: `${y}-${m}-${end}` };
};
const seriesOf = async (benefitId: string) => {
  const r = await call<Body>(api.app, "GET", `${b.base}/benefits/${benefitId}/values`, { session: b.s.auditor });
  expect(r.status).toBe(200);
  return Object.fromEntries((r.body.series as Body[]).map((s) => [s.state, s]));
};

describe("create, read, list (ADR-0030 §2)", () => {
  it("BO records a draft: 201, Location, ETag, basis, one audit event; list newest first; AUD reads", async () => {
    const ben = await measuredBenefit(api, b);
    const p = period();
    const r = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...p, amount: "250000", attribution: "Synthetic control group", assumptions: "Synthetic" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.headers.location).toBe(`${b.base}/benefit-measurements/${r.body.id}`);
    expect(r.headers.etag).toBe('"1"');
    expect(r.body).toMatchObject({
      benefitId: ben.id,
      measurementNo: 1,
      kind: "measurement",
      source: "manual",
      status: "draft",
      amount: "250000.0000",
      currency: "SAR",
      basis: "validated",
      sustainPhase: false,
      validatedAmount: null,
      submittedBy: null,
      financeValidationId: null,
      inputs: [],
      evidenceIds: [],
    });
    expect((await auditOf(api.db, r.body.id)).map((e) => e.action)).toEqual(["benefit_measurement.create"]);
    const second = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...period(), missingReason: "Synthetic: billing extract late" },
    });
    expect([second.status, second.body.amount, second.body.missingReason]).toEqual([
      201,
      null,
      "Synthetic: billing extract late",
    ]);
    const list = await call<Body>(api.app, "GET", M(ben.id), { session: b.s.auditor });
    expect(list.status).toBe(200);
    expect((list.body.items as Body[]).map((m) => m.measurementNo)).toEqual([2, 1]);
    const got = await call<Body>(api.app, "GET", ITEM(r.body.id), { session: b.s.auditor });
    expect([got.status, got.headers.etag, got.body.id]).toEqual([200, '"1"', r.body.id]);
    expect((await call(api.app, "GET", ITEM(r.body.id), { session: b.s.outsider })).status).toBe(404);
    expect((await call(api.app, "GET", M(ben.id), { session: b.s.outsider })).status).toBe(404);
  });

  it("the §11 refusals: step, value shape, unmonetised, period taken, period range, unknown evidence", async () => {
    const early = await benefitAt(api, b, "enable");
    const step = await call<Body>(api.app, "POST", M(early.id), {
      session: b.s.bo,
      body: { ...period(), amount: "1" },
    });
    expect([step.status, step.body.code, step.body.detail]).toEqual([
      422,
      "benefit_measurement.step",
      `Benefit ${early.code} is at the enable step. Measurements start at Measure; a delivered enabler is not realized value.`,
    ]);
    const ben = await measuredBenefit(api, b);
    const none = await call<Body>(api.app, "POST", M(ben.id), { session: b.s.bo, body: { ...period() } });
    expect([none.status, none.body.code, none.body.detail]).toEqual([
      422,
      "benefit_measurement.value_shape",
      "Enter an amount, a KPI value, or why the value is not available.",
    ]);
    const both = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...period(), amount: "1", missingReason: "Synthetic reason" },
    });
    expect([both.status, both.body.code]).toEqual([422, "benefit_measurement.value_shape"]);
    const p = period();
    expect((await call(api.app, "POST", M(ben.id), { session: b.s.bo, body: { ...p, amount: "5" } })).status).toBe(201);
    const taken = await call<Body>(api.app, "POST", M(ben.id), { session: b.s.bo, body: { ...p, amount: "6" } });
    expect([taken.status, taken.body.type, taken.body.code, taken.body.detail]).toEqual([
      409,
      "urn:mth:problem:duplicate",
      "benefit_measurement.period_taken",
      `Benefit ${ben.code} already has a live measurement for ${p.periodStart} to ${p.periodEnd}. Correct that one instead.`,
    ]);
    const range = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { periodStart: "2031-02-01", periodEnd: "2031-01-01", amount: "1" },
    });
    expect(range.status).toBe(422);
    const ev = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...period(), amount: "1", evidenceIds: [uuidv7()] },
    });
    expect([ev.status, ev.body.code]).toEqual([422, "validation.reference"]);
    // A CX benefit has no SAR value without an approved valuation method; its KPI value is accepted.
    const cx = await benefitAt(api, b, "measure", cxBody(b, { baselineValue: "40", targetValue: "55" }));
    const sar = await call<Body>(api.app, "POST", M(cx.id), { session: b.s.bo, body: { ...period(), amount: "100" } });
    expect([sar.status, sar.body.code, sar.body.detail]).toEqual([
      422,
      "benefit_value.unmonetised",
      "A non-financial benefit has no SAR value without an approved valuation method. Record its KPI value instead.",
    ]);
    const kpi = await call<Body>(api.app, "POST", M(cx.id), {
      session: b.s.bo,
      body: { ...period(), kpiValue: "47.5" },
    });
    expect([kpi.status, kpi.body.kpiValue, kpi.body.amount]).toEqual([201, "47.500000", null]);
    // Nothing above was written except the two accepted rows (no audit for the refusals).
    const rows = await api.db.selectFrom("benefit_measurement").select("id").where("benefit_id", "=", ben.id).execute();
    expect(rows).toHaveLength(1);
  });

  it("AUD, ADM-only and outsider callers: 403 / 403 / 404 on create; FIN (no benefit.measure) 403", async () => {
    const ben = await measuredBenefit(api, b);
    for (const s of [b.s.auditor, b.s.admin, b.s.fin]) {
      const r = await call<Body>(api.app, "POST", M(ben.id), { session: s, body: { ...period(), amount: "1" } });
      expect(r.status).toBe(403);
    }
    expect(
      (await call(api.app, "POST", M(ben.id), { session: b.s.outsider, body: { ...period(), amount: "1" } })).status,
    ).toBe(403);
  });
});

describe("submission (REQ-S08-016, REQ-S12-014 API half)", () => {
  it("submit needs the period and evidence; If-Match 428/409; one audit event and one outbox event; pending only", async () => {
    const ben = await measuredBenefit(api, b);
    const noPeriod = await call<Body>(api.app, "POST", M(ben.id), { session: b.s.bo, body: { amount: "250000" } });
    expect(noPeriod.status).toBe(201);
    const s1 = await call<Body>(api.app, "POST", `${ITEM(noPeriod.body.id)}/submit`, {
      session: b.s.bo,
      headers: ifm(1),
    });
    expect([s1.status, s1.body.code, s1.body.detail]).toEqual([
      422,
      "benefit_measurement.period_required",
      "A measurement needs its measurement period before it is submitted.",
    ]);
    const p = period();
    const draft = await call<Body>(api.app, "POST", M(ben.id), { session: b.s.bo, body: { ...p, amount: "250000" } });
    const s2 = await call<Body>(api.app, "POST", `${ITEM(draft.body.id)}/submit`, { session: b.s.bo, headers: ifm(1) });
    expect([s2.status, s2.body.code, s2.body.detail]).toEqual([
      422,
      "benefit_measurement.evidence_required",
      "A measurement is submitted with at least one piece of evidence.",
    ]);
    const atOnce = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...period(), amount: "1", submit: true },
    });
    expect([atOnce.status, atOnce.body.code]).toEqual([422, "benefit_measurement.evidence_required"]);
    const ev = await evidenceItem(api, b);
    const linked = await call<Body>(api.app, "PATCH", ITEM(draft.body.id), {
      session: b.s.bo,
      headers: ifm(1),
      body: { evidenceIds: [ev], assumptions: "Synthetic: no price change" },
    });
    expect([linked.status, linked.body.version, linked.body.evidenceIds]).toEqual([200, 2, [ev]]);
    expect((await call(api.app, "POST", `${ITEM(draft.body.id)}/submit`, { session: b.s.bo })).status).toBe(428);
    expect(
      (await call(api.app, "POST", `${ITEM(draft.body.id)}/submit`, { session: b.s.bo, headers: ifm(1) })).status,
    ).toBe(409);
    const submitted = await call<Body>(api.app, "POST", `${ITEM(draft.body.id)}/submit`, {
      session: b.s.bo,
      headers: ifm(2),
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body).toMatchObject({ status: "submitted", submittedBy: b.users.bo.id, version: 3 });
    expect((await auditOf(api.db, draft.body.id)).map((e) => e.action)).toEqual([
      "benefit_measurement.create",
      "benefit_measurement.update",
      "benefit_measurement.submitted",
    ]);
    const events = await api.db
      .selectFrom("outbox_event")
      .select(["event_type", "idempotency_key", "payload"])
      .where("aggregate_id", "=", draft.body.id)
      .execute();
    expect(events).toEqual([
      {
        event_type: "benefit.evidence_submitted",
        idempotency_key: `benefit.evidence_submitted:${draft.body.id}`,
        payload: { benefitId: ben.id, measurementId: draft.body.id, transformationId: b.transformationId },
      },
    ]);
    // REQ-S08-016: pending, never validated.
    const s = await seriesOf(ben.id);
    expect(s.validated.total).toEqual({ status: "known", amount: "0.0000", currency: "SAR", reason: null });
    expect([s.validated.count, s.submitted.count, s.submitted.total.amount]).toEqual([0, 1, "250000.0000"]);
    expect(s.submitted.lines[0].basis).toBe("validated");
    // A submitted row is not a draft any more.
    const again = await call<Body>(api.app, "PATCH", ITEM(draft.body.id), {
      session: b.s.bo,
      headers: ifm(3),
      body: { amount: "1" },
    });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "benefit_measurement.not_draft",
      "Only a draft measurement can be changed or submitted.",
    ]);
    const resubmit = await call<Body>(api.app, "POST", `${ITEM(draft.body.id)}/submit`, {
      session: b.s.bo,
      headers: ifm(3),
    });
    expect([resubmit.status, resubmit.body.code]).toEqual([422, "benefit_measurement.not_draft"]);
  });

  it("REQ-S08-017: an in-place edit of a validated value is 409 validated_immutable; nothing written", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "240000.5", period());
    await approve(api, b, v, "240000.5");
    const before = await api.db
      .selectFrom("benefit_measurement")
      .selectAll()
      .where("id", "=", v.measurementId)
      .executeTakeFirstOrThrow();
    const r = await call<Body>(api.app, "PATCH", ITEM(v.measurementId), {
      session: b.s.bo,
      headers: ifm(before.version),
      body: { amount: "999999" },
    });
    expect([r.status, r.body.type, r.body.code, r.body.detail]).toEqual([
      409,
      "urn:mth:problem:invalid-transition",
      "benefit_measurement.validated_immutable",
      "A validated value is never edited. Record an amendment or a reversal.",
    ]);
    const after = await api.db
      .selectFrom("benefit_measurement")
      .selectAll()
      .where("id", "=", v.measurementId)
      .executeTakeFirstOrThrow();
    expect(after).toEqual(before);
  });

  it("commit-time: a BO grant revoked while the submission waited is 403; still a draft", async () => {
    const ben = await measuredBenefit(api, b);
    const u = await extraUser(api, w, b, "BO");
    const ev = await evidenceItem(api, b);
    const draft = await call<Body>(api.app, "POST", M(ben.id), {
      session: u.session,
      body: { ...period(), amount: "10", evidenceIds: [ev] },
    });
    expect(draft.status).toBe(201);
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", `${ITEM(draft.body.id)}/submit`, {
          session: u.session,
          headers: ifm(1),
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("benefit_measurement")
      .select(["status", "version"])
      .where("id", "=", draft.body.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "draft", version: 1 });
  });
});

describe("the formula engine and lineage (REQ-S08-004, REQ-S08-006, REQ-S08-008)", () => {
  it("Δ attach × customers × ARPU = 0.02 × 100000 × 50 = 100000.0000; getBenefitMeasurement returns the lineage", async () => {
    const ben = await measuredBenefit(api, b);
    const p = period();
    const r = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...p, formulaVersionId: ben.formula.versionId, assumptions: "Synthetic: attach measured on the base" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([r.body.amount, r.body.formulaVersionId, r.body.basis]).toEqual([
      "100000.0000",
      ben.formula.versionId,
      "validated",
    ]);
    const got = await call<Body>(api.app, "GET", ITEM(r.body.id), { session: b.s.auditor });
    expect(got.body.inputs).toEqual([
      { variableName: "arpu", kpiActualId: null, kpiValueNo: null, value: "50", ...p },
      { variableName: "baseline_attach_rate", kpiActualId: null, kpiValueNo: null, value: "0.1", ...p },
      { variableName: "eligible_customers", kpiActualId: null, kpiValueNo: null, value: "100000", ...p },
      { variableName: "target_attach_rate", kpiActualId: null, kpiValueNo: null, value: "0.12", ...p },
    ]);
    expect([got.body.periodStart, got.body.periodEnd, got.body.assumptions]).toEqual([
      p.periodStart,
      p.periodEnd,
      "Synthetic: attach measured on the base",
    ]);
    const calc = await api.db
      .selectFrom("benefit_calculation")
      .selectAll()
      .where("id", "=", got.body.benefitCalculationId)
      .executeTakeFirstOrThrow();
    expect([calc.formula_version_id, calc.result, calc.outcome, calc.period_start, calc.period_end]).toEqual([
      ben.formula.versionId,
      "100000.000000",
      "ok",
      p.periodStart,
      p.periodEnd,
    ]);
    // A rate override is recorded as the value used, with its source.
    const o = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...period(), formulaVersionId: ben.formula.versionId, variables: { arpu: "60" } },
    });
    expect([o.status, o.body.amount]).toEqual([201, "120000.0000"]);
    const oc = await api.db
      .selectFrom("benefit_calculation")
      .select("inputs")
      .where("id", "=", o.body.benefitCalculationId)
      .executeTakeFirstOrThrow();
    expect((oc.inputs as Body).arpu).toMatchObject({
      value: "60",
      source: "Measurement input (overrides the version value)",
    });
    // An unknown variable and an amount next to a formula are refused.
    const bad = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...period(), formulaVersionId: ben.formula.versionId, variables: { churn: "1" } },
    });
    expect([bad.status, bad.body.code, bad.body.detail]).toEqual([
      422,
      "formula.undefined_variable",
      "Undefined variable: churn",
    ]);
    const mixed = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...period(), formulaVersionId: ben.formula.versionId, amount: "1" },
    });
    expect([mixed.status, mixed.body.code]).toEqual([422, "benefit_measurement.value_shape"]);
  });

  it("REQ-S08-006: after a formula change, an older measurement keeps its formula version reference", async () => {
    const ben = await measuredBenefit(api, b);
    const old = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...period(), formulaVersionId: ben.formula.versionId },
    });
    expect(old.status, JSON.stringify(old.body)).toBe(201);
    const f = await call<Body>(api.app, "GET", `/api/v1/benefit-formulas/${ben.formula.id}`, { session: b.s.tl });
    const v2 = await call<Body>(api.app, "POST", `/api/v1/benefit-formulas/${ben.formula.id}/versions`, {
      session: b.s.tl,
      headers: ifm(f.body.version),
      body: {
        ...REVENUE_VERSION,
        expression: "(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu * 2",
      },
    });
    expect(v2.status, JSON.stringify(v2.body)).toBe(201);
    const newVersionId = (v2.body.currentVersion ?? v2.body).id as string;
    expect(newVersionId).not.toBe(ben.formula.versionId);
    const again = await call<Body>(api.app, "GET", ITEM(old.body.id), { session: b.s.auditor });
    expect([again.body.formulaVersionId, again.body.amount]).toEqual([ben.formula.versionId, "100000.0000"]);
    const fresh = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...period(), formulaVersionId: newVersionId },
    });
    expect([fresh.status, fresh.body.formulaVersionId, fresh.body.amount, fresh.body.basis]).toEqual([
      201,
      newVersionId,
      "200000.0000",
      "provisional",
    ]);
  });

  it("REQ-S08-004: a stored version with a non-whitelisted call or a JavaScript payload is refused at parse time", async () => {
    const ben = await measuredBenefit(api, b);
    for (const expression of ["eval(1)", "constructor.constructor('return process')()", "process.exit(1)"]) {
      const id = uuidv7();
      await api.db.transaction().execute(async (tx) => {
        const max = await tx
          .selectFrom("benefit_formula_version")
          .select((eb) => eb.fn.max("version_no").as("n"))
          .where("formula_id", "=", ben.formula.id)
          .executeTakeFirstOrThrow();
        await tx
          .insertInto("benefit_formula_version")
          .values({
            id,
            organization_id: b.organizationId,
            transformation_id: b.transformationId,
            formula_id: ben.formula.id,
            version_no: Number(max.n) + 1,
            expression,
            expression_sha256: createHash("sha256").update(expression).digest("hex"),
            result_kind: "currency",
            result_currency: "SAR",
            result_period: "year",
            engine_version: "synthetic-injected",
            created_by: b.users.tl.id,
            updated_by: b.users.tl.id,
          })
          .execute();
        await insertAuditEvent(
          tx,
          { actorType: "user", actorUserId: b.users.tl.id, requestId: `fixture-${id}`, source: "api" },
          {
            action: "benefit_formula_version.create",
            recordType: "benefit_formula_version",
            recordId: id,
            organizationId: b.organizationId,
            transformationId: b.transformationId,
            newVersion: 1,
          },
        );
      });
      const before = await api.db
        .selectFrom("benefit_measurement")
        .select("id")
        .where("benefit_id", "=", ben.id)
        .execute();
      const r = await call<Body>(api.app, "POST", M(ben.id), {
        session: b.s.bo,
        body: { ...period(), formulaVersionId: id },
      });
      expect(r.status, expression).toBe(422);
      expect(String(r.body.code)).toMatch(/^formula\./);
      const after = await api.db
        .selectFrom("benefit_measurement")
        .select("id")
        .where("benefit_id", "=", ben.id)
        .execute();
      expect(after).toEqual(before);
    }
  });

  it("REQ-S08-008: provisional until the baseline (and the formula version used) are Finance-validated", async () => {
    const unvalidated = await revenueFormula(api, b, { validated: false });
    const ben = await measuredBenefit(api, b, { baseline: false, formula: unvalidated });
    const r = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...period(), formulaVersionId: unvalidated.versionId },
    });
    expect([r.status, r.body.basis]).toEqual([201, "provisional"]);
    const plain = await call<Body>(api.app, "POST", M(ben.id), { session: b.s.bo, body: { ...period(), amount: "5" } });
    expect(plain.body.basis).toBe("provisional");
  });

  it("a formula version of another formula is refused (422 validation.reference)", async () => {
    const ben = await measuredBenefit(api, b);
    const other = await revenueFormula(api, b);
    const r = await call<Body>(api.app, "POST", M(ben.id), {
      session: b.s.bo,
      body: { ...period(), formulaVersionId: other.versionId },
    });
    expect([r.status, r.body.code]).toEqual([422, "validation.reference"]);
  });
});

describe("the finance queue item from a submission (REQ-S12-014)", () => {
  it("one queue item per submission with the six-key snapshot; replaying the event creates none", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "1000", period());
    const replay = await runFinanceQueue(api, v.measurementId);
    expect(replay.outcome).toBe("duplicate");
    const items = await api.db
      .selectFrom("finance_validation")
      .selectAll()
      .where("benefit_measurement_id", "=", v.measurementId)
      .execute();
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!.content as object).sort()).toEqual(
      ["assumptions", "attribution", "baseline", "calculation", "evidence", "measurementPeriod"].sort(),
    );
    expect(items[0]).toMatchObject({
      status: "queued",
      kind: "validation",
      idempotency_key: `benefit.evidence_submitted:${v.measurementId}`,
    });
    expect((await auditOf(api.db, items[0]!.id)).map((e) => [e.action, e.actor_type])).toEqual([
      ["finance_validation.queued", "service"],
    ]);
  });
});
