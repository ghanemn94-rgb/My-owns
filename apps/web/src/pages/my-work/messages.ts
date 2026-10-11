// The translated text of a work item or reminder (S-6: rendered from `messageKey` + `messageParams` at render time).
// Shared by My Work (pages/my-work/MyWorkPage.tsx) and the dashboard's My Work sections
// (pages/dashboards/MyWorkSections.tsx); moved out of MyWorkPage.tsx unchanged so that neither page imports the other
// (F-DG4-102: no import cycle).
import type { TFunction } from "i18next";
import type { Locale } from "@mth/shared";
import { formatBusinessDate } from "../../lib/format.ts";

/** Message parameters whose values are codes: translated before interpolation. */
const CODE_PARAMS: Record<string, string> = {
  outcome: "myWork.param.outcome",
  approvalType: "myWork.param.approvalType",
  recipientRole: "myWork.param.recipientRole",
  routingError: "myWork.param.routingError",
};
/**
 * Message parameters that are business dates (null = Unknown), formatted in the reader's locale. T-DG4-FE-R1 adds the
 * dates the ARCH-R1/R2 code-table keys carry (finance validation period, SLA date, exception expiry, meeting date).
 */
const DATE_PARAMS = new Set([
  "dueDate",
  "overdueAsOf",
  "periodStart",
  "periodEnd",
  "slaDueDate",
  "expiresOn",
  "meetingDate",
]);

/** `k` is `<param>Ar` and `<param>` is also sent: the Arabic member of a bilingual name (ADR-0025 amendment L1). */
const isArabicNameOf = (k: string, params: Readonly<Record<string, unknown>>) =>
  k.length > 2 && k.endsWith("Ar") && Object.hasOwn(params, k.slice(0, -2));

/** The translated text of a work item or reminder (S-6: rendered from messageKey + messageParams at render time). */
export function renderMessage(
  t: TFunction,
  locale: Locale,
  messageKey: string,
  params: Readonly<Record<string, string | number | boolean | null>>,
  kind?: string,
): string {
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    // ADR-0025 amendment L1: a `<param>Ar` member beside `<param>` is the Arabic name of a bilingual record, never a
    // placeholder of its own.
    if (isArabicNameOf(k, params)) continue;
    // In Arabic, `{{<param>}}` takes `<param>Ar` when it is a non-empty string; otherwise (and always in English) the
    // `<param>` value as before, so a row written before `…Ar` existed renders as today.
    const ar = params[`${k}Ar`];
    if (locale === "ar" && typeof ar === "string" && ar.trim() !== "") values[k] = ar;
    else if (DATE_PARAMS.has(k))
      values[k] = formatBusinessDate(typeof v === "string" ? v : null, locale) ?? t("common.value.unknown");
    else if (CODE_PARAMS[k] && typeof v === "string")
      values[k] = t(`${CODE_PARAMS[k]}.${v}`, { defaultValue: v.replace(/_/g, " ") });
    else if (v === null) values[k] = t("common.value.unknown");
    else values[k] = String(v);
  }
  const key = `myWork.message.${messageKey.replace(/\./g, "__")}`;
  // A key sent with no parameters may have a "_bare" text (e.g. raid.task.action_due without a source code, ADR-0031).
  const bare = Object.keys(params).length === 0 ? t(`${key}_bare`, { defaultValue: "" }) : "";
  const text = bare || t(key, { ...values, defaultValue: "" });
  if (text) return text;
  return t("myWork.message.fallback", { kind: t(`myWork.kind.${kind ?? "other"}`, { defaultValue: kind ?? "" }) });
}
