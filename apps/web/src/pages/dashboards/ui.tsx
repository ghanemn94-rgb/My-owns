// Shared UI of the six dashboards, the Executive Overview, the workspace header and My Work's sections
// (T-DG4-FE-G; p4-work-split §J+K JK.7; ADR-0037).
//  - RAG is a business status: icon + text label, never colour alone. Unknown, Stale and n/a are grey with their own
//    label and reason; they are never shown as 0 and never green (M0159). Blue never means favourable.
//  - A dashboard value has five DISTINCT states (ADR-0037 §5): a known value, a known zero (labelled "zero"), Unknown,
//    Stale (the last value, labelled Stale) and Not applicable. Each carries `data-value-state` for tests.
//  - Values are decimal strings formatted without floats; ratios are fractions shown as percent (D-091). Currencies are
//    never added together: each currency is its own line.
//  - The server sends rule, reason, headline and flag KEYS; the texts are translated here at render time (S-6).
//  - The seeded Template 10 labels come from the server in both languages; the Arabic ones are provisional
//    (`arProvisional`) and say so, with the verbatim English source beside them.
import Decimal from "decimal.js";
import type { TFunction } from "i18next";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import type { Locale } from "@mth/shared";
import type {
  DashboardFilters,
  DashboardHeadline,
  DashboardItem,
  DashboardPeriod,
  DashboardRag,
  DashboardTransformationRow,
  DashboardValue,
  DrilldownItem,
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
import { formatBusinessDate, formatDateTime, formatDecimal, formatMoney } from "../../lib/format.ts";
import { reasonText as kpiReasonText } from "../kpi/ui.tsx";
import { useBusinessUnitTransformations, useDashboardPeriods, useDrilldown, type DashboardQuery } from "./api.ts";

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

/** The formatted number of a known value (no state label). Null when the value is not a number. */
export function formatValue(v: Pick<DashboardValue, "value" | "unit" | "currency">, locale: Locale): string | null {
  if (v.value === null) return null;
  if (v.currency) return formatMoney(v.value, v.currency, locale);
  if (v.unit === "ratio") {
    let pct: string | null = null;
    try {
      pct = new Decimal(v.value).times(100).toFixed();
    } catch {
      return null;
    }
    const p = formatDecimal(pct, locale, { maxFractionDigits: 2 });
    return p === null ? null : `${p} %`;
  }
  if (v.unit && COUNT_UNITS.has(v.unit)) return formatDecimal(v.value, locale, { maxFractionDigits: 0 });
  const n = formatDecimal(v.value, locale, { maxFractionDigits: 4 });
  return n === null ? null : v.unit ? `${n} ${v.unit}` : n;
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
  const number = formatValue(value, locale);
  const Num = ({ children }: { children: ReactNode }) =>
    strong ? <strong className="amount">{children}</strong> : <span className="amount">{children}</span>;
  switch (value.state) {
    case "value":
      return (
        <span data-value-state="value" data-value={value.value ?? ""}>
          <Num>
            <bdi dir="ltr">{number}</bdi>
          </Num>
        </span>
      );
    case "zero":
      return (
        <span data-value-state="zero" data-value={value.value ?? "0"}>
          <Num>
            <bdi dir="ltr">{number ?? "0"}</bdi>
          </Num>{" "}
          <span className="lifecycle-chip">{t("dashboards.state.zero")}</span>
        </span>
      );
    case "stale":
      return (
        <span data-value-state="stale" data-value={value.value ?? ""}>
          <span className="status-chip status-chip--stale status-chip--wrap">
            <Icon name="clock" /> <span>{t("dashboards.state.stale")}</span>
          </span>{" "}
          {number ? (
            <span className="muted">
              {t("dashboards.state.lastKnown")}: <bdi dir="ltr">{number}</bdi>
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
      {area.headlines.length > 0 ? (
        <dl className="details details--compact" data-headlines={area.code}>
          {area.headlines.map((h) => {
            const label = keyText(t, "headline", h.labelKey);
            return (
              <div key={`${h.metric}-${h.value.currency ?? ""}`} data-metric={h.metric}>
                <dt>{label}</dt>
                <dd>
                  <ValueView value={h.value} strong />{" "}
                  <button
                    type="button"
                    className="button button--link button--small"
                    data-drill={h.metric}
                    onClick={() => onDrill(h, `${title} · ${label}`)}
                  >
                    {t("dashboards.drill.open")}
                    <span className="visually-hidden">: {label}</span>
                  </button>
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="small muted">{t("dashboards.area.noHeadline")}</p>
      )}
      {showItems ? <AreaItems area={area} contextTid={contextTid ?? null} /> : null}
    </section>
  );
}

/** The records listed in an area (at most the first ten here; the drill-down lists them all with paging). */
function AreaItems({ area, contextTid }: { area: T10Area; contextTid: string | null }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  if (area.items.length === 0) return <p className="small muted">{t("dashboards.area.noItems")}</p>;
  const shown = all ? area.items : area.items.slice(0, 10);
  return (
    <>
      <div className="table-wrap">
        <table className="table table--compact" data-area-items={area.code}>
          <caption className="visually-hidden">{t("dashboards.area.itemsCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("dashboards.item.record")}</th>
              <th scope="col">{t("dashboards.item.status")}</th>
              <th scope="col">{t("dashboards.item.value")}</th>
              <th scope="col">{t("dashboards.item.due")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <ItemRow key={`${i.recordType}-${i.recordId}`} item={i} contextTid={contextTid} />
            ))}
          </tbody>
        </table>
      </div>
      {area.items.length > 10 ? (
        <button type="button" className="button button--link button--small" onClick={() => setAll((x) => !x)}>
          {all ? t("dashboards.area.showFewer") : t("dashboards.area.showAll", { n: area.items.length })}
        </button>
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
      <td>{item.value ? <ValueView value={item.value} /> : <span className="muted">—</span>}</td>
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
      <div className="table-wrap">
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
      </div>
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
                <div className="table-wrap">
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
                </div>
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
}

export function useFilterState(): [FilterState, (key: keyof FilterState, value: string) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const state: FilterState = {
    period: params.get("period") ?? "",
    owner: params.get("owner") ?? "",
    bu: params.get("bu") ?? "",
    phase: params.get("phase") ?? "",
    status: params.get("status") ?? "",
  };
  const set = (key: keyof FilterState, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const clear = () => setParams(new URLSearchParams(), { replace: true });
  return [state, set, clear];
}

/**
 * The organization-wide query of a filter state. The contract has no business-unit parameter, so the business-unit
 * chip narrows by the transformations of that unit the caller may read (repeated `transformationId`, at most 50).
 * `blocked` says why no request is sent (no readable transformation in the unit, or more than 50).
 */
export function useOrgQuery(state: FilterState): {
  query: DashboardQuery;
  blocked: "none" | "too_many" | null;
  loading: boolean;
} {
  const me = useMe();
  const bu = useBusinessUnitTransformations(me.organization.id, state.bu);
  const base: DashboardQuery = {
    organizationId: me.organization.id,
    ...(state.owner ? { ownerUserId: state.owner } : {}),
    ...(state.period ? { periodId: state.period } : {}),
    ...(state.phase ? { phase: state.phase } : {}),
    ...(state.status ? { status: state.status } : {}),
  };
  if (!state.bu) return { query: base, blocked: null, loading: false };
  if (bu.isPending) return { query: base, blocked: null, loading: true };
  const ids = (bu.data?.items ?? []).map((x) => x.id);
  if (ids.length === 0) return { query: base, blocked: "none", loading: false };
  if (ids.length > 50 || bu.data?.nextCursor) return { query: base, blocked: "too_many", loading: false };
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

  const chips: { key: keyof FilterState; label: string }[] = [];
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
            <button key={c.key} type="button" className="filter-chip" data-chip={c.key} onClick={() => set(c.key, "")}>
              {c.label} <Icon name="cross" />
              <span className="visually-hidden">{t("common.filter.remove")}</span>
            </button>
          ))}
          <button type="button" className="button button--link button--small" onClick={clear}>
            {t("dashboards.filter.clear")}
          </button>
        </div>
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
export function BlockedFilterNote({ reason }: { reason: "none" | "too_many" }) {
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
