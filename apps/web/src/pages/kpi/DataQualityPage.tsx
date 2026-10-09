// Strategy and KPIs > Data quality (T-DG4-FE-B; ADR-0027 §9; REQ-S16-014, REQ-S07-005, REQ-S07-006). SYNTHETIC data.
// The calculation runs record data-quality findings (missing actual, stale, out of range, evidence missing, zero
// denominator, not comparable, negative baseline, scope missing). A person with data_quality.manage resolves or
// dismisses an open finding with a note; the finding is never deleted.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { P4FormDialog } from "../my-work/p4ui.tsx";
import { kpiPaths, useDataQualityFindings, useKpiDictionary, type DataQualityFinding } from "./api.ts";
import { KpiLink, KpiSubNav, NS, RecordChip } from "./ui.tsx";

export function DataQualityPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="define"
      title={t("kpiP4.dq.title")}
      subtitle={t("kpiP4.dq.intro")}
      writePermissions={["data_quality.manage"]}
    >
      <Findings />
    </WorkspaceFrame>
  );
}

const STATUSES = ["open", "resolved", "dismissed"] as const;

function Findings() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const [status, setStatus] = useState<string>("open");
  const findings = useDataQualityFindings(ws.tid, status ? { status } : {});
  const dictionary = useKpiDictionary(ws.tid);
  const refresh = useP4Refresh(ws.tid);
  const canManage = ws.can("data_quality.manage");
  const [resolving, setResolving] = useState<DataQualityFinding | null>(null);
  const kpiName = (id: string) =>
    (dictionary.data ?? []).find((d) => d.definition.id === id)?.definition.name ?? t("kpiP4.field.kpi");
  const columns: RegisterColumn<DataQualityFinding>[] = [
    {
      id: "rule",
      header: t("kpiP4.dq.rule"),
      rowHeader: true,
      hideable: false,
      cell: (f) => (
        <span className="block" data-rule={f.ruleCode}>
          {t(`kpiP4.dq.rules.${f.ruleCode}`)}
          <span className="block small muted">{t(`kpiP4.dq.ruleHelp.${f.ruleCode}`)}</span>
        </span>
      ),
      sortValue: (f) => f.ruleCode,
      filterText: (f) => `${f.ruleCode} ${t(`kpiP4.dq.rules.${f.ruleCode}`)}`,
    },
    {
      id: "kpi",
      header: t("kpiP4.field.kpi"),
      cell: (f) => <KpiLink tid={ws.tid} kpiId={f.kpiDefinitionId} name={kpiName(f.kpiDefinitionId)} />,
      sortValue: (f) => kpiName(f.kpiDefinitionId),
    },
    {
      id: "severity",
      header: t("kpiP4.dq.severity"),
      cell: (f) => (
        <span className={`status-chip status-chip--${f.severity === "warning" ? "at-risk" : "unknown"}`}>
          <Icon name={f.severity === "warning" ? "alert" : "info"} /> {t(`kpiP4.dq.severities.${f.severity}`)}
        </span>
      ),
      sortValue: (f) => f.severity,
    },
    {
      id: "status",
      header: t("kpiP4.field.status"),
      cell: (f) => <RecordChip group="dq" status={f.status} />,
      sortValue: (f) => f.status,
    },
    {
      id: "detected",
      header: t("kpiP4.dq.detectedAt"),
      cell: (f) => formatDateTime(f.detectedAt, locale, ws.tr.timezone),
      sortValue: (f) => f.detectedAt,
    },
    {
      id: "note",
      header: t("kpiP4.dq.note"),
      cell: (f) =>
        f.resolutionNote ? (
          <span className="clamp">{f.resolutionNote}</span>
        ) : (
          <span className="muted">{t("common.value.none")}</span>
        ),
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (f) =>
        f.status === "open" && canManage ? (
          <button
            type="button"
            className="button button--link button--small"
            data-action="resolve-finding"
            onClick={() => setResolving(f)}
          >
            {t("kpiP4.dq.resolve")}
            <span className="visually-hidden">
              : {t(`kpiP4.dq.rules.${f.ruleCode}`)} · {kpiName(f.kpiDefinitionId)}
            </span>
          </button>
        ) : (
          "—"
        ),
    },
  ];
  return (
    <>
      <KpiSubNav tid={ws.tid} />
      <Section id="data-quality" title={t("kpiP4.dq.listTitle")} intro={t("kpiP4.dq.listIntro")}>
        <div className="filters">
          <label className="filters__group">
            <span className="field__label">{t("kpiP4.field.status")}</span>
            <select
              className="filters__select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              data-filter="status"
            >
              <option value="">{t("kpiP4.dq.allStatuses")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`kpiP4.dq.status.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <QueryState query={findings}>
          {(rows) => (
            <RegisterTable
              id="data-quality"
              caption={t("kpiP4.dq.listTitle")}
              rows={rows}
              columns={columns}
              getRowId={(f) => f.id}
              emptyTitle={t("kpiP4.dq.empty")}
              emptyBody={t("kpiP4.dq.emptyBody")}
              defaultSort={{ id: "detected", dir: "desc" }}
            />
          )}
        </QueryState>
      </Section>
      {resolving ? (
        <P4FormDialog
          title={t("kpiP4.dq.resolveTitle", { rule: t(`kpiP4.dq.rules.${resolving.ruleCode}`) })}
          namespaces={NS}
          url={kpiPaths.resolveFinding(ws.tid, resolving.id)}
          version={resolving.version}
          initial={{ outcome: "resolved" }}
          fields={[
            {
              name: "outcome",
              label: t("kpiP4.dq.outcome"),
              kind: "select",
              required: true,
              options: [
                { value: "resolved", label: t("kpiP4.dq.status.resolved") },
                { value: "dismissed", label: t("kpiP4.dq.status.dismissed") },
              ],
            },
            { name: "note", label: t("kpiP4.dq.note"), kind: "textarea", required: true, min: 3, max: 2000 },
          ]}
          submitLabel={t("kpiP4.dq.resolve")}
          toBody={(v) => ({ outcome: v["outcome"], note: String(v["note"]).trim() })}
          onDone={() => refresh()}
          onClose={() => setResolving(null)}
        />
      ) : null}
    </>
  );
}
