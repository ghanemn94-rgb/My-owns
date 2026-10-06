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
export const version = z.number().int().min(1);

/**
 * F-DG2-160 / F-DG2-180 (residuals of F-DG2-150 / D-063; ADR-0017 §2): the single "has visible content" predicate for
 * free text. A value has content only if it contains at least one code point that is NOT in any of:
 *   - `\p{White_Space}` (Unicode White_Space: U+0085 NEXT LINE, NBSP, U+2028/U+2029, U+3000, ...);
 *   - `\p{Cc}` (C0/C1 control characters, e.g. a lone U+0001; F-DG2-180);
 *   - `\p{Cf}` (format characters: U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+2060 WORD JOINER, U+200E LRM,
 *     U+200F RLM, U+061C ARABIC LETTER MARK, U+00AD SOFT HYPHEN, U+180E, U+FEFF, bidi embeddings/isolates, tags, ...);
 *   - `\p{Cs}` (lone surrogates, e.g. an unpaired U+D800; F-DG2-180);
 *   - `\p{Default_Ignorable_Code_Point}` (F-DG2-180: variation selectors U+FE00-FE0F and U+E0100-E01EF, U+034F
 *     COMBINING GRAPHEME JOINER, Mongolian free variation selectors U+180B-180D and U+180F, Khmer inherent vowels
 *     U+17B4/U+17B5, the Hangul fillers U+115F/U+1160/U+3164/U+FFA0, the tag characters U+E0000-E007F, ...);
 *   - U+2800 BRAILLE PATTERN BLANK.
 * `String.prototype.trim()` is not used: it strips only ECMAScript WhiteSpace/LineTerminator, so an Out of scope of
 * "\u200f" used to count as documented. Text with visible content keeps its marks (an Arabic RLM, an emoji ZWJ
 * sequence, an emoji with VS16, Mongolian text with an FVS, a leading ZWSP) and is stored verbatim; nothing is
 * stripped. This is the only definition: `hasText`, `freeText`, `trimmedText` (`name`, `reason`) and the web use it.
 */
const VISIBLE_CONTENT = /[^\p{White_Space}\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}\u2800]/u;

/** True when `value` contains at least one visible code point (F-DG2-160, F-DG2-180); see `VISIBLE_CONTENT`. */
export function hasVisibleContent(value: string): boolean {
  return VISIBLE_CONTENT.test(value);
}

/**
 * F-DG2-150 / F-DG2-160: blank free text is never content. True only for a string with visible content
 * (`hasVisibleContent`); `null`, `undefined`, "", whitespace-only and invisible-only (format characters, fillers)
 * strings are all "not present". The single "is present" test for free text, shared by the API (gate readiness,
 * charter pre-checks) and the web.
 */
export function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && hasVisibleContent(value);
}

/** Field-error code for a blank (whitespace- or invisible-only) free-text value (F-DG2-150, F-DG2-160); localized in EN and AR by the web. */
export const BLANK_TEXT_CODE = "validation.blank";

/**
 * Free text of `min`..`max` characters that is not blank (F-DG2-150, F-DG2-160). A value with no visible content
 * (whitespace, format characters or invisible fillers only; see `hasVisibleContent`) is rejected with
 * `validation.blank`; an empty string still fails `min` (`too_small`) only, so a value never gets two errors. The text
 * is stored exactly as entered (no trimming transform). Use `.nullable()` where `null` clears the field.
 */
export function freeText(min: number, max: number) {
  return z
    .string()
    .min(min)
    .max(max)
    .refine((v) => v.length === 0 || hasVisibleContent(v), BLANK_TEXT_CODE);
}

/**
 * Trimmed text of `min`..`max` characters that is not blank (F-DG2-160, ADR-0017 §2): the P1/admin `name` and the
 * shared `reason`. Leading and trailing ECMAScript whitespace is still trimmed, and a value whose trimmed length is
 * below `min` (for example spaces only) fails `min` with `too_small` only. A value long enough for `min` but with no
 * visible content (`hasVisibleContent`: whitespace, format characters such as U+200F RLM or U+2060 WORD JOINER,
 * U+0085, invisible fillers) is rejected with `validation.blank`. The blank check is skipped whenever `min` already
 * failed, so a value never gets two errors (the `freeText` rule generalized from `min` = 1 to any `min`).
 * Declared after `BLANK_TEXT_CODE`/`hasVisibleContent` so the schemas below never read them in their TDZ.
 */
function trimmedText(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => v.length < min || hasVisibleContent(v), BLANK_TEXT_CODE);
}
export const name = trimmedText(1, 200);
export const reason = trimmedText(3, 1000);
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
