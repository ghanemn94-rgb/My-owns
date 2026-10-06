// zod mirrors of docs/api/openapi.yaml components (ADR-0007). The OpenAPI file is the source of truth;
// the API contract tests fail when these drift from it. zod 4 API.
import { z } from "zod";
import {
  LOCALES,
  PAGINATION,
  PHASES,
  SCOPE_TYPES,
  STANDALONE_DELIVERABLE_TYPES,
  TRANSFORMATION_MODES,
  TRANSFORMATION_STATUSES,
} from "../constants.ts";
import { PERMISSION_CODES, ROLE_CODES } from "../permissions.ts";

export const uuid = z.uuid();
export const timestamp = z.iso.datetime({ offset: true });
export const locale = z.enum(LOCALES);
export const timeZone = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "validation.timezone");
export const currency = z.string().regex(/^[A-Z]{3}$/, "validation.currency");
export const code = z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/, "validation.code");
export const name = z.string().trim().min(1).max(200);
export const reason = z.string().trim().min(3).max(1000);
export const version = z.number().int().min(1);

/**
 * F-DG2-150: blank free text is never content. True only for a string whose trimmed length is > 0; `null`,
 * `undefined`, "" and whitespace-only strings are all "not present". The single "is present" test for free text, shared
 * by the API (gate readiness, charter pre-checks) and the web.
 */
export function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Field-error code for a whitespace-only free-text value (F-DG2-150); localized in EN and AR by the web. */
export const BLANK_TEXT_CODE = "validation.blank";

/**
 * Free text of `min`..`max` characters that is not blank (F-DG2-150). A whitespace-only value is rejected with
 * `validation.blank`; an empty string still fails `min` (`too_small`) only, so a value never gets two errors. The text
 * is stored exactly as entered (no trimming transform). Use `.nullable()` where `null` clears the field.
 */
export function freeText(min: number, max: number) {
  return z
    .string()
    .min(min)
    .max(max)
    .refine((v) => v.length === 0 || v.trim().length > 0, BLANK_TEXT_CODE);
}
export const activeStatus = z.enum(["active", "inactive"]);
export const userStatus = z.enum(["active", "disabled"]);
export const phase = z.enum(PHASES);
export const transformationMode = z.enum(TRANSFORMATION_MODES);
export const transformationStatus = z.enum(TRANSFORMATION_STATUSES);
export const standaloneDeliverableType = z.enum(STANDALONE_DELIVERABLE_TYPES);
export const scopeType = z.enum(SCOPE_TYPES);
export const scopeRef = z.strictObject({ type: scopeType, id: uuid });
export const permissionCode = z.enum(PERMISSION_CODES as [string, ...string[]]);
export const roleCode = z.enum(ROLE_CODES as [string, ...string[]]);

export const cursorQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
});

export function page<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const reasonRequest = z.strictObject({ reason });

/** Strong ETag `"<version>"` <-> version number. */
export const ifMatch = z
  .string()
  .regex(/^"[1-9][0-9]{0,9}"$/, "validation.if_match")
  .transform((v) => Number(v.slice(1, -1)));
export const etagFor = (v: number): string => `"${v}"`;

/** Array with JSON Schema `uniqueItems: true` semantics (primitives). */
export function uniqueArray<T extends z.ZodType>(item: T) {
  return z.array(item).refine((xs) => new Set(xs).size === xs.length, "validation.unique_items");
}
