// Shared UI of the six dashboards, the Executive Overview, the workspace header and My Work's sections
// (T-DG4-FE-G; p4-work-split §J+K JK.7; ADR-0037).
//  - RAG is a business status: icon + text label, never colour alone. Unknown, Stale and n/a are grey with their own
//    label and reason; they are never shown as 0 and never green (M0159). Blue never means favourable.
//  - A dashboard value has five DISTINCT states (ADR-0037 §5): a known value, a known zero (labelled "zero"), Unknown,
//    Stale (the last value, labelled Stale) and Not applicable. Each carries `data-value-state` for tests.
//  - Values are decimal strings formatted without floats; ratios and percentages are fractions shown as percent (D-091,
//    ADR-0028 §3; F-DG4-122, F-DG4-125). Currencies are never added together: each currency is its own line.
//  - A KPI-derived value (`kpiUnit` non-null, ADR-0037 N5; D-124) is formatted from its unit KIND as the KPI pages do:
//    a `ratio` KPI is a plain decimal, a percentage KPI × 100 whatever its label; the label is display text only.
//  - The server sends rule, reason, headline and flag KEYS; the texts are translated here at render time (S-6).
//  - The seeded Template 10 labels come from the server in both languages; the Arabic ones are provisional
//    (`arProvisional`) and say so, with the verbatim English source beside them.
import type { TFunction } from "i18next";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import type { Locale } from "@mth/shared";
import type {
  DashboardFilters,
  DashboardHeadline,
  DashboardItem,
  DashboardKpiUnit,
  DashboardPeriod,
  DashboardRag,
  DashboardTransformationRow,
  DashboardValue,
  DrilldownItem,
  HeadlineBasis,
  RagStatus,
  T10Area,
} from "@mth/shared/schemas";
import { PHASES, TRANSFORMATION_STATUSES } from "@mth/shared";
import { ApiError, api } from "../../api/client.ts";
import { useAllUsers, useBusinessUnits } from "../../api/queries.ts";
import { localName, useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
import { Dialog } from "../../components/Form.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { QueryState } from "../../components/States.tsx";
import { TableScrollRegion } from "../../components/TableScrollRegion.tsx";
import { formatBusinessDate, formatDateTime, formatDecimal, formatMoney, formatPercent } from "../../lib/format.ts";
import { formatKpiValue, reasonText as kpiReasonText, times100 } from "../kpi/ui.tsx";
import { useBusinessUnitTransformations, useDashboardPeriods, useDrilldown, type DashboardQuery } from "./api.ts";
import { useReadableTransformations } from "../traceability/api.ts";

/** The page namespace (its `problem.*` texts are read before `problems.*`). */
export const NS = ["dashboards"] as const;

// ------------------------------------------------------------------------------------------------ RAG status

const RAG: Record<RagStatus, { icon: IconName; css: string }> = {
  green: { icon: "check", css: "on-track" },
  amber: { icon: "alert", css: "at-risk" },
  red: { icon: "cross", css: "off-track" },
  unknown: { icon: "question", css: "unknown" },
  stale: { icon: "clock", css: "stale" },
  not_applicable: { icon: "stop", css: "unknown" },
};

/** A T10 status chip: icon + text (Green, Amber, Red, Unknown, Stale, Not applicable). */
export function RagStatusChip({ status, prefix }: { status: RagStatus; prefix?: string }) {
  const { t } = useTranslation();
  const r = RAG[status] ?? RAG.unknown;
  return (
    <span className={`status-chip status-chip--${r.css}`} data-rag={status}>
      <Icon name={r.icon} /> {prefix ? `${prefix}: ` : ""}
      {t(`dashboards.rag.${status}`)}
    </span>
  );
}

/** The translated text of a server key (rule, reason, headline label), "." → "__"; unlisted keys get a neutral text. */
export function keyText(t: TFunction, group: "rule" | "reason" | "headline", key: string | null | undefined): string {
  if (!key) return "";
  const own = t(`dashboards.${group}.${key.replace(/\./g, "__")}`, { defaultValue: "" });
  if (own) return own;
  if (group === "reason" && key.startsWith("kpi.")) return kpiReasonText(t, key) ?? "";
  return t(`dashboards.${group}.other`);
}

/** A rule's explanation, with the policy source (default or configured thresholds, D-106 (a)). */
export function RuleNote({ rag }: { rag: DashboardRag }) {
  const { t } = useTranslation();
  return (
    <p className="small muted" data-rule={rag.ruleKey} data-policy-source={rag.policySource}>
      {keyText(t, "rule", rag.ruleKey)}{" "}
      <span className="lifecycle-chip">{t(`dashboards.policySource.${rag.policySource}`)}</span>
    </p>
  );
}

// ------------------------------------------------------------------------------------------------ values

const COUNT_UNITS = new Set([
  "decision",
  "dependency",
  "indicator",
  "initiative",
  "measurement",
  "outcome_kpi",
  "working_day",
  "count",
]);

/**
 * Percentage units. A percentage is stored as a FRACTION (ADR-0028 §3: 0.12 = 12 %), so its value is multiplied by
 * 100, exactly as the KPI pages' `formatKpiValue` does (F-DG4-125). The API sends a KPI's unit as
 * `unit_label ?? unit_kind` (kpi/dashboard-facts.ts): `percentage` is the unit kind; `%` and `percent` are the unit
 * labels a percentage KPI may carry. No API unit sends an already-scaled percentage.
 * Since ADR-0037 N5 a KPI value carries `kpiUnit`, which decides instead: this set then only (a) reads a value sent
 * WITHOUT `kpiUnit` (the member is optional until T-DG4-KBE-R8 makes it required) and (b) recognizes a percentage
 * label that is only the sign. It never applies to the unit of a value that has a `kpiUnit`.
 */
const PERCENT_UNITS = new Set(["percent", "percentage", "%"]);

/** True for a percentage unit (trimmed, case-insensitive: a unit label is free text). */
export function isPercentUnit(unit: string | null | undefined): boolean {
  return !!unit && PERCENT_UNITS.has(unit.trim().toLowerCase());
}

/** The `kpiUnit` member of a value (ADR-0037 N5): absent is read as null (no KPI unit). */
type FormattableValue = Pick<DashboardValue, "value" | "unit" | "currency"> & {
  readonly kpiUnit?: DashboardKpiUnit | null | undefined;
};

/** A formatted value: the number (an LTR isolate) and the label, free text shown as entered (see ValueText). */
export interface ValueParts {
  readonly number: string;
  readonly label: string | null;
}

/** True for a percentage label that only names the sign ('%', 'percent', 'percentage'; trimmed, any case). */
function isBarePercentLabel(label: string): boolean {
  return PERCENT_UNITS.has(label.trim().toLowerCase());
}

/**
 * A KPI-derived value, formatted from `kpiUnit.kind` exactly as the KPI pages' `formatKpiValue` does, then the label
 * as display text (ADR-0037 N5 item 1; D-124 items 2 and 3). The label never decides the scaling:
 *  - percentage: the fraction × 100 with '%'. A label that is only the sign adds nothing ('12 %'); a label starting
 *    with '%' replaces the bare sign ('12' + '% of users'); any other label follows the sign ('12 %' + 'of users').
 *  - currency with a currency: money, without the label (money names its currency).
 *  - ratio, count, duration, score, other (and currency without a currency): a decimal, then the label if set.
 */
function formatKpiParts(
  value: string,
  kpiUnit: DashboardKpiUnit,
  currency: string | null,
  locale: Locale,
): ValueParts | null {
  const label = kpiUnit.label?.trim() || null;
  if (kpiUnit.kind === "percentage" && label && label.startsWith("%")) {
    const n = formatDecimal(times100(value), locale, { maxFractionDigits: 2 });
    return n === null ? null : { number: n, label };
  }
  const number = formatKpiValue(value, kpiUnit.kind, currency, locale);
  if (number === null) return null;
  if (kpiUnit.kind === "currency" && currency) return { number, label: null };
  if (kpiUnit.kind === "percentage" && label && isBarePercentLabel(label)) return { number, label: null };
  return { number, label };
}

/**
 * The formatted parts of a known value (no state label). Null when the value is not a number.
 *  - A KPI-derived value (`kpiUnit` non-null) is formatted from its unit KIND, as the KPI pages do (ADR-0037 N5): a
 *    `ratio` KPI of 1.5 is '1.5', never '150 %'; a percentage labelled '% of users' is '12 % of users'.
 *  - Otherwise the earlier rules hold. The UNIT decides before the currency (F-DG4-122): the value gap is
 *    `{unit: "ratio", currency: "SAR", kpiUnit: null}`, a computed ratio shown as a percentage ("100 %"), never as money.
 *    A percentage unit is a fraction × 100 too (F-DG4-125): it covers a value sent without `kpiUnit`.
 */
export function formatValueParts(v: FormattableValue, locale: Locale): ValueParts | null {
  if (v.value === null) return null;
  if (v.kpiUnit) return formatKpiParts(v.value, v.kpiUnit, v.currency, locale);
  const only = (number: string | null): ValueParts | null => (number === null ? null : { number, label: null });
  if (v.unit === "ratio" || isPercentUnit(v.unit))
    return only(formatPercent(v.value, locale, { fraction: true, maxFractionDigits: 2 }));
  if (v.currency) return only(formatMoney(v.value, v.currency, locale));
  if (v.unit && COUNT_UNITS.has(v.unit)) return only(formatDecimal(v.value, locale, { maxFractionDigits: 0 }));
  const n = formatDecimal(v.value, locale, { maxFractionDigits: 4 });
  return n === null ? null : { number: n, label: v.unit || null };
}

/** The formatted text of a known value: the number, then a space and the label when there is one. */
export function formatValue(v: FormattableValue, locale: Locale): string | null {
  const parts = formatValueParts(v, locale);
  return parts === null ? null : parts.label ? `${parts.number} ${parts.label}` : parts.number;
}

/**
 * The number in an LTR isolate. With a label, the number and the label sit together in ONE auto-direction isolate whose
 * direction comes from the label (the number's own isolate is skipped when the direction is resolved): a Latin label
 * reads '12 % of users' left to right in both languages, and an Arabic label stays right to left after the number.
 */
function ValueText({ parts }: { parts: ValueParts }) {
  if (!parts.label) return <bdi dir="ltr">{parts.number}</bdi>;
  return (
    <bdi data-value-text="">
      <bdi dir="ltr">{parts.number}</bdi> <span data-unit-label="">{parts.label}</span>
    </bdi>
  );
}

/**
 * One dashboard value in its state (ADR-0037 §5). Zero, Unknown, Stale and n/a are visibly different and each says so
 * in words; Unknown and n/a never show a number.
 */
export function ValueView({ value, strong = false }: { value: DashboardValue | null | undefined; strong?: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (!value) {
    return (
      <span className="status-chip status-chip--unknown" data-value-state="unknown">
        <Icon name="question" /> {t("dashboards.state.unknown")}
      </span>
    );
  }
  const reason = value.reasonKey ? keyText(t, "reason", value.reasonKey) : "";
  const parts = formatValueParts(value, locale);
  const Num = ({ children }: { children: ReactNode }) =>
    strong ? <strong className="amount">{children}</strong> : <span className="amount">{children}</span>;
  switch (value.state) {
    case "value":
      return (
        <span data-value-state="value" data-value={value.value ?? ""}>
          <Num>{parts ? <ValueText parts={parts} /> : null}</Num>
        </span>
      );
    case "zero":
      return (
        <span data-value-state="zero" data-value={value.value ?? "0"}>
          <Num>{parts ? <ValueText parts={parts} /> : <bdi dir="ltr">0</bdi>}</Num>{" "}
          <span className="lifecycle-chip">{t("dashboards.state.zero")}</span>
        </span>
      );
    case "stale":
      return (
        <span data-value-state="stale" data-value={value.value ?? ""}>
          <span className="status-chip status-chip--stale status-chip--wrap">
            <Icon name="clock" /> <span>{t("dashboards.state.stale")}</span>
          </span>{" "}
          {parts ? (
            <span className="muted">
              {t("dashboards.state.lastKnown")}: <ValueText parts={parts} />
            </span>
          ) : null}
          {reason ? <span className="block small muted">{reason}</span> : null}
        </span>
      );
    case "not_applicable":
      return (
        <span data-value-state="not_applicable">
          <span className="status-chip status-chip--unknown status-chip--wrap">
            <Icon name="stop" /> <span>{t("dashboards.state.not_applicable")}</span>
          </span>
          {reason ? <span className="block small muted">{reason}</span> : null}
        </span>
      );
    default:
      return (
        <span data-value-state="unknown">
          <span className="status-chip status-chip--unknown status-chip--wrap">
            <Icon name="question" /> <span>{t("dashboards.state.unknown")}</span>
          </span>
          {reason ? <span className="block small muted">{reason}</span> : null}
        </span>
      );
  }
}

/** A period: label, window and as-of date. */
export function PeriodText({ period }: { period: DashboardPeriod | null | undefined }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (!period) return null;
  const d = (x: string | null) => formatBusinessDate(x, locale) ?? t("dashboards.window.open");
  return (
    <span className="small muted" data-period-asof={period.asOf}>
      {period.label ? (
        <>
          <bdi dir="ltr">{period.label}</bdi> ·{" "}
        </>
      ) : null}
      {period.start || period.end ? (
        <>{t("dashboards.window.range", { start: d(period.start), end: d(period.end) })} · </>
      ) : null}
      {t("dashboards.window.asOf", { date: d(period.asOf) })}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ links

const T_RE = /^\/transformations\/([0-9a-f-]{36})(?:\/(.*))?$/;

/**
 * The web route of a record the API names by its API path (dashboard items and drill-down rows carry API `href`s,
 * ADR-0037 §5). Web paths (work-item `linkPath`s) pass through. Returns null when the record's transformation is not
 * in the path and not known from context; `ResolvingLink` then reads it from the record.
 */
export function webPathOf(href: string, contextTid?: string | null): string | null {
  if (!href.startsWith("/api/")) return href.startsWith("/") ? href : null;
  const path = href.replace(/^\/api\/v1/, "").split("?")[0]!;
  if (path === "/me/work") return "/my-work";
  const ini = /^\/initiatives\/([0-9a-f-]{36})/.exec(path);
  if (ini) return contextTid ? `/transformations/${contextTid}/initiatives/${ini[1]}` : null;
  const bc = /^\/business-cases\/([0-9a-f-]{36})/.exec(path);
  if (bc) return contextTid ? `/transformations/${contextTid}/business-cases/${bc[1]}` : null;
  const m = T_RE.exec(path);
  if (!m) return null;
  const tid = m[1]!;
  const base = `/transformations/${tid}`;
  const rest = (m[2] ?? "").split("/");
  const [seg, id, sub] = rest;
  switch (seg) {
    case undefined:
    case "":
      return base;
    case "kpi-definitions":
      return id ? `${base}/kpis/${id}` : `${base}/kpis`;
    case "kpi-actuals":
    case "kpi-versions":
      return `${base}/kpis`;
    case "benefits":
      return id ? `${base}/benefits/${id}` : `${base}/benefits`;
    case "benefit-measurements":
      return id ? `${base}/benefit-measurements/${id}` : `${base}/benefits`;
    case "benefit-plan-values":
      return `${base}/benefits`;
    case "executive-decisions":
      return id ? `${base}/executive-decisions/${id}` : `${base}/executive-decisions`;
    case "dependencies":
      return `${base}/dependencies`;
    case "outcomes":
      return `${base}/define`;
    case "actions":
      return id ? `${base}/action-register/${id}` : `${base}/actions`;
    case "meetings":
      return id ? `${base}/meetings/${id}` : `${base}/meetings`;
    case "assessment-forms":
    case "bau-handovers":
    case "change-requests":
      return id ? `${base}/${seg}/${id}` : `${base}/${seg}`;
    case "lessons":
      return `${base}/lessons`;
    case "diagnostic-findings":
    case "journeys":
      return `${base}/diagnose`;
    case "tom-canvas":
      return `${base}/design`;
    case "transition-decisions":
      return `${base}/closure`;
    default:
      void sub;
      return base;
  }
}

/**
 * A link to a dashboard record. When the web route needs the record's transformation and it is not in the API path
 * (an initiative or a business case on an organization-wide dashboard), the record is read on click (the caller's
 * own permissions apply) and the link opens it in its transformation.
 */
export function RecordLink({
  href,
  contextTid,
  children,
}: {
  href: string;
  contextTid?: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const begin = useSessionBoundAction();
  const [failed, setFailed] = useState(false);
  const to = webPathOf(href, contextTid);
  if (to) {
    return (
      <Link className="link" to={to} data-record-href={href}>
        {children}
      </Link>
    );
  }
  const resolvable = /^\/api\/v1\/(initiatives|business-cases)\/[0-9a-f-]{36}/.exec(href);
  if (!resolvable) return <span data-record-href={href}>{children}</span>;
  const open = async () => {
    const action = begin(); // F-DG2-530: the navigation belongs to the session it began under
    setFailed(false);
    try {
      const rec = await api.get<{ transformationId?: string }>(resolvable[0]);
      const path = rec.transformationId ? webPathOf(href, rec.transformationId) : null;
      if (path) action.navigate(path);
      else action.run(() => setFailed(true));
    } catch (e) {
      if (action.stale(e)) return;
      setFailed(true);
    }
  };
  return (
    <>
      <button type="button" className="button button--link" data-record-href={href} onClick={() => void open()}>
        {children}
      </button>
      {failed ? (
        <span className="small muted" role="status">
          {" "}
          {t("dashboards.link.notOpened")}
        </span>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ flags

const RAG_FLAG = /^(calculated|milestone|outcome)_(green|amber|red|unknown|stale|not_applicable|not_computable)$/;

/** The translated text of an item flag (`overdue`, `critical_path`, `calculated_red`, `target_initiative` …). */
export function flagText(t: TFunction, flag: string): string {
  const own = t(`dashboards.flag.${flag}`, { defaultValue: "" });
  if (own) return own;
  const rag = RAG_FLAG.exec(flag);
  if (rag)
    return t(`dashboards.flag.prefix.${rag[1]}`, {
      status: t(`dashboards.rag.${rag[2] === "not_computable" ? "unknown" : rag[2]}`),
    });
  const target = /^target_(.+)$/.exec(flag);
  if (target)
    return t("dashboards.flag.prefix.target", {
      kind: t(`dashboards.targetKind.${target[1]}`, { defaultValue: target[1]!.replace(/_/g, " ") }),
    });
  return t("dashboards.flag.other", { flag: flag.replace(/_/g, " ") });
}

export function Flags({ flags }: { flags: readonly string[] }) {
  const { t } = useTranslation();
  if (flags.length === 0) return null;
  return (
    <span className="chip-row" data-flags={flags.join(" ")}>
      {flags.map((f) => (
        <span key={f} className="lifecycle-chip small" data-flag={f}>
          {flagText(t, f)}
        </span>
      ))}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ areas

/** The area's title in the reader's language (seeded labels; Arabic provisional where flagged). */
export function areaTitle(area: T10Area, locale: Locale): string {
  return locale === "ar" ? area.areaAr : area.sourceAreaEn;
}

/** A Template 10 area card: title, status and rule, headlines (each opens its drill-down), and its records. */
export function AreaCard({
  area,
  onDrill,
  contextTid,
  showItems = true,
}: {
  area: T10Area;
  onDrill: (h: DashboardHeadline, title: string) => void;
  contextTid?: string | null;
  showItems?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const titleId = useId();
  const title = areaTitle(area, locale);
  const ar = locale === "ar";
  return (
    <section className="card" aria-labelledby={titleId} data-area={area.code} data-area-rag={area.rag.status}>
      <div className="card__header">
        <h2 id={titleId} className="card__title">
          {title}
        </h2>
        <RagStatusChip status={area.rag.status} />
      </div>
      <p className="small">
        {ar ? area.whatToShowAr : area.sourceWhatToShowEn}
        <span className="block muted">
          {t("dashboards.area.ragLogic")}: {ar ? area.ragLogicAr : area.sourceRagLogicEn}
        </span>
      </p>
      {ar && area.arProvisional ? (
        <p className="small muted" data-provisional="true">
          <Icon name="info" /> {t("dashboards.area.arProvisional")}{" "}
          <span dir="ltr" lang="en" data-verbatim-en="area">
            {area.sourceAreaEn}
          </span>
        </p>
      ) : null}
      <RuleNote rag={area.rag} />
      <ValueRagLines rag={area.rag} id={area.code} provisionalNote={!area.headlines.some((h) => h.headlineBasis)} />
      {area.headlines.length > 0 ? (
        <HeadlineList
          id={area.code}
          headlines={area.headlines}
          onDrill={(h, label) => onDrill(h, `${title} · ${label}`)}
        />
      ) : (
        <p className="small muted">{t("dashboards.area.noHeadline")}</p>
      )}
      {showItems ? <AreaItems area={area} contextTid={contextTid ?? null} /> : null}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ value headlines

/**
 * ADR-0037 / ADR-0030 amendment N3 (D-119, M0172, B0145): a value headline names its basis. `profit_and_cash` (margin
 * uplift + cash saving + working-capital release; the basis of the Finance gross) is THE value figure; `top_line`
 * (revenue uplift) and `non_cash` (avoided cost) are shown beside it, each labelled, never added to it. A headline
 * without a basis (`value.investment`, the other areas, or an API before N3) is shown as it is.
 */

/** The basis chip of a value headline (text + icon; neutral colour, never a status). */
export function BasisChip({ basis }: { basis: HeadlineBasis | null | undefined }) {
  const { t } = useTranslation();
  if (!basis) return null;
  return (
    <span className="lifecycle-chip small" data-basis-chip={basis}>
      {t(`dashboards.basis.${basis}`)}
    </span>
  );
}

const isBeside = (h: DashboardHeadline) => h.headlineBasis === "top_line" || h.headlineBasis === "non_cash";

const BASES: readonly HeadlineBasis[] = ["profit_and_cash", "top_line", "non_cash"];
const RAG_STATUSES = new Set<string>(Object.keys(RAG));

/** One line of the Value RAG (ADR-0037 amendment N4 item 1): the validated gap of one basis in one currency. */
export interface ValueRagLine {
  readonly currency: string;
  readonly headlineBasis: HeadlineBasis;
  readonly gapRatio: string | null;
  readonly status: RagStatus;
  readonly reasonKey: string | null;
}

/**
 * The per-basis lines of a `dashboard.rag.value.validated_gap` RAG (`ruleParams.lines`, N4 item 1), or null when the
 * RAG has none. `ruleParams` is a free object in the contract, so every line is checked: a line without a known basis,
 * a currency or a known status is dropped, never guessed. A missing gap ratio stays null, never 0; the line's status
 * decides how it reads (`valueRagLineValue`).
 */
export function valueRagLines(rag: DashboardRag): ValueRagLine[] | null {
  if (rag.ruleKey !== "dashboard.rag.value.validated_gap") return null;
  const raw = (rag.ruleParams as { lines?: unknown }).lines;
  if (!Array.isArray(raw)) return null;
  const lines: ValueRagLine[] = [];
  for (const x of raw as unknown[]) {
    if (typeof x !== "object" || x === null) continue;
    const l = x as {
      currency?: unknown;
      headlineBasis?: unknown;
      gapRatio?: unknown;
      status?: unknown;
      reasonKey?: unknown;
    };
    if (typeof l.currency !== "string" || typeof l.status !== "string" || !RAG_STATUSES.has(l.status)) continue;
    if (!BASES.includes(l.headlineBasis as HeadlineBasis)) continue;
    lines.push({
      currency: l.currency,
      headlineBasis: l.headlineBasis as HeadlineBasis,
      gapRatio: typeof l.gapRatio === "string" ? l.gapRatio : null,
      status: l.status as RagStatus,
      reasonKey: typeof l.reasonKey === "string" ? l.reasonKey : null,
    });
  }
  return lines.length > 0 ? lines : null;
}

/**
 * The value shown for one Value RAG line, decided by the line's `status` (F-DG4-143; ADR-0037 amendment N4 items 1
 * and 4). The API gives a null `gapRatio` both for `not_applicable` (nothing planned to date) and for `unknown` (a
 * line of the basis has no amount), so the ratio alone cannot tell them apart:
 * - `not_applicable` reads Not applicable, with its reason, and never shows a number;
 * - `unknown` reads Unknown, with its reason;
 * - `stale` reads Stale, with the last known ratio when there is one;
 * - green, amber and red show the ratio; without one (a malformed line) the value is Unknown, never 0 or a guess.
 */
export function valueRagLineValue(line: ValueRagLine): DashboardValue {
  const base = { unit: "ratio", currency: line.currency, kpiUnit: null } as const;
  switch (line.status) {
    case "not_applicable":
      return { ...base, state: "not_applicable", value: null, reasonKey: line.reasonKey };
    case "unknown":
      return { ...base, state: "unknown", value: null, reasonKey: line.reasonKey };
    case "stale":
      return { ...base, state: "stale", value: line.gapRatio, reasonKey: line.reasonKey };
    default:
      return line.gapRatio === null
        ? { ...base, state: "unknown", value: null, reasonKey: line.reasonKey }
        : { ...base, state: "value", value: line.gapRatio, reasonKey: null };
  }
}

/**
 * The Value RAG's lines (D-122, F-DG4-126): one validated gap per basis and currency, each labelled with its basis,
 * with its own status; the area's status is the worst of them. Gaps are listed, never added across bases. The
 * line(s) that set the area's status are marked `data-worst`.
 */
export function ValueRagLines({
  rag,
  id,
  provisionalNote = true,
}: {
  rag: DashboardRag;
  id: string;
  /** False when the area's basis-labelled headlines already show the provisional-Arabic note (one note per area). */
  provisionalNote?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const lines = valueRagLines(rag);
  if (!lines) return null;
  const captionId = `value-rag-lines-${id}`;
  return (
    <div data-value-rag-lines={lines.length}>
      <h3 className="small-heading" id={captionId}>
        {t("dashboards.basis.ragLines")}
      </h3>
      <p className="small muted" data-worst-of-note>
        <Icon name="info" /> {t("dashboards.basis.ragLinesNote")}
      </p>
      {/* A wrapping list, not a table: in a narrow area card every line's status stays visible without scrolling. */}
      <ul className="plain-list" aria-labelledby={captionId}>
        {lines.map((l, n) => {
          const value = valueRagLineValue(l);
          return (
            <li
              key={`${l.headlineBasis}-${l.currency}-${n}`}
              data-rag-line-basis={l.headlineBasis}
              data-rag-line-currency={l.currency}
              data-rag-line-status={l.status}
              {...(l.status === rag.status ? { "data-worst": "true" } : {})}
            >
              <BasisChip basis={l.headlineBasis} />{" "}
              <bdi dir="ltr" className="code">
                {l.currency}
              </bdi>
              {" · "}
              <span className="visually-hidden">{t("dashboards.basis.ragLineGap")}: </span>
              <ValueView value={value} /> <RagStatusChip status={l.status} />
              {l.reasonKey && value.state === "value" ? (
                <span className="block small muted">{keyText(t, "reason", l.reasonKey)}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {provisionalNote && locale === "ar" ? (
        <p className="small muted" data-provisional="basis">
          <Icon name="info" /> {t("dashboards.basis.arProvisional")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A list of headlines (T10 areas, the Executive Overview, Finance, the workspace header). The profit-and-cash and
 * basis-less headlines come first, in the server's order; the top-line and non-cash headlines follow in their own
 * group, introduced as "beside, never added". Every headline opens its own drill-down (`drilldownHref`, as sent).
 */
export function HeadlineList({
  id,
  headlines,
  onDrill,
  compact = true,
}: {
  id: string;
  headlines: readonly DashboardHeadline[];
  onDrill: (h: DashboardHeadline, label: string) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const main = headlines.filter((h) => !isBeside(h));
  const beside = headlines.filter(isBeside);
  const based = headlines.some((h) => h.headlineBasis);
  const cls = compact ? "details details--compact" : "details";
  const item = (h: DashboardHeadline, n: number) => {
    const label = keyText(t, "headline", h.labelKey);
    return (
      <div
        key={`${h.metric}-${h.headlineBasis ?? ""}-${h.value.currency ?? ""}-${n}`}
        data-metric={h.metric}
        {...(h.headlineBasis ? { "data-headline-basis": h.headlineBasis } : {})}
        {...(isBeside(h) ? { "data-not-summed": "true" } : {})}
      >
        <dt>
          {label} <BasisChip basis={h.headlineBasis} />
        </dt>
        <dd>
          <ValueView value={h.value} strong />{" "}
          <button
            type="button"
            className="button button--link button--small"
            data-drill={h.metric}
            {...(h.headlineBasis ? { "data-drill-basis": h.headlineBasis } : {})}
            onClick={() => onDrill(h, label)}
          >
            {t("dashboards.drill.open")}
            <span className="visually-hidden">: {label}</span>
          </button>
        </dd>
      </div>
    );
  };
  return (
    <>
      <dl className={cls} data-headlines={id}>
        {main.map(item)}
      </dl>
      {beside.length > 0 ? (
        <>
          <p className="small muted" data-beside-note={id}>
            <Icon name="info" /> {t("dashboards.basis.besideNote")}
          </p>
          <dl className={cls} data-headlines-beside={id} data-not-summed="true">
            {beside.map(item)}
          </dl>
        </>
      ) : null}
      {based && locale === "ar" ? (
        <p className="small muted" data-provisional="basis">
          <Icon name="info" /> {t("dashboards.basis.arProvisional")}
        </p>
      ) : null}
    </>
  );
}

/** The records listed in an area (at most the first ten here; the drill-down lists them all with paging). */
function AreaItems({ area, contextTid }: { area: T10Area; contextTid: string | null }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const locale = useLocale();
  if (area.items.length === 0) return <p className="small muted">{t("dashboards.area.noItems")}</p>;
  const shown = all ? area.items : area.items.slice(0, 10);
  // ADR-0037 amendment N4 item 2 (F-DG4-127): the Portfolio initiative value is on the profit-and-cash basis, and the
  // column says so, but only when the API labels every item so (an unlabelled value is never claimed for a basis).
  const portfolioBasis = area.code === "portfolio" && area.items.every((i) => i.valueBasis === "profit_and_cash");
  const based = area.items.some((i) => i.valueBasis);
  return (
    <>
      <TableScrollRegion caption={t("dashboards.area.itemsCaption")}>
        <table className="table table--compact" data-area-items={area.code}>
          <caption className="visually-hidden">{t("dashboards.area.itemsCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("dashboards.item.record")}</th>
              <th scope="col">{t("dashboards.item.status")}</th>
              <th scope="col" data-value-column-basis={portfolioBasis ? "profit_and_cash" : undefined}>
                {portfolioBasis ? t("dashboards.basis.portfolioValue") : t("dashboards.item.value")}
              </th>
              <th scope="col">{t("dashboards.item.due")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <ItemRow key={`${i.recordType}-${i.recordId}`} item={i} contextTid={contextTid} />
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {area.items.length > 10 ? (
        <button type="button" className="button button--link button--small" onClick={() => setAll((x) => !x)}>
          {all ? t("dashboards.area.showFewer") : t("dashboards.area.showAll", { n: area.items.length })}
        </button>
      ) : null}
      {based && locale === "ar" ? (
        <p className="small muted" data-provisional="basis">
          <Icon name="info" /> {t("dashboards.basis.arProvisional")}
        </p>
      ) : null}
    </>
  );
}

function ItemRow({ item, contextTid }: { item: DashboardItem; contextTid: string | null }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <tr data-item={item.recordId} data-record-type={item.recordType}>
      <th scope="row" className="text-cell">
        <RecordLink href={item.href} contextTid={contextTid}>
          {item.code ? (
            <bdi dir="ltr" className="code">
              {item.code}
            </bdi>
          ) : null}{" "}
          {item.label ?? t(`dashboards.recordType.${item.recordType}`, { defaultValue: item.recordType })}
        </RecordLink>
        <Flags flags={item.flags} />
      </th>
      <td>{item.rag ? <RagStatusChip status={item.rag} /> : <span className="muted">—</span>}</td>
      <td {...(item.valueBasis ? { "data-item-basis": item.valueBasis } : {})}>
        {item.value ? <ValueView value={item.value} /> : <span className="muted">—</span>}
        {item.value && item.valueBasis ? (
          <>
            {" "}
            <BasisChip basis={item.valueBasis} />
          </>
        ) : null}
      </td>
      <td>
        {item.dueDate ? (
          <span data-due={item.dueDate}>{formatBusinessDate(item.dueDate, locale)}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  );
}

/** The six areas in Template 10 order, in a responsive grid. */
export function AreaGrid({
  areas,
  onDrill,
  contextTid,
}: {
  areas: readonly T10Area[];
  onDrill: (h: DashboardHeadline, title: string) => void;
  contextTid?: string | null;
}) {
  const sorted = [...areas].sort((a, b) => a.ordinal - b.ordinal);
  return (
    <div className="grid grid--2" data-areas={sorted.length}>
      {sorted.map((a) => (
        <AreaCard key={a.code} area={a} onDrill={onDrill} contextTid={contextTid ?? null} />
      ))}
    </div>
  );
}

/** One row per transformation with its six area statuses (executive, Finance and adoption dashboards). */
export function TransformationRows({
  rows,
  areaCodes,
  areaLabel,
  linkTo,
}: {
  rows: readonly DashboardTransformationRow[];
  areaCodes: readonly string[];
  areaLabel: (code: string) => string;
  linkTo: (row: DashboardTransformationRow) => string;
}) {
  const { t } = useTranslation();
  const [sortBy, setSortBy] = useState<"code" | "name">("code");
  if (rows.length === 0) return <p className="muted">{t("dashboards.rows.empty")}</p>;
  const sorted = [...rows].sort((a, b) => a[sortBy].localeCompare(b[sortBy]));
  return (
    <>
      <label className="p4-inline-field">
        <span>{t("dashboards.rows.sortBy")}</span>{" "}
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "code" | "name")} data-sort="rows">
          <option value="code">{t("dashboards.rows.code")}</option>
          <option value="name">{t("dashboards.rows.name")}</option>
        </select>
      </label>
      <TableScrollRegion caption={t("dashboards.rows.caption")}>
        <table className="table table--compact" data-transformation-rows={rows.length}>
          <caption className="visually-hidden">{t("dashboards.rows.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("dashboards.rows.transformation")}</th>
              {areaCodes.map((c) => (
                <th key={c} scope="col">
                  {areaLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.transformationId} data-row={r.transformationId}>
                <th scope="row" className="text-cell">
                  <Link className="link" to={linkTo(r)}>
                    <bdi dir="ltr" className="code">
                      {r.code}
                    </bdi>{" "}
                    {r.name}
                  </Link>
                </th>
                {areaCodes.map((c) => {
                  const s = r.areaStatuses.find((x) => x.code === c)?.status ?? "unknown";
                  return (
                    <td key={c}>
                      <RagStatusChip status={s} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ drill-down

export interface DrillTarget {
  readonly href: string;
  readonly title: string;
}

/**
 * The drill-down panel (ADR-0037 §5): the headline value, its period, the calculation (rule, expression, inputs,
 * rounding), the contributing records (paged) and the evidence. Zero, Unknown, Stale and n/a render distinctly.
 */
export function DrilldownPanel({
  target,
  onClose,
  contextTid,
}: {
  target: DrillTarget;
  onClose: () => void;
  contextTid?: string | null;
}) {
  const { t } = useTranslation();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const query = useDrilldown(target.href, cursor);
  useEffect(() => setCursors([null]), [target.href]);
  return (
    <Dialog title={t("dashboards.drill.title", { title: target.title })} onClose={onClose}>
      <div data-drilldown={target.href}>
        <QueryState query={query}>
          {(d) => (
            <>
              <dl className="details details--compact">
                <div>
                  <dt>{t("dashboards.drill.value")}</dt>
                  <dd data-drill-value>
                    <ValueView value={d.value} strong />
                  </dd>
                </div>
                {d.headlineBasis ? (
                  <div>
                    <dt>{t("dashboards.basis.label")}</dt>
                    <dd data-drill-basis-of={d.headlineBasis}>
                      <BasisChip basis={d.headlineBasis} />{" "}
                      <span className="small muted">{t(`dashboards.basis.classes.${d.headlineBasis}`)}</span>
                    </dd>
                  </div>
                ) : null}
                {d.currency ? (
                  <div>
                    <dt>{t("dashboards.drill.currency")}</dt>
                    <dd data-drill-currency={d.currency}>
                      <bdi dir="ltr" className="code">
                        {d.currency}
                      </bdi>
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>{t("dashboards.drill.period")}</dt>
                  <dd>
                    {d.period ? (
                      <PeriodText period={d.period} />
                    ) : (
                      <span className="muted">{t("common.value.none")}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("dashboards.drill.calculation")}</dt>
                  <dd data-calculation={d.calculation.ruleKey}>
                    {keyText(t, "rule", d.calculation.ruleKey)}
                    {d.calculation.expression ? (
                      <span className="block">
                        <bdi dir="ltr" className="code">
                          {d.calculation.expression}
                        </bdi>
                      </span>
                    ) : null}
                    {d.calculation.rounding ? (
                      <span className="block small muted">{t("dashboards.drill.rounded")}</span>
                    ) : null}
                  </dd>
                </div>
              </dl>
              {d.calculation.inputs.length > 0 ? (
                <>
                  <h3 className="small-heading">{t("dashboards.drill.inputs")}</h3>
                  <ul className="plain-list" data-inputs={d.calculation.inputs.length}>
                    {d.calculation.inputs.map((i, n) => (
                      <li key={`${i.name}-${n}`}>
                        <bdi dir="ltr" className="code">
                          {i.name}
                        </bdi>
                        : <ValueView value={i.value} />
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <h3 className="small-heading">{t("dashboards.drill.records")}</h3>
              {d.items.length === 0 ? (
                <p className="muted" data-drill-empty>
                  {t("dashboards.drill.noRecords")}
                </p>
              ) : (
                <TableScrollRegion caption={t("dashboards.drill.records")}>
                  <table className="table table--compact" data-drill-items={d.items.length}>
                    <caption className="visually-hidden">{t("dashboards.drill.records")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("dashboards.item.record")}</th>
                        <th scope="col">{t("dashboards.item.value")}</th>
                        <th scope="col">{t("dashboards.drill.period")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((i) => (
                        <DrillRow key={`${i.recordType}-${i.recordId}`} item={i} contextTid={contextTid ?? null} />
                      ))}
                    </tbody>
                  </table>
                </TableScrollRegion>
              )}
              <div className="pager">
                <button
                  type="button"
                  className="button button--secondary button--small"
                  disabled={cursors.length <= 1}
                  onClick={() => setCursors((c) => c.slice(0, -1))}
                >
                  {t("common.table.previous")}
                </button>
                <span className="pager__info">{t("dashboards.drill.page", { n: cursors.length })}</span>
                <button
                  type="button"
                  className="button button--secondary button--small"
                  disabled={!d.nextCursor}
                  onClick={() => setCursors((c) => [...c, d.nextCursor])}
                >
                  {t("common.table.next")}
                </button>
              </div>
              <h3 className="small-heading">{t("dashboards.drill.evidence")}</h3>
              {d.evidence.length === 0 ? (
                <p className="muted small">{t("dashboards.drill.noEvidence")}</p>
              ) : (
                <ul className="plain-list" data-evidence={d.evidence.length}>
                  {d.evidence.map((e) => (
                    <li key={`${e.evidenceId}-${e.recordId}`}>
                      <bdi>{e.title}</bdi>{" "}
                      <span className="lifecycle-chip small">
                        {t(`dashboards.evidenceStatus.${e.verificationStatus}`, {
                          defaultValue: e.verificationStatus.replace(/_/g, " "),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </QueryState>
      </div>
      <div className="dialog__footer">
        <button type="button" className="button button--secondary" onClick={onClose}>
          {t("dashboards.drill.close")}
        </button>
      </div>
    </Dialog>
  );
}

function DrillRow({ item, contextTid }: { item: DrilldownItem; contextTid: string | null }) {
  const { t } = useTranslation();
  return (
    <tr data-drill-item={item.recordId} data-record-type={item.recordType}>
      <th scope="row" className="text-cell">
        <RecordLink href={item.href} contextTid={contextTid}>
          {item.code ? (
            <bdi dir="ltr" className="code">
              {item.code}
            </bdi>
          ) : null}{" "}
          {item.label ?? t(`dashboards.recordType.${item.recordType}`, { defaultValue: item.recordType })}
        </RecordLink>
      </th>
      <td>{item.value ? <ValueView value={item.value} /> : <span className="muted">—</span>}</td>
      <td>{item.period ? <PeriodText period={item.period} /> : <span className="muted">—</span>}</td>
    </tr>
  );
}

/** A drill-down target state plus its opener, for a dashboard page. */
export function useDrill(): [
  DrillTarget | null,
  (h: DashboardHeadline | { drilldownHref: string }, title: string) => void,
  () => void,
] {
  const [target, setTarget] = useState<DrillTarget | null>(null);
  return [target, (h, title) => setTarget({ href: h.drilldownHref, title }), () => setTarget(null)];
}

// ------------------------------------------------------------------------------------------------ filters

/** The filter state of a dashboard, kept in the URL so a filtered view can be shared and reloaded. */
export interface FilterState {
  readonly period: string;
  readonly owner: string;
  readonly bu: string;
  readonly phase: string;
  readonly status: string;
  /**
   * T-DG4-FE-G2 (REQ-S13-002, ADR-0037 §4): the repeatable transformation chip of the organization-wide dashboards
   * (URL `?tr=<id>&tr=<id>`, at most 50). `set("tr", ids)` takes the ids joined by commas.
   */
  readonly tr: readonly string[];
}

/** ADR-0037 §4: `transformationId` is repeatable, at most 50. */
export const MAX_TRANSFORMATION_FILTER = 50;

export function useFilterState(): [FilterState, (key: keyof FilterState, value: string) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const state: FilterState = {
    period: params.get("period") ?? "",
    owner: params.get("owner") ?? "",
    bu: params.get("bu") ?? "",
    phase: params.get("phase") ?? "",
    status: params.get("status") ?? "",
    tr: params.getAll("tr").slice(0, MAX_TRANSFORMATION_FILTER),
  };
  const set = (key: keyof FilterState, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (key === "tr") {
          next.delete("tr");
          for (const id of value.split(",").filter(Boolean).slice(0, MAX_TRANSFORMATION_FILTER)) next.append("tr", id);
        } else if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const clear = () => setParams(new URLSearchParams(), { replace: true });
  return [state, set, clear];
}

/** Why the business-unit chip sends no request (`useOrgQuery`). */
export type BlockedFilterReason = "none" | "none_matching" | "too_many";

/**
 * The organization-wide query of a filter state. The contract has no business-unit parameter, so the business-unit
 * chip narrows by the transformations of that unit the caller may read (repeated `transformationId`, at most 50).
 * `blocked` says why no request is sent:
 * - `none`: the caller can read no transformation in the unit;
 * - `none_matching`: the unit has readable transformations, but none matches the transformation, phase or status chips;
 * - `too_many`: more than 50 remain.
 * F-DG4-144: the phase and status chips narrow the unit's list before the limit is applied, and the transformation
 * chip is intersected with the unit through the caller's full readable list (`businessUnitId`), so every remedy the
 * `too_many` note names can lift the block.
 */
export function useOrgQuery(state: FilterState): {
  query: DashboardQuery;
  blocked: BlockedFilterReason | null;
  loading: boolean;
} {
  const me = useMe();
  const narrowed = Boolean(state.phase || state.status);
  // The unit's readable list without phase and status (its first 51), which also tells `none` from `none_matching`.
  const unitAll = useBusinessUnitTransformations(me.organization.id, state.bu);
  const unitNarrowed = useBusinessUnitTransformations(me.organization.id, narrowed ? state.bu : "", {
    phase: state.phase,
    status: state.status,
  });
  const readable = useReadableTransformations(me.organization.id, Boolean(state.bu) && state.tr.length > 0);
  const base: DashboardQuery = {
    organizationId: me.organization.id,
    ...(state.owner ? { ownerUserId: state.owner } : {}),
    ...(state.period ? { periodId: state.period } : {}),
    ...(state.phase ? { phase: state.phase } : {}),
    ...(state.status ? { status: state.status } : {}),
  };
  // T-DG4-FE-G2: the transformation chip narrows by its ids; with a business unit too, the two are intersected (an empty
  // intersection sends no request, so it is never read as "all").
  if (!state.bu)
    return {
      query: state.tr.length > 0 ? { ...base, transformationId: state.tr } : base,
      blocked: null,
      loading: false,
    };
  if (unitAll.isPending) return { query: base, blocked: null, loading: true };
  if ((unitAll.data?.items ?? []).length === 0) return { query: base, blocked: "none", loading: false };
  if (state.tr.length > 0) {
    // The chosen transformations of the unit (at most 50 by construction); the server applies phase and status.
    if (readable.isPending) return { query: base, blocked: null, loading: true };
    // If the full list cannot be read, the unit's first page is the fallback (never "all" of the organization).
    const inUnit = readable.isError
      ? (unitAll.data?.items ?? []).map((r) => r.id)
      : (readable.data ?? []).filter((r) => r.businessUnitId === state.bu).map((r) => r.id);
    const ids = state.tr.filter((x) => inUnit.includes(x));
    if (ids.length === 0) return { query: base, blocked: "none_matching", loading: false };
    return { query: { ...base, transformationId: ids }, blocked: null, loading: false };
  }
  const unit = narrowed ? unitNarrowed : unitAll;
  if (unit.isPending) return { query: base, blocked: null, loading: true };
  const ids = (unit.data?.items ?? []).map((x) => x.id);
  if (ids.length === 0) return { query: base, blocked: "none_matching", loading: false };
  if (ids.length > MAX_TRANSFORMATION_FILTER || unit.data?.nextCursor)
    return { query: base, blocked: "too_many", loading: false };
  return { query: { ...base, transformationId: ids }, blocked: null, loading: false };
}

/**
 * The filter chips (ADR-0037 §4): period, business unit, owner, and on organization-wide dashboards phase and status;
 * with the window and the as-of date the server applied. A filter the caller cannot list (no organization.read for
 * periods or units) is explained, never silently empty.
 */
export function FilterBar({
  state,
  set,
  clear,
  applied,
  orgWide,
  ownerOptions,
}: {
  state: FilterState;
  set: (key: keyof FilterState, value: string) => void;
  clear: () => void;
  applied: DashboardFilters | null;
  orgWide: boolean;
  ownerOptions?: readonly { id: string; label: string }[];
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const id = useId();
  const periods = useDashboardPeriods(me.organization.id);
  const units = useBusinessUnits(orgWide ? me.organization.id : undefined);
  const canListUsers = canAnywhere(me, "user.read");
  const users = useAllUsers(me.organization.id, canListUsers && !ownerOptions);
  const owners =
    ownerOptions ??
    (users.data ?? []).map((u) => ({
      id: u.id,
      label: u.id === me.user.id ? `${u.displayName} · ${t("common.people.me")}` : u.displayName,
    }));
  const ownerList = owners.some((o) => o.id === me.user.id)
    ? owners
    : [{ id: me.user.id, label: `${me.user.displayName} · ${t("common.people.me")}` }, ...owners];
  const periodList = periods.data ?? [];
  const unitList = units.data ?? [];
  // T-DG4-FE-G2: only transformations the caller may read are offered (DG1 listTransformations is scope-filtered).
  const readable = useReadableTransformations(me.organization.id, orgWide);
  const readableList = readable.data ?? [];
  const trFull = state.tr.length >= MAX_TRANSFORMATION_FILTER;

  const chips: { key: keyof FilterState; label: string; id?: string }[] = [];
  for (const trId of state.tr) {
    const x = readableList.find((r) => r.id === trId);
    chips.push({
      key: "tr",
      id: trId,
      label: `${t("dashboards.filter.transformation")}: ${x ? `${x.code} · ${x.name}` : "…"}`,
    });
  }
  if (state.period) {
    const p = periodList.find((x) => x.id === state.period);
    chips.push({
      key: "period",
      label: `${t("dashboards.filter.period")}: ${p?.periodLabel ?? applied?.periodLabel ?? "…"}`,
    });
  }
  if (state.bu) {
    const u = unitList.find((x) => x.id === state.bu);
    chips.push({
      key: "bu",
      label: `${t("dashboards.filter.businessUnit")}: ${(u ? localName(u, locale) : null) ?? "…"}`,
    });
  }
  if (state.owner) {
    const o = ownerList.find((x) => x.id === state.owner);
    chips.push({
      key: "owner",
      label: `${t("dashboards.filter.owner")}: ${o?.label ?? t("dashboards.filter.ownerOther")}`,
    });
  }
  if (state.phase)
    chips.push({
      key: "phase",
      label: `${t("dashboards.filter.phase")}: ${t(`transformations.phase.${state.phase}`)}`,
    });
  if (state.status)
    chips.push({
      key: "status",
      label: `${t("dashboards.filter.status")}: ${t(`transformations.status.${state.status}`, { defaultValue: state.status })}`,
    });

  const d = (x: string | null | undefined) => formatBusinessDate(x ?? null, locale) ?? t("dashboards.window.open");
  return (
    <div className="card" data-filter-bar>
      <form
        className="filters"
        role="search"
        aria-label={t("dashboards.filter.title")}
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="filters__select">
          <label htmlFor={`${id}-period`}>{t("dashboards.filter.period")}</label>
          <select
            id={`${id}-period`}
            data-filter="period"
            value={state.period}
            disabled={periods.isError}
            onChange={(e) => set("period", e.target.value)}
          >
            <option value="">{t("dashboards.filter.allTime")}</option>
            {periodList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.periodLabel} ({t(`dashboards.frequency.${p.frequency}`, { defaultValue: p.frequency })})
              </option>
            ))}
          </select>
          {periods.isError ? (
            <span className="small muted block">{t("dashboards.filter.periodsUnavailable")}</span>
          ) : null}
        </div>
        {orgWide ? (
          <div className="filters__select">
            <label htmlFor={`${id}-tr`}>{t("dashboards.filter.transformation")}</label>
            <select
              id={`${id}-tr`}
              data-filter="transformation"
              value=""
              disabled={readable.isError || trFull}
              aria-describedby={`${id}-tr-hint`}
              onChange={(e) => {
                if (e.target.value) set("tr", [...state.tr, e.target.value].join(","));
              }}
            >
              <option value="">{t("dashboards.filter.addTransformation")}</option>
              {readableList
                .filter((x) => !state.tr.includes(x.id))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} · {x.name}
                  </option>
                ))}
            </select>
            <span id={`${id}-tr-hint`} className="small muted block">
              {readable.isError
                ? t("dashboards.filter.transformationsUnavailable")
                : trFull
                  ? t("dashboards.filter.transformationLimit", { max: MAX_TRANSFORMATION_FILTER })
                  : t("dashboards.filter.transformationHint", {
                      n: state.tr.length,
                      max: MAX_TRANSFORMATION_FILTER,
                    })}
            </span>
          </div>
        ) : null}
        {orgWide ? (
          <div className="filters__select">
            <label htmlFor={`${id}-bu`}>{t("dashboards.filter.businessUnit")}</label>
            <select
              id={`${id}-bu`}
              data-filter="bu"
              value={state.bu}
              disabled={units.isError}
              onChange={(e) => set("bu", e.target.value)}
            >
              <option value="">{t("common.filter.any")}</option>
              {unitList.map((u) => (
                <option key={u.id} value={u.id}>
                  {localName(u, locale)} ({u.code})
                </option>
              ))}
            </select>
            {units.isError ? (
              <span className="small muted block">{t("dashboards.filter.unitsUnavailable")}</span>
            ) : null}
          </div>
        ) : null}
        <div className="filters__select">
          <label htmlFor={`${id}-owner`}>{t("dashboards.filter.owner")}</label>
          <select
            id={`${id}-owner`}
            data-filter="owner"
            value={state.owner}
            onChange={(e) => set("owner", e.target.value)}
          >
            <option value="">{t("common.filter.any")}</option>
            {ownerList.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {orgWide ? (
          <>
            <div className="filters__select">
              <label htmlFor={`${id}-phase`}>{t("dashboards.filter.phase")}</label>
              <select
                id={`${id}-phase`}
                data-filter="phase"
                value={state.phase}
                onChange={(e) => set("phase", e.target.value)}
              >
                <option value="">{t("common.filter.any")}</option>
                {PHASES.map((p) => (
                  <option key={p} value={p}>
                    {t(`transformations.phase.${p}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="filters__select">
              <label htmlFor={`${id}-status`}>{t("dashboards.filter.status")}</label>
              <select
                id={`${id}-status`}
                data-filter="status"
                value={state.status}
                onChange={(e) => set("status", e.target.value)}
              >
                <option value="">{t("common.filter.any")}</option>
                {TRANSFORMATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`transformations.status.${s}`, { defaultValue: s })}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
      </form>
      {chips.length > 0 ? (
        <div className="chips" aria-label={t("common.filter.active")} role="group" data-chips={chips.length}>
          {chips.map((c) => (
            <button
              key={c.id ? `${c.key}-${c.id}` : c.key}
              type="button"
              className="filter-chip"
              data-chip={c.key}
              {...(c.id ? { "data-chip-id": c.id } : {})}
              onClick={() => set(c.key, c.id ? state.tr.filter((x) => x !== c.id).join(",") : "")}
            >
              {c.label} <Icon name="cross" />
              <span className="visually-hidden">{t("common.filter.remove")}</span>
            </button>
          ))}
          <button type="button" className="button button--link button--small" onClick={clear}>
            {t("dashboards.filter.clear")}
          </button>
        </div>
      ) : null}
      {orgWide ? (
        <p className="small" data-filter-scope="organization">
          <Icon name="info" />{" "}
          {t("dashboards.filter.scope", { organization: localName(me.organization, locale) ?? me.organization.code })}
        </p>
      ) : null}
      {applied ? (
        <p className="small" data-window-start={applied.windowStart ?? ""} data-asof={applied.asOf} role="note">
          <Icon name="clock" />{" "}
          {applied.windowStart || applied.windowEnd
            ? t("dashboards.window.range", { start: d(applied.windowStart), end: d(applied.windowEnd) })
            : t("dashboards.window.toDate")}{" "}
          · {t("dashboards.window.asOf", { date: d(applied.asOf) })}
        </p>
      ) : null}
    </div>
  );
}

/** When the dashboard was computed (read models are computed on every request, ADR-0037 §1). */
export function GeneratedNote({ at, timezone, onRefresh }: { at: string; timezone?: string; onRefresh: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <p className="small muted" data-generated-at={at}>
      {t("dashboards.generatedAt", { when: formatDateTime(at, locale, timezone) ?? at })}{" "}
      <button type="button" className="button button--link button--small" onClick={onRefresh}>
        <Icon name="refresh" /> {t("dashboards.refresh")}
      </button>
    </p>
  );
}

/** The message shown instead of a request when the business-unit filter cannot be applied. */
export function BlockedFilterNote({ reason }: { reason: BlockedFilterReason }) {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-filter-blocked={reason}>
      <Icon name="info" /> {t(`dashboards.filter.blocked.${reason}`)}
    </p>
  );
}

/** A 422 refusal of the filters (unknown period or owner) is shown translated; other errors fall through. */
export function isFilterRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.status === 422;
}
