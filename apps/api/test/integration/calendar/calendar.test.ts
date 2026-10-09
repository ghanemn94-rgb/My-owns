// Business calendar, holidays, working days and time semantics (ADR-0025 §1-§2; REQ-S10-006, REQ-S15-008; T-DG4-BE-A)
// against a real PostgreSQL:
//  - REQ-S10-006 (A09): a 5-working-day SLA raised on the day before a configured holiday skips the holiday and the
//    weekend days; no holiday exists until configured; the default calendar is Asia/Riyadh, Sunday-Thursday;
//  - an organization created through the API gets its default calendar in the same transaction, audited;
//  - no default calendar -> the due date is Unknown (null, calendar_not_configured), never elapsed days;
//  - REQ-S15-008: businessDateOf equals the SQL p4_business_date; changing the organization's default currency
//    affects only new records;
//  - every mutation: ADM_TECH positive, AUD/others 403, validation 400/422 with the ADR texts, If-Match 428/409, one
//    audit event per changed row, and authorisation re-checked at commit time (403, audited; nothing written).
// All data is synthetic; nothing here approves anything or touches the engineering gates DG0-DG7.
import { businessDateOf } from "@mth/shared/time";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeWorkingDayDueDate } from "../../../src/modules/organization/index.ts";
import {
  auditOf,
  call,
  createOrg,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "./session-lock.ts";

let api: TestApi;
let w: World;
let admin: Session;
let auditor: Session;
let office: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  office = await signIn(api.app, w.office.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const orgCalendars = (orgId: string) => `/api/v1/organizations/${orgId}/calendars`;
const newCalendar = (orgId: string, over: Record<string, unknown> = {}, session = admin) =>
  call<Body>(api.app, "POST", orgCalendars(orgId), {
    session,
    body: { code: uniq("CAL"), nameEn: "Synthetic calendar", nameAr: "تقويم اصطناعي", ...over },
  });

describe("default calendar (ADR-0025 §1)", () => {
  it("an organization created through the API gets DEFAULT: Asia/Riyadh, Sunday-Thursday, no holiday, audited", async () => {
    const res = await call<Body>(api.app, "POST", "/api/v1/organizations", {
      session: admin,
      body: { code: uniq("ORG"), nameEn: "Synthetic org", nameAr: "مؤسسة اصطناعية" },
    });
    expect(res.status).toBe(201);
    const list = await call<Body>(api.app, "GET", orgCalendars(res.body.id), { session: admin });
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      code: "DEFAULT",
      timezone: "Asia/Riyadh",
      workweek: [7, 1, 2, 3, 4],
      isDefault: true,
      status: "active",
      version: 1,
    });
    const holidays = await call<Body>(api.app, "GET", `/api/v1/calendars/${list.body.items[0].id}/holidays`, {
      session: admin,
    });
    expect(holidays.body.items).toEqual([]); // no holiday exists until configured
    const audit = await auditOf(api.db, list.body.items[0].id);
    expect(audit.map((a) => [a.action, a.actor_type, a.actor_user_id, a.source])).toEqual([
      ["business_calendar.create", "user", w.admin.id, "api"],
    ]);
  });

  it("no active default calendar -> the working-day due date is Unknown (calendar_not_configured), never a date", async () => {
    const org = await createOrg(api.db); // inserted directly: no default calendar
    expect(await computeWorkingDayDueDate(api.db, org.id, "2026-10-08", 5)).toEqual({
      dueDate: null,
      unknownReason: "calendar_not_configured",
      calendarId: null,
      calendarVersion: null,
    });
  });
});

describe("REQ-S10-006 (A09): working-day SLA over a configured holiday", () => {
  it("skips the holiday and the weekend: Wed 2026-10-14 + 5 working days with Thu 15 a holiday -> Thu 2026-10-22", async () => {
    const org = await createOrg(api.db);
    await grant(api.db, w.grantor.id, w.admin.id, "ADM_TECH", { type: "organization", id: org.id }, org.id);
    const fresh = await signIn(api.app, w.admin.subject);
    const cal = await newCalendar(org.id, { isDefault: true }, fresh);
    expect(cal.status).toBe(201);
    const C = `/api/v1/calendars/${cal.body.id}`;
    // Before any holiday is configured: Wed 2026-10-21 (Thursday 15 is a working day).
    const before = await call<Body>(api.app, "GET", `${C}/working-days?from=2026-10-14&workingDays=5`, {
      session: fresh,
    });
    expect([before.status, before.body.dueDate]).toEqual([200, "2026-10-21"]);
    const h = await call<Body>(api.app, "POST", `${C}/holidays`, {
      session: fresh,
      body: { dateFrom: "2026-10-15", dateTo: "2026-10-15", nameEn: "Synthetic holiday", nameAr: "عطلة اصطناعية" },
    });
    expect(h.status).toBe(201);
    const after = await call<Body>(api.app, "GET", `${C}/working-days?from=2026-10-14&workingDays=5`, {
      session: fresh,
    });
    expect(after.body).toEqual({
      calendarId: cal.body.id,
      calendarVersion: 1,
      from: "2026-10-14",
      workingDays: 5,
      dueDate: "2026-10-22",
      unknownReason: null,
      skippedDates: [
        { date: "2026-10-15", reason: "holiday", holidayId: h.body.id },
        { date: "2026-10-16", reason: "weekend", holidayId: null },
        { date: "2026-10-17", reason: "weekend", holidayId: null },
      ],
    });
    // The service the approval engine uses gives the same date and pins the calendar version (ADR-0025 §1).
    expect(await computeWorkingDayDueDate(api.db, org.id, "2026-10-14", 5)).toEqual({
      dueDate: "2026-10-22",
      unknownReason: null,
      calendarId: cal.body.id,
      calendarVersion: 1,
    });
    // PB-066 example: Thursday 2026-10-08 + 5 = Thursday 2026-10-15 is now pushed by the holiday to Sunday 18.
    expect((await computeWorkingDayDueDate(api.db, org.id, "2026-10-08", 5)).dueDate).toBe("2026-10-18");
    // An archived calendar is not in use: Unknown, never a guessed date.
    const other = await newCalendar(org.id, {}, fresh);
    await call(api.app, "PATCH", `/api/v1/calendars/${other.body.id}`, {
      session: fresh,
      headers: ifm(1),
      body: { status: "archived" },
    });
    const archived = await call<Body>(
      api.app,
      "GET",
      `/api/v1/calendars/${other.body.id}/working-days?from=2026-10-14&workingDays=5`,
      { session: fresh },
    );
    expect([archived.body.dueDate, archived.body.unknownReason]).toEqual([null, "calendar_not_configured"]);
  });

  it("query validation: an impossible date and n outside 1..250 are 400 at the query parameter", async () => {
    const cal = await newCalendar(w.orgA.id);
    const C = `/api/v1/calendars/${cal.body.id}/working-days`;
    for (const q of [
      "from=2026-02-30&workingDays=5",
      "from=2026-10-14&workingDays=0",
      "from=2026-10-14&workingDays=251",
    ]) {
      const r = await call<Body>(api.app, "GET", `${C}?${q}`, { session: auditor });
      expect(r.status, q).toBe(400);
    }
  });
});

describe("calendar mutations (S-4)", () => {
  it("create: ADM_TECH 201 with one audit event; AUD, TO and a user of another organization are refused", async () => {
    const res = await newCalendar(w.orgA.id, { timezone: "Asia/Riyadh", workweek: [1, 2, 3, 4, 5] });
    expect([res.status, res.headers.etag, res.headers.location]).toEqual([
      201,
      '"1"',
      `/api/v1/calendars/${res.body.id}`,
    ]);
    expect((await auditOf(api.db, res.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["business_calendar.create", 1],
    ]);
    expect((await newCalendar(w.orgA.id, {}, auditor)).status).toBe(403);
    expect((await newCalendar(w.orgA.id, {}, office)).status).toBe(403);
    const officeB = await signIn(api.app, w.officeB.subject);
    expect((await newCalendar(w.orgA.id, {}, officeB)).status).toBe(404); // existence not disclosed
  });

  it("create: refusals carry the ADR-0025 §1 codes and English texts; nothing written", async () => {
    const code = uniq("CAL");
    expect((await newCalendar(w.orgA.id, { code })).status).toBe(201);
    const dup = await newCalendar(w.orgA.id, { code });
    expect([dup.status, dup.body.type, dup.body.code, dup.body.detail]).toEqual([
      409,
      "urn:mth:problem:duplicate",
      "calendar.code_taken",
      `A calendar with the code ${code} already exists in this organization.`,
    ]);
    for (const workweek of [[0], [8], [1, 1], [7, 7, 1]]) {
      const r = await newCalendar(w.orgA.id, { workweek });
      expect([r.status, r.body.code, r.body.detail], JSON.stringify(workweek)).toEqual([
        422,
        "calendar.workweek_invalid",
        "The workweek must list one to seven different weekdays (1 = Monday … 7 = Sunday).",
      ]);
    }
    const tz = await newCalendar(w.orgA.id, { timezone: "Mars/Olympus" });
    expect([tz.status, tz.body.code, tz.body.detail]).toEqual([
      422,
      "calendar.timezone_unknown",
      "The time zone Mars/Olympus is not a known time zone.",
    ]);
    // Free text: blank names are 400 (shared rules, S-1); unknown members are 400.
    expect((await newCalendar(w.orgA.id, { nameEn: "‏ " })).status).toBe(400);
    expect((await newCalendar(w.orgA.id, { colour: "blue" })).status).toBe(400);
  });

  it("update: If-Match 428/409, one audit event, default switch clears the previous default (audited)", async () => {
    const org = await createOrg(api.db);
    await grant(api.db, w.grantor.id, w.admin.id, "ADM_TECH", { type: "organization", id: org.id }, org.id);
    const s = await signIn(api.app, w.admin.subject);
    const a = await newCalendar(org.id, { isDefault: true }, s);
    const b = await newCalendar(org.id, {}, s);
    const B = `/api/v1/calendars/${b.body.id}`;
    expect((await call<Body>(api.app, "PATCH", B, { session: s, body: { nameEn: "x" } })).status).toBe(428);
    const stale = await call<Body>(api.app, "PATCH", B, { session: s, headers: ifm(7), body: { nameEn: "x" } });
    expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    const switched = await call<Body>(api.app, "PATCH", B, {
      session: s,
      headers: ifm(1),
      body: { isDefault: true, workweek: [1, 2, 3, 4, 5], timezone: "UTC" },
    });
    expect([switched.status, switched.body.isDefault, switched.body.version, switched.headers.etag]).toEqual([
      200,
      true,
      2,
      '"2"',
    ]);
    const aNow = await call<Body>(api.app, "GET", `/api/v1/calendars/${a.body.id}`, { session: s });
    expect([aNow.body.isDefault, aNow.body.version]).toEqual([false, 2]);
    expect((await auditOf(api.db, a.body.id)).map((x) => x.action)).toEqual([
      "business_calendar.create",
      "business_calendar.update",
    ]);
    const bAudit = await auditOf(api.db, b.body.id);
    expect(bAudit.map((x) => [x.action, x.prior_version, x.new_version])).toEqual([
      ["business_calendar.create", null, 1],
      ["business_calendar.update", 1, 2],
    ]);
    expect(Object.keys(bAudit[1]!.changes as object).sort()).toEqual(["is_default", "timezone", "workweek"]);
    // The default cannot be archived (exact ADR text); AUD is 403.
    const archive = await call<Body>(api.app, "PATCH", B, {
      session: s,
      headers: ifm(2),
      body: { status: "archived" },
    });
    expect([archive.status, archive.body.code, archive.body.detail]).toEqual([
      422,
      "calendar.default_not_archivable",
      "The default calendar cannot be archived. Make another calendar the default first.",
    ]);
    expect(
      (await call<Body>(api.app, "PATCH", B, { session: auditor, headers: ifm(2), body: { nameEn: "x" } })).status,
    ).toBe(
      404, // AUD of org A cannot read this other organization: existence not disclosed
    );
    // A stored due date is never recomputed: the version a due date pinned stays what it was.
    expect((await computeWorkingDayDueDate(api.db, org.id, "2026-10-08", 5)).calendarVersion).toBe(2);
  });

  it("holidays: create/update/remove with If-Match and audit; never deleted; the range rule has the ADR text", async () => {
    const cal = await newCalendar(w.orgA.id);
    const H = `/api/v1/calendars/${cal.body.id}/holidays`;
    const created = await call<Body>(api.app, "POST", H, {
      session: admin,
      body: { dateFrom: "2026-12-01", dateTo: "2026-12-03", nameEn: "Synthetic", nameAr: "اصطناعي" },
    });
    expect([created.status, created.headers.etag]).toEqual([201, '"1"']);
    for (const [dateFrom, dateTo] of [
      ["2026-12-03", "2026-12-01"],
      ["2026-12-01", "2027-01-01"],
    ]) {
      const r = await call<Body>(api.app, "POST", H, {
        session: admin,
        body: { dateFrom, dateTo, nameEn: "Synthetic", nameAr: "اصطناعي" },
      });
      expect([r.status, r.body.code, r.body.detail]).toEqual([
        422,
        "calendar.holiday_range_invalid",
        "A holiday ends on or after its start date and spans at most 31 days.",
      ]);
    }
    // 31 days inclusive is allowed.
    const month = await call<Body>(api.app, "POST", H, {
      session: admin,
      body: { dateFrom: "2027-01-01", dateTo: "2027-01-31", nameEn: "Synthetic", nameAr: "اصطناعي" },
    });
    expect(month.status).toBe(201);
    expect(
      (
        await call<Body>(api.app, "POST", H, {
          session: auditor,
          body: { dateFrom: "2026-12-01", dateTo: "2026-12-01", nameEn: "x", nameAr: "س" },
        })
      ).status,
    ).toBe(403);
    const one = `${H}/${created.body.id}`;
    expect((await call<Body>(api.app, "PATCH", one, { session: admin, body: { nameEn: "x" } })).status).toBe(428);
    expect(
      (await call<Body>(api.app, "PATCH", one, { session: admin, headers: ifm(3), body: { nameEn: "x" } })).status,
    ).toBe(409);
    const backwards = await call<Body>(api.app, "PATCH", one, {
      session: admin,
      headers: ifm(1),
      body: { dateTo: "2026-11-30" },
    });
    expect([backwards.status, backwards.body.code]).toEqual([422, "calendar.holiday_range_invalid"]);
    const removed = await call<Body>(api.app, "PATCH", one, {
      session: admin,
      headers: ifm(1),
      body: { status: "removed" },
    });
    expect([removed.status, removed.body.status, removed.body.version]).toEqual([200, "removed", 2]);
    expect((await auditOf(api.db, created.body.id)).map((a) => a.action)).toEqual([
      "business_calendar_holiday.create",
      "business_calendar_holiday.remove",
    ]);
    const rows = await api.db
      .selectFrom("business_calendar_holiday")
      .select("status")
      .where("id", "=", created.body.id)
      .execute();
    expect(rows).toEqual([{ status: "removed" }]); // never deleted
    // year filter and the list
    const list2027 = await call<Body>(api.app, "GET", `${H}?year=2027`, { session: auditor });
    expect(list2027.body.items.map((x: { id: string }) => x.id)).toEqual([month.body.id]);
    // A holiday of another calendar is 404 under this one.
    const otherCal = await newCalendar(w.orgA.id);
    expect(
      (
        await call<Body>(api.app, "PATCH", `/api/v1/calendars/${otherCal.body.id}/holidays/${month.body.id}`, {
          session: admin,
          headers: ifm(1),
          body: { nameEn: "x" },
        })
      ).status,
    ).toBe(404);
  });

  it("commit-time authorisation: calendar.configure revoked while the request waits -> 403 (audited); nothing written", async () => {
    const user = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, "AUD", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, user.subject);
    const code = uniq("CAL");
    // Revoke only ADM_TECH: the organization stays readable (AUD), so the refusal is 403 on reloaded grants.
    const res = await afterIdentity(
      api,
      user.id,
      () =>
        call<Body>(api.app, "POST", orgCalendars(w.orgA.id), {
          session: s,
          body: { code, nameEn: "Synthetic", nameAr: "اصطناعي" },
          contract: false,
        }),
      async () => {
        await api.owner.query(
          `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic'
             where user_id = $2 and revoked_at is null
               and role_id = (select id from role where code = 'ADM_TECH')`,
          [w.grantor.id, user.id],
        );
      },
    );
    expect(res.status).toBe(403);
    expect(await api.db.selectFrom("business_calendar").select("id").where("code", "=", code).execute()).toEqual([]);
    const denied = await api.db
      .selectFrom("audit_event")
      .select("action")
      .where("actor_user_id", "=", user.id)
      .where("action", "=", "authorization.denied")
      .execute();
    expect(denied).toHaveLength(1);
    // A fully revoked caller (no read right left) is 403 as well, never a silent success.
    const user2 = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user2.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s2 = await signIn(api.app, user2.subject);
    const cal = await newCalendar(w.orgA.id);
    const res2 = await afterIdentity(
      api,
      user2.id,
      () =>
        call<Body>(api.app, "PATCH", `/api/v1/calendars/${cal.body.id}`, {
          session: s2,
          headers: ifm(1),
          body: { nameEn: "Never" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, user2.id),
    );
    expect(res2.status).toBe(403);
    const after = await call<Body>(api.app, "GET", `/api/v1/calendars/${cal.body.id}`, { session: admin });
    expect([after.body.nameEn, after.body.version]).toEqual(["Synthetic calendar", 1]);
  });
});

describe("holiday mutations and AUD on updates (S-4)", () => {
  it("AUD of the same organization is 403 on calendar and holiday updates; nothing written", async () => {
    const cal = await newCalendar(w.orgA.id);
    const C = `/api/v1/calendars/${cal.body.id}`;
    const h = await call<Body>(api.app, "POST", `${C}/holidays`, {
      session: admin,
      body: { dateFrom: "2026-11-01", dateTo: "2026-11-01", nameEn: "Synthetic", nameAr: "اصطناعي" },
    });
    expect(
      (await call<Body>(api.app, "PATCH", C, { session: auditor, headers: ifm(1), body: { nameEn: "x" } })).status,
    ).toBe(403);
    expect(
      (
        await call<Body>(api.app, "PATCH", `${C}/holidays/${h.body.id}`, {
          session: auditor,
          headers: ifm(1),
          body: { status: "removed" },
        })
      ).status,
    ).toBe(403);
    expect((await auditOf(api.db, cal.body.id)).map((a) => a.action)).toEqual(["business_calendar.create"]);
    expect((await auditOf(api.db, h.body.id)).map((a) => a.action)).toEqual(["business_calendar_holiday.create"]);
  });

  it("commit-time authorisation on holiday create and update: revoked while waiting -> 403; nothing written", async () => {
    const cal = await newCalendar(w.orgA.id);
    const H = `/api/v1/calendars/${cal.body.id}/holidays`;
    const existing = await call<Body>(api.app, "POST", H, {
      session: admin,
      body: { dateFrom: "2026-11-05", dateTo: "2026-11-05", nameEn: "Synthetic", nameAr: "اصطناعي" },
    });
    for (const attempt of ["create", "update"] as const) {
      const user = await createUser(api.db, w.orgA.id);
      await grant(api.db, w.grantor.id, user.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
      const s = await signIn(api.app, user.subject);
      const res = await afterIdentity(
        api,
        user.id,
        () =>
          attempt === "create"
            ? call<Body>(api.app, "POST", H, {
                session: s,
                body: { dateFrom: "2026-11-09", dateTo: "2026-11-09", nameEn: "Never", nameAr: "أبداً" },
                contract: false,
              })
            : call<Body>(api.app, "PATCH", `${H}/${existing.body.id}`, {
                session: s,
                headers: ifm(1),
                body: { nameEn: "Never" },
                contract: false,
              }),
        () => revokeAll(api, w.grantor.id, user.id),
      );
      expect(res.status, attempt).toBe(403);
    }
    const rows = await api.db
      .selectFrom("business_calendar_holiday")
      .select(["name_en", "version"])
      .where("calendar_id", "=", cal.body.id)
      .execute();
    expect(rows).toEqual([{ name_en: "Synthetic", version: 1 }]);
  });
});

describe("REQ-S15-008: time semantics and per-row currency", () => {
  it("businessDateOf equals SQL p4_business_date for the ADR-0025 §2 instants", async () => {
    for (const at of ["2026-11-02T20:30:00Z", "2026-11-01T21:30:00Z", "2026-10-31T23:59:59Z", "2026-11-01T00:00:00Z"]) {
      const r = await sql<{ d: string }>`select p4_business_date(${at}::timestamptz, 'Asia/Riyadh') as d`.execute(
        api.db,
      );
      expect([at, r.rows[0]!.d]).toEqual([at, businessDateOf(at, "Asia/Riyadh")]);
    }
    // The REQ-S15-008 example: an entry at 2026-11-02 23:30 Riyadh has business date 2026-11-02 and UTC instant 20:30Z.
    expect(businessDateOf("2026-11-02T20:30:00Z", "Asia/Riyadh")).toBe("2026-11-02");
  });

  it("changing the organization's default currency affects only new records", async () => {
    const t1 = await call<Body>(api.app, "POST", "/api/v1/transformations", {
      session: office,
      body: { businessUnitId: w.a1, name: "Synthetic before", mode: "end_to_end" },
    });
    expect([t1.status, t1.body.currency]).toEqual([201, "SAR"]);
    const org = await call<Body>(api.app, "GET", `/api/v1/organizations/${w.orgA.id}`, { session: admin });
    const changed = await call<Body>(api.app, "PATCH", `/api/v1/organizations/${w.orgA.id}`, {
      session: admin,
      headers: ifm(org.body.version),
      body: { defaultCurrency: "USD" },
    });
    expect(changed.status).toBe(200);
    try {
      const old = await call<Body>(api.app, "GET", `/api/v1/transformations/${t1.body.id}`, { session: office });
      expect(old.body.currency).toBe("SAR");
      const t2 = await call<Body>(api.app, "POST", "/api/v1/transformations", {
        session: office,
        body: { businessUnitId: w.a1, name: "Synthetic after", mode: "end_to_end" },
      });
      expect(t2.body.currency).toBe("USD");
    } finally {
      await call<Body>(api.app, "PATCH", `/api/v1/organizations/${w.orgA.id}`, {
        session: admin,
        headers: ifm(changed.body.version),
        body: { defaultCurrency: "SAR" },
      });
    }
  });
});
