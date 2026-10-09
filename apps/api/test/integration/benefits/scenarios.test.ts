// Benefit scenarios and scenario values (T-DG4-KBE-D2; ADR-0029 §10, §11; REQ-S08-018, REQ-S16-017 "Scenario").
// Proves, against the run's disposable PostgreSQL:
//  - A10 "upside scenario values never appear in the realized or validated totals": an upside value of 7 777 777 SAR is
//    stored only in benefit_scenario_value, appears in no benefit_value_line row (the only source of realized,
//    validated, sustained and pending figures, ADR-0030 §6), and the T14 Realized column stays 0 validated / 0 pending;
//  - every scenario value returned is labelled with its kind (base | upside | downside);
//  - one active scenario per kind (409 benefit_scenario.kind_exists), freed by archiving;
//  - value rules: currency copied from the benefit; no SAR amount on a non-financial benefit without an approved
//    valuation method (422 benefit_value.unmonetised, REQ-S08-010); no values on a parent (422); one value per period
//    (409); archived benefit or scenario refused (422);
//  - benefit_scenario.edit = TL and FIN only (BO, AUD and ADM-only get 403); If-Match 428/409; one audit event per
//    change; commit-time authorisation.
// All data is SYNTHETIC; nothing here grants a real business or Finance approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { cxBody, extraUser, financialBody, seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let B: string;
let S: string;
let V: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  B = `${b.base}/benefits`;
  S = `${b.base}/benefit-scenarios`;
  V = `${b.base}/benefit-scenario-values`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const newBenefit = async (body: Record<string, unknown> = financialBody(b)) => {
  const r = await call(api.app, "POST", B, { session: b.s.bo, body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number; code: string };
};
const newScenario = async (kind: string, session = b.s.tl) => {
  const r = await call(api.app, "POST", S, { session, body: { kind, title: `Synthetic ${kind} case` } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number; kind: string };
};
const archiveScenario = async (id: string, version: number) => {
  const r = await call(api.app, "PATCH", `${S}/${id}`, {
    session: b.s.tl,
    headers: ifm(version),
    body: { archiveReason: "Synthetic test clean-up" },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
};
const period = { periodStart: "2026-01-01", periodEnd: "2026-12-31" };

describe("scenario values are never actuals (REQ-S08-018)", () => {
  it("an upside value of 7 777 777 SAR appears in no value line and in no realized or validated figure", async () => {
    const upside = await newScenario("upside");
    const benefit = await newBenefit(financialBody(b, { plannedValue: "1000000" }));
    const v = await call(api.app, "POST", `${S}/${upside.id}/values`, {
      session: b.s.fin,
      body: { benefitId: benefit.id, ...period, amount: "7777777", note: "Synthetic upside" },
    });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect([v.body.scenarioKind, v.body.amount, v.body.currency, v.body.version]).toEqual([
      "upside",
      "7777777.0000",
      "SAR",
      1,
    ]);
    expect(v.headers.location).toBe(`${V}/${v.body.id}`);
    // Labelled wherever shown.
    const got = await call(api.app, "GET", `${S}/${upside.id}`, { session: b.s.auditor });
    expect([got.status, got.headers.etag, got.body.kind]).toEqual([200, '"1"', "upside"]);
    expect(
      (got.body.values as { scenarioKind: string; amount: string }[]).map((x) => [x.scenarioKind, x.amount]),
    ).toEqual([["upside", "7777777.0000"]]);
    // Never an actual: no value line carries it, whatever the state.
    const lines = await api.db
      .selectFrom("benefit_value_line")
      .select(["value_state", "amount"])
      .where("benefit_id", "=", benefit.id)
      .execute();
    expect(lines.filter((l) => l.amount !== null && Number.parseFloat(String(l.amount)) === 7777777)).toEqual([]);
    expect(
      lines.filter((l) => ["validated", "sustained", "submitted", "measured"].includes(l.value_state ?? "")),
    ).toEqual([]);
    // T14 Realized: validated 0, sustained 0, pending 0 (counts 0); Value (SAR) is the planned value, not the scenario.
    const list = await call(api.app, "GET", `${B}?limit=100`, { session: b.s.auditor });
    const row = (list.body.items as { id: string; realized: Record<string, unknown>; valueSar: unknown }[]).find(
      (x) => x.id === benefit.id,
    )!;
    expect(row.realized).toMatchObject({
      validated: { status: "known", amount: "0.0000" },
      validatedCount: 0,
      sustained: { status: "known", amount: "0.0000" },
      pending: { status: "known", amount: "0.0000" },
      pendingCount: 0,
    });
    expect(row.valueSar).toEqual({ status: "known", amount: "1000000.0000", currency: "SAR", reason: null });
    expect((await auditOf(api.db, v.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["benefit_scenario_value.create", 1],
    ]);
    // A benefit with a scenario value has its type, class and currency fixed (benefit_measure_locked).
    const relabel = await call(api.app, "PATCH", `${B}/${benefit.id}`, {
      session: b.s.bo,
      headers: ifm(benefit.version),
      body: { currency: "USD" },
    });
    expect([relabel.status, relabel.body.code]).toEqual([422, "benefit.measure_locked"]);
    await archiveScenario(upside.id, 1);
  });

  it("one active scenario per kind (409); archiving frees the kind; archived scenarios are read-only", async () => {
    const base = await newScenario("base");
    const dup = await call(api.app, "POST", S, { session: b.s.fin, body: { kind: "base", title: "Second base" } });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "benefit_scenario.kind_exists",
      "This transformation already has an active base scenario.",
    ]);
    const renamed = await call(api.app, "PATCH", `${S}/${base.id}`, {
      session: b.s.fin,
      headers: ifm(1),
      body: { title: "Synthetic base renamed", assumptions: "Synthetic assumptions" },
    });
    expect([renamed.status, renamed.body.title, renamed.body.assumptions, renamed.body.version]).toEqual([
      200,
      "Synthetic base renamed",
      "Synthetic assumptions",
      2,
    ]);
    await archiveScenario(base.id, 2);
    const archived = await call(api.app, "GET", `${S}/${base.id}`, { session: b.s.tl });
    expect([archived.body.status, archived.body.archiveReason, archived.body.archivedBy]).toEqual([
      "archived",
      "Synthetic test clean-up",
      b.users.tl.id,
    ]);
    const late = await call(api.app, "PATCH", `${S}/${base.id}`, {
      session: b.s.tl,
      headers: ifm(3),
      body: { title: "Too late" },
    });
    expect([late.status, late.body.code]).toEqual([422, "record.archived"]);
    const benefit = await newBenefit();
    const lateValue = await call(api.app, "POST", `${S}/${base.id}/values`, {
      session: b.s.tl,
      body: { benefitId: benefit.id, ...period, amount: "1" },
    });
    expect([lateValue.status, lateValue.body.code]).toEqual([422, "record.archived"]);
    const fresh = await newScenario("base", b.s.fin);
    expect((await auditOf(api.db, base.id)).map((a) => a.action)).toEqual([
      "benefit_scenario.create",
      "benefit_scenario.update",
      "benefit_scenario.archive",
    ]);
    await archiveScenario(fresh.id, 1);
  });
});

describe("scenario value rules (ADR-0029 §10, §11; REQ-S08-010)", () => {
  it("CX without an approved method: SAR amount 422 unmonetised; a KPI value is fine", async () => {
    const down = await newScenario("downside");
    const cx = await newBenefit(cxBody(b));
    const sar = await call(api.app, "POST", `${S}/${down.id}/values`, {
      session: b.s.tl,
      body: { benefitId: cx.id, ...period, amount: "250000" },
    });
    expect([sar.status, sar.body.code, sar.body.detail]).toEqual([
      422,
      "benefit_value.unmonetised",
      "A non-financial benefit has no SAR value without an approved valuation method. Record its KPI value instead.",
    ]);
    const kpi = await call(api.app, "POST", `${S}/${down.id}/values`, {
      session: b.s.tl,
      body: { benefitId: cx.id, ...period, kpiValue: "42.5" },
    });
    expect([kpi.status, kpi.body.kpiValue, kpi.body.amount, kpi.body.scenarioKind]).toEqual([
      201,
      "42.500000",
      null,
      "downside",
    ]);
    // Adding a SAR amount later is checked again.
    const patched = await call(api.app, "PATCH", `${V}/${kpi.body.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { amount: "1" },
    });
    expect([patched.status, patched.body.code]).toEqual([422, "benefit_value.unmonetised"]);
    await archiveScenario(down.id, 1);
  });

  it("parent, archived benefit, period taken, period range, no value, unknown benefit", async () => {
    const up = await newScenario("upside");
    const url = `${S}/${up.id}/values`;
    const send = (body: Record<string, unknown>) => call(api.app, "POST", url, { session: b.s.tl, body });
    const parent = await newBenefit();
    await newBenefit(financialBody(b, { parentBenefitId: parent.id }));
    const p = await send({ benefitId: parent.id, ...period, amount: "1" });
    expect([p.status, p.body.code, p.body.detail]).toEqual([
      422,
      "benefit_value.parent_rollup",
      `Benefit ${parent.code} is a parent: its values come from its children.`,
    ]);
    const gone = await newBenefit();
    expect(
      (
        await call(api.app, "POST", `${B}/${gone.id}/archive`, {
          session: b.s.bo,
          headers: ifm(1),
          body: { reason: "Synthetic archive" },
        })
      ).status,
    ).toBe(200);
    const a = await send({ benefitId: gone.id, ...period, amount: "1" });
    expect([a.status, a.body.code]).toEqual([422, "benefit.archived"]);
    const leaf = await newBenefit();
    expect((await send({ benefitId: leaf.id, ...period, amount: "5" })).status).toBe(201);
    const taken = await send({ benefitId: leaf.id, periodStart: "2026-01-01", periodEnd: "2026-06-30", amount: "6" });
    expect([taken.status, taken.body.code, taken.body.detail]).toEqual([
      409,
      "benefit_value.period_taken",
      "This benefit already has a scenario value for the period starting 2026-01-01.",
    ]);
    const range = await send({ benefitId: leaf.id, periodStart: "2027-02-01", periodEnd: "2027-01-31", amount: "1" });
    expect([range.status, range.body.code]).toEqual([422, "benefit_value.period_range"]);
    const empty = await send({ benefitId: leaf.id, periodStart: "2027-01-01", periodEnd: "2027-12-31" });
    expect([empty.status, empty.body.code]).toEqual([422, "benefit_value.value_required"]);
    const unknown = await send({ benefitId: "01920000-0000-7000-8000-0000000fffff", ...period, amount: "1" });
    expect([unknown.status, unknown.body.code]).toEqual([422, "validation.reference"]);
    expect((await send({ benefitId: leaf.id, ...period, amount: 5 })).status).toBe(400);
    expect((await send({ benefitId: leaf.id, ...period, amount: "5", currency: "USD" })).status).toBe(400);
    await archiveScenario(up.id, 1);
  });

  it("update: If-Match 428/409, period moves are re-checked, audit per change, 404 for an unknown value", async () => {
    const up = await newScenario("upside");
    const leaf = await newBenefit();
    const first = await call(api.app, "POST", `${S}/${up.id}/values`, {
      session: b.s.tl,
      body: { benefitId: leaf.id, ...period, amount: "100" },
    });
    const second = await call(api.app, "POST", `${S}/${up.id}/values`, {
      session: b.s.tl,
      body: { benefitId: leaf.id, periodStart: "2027-01-01", periodEnd: "2027-12-31", amount: "200" },
    });
    const id = first.body.id as string;
    expect((await call(api.app, "PATCH", `${V}/${id}`, { session: b.s.tl, body: { amount: "1" } })).status).toBe(428);
    expect(
      (await call(api.app, "PATCH", `${V}/${id}`, { session: b.s.tl, headers: ifm(5), body: { amount: "1" } })).status,
    ).toBe(409);
    expect((await call(api.app, "PATCH", `${V}/${id}`, { session: b.s.tl, headers: ifm(1), body: {} })).status).toBe(
      400,
    );
    const clash = await call(api.app, "PATCH", `${V}/${id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { periodStart: "2027-01-01", periodEnd: "2027-12-31" },
    });
    expect([clash.status, clash.body.code]).toEqual([409, "benefit_value.period_taken"]);
    const ok = await call(api.app, "PATCH", `${V}/${id}`, {
      session: b.s.fin,
      headers: ifm(1),
      body: { amount: "150.5", note: null },
    });
    expect([ok.status, ok.body.amount, ok.body.version, ok.headers.etag, ok.body.scenarioKind]).toEqual([
      200,
      "150.5000",
      2,
      '"2"',
      "upside",
    ]);
    expect((await auditOf(api.db, id)).map((a) => a.action)).toEqual([
      "benefit_scenario_value.create",
      "benefit_scenario_value.update",
    ]);
    expect(second.status).toBe(201);
    expect(
      (
        await call(api.app, "PATCH", `${V}/01920000-0000-7000-8000-0000000fffff`, {
          session: b.s.tl,
          headers: ifm(1),
          body: { amount: "1" },
        })
      ).status,
    ).toBe(404);
    await archiveScenario(up.id, 1);
  });
});

describe("authorization (ADR-0029 §9)", () => {
  it("BO, AUD and ADM-only get 403 on every scenario mutation; reads are open to the scope, 404 outside", async () => {
    const down = await newScenario("downside");
    const leaf = await newBenefit();
    const v = await call(api.app, "POST", `${S}/${down.id}/values`, {
      session: b.s.tl,
      body: { benefitId: leaf.id, ...period, amount: "1" },
    });
    for (const session of [b.s.bo, b.s.auditor, b.s.admin]) {
      expect((await call(api.app, "POST", S, { session, body: { kind: "upside", title: "x" } })).status).toBe(403);
      expect(
        (await call(api.app, "PATCH", `${S}/${down.id}`, { session, headers: ifm(1), body: { title: "x" } })).status,
      ).toBe(403);
      expect(
        (
          await call(api.app, "POST", `${S}/${down.id}/values`, {
            session,
            body: { benefitId: leaf.id, periodStart: "2028-01-01", periodEnd: "2028-12-31", amount: "1" },
          })
        ).status,
      ).toBe(403);
      expect(
        (await call(api.app, "PATCH", `${V}/${v.body.id}`, { session, headers: ifm(1), body: { amount: "2" } })).status,
      ).toBe(403);
    }
    const list = await call(api.app, "GET", `${S}?limit=100`, { session: b.s.auditor });
    expect(list.status).toBe(200);
    const mine = (list.body.items as { id: string; values: { scenarioKind: string }[] }[]).find(
      (x) => x.id === down.id,
    )!;
    expect(mine.values.map((x) => x.scenarioKind)).toEqual(["downside"]);
    expect((await call(api.app, "GET", S, { session: b.s.outsider })).status).toBe(404);
    expect((await call(api.app, "GET", `${S}/${down.id}`, { session: b.s.outsider })).status).toBe(404);
    await archiveScenario(down.id, 1);
  });

  it("commit-time: a grant revoked while the value write waited is 403; nothing written", async () => {
    const up = await newScenario("upside");
    const leaf = await newBenefit();
    const u = await extraUser(api, w, b, "TL");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", `${S}/${up.id}/values`, {
          session: u.session,
          body: { benefitId: leaf.id, ...period, amount: "1" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const rows = await api.db
      .selectFrom("benefit_scenario_value")
      .select("id")
      .where("benefit_id", "=", leaf.id)
      .execute();
    expect(rows).toEqual([]);
    await archiveScenario(up.id, 1);
  });
});
