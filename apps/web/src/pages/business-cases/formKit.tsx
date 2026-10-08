// Shared form pieces of the FE-C screens (business cases and T09). The DG2 hand-written-form rules apply:
//  - every problem `code` is translated in the UI. The P3 kpi codes (business_case.*, business_case_line.*,
//    benefit_formula.*, benefit_formula_version.*, finance.*, formula.*) are translated from this task's own
//    namespaces (`businessCases.problems.*`, `benefitFormulas.problems.*`) and everything else from the shared
//    `problems.*` catalogue (lib/problem.ts). The English server `detail` is never shown;
//  - one form-level alert in one live region (FormAlert); field errors are inline, linked to their control, and
//    focus moves to the first invalid control after a refused submit;
//  - free text is sent verbatim: "" means "no value", text without visible content is `validation.blank`.
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api/client.ts";
import { formatDecimal } from "@mth/shared/schemas";
import { useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Icon } from "../../components/Icon.tsx";
import { distinctFormMessages, errorMessage, fieldErrorMessage } from "../../lib/problem.ts";

const OWN_NAMESPACES = ["businessCases", "benefitFormulas"] as const;
const keyOf = (code: string) => code.replace(/\./g, "__");

/** The translated text of a P3 kpi problem code from this task's namespaces, or "" when it has none. */
export function ownProblemText(t: TFunction, code: string): string {
  for (const ns of OWN_NAMESPACES) {
    const text = t(`${ns}.problems.${keyOf(code)}`, { defaultValue: "" });
    if (text) return text;
  }
  return "";
}

/** The form-level message of an error: this task's code texts first, then the shared problem catalogue. */
export function caseErrorMessage(t: TFunction, error: unknown): string {
  if (error instanceof ApiError && error.code) {
    const own = ownProblemText(t, error.code);
    if (own) return own;
  }
  return errorMessage(t, error);
}

/** One field-error code (e.g. "validation.blank" or "business_case.amount_negative"), translated. */
export function caseFieldMessage(t: TFunction, code: string): string {
  return ownProblemText(t, code) || fieldErrorMessage(t, code);
}

/**
 * Splits a server problem into field errors (by JSON pointer, through `fieldOf`) and form-level messages. A business
 * rule that repeats its own code on a field shows on that field and is not announced twice.
 */
export function splitProblem(
  error: unknown,
  fieldOf: (pointer: string) => string | null,
): { fields: Record<string, string>; formLevel: boolean } {
  const fields: Record<string, string> = {};
  if (!(error instanceof ApiError)) return { fields, formLevel: true };
  for (const fe of error.fieldErrors) {
    const name = fieldOf(fe.pointer);
    if (name) fields[name] ??= fe.code;
  }
  const allOnFields = error.fieldErrors.length > 0 && error.fieldErrors.every((fe) => fieldOf(fe.pointer) !== null);
  return { fields, formLevel: !allOnFields };
}

/**
 * The single form-level alert of a form or dialog (one live region). `error` is a server problem (translated here at
 * render time, so it follows a language switch); `codes` are client-side form-level codes.
 */
export function FormAlert({ error, codes = [] }: { error: unknown; codes?: readonly string[] }) {
  const { t } = useTranslation();
  const banner = error ? caseErrorMessage(t, error) : null;
  const others = distinctFormMessages(
    banner,
    codes.map((c) => caseFieldMessage(t, c)),
  );
  const messages = [...(banner ? [banner] : []), ...others];
  if (messages.length === 0) return null;
  return (
    <div className="banner banner--error" role="alert" data-state="form-errors">
      {messages.length === 1 ? (
        <p>
          <Icon name="alert" /> {messages[0]}
        </p>
      ) : (
        <ul className="plain-list">
          {messages.map((m) => (
            <li key={m}>
              <Icon name="alert" /> {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A plain decimal typed with Latin digits and a dot ("1250000.50"); a leading minus only where `signed`. */
export function isDecimalText(value: string, signed = false): boolean {
  return (signed ? /^-?[0-9]+(\.[0-9]+)?$/ : /^[0-9]+(\.[0-9]+)?$/).test(value);
}

/**
 * A money amount: decimal string formatted exactly with 2 fraction digits ("SAR 1,250,000.50"), never through a
 * JavaScript number; null is Unknown, never 0.
 */
export function Money({ value, currency }: { value: string | null | undefined; currency: string }) {
  const locale = useLocale();
  const text = formatDecimal(value, { locale, currency, minFractionDigits: 2, maxFractionDigits: 4 });
  if (text === null) return <Unknown />;
  return (
    <bdi dir="ltr" className="amount" data-amount={value ?? ""}>
      {text}
    </bdi>
  );
}
