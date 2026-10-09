// Shared UI of the benefits and Finance validation screens (T-DG4-FE-C; p4-work-split §B.5; ADR-0029, ADR-0030).
//  - An amount is a BenefitAmount: "known" shows the money in its own currency (never converted); "unknown" shows the
//    grey labelled Unknown chip with its reason; "not_applicable" shows "n/a" (a non-financial benefit without an
//    approved valuation method). Neither is ever shown as 0 and neither is ever green (S-5, REQ-PB-076).
//  - Pending (submitted, not yet Finance-validated) is labelled "Pending Finance validation" and is kept apart from
//    validated and sustained: it is never added to them (REQ-PB-075, REQ-S08-016).
//  - The benefit status (RAG) is a business status: label + icon, never colour alone; NULL is Unknown, never green.
//    Blue never means favourable.
//  - Values are decimal strings formatted without floats; allocation shares are fractions (0.6 = 60 %).
import Decimal from "decimal.js";
import type { TFunction } from "i18next";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router";
import type { Locale } from "@mth/shared";
import { useLocale } from "../../app/locale.ts";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { formatBusinessDate, formatDecimal, formatMoney } from "../../lib/format.ts";
import type { BenefitAmount } from "./api.ts";

/** The page namespace (its `problem.*` texts are read before `problems.*`). */
export const NS = ["benefitsP4"] as const;

// ------------------------------------------------------------------------------------------------ numbers

/** A money decimal in its own currency; null when the value is not a number (the caller then shows Unknown). */
export function moneyText(value: string | null | undefined, currency: string | null | undefined, locale: Locale) {
  if (!currency) return formatDecimal(value, locale, { maxFractionDigits: 4 });
  return formatMoney(value, currency, locale);
}

/** A fraction ("0.6") as a percent text ("60 %"), exact (decimal.js); null for a missing or invalid value. */
export function sharePercent(fraction: string | null | undefined, locale: Locale): string | null {
  if (fraction === null || fraction === undefined || fraction.trim() === "") return null;
  try {
    const d = new Decimal(fraction);
    if (!d.isFinite()) return null;
    const p = formatDecimal(d.times(100).toFixed(), locale, { maxFractionDigits: 4 });
    return p === null ? null : `${p} %`;
  } catch {
    return null;
  }
}

/** A percent typed by a person ("60", "12.5") → the stored fraction ("0.6", "0.125"); null when not a decimal. */
export function percentToFraction(input: string): string | null {
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(input.trim())) return null;
  return new Decimal(input.trim()).dividedBy(100).toFixed();
}

/** Decimal text typed by a person ("1250.5", "-3"): at most 4 fraction digits for money. */
export const MONEY_INPUT = /^-?\d{1,16}(\.\d{1,4})?$/;
/** Decimal text of a KPI value or a baseline/target (numeric(24,6)). */
export const MEASURE_INPUT = /^-?\d{1,18}(\.\d{1,6})?$/;

/** The translated text of a reason code (`benefit.planned_value_missing` …); an unlisted code gets a neutral text. */
export function reasonText(t: TFunction, reason: string | null | undefined): string | null {
  if (!reason) return null;
  const own = t(`problems.${reason.replace(/\./g, "__")}`, { defaultValue: "" });
  if (own) return own;
  // engine results stored as "Not computable: <code>" (KBE-E) and free reasons typed by a person are shown as they are
  return reason;
}

// ------------------------------------------------------------------------------------------------ value chips

/** Grey, labelled Unknown with its reason (never 0, never green). */
export function UnknownChip({ reason }: { reason?: string | null | undefined }) {
  const { t } = useTranslation();
  const why = reasonText(t, reason);
  return (
    <span className={`status-chip status-chip--unknown${why ? " status-chip--wrap" : ""}`} data-value-status="unknown">
      <Icon name="question" />{" "}
      <span>
        {t("benefitsP4.amount.unknown")}
        {why ? ` (${why})` : ""}
      </span>
    </span>
  );
}

/** "n/a": a non-financial benefit has no SAR value (it is excluded from SAR totals, not counted as 0; REQ-PB-076). */
export function NotApplicableChip() {
  const { t } = useTranslation();
  return (
    <span
      className="status-chip status-chip--unknown status-chip--wrap"
      data-value-status="not_applicable"
      title={t("benefitsP4.amount.naLong")}
    >
      <Icon name="info" /> <span>{t("benefitsP4.amount.na")}</span>
      <span className="visually-hidden"> ({t("benefitsP4.amount.naLong")})</span>
    </span>
  );
}

/** A BenefitAmount: money in its currency, or the Unknown / n/a chip. */
export function Amount({ amount }: { amount: BenefitAmount | null | undefined }) {
  const locale = useLocale();
  if (!amount || amount.status === "unknown") return <UnknownChip reason={amount?.reason} />;
  if (amount.status === "not_applicable") return <NotApplicableChip />;
  const text = moneyText(amount.amount, amount.currency, locale);
  if (text === null) return <UnknownChip reason={amount.reason} />;
  return (
    <bdi dir="ltr" data-value-status="known" data-amount={amount.amount ?? ""}>
      {text}
    </bdi>
  );
}

/** A money value from a plain decimal (a measurement amount): null renders Unknown, never 0. */
export function Money({
  value,
  currency,
  reason,
}: {
  value: string | null | undefined;
  currency: string | null | undefined;
  reason?: string | null | undefined;
}) {
  const locale = useLocale();
  const text = moneyText(value, currency, locale);
  if (text === null) return <UnknownChip reason={reason} />;
  return (
    <bdi dir="ltr" data-amount={value ?? ""}>
      {text}
    </bdi>
  );
}

/** A KPI value or baseline/target (plain decimal; unit shown beside it). Null renders Unknown. */
export function Measure({ value, unit }: { value: string | null | undefined; unit?: string | null | undefined }) {
  const locale = useLocale();
  const text = formatDecimal(value, locale, { maxFractionDigits: 6 });
  if (text === null) return <UnknownChip />;
  return (
    <span>
      <bdi dir="ltr">{text}</bdi>
      {unit ? <span className="small muted"> {unit}</span> : null}
    </span>
  );
}

/** A business date, or Unknown (never a guessed date). */
export function BDate({ date }: { date: string | null | undefined }) {
  const locale = useLocale();
  const formatted = formatBusinessDate(date ?? null, locale);
  return formatted ? <span data-date={date}>{formatted}</span> : <UnknownChip />;
}

/** "1 Jan 2026 – 31 Mar 2026", or Unknown when either end is missing. */
export function Period({ start, end }: { start: string | null | undefined; end: string | null | undefined }) {
  const locale = useLocale();
  const s = formatBusinessDate(start ?? null, locale);
  const e = formatBusinessDate(end ?? null, locale);
  if (!s || !e) return <UnknownChip />;
  return (
    <span data-period={`${start}/${end}`}>
      {s} – {e}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ status chips

const RAG: Record<"green" | "amber" | "red" | "unknown", { icon: IconName; css: string }> = {
  green: { icon: "check", css: "on-track" },
  amber: { icon: "alert", css: "at-risk" },
  red: { icon: "cross", css: "off-track" },
  unknown: { icon: "question", css: "unknown" },
};

/** The benefit status (T14 "Status"): label + icon; NULL or unknown is Unknown, never green. */
export function BenefitRagChip({ rag }: { rag: "green" | "amber" | "red" | "unknown" | null | undefined }) {
  const { t } = useTranslation();
  const key = rag ?? "unknown";
  const r = RAG[key];
  return (
    <span className={`status-chip status-chip--${r.css}`} data-rag={key}>
      <Icon name={r.icon} /> {t(`benefitsP4.rag.${key}`)}
    </span>
  );
}

/** The lifecycle step (neutral: a step is never a favourable status). */
export function StepChip({ step }: { step: string }) {
  const { t } = useTranslation();
  return (
    <span className="lifecycle-chip lifecycle-chip--draft" data-step={step}>
      <Icon name="dot" /> {t(`benefitsP4.step.${step}`)}
    </span>
  );
}

/** The realization state (REQ-S08-002): enabled is never shown as realized. Neutral chips with a text label. */
export function RealizationChip({ state }: { state: string }) {
  const { t } = useTranslation();
  const icon: IconName =
    state === "validated" || state === "sustained"
      ? "check"
      : state === "measured_pending_validation"
        ? "clock"
        : state === "enabled_not_yet_measured"
          ? "info"
          : "dot";
  return (
    <span className="lifecycle-chip lifecycle-chip--closed" data-realization={state}>
      <Icon name={icon} /> {t(`benefitsP4.realization.${state}`)}
    </span>
  );
}

/** A measurement status: a draft is never shown like submitted or validated data; pending is labelled pending. */
export function MeasurementStatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  const icon: Record<string, IconName> = {
    draft: "pencil",
    submitted: "clock",
    validated: "check",
    rejected: "cross",
    superseded: "archive",
  };
  const css = status === "draft" ? "draft" : status === "validated" ? "closed" : "archived";
  return (
    <span className={`lifecycle-chip lifecycle-chip--${css}`} data-measurement-status={status}>
      <Icon name={icon[status] ?? "dot"} /> {t(`benefitsP4.measurementStatus.${status}`)}
    </span>
  );
}

/** A record status chip (groups, scenarios, methods, overlaps, Finance validations, enablers): neutral, labelled. */
export function RecordChip({ group, status }: { group: string; status: string }) {
  const { t } = useTranslation();
  const icon: IconName =
    status === "proposed" || status === "queued" || status === "open"
      ? "clock"
      : status === "approved" || status === "active" || status === "resolved"
        ? "dot"
        : status === "rejected"
          ? "cross"
          : "archive";
  const css = status === "proposed" || status === "queued" || status === "open" ? "draft" : "closed";
  return (
    <span className={`lifecycle-chip lifecycle-chip--${css}`} data-status={status}>
      <Icon name={icon} /> {t(`benefitsP4.${group}.status.${status}`)}
    </span>
  );
}

/** "Finance validation" note: a human Finance decision inside the product, never an engineering delivery gate. */
export function FinanceValidationNote({ body }: { body: string }) {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="finance-validation">
      <Icon name="lock" /> <strong>{t("benefitsP4.finance.label")}</strong>: {body}
    </p>
  );
}

// ------------------------------------------------------------------------------------------------ navigation

/** The benefit screens' own sub-navigation (one transformation). */
export function BenefitSubNav({ tid }: { tid: string }) {
  const { t } = useTranslation();
  const base = `/transformations/${tid}`;
  const links: { to: string; label: string; icon: IconName }[] = [
    { to: `${base}/benefits`, label: t("benefitsP4.nav.register"), icon: "columns" },
    { to: `${base}/benefit-groups`, label: t("benefitsP4.nav.groups"), icon: "menu" },
    { to: `${base}/benefit-overlaps`, label: t("benefitsP4.nav.overlaps"), icon: "alert" },
    { to: `${base}/benefit-scenarios`, label: t("benefitsP4.nav.scenarios"), icon: "sort" },
    { to: `${base}/benefit-valuation-methods`, label: t("benefitsP4.nav.valuationMethods"), icon: "info" },
    { to: `${base}/finance-validations`, label: t("benefitsP4.nav.financeQueue"), icon: "lock" },
  ];
  return (
    <nav className="p4-subnav" aria-label={t("benefitsP4.nav.label")}>
      {links.map((l) => (
        <NavLink key={l.to} end className="button button--secondary button--small" to={l.to}>
          <Icon name={l.icon} /> {l.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** A link to a benefit's page, by code and title. */
export function BenefitLink({ tid, id, children }: { tid: string; id: string; children: ReactNode }) {
  return (
    <Link className="link" to={`/transformations/${tid}/benefits/${id}`} data-benefit={id}>
      {children}
    </Link>
  );
}

/** A small "code" chip (LTR inside an RTL page). */
export function Code({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="code">
      {children}
    </bdi>
  );
}

/** Options of a vocabulary for a select: `benefitsP4.<group>.<value>`. */
export function vocabOptions(t: TFunction, group: string, values: readonly string[]) {
  return values.map((v) => ({ value: v, label: t(`benefitsP4.${group}.${v}`) }));
}
