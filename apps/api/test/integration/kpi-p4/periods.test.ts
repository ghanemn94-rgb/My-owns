// Reporting periods against a real PostgreSQL (T-DG4-KBE-C; ADR-0027 §3, §11-§13; REQ-S07-003, REQ-S07-005):
//  - create (TO, reporting_period.manage at the organization), read and list (organization.read), open and close;
//  - the exact ADR-0027 §13 refusals: label_taken 409, overlap, weeks_invalid, range_invalid, status_step;
//  - a 4-week and a 5-week period store their week counts (REQ-S07-005: the basis of "Not comparable");
//  - every mutation: If-Match 428/409, one audit event, AUD 403, ADM-only 403, nothing written on a refusal.
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
import { ifMatch, monthlyPeriod, type Body } from "./kbe-c-fixtures.ts";

let api: TestApi;
let w: World;
let to: Session;
let aud: Session;
let adm: Session;
let base: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  to = await signIn(api.app, w.office.subject);
  aud = await signIn(api.app, w.auditor.subject);
  adm = await signIn(api.app, w.admin.subject);
  base = `/api/v1/organizations/${w.orgA.id}/reporting-periods`;
}, 60_000);
afterAll(() => api.close());

const post = (body: object, session = to) => call<Body>(api.app, "POST", base, { session, body });
const problem = (res: { status: number; body: Body }, status: number, code: string, detail?: string) => {
  expect([res.status, res.body.code], JSON.stringify(res.body)).toEqual([status, code]);
  if (detail !== undefined) expect(res.body.detail).toBe(detail);
};

describe("reporting periods (ADR-0027 §3)", () => {
  it("creates a scheduled period, reads it, lists it, opens and closes it with one audit event each", async () => {
    const created = await post({
      frequency: "quarterly",
      periodLabel: "2042-Q1",
      periodStart: "2042-01-01",
      periodEnd: "2042-03-31",
      updateDueDate: "2042-04-10",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.headers.location).toBe(`${base}/${created.body.id}`);
    expect(created.headers.etag).toBe('"1"');
    expect(created.body).toMatchObject({
      frequency: "quarterly",
      periodLabel: "2042-Q1",
      lengthDays: 90,
      basis: "calendar",
      weekCount: null,
      status: "scheduled",
      openedAt: null,
      version: 1,
    });
    const id = created.body.id;
    expect((await call<Body>(api.app, "GET", `${base}/${id}`, { session: aud })).body.periodLabel).toBe("2042-Q1");
    const list = await call<Body>(api.app, "GET", `${base}?frequency=quarterly&status=scheduled`, { session: aud });
    expect(list.body.items.map((p: Body) => p.id)).toContain(id);

    expect((await call(api.app, "POST", `${base}/${id}/open`, { session: to })).status).toBe(428);
    expect((await call(api.app, "POST", `${base}/${id}/open`, { session: to, headers: ifMatch(7) })).status).toBe(409);
    expect((await call(api.app, "POST", `${base}/${id}/open`, { session: aud, headers: ifMatch(1) })).status).toBe(403);
    expect((await call(api.app, "POST", `${base}/${id}/open`, { session: adm, headers: ifMatch(1) })).status).toBe(403);
    problem(
      await call<Body>(api.app, "POST", `${base}/${id}/close`, { session: to, headers: ifMatch(1) }),
      422,
      "reporting_period.status_step",
      "A reporting period moves from scheduled to open to closed, and a closed period stays closed.",
    );
    const opened = await call<Body>(api.app, "POST", `${base}/${id}/open`, { session: to, headers: ifMatch(1) });
    expect([opened.status, opened.body.status, opened.body.version]).toEqual([200, "open", 2]);
    expect(opened.body.openedAt).not.toBeNull();
    const closed = await call<Body>(api.app, "POST", `${base}/${id}/close`, { session: to, headers: ifMatch(2) });
    expect([closed.status, closed.body.status]).toEqual([200, "closed"]);
    problem(
      await call<Body>(api.app, "POST", `${base}/${id}/open`, { session: to, headers: ifMatch(3) }),
      422,
      "reporting_period.status_step",
    );
    expect((await auditOf(api.db, id)).map((e) => e.action)).toEqual([
      "reporting_period.create",
      "reporting_period.open",
      "reporting_period.close",
    ]);
  });

  it("refuses a taken label (409), an overlap, invalid weeks and an invalid range with the exact texts", async () => {
    const p = await monthlyPeriod(api, w, { scheduled: true });
    problem(
      await post({ frequency: "monthly", periodLabel: p.label, periodStart: "2049-01-01", periodEnd: "2049-01-31" }),
      409,
      "reporting_period.label_taken",
      `A monthly reporting period ${p.label} already exists.`,
    );
    problem(
      await post({ frequency: "monthly", periodLabel: "OVERLAP-1", periodStart: p.start, periodEnd: p.start }),
      422,
      "reporting_period.overlap",
      `The period overlaps the monthly reporting period ${p.label}.`,
    );
    problem(
      await post({
        frequency: "weekly",
        periodLabel: "W-BAD",
        periodStart: "2043-01-05",
        periodEnd: "2043-02-05",
        basis: "weeks",
        weekCount: 4,
      }),
      422,
      "reporting_period.weeks_invalid",
      "A week-based period lasts exactly its number of weeks times seven days.",
    );
    problem(
      await post({ frequency: "annual", periodLabel: "R-BAD", periodStart: "2044-02-01", periodEnd: "2044-01-01" }),
      422,
      "reporting_period.range_invalid",
      "A reporting period ends on or after its start and lasts at most 367 days.",
    );
    problem(
      await post({ frequency: "annual", periodLabel: "R-LONG", periodStart: "2044-01-01", periodEnd: "2045-01-03" }),
      422,
      "reporting_period.range_invalid",
    );
    // Body validation: a bad label pattern and a JSON number for a date are 400.
    expect(
      (await post({ frequency: "monthly", periodLabel: " x", periodStart: "2050-01-01", periodEnd: "2050-01-31" }))
        .status,
    ).toBe(400);
  });

  it("stores the week counts of a 4-week and a 5-week period (the basis of Not comparable, REQ-S07-005)", async () => {
    const four = await post({
      frequency: "weekly",
      periodLabel: "2043-P01",
      periodStart: "2043-01-05",
      periodEnd: "2043-02-01",
      basis: "weeks",
      weekCount: 4,
    });
    const five = await post({
      frequency: "weekly",
      periodLabel: "2043-P02",
      periodStart: "2043-02-02",
      periodEnd: "2043-03-08",
      basis: "weeks",
      weekCount: 5,
    });
    expect([four.status, four.body.weekCount, four.body.lengthDays]).toEqual([201, 4, 28]);
    expect([five.status, five.body.weekCount, five.body.lengthDays]).toEqual([201, 5, 35]);
  });

  it("only reporting_period.manage holders create: AUD and ADM-only 403, outsider 404, nothing written", async () => {
    const body = { frequency: "daily", periodLabel: "D-1", periodStart: "2046-01-01", periodEnd: "2046-01-01" };
    expect((await post(body, aud)).status).toBe(403);
    expect((await post(body, adm)).status).toBe(403);
    const outsider = await signIn(api.app, w.officeB.subject);
    expect((await post(body, outsider)).status).toBe(404);
    const rows = await api.db
      .selectFrom("reporting_period")
      .select("id")
      .where("organization_id", "=", w.orgA.id)
      .where("period_label", "=", "D-1")
      .execute();
    expect(rows).toEqual([]);
  });
});
