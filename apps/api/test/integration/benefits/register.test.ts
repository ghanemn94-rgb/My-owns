// T14 Benefits Register (T-DG4-KBE-D; ADR-0029 §1, §4, §6, §9, §11; REQ-PB-058, REQ-PB-075, REQ-PB-076, REQ-S08-003,
// REQ-S08-009). Proves, against the run's disposable PostgreSQL:
//  - REQ-PB-058: a benefit with two owners is rejected (400); a financial benefit without a statement line and a
//    non-financial one without an agreed KPI are rejected (422); a benefit shared through allocations, a parent and a
//    group stays ONE canonical row and is counted once (benefit_counting);
//  - REQ-PB-075: the ten T14 columns of every row; IDs B01, B02…; a pending (submitted) amount is labelled pending and is
//    never part of the validated amount;
//  - REQ-PB-076: a CX benefit saved with Value n/a shows Value (SAR) not_applicable and Realized n/a, never 0;
//  - REQ-S08-003: the profile fields persist; REQ-S08-009: type <-> class, revenue uplift vs margin and cash savings vs
//    avoided cost are separate classes;
//  - every mutation: AUD 403, ADM-only 403, If-Match 428/409, one audit event, the write authorised again at commit.
// All data is SYNTHETIC; nothing here grants a business or Finance approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import {
  benefitAt,
  cxBody,
  extraUser,
  financialBody,
  insertInitiative,
  insertSubmittedMeasurement,
  markBaselineValidated,
  planOutputs,
  seedBenefitWorld,
  type BenefitWorld,
} from "./fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let B: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  B = `${b.base}/benefits`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const post = (body: unknown, session = b.s.bo) => call(api.app, "POST", B, { session, body });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
/** Every register row of the world's transformation for `query`, following nextCursor (limit 100). */
async function listAll(query = ""): Promise<Row[]> {
  const out: Row[] = [];
  let cursor: string | null = null;
  do {
    const sep = query === "" ? "?" : `?${query}&`;
    const url: string = `${B}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = await call(api.app, "GET", url, { session: b.s.auditor });
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    out.push(...(page.body.items as Row[]));
    cursor = page.body.nextCursor as string | null;
  } while (cursor !== null);
  return out;
}

describe("createBenefit (REQ-PB-058, REQ-S08-003, REQ-S08-009)", () => {
  it("creates at Identify with code B01, B02…, ETag 1, Location, one audit event; profile fields persist", async () => {
    const r = await post(
      financialBody(b, {
        financeValidatorUserId: b.users.fin.id,
        counterfactual: "Churn would stay at 2.1 % without the initiative.",
        driverKey: "churn.prepaid",
        driverUnits: "subscribers",
        populationKey: "prepaid",
        realizationStart: "2026-10-01",
        realizationEnd: "2027-09-30",
        recurrence: "recurring",
        measurementSource: "Synthetic billing extract",
        confidence: "M",
        assumptions: "Synthetic assumption.",
      }),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.headers.etag).toBe('"1"');
    expect(String(r.headers.location)).toBe(`${B}/${r.body.id}`);
    expect(r.body).toMatchObject({
      code: expect.stringMatching(/^B[0-9]{2,6}$/),
      lifecycleStep: "identify",
      realizationState: "not_enabled",
      financeValidationRequired: true,
      baselineValidationStatus: "unvalidated",
      financeValidatorUserId: b.users.fin.id,
      counterfactual: "Churn would stay at 2.1 % without the initiative.",
      driverKey: "churn.prepaid",
      recurrence: "recurring",
      confidence: "M",
      currency: "SAR",
      counting: { counted: true, exclusionReason: null, overlapOpen: false },
    });
    const next = await post(financialBody(b));
    const n = (code: string) => Number(code.slice(1));
    expect(n(next.body.code)).toBe(n(r.body.code) + 1);
    const audit = await auditOf(api.db, r.body.id);
    expect(audit.map((a) => [a.action, a.new_version])).toEqual([["benefit.create", 1]]);
  });

  it("a benefit with two owners is rejected (400; an array or a second owner property)", async () => {
    const arr = await post({ ...financialBody(b), ownerUserId: [b.users.bo.id, b.users.bo2.id] });
    expect([arr.status, arr.body.type]).toEqual([400, "urn:mth:problem:validation"]);
    const extra = await post({ ...financialBody(b), secondOwnerUserId: b.users.bo2.id });
    expect(extra.status).toBe(400);
    const missing = await post({ ...financialBody(b), ownerUserId: undefined });
    expect(missing.status).toBe(400);
  });

  it("a financial benefit without a statement line, or a non-financial one without an agreed KPI, is 422", async () => {
    const fin = await post(financialBody(b, { financialStatementLine: null }));
    expect([fin.status, fin.body.code, fin.body.detail]).toEqual([
      422,
      "benefit.mapping_required",
      "A financial benefit needs a financial-statement line.",
    ]);
    const cx = await post(cxBody(b, { measurementKpiDefinitionId: null }));
    expect([cx.status, cx.body.code, cx.body.detail]).toEqual([
      422,
      "benefit.kpi_required",
      "A non-financial benefit needs an agreed KPI.",
    ]);
  });

  it("type and class must fit; revenue uplift/margin and cash saving/avoided cost are separate classes", async () => {
    const bad = await post(financialBody(b, { benefitType: "cost", valueClass: "revenue_uplift" }));
    expect([bad.status, bad.body.code, bad.body.detail]).toEqual([
      422,
      "benefit.type_class_mismatch",
      "The value class revenue_uplift does not fit the benefit type cost. Revenue uplift and margin are revenue classes; cash savings and avoided cost are cost classes.",
    ]);
    for (const [benefitType, valueClass] of [
      ["revenue", "margin_uplift"],
      ["cost", "cash_saving"],
      ["cost", "avoided_cost"],
      ["working_capital", "working_capital_release"],
    ])
      expect((await post(financialBody(b, { benefitType, valueClass }))).body.valueClass).toBe(valueClass);
    expect((await post(cxBody(b, { benefitType: "strategic" }))).status).toBe(201);
    expect((await post(cxBody(b, { benefitType: "cx", valueClass: "cash_saving" }))).body.code).toBe(
      "benefit.type_class_mismatch",
    );
  });

  it("the other §11 create refusals: unmonetised CX value, validator = owner, unbound KPI variable, case line", async () => {
    const sar = await post(cxBody(b, { plannedValue: "500000" }));
    expect([sar.status, sar.body.code]).toEqual([422, "benefit.valuation_method_required"]);
    const sod = await post(financialBody(b, { financeValidatorUserId: b.users.bo.id }));
    expect([sod.status, sod.body.code, sod.body.detail]).toEqual([
      422,
      "benefit.validator_is_owner",
      "The Finance validator cannot be the benefit's owner.",
    ]);
    const unbound = await post(financialBody(b, { measurementKpiVariable: "nps" }));
    expect([unbound.status, unbound.body.code]).toEqual([422, "benefit.kpi_variable_unbound"]);
    const line = await post(financialBody(b, { businessCaseLineId: crypto.randomUUID() }));
    expect([line.status, line.body.code]).toEqual([422, "benefit.case_line_invalid"]);
    const decimalNumber = await post(financialBody(b, { plannedValue: 100 }));
    expect(decimalNumber.status).toBe(400);
  });

  it("AUD and an ADM-only user get 403 whatever the body; an outsider gets 404; nothing written", async () => {
    for (const session of [b.s.auditor, b.s.admin]) {
      expect((await post(financialBody(b), session)).status).toBe(403);
      expect((await post({ nonsense: true }, session)).status).toBe(403);
    }
    expect((await call(api.app, "GET", B, { session: b.s.outsider })).status).toBe(404);
    const rows = await api.db
      .selectFrom("benefit")
      .select("id")
      .where("transformation_id", "=", b.transformationId)
      .where("created_by", "in", [b.users.auditor.id, b.users.admin.id])
      .execute();
    expect(rows).toEqual([]);
  });

  it("commit-time: a grant revoked while the create waited is 403; nothing written", async () => {
    const u = await extraUser(api, w, b, "BO");
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", B, { session: u.session, body: financialBody(b), contract: false }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const rows = await api.db.selectFrom("benefit").select("id").where("created_by", "=", u.id).execute();
    expect(rows).toEqual([]);
  });
});

describe("updateBenefit and archiveBenefit", () => {
  it("If-Match 428/409; version + 1 and one audit event with the diff", async () => {
    const c = await post(financialBody(b));
    const I = `${B}/${c.body.id}`;
    expect((await call(api.app, "PATCH", I, { session: b.s.bo, body: { title: "x" } })).status).toBe(428);
    const stale = await call(api.app, "PATCH", I, { session: b.s.bo, headers: ifm(7), body: { title: "x" } });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const ok = await call(api.app, "PATCH", I, {
      session: b.s.tl,
      headers: ifm(1),
      body: { title: "Renamed synthetic benefit", statusRag: "amber", statusRagNote: "Synthetic note" },
    });
    expect([ok.status, ok.body.version, ok.body.statusRag, ok.headers.etag]).toEqual([200, 2, "amber", '"2"']);
    const audit = await auditOf(api.db, c.body.id);
    expect(audit.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["benefit.create", null, 1],
      ["benefit.update", 1, 2],
    ]);
    expect(Object.keys(audit[1]!.changes as object).sort()).toEqual(["status_rag", "status_rag_note", "title"]);
  });

  it("AUD and ADM-only get 403 on update and archive", async () => {
    const c = await post(financialBody(b));
    for (const session of [b.s.auditor, b.s.admin]) {
      expect(
        (await call(api.app, "PATCH", `${B}/${c.body.id}`, { session, headers: ifm(1), body: { title: "x" } })).status,
      ).toBe(403);
      expect(
        (
          await call(api.app, "POST", `${B}/${c.body.id}/archive`, {
            session,
            headers: ifm(1),
            body: { reason: "Synthetic" },
          })
        ).status,
      ).toBe(403);
    }
  });

  it("a Finance-validated baseline that changes is reset to unvalidated in the same update", async () => {
    const c = await post(financialBody(b, planOutputs(b)));
    const v = await markBaselineValidated(api.db, b, c.body.id);
    const r = await call(api.app, "PATCH", `${B}/${c.body.id}`, {
      session: b.s.bo,
      headers: ifm(v),
      body: { baselineValue: "1100000" },
    });
    expect([r.status, r.body.baselineValidationStatus, r.body.baselineValidatedBy, r.body.baselineValue]).toEqual([
      200,
      "unvalidated",
      null,
      "1100000.000000",
    ]);
    // A change that leaves the baseline alone keeps the validation.
    const v2 = await markBaselineValidated(api.db, b, c.body.id);
    const t = await call(api.app, "PATCH", `${B}/${c.body.id}`, {
      session: b.s.bo,
      headers: ifm(v2),
      body: { title: "t" },
    });
    expect(t.body.baselineValidationStatus).toBe("validated");
  });

  it("Plan outputs cannot be cleared after Plan; type, class and currency are fixed once there are values", async () => {
    const m = await benefitAt(api, b, "measure");
    const clear = await call(api.app, "PATCH", `${B}/${m.id}`, {
      session: b.s.bo,
      headers: ifm(m.version),
      body: { targetValue: null },
    });
    expect([clear.status, clear.body.code, clear.body.detail]).toEqual([
      422,
      "benefit.plan_outputs_missing",
      "The Plan outputs are missing: target. A benefit needs its baseline, formula, target and owner before Enable and Measure.",
    ]);
    await insertSubmittedMeasurement(api.db, b, m.id, "1000");
    const locked = await call(api.app, "PATCH", `${B}/${m.id}`, {
      session: b.s.bo,
      headers: ifm(m.version),
      body: { valueClass: "margin_uplift" },
    });
    expect([locked.status, locked.body.code]).toEqual([422, "benefit.measure_locked"]);
  });

  it("archive: a reason, not counted, read-only afterwards (422 benefit.archived)", async () => {
    const c = await post(financialBody(b));
    const A = `${B}/${c.body.id}/archive`;
    expect((await call(api.app, "POST", A, { session: b.s.bo, headers: ifm(1), body: {} })).status).toBe(400);
    const r = await call(api.app, "POST", A, {
      session: b.s.bo,
      headers: ifm(1),
      body: { reason: "Synthetic duplicate" },
    });
    expect([r.status, r.body.status, r.body.counting]).toEqual([
      200,
      "archived",
      { counted: false, exclusionReason: "archived", overlapOpen: false },
    ]);
    const again = await call(api.app, "PATCH", `${B}/${c.body.id}`, {
      session: b.s.bo,
      headers: ifm(2),
      body: { title: "x" },
    });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "benefit.archived",
      "This benefit is archived and read-only.",
    ]);
    expect((await auditOf(api.db, c.body.id)).map((a) => a.action)).toEqual(["benefit.create", "benefit.archive"]);
  });
});

describe("parent/child and counting once (REQ-PB-058)", () => {
  it("one level deep, same currency, a parent carries no values; the parent is a roll-up, never counted", async () => {
    const parent = await post(financialBody(b));
    const child = await post(financialBody(b, { parentBenefitId: parent.body.id }));
    expect(child.status, JSON.stringify(child.body)).toBe(201);
    const grandchild = await post(financialBody(b, { parentBenefitId: child.body.id }));
    expect([grandchild.status, grandchild.body.code]).toEqual([422, "benefit.parent_depth"]);
    const usd = await post(financialBody(b, { parentBenefitId: parent.body.id, currency: "USD" }));
    expect([usd.status, usd.body.code, usd.body.detail]).toEqual([
      422,
      "benefit.parent_currency",
      "A child benefit uses its parent's currency (SAR).",
    ]);
    const p = await call(api.app, "GET", `${B}/${parent.body.id}`, { session: b.s.auditor });
    expect(p.body.counting).toEqual({ counted: false, exclusionReason: "parent_rollup", overlapOpen: false });
    const withValues = await benefitAt(api, b, "measure");
    await insertSubmittedMeasurement(api.db, b, withValues.id, "10");
    const under = await post(financialBody(b, { parentBenefitId: withValues.id }));
    expect([under.status, under.body.code]).toEqual([422, "benefit.parent_has_values"]);
  });

  it("a 10 M SAR benefit allocated to two initiatives is ONE register row, counted once", async () => {
    const c = await post(financialBody(b, { plannedValue: "10000000" }));
    const [i1, i2] = [await insertInitiative(api.db, b), await insertInitiative(api.db, b)];
    const put = await call(api.app, "PUT", `${B}/${c.body.id}/allocations`, {
      session: b.s.tl,
      headers: ifm(1),
      body: {
        allocations: [
          { initiativeId: i1, share: "0.5" },
          { initiativeId: i2, share: "0.5" },
        ],
      },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const rows = await listAll();
    const mine = rows.filter((r) => r.id === c.body.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.valueSar).toEqual({ status: "known", amount: "10000000.0000", currency: "SAR", reason: null });
    expect(mine[0]!.counting.counted).toBe(true);
    const counted = await api.db
      .selectFrom("benefit_counting")
      .select(["benefit_id", "counted"])
      .where("benefit_id", "=", c.body.id)
      .execute();
    expect(counted).toEqual([{ benefit_id: c.body.id, counted: true }]);
  });
});

describe("listBenefits: the T14 register (REQ-PB-075, REQ-PB-076)", () => {
  it("every row carries the ten T14 columns; Value n/a and Unknown are never 0; status unknown, never green", async () => {
    const fin = await post(financialBody(b));
    const cx = await post(cxBody(b));
    const list = await listAll();
    const rowOf = (id: string): Row => list.find((r) => r.id === id);
    for (const row of [rowOf(fin.body.id), rowOf(cx.body.id)])
      for (const column of [
        "code",
        "title",
        "benefitType",
        "baseline",
        "target",
        "valueSar",
        "realized",
        "ownerUserId",
        "evidenceCount",
        "status",
      ])
        expect(row, column).toHaveProperty(column);
    expect(rowOf(fin.body.id).valueSar).toEqual({
      status: "unknown",
      amount: null,
      currency: "SAR",
      reason: "benefit.planned_value_missing",
    });
    expect(rowOf(fin.body.id).status).toBe("unknown");
    const cxRow = rowOf(cx.body.id);
    expect(cxRow.valueSar).toEqual({ status: "not_applicable", amount: null, currency: null, reason: null });
    expect(cxRow.realized.validated).toEqual({ status: "not_applicable", amount: null, currency: null, reason: null });
    expect(cxRow.realized.kpiActual).toEqual({ status: "unknown", value: null, reason: "benefit.kpi_actual_missing" });
  });

  it("a pending (submitted) value is labelled pending and is never part of the validated amount", async () => {
    const m = await benefitAt(api, b, "measure");
    const before = await call(api.app, "GET", `${B}/${m.id}`, { session: b.s.auditor });
    expect(before.body.realizationState).toBe("not_enabled");
    await insertSubmittedMeasurement(api.db, b, m.id, "250000");
    const row = (await listAll("lifecycleStep=measure")).find((r) => r.id === m.id);
    expect(row.realized).toMatchObject({
      validated: { status: "known", amount: "0.0000", currency: "SAR", reason: null },
      validatedCount: 0,
      sustained: { status: "known", amount: "0.0000", currency: "SAR", reason: null },
      sustainedCount: 0,
      pending: { status: "known", amount: "250000.0000", currency: "SAR", reason: null },
      pendingCount: 1,
    });
    expect(row.realizationState).toBe("measured_pending_validation");
  });

  it("filters by step and status; archived rows only with status=archived; 400 on a bad filter", async () => {
    const c = await post(financialBody(b));
    await call(api.app, "POST", `${B}/${c.body.id}/archive`, {
      session: b.s.bo,
      headers: ifm(1),
      body: { reason: "Gone" },
    });
    expect((await listAll()).some((r) => r.id === c.body.id)).toBe(false);
    expect((await listAll("status=archived")).some((r) => r.id === c.body.id)).toBe(true);
    expect((await call(api.app, "GET", `${B}?lifecycleStep=done`, { session: b.s.auditor })).status).toBe(400);
  });
});
