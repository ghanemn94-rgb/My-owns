// zod mirrors of the P4 jobs-tag schemas (docs/api/openapi.yaml; ADR-0025 §3; T-DG4-BE-A).
import { z } from "zod";
import { timestamp, timeZone, version } from "./common.ts";

export const jobSchedule = z.strictObject({
  code: z.string(),
  queueName: z.string(),
  cron: z.string(),
  timezone: timeZone,
  enabled: z.boolean(),
  descriptionEn: z.string(),
  descriptionAr: z.string(),
  ownerModule: z.string(),
  version,
  updatedAt: timestamp,
});
export type JobSchedule = z.infer<typeof jobSchedule>;
export const jobSchedulePage = z.strictObject({ items: z.array(jobSchedule), nextCursor: z.string().nullable() });

export const jobScheduleUpdate = z
  .strictObject({
    enabled: z.boolean().optional(),
    cron: z.string().min(9).max(100).optional(),
    // The contract's TimeZone is a plain string; an unknown zone is a 422 business rule (job.timezone_unknown).
    timezone: z.string().min(1).max(64).optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type JobScheduleUpdate = z.infer<typeof jobScheduleUpdate>;

/** OpenAPI `JobCode` path parameter. */
export const jobCode = z
  .string()
  .max(64)
  .regex(/^[a-z_]+\.[a-z_]+$/, "validation.job_code");

const CRON_FIELD_RANGES: readonly (readonly [number, number])[] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (0 and 7 are Sunday)
];
const CRON_ITEM = /^(\*|(\d{1,2})(-(\d{1,2}))?)(\/(\d{1,2}))?$/;

/**
 * True for a five-field numeric cron expression (minute hour day-of-month month day-of-week) with `*`, lists, ranges
 * and steps, each value inside its field's range. The worker hands it to pg-boss `schedule()`; anything else is
 * refused before it is stored (422 job.cron_invalid; ADR-0025 §3).
 */
export function isFiveFieldCron(cron: string): boolean {
  const fields = cron.split(" ");
  if (fields.length !== 5) return false;
  return fields.every((field, i) => {
    const [lo, hi] = CRON_FIELD_RANGES[i]!;
    return field.split(",").every((item) => {
      const m = CRON_ITEM.exec(item);
      if (!m) return false;
      const values = [m[2], m[4]].filter((v): v is string => v !== undefined).map(Number);
      if (values.some((v) => v < lo || v > hi)) return false;
      if (values.length === 2 && values[0]! > values[1]!) return false;
      return m[6] === undefined || Number(m[6]) >= 1;
    });
  });
}
