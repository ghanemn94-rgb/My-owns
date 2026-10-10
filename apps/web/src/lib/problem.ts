// Maps API errors to translated messages (ADR-0007: the problem `code` is the i18n key; `title`/`detail` are English
// diagnostics and are never shown as the user-facing message).
import type { TFunction } from "i18next";
import type { ProblemDetails } from "@mth/shared";
import { ApiError, NetworkError } from "../api/client.ts";

/**
 * i18n key for a problem or field-error code. Dots inside codes become "__" so that "validation" and
 * "validation.too_small" are sibling keys: "sod.admin_approver" -> "problems.sod__admin_approver".
 */
export function problemKey(code: string): string {
  return `problems.${code.replace(/\./g, "__")}`;
}

/** The placeholder values a problem carries (ADR-0038 Q1; today only `gate.modular_waiver_*`, as `params.date`). */
export type ProblemParams = NonNullable<ProblemDetails["params"]>;

/** The i18next context of a problem text whose placeholders the problem did not fill: `<key>_noParams`. */
export const PROBLEM_NO_PARAMS_CONTEXT = "noParams";

/** The placeholder names of an i18next text: "{{date, businessDate}}" → "date". */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*(?:,[^}]*)?\}\}/g)].map((m) => m[1]!);
}

/**
 * The translated text of `problems.<code>` (ADR-0038 Q1, T-DG4-FE-R3), filled from the problem's `params` exactly as a
 * work item's message is filled from its `messageParams`. A business date is formatted for the locale by the text
 * itself (`{{date, businessDate}}`, registered in `createI18n`).
 *  - A text without placeholders is returned as before (every problem but the two `gate.modular_waiver_*` codes).
 *  - A text with placeholders and every placeholder given (a non-empty string or a number): the filled text.
 *  - Otherwise (no `params`, e.g. an older server): the `_noParams` variant, which is the text shown before `params`
 *    existed. A placeholder is never shown raw; "" when no usable text exists (the caller falls back).
 */
export function problemText(t: TFunction, code: string, params?: ProblemParams | null): string {
  const key = problemKey(code);
  const template = t(key, { defaultValue: "", skipInterpolation: true });
  if (!template) return "";
  const needed = placeholdersOf(template);
  if (needed.length === 0) return t(key, { defaultValue: "" });
  const filled =
    params != null &&
    needed.every((p) => {
      const v = params[p];
      return (typeof v === "string" && v.trim() !== "") || (typeof v === "number" && Number.isFinite(v));
    });
  const text = filled
    ? t(key, { ...params, defaultValue: "" })
    : t(key, { context: PROBLEM_NO_PARAMS_CONTEXT, defaultValue: "" });
  return /[{}]/.test(text) ? "" : text;
}

/** `problemText` of an API error's own code and params. */
export function apiProblemText(t: TFunction, error: ApiError): string {
  return error.code ? problemText(t, error.code, error.problem?.params) : "";
}

export function errorMessage(t: TFunction, error: unknown): string {
  if (error instanceof NetworkError) return t("problems.network");
  if (error instanceof ApiError) {
    const code = error.code;
    if (code) {
      // Validation problems carry the specific rule in the first field error when there is no field to attach it to.
      if (code === "validation" && error.fieldErrors.length > 0) {
        const first = error.fieldErrors[0]!;
        const fieldKey = problemKey(first.code);
        if (first.pointer === "" && t(fieldKey, { defaultValue: "" })) return t(fieldKey);
      }
      const translated = problemText(t, code, error.problem?.params);
      if (translated) return translated;
    }
    return t(`problems.status.${statusBucket(error.status)}`);
  }
  return t("problems.unexpected");
}

function statusBucket(status: number): string {
  if ([400, 401, 403, 404, 409, 422, 428, 429].includes(status)) return String(status);
  return status >= 500 ? "5xx" : "other";
}

/** Translated message for one field error code (e.g. "validation.too_small"); falls back to a generic message. */
export function fieldErrorMessage(t: TFunction, code: string): string {
  const translated = t(problemKey(code), { defaultValue: "" });
  return translated || t("problems.validation__invalid");
}

/**
 * FE12: component state holds field-error *codes*, never translated text, and they are translated here at render time,
 * so a message that is visible while the user switches language follows the new language.
 */
export function fieldErrorMessages(t: TFunction, codes: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, code] of Object.entries(codes)) out[name] = fieldErrorMessage(t, code);
  return out;
}

/**
 * The messages of a form's error live regions, each shown once (F-DG2-340). `banner` is the message of the problem
 * banner (already rendered in its own `role="alert"` region); `others` are the form-level messages that are not
 * attached to a field. Returns the `others` that say something the banner does not, without repeats, in order: a
 * validation problem whose only field error has pointer "" is then announced once, while a genuinely different second
 * message is kept.
 */
export function distinctFormMessages(banner: string | null | undefined, others: readonly string[]): string[] {
  const seen = new Set<string>(banner ? [banner] : []);
  const out: string[] = [];
  for (const m of others) {
    if (m === "" || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

/** "/name" -> "name", "/identity/subject" -> "identity.subject", "/query/q" -> "q". */
export function pointerToField(pointer: string): string {
  return pointer
    .replace(/^\/query\//, "/")
    .replace(/^\//, "")
    .split("/")
    .join(".");
}

export function isNoPermission(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404) && error.code !== "csrf";
}
