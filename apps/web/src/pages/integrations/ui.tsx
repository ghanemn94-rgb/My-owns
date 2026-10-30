// Shared presentation of Administration > Integrations (T-DG6-FE-C; ADR-0055 §1-§5, §10; p6-work-split §B/A.13).
//  - Count: a row count; null is "Unknown" (never 0).
//  - VerificationChip: "Verified" only after a succeeded test run on the current configuration; otherwise "Not
//    verified". Never "live" or "connected".
//  - LastSuccess: the derived last success; null is "Never succeeded" (never a blank or a green state).
//  - ActionableErrorPanel: the newest failed run (which run, why, what to do) with the two fallback links "Enter the
//    KPI actual by form" and "Import a file" (ADR-0055 §4; REQ-S17-005).
// Every status chip has a text label and an icon; blue is never a status colour.
import type { TFunction } from "i18next";
import { createColumnHelper, type SortingState } from "@tanstack/react-table";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import type { useCursorPager } from "../../components/DataTable.tsx";
import { ColumnPicker, DataTable, Pager, usePersistentVisibility } from "../../components/DataTable.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { placeholdersOf } from "../../lib/problem.ts";
import { Chip, type ChipTone } from "../reports/ui.tsx";
import {
  outboundDisplayStatus,
  type ActionableError,
  type ConnectorStatus,
  type IntegrationRunStatus,
  type OutboundWriteStatus,
  type ReconciliationStatus,
} from "./api.ts";
import "./integrations.css";

/** A row count: a number, or "Unknown" when null (ADR-0055 §10). */
export function Count({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <Unknown />;
  return (
    <bdi dir="ltr" data-count={value}>
      {value}
    </bdi>
  );
}

export function VerificationChip({ verification }: { verification: "verified" | "not_verified" }) {
  const { t } = useTranslation();
  return verification === "verified" ? (
    <Chip tone="good" icon="check" label={t("integrations.verification.verified")} data={verification} />
  ) : (
    <Chip tone="neutral" icon="question" label={t("integrations.verification.not_verified")} data={verification} />
  );
}

export function LastSuccess({ at }: { at: string | null }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (!at)
    return (
      <span className="status-chip status-chip--unknown" data-last-success="never">
        <Icon name="question" /> {t("integrations.lastSuccess.never")}
      </span>
    );
  return <span data-last-success={at}>{formatDateTime(at, locale)}</span>;
}

export function ConnectorStatusChip({ status }: { status: ConnectorStatus }) {
  const { t } = useTranslation();
  return status === "enabled" ? (
    <Chip tone="closed" icon="dot" label={t("integrations.status.enabled")} data={status} />
  ) : (
    <Chip tone="neutral" icon="pause" label={t("integrations.status.disabled")} data={status} />
  );
}

const RUN_STATUS: Record<IntegrationRunStatus, readonly [ChipTone, IconName]> = {
  queued: ["neutral", "clock"],
  running: ["neutral", "refresh"],
  succeeded: ["good", "check"],
  failed: ["bad", "cross"],
  cancelled: ["neutral", "stop"],
};

export function RunStatusChip({ status }: { status: IntegrationRunStatus }) {
  const { t } = useTranslation();
  const [tone, icon] = RUN_STATUS[status];
  return <Chip tone={tone} icon={icon} label={t(`integrations.runStatus.${status}`)} data={status} />;
}

const RECON: Record<ReconciliationStatus, readonly [ChipTone, IconName]> = {
  not_checked: ["neutral", "question"],
  matched: ["good", "check"],
  mismatched: ["bad", "alert"],
  not_applicable: ["neutral", "dot"],
};

export function ReconciliationChip({ status }: { status: ReconciliationStatus }) {
  const { t } = useTranslation();
  const [tone, icon] = RECON[status];
  return <Chip tone={tone} icon={icon} label={t(`integrations.reconciliation.${status}`)} data={status} />;
}

/** "Pending confirmation" for requested and pending_confirmation (never done); "Confirmed" only when confirmed. */
export function OutboundStatusChip({ status }: { status: OutboundWriteStatus }) {
  const { t } = useTranslation();
  const shown = outboundDisplayStatus(status);
  const [tone, icon]: readonly [ChipTone, IconName] =
    shown === "confirmed" ? ["good", "check"] : shown === "failed" ? ["bad", "cross"] : ["warn", "clock"];
  return <Chip tone={tone} icon={icon} label={t(`integrations.outbound.status.${shown}`)} data={status} />;
}

/**
 * The text of a catalogue entry whose placeholders the data may not fill (an actionable error's params can be empty,
 * e.g. a mapping mismatch found from the header row): the filled text when every placeholder is given, else the
 * `_noParams` variant. A placeholder is never shown raw.
 */
export function fillText(t: TFunction, key: string, params: Readonly<Record<string, unknown>> | null | undefined) {
  const template = t(key, { defaultValue: "", skipInterpolation: true });
  if (!template) return "";
  const needed = placeholdersOf(template);
  const ok =
    needed.length === 0 ||
    (params !== null &&
      params !== undefined &&
      needed.every((p) => {
        const v = params[p];
        return (typeof v === "string" && v.trim() !== "") || typeof v === "number";
      }));
  return ok ? t(key, { ...(params ?? {}), defaultValue: "" }) : t(`${key}_noParams`, { defaultValue: "" });
}

/** The i18n key stem of a code: dots become "__" ("connector.stopped" -> "connector__stopped"). */
export const codeKey = (code: string) => code.replace(/\./g, "__");

/**
 * The actionable error of a connector's newest failed run (ADR-0055 §4): which run, why, what to do, and the fallbacks
 * that keep working. `targetTransformationId` points the fallback links at the connector's target transformation;
 * without one they open the entry screens that list the transformations.
 */
export function ActionableErrorPanel({
  error,
  connectorId,
  targetTransformationId,
  showRunLink = true,
}: {
  error: ActionableError;
  connectorId: string;
  targetTransformationId: string | null;
  showRunLink?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const stem = `integrations.actionable.${codeKey(error.errorCode)}`;
  const why = fillText(t, `${stem}.why`, error.params) || t("integrations.actionable.unknownWhy");
  const todo = fillText(t, `${stem}.todo`, error.params) || t("integrations.actionable.unknownTodo");
  const kpiTo = targetTransformationId ? `/transformations/${targetTransformationId}/kpis` : "/strategy-kpis/kpis";
  const importTo = targetTransformationId
    ? `/transformations/${targetTransformationId}/imports`
    : "/strategy-kpis/imports";
  return (
    <section
      className="card integrations-error"
      aria-labelledby={`actionable-${error.runId}`}
      data-actionable-error={error.errorCode}
    >
      <h2 id={`actionable-${error.runId}`} className="card__title">
        <Icon name="alert" /> {t("integrations.actionable.title")}
      </h2>
      <dl className="facts">
        <dt>{t("integrations.actionable.whichRun")}</dt>
        <dd>
          {showRunLink ? (
            <Link className="link" to={`/admin/integrations/connectors/${connectorId}/runs/${error.runId}`}>
              {t("integrations.actionable.runRef", {
                trigger: t(`integrations.trigger.${error.triggerKind}`),
                attempt: error.attemptNo,
              })}
            </Link>
          ) : (
            t("integrations.actionable.runRef", {
              trigger: t(`integrations.trigger.${error.triggerKind}`),
              attempt: error.attemptNo,
            })
          )}{" "}
          <span className="small muted">{formatDateTime(error.finishedAt, locale)}</span>
        </dd>
        <dt>{t("integrations.actionable.why")}</dt>
        <dd data-why>{why}</dd>
        <dt>{t("integrations.actionable.whatToDo")}</dt>
        <dd data-what-to-do>{todo}</dd>
      </dl>
      <p className="small">{t("integrations.actionable.fallbackIntro")}</p>
      <ul className="plain-list integrations-error__fallbacks" data-fallbacks>
        <li>
          <Link className="link" to={kpiTo} data-fallback="kpi_form">
            {t("integrations.actionable.fallback.kpi_form")}
          </Link>
        </li>
        <li>
          <Link className="link" to={importTo} data-fallback="import_file">
            {t("integrations.actionable.fallback.import_file")}
          </Link>
        </li>
      </ul>
    </section>
  );
}

/** A secret reference shown as provider and name only; the value is never in the browser (ADR-0055 §1). */
export function SecretRefText({ value }: { value: { provider: string; name: string } }) {
  return (
    <bdi dir="ltr" className="mono" data-secret-ref>
      {value.provider}:{value.name}
    </bdi>
  );
}

/** The integrations sub-navigation (connectors, webhook endpoints, outbound writes) and the honest-status note. */
export function IntegrationsTabs({
  current,
}: {
  current: "connectors" | "webhooks" | "outbound" | "imports";
}): ReactNode {
  const { t } = useTranslation();
  const tabs = [
    { id: "connectors", to: "/admin/integrations", label: t("integrations.tabs.connectors") },
    { id: "webhooks", to: "/admin/integrations/webhooks", label: t("integrations.tabs.webhooks") },
    { id: "outbound", to: "/admin/integrations/outbound-writes", label: t("integrations.tabs.outbound") },
    // D-195 Q1: Imports live under Strategy and KPIs, with this entry from Administration > Integrations.
    { id: "imports", to: "/strategy-kpis/imports", label: t("integrations.tabs.imports") },
  ] as const;
  return (
    <>
      <nav className="toolbar integrations-tabs" aria-label={t("integrations.tabs.label")}>
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            className={`button button--small ${tab.id === current ? "button--primary" : "button--secondary"}`}
            to={tab.to}
            aria-current={tab.id === current ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <p className="banner banner--info" data-honest-status>
        <Icon name="info" /> <span>{t("integrations.honestStatus")}</span>
      </p>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ list table

/** One column of a PagedTable: a label, a cell, an optional sort value (null sorts last) and whether it can hide. */
export interface Col<T> {
  readonly id: string;
  readonly label: string;
  readonly cell: (row: T) => ReactNode;
  readonly sort?: (row: T) => string | number | null;
  readonly hideable?: boolean;
}

/**
 * A cursor-paged list (ADR-0007) with sorting of the loaded page, column selection persisted per table, and the pager.
 * The contract offers no server-side sort for these lists (ADR-0057 §5 names 11 other lists), so the sort applies to
 * the page shown and says so in the caption.
 */
export function PagedTable<T>({
  tableId,
  caption,
  rows,
  cols,
  getRowId,
  pager,
  nextCursor,
  busy,
}: {
  tableId: string;
  caption: string;
  rows: readonly T[];
  cols: readonly Col<T>[];
  getRowId: (row: T) => string;
  pager: ReturnType<typeof useCursorPager>;
  nextCursor: string | null;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [visibility, setVisibility] = usePersistentVisibility(`integrations.${tableId}`);
  const columns = useMemo(() => {
    const helper = createColumnHelper<T>();
    return cols.map((c) =>
      helper.display({
        id: c.id,
        header: () => c.label,
        cell: (ctx) => c.cell(ctx.row.original),
        enableSorting: Boolean(c.sort),
        enableHiding: c.hideable !== false,
      }),
    );
  }, [cols]);
  const sorted = useMemo(() => {
    const s = sorting[0];
    const col = s ? cols.find((c) => c.id === s.id) : undefined;
    if (!s || !col?.sort) return rows;
    const key = col.sort;
    const dir = s.desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [rows, sorting, cols]);
  return (
    <div className="integrations-table" data-table={tableId}>
      <div className="toolbar">
        <ColumnPicker
          columns={cols.map((c) => ({ id: c.id, label: c.label, hideable: c.hideable !== false }))}
          visibility={visibility}
          onChange={setVisibility}
        />
        <span className="small muted">{t("integrations.table.sortNote")}</span>
      </div>
      <DataTable
        caption={caption}
        data={sorted}
        columns={columns}
        getRowId={getRowId}
        sorting={sorting}
        onSortingChange={setSorting}
        columnVisibility={visibility}
        onColumnVisibilityChange={setVisibility}
        busy={busy ?? false}
      />
      <Pager
        pageNumber={pager.pageNumber}
        hasPrevious={pager.hasPrevious}
        hasNext={Boolean(nextCursor)}
        onPrevious={pager.previous}
        onNext={() => pager.next(nextCursor)}
        pageSize={25}
        shownCount={rows.length}
      />
    </div>
  );
}
