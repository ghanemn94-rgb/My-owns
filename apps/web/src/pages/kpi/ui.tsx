// Shared UI of the KPI engine screens (T-DG4-FE-B; p4-work-split §A.5, ADR-0027, ADR-0028).
//  - RAG is a business status: label + icon, never colour alone. Unknown, Stale and Not computable render GREY with
//    their label and reason, never as 0 and never green (REQ-S07-006). Blue never means favourable.
//  - Values are decimal strings formatted without floats; percentages are fractions (0.12 = 12 %, ADR-0028 §3).
//  - The sub-navigation links the KPI screens of one transformation (dictionary/status, review queue, data quality).
import Decimal from "decimal.js";
import type { TFunction } from "i18next";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router";
import type { Locale } from "@mth/shared";
import { ApiError, api } from "../../api/client.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Dialog } from "../../components/Form.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { formatBusinessDate, formatDecimal, formatMoney } from "../../lib/format.ts";
import { FormAlert } from "../my-work/p4ui.tsx";
import type { KpiStatus } from "./api.ts";

/** The page namespace (its `problem.*` texts are read before `problems.*`). */
export const NS = ["kpiP4"] as const;

export type Rag = KpiStatus["calculatedRag"];
export type ValueStatus = KpiStatus["actualStatus"];
export type UnitKind = KpiStatus["unitKind"];

const RAG: Record<Rag, { icon: IconName; css: string }> = {
  green: { icon: "check", css: "on-track" },
  amber: { icon: "alert", css: "at-risk" },
  red: { icon: "cross", css: "off-track" },
  unknown: { icon: "question", css: "unknown" },
  stale: { icon: "clock", css: "stale" },
  not_computable: { icon: "info", css: "unknown" },
};

/** A RAG status chip: icon + text label (green, amber, red, unknown, stale, not computable). */
export function RagChip({ rag, label }: { rag: Rag; label?: string }) {
  const { t } = useTranslation();
  const r = RAG[rag];
  return (
    <span className={`status-chip status-chip--${r.css}`} data-rag={rag}>
      <Icon name={r.icon} /> {label ? `${label}: ` : ""}
      {t(`kpiP4.rag.${rag}`)}
    </span>
  );
}

/** The translated text of a KPI reason code (`kpi.no_accepted_actual` …); an unlisted code gets a neutral text. */
export function reasonText(t: TFunction, reason: string | null | undefined): string | null {
  if (!reason) return null;
  const key = reason.replace(/^kpi\./, "").replace(/\./g, "_");
  return t(`kpiP4.reason.${key}`, { defaultValue: t("kpiP4.reason.other") });
}

/** Multiplies a decimal string by 100 (a fraction shown as percent or percentage points); null stays null. */
export function times100(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  try {
    const d = new Decimal(value);
    return d.isFinite() ? d.times(100).toFixed() : null;
  } catch {
    return null;
  }
}

/** A KPI value in its unit: SAR money, a percentage (fraction × 100), or a plain decimal. Null when not a number. */
export function formatKpiValue(
  value: string | null | undefined,
  unitKind: UnitKind | string,
  currency: string | null | undefined,
  locale: Locale,
): string | null {
  if (unitKind === "currency" && currency) return formatMoney(value, currency, locale);
  if (unitKind === "percentage") {
    const p = formatDecimal(times100(value), locale, { maxFractionDigits: 2 });
    return p === null ? null : `${p} %`;
  }
  return formatDecimal(value, locale, { maxFractionDigits: 4 });
}

/**
 * A value, or its status chip. `status` other than ok/stale (or a null value) renders the grey labelled chip with the
 * reason; a stale value is shown WITH a "Stale" chip (it is a real but old value).
 */
export function KpiValue({
  value,
  status,
  reason,
  unitKind,
  currency,
}: {
  value: string | null | undefined;
  status: ValueStatus;
  reason?: string | null | undefined;
  unitKind: UnitKind | string;
  currency?: string | null | undefined;
}) {
  const locale = useLocale();
  const formatted = formatKpiValue(value, unitKind, currency, locale);
  if (formatted === null || status === "unknown" || status === "not_computable")
    return <ValueState status={status === "ok" || status === "stale" ? "unknown" : status} reason={reason} />;
  return (
    <span className="block" data-value-status={status}>
      <bdi dir="ltr">{formatted}</bdi>
      {status === "stale" ? (
        <>
          {" "}
          <ValueState status="stale" reason={reason} />
        </>
      ) : null}
    </span>
  );
}

/** Grey, labelled Unknown / Stale / Not computable with its reason (never 0, never green). */
export function ValueState({
  status,
  reason,
}: {
  status: "unknown" | "stale" | "not_computable";
  reason?: string | null | undefined;
}) {
  const { t } = useTranslation();
  const r = RAG[status];
  const why = reasonText(t, reason);
  return (
    <span className={`status-chip status-chip--${r.css} status-chip--wrap`} data-value-status={status}>
      <Icon name={r.icon} />{" "}
      <span>
        {t(`kpiP4.valueStatus.${status}`)}
        {why ? ` (${why})` : ""}
      </span>
    </span>
  );
}

/** A business date, or Unknown (never a guessed date). */
export function BusinessDate({ date }: { date: string | null | undefined }) {
  const locale = useLocale();
  const formatted = formatBusinessDate(date ?? null, locale);
  return formatted ? <span data-date={date}>{formatted}</span> : <ValueState status="unknown" />;
}

/** A KPI actual's lifecycle: a saved draft is never shown like submitted or accepted data. */
export function ActualStatusChip({ status }: { status: "draft" | "submitted" | "accepted" | "rejected" }) {
  const { t } = useTranslation();
  const icon: Record<typeof status, IconName> = {
    draft: "pencil",
    submitted: "clock",
    accepted: "check",
    rejected: "cross",
  };
  const css = status === "draft" ? "draft" : status === "accepted" ? "closed" : "archived";
  return (
    <span className={`lifecycle-chip lifecycle-chip--${css}`} data-actual-status={status}>
      <Icon name={icon[status]} /> {t(`kpiP4.actualStatus.${status}`)}
    </span>
  );
}

/** A record lifecycle chip of versions, trajectories, thresholds, periods, overrides and findings (neutral). */
export function RecordChip({ group, status }: { group: string; status: string }) {
  const { t } = useTranslation();
  const icon: IconName =
    status === "draft" || status === "scheduled"
      ? "pencil"
      : status === "active" || status === "approved" || status === "open"
        ? "dot"
        : status === "withdrawn" || status === "revoked" || status === "dismissed"
          ? "stop"
          : "archive";
  const css = status === "draft" || status === "scheduled" ? "draft" : "closed";
  return (
    <span className={`lifecycle-chip lifecycle-chip--${css}`} data-status={status}>
      <Icon name={icon} /> {t(`kpiP4.${group}.status.${status}`)}
    </span>
  );
}

/** The KPI screens' own sub-navigation (one transformation). */
export function KpiSubNav({ tid, kpiId }: { tid: string; kpiId?: string }) {
  const { t } = useTranslation();
  const base = `/transformations/${tid}`;
  const links: { to: string; label: string; icon: IconName }[] = [
    { to: `${base}/kpis`, label: t("kpiP4.nav.dictionary"), icon: "columns" },
    ...(kpiId
      ? [
          { to: `${base}/kpis/${kpiId}`, label: t("kpiP4.nav.kpi"), icon: "info" as IconName },
          { to: `${base}/kpis/${kpiId}/actuals`, label: t("kpiP4.nav.update"), icon: "pencil" as IconName },
        ]
      : []),
    { to: `${base}/kpi-review`, label: t("kpiP4.nav.review"), icon: "check" },
    { to: `${base}/data-quality`, label: t("kpiP4.nav.dataQuality"), icon: "alert" },
  ];
  return (
    <nav className="p4-subnav" aria-label={t("kpiP4.nav.label")}>
      {links.map((l) => (
        <NavLink key={l.to} end className="button button--secondary button--small" to={l.to}>
          <Icon name={l.icon} /> {l.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** A link to a KPI's page, by name. */
export function KpiLink({ tid, kpiId, name }: { tid: string; kpiId: string; name: ReactNode }) {
  return (
    <Link className="link" to={`/transformations/${tid}/kpis/${kpiId}`} data-kpi={kpiId}>
      {name}
    </Link>
  );
}

/** A threshold value: a relative threshold is a fraction shown in percent; an absolute one is in the KPI's unit. */
export function formatThreshold(
  value: string | null | undefined,
  mode: "relative" | "absolute" | null | undefined,
  locale: Locale,
): string | null {
  if (mode === "relative") {
    const p = formatDecimal(times100(value), locale, { maxFractionDigits: 2 });
    return p === null ? null : `${p} %`;
  }
  return formatDecimal(value, locale, { maxFractionDigits: 4 });
}

/** Decimal text typed by a person ("1250.5", "-3", ".5" refused): the API's measure decimal shape. */
export const DECIMAL_INPUT = /^-?\d{1,15}(\.\d{1,6})?$/;

/** A percent typed by a person ("12.5") → the stored fraction ("0.125"); other unit kinds pass through. */
export function toStoredValue(input: string, unitKind: UnitKind | string): string {
  if (unitKind !== "percentage") return input;
  return new Decimal(input).dividedBy(100).toFixed();
}

/**
 * Confirms a body-less action (activate a version, submit a draft, open or close a period): POST with If-Match and no
 * body (the operation declares no request media type, S-3). One form-level alert; a 409/422 reloads the data.
 */
export function ConfirmActionDialog({
  title,
  body,
  confirmLabel,
  url,
  version,
  onDone,
  onClose,
  danger,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  url: string;
  version: number;
  onDone: (result: unknown) => Promise<boolean>;
  onClose: () => void;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setError(null);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      const result = await api.send<unknown>(url, { method: "POST", ifMatch: version });
      if (action.stale()) return;
      if (!(await onDone(result))) return;
      onClose();
    } catch (e) {
      if (action.stale(e)) return;
      setError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await onDone(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button
            type="button"
            className={`button ${danger ? "button--danger" : "button--primary"}`}
            onClick={() => void run()}
            disabled={busy}
            data-action="submit"
          >
            {busy ? t("common.state.saving") : confirmLabel}
          </button>
        </>
      }
    >
      <FormAlert error={error} namespaces={NS} />
      <div className="dialog__description">{body}</div>
    </Dialog>
  );
}
