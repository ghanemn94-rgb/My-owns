// Maps API errors to translated messages (ADR-0007: the problem `code` is the i18n key; `title`/`detail` are English
// diagnostics and are never shown as the user-facing message).
import type { TFunction } from "i18next";
import { ApiError, NetworkError } from "../api/client.ts";

/**
 * i18n key for a problem or field-error code. Dots inside codes become "__" so that "validation" and
 * "validation.too_small" are sibling keys: "sod.admin_approver" -> "problems.sod__admin_approver".
 */
export function problemKey(code: string): string {
  return `problems.${code.replace(/\./g, "__")}`;
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
      const translated = t(problemKey(code), { defaultValue: "" });
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
