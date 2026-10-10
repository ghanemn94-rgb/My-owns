// Change and Adoption > Leading adoption indicators (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0033 §2, §3, §6, §12).
// SYNTHETIC data only in tests and demos.
//  - REQ-PB-071: the seven leading indicators by name (the B0109-B0115 English text verbatim; Arabic marked
//    provisional), with their measures (indicator 4 has two: training completion and observed proficiency).
//  - Metric links attach a measure to the transformation, an outcome, an initiative or a stakeholder group; a KPI-fed
//    measure names a KPI or creates one from the template (REQ-S16-020 AdoptionMetricLink).
//  - Values: a measure without data is Unknown with its reason (never 0, never green); a stale value keeps its chip.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ADOPTION_TARGET_KINDS } from "@mth/shared/schemas";
import { useRegister } from "../../api/queries.ts";
import { useP4Refresh } from "../../api/p4.ts";
import type { Outcome } from "../../api/types.ts";
import { Icon } from "../../components/Icon.tsx";
import { usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { useInitiativeOptions } from "../benefits/api.ts";
import { useKpiDictionary } from "../kpi/api.ts";
import { P4FormDialog, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import { useActionRunner } from "./actions.tsx";
import {
  adoptionPaths,
  useAdoptionIndicators,
  useIndicatorTemplates,
  useMetricLinks,
  useStakeholderGroups,
  type AdoptionIndicatorTemplate,
  type AdoptionMetricLink,
} from "./api.ts";
import {
  ADOPTION_WRITE_PERMISSIONS,
  AdoptionSubNav,
  MeasureName,
  MeasureValue,
  NS,
  ProvisionalAr,
  StatusText,
  isNoReportingPeriod,
  NoReportingPeriod,
} from "./ui.tsx";

export function IndicatorsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="adoption"
      title={t("adoptionP4.indicators.title")}
      subtitle={t("adoptionP4.indicators.intro")}
      writePermissions={ADOPTION_WRITE_PERMISSIONS}
    >
      <IndicatorsBody />
    </WorkspaceFrame>
  );
}

/** Target names of this transformation (groups, initiatives, outcomes), for selects and table cells. */
export function useTargets(tid: string) {
  const { t } = useTranslation();
  const groups = useStakeholderGroups(tid, { status: "active" });
  const initiatives = useInitiativeOptions(tid);
  const outcomes = useRegister<Outcome>(tid, "outcomes");
  const options = (kind: string) =>
    kind === "stakeholder_group"
      ? (groups.data ?? []).map((g) => ({ value: g.id, label: `${g.code} · ${g.name}` }))
      : kind === "initiative"
        ? (initiatives.data ?? []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }))
        : kind === "outcome"
          ? (outcomes.data ?? []).map((o) => ({ value: o.id, label: o.statement }))
          : [];
  const name = (kind: string, id: string | null) => {
    if (kind === "transformation") return t("adoptionP4.target.transformation");
    return options(kind).find((o) => o.value === id)?.label ?? t("adoptionP4.target.unknownTarget");
  };
  return { options, name };
}

function IndicatorsBody() {
  const ws = useWorkspace();
  const templates = useIndicatorTemplates();
  return (
    <>
      <AdoptionSubNav tid={ws.tid} />
      <QueryState query={templates}>
        {(items) => (
          <>
            <TemplatesTable templates={items} />
            <ValuesSection templates={items} />
            <LinksSection templates={items} />
          </>
        )}
      </QueryState>
    </>
  );
}

function TemplatesTable({ templates }: { templates: AdoptionIndicatorTemplate[] }) {
  const { t } = useTranslation();
  const columns: RegisterColumn<AdoptionIndicatorTemplate>[] = [
    {
      id: "ordinal",
      header: t("adoptionP4.indicators.ordinal"),
      rowHeader: true,
      hideable: false,
      cell: (x) => `${x.indicatorOrdinal}.${x.measureOrdinal}`,
      sortValue: (x) => x.indicatorOrdinal * 10 + x.measureOrdinal,
    },
    {
      id: "measure",
      header: t("adoptionP4.indicators.measure"),
      cell: (x) => <MeasureName template={x} withIndicator />,
      filterText: (x) => `${x.sourceIndicatorEn} ${x.indicatorAr} ${x.measureEn} ${x.measureAr}`,
    },
    { id: "unit", header: t("adoptionP4.indicators.unit"), cell: (x) => t(`adoptionP4.unit.${x.unitKind}`) },
    {
      id: "polarity",
      header: t("adoptionP4.indicators.polarity"),
      cell: (x) => t(`adoptionP4.polarity.${x.polarity}`),
    },
    {
      id: "source",
      header: t("adoptionP4.indicators.source"),
      cell: (x) => t(`adoptionP4.valueSource.${x.valueSource}`),
    },
  ];
  return (
    <Section
      id="adoption-templates"
      title={t("adoptionP4.indicators.templatesTitle")}
      intro={
        <>
          {t("adoptionP4.indicators.templatesIntro")} <ProvisionalAr />
        </>
      }
    >
      <RegisterTable
        id="adoption-templates"
        caption={t("adoptionP4.indicators.templatesTitle")}
        rows={templates}
        columns={columns}
        getRowId={(x) => x.key}
        emptyTitle={t("adoptionP4.indicators.noTemplates")}
        defaultSort={{ id: "ordinal", dir: "asc" }}
        pageSize={25}
      />
    </Section>
  );
}

/** The measures of one target, side by side with their templates (Unknown with its reason, never 0). */
function ValuesSection({ templates }: { templates: AdoptionIndicatorTemplate[] }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const targets = useTargets(ws.tid);
  const [kind, setKind] = useState<string>("transformation");
  const [targetId, setTargetId] = useState("");
  const report = useAdoptionIndicators(ws.tid, kind, kind === "transformation" ? null : targetId || null);
  const byKey = new Map(templates.map((x) => [x.key, x]));
  return (
    <Section
      id="adoption-values"
      title={t("adoptionP4.indicators.valuesTitle")}
      intro={t("adoptionP4.indicators.valuesIntro")}
    >
      <div className="filters" role="group" aria-label={t("adoptionP4.indicators.targetLabel")}>
        <div className="filters__select">
          <label htmlFor="ind-target-kind">{t("adoptionP4.indicators.targetKind")}</label>
          <select
            id="ind-target-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setTargetId("");
            }}
          >
            {ADOPTION_TARGET_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`adoptionP4.target.${k}`)}
              </option>
            ))}
          </select>
        </div>
        {kind !== "transformation" ? (
          <div className="filters__select">
            <label htmlFor="ind-target-id">{t("adoptionP4.indicators.target")}</label>
            <select id="ind-target-id" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">{t("common.form.choose")}</option>
              {targets.options(kind).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      {kind !== "transformation" && !targetId ? (
        <p className="muted">{t("adoptionP4.indicators.chooseTarget")}</p>
      ) : report.isError && isNoReportingPeriod(report.error) ? (
        <NoReportingPeriod />
      ) : (
        <QueryState query={report}>
          {(r) => (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t("adoptionP4.indicators.valuesTable")}>
              <table className="table" data-indicator-values>
                <caption className="visually-hidden">{t("adoptionP4.indicators.valuesTitle")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("adoptionP4.indicators.measure")}</th>
                    <th scope="col">{t("adoptionP4.indicators.value")}</th>
                    <th scope="col">{t("adoptionP4.indicators.kpi")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.measures.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        {t("adoptionP4.indicators.noMeasures")}
                      </td>
                    </tr>
                  ) : (
                    r.measures.map((m) => {
                      const tpl = byKey.get(m.templateKey);
                      return (
                        <tr key={`${m.templateKey}-${m.metricLinkId ?? ""}`} data-measure-row={m.templateKey}>
                          <th scope="row">{tpl ? <MeasureName template={tpl} /> : m.templateKey}</th>
                          <td>
                            <MeasureValue measure={m} template={tpl} />
                          </td>
                          <td>
                            {m.kpiDefinitionId ? (
                              <Link className="link" to={`/transformations/${ws.tid}/kpis/${m.kpiDefinitionId}`}>
                                {t("adoptionP4.indicators.openKpi")}
                              </Link>
                            ) : (
                              <span className="muted">{t("adoptionP4.indicators.recordFed")}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      )}
    </Section>
  );
}

function LinksSection({ templates }: { templates: AdoptionIndicatorTemplate[] }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const links = useMetricLinks(ws.tid);
  const targets = useTargets(ws.tid);
  const runner = useActionRunner(ws.tid, NS);
  const [creating, setCreating] = useState(false);
  const byKey = new Map(templates.map((x) => [x.key, x]));
  const canEdit = ws.can("adoption.edit");
  const columns: RegisterColumn<AdoptionMetricLink>[] = [
    {
      id: "measure",
      header: t("adoptionP4.indicators.measure"),
      rowHeader: true,
      hideable: false,
      cell: (l) => {
        const tpl = byKey.get(l.templateKey);
        return tpl ? <MeasureName template={tpl} /> : l.templateKey;
      },
      sortValue: (l) => l.templateKey,
    },
    {
      id: "target",
      header: t("adoptionP4.indicators.target"),
      cell: (l) => (
        <span>
          {t(`adoptionP4.target.${l.targetKind}`)}: {targets.name(l.targetKind, l.targetId)}
        </span>
      ),
    },
    {
      id: "kpi",
      header: t("adoptionP4.indicators.kpi"),
      cell: (l) =>
        l.kpiDefinitionId ? (
          <Link className="link" to={`/transformations/${ws.tid}/kpis/${l.kpiDefinitionId}`}>
            {t("adoptionP4.indicators.openKpi")}
          </Link>
        ) : (
          <span className="muted">{t("adoptionP4.indicators.recordFed")}</span>
        ),
    },
    { id: "status", header: t("adoptionP4.col.status"), cell: (l) => <StatusText status={l.status} /> },
    {
      id: "rowActions",
      header: t("adoptionP4.col.actions"),
      hideable: false,
      cell: (l) =>
        canEdit && l.status === "active" ? (
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={runner.busy !== null}
            onClick={() => void runner.run(l.id, adoptionPaths.metricLinkRemove(ws.tid, l.id), l.version)}
          >
            {t("adoptionP4.indicators.removeLink")}
          </button>
        ) : null,
    },
  ];
  return (
    <Section
      id="adoption-links"
      title={t("adoptionP4.indicators.linksTitle")}
      intro={t("adoptionP4.indicators.linksIntro")}
      actions={
        canEdit ? (
          <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t("adoptionP4.indicators.addLink")}
          </button>
        ) : null
      }
    >
      {runner.alert}
      <QueryState query={links}>
        {(rows) => (
          <RegisterTable
            id="adoption-links"
            caption={t("adoptionP4.indicators.linksTitle")}
            rows={rows}
            columns={columns}
            getRowId={(l) => l.id}
            emptyTitle={t("adoptionP4.indicators.noLinks")}
            defaultSort={{ id: "measure", dir: "asc" }}
          />
        )}
      </QueryState>
      {creating ? <CreateLinkDialog templates={templates} onClose={() => setCreating(false)} /> : null}
    </Section>
  );
}

function CreateLinkDialog({ templates, onClose }: { templates: AdoptionIndicatorTemplate[]; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const targets = useTargets(ws.tid);
  const kpis = useKpiDictionary(ws.tid);
  const { people } = usePeople(ws.tid);
  const [values, setValues] = useState<P4Values>({ targetKind: "transformation", kpiMode: "create" });
  const tpl = templates.find((x) => x.key === values["templateKey"]);
  const kpiFed = (v: P4Values) => templates.find((x) => x.key === v["templateKey"])?.valueSource === "kpi_actuals";
  const ar = i18n.language === "ar";
  const fields: P4FieldSpec[] = [
    {
      name: "templateKey",
      label: t("adoptionP4.indicators.measure"),
      kind: "select",
      required: true,
      options: templates.map((x) => ({
        value: x.key,
        label: `${x.indicatorOrdinal}.${x.measureOrdinal} ${ar ? x.measureAr : x.measureEn}`,
      })),
    },
    {
      name: "targetKind",
      label: t("adoptionP4.indicators.targetKind"),
      kind: "select",
      required: true,
      options: ADOPTION_TARGET_KINDS.map((k) => ({ value: k, label: t(`adoptionP4.target.${k}`) })),
    },
    {
      name: "targetId",
      label: t("adoptionP4.indicators.target"),
      kind: "select",
      required: true,
      options: targets.options(typeof values["targetKind"] === "string" ? values["targetKind"] : ""),
      when: (v) => v["targetKind"] !== "transformation",
    },
    {
      name: "kpiMode",
      label: t("adoptionP4.indicators.kpiMode"),
      kind: "select",
      required: true,
      options: [
        { value: "create", label: t("adoptionP4.indicators.kpiCreate") },
        { value: "existing", label: t("adoptionP4.indicators.kpiExisting") },
      ],
      when: kpiFed,
    },
    {
      name: "kpiOwnerUserId",
      label: t("adoptionP4.indicators.kpiOwner"),
      kind: "select",
      required: true,
      options: people.map((p) => ({ value: p.id, label: p.label })),
      when: (v) => kpiFed(v) && v["kpiMode"] === "create",
    },
    {
      name: "kpiDefinitionId",
      label: t("adoptionP4.indicators.kpi"),
      kind: "select",
      required: true,
      options: (kpis.data ?? []).map((k) => ({ value: k.definition.id, label: k.definition.name })),
      when: (v) => kpiFed(v) && v["kpiMode"] === "existing",
    },
  ];
  return (
    <P4FormDialog
      title={t("adoptionP4.indicators.addLink")}
      description={tpl && tpl.valueSource !== "kpi_actuals" ? t("adoptionP4.indicators.recordFedNote") : undefined}
      fields={fields}
      initial={values}
      onValuesChange={setValues}
      submitLabel={t("adoptionP4.indicators.addLinkSubmit")}
      url={adoptionPaths.metricLinks(ws.tid)}
      namespaces={NS}
      toBody={(v) => ({
        templateKey: v["templateKey"],
        targetKind: v["targetKind"],
        ...(v["targetKind"] !== "transformation" ? { targetId: v["targetId"] } : {}),
        ...(kpiFed(v) && v["kpiMode"] === "create" ? { createKpi: true, kpiOwnerUserId: v["kpiOwnerUserId"] } : {}),
        ...(kpiFed(v) && v["kpiMode"] === "existing" ? { kpiDefinitionId: v["kpiDefinitionId"] } : {}),
      })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}
