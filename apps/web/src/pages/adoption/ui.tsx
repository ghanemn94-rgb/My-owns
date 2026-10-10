// Shared UI of the slice F screens (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0033): adoption plan, interventions,
// indicators, forms, training and proficiency.
//  - The T13 value lists are closed (B0107): Impact / Influence H/M/L, Current stance Support/Neutral/Resist,
//    Intervention Comms/Training/Involvement/Incentive. Their Arabic labels are provisional (marked on screen).
//  - Status, stance and value states are labelled text plus an icon, never colour alone. Blue never means favourable.
//  - A measure without data is Unknown with its reason (never 0, never green); a Stale value keeps its "Stale" chip.
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import type { AdoptionMeasureValue, AdoptionIndicatorTemplate } from "@mth/shared/schemas";
import { ApiError } from "../../api/client.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { formatDecimal } from "../../lib/format.ts";
import { RagChip, times100 } from "../kpi/ui.tsx";

/** The page namespace (its `problem.*` texts are read before `problems.*`). */
export const NS = ["adoptionP4"] as const;

export const ADOPTION_WRITE_PERMISSIONS = ["adoption.edit"] as const;
export const FORM_WRITE_PERMISSIONS = [
  "assessment_form.manage",
  "assessment.respond",
  "assessment.review",
  "proficiency.record",
] as const;

/** A small "code" chip (LTR inside an RTL page). */
export function Code({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="code">
      {children}
    </bdi>
  );
}

/** Options of a vocabulary for a select: `adoptionP4.<group>.<value>`. */
export function vocabOptions(t: TFunction, group: string, values: readonly string[]) {
  return values.map((v) => ({ value: v, label: t(`adoptionP4.${group}.${v}`) }));
}

/** "Provisional Arabic translation" flag, shown only in Arabic (ADR-0033 §2: `ar_provisional`). */
export function ProvisionalAr({ show = true }: { show?: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (!show || locale !== "ar") return null;
  return (
    <span className="status-chip status-chip--unknown status-chip--wrap" data-ar-provisional="true">
      <Icon name="info" /> {t("adoptionP4.arProvisional")}
    </span>
  );
}

const STANCE_ICON: Record<string, IconName> = { support: "check", neutral: "dot", resist: "alert" };

/** A current stance (Support / Neutral / Resist): label + icon; not a RAG, never coloured green. */
export function StanceText({ stance }: { stance: string }) {
  const { t } = useTranslation();
  return (
    <span className="chip-row" data-stance={stance}>
      <Icon name={STANCE_ICON[stance] ?? "dot"} /> {t(`adoptionP4.stance.${stance}`)}
    </span>
  );
}

const STATUS_ICON: Record<string, IconName> = {
  planned: "clock",
  in_progress: "refresh",
  done: "check",
  cancelled: "cross",
  draft: "pencil",
  published: "lock",
  retired: "archive",
  open: "dot",
  responded: "check",
  submitted: "clock",
  reviewed: "check",
  withdrawn: "cross",
  enrolled: "clock",
  completed: "check",
  no_show: "cross",
  addressed: "check",
  active: "dot",
  archived: "archive",
  removed: "cross",
};

/** A record status (label + icon) from `adoptionP4.status.<value>`. */
export function StatusText({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className="chip-row" data-status={status}>
      <Icon name={STATUS_ICON[status] ?? "dot"} /> {t(`adoptionP4.status.${status}`, { defaultValue: status })}
    </span>
  );
}

/** H / M / L as a word ("High"), with the T13 letter kept for screen readers. */
export function LevelText({ level }: { level: string | null }) {
  const { t } = useTranslation();
  if (!level)
    return (
      <span className="muted" data-level="none">
        {t("adoptionP4.level.none")}
      </span>
    );
  return <span data-level={level}>{t(`adoptionP4.level.${level}`)}</span>;
}

/** The translated reason of an Unknown measure (`adoption.no_training_records` …). */
export function measureReason(t: TFunction, reason: string | null | undefined): string | null {
  if (!reason) return null;
  return t(`adoptionP4.reason.${reason.replace(/\./g, "_")}`, {
    defaultValue: t(`kpiP4.reason.${reason.replace(/^kpi\./, "").replace(/\./g, "_")}`, {
      defaultValue: t("adoptionP4.reason.other"),
    }),
  });
}

/**
 * One measure value: a percentage (fraction × 100) or a duration, its numerator/denominator, and its RAG. Unknown,
 * Not computable and missing values are the grey labelled chip with the reason; never 0 and never green. A stale
 * value is shown WITH its "Stale" chip.
 */
export function MeasureValue({
  measure,
  template,
}: {
  measure: AdoptionMeasureValue | undefined;
  template: AdoptionIndicatorTemplate | undefined;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const status = measure?.valueStatus ?? "unknown";
  const formatted =
    measure && measure.value !== null && (status === "ok" || status === "stale")
      ? template?.unitKind === "percentage"
        ? `${formatDecimal(times100(measure.value), locale, { maxFractionDigits: 1 }) ?? ""} %`
        : formatDecimal(measure.value, locale, { maxFractionDigits: 2 })
      : null;
  if (formatted === null) {
    const reason = measureReason(t, measure?.valueReason);
    return (
      <span
        className="status-chip status-chip--unknown status-chip--wrap"
        data-value-status={status === "not_computable" ? "not_computable" : "unknown"}
      >
        <Icon name={status === "not_computable" ? "info" : "question"} />{" "}
        <span>
          {status === "not_computable" ? t("adoptionP4.value.notComputable") : t("common.value.unknown")}
          {reason ? ` (${reason})` : ""}
        </span>
      </span>
    );
  }
  return (
    <span className="block" data-value-status={status} data-value={measure?.value ?? ""}>
      <strong>{formatted}</strong>
      {measure && measure.numerator !== null && measure.denominator !== null ? (
        <span className="small muted block" data-fraction>
          {t("adoptionP4.value.fraction", { numerator: measure.numerator, denominator: measure.denominator })}
        </span>
      ) : null}
      {status === "stale" ? <RagChip rag="stale" /> : null}
      {measure?.calculatedRag && status === "ok" ? <RagChip rag={measure.calculatedRag} /> : null}
    </span>
  );
}

/** The indicator / measure name in the shown language; the English source stays visible under the Arabic. */
export function MeasureName({
  template,
  withIndicator,
}: {
  template: AdoptionIndicatorTemplate;
  withIndicator?: boolean;
}) {
  const locale = useLocale();
  const ar = locale === "ar";
  return (
    <span className="block" data-measure={template.key}>
      {withIndicator ? (
        <span className="block">
          <strong>{ar ? template.indicatorAr : template.sourceIndicatorEn}</strong>
          {ar ? (
            <span className="block small muted" lang="en" dir="ltr">
              {template.sourceIndicatorEn}
            </span>
          ) : null}
        </span>
      ) : null}
      <span className="block">{ar ? template.measureAr : template.measureEn}</span>
      <ProvisionalAr show={template.arProvisional} />
    </span>
  );
}

/** The slice F screens' own sub-navigation (one transformation). */
export function AdoptionSubNav({ tid }: { tid: string }) {
  const { t } = useTranslation();
  const base = `/transformations/${tid}`;
  const links: { to: string; label: string; icon: IconName }[] = [
    { to: `${base}/adoption`, label: t("adoptionP4.nav.plan"), icon: "columns" },
    { to: `${base}/adoption-interventions`, label: t("adoptionP4.nav.interventions"), icon: "check" },
    { to: `${base}/adoption-indicators`, label: t("adoptionP4.nav.indicators"), icon: "info" },
    { to: `${base}/adoption-training`, label: t("adoptionP4.nav.training"), icon: "refresh" },
    { to: `${base}/assessment-forms`, label: t("adoptionP4.nav.forms"), icon: "pencil" },
  ];
  return (
    <nav className="p4-subnav" aria-label={t("adoptionP4.nav.label")}>
      {links.map((l) => (
        <NavLink key={l.to} end className="button button--secondary button--small" to={l.to}>
          <Icon name={l.icon} /> {l.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The value of a date input, or null when empty. */
export const dateOrNull = (v: string | boolean | undefined): string | null =>
  typeof v === "string" && v !== "" ? v : null;

/** getAdoptionIndicators answers 400 at /reportingPeriodId when the organization has no started open/closed period. */
export function isNoReportingPeriod(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 400 &&
    error.fieldErrors.some((f) => f.pointer === "/reportingPeriodId")
  );
}

/** Every measure is Unknown: the organization has no reporting period yet (never 0, never a guessed period). */
export function NoReportingPeriod() {
  const { t } = useTranslation();
  return (
    <p className="status-chip status-chip--unknown status-chip--wrap" data-value-status="unknown" data-no-period>
      <Icon name="question" /> {t("common.value.unknown")} ({t("adoptionP4.reason.adoption_no_reporting_period")})
    </p>
  );
}
