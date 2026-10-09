// Business calendars and holidays (OpenAPI tag "calendar"; ADR-0025 §1; REQ-S10-006; T-DG4-BE-A):
//   GET   /organizations/{organizationId}/calendars      list (organization.read)
//   POST  /organizations/{organizationId}/calendars      create (calendar.configure; ADM_TECH)
//   GET   /calendars/{calendarId}                        read (organization.read)
//   PATCH /calendars/{calendarId}                        names, timezone, workweek, default flag, status (If-Match)
//   GET   /calendars/{calendarId}/holidays               administered holidays by start date (organization.read)
//   POST  /calendars/{calendarId}/holidays               add a holiday (inclusive range, at most 31 days)
//   PATCH /calendars/{calendarId}/holidays/{holidayId}   change or remove (status removed; never deleted; If-Match)
//   GET   /calendars/{calendarId}/working-days           the n-th working day strictly after a business date
//
// No holiday is hard-coded or seeded: a holiday exists only once an administrator adds one (M0196). Working days are
// computed by the pure `addWorkingDays` (@mth/shared/time), never as elapsed calendar days; a due date that cannot be
// computed is Unknown (null with reason calendar_not_configured). Stored due dates are never recomputed when a calendar
// changes: a record that stores a due date also stores the calendar id and version it was computed with.
//
// Every mutation: the organization read gate (404 when the caller cannot read it), then calendar.configure decided
// again on grants reloaded inside the write transaction (commit-time authorisation; a revoked right is 403, audited),
// zod validation, If-Match on updates (428/409; creates are version 1), and one audit event per changed row in the same
// transaction. The `0028` guards (version step, audit at COMMIT, workweek, timezone, one default, holiday range) are
// the last line of defence and map to the same problems (platform/db-errors.ts).
import {
  diffFields,
  sql,
  type BusinessCalendarHolidayRow,
  type BusinessCalendarRow,
  type DbOrTx,
  type Tx,
} from "@mth/db";
import {
  businessCalendarCreate,
  businessCalendarUpdate,
  businessDate,
  calendarHolidayCreate,
  calendarHolidayUpdate,
  uuid,
  type BusinessCalendar,
  type CalendarHoliday,
  type WorkingDayComputation,
} from "@mth/shared/schemas";
import {
  addWorkingDays,
  dateOfEpochDay,
  epochDayOf,
  isKnownTimeZone,
  isValidWorkweek,
  MAX_LOOKAHEAD_DAYS,
  type UnknownDueReason,
} from "@mth/shared/time";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  commitTimeDenial,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireRead,
  targetFor,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";

const JSON_BODY = ["application/json"] as const;
const CONFIGURE = "calendar.configure" as const;
const READ = "organization.read" as const;

/** Default workweek of a new calendar: Sunday-Thursday (ISO weekdays; ADR-0025 §1). */
export const DEFAULT_WORKWEEK: readonly number[] = [7, 1, 2, 3, 4];

// Requests (zod mirrors in @mth/shared/schemas). The contract's TimeZone is a plain string and its request workweek a
// plain integer array, so an unknown zone or an invalid workweek is a 422 business rule (below), never a 400.
const calendarCreate = businessCalendarCreate;
const calendarUpdate = businessCalendarUpdate;

const orgParams = z.strictObject({ organizationId: uuid });
const calendarParams = z.strictObject({ calendarId: uuid });
const holidayParams = z.strictObject({ calendarId: uuid, holidayId: uuid });
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
const holidayQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
const workingDaysQuery = z.strictObject({
  from: businessDate,
  workingDays: z.coerce.number().int().min(1).max(250),
});

// ------------------------------------------------------------------------------------------------ refusals (ADR-0025 §1)

const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });
export const calendarRefusals = {
  workweekInvalid: () =>
    rule(
      "calendar.workweek_invalid",
      "The workweek must list one to seven different weekdays (1 = Monday … 7 = Sunday).",
      "/workweek",
    ),
  timezoneUnknown: (timezone: string) =>
    rule("calendar.timezone_unknown", `The time zone ${timezone} is not a known time zone.`, "/timezone"),
  codeTaken: (code: string) =>
    problems.duplicate("calendar.code_taken", `A calendar with the code ${code} already exists in this organization.`),
  holidayRangeInvalid: () =>
    rule(
      "calendar.holiday_range_invalid",
      "A holiday ends on or after its start date and spans at most 31 days.",
      "/dateTo",
    ),
  defaultNotArchivable: () =>
    rule(
      "calendar.default_not_archivable",
      "The default calendar cannot be archived. Make another calendar the default first.",
      "/status",
    ),
} as const;

// ------------------------------------------------------------------------------------------------ mapping

const CALENDAR_AUDIT_FIELDS = ["code", "name_en", "name_ar", "timezone", "workweek", "is_default", "status"] as const;
const HOLIDAY_AUDIT_FIELDS = ["date_from", "date_to", "name_en", "name_ar", "status"] as const;

export const toBusinessCalendar = (r: BusinessCalendarRow): BusinessCalendar => ({
  id: r.id,
  organizationId: r.organization_id,
  code: r.code,
  nameEn: r.name_en,
  nameAr: r.name_ar,
  timezone: r.timezone,
  workweek: r.workweek.map(Number),
  isDefault: r.is_default,
  status: r.status as BusinessCalendar["status"],
  version: r.version,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export const toCalendarHoliday = (r: BusinessCalendarHolidayRow): CalendarHoliday => ({
  id: r.id,
  calendarId: r.calendar_id,
  dateFrom: r.date_from,
  dateTo: r.date_to,
  nameEn: r.name_en,
  nameAr: r.name_ar,
  status: r.status as CalendarHoliday["status"],
  version: r.version,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

/** Audit diff that compares the workweek array by value (diffFields compares with !==). */
function calendarChanges(before: Partial<BusinessCalendarRow>, after: BusinessCalendarRow) {
  const norm = (r: Partial<BusinessCalendarRow>) =>
    ({ ...r, workweek: r.workweek === undefined ? undefined : r.workweek.map(Number).join(",") }) as Record<
      string,
      unknown
    >;
  return diffFields(norm(before), norm(after), [...CALENDAR_AUDIT_FIELDS]);
}

// ------------------------------------------------------------------------------------------------ rules

function checkWorkweek(workweek: readonly number[] | undefined): void {
  if (workweek !== undefined && !isValidWorkweek(workweek)) throw calendarRefusals.workweekInvalid();
}
function checkTimezone(timezone: string | undefined): void {
  if (timezone !== undefined && !isKnownTimeZone(timezone)) throw calendarRefusals.timezoneUnknown(timezone);
}
/** Inclusive range, end on or after start, at most 31 days (`business_calendar_holiday_range`). */
export function holidayRangeValid(dateFrom: string, dateTo: string): boolean {
  const from = epochDayOf(dateFrom);
  const to = epochDayOf(dateTo);
  return from !== null && to !== null && to >= from && to - from <= 30;
}

// ------------------------------------------------------------------------------------------------ access

/**
 * The write gates of a calendar mutation: the caller must read the organization (else 404, existence not disclosed),
 * then hold calendar.configure on it, decided on grants reloaded inside `tx` (commit-time authorisation; 403 with the
 * denial attached, so the failed-mutation audit records it).
 */
async function requireConfigure(tx: Tx, request: FastifyRequest, organizationId: string): Promise<string> {
  const target = await requireRead(tx, principalOf(request), READ, { type: "organization", id: organizationId });
  const fresh = await refreshPrincipal(tx, request);
  try {
    await requireAction(tx, fresh, CONFIGURE, target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  return fresh.userId!;
}

/** The calendar, readable by the caller (organization.read on its organization), or 404. */
async function readableCalendar(
  db: DbOrTx,
  request: FastifyRequest,
  calendarId: string,
  lock = false,
): Promise<BusinessCalendarRow> {
  let q = db.selectFrom("business_calendar").selectAll().where("id", "=", calendarId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  await requireRead(
    db,
    principalOf(request),
    READ,
    await targetFor(db, "organization", { organizationId: row.organization_id }),
  );
  return row;
}

/** Serialises default switches of one organization (the row lock `p4_ensure_default_calendar` also takes). */
async function lockOrganizationCalendars(tx: Tx, organizationId: string): Promise<void> {
  await sql`SELECT id FROM organization WHERE id = ${organizationId}::uuid FOR UPDATE`.execute(tx);
}

/** Clears the current default (if another calendar holds it), audited as its own update. */
async function clearDefault(
  tx: Tx,
  request: FastifyRequest,
  organizationId: string,
  keepId: string | null,
  userId: string,
) {
  const current = await tx
    .selectFrom("business_calendar")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .forUpdate()
    .executeTakeFirst();
  if (!current || current.id === keepId) return;
  const updated = await tx
    .updateTable("business_calendar")
    .set({ is_default: false, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: userId })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "business_calendar.update",
    recordType: "business_calendar",
    recordId: current.id,
    organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: calendarChanges(current, updated),
    reason: "Another calendar became the default",
  });
}

// ------------------------------------------------------------------------------------------------ working days

/** The calendar data `addWorkingDays` needs, with the holidays that can matter after `from`. */
async function workingCalendarOf(db: DbOrTx, calendar: BusinessCalendarRow, from: string) {
  const start = epochDayOf(from)!;
  const holidays = await db
    .selectFrom("business_calendar_holiday")
    .select(["id", "date_from", "date_to"])
    .where("calendar_id", "=", calendar.id)
    .where("status", "=", "active")
    .where("date_to", ">", from)
    .where("date_from", "<=", dateOfEpochDay(start + MAX_LOOKAHEAD_DAYS))
    .orderBy("date_from")
    .execute();
  return {
    workweek: calendar.workweek.map(Number),
    holidays: holidays.map((h) => ({ id: h.id, dateFrom: h.date_from, dateTo: h.date_to })),
  };
}

export interface WorkingDayDueDate {
  /** The due date, or null (Unknown) with `unknownReason`. Never a date counted in elapsed calendar days. */
  readonly dueDate: string | null;
  readonly unknownReason: UnknownDueReason | null;
  /** The calendar it was computed with (stored next to a due date; ADR-0025 §1), null when none is configured. */
  readonly calendarId: string | null;
  readonly calendarVersion: number | null;
}

/**
 * The n-th working day strictly after the business date `raisedOn` in the organization's active default calendar
 * (ADR-0025 §1). No active default calendar -> Unknown with reason `calendar_not_configured`. For the approval
 * service (BE-B) and the T11 SLA computation (BE-C); pass the write transaction to read a consistent calendar.
 */
export async function computeWorkingDayDueDate(
  db: DbOrTx,
  organizationId: string,
  raisedOn: string,
  workingDays: number,
): Promise<WorkingDayDueDate> {
  const calendar = await db
    .selectFrom("business_calendar")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!calendar) {
    const r = addWorkingDays(raisedOn, workingDays, null);
    return { dueDate: r.dueDate, unknownReason: r.unknownReason, calendarId: null, calendarVersion: null };
  }
  const r = addWorkingDays(raisedOn, workingDays, await workingCalendarOf(db, calendar, raisedOn));
  return {
    dueDate: r.dueDate,
    unknownReason: r.unknownReason,
    calendarId: calendar.id,
    calendarVersion: calendar.version,
  };
}

/** The organization's default calendar timezone (business dates of instants, ADR-0025 §2), or null when none. */
export async function defaultCalendarTimezone(db: DbOrTx, organizationId: string): Promise<string | null> {
  const row = await db
    .selectFrom("business_calendar")
    .select("timezone")
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  return row?.timezone ?? null;
}

/**
 * The organization's default calendar (ADR-0025 §1), created inside the organization-create transaction by the SQL
 * function of `0028` (idempotent; audited as the acting user with source 'api').
 */
export async function ensureDefaultCalendar(
  tx: Tx,
  organizationId: string,
  actorUserId: string | null,
  requestId: string,
): Promise<void> {
  await sql`SELECT p4_ensure_default_calendar(${organizationId}::uuid, ${actorUserId}::uuid, ${requestId}, 'api')`.execute(
    tx,
  );
}

// ------------------------------------------------------------------------------------------------ routes

export function registerCalendarRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const ORG_CALENDARS = "/api/v1/organizations/:organizationId/calendars";
  const CALENDAR = "/api/v1/calendars/:calendarId";
  const HOLIDAYS = `${CALENDAR}/holidays`;
  const HOLIDAY = `${HOLIDAYS}/:holidayId`;
  const WORKING_DAYS = `${CALENDAR}/working-days`;

  app.get(ORG_CALENDARS, { config: { access: { permission: READ } } }, async (request) => {
    const { organizationId } = parse(orgParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await requireRead(db, principalOf(request), READ, { type: "organization", id: organizationId });
    const hash = filterHash({ organizationId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("business_calendar").selectAll().where("organization_id", "=", organizationId);
    if (after) q = q.where(sql<boolean>`(code, id) > (${String(after[0])}, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("code")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.code, r.id], hash);
    return { items: page.items.map(toBusinessCalendar), nextCursor: page.nextCursor };
  });

  app.post(
    ORG_CALENDARS,
    { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { organizationId } = parse(orgParams, request.params, "params");
      const body = parseBody(calendarCreate, request.body);
      const row = await db.transaction().execute(async (tx) => {
        const userId = await requireConfigure(tx, request, organizationId);
        checkWorkweek(body.workweek);
        checkTimezone(body.timezone);
        const taken = await tx
          .selectFrom("business_calendar")
          .select("id")
          .where("organization_id", "=", organizationId)
          .where("code", "=", body.code)
          .executeTakeFirst();
        if (taken) throw calendarRefusals.codeTaken(body.code);
        if (body.isDefault === true) {
          await lockOrganizationCalendars(tx, organizationId);
          await clearDefault(tx, request, organizationId, null, userId);
        }
        const org = await tx
          .selectFrom("organization")
          .select("default_timezone")
          .where("id", "=", organizationId)
          .executeTakeFirstOrThrow();
        const id = uuidv7();
        const created = await tx
          .insertInto("business_calendar")
          .values({
            id,
            organization_id: organizationId,
            code: body.code,
            name_en: body.nameEn,
            name_ar: body.nameAr,
            timezone: body.timezone ?? org.default_timezone,
            workweek: body.workweek ?? [...DEFAULT_WORKWEEK],
            is_default: body.isDefault ?? false,
            created_by: userId,
            updated_by: userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, auditContextOf(request), {
          action: "business_calendar.create",
          recordType: "business_calendar",
          recordId: id,
          organizationId,
          newVersion: 1,
          changes: calendarChanges({}, created),
        });
        return created;
      });
      return sendVersioned(reply, 201, toBusinessCalendar(row), `/api/v1/calendars/${row.id}`);
    },
  );

  app.get(CALENDAR, { config: { access: { permission: READ } } }, async (request, reply) => {
    const { calendarId } = parse(calendarParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    return sendVersioned(reply, 200, toBusinessCalendar(await readableCalendar(db, request, calendarId)));
  });

  app.patch(
    CALENDAR,
    { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { calendarId } = parse(calendarParams, request.params, "params");
      const body = parseBody(calendarUpdate, request.body);
      const row = await db.transaction().execute(async (tx) => {
        const located = await readableCalendar(tx, request, calendarId);
        const userId = await requireConfigure(tx, request, located.organization_id);
        const expected = requireIfMatch(request);
        if (body.isDefault === true) await lockOrganizationCalendars(tx, located.organization_id);
        const current = await readableCalendar(tx, request, calendarId, true);
        if (current.version !== expected) throw problems.versionConflict(current.version);
        checkWorkweek(body.workweek);
        checkTimezone(body.timezone);
        const status = body.status ?? current.status;
        const isDefault = body.isDefault ?? current.is_default;
        if (isDefault && status === "archived") throw calendarRefusals.defaultNotArchivable();
        if (body.isDefault === true && !current.is_default)
          await clearDefault(tx, request, current.organization_id, current.id, userId);
        const updated = await tx
          .updateTable("business_calendar")
          .set({
            ...(body.nameEn !== undefined ? { name_en: body.nameEn } : {}),
            ...(body.nameAr !== undefined ? { name_ar: body.nameAr } : {}),
            ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
            ...(body.workweek !== undefined ? { workweek: body.workweek } : {}),
            ...(body.isDefault !== undefined ? { is_default: true } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            updated_by: userId,
          })
          .where("id", "=", calendarId)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, auditContextOf(request), {
          action: "business_calendar.update",
          recordType: "business_calendar",
          recordId: calendarId,
          organizationId: current.organization_id,
          priorVersion: current.version,
          newVersion: updated.version,
          changes: calendarChanges(current, updated),
        });
        return updated;
      });
      return sendVersioned(reply, 200, toBusinessCalendar(row));
    },
  );

  app.get(HOLIDAYS, { config: { access: { permission: READ } } }, async (request) => {
    const { calendarId } = parse(calendarParams, request.params, "params");
    const query = parseQuery(holidayQuery, request.query);
    await readableCalendar(db, request, calendarId);
    const hash = filterHash({ calendarId, year: query.year });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("business_calendar_holiday").selectAll().where("calendar_id", "=", calendarId);
    if (query.year !== undefined)
      q = q.where("date_from", "<=", `${query.year}-12-31`).where("date_to", ">=", `${query.year}-01-01`);
    if (after) q = q.where(sql<boolean>`(date_from, id) > (${String(after[0])}::date, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("date_from")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.date_from, r.id], hash);
    return { items: page.items.map(toCalendarHoliday), nextCursor: page.nextCursor };
  });

  app.post(HOLIDAYS, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { calendarId } = parse(calendarParams, request.params, "params");
    const body = parseBody(calendarHolidayCreate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const calendar = await readableCalendar(tx, request, calendarId);
      const userId = await requireConfigure(tx, request, calendar.organization_id);
      if (!holidayRangeValid(body.dateFrom, body.dateTo)) throw calendarRefusals.holidayRangeInvalid();
      const id = uuidv7();
      const created = await tx
        .insertInto("business_calendar_holiday")
        .values({
          id,
          organization_id: calendar.organization_id,
          calendar_id: calendarId,
          date_from: body.dateFrom,
          date_to: body.dateTo,
          name_en: body.nameEn,
          name_ar: body.nameAr,
          created_by: userId,
          updated_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "business_calendar_holiday.create",
        recordType: "business_calendar_holiday",
        recordId: id,
        organizationId: calendar.organization_id,
        newVersion: 1,
        changes: diffFields({} as Record<string, unknown>, created as unknown as Record<string, unknown>, [
          ...HOLIDAY_AUDIT_FIELDS,
        ]),
      });
      return created;
    });
    return sendVersioned(reply, 201, toCalendarHoliday(row), `/api/v1/calendars/${calendarId}/holidays/${row.id}`);
  });

  app.patch(HOLIDAY, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { calendarId, holidayId } = parse(holidayParams, request.params, "params");
    const body = parseBody(calendarHolidayUpdate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const calendar = await readableCalendar(tx, request, calendarId);
      const userId = await requireConfigure(tx, request, calendar.organization_id);
      const expected = requireIfMatch(request);
      const current = await tx
        .selectFrom("business_calendar_holiday")
        .selectAll()
        .where("id", "=", holidayId)
        .where("calendar_id", "=", calendarId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (!holidayRangeValid(body.dateFrom ?? current.date_from, body.dateTo ?? current.date_to))
        throw calendarRefusals.holidayRangeInvalid();
      const updated = await tx
        .updateTable("business_calendar_holiday")
        .set({
          ...(body.dateFrom !== undefined ? { date_from: body.dateFrom } : {}),
          ...(body.dateTo !== undefined ? { date_to: body.dateTo } : {}),
          ...(body.nameEn !== undefined ? { name_en: body.nameEn } : {}),
          ...(body.nameAr !== undefined ? { name_ar: body.nameAr } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", holidayId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action:
          body.status === "removed" && current.status !== "removed"
            ? "business_calendar_holiday.remove"
            : "business_calendar_holiday.update",
        recordType: "business_calendar_holiday",
        recordId: holidayId,
        organizationId: calendar.organization_id,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(current, updated, [...HOLIDAY_AUDIT_FIELDS]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toCalendarHoliday(row));
  });

  app.get(
    WORKING_DAYS,
    { config: { access: { permission: READ } } },
    async (request): Promise<WorkingDayComputation> => {
      const { calendarId } = parse(calendarParams, request.params, "params");
      const query = parseQuery(workingDaysQuery, request.query);
      const calendar = await readableCalendar(db, request, calendarId);
      // An archived calendar is not in use: Unknown, never a guessed date.
      const result =
        calendar.status === "active"
          ? addWorkingDays(query.from, query.workingDays, await workingCalendarOf(db, calendar, query.from))
          : addWorkingDays(query.from, query.workingDays, null);
      return {
        calendarId,
        calendarVersion: calendar.version,
        from: query.from,
        workingDays: query.workingDays,
        dueDate: result.dueDate,
        unknownReason: result.unknownReason,
        skippedDates: result.skippedDates.map((s) => ({ date: s.date, reason: s.reason, holidayId: s.holidayId })),
      };
    },
  );

  return [
    `GET ${ORG_CALENDARS}`,
    `POST ${ORG_CALENDARS}`,
    `GET ${CALENDAR}`,
    `PATCH ${CALENDAR}`,
    `GET ${HOLIDAYS}`,
    `POST ${HOLIDAYS}`,
    `PATCH ${HOLIDAY}`,
    `GET ${WORKING_DAYS}`,
  ];
}
