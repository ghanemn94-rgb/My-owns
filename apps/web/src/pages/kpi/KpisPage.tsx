// Strategy and KPIs > KPIs (T-DG4-FE-B; p4-work-split §A.5; ADR-0027 §1, §3, §12). SYNTHETIC data only.
//  - The KPI dictionary v2: each DG2 definition with its active P4 version and what is still missing before the KPI can
//    be measured (active definition, active version, aggregation rule, approved trajectory).
//  - The status overview of every KPI (listKpiStatus): the displayed RAG with its label and icon, the actual and the
//    expected value to date, and the data freshness. Unknown, Stale and Not computable are grey and labelled, never 0
//    and never green (REQ-S07-006).
//  - The organization's reporting periods: list, create, open and close (reporting_period.manage). The update due date
//    is a working-day date: without a business calendar it is Unknown, never a guessed date.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useP4Refresh } from "../../api/p4.ts";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { isNoPermission } from "../../lib/problem.ts";
import { Icon } from "../../components/Icon.tsx";
import { P4FormDialog, type P4Values } from "../my-work/p4ui.tsx";
import {
  kpiPaths,
  useKpiDictionary,
  useKpiStatusList,
  useReportingPeriods,
  type KpiDictionaryEntry,
  type KpiStatus,
  type ReportingPeriod,
} from "./api.ts";
import {
  BusinessDate,
  ConfirmActionDialog,
  KpiLink,
  KpiSubNav,
  KpiValue,
  NS,
  RagChip,
  RecordChip,
  ValueState,
} from "./ui.tsx";

export function KpisPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="define"
      title={t("kpiP4.list.title")}
      subtitle={t("kpiP4.list.intro")}
      writePermissions={["kpi_version.edit", "kpi_actual.submit", "reporting_period.manage"]}
    >
      <KpisBody />
    </WorkspaceFrame>
  );
}

function KpisBody() {
  const ws = useWorkspace();
  return (
    <>
      <KpiSubNav tid={ws.tid} />
      <StatusOverview />
      <Dictionary />
      <ReportingPeriods />
    </>
  );
}

function StatusOverview() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const status = useKpiStatusList(ws.tid);
  const columns: RegisterColumn<KpiStatus>[] = [
    {
      id: "kpi",
      header: t("kpiP4.field.kpi"),
      rowHeader: true,
      hideable: false,
      cell: (s) => <KpiLink tid={ws.tid} kpiId={s.kpiDefinitionId} name={s.kpiName} />,
      sortValue: (s) => s.kpiName,
    },
    {
      id: "rag",
      header: t("kpiP4.field.displayedRag"),
      cell: (s) => (
        <span className="chip-row">
          <RagChip rag={s.displayedRag} />
          {s.override ? <span className="small muted">{t("kpiP4.panel.overridden")}</span> : null}
        </span>
      ),
      sortValue: (s) => s.displayedRag,
    },
    {
      id: "period",
      header: t("kpiP4.field.period"),
      cell: (s) =>
        s.periodLabel ? (
          <bdi dir="ltr" className="code">
            {s.periodLabel}
          </bdi>
        ) : (
          <ValueState status="unknown" />
        ),
      sortValue: (s) => s.periodLabel,
    },
    {
      id: "actual",
      header: t("kpiP4.field.actual"),
      cell: (s) => (
        <KpiValue
          value={s.actual}
          status={s.actualStatus}
          reason={s.actualReason}
          unitKind={s.unitKind}
          currency={s.currency}
        />
      ),
    },
    {
      id: "expected",
      header: t("kpiP4.field.expectedToDate"),
      cell: (s) => (
        <KpiValue
          value={s.expectedToDate}
          status={s.expectedToDate === null ? "unknown" : "ok"}
          reason={s.expectedReason}
          unitKind={s.unitKind}
          currency={s.currency}
        />
      ),
    },
    {
      id: "freshness",
      header: t("kpiP4.field.freshness"),
      cell: (s) => (
        <span className="block">
          {t(`kpiP4.freshness.${s.freshness.status}`)}
          {s.freshness.dataAsOf ? (
            <span className="block small muted">
              {t("kpiP4.field.dataAsOf")}: <BusinessDate date={s.freshness.dataAsOf} />
            </span>
          ) : null}
        </span>
      ),
      sortValue: (s) => s.freshness.status,
    },
  ];
  return (
    <Section id="kpi-status" title={t("kpiP4.list.statusTitle")} intro={t("kpiP4.list.statusIntro")}>
      <QueryState query={status}>
        {(rows) => (
          <RegisterTable
            id="kpi-status"
            caption={t("kpiP4.list.statusTitle")}
            rows={rows}
            columns={columns}
            getRowId={(s) => `${s.kpiDefinitionId}:${s.scopeKind}:${s.scopeId}`}
            emptyTitle={t("kpiP4.list.statusEmpty")}
            emptyBody={t("kpiP4.list.statusEmptyBody")}
            defaultSort={{ id: "kpi", dir: "asc" }}
          />
        )}
      </QueryState>
    </Section>
  );
}

function Dictionary() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const dictionary = useKpiDictionary(ws.tid);
  const columns: RegisterColumn<KpiDictionaryEntry>[] = [
    {
      id: "name",
      header: t("kpiP4.field.kpi"),
      rowHeader: true,
      hideable: false,
      cell: (e) => <KpiLink tid={ws.tid} kpiId={e.definition.id} name={e.definition.name} />,
      sortValue: (e) => e.definition.name,
    },
    {
      id: "unit",
      header: t("kpi.definition.unitKind"),
      cell: (e) =>
        e.definition.unitKind ? (
          <span>
            {t(`kpi.definition.unitKinds.${e.definition.unitKind}`)}
            {e.definition.currency ? (
              <>
                {" "}
                <bdi dir="ltr" className="code small">
                  {e.definition.currency}
                </bdi>
              </>
            ) : null}
          </span>
        ) : (
          <ValueState status="unknown" />
        ),
      sortValue: (e) => e.definition.unitKind,
    },
    {
      id: "frequency",
      header: t("kpi.definition.frequency"),
      cell: (e) =>
        e.definition.frequency ? (
          t(`kpi.definition.frequencies.${e.definition.frequency}`)
        ) : (
          <ValueState status="unknown" />
        ),
      sortValue: (e) => e.definition.frequency,
    },
    {
      id: "version",
      header: t("kpiP4.field.activeVersion"),
      cell: (e) =>
        e.activeVersion ? (
          <span className="block">
            {t("kpiP4.version.label", { n: e.activeVersion.versionNo })}
            <span className="block small muted">
              {t(`kpiP4.measureType.${e.activeVersion.measureType}`)} ·{" "}
              {e.activeVersion.aggregationRule
                ? t(`kpiP4.aggregation.${e.activeVersion.aggregationRule}`)
                : t("kpiP4.aggregation.missing")}
            </span>
          </span>
        ) : (
          <span className="muted">{t("kpiP4.version.none")}</span>
        ),
      sortValue: (e) => e.activeVersion?.versionNo ?? null,
    },
    {
      id: "missing",
      header: t("kpiP4.field.missingForUse"),
      cell: (e) =>
        e.missingForUse.length === 0 ? (
          <span className="status-chip status-chip--on-track" data-ready="true">
            <Icon name="check" /> {t("kpiP4.missing.ready")}
          </span>
        ) : (
          <ul className="plain-list" data-ready="false">
            {e.missingForUse.map((m) => (
              <li key={m}>
                <Icon name="alert" /> {t(`kpiP4.missing.${m}`)}
              </li>
            ))}
          </ul>
        ),
      sortValue: (e) => e.missingForUse.length,
    },
    {
      id: "draft",
      header: t("kpiP4.field.draftVersion"),
      cell: (e) => (e.draftVersionId ? t("kpiP4.version.draftExists") : t("common.value.none")),
    },
  ];
  return (
    <Section id="kpi-dictionary" title={t("kpiP4.list.dictionaryTitle")} intro={t("kpiP4.list.dictionaryIntro")}>
      <QueryState query={dictionary}>
        {(rows) => (
          <RegisterTable
            id="kpi-dictionary"
            caption={t("kpiP4.list.dictionaryTitle")}
            rows={rows}
            columns={columns}
            getRowId={(e) => e.definition.id}
            emptyTitle={t("kpiP4.list.dictionaryEmpty")}
            emptyBody={t("kpiP4.list.dictionaryEmptyBody")}
            defaultSort={{ id: "name", dir: "asc" }}
          />
        )}
      </QueryState>
    </Section>
  );
}

const FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "annual", "ad_hoc"] as const;

function ReportingPeriods() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const orgId = ws.tr.organizationId;
  const periods = useReportingPeriods(ws.tid, orgId);
  const refresh = useP4Refresh(ws.tid);
  const canManage = ws.can("reporting_period.manage");
  const [creating, setCreating] = useState(false);
  const [stepping, setStepping] = useState<{ p: ReportingPeriod; to: "open" | "close" } | null>(null);

  const columns: RegisterColumn<ReportingPeriod>[] = [
    {
      id: "label",
      header: t("kpiP4.period.label"),
      rowHeader: true,
      hideable: false,
      cell: (p) => (
        <bdi dir="ltr" className="code" data-period={p.periodLabel}>
          {p.periodLabel}
        </bdi>
      ),
      sortValue: (p) => p.periodStart,
    },
    {
      id: "frequency",
      header: t("kpi.definition.frequency"),
      cell: (p) => t(`kpi.definition.frequencies.${p.frequency}`),
      sortValue: (p) => p.frequency,
    },
    {
      id: "range",
      header: t("kpiP4.period.range"),
      cell: (p) => (
        <span>
          <BusinessDate date={p.periodStart} /> – <BusinessDate date={p.periodEnd} />
          {p.basis === "weeks" && p.weekCount ? (
            <span className="block small muted">{t("kpiP4.period.weeks", { n: p.weekCount })}</span>
          ) : null}
        </span>
      ),
      sortValue: (p) => p.periodStart,
    },
    {
      id: "due",
      header: t("kpiP4.period.updateDue"),
      cell: (p) =>
        p.updateDueDate ? (
          <BusinessDate date={p.updateDueDate} />
        ) : (
          <ValueState status="unknown" reason="kpi.due_date_unknown" />
        ),
      sortValue: (p) => p.updateDueDate,
    },
    {
      id: "status",
      header: t("kpiP4.field.status"),
      cell: (p) => <RecordChip group="period" status={p.status} />,
      sortValue: (p) => p.status,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (p) =>
        !canManage || p.status === "closed" ? (
          <span className="muted small">
            {p.status === "closed" ? t("kpiP4.period.closedNote") : t("common.readOnly")}
          </span>
        ) : (
          <button
            type="button"
            className="button button--link button--small"
            data-action={p.status === "scheduled" ? "open-period" : "close-period"}
            onClick={() => setStepping({ p, to: p.status === "scheduled" ? "open" : "close" })}
          >
            {p.status === "scheduled" ? t("kpiP4.period.open") : t("kpiP4.period.close")}
            <span className="visually-hidden">: {p.periodLabel}</span>
          </button>
        ),
    },
  ];

  return (
    <Section
      id="reporting-periods"
      title={t("kpiP4.period.title")}
      intro={t("kpiP4.period.intro")}
      actions={
        canManage ? (
          <button type="button" className="button button--secondary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t("kpiP4.period.add")}
          </button>
        ) : null
      }
    >
      {periods.isError && isNoPermission(periods.error) ? (
        <p className="banner banner--info" role="note" data-state="periods-org-only">
          <Icon name="lock" /> {t("kpiP4.period.orgOnly")}
        </p>
      ) : (
        <QueryState query={periods}>
          {(rows) => (
            <RegisterTable
              id="reporting-periods"
              caption={t("kpiP4.period.title")}
              rows={rows}
              columns={columns}
              getRowId={(p) => p.id}
              emptyTitle={t("kpiP4.period.empty")}
              emptyBody={t("kpiP4.period.emptyBody")}
              defaultSort={{ id: "label", dir: "desc" }}
            />
          )}
        </QueryState>
      )}
      {creating ? (
        <P4FormDialog
          title={t("kpiP4.period.add")}
          namespaces={NS}
          url={kpiPaths.periods(orgId)}
          submitLabel={t("kpiP4.period.create")}
          initial={{ basis: "calendar", frequency: "monthly" }}
          fields={[
            {
              name: "frequency",
              label: t("kpi.definition.frequency"),
              kind: "select",
              required: true,
              options: FREQUENCIES.map((f) => ({ value: f, label: t(`kpi.definition.frequencies.${f}`) })),
            },
            {
              name: "periodLabel",
              label: t("kpiP4.period.label"),
              kind: "text",
              required: true,
              max: 32,
              ltr: true,
              hint: t("kpiP4.period.labelHint"),
            },
            { name: "periodStart", label: t("kpiP4.period.start"), kind: "date", required: true },
            { name: "periodEnd", label: t("kpiP4.period.end"), kind: "date", required: true },
            {
              name: "basis",
              label: t("kpiP4.period.basis"),
              kind: "select",
              required: true,
              options: [
                { value: "calendar", label: t("kpiP4.period.bases.calendar") },
                { value: "weeks", label: t("kpiP4.period.bases.weeks") },
              ],
            },
            {
              name: "weekCount",
              label: t("kpiP4.period.weekCount"),
              kind: "number",
              required: true,
              min: 1,
              max: 53,
              when: (v) => v["basis"] === "weeks",
            },
            {
              name: "updateDueDate",
              label: t("kpiP4.period.updateDue"),
              kind: "date",
              hint: t("kpiP4.period.updateDueHint"),
            },
          ]}
          toBody={(v: P4Values) => ({
            frequency: v["frequency"],
            periodLabel: String(v["periodLabel"]).trim(),
            periodStart: v["periodStart"],
            periodEnd: v["periodEnd"],
            basis: v["basis"],
            ...(v["basis"] === "weeks" ? { weekCount: Number(v["weekCount"]) } : {}),
            ...(v["updateDueDate"] ? { updateDueDate: v["updateDueDate"] } : {}),
          })}
          onDone={() => refresh()}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {stepping ? (
        <ConfirmActionDialog
          title={
            stepping.to === "open"
              ? t("kpiP4.period.openTitle", { label: stepping.p.periodLabel })
              : t("kpiP4.period.closeTitle", { label: stepping.p.periodLabel })
          }
          body={stepping.to === "open" ? t("kpiP4.period.openBody") : t("kpiP4.period.closeBody")}
          confirmLabel={stepping.to === "open" ? t("kpiP4.period.open") : t("kpiP4.period.close")}
          url={
            stepping.to === "open"
              ? kpiPaths.openPeriod(orgId, stepping.p.id)
              : kpiPaths.closePeriod(orgId, stepping.p.id)
          }
          version={stepping.p.version}
          danger={stepping.to === "close"}
          onDone={() => refresh()}
          onClose={() => setStepping(null)}
        />
      ) : null}
    </Section>
  );
}
