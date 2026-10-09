// Execution tracking per initiative (T-DG4-BE-E; ADR-0031 §7, §9, §13; REQ-S09-007 "Execution tracking fields per
// initiative with variance display"; A05 "budget/actual/forecast use decimal SAR; forecast slip vs approved date is
// shown in working days"). Proves, against the run's disposable PostgreSQL:
//  - totals are exact decimals per currency (0.1 + 0.2 = 0.3, never 0.30000000000000004), never converted;
//  - a missing amount gives an `unknown` total with the known part and the missing count, never 0; an initiative without
//    lines gives `budgetUnknownReason: "no_budget_lines"` and no total; archived lines are not counted;
//  - the slip is in WORKING days on the organization's default calendar: +5 / +4 (an administered holiday) / -5 / 0 for
//    the ADR-0031 §7 examples, beside the unchanged DG3 calendar-day variance (7); without a calendar or a date it is
//    Unknown with its reason, never a calendar-day value;
//  - deliverable acceptance, FTE demand against capacity (Unknown without a capacity row), dependencies (incoming and
//    outgoing T08 rows), linked decisions and critical-path membership (null when not computable) are read from their
//    canonical records;
//  - AUD reads it; ADM-only users and outsiders get 404.
// All data is SYNTHETIC (dates, holidays, amounts). Nothing here is a business approval; nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  addHoliday,
  ensureDefaultCalendar,
  insertAudited,
  insertDemand,
  insertInitiative,
  insertMilestone,
  linkDecision,
  newDecision,
  newDependency,
  seedExecutionWorld,
  setDuration,
  type Caller,
  type ExecWorld,
} from "./execution-fixtures.ts";

let api: TestApi;
let w: World;
let x: ExecWorld;
let send: Caller;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await seedExecutionWorld(api, w);
  send = (m, u, o) => call(api.app, m, u, o);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const execution = async (initiativeId: string, session = x.s.tl) => {
  const r = await call(api.app, "GET", `/api/v1/initiatives/${initiativeId}/execution`, { session });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const line = async (initiativeId: string, body: Record<string, unknown>) => {
  const r = await call(api.app, "POST", `/api/v1/initiatives/${initiativeId}/budget-lines`, { session: x.s.fin, body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string };
};

describe("budget totals: decimal, per currency, Unknown never 0", () => {
  it("an initiative without lines: budgetLineCount 0, budgetUnknownReason no_budget_lines, no total", async () => {
    const ini = await insertInitiative(api.db, x, "INI-10");
    const e = await execution(ini);
    expect([e.budgetLineCount, e.budgetUnknownReason, e.budgetTotals]).toEqual([0, "no_budget_lines", []]);
  });

  it("0.1 + 0.2 = 0.3 exactly; variances are forecast - budget and actual - budget", async () => {
    const ini = await insertInitiative(api.db, x, "INI-11");
    await line(ini, { label: "Synthetic A", budgetAmount: "0.1", actualAmount: "0.05", forecastAmount: "0.2" });
    await line(ini, { label: "Synthetic B", budgetAmount: "0.2", actualAmount: "0.3", forecastAmount: "0.15" });
    const e = await execution(ini);
    expect([e.budgetLineCount, e.budgetUnknownReason]).toEqual([2, null]);
    expect(e.budgetTotals).toEqual([
      {
        currency: "SAR",
        budget: { status: "known", amount: "0.3000", knownAmount: "0.3000", missingCount: 0, reason: null },
        actual: { status: "known", amount: "0.3500", knownAmount: "0.3500", missingCount: 0, reason: null },
        forecast: { status: "known", amount: "0.3500", knownAmount: "0.3500", missingCount: 0, reason: null },
        forecastVariance: { status: "known", amount: "0.0500", knownAmount: "0.0500", missingCount: 0, reason: null },
        actualVariance: { status: "known", amount: "0.0500", knownAmount: "0.0500", missingCount: 0, reason: null },
      },
    ]);
  });

  it("a missing amount makes its total unknown (known part + missing count), never 0; a negative variance stays exact", async () => {
    const ini = await insertInitiative(api.db, x, "INI-12");
    await line(ini, { label: "Synthetic A", budgetAmount: "100000", actualAmount: null, forecastAmount: "90000.5" });
    await line(ini, { label: "Synthetic B", budgetAmount: "250", actualAmount: null, forecastAmount: null });
    const t = (await execution(ini)).budgetTotals[0];
    expect(t.budget).toEqual({
      status: "known",
      amount: "100250.0000",
      knownAmount: "100250.0000",
      missingCount: 0,
      reason: null,
    });
    expect(t.actual).toEqual({
      status: "unknown",
      amount: null,
      knownAmount: null,
      missingCount: 2,
      reason: "missing_amounts",
    });
    expect(t.forecast).toEqual({
      status: "unknown",
      amount: null,
      knownAmount: "90000.5000",
      missingCount: 1,
      reason: "missing_amounts",
    });
    expect(t.forecastVariance).toEqual({
      status: "unknown",
      amount: null,
      knownAmount: "-9999.5000",
      missingCount: 1,
      reason: "missing_amounts",
    });
    expect(t.actualVariance.status).toBe("unknown");
  });

  it("lines in two currencies are totalled separately, never converted; archived lines are not counted", async () => {
    const ini = await insertInitiative(api.db, x, "INI-13");
    await line(ini, { label: "Synthetic SAR", budgetAmount: "10" });
    await api.owner.query("update organization set default_currency = 'USD' where id = $1", [w.orgA.id]);
    try {
      await line(ini, { label: "Synthetic USD", budgetAmount: "7" });
    } finally {
      await api.owner.query("update organization set default_currency = 'SAR' where id = $1", [w.orgA.id]);
    }
    const gone = await line(ini, { label: "Synthetic archived", budgetAmount: "1000" });
    const arch = await call(api.app, "POST", `/api/v1/budget-lines/${gone.id}/archive`, {
      session: x.s.tl,
      headers: ifm(1),
      body: { reason: "Synthetic: cancelled spend" },
    });
    expect(arch.status).toBe(200);
    const e = await execution(ini);
    expect(e.budgetLineCount).toBe(2);
    expect(
      e.budgetTotals.map((t: { currency: string; budget: { amount: string } }) => [t.currency, t.budget.amount]),
    ).toEqual([
      ["SAR", "10.0000"],
      ["USD", "7.0000"],
    ]);
  });
});

describe("milestones: the slip in working days (ADR-0031 §7)", () => {
  let ini: string;
  let ids: Record<string, string>;
  beforeAll(async () => {
    ini = await insertInitiative(api.db, x, "INI-20");
    ids = {
      late: await insertMilestone(api.db, x, ini, "2026-10-08", "2026-10-15", "Synthetic late"),
      early: await insertMilestone(api.db, x, ini, "2026-10-15", "2026-10-08", "Synthetic early"),
      same: await insertMilestone(api.db, x, ini, "2026-10-08", "2026-10-08", "Synthetic on time"),
      noApproved: await insertMilestone(api.db, x, ini, null, "2026-10-15", "Synthetic unapproved"),
      noForecast: await insertMilestone(api.db, x, ini, "2026-10-08", null, "Synthetic unforecast"),
    };
  });
  const slips = async () => {
    const e = await execution(ini);
    return {
      calendarId: e.calendarId,
      by: Object.fromEntries(
        e.milestones.map(
          (m: { milestoneId: string; slipWorkingDays: unknown; calendarVarianceDays: number | null }) => [
            Object.entries(ids).find(([, id]) => id === m.milestoneId)![0],
            [m.slipWorkingDays, m.calendarVarianceDays],
          ],
        ),
      ) as Record<"late" | "early" | "same" | "noApproved" | "noForecast", unknown>,
    };
  };

  it("without an active default calendar the slip is Unknown (calendar_not_configured), never calendar days", async () => {
    const r = await slips();
    expect(r.calendarId).toBeNull();
    expect(r.by.late).toEqual([{ status: "unknown", value: null, reason: "calendar_not_configured" }, 7]);
    expect(r.by.same).toEqual([{ status: "unknown", value: null, reason: "calendar_not_configured" }, 0]);
  });

  it("on the default Sunday-Thursday calendar: +5 (calendar 7), -5, 0; a missing date is Unknown with its reason", async () => {
    const calendarId = await ensureDefaultCalendar(api, w, send);
    const r = await slips();
    expect(r.calendarId).toBe(calendarId);
    expect(r.by.late).toEqual([{ status: "known", value: 5, reason: null }, 7]);
    expect(r.by.early).toEqual([{ status: "known", value: -5, reason: null }, -7]);
    expect(r.by.same).toEqual([{ status: "known", value: 0, reason: null }, 0]);
    expect(r.by.noApproved).toEqual([{ status: "unknown", value: null, reason: "approved_date_missing" }, null]);
    expect(r.by.noForecast).toEqual([{ status: "unknown", value: null, reason: "forecast_date_missing" }, null]);
  });

  it("an administered holiday on Sun 2026-10-11 makes the same slip +4 (and -4 early); recomputed on read", async () => {
    const calendarId = await ensureDefaultCalendar(api, w, send);
    await addHoliday(api, w, calendarId, "2026-10-11");
    const r = await slips();
    expect(r.by.late).toEqual([{ status: "known", value: 4, reason: null }, 7]);
    expect(r.by.early).toEqual([{ status: "known", value: -4, reason: null }, -7]);
  });
});

describe("the other execution fields, from their canonical records", () => {
  it("deliverable acceptance, FTE demand vs capacity, dependencies, decisions and critical-path membership", async () => {
    const a = await insertInitiative(api.db, x, "INI-30");
    const b = await insertInitiative(api.db, x, "INI-31");
    const deliverableId = await insertAudited(api.db, x, "deliverable", {
      initiative_id: a,
      title: "Synthetic deliverable",
    });
    const known = await insertDemand(api.db, x, a, "2026-11-01", "1.5", "3");
    const unknown = await insertDemand(api.db, x, a, "2026-12-01", "0.25", null);
    const out = await newDependency(send, x, a, b);
    const decisionId = await newDecision(send, x);
    await linkDecision(api.db, x, a, decisionId);

    const e = await execution(a);
    expect(e.deliverables).toEqual([
      { deliverableId, title: "Synthetic deliverable", dueDate: null, acceptanceStatus: "pending" },
    ]);
    expect(e.demand).toEqual([
      {
        resourceDemandId: known.demandId,
        resourceRoleId: known.roleId,
        periodMonth: "2026-11-01",
        demandFte: "1.50",
        status: "planned",
        availableFte: "3.00",
        capacityStatus: "known",
      },
      {
        resourceDemandId: unknown.demandId,
        resourceRoleId: unknown.roleId,
        periodMonth: "2026-12-01",
        demandFte: "0.25",
        status: "planned",
        availableFte: null,
        capacityStatus: "unknown",
      },
    ]);
    expect(e.dependencies).toEqual([
      { dependencyId: out.id, code: out.code, direction: "outgoing", status: "open", neededBy: null, impact: null },
    ]);
    expect((await execution(b)).dependencies[0]).toMatchObject({ dependencyId: out.id, direction: "incoming" });
    expect(e.decisions).toEqual([
      {
        decisionId,
        code: expect.stringMatching(/^D-[0-9]+$/),
        kind: "design",
        status: "open",
        title: "Synthetic design decision",
      },
    ]);
    // Durations are missing in this transformation: the critical path is not computable, so membership is null.
    expect(e.onCriticalPath).toBeNull();
  });

  it("onCriticalPath is true or false only once every duration is known (a new transformation, one network)", async () => {
    const y = await seedExecutionWorld(api, w);
    const p = await insertInitiative(api.db, y, "INI-01");
    const q = await insertInitiative(api.db, y, "INI-02");
    const r = await insertInitiative(api.db, y, "INI-03");
    await newDependency(send, y, p, q);
    await setDuration(send, y, p, 5);
    await setDuration(send, y, q, 10);
    const view = async (id: string) =>
      (await call(api.app, "GET", `/api/v1/initiatives/${id}/execution`, { session: y.s.auditor })).body.onCriticalPath;
    expect(await view(p)).toBeNull(); // INI-03 has no duration yet
    await setDuration(send, y, r, 3);
    expect([await view(p), await view(q), await view(r)]).toEqual([true, true, false]);
  });

  it("AUD reads it; ADM-only users and outsiders get 404; an unknown initiative is 404", async () => {
    const ini = await insertInitiative(api.db, x, "INI-40");
    await execution(ini, x.s.auditor);
    for (const s of [x.s.admin, x.s.outsider])
      expect((await call(api.app, "GET", `/api/v1/initiatives/${ini}/execution`, { session: s })).status).toBe(404);
    expect(
      (
        await call(api.app, "GET", "/api/v1/initiatives/01900000-0000-7000-8000-000000000000/execution", {
          session: x.s.tl,
        })
      ).status,
    ).toBe(404);
  });
});
