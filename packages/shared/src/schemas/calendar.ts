// zod mirrors of the P4 calendar-tag schemas (docs/api/openapi.yaml; ADR-0025 §1; T-DG4-BE-A). The OpenAPI file is the
// source of truth; the contract test parses every success body with these. Request workweeks are plain integer arrays
// in the contract, so their 1..7/distinct rule is a business rule (422 calendar.workweek_invalid), not a 400.
import { z } from "zod";
import { code, name, timestamp, timeZone, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";

export const weekday = z.number().int().min(1).max(7);
const requestWorkweek = z.array(z.number().int()).min(1).max(7);
/** The contract's TimeZone is a plain string; an unknown zone is a 422 business rule (calendar.timezone_unknown). */
const requestTimezone = z.string().min(1).max(64);

export const businessCalendar = z.strictObject({
  id: uuid,
  organizationId: uuid,
  code,
  nameEn: name,
  nameAr: name,
  timezone: timeZone,
  workweek: z
    .array(weekday)
    .min(1)
    .max(7)
    .refine((xs) => new Set(xs).size === xs.length, "validation.unique_items"),
  isDefault: z.boolean(),
  status: z.enum(["active", "archived"]),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type BusinessCalendar = z.infer<typeof businessCalendar>;
export const businessCalendarPage = z.strictObject({
  items: z.array(businessCalendar),
  nextCursor: z.string().nullable(),
});

export const businessCalendarCreate = z.strictObject({
  code,
  nameEn: name,
  nameAr: name,
  timezone: requestTimezone.optional(),
  workweek: requestWorkweek.optional(),
  isDefault: z.boolean().optional(),
});
export type BusinessCalendarCreate = z.infer<typeof businessCalendarCreate>;

export const businessCalendarUpdate = z
  .strictObject({
    nameEn: name.optional(),
    nameAr: name.optional(),
    timezone: requestTimezone.optional(),
    workweek: requestWorkweek.optional(),
    isDefault: z.literal(true).optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type BusinessCalendarUpdate = z.infer<typeof businessCalendarUpdate>;

export const calendarHoliday = z.strictObject({
  id: uuid,
  calendarId: uuid,
  dateFrom: businessDate,
  dateTo: businessDate,
  nameEn: name,
  nameAr: name,
  status: z.enum(["active", "removed"]),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type CalendarHoliday = z.infer<typeof calendarHoliday>;
export const calendarHolidayPage = z.strictObject({
  items: z.array(calendarHoliday),
  nextCursor: z.string().nullable(),
});

export const calendarHolidayCreate = z.strictObject({
  dateFrom: businessDate,
  dateTo: businessDate,
  nameEn: name,
  nameAr: name,
});
export const calendarHolidayUpdate = z
  .strictObject({
    dateFrom: businessDate.optional(),
    dateTo: businessDate.optional(),
    nameEn: name.optional(),
    nameAr: name.optional(),
    status: z.enum(["active", "removed"]).optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

export const workingDayComputation = z.strictObject({
  calendarId: uuid,
  calendarVersion: version,
  from: businessDate,
  workingDays: z.number().int().min(1).max(250),
  dueDate: businessDate.nullable(),
  unknownReason: z.enum(["calendar_not_configured"]).nullable(),
  skippedDates: z.array(
    z.strictObject({
      date: businessDate,
      reason: z.enum(["weekend", "holiday"]),
      holidayId: uuid.nullable().optional(),
    }),
  ),
});
export type WorkingDayComputation = z.infer<typeof workingDayComputation>;
