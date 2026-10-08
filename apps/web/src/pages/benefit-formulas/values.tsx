// T09 value entry and display (ADR-0024 §6 "Typed variables", item 13). Percentages are never stored as 12 for 12%:
// a fraction-like value is ENTERED as a percent (or percentage points) and converted to a fraction here with
// decimal.js, exactly; the API takes and returns fractions. Display goes through the engine's `displayNumber`
// (@mth/shared/calc), and its suffix code (`percent` | `percentage_points`) is translated by i18next, so a
// fraction_delta of 0.02 shows "2 percentage points", never "2%". A missing value is Unknown, never 0.
import Decimal from "decimal.js";
import {
  displayNumber,
  type FormulaKind,
  type FormulaPeriod,
  type FormulaProblem,
  type FormulaVariable,
} from "@mth/shared/calc";
import { formatDecimal } from "@mth/shared/schemas";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import { isDecimalText } from "../business-cases/formKit.tsx";

/** Kinds entered and shown as a percentage (fraction, percent_change) or percentage points (fraction_delta). */
export const isFractionLike = (kind: FormulaKind) =>
  kind === "fraction" || kind === "fraction_delta" || kind === "percent_change";

/** The unit the value is entered in: "percent", "percentage_points" or null (the value as is). */
export function entryUnit(kind: FormulaKind): "percent" | "percentage_points" | null {
  if (kind === "fraction_delta") return "percentage_points";
  return isFractionLike(kind) ? "percent" : null;
}

/**
 * Entered text → stored decimal string: "12" (%) → "0.12", "2" (pp) → "0.02"; other kinds unchanged. "" → null
 * (no value: the preview is Unknown). Text that is not a decimal is passed through unchanged so the engine refuses it
 * with formula.invalid_variable (value), shown next to the field.
 */
export function toStored(kind: FormulaKind, entry: string): string | null {
  const s = entry.trim();
  if (s === "") return null;
  if (!isFractionLike(kind) || !isDecimalText(s, true)) return s;
  return new Decimal(s).div(100).toFixed();
}

/** Stored decimal → the text shown in an entry field ("0.12" → "12" for a fraction). null → "". */
export function toEntry(kind: FormulaKind, stored: string | null | undefined): string {
  if (stored === null || stored === undefined) return "";
  return displayNumber(stored, kind)?.value ?? stored;
}

export interface ValueType {
  readonly kind: FormulaKind;
  readonly currency?: string | null | undefined;
  readonly period?: FormulaPeriod | null | undefined;
  readonly unit?: string | null | undefined;
}

/**
 * Formats a stored value by kind with the TRANSLATED suffix: currency "SAR 100,000.00", fraction "12%", fraction_delta
 * "2 percentage points", count/quantity with the unit; " per year" when the value has a period. null → null.
 */
export function formatFormulaValue(
  t: TFunction,
  locale: "ar" | "en",
  value: string | null | undefined,
  type: ValueType,
): string | null {
  const n = displayNumber(value ?? null, type.kind);
  if (n === null) return null;
  let text: string | null;
  if (type.kind === "currency") {
    text = formatDecimal(n.value, {
      locale,
      currency: type.currency ?? null,
      minFractionDigits: 2,
      maxFractionDigits: 2,
    });
  } else {
    const plain = formatDecimal(n.value, { locale, maxFractionDigits: 4 });
    if (plain === null) return null;
    text =
      n.suffix === "percent"
        ? t("benefitFormulas.suffix.percent", { value: plain })
        : n.suffix === "percentage_points"
          ? t("benefitFormulas.suffix.percentage_points", { value: plain })
          : type.unit
            ? `${plain} ${type.unit}`
            : plain;
  }
  if (text === null) return null;
  return type.period && type.period !== "none"
    ? t("benefitFormulas.perPeriod", { value: text, period: t(`benefitFormulas.periodUnit.${type.period}`) })
    : text;
}

/** A formula value, or Unknown (with the reason) when there is none. Never 0 for a missing value. */
export function FormulaValue({
  value,
  type,
  unknownHint,
}: {
  value: string | null | undefined;
  type: ValueType;
  unknownHint?: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const text = formatFormulaValue(t, locale, value, type);
  if (text === null) return <Unknown {...(unknownHint ? { hint: unknownHint } : {})} />;
  return (
    <bdi className="amount" data-formula-value={value ?? ""} data-kind={type.kind}>
      {text}
    </bdi>
  );
}

/** The result type in words: "Currency (SAR), per year". */
export function typeLabel(t: TFunction, type: ValueType): string {
  const parts = [t(`benefitFormulas.kind.${type.kind}`)];
  if (type.currency) parts[0] = `${parts[0]} (${type.currency})`;
  if (type.unit && type.kind !== "currency") parts.push(type.unit);
  parts.push(t(`benefitFormulas.period.${type.period ?? "none"}`));
  return parts.join(" · ");
}

// ------------------------------------------------------------------------------------------------ engine messages

const PARAM_KINDS = ["leftKind", "rightKind"] as const;
const PARAM_PERIODS = ["leftPeriod", "rightPeriod"] as const;

/**
 * Translates one engine problem from its code and params (ADR-0024 §6 item 10: Arabic is rendered by the web from the
 * code and params; the English `message` is never shown). Positions are shown 1-based.
 */
export function engineProblemText(t: TFunction, p: FormulaProblem): string {
  const params: Record<string, string> = { ...p.params };
  for (const k of PARAM_KINDS)
    if (params[k]) params[k] = t(`benefitFormulas.kind.${params[k]}`, { defaultValue: params[k] });
  for (const k of PARAM_PERIODS)
    if (params[k]) params[k] = t(`benefitFormulas.periodUnit.${params[k]}`, { defaultValue: params[k] });
  const position = p.offset !== undefined ? String(p.offset + 1) : "1";
  switch (p.code) {
    case "formula.syntax": {
      const reason = p.params["reason"] ?? "unexpected";
      const why = t(`benefitFormulas.engine.syntaxReason.${reason}`, {
        defaultValue: t("benefitFormulas.engine.syntaxReason.unexpected"),
        limit: p.params["limit"] ?? "",
      });
      return t("benefitFormulas.engine.syntax", { position, reason: why });
    }
    case "formula.period_mismatch": {
      const left = p.params["leftPeriod"];
      const right = p.params["rightPeriod"];
      if (left === "none") return t("benefitFormulas.engine.periodNeedsPeriod", params);
      if (!right || right === "none") return t("benefitFormulas.engine.periodVsNone", params);
      return t("benefitFormulas.engine.periodMismatch", { ...params, convertTo: p.params["rightPeriod"] ?? "" });
    }
    case "formula.invalid_variable":
      return t("benefitFormulas.engine.invalidVariable", {
        name: p.params["name"] ?? "",
        reason: t(`benefitFormulas.engine.variableReason.${p.params["reason"] ?? "other"}`, {
          defaultValue: t("benefitFormulas.engine.variableReason.other"),
        }),
      });
    default:
      return t(`benefitFormulas.engine.${p.code.replace("formula.", "")}`, params);
  }
}

/** Variables for the engine and the API from the builder rows (empty optional texts omitted). */
export function engineVariable(row: {
  name: string;
  kind: FormulaKind;
  period: FormulaPeriod;
  unit: string;
  currency: string;
  entry: string;
  source: string;
}): FormulaVariable & { value: string | null } {
  return {
    name: row.name,
    kind: row.kind,
    period: row.period,
    ...(row.unit.trim() !== "" ? { unit: row.unit } : {}),
    ...(row.kind === "currency" ? { currency: row.currency } : {}),
    value: toStored(row.kind, row.entry),
    ...(row.source.trim() !== "" ? { source: row.source } : {}),
  };
}
