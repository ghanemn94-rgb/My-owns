// Diagnose (Phase 1) screen: T01 Current-State Diagnostic grid of the six seeded dimensions (REQ-PB-026), findings
// and outputs of the six Diagnose workstreams with their key questions (REQ-PB-023), baselines (REQ-PB-027) and value
// pools (REQ-PB-028). Amounts go through @mth/shared value.ts; an unquantified value pool is labelled, never 0, and
// the total says "partial: N unquantified". Missing values show Unknown. All writes are re-checked by the server.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  baselineCreate,
  baselineUpdate,
  BASELINE_SCOPES,
  CONFIDENCES,
  diagnosticFindingCreate,
  diagnosticFindingUpdate,
  diagnosticItemCreate,
  diagnosticItemUpdate,
  FINDING_KINDS,
  FINDING_STATUSES,
  MATERIALITIES,
  valuePoolCreate,
  valuePoolUpdate,
  workstreamOutputCreate,
  workstreamOutputUpdate,
} from "@mth/shared/schemas";
import { useP2Refresh, useRegister } from "../../api/queries.ts";
import type {
  Baseline,
  DiagnosticFinding,
  DiagnosticItem,
  KpiDefinition,
  ValuePool,
  WorkstreamOutput,
} from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Amount, AmountRange, Unquantified, ValuePoolTotals } from "../../components/Amount.tsx";
import { Icon } from "../../components/Icon.tsx";
import { ConfidenceChip, RecordStatus, ValidationChip } from "../../components/P2Badges.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { ArchiveAction, NoteDecisionDialog } from "../../components/RowActions.tsx";
import { Section, SectionNav, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { diagnosticDimensionLabel, pick, workstreamName, workstreamOptions } from "../../lib/methodology.ts";

export function DiagnosePage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="diagnose"
      title={t("diagnose.title")}
      subtitle={t("diagnose.intro")}
      writePermissions={["diagnostic.edit", "diagnostic.contribute", "baseline.edit", "finance.validate"]}
    >
      <SectionNav
        sections={[
          { id: "t01", title: t("diagnose.t01.title") },
          { id: "workstreams", title: t("diagnose.workstreams.title") },
          { id: "baselines", title: t("kpi.baseline.title") },
          { id: "value-pools", title: t("kpi.valuePool.title") },
        ]}
      />
      <T01Section />
      <WorkstreamsSection />
      <BaselinesSection />
      <ValuePoolsSection />
    </WorkspaceFrame>
  );
}

// ------------------------------------------------------------------------------------------------ T01

interface T01Row {
  readonly code: string;
  readonly label: string;
  readonly evidenceHint: string | null;
  readonly impactHint: string | null;
  readonly item: DiagnosticItem | null;
}

function T01Section() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const refresh = useP2Refresh(ws.tid);
  const items = useRegister<DiagnosticItem>(ws.tid, "diagnostic-items");
  const kpis = useRegister<KpiDefinition>(ws.tid, "kpi-definitions");
  const baselines = useRegister<Baseline>(ws.tid, "baselines");
  const { people, byId } = usePeople(ws.tid);
  const [editing, setEditing] = useState<{ row: T01Row } | null>(null);

  const kpiOptions = (kpis.data ?? [])
    .filter((k) => k.status !== "archived")
    .map((k) => ({ value: k.id, label: k.name }));
  const baselineOptions = (baselines.data ?? [])
    .filter((b) => b.status !== "archived")
    .map((b) => ({ value: b.id, label: b.metric }));
  const currencyOptions = [...new Set([ws.tr.currency, "SAR"])].map((c) => ({ value: c, label: c }));
  const dimensions = [...ws.methodology.diagnosticDimensions].sort((a, b) => a.ordinal - b.ordinal);

  const fields = (row: T01Row): FieldSpec[] => [
    {
      name: "dimensionCode",
      kind: "select",
      label: t("diagnose.t01.dimension"),
      readOnly: true,
      options: [{ value: row.code, label: row.label }],
    },
    { name: "currentState", kind: "textarea", label: t("diagnose.t01.currentState"), rows: 4 },
    {
      name: "evidenceBaseline",
      kind: "textarea",
      label: t("diagnose.t01.evidenceBaseline"),
      ...(row.evidenceHint ? { hint: row.evidenceHint } : {}),
    },
    { name: "baselineId", kind: "select", label: t("diagnose.t01.linkedBaseline"), options: baselineOptions },
    { name: "rootCause", kind: "textarea", label: t("diagnose.t01.rootCause"), rows: 4 },
    {
      name: "impactText",
      kind: "textarea",
      label: t("diagnose.t01.impactText"),
      ...(row.impactHint ? { hint: row.impactHint } : {}),
    },
    { name: "impactAmount", kind: "decimal", label: t("diagnose.t01.impactAmount"), hint: t("kpi.decimalHint") },
    {
      name: "impactCurrency",
      kind: "select",
      label: t("diagnose.t01.impactCurrency"),
      hint: t("diagnose.t01.impactCurrencyHint"),
      options: currencyOptions,
    },
    { name: "impactKpiDefinitionId", kind: "select", label: t("diagnose.t01.impactKpi"), options: kpiOptions },
    {
      name: "confidence",
      kind: "select",
      label: t("diagnose.confidence.label"),
      options: CONFIDENCES.map((c) => ({ value: c, label: t(`diagnose.confidence.${c}`) })),
    },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner") },
  ];

  return (
    <Section id="t01" title={t("diagnose.t01.title")} intro={t("diagnose.t01.intro")}>
      <QueryState query={items}>
        {(list) => {
          const known = new Set(dimensions.map((d) => d.code));
          const rows: T01Row[] = [
            ...dimensions.map((d) => ({
              code: d.code,
              label: pick(locale, d.labelEn, d.labelAr),
              evidenceHint: pick(locale, d.evidenceHintEn, d.evidenceHintAr),
              impactHint: pick(locale, d.impactHintEn, d.impactHintAr),
              item: list.find((i) => i.dimensionCode === d.code && i.status !== "archived") ?? null,
            })),
            ...list
              .filter((i) => !known.has(i.dimensionCode) && i.status !== "archived")
              .map((i) => ({
                code: i.dimensionCode,
                label: i.dimensionCode,
                evidenceHint: null,
                impactHint: null,
                item: i,
              })),
          ];
          const columns: RegisterColumn<T01Row>[] = [
            {
              id: "dimension",
              header: t("diagnose.t01.dimension"),
              cell: (r) => r.label,
              sortValue: (r) => r.label,
              hideable: false,
              rowHeader: true,
            },
            {
              id: "currentState",
              header: t("diagnose.t01.currentState"),
              cell: (r) => (r.item?.currentState ? <TextCell value={r.item.currentState} /> : <Unknown />),
              sortValue: (r) => r.item?.currentState,
            },
            {
              id: "evidence",
              header: t("diagnose.t01.evidenceBaseline"),
              cell: (r) =>
                r.item && (r.item.evidenceBaseline || r.item.baselineId) ? (
                  <>
                    {r.item.evidenceBaseline ? <TextCell value={r.item.evidenceBaseline} /> : null}
                    {r.item.baselineId ? (
                      <span className="block small">
                        {t("diagnose.t01.linkedBaseline")}:{" "}
                        {baselines.data?.find((b) => b.id === r.item!.baselineId)?.metric ?? <Unknown />}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <Unknown />
                ),
              filterText: (r) => r.item?.evidenceBaseline,
            },
            {
              id: "rootCause",
              header: t("diagnose.t01.rootCause"),
              cell: (r) => (r.item?.rootCause ? <TextCell value={r.item.rootCause} /> : <Unknown />),
              sortValue: (r) => r.item?.rootCause,
            },
            {
              id: "impact",
              header: t("diagnose.t01.impact"),
              cell: (r) => <ImpactCell item={r.item} kpis={kpis.data ?? []} />,
              filterText: (r) => r.item?.impactText,
            },
            {
              id: "confidence",
              header: t("diagnose.confidence.label"),
              cell: (r) => <ConfidenceChip value={r.item?.confidence} />,
              sortValue: (r) => (r.item?.confidence ? "HML".indexOf(r.item.confidence) : null),
            },
            {
              id: "owner",
              header: t("common.field.owner"),
              cell: (r) => <PersonName id={r.item?.ownerUserId} people={byId} />,
              sortValue: (r) => (r.item?.ownerUserId ? (byId.get(r.item.ownerUserId)?.label ?? "") : null),
            },
            {
              id: "actions",
              header: t("common.field.actions"),
              hideable: false,
              cell: (r) =>
                ws.canWriteRow("diagnostic.edit", "diagnostic.contribute", r.item) ? (
                  <button
                    type="button"
                    className="button button--link button--small"
                    onClick={() => setEditing({ row: r })}
                  >
                    <Icon name="pencil" /> {r.item ? t("common.action.edit") : t("diagnose.t01.fill")}
                    <span className="visually-hidden">: {r.label}</span>
                  </button>
                ) : (
                  <span className="muted small">{t("common.readOnly")}</span>
                ),
            },
          ];
          return (
            <RegisterTable
              id="t01"
              caption={t("diagnose.t01.title")}
              rows={rows}
              columns={columns}
              getRowId={(r) => r.code}
              emptyTitle={t("diagnose.t01.empty")}
            />
          );
        }}
      </QueryState>
      {editing ? (
        <RecordDialog<DiagnosticItem>
          title={t("diagnose.t01.editTitle", { dimension: editing.row.label })}
          fields={fields(editing.row)}
          record={editing.row.item}
          defaults={{ dimensionCode: editing.row.code, impactCurrency: ws.tr.currency }}
          createSchema={diagnosticItemCreate}
          updateSchema={diagnosticItemUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/diagnostic-items`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/diagnostic-items/${r.id}`}
          people={people}
          submitLabel={t("common.action.saveDraft")}
          onSaved={async () => {
            await refresh();
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </Section>
  );
}

function ImpactCell({ item, kpis }: { item: DiagnosticItem | null; kpis: readonly KpiDefinition[] }) {
  const { t } = useTranslation();
  if (!item) return <Unknown />;
  const kpi = item.impactKpiDefinitionId ? kpis.find((k) => k.id === item.impactKpiDefinitionId) : undefined;
  const parts = [
    item.impactAmount !== null ? (
      <span key="amount" className="block">
        <Amount value={item.impactAmount} currency={item.impactCurrency} />
      </span>
    ) : null,
    item.impactKpiDefinitionId ? (
      <span key="kpi" className="block">
        {t("diagnose.t01.impactKpiShort")}: {kpi ? kpi.name : <Unknown />}
      </span>
    ) : null,
    item.impactText ? (
      <span key="text" className="block text-cell">
        {item.impactText}
      </span>
    ) : null,
  ].filter(Boolean);
  return parts.length > 0 ? <>{parts}</> : <Unknown hint={t("diagnose.t01.impactMissing")} />;
}

// ------------------------------------------------------------------------------------------------ workstreams

function WorkstreamsSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const findings = useRegister<DiagnosticFinding>(ws.tid, "diagnostic-findings");
  const outputs = useRegister<WorkstreamOutput>(ws.tid, "workstream-outputs");
  const items = useRegister<DiagnosticItem>(ws.tid, "diagnostic-items");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [findingDialog, setFindingDialog] = useState<{ record: DiagnosticFinding | null; workstream: string } | null>(
    null,
  );
  const [outputDialog, setOutputDialog] = useState<{ record: WorkstreamOutput | null; workstream: string } | null>(
    null,
  );
  const streams = [...ws.methodology.diagnosticWorkstreams].sort((a, b) => a.ordinal - b.ordinal);
  const canCreate = ws.canAny("diagnostic.edit", "diagnostic.contribute");

  const itemOptions = (items.data ?? [])
    .filter((i) => i.status !== "archived")
    .map((i) => ({
      value: i.id,
      label: diagnosticDimensionLabel(ws.methodology, i.dimensionCode, locale) ?? i.dimensionCode,
    }));

  const findingFields: FieldSpec[] = [
    {
      name: "workstreamCode",
      kind: "select",
      label: t("diagnose.workstreams.workstream"),
      required: true,
      options: workstreamOptions(ws.methodology, locale),
    },
    { name: "statement", kind: "textarea", label: t("diagnose.finding.statement"), required: true, maxLength: 2000 },
    {
      name: "kind",
      kind: "select",
      label: t("diagnose.finding.kind"),
      required: true,
      options: FINDING_KINDS.map((k) => ({ value: k, label: t(`diagnose.finding.kinds.${k}`) })),
    },
    { name: "detail", kind: "textarea", label: t("diagnose.finding.detail"), rows: 4 },
    { name: "diagnosticItemId", kind: "select", label: t("diagnose.finding.t01Row"), options: itemOptions },
    {
      name: "confidence",
      kind: "select",
      label: t("diagnose.confidence.label"),
      options: CONFIDENCES.map((c) => ({ value: c, label: t(`diagnose.confidence.${c}`) })),
    },
    {
      name: "status",
      kind: "select",
      label: t("common.field.status"),
      hint: t("diagnose.finding.statusHint"),
      options: FINDING_STATUSES.filter((s) => s !== "archived").map((s) => ({
        value: s,
        label: t(`common.recordStatus.${s}`),
      })),
    },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner") },
  ];
  const outputFields: FieldSpec[] = [
    {
      name: "workstreamCode",
      kind: "select",
      label: t("diagnose.workstreams.workstream"),
      required: true,
      options: workstreamOptions(ws.methodology, locale),
    },
    { name: "title", kind: "text", label: t("diagnose.output.titleField"), required: true, maxLength: 300 },
    { name: "outputKind", kind: "text", label: t("diagnose.output.kind"), maxLength: 100 },
    { name: "note", kind: "textarea", label: t("diagnose.output.note") },
  ];

  return (
    <Section id="workstreams" title={t("diagnose.workstreams.title")} intro={t("diagnose.workstreams.intro")}>
      <QueryState query={findings}>
        {(allFindings) => (
          <div className="workstreams">
            {streams.map((w) => {
              const rows = allFindings.filter((f) => f.workstreamCode === w.code && f.status !== "archived");
              const outs = (outputs.data ?? []).filter((o) => o.workstreamCode === w.code && o.status !== "archived");
              const name = pick(locale, w.sourceNameEn, w.nameAr);
              const columns: RegisterColumn<DiagnosticFinding>[] = [
                {
                  id: "statement",
                  header: t("diagnose.finding.statement"),
                  cell: (f) => <span className="text-cell">{f.statement}</span>,
                  sortValue: (f) => f.statement,
                  hideable: false,
                  rowHeader: true,
                },
                {
                  id: "kind",
                  header: t("diagnose.finding.kind"),
                  cell: (f) => t(`diagnose.finding.kinds.${f.kind}`),
                  sortValue: (f) => t(`diagnose.finding.kinds.${f.kind}`),
                },
                {
                  id: "t01",
                  header: t("diagnose.finding.t01Row"),
                  cell: (f) => {
                    const item = items.data?.find((i) => i.id === f.diagnosticItemId);
                    return item ? (
                      (diagnosticDimensionLabel(ws.methodology, item.dimensionCode, locale) ?? item.dimensionCode)
                    ) : (
                      <span className="muted">{t("common.value.none")}</span>
                    );
                  },
                },
                {
                  id: "confidence",
                  header: t("diagnose.confidence.label"),
                  cell: (f) => <ConfidenceChip value={f.confidence} />,
                  sortValue: (f) => (f.confidence ? "HML".indexOf(f.confidence) : null),
                },
                {
                  id: "status",
                  header: t("common.field.status"),
                  cell: (f) => <RecordStatus status={f.status} />,
                  sortValue: (f) => f.status,
                },
                {
                  id: "owner",
                  header: t("common.field.owner"),
                  cell: (f) => <PersonName id={f.ownerUserId} people={byId} />,
                },
                {
                  id: "actions",
                  header: t("common.field.actions"),
                  hideable: false,
                  cell: (f) =>
                    ws.canWriteRow("diagnostic.edit", "diagnostic.contribute", f) ? (
                      <span className="row-actions">
                        <button
                          type="button"
                          className="button button--link button--small"
                          onClick={() => setFindingDialog({ record: f, workstream: w.code })}
                        >
                          <Icon name="pencil" /> {t("common.action.edit")}
                          <span className="visually-hidden">: {f.statement}</span>
                        </button>
                        <ArchiveAction
                          url={`/api/v1/transformations/${ws.tid}/diagnostic-findings/${f.id}`}
                          version={f.version}
                          name={f.statement}
                          onDone={refresh}
                        />
                      </span>
                    ) : (
                      <span className="muted small">{t("common.readOnly")}</span>
                    ),
                },
              ];
              return (
                <article key={w.code} className="workstream" aria-labelledby={`ws-${w.code}`} data-workstream={w.code}>
                  <div className="card__header">
                    <h3 id={`ws-${w.code}`} className="card__subtitle">
                      {name}
                    </h3>
                    {canCreate ? (
                      <span className="section__actions">
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={() => setFindingDialog({ record: null, workstream: w.code })}
                        >
                          <Icon name="plus" /> {t("diagnose.finding.add")}
                          <span className="visually-hidden">: {name}</span>
                        </button>
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={() => setOutputDialog({ record: null, workstream: w.code })}
                        >
                          <Icon name="plus" /> {t("diagnose.output.add")}
                          <span className="visually-hidden">: {name}</span>
                        </button>
                      </span>
                    ) : null}
                  </div>
                  <dl className="details details--compact">
                    <div>
                      <dt>{t("diagnose.workstreams.keyQuestions")}</dt>
                      <dd>{pick(locale, w.sourceKeyQuestionsEn, w.keyQuestionsAr)}</dd>
                    </div>
                    <div>
                      <dt>{t("diagnose.workstreams.typicalOutputs")}</dt>
                      <dd>{pick(locale, w.sourceTypicalOutputsEn, w.typicalOutputsAr)}</dd>
                    </div>
                  </dl>
                  <RegisterTable
                    id={`findings-${w.code}`}
                    caption={t("diagnose.finding.caption", { workstream: name })}
                    rows={rows}
                    columns={columns}
                    getRowId={(f) => f.id}
                    emptyTitle={t("diagnose.finding.empty")}
                    pageSize={5}
                  />
                  <h4 className="small-heading">{t("diagnose.output.title")}</h4>
                  {outs.length === 0 ? (
                    <p className="muted">{t("diagnose.output.empty")}</p>
                  ) : (
                    <ul className="plain-list output-list">
                      {outs.map((o) => (
                        <li key={o.id}>
                          <strong>{o.title}</strong>
                          {o.outputKind ? <span className="muted"> · {o.outputKind}</span> : null}
                          {o.note ? <span className="block text-cell">{o.note}</span> : null}
                          {ws.canWriteRow("diagnostic.edit", "diagnostic.contribute", o) ? (
                            <span className="row-actions">
                              <button
                                type="button"
                                className="button button--link button--small"
                                onClick={() => setOutputDialog({ record: o, workstream: w.code })}
                              >
                                <Icon name="pencil" /> {t("common.action.edit")}
                                <span className="visually-hidden">: {o.title}</span>
                              </button>
                              <ArchiveAction
                                url={`/api/v1/transformations/${ws.tid}/workstream-outputs/${o.id}`}
                                version={o.version}
                                name={o.title}
                                onDone={refresh}
                              />
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </QueryState>
      {findingDialog ? (
        <RecordDialog<DiagnosticFinding>
          title={findingDialog.record ? t("diagnose.finding.editTitle") : t("diagnose.finding.add")}
          fields={findingFields}
          record={findingDialog.record}
          defaults={{ workstreamCode: findingDialog.workstream, status: "draft", ownerUserId: ws.meId }}
          createSchema={diagnosticFindingCreate}
          updateSchema={diagnosticFindingUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/diagnostic-findings`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/diagnostic-findings/${r.id}`}
          people={people}
          submitLabel={findingDialog.record ? t("common.action.save") : t("common.action.create")}
          onSaved={async () => {
            await refresh();
            setFindingDialog(null);
          }}
          onCancel={() => setFindingDialog(null)}
        />
      ) : null}
      {outputDialog ? (
        <RecordDialog<WorkstreamOutput>
          title={outputDialog.record ? t("diagnose.output.editTitle") : t("diagnose.output.add")}
          fields={outputFields}
          record={outputDialog.record}
          defaults={{ workstreamCode: outputDialog.workstream }}
          createSchema={workstreamOutputCreate}
          updateSchema={workstreamOutputUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/workstream-outputs`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/workstream-outputs/${r.id}`}
          people={people}
          submitLabel={outputDialog.record ? t("common.action.save") : t("common.action.create")}
          onSaved={async () => {
            await refresh();
            setOutputDialog(null);
          }}
          onCancel={() => setOutputDialog(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ baselines

function BaselinesSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const baselines = useRegister<Baseline>(ws.tid, "baselines");
  const kpis = useRegister<KpiDefinition>(ws.tid, "kpi-definitions");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [dialog, setDialog] = useState<{ record: Baseline | null } | null>(null);
  const [validating, setValidating] = useState<Baseline | null>(null);
  const canEdit = ws.can("baseline.edit");
  const canValidate = ws.can("finance.validate");

  const fields: FieldSpec[] = [
    { name: "metric", kind: "text", label: t("kpi.baseline.metric"), required: true, maxLength: 300 },
    { name: "value", kind: "decimal", label: t("kpi.baseline.value"), hint: t("kpi.decimalHint") },
    { name: "unit", kind: "text", label: t("kpi.baseline.unit"), required: true, maxLength: 50 },
    {
      name: "currency",
      kind: "select",
      label: t("common.field.currency"),
      options: [...new Set([ws.tr.currency, "SAR"])].map((c) => ({ value: c, label: c })),
    },
    { name: "source", kind: "textarea", label: t("kpi.baseline.source"), hint: t("kpi.baseline.sourceHint") },
    { name: "baselineDate", kind: "date", label: t("kpi.baseline.date") },
    {
      name: "scope",
      kind: "select",
      label: t("kpi.baseline.scope"),
      required: true,
      options: BASELINE_SCOPES.map((s) => ({ value: s, label: t(`kpi.baseline.scopes.${s}`) })),
    },
    {
      name: "kpiDefinitionId",
      kind: "select",
      label: t("kpi.definition.single"),
      options: (kpis.data ?? []).filter((k) => k.status !== "archived").map((k) => ({ value: k.id, label: k.name })),
    },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner") },
  ];

  const columns: RegisterColumn<Baseline>[] = [
    {
      id: "metric",
      header: t("kpi.baseline.metric"),
      cell: (b) => b.metric,
      sortValue: (b) => b.metric,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "value",
      header: t("kpi.baseline.value"),
      cell: (b) =>
        b.value === null ? (
          <Unknown hint={t("kpi.baseline.notMeasured")} />
        ) : (
          <span>
            <Amount value={b.value} currency={b.currency} maxFractionDigits={6} />{" "}
            <span className="muted">{b.unit}</span>
          </span>
        ),
      filterText: (b) => `${b.value ?? ""} ${b.unit}`,
    },
    {
      id: "source",
      header: t("kpi.baseline.source"),
      cell: (b) => (b.source ? <TextCell value={b.source} /> : <Unknown />),
      sortValue: (b) => b.source,
    },
    {
      id: "date",
      header: t("kpi.baseline.date"),
      cell: (b) => formatBusinessDate(b.baselineDate, locale) ?? <Unknown />,
      sortValue: (b) => b.baselineDate,
    },
    {
      id: "scope",
      header: t("kpi.baseline.scope"),
      cell: (b) => t(`kpi.baseline.scopes.${b.scope}`),
      sortValue: (b) => b.scope,
    },
    {
      id: "validation",
      header: t("kpi.validation.label"),
      cell: (b) => <ValidationChip record={b} />,
      sortValue: (b) => b.validationStatus,
    },
    { id: "owner", header: t("common.field.owner"), cell: (b) => <PersonName id={b.ownerUserId} people={byId} /> },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (b) =>
        canEdit || canValidate ? (
          <span className="row-actions">
            {canEdit ? (
              <button
                type="button"
                className="button button--link button--small"
                onClick={() => setDialog({ record: b })}
              >
                <Icon name="pencil" /> {t("common.action.edit")}
                <span className="visually-hidden">: {b.metric}</span>
              </button>
            ) : null}
            {canValidate ? (
              <button type="button" className="button button--link button--small" onClick={() => setValidating(b)}>
                <Icon name="check" /> {t("kpi.validation.action")}
                <span className="visually-hidden">: {b.metric}</span>
              </button>
            ) : null}
            {canEdit ? (
              <ArchiveAction
                url={`/api/v1/transformations/${ws.tid}/baselines/${b.id}`}
                version={b.version}
                name={b.metric}
                onDone={refresh}
              />
            ) : null}
          </span>
        ) : (
          <span className="muted small">{t("common.readOnly")}</span>
        ),
    },
  ];

  return (
    <Section
      id="baselines"
      title={t("kpi.baseline.title")}
      intro={t("kpi.baseline.intro")}
      actions={
        canEdit ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setDialog({ record: null })}
          >
            <Icon name="plus" /> {t("kpi.baseline.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={baselines}>
        {(list) => (
          <RegisterTable
            id="baselines"
            caption={t("kpi.baseline.title")}
            rows={list.filter((b) => b.status !== "archived")}
            columns={columns}
            getRowId={(b) => b.id}
            emptyTitle={t("kpi.baseline.empty")}
            emptyBody={t("kpi.baseline.emptyBody")}
          />
        )}
      </QueryState>
      {dialog ? (
        <RecordDialog<Baseline>
          title={dialog.record ? t("kpi.baseline.editTitle") : t("kpi.baseline.add")}
          fields={fields}
          record={dialog.record}
          defaults={{ ownerUserId: ws.meId }}
          createSchema={baselineCreate}
          updateSchema={baselineUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/baselines`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/baselines/${r.id}`}
          people={people}
          submitLabel={dialog.record ? t("common.action.save") : t("common.action.create")}
          onSaved={async () => {
            await refresh();
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {validating ? (
        <FinanceValidationDialog
          name={validating.metric}
          url={`/api/v1/transformations/${ws.tid}/baselines/${validating.id}/validation`}
          version={validating.version}
          onDone={refresh}
          onClose={() => setValidating(null)}
        />
      ) : null}
    </Section>
  );
}

function FinanceValidationDialog({
  name,
  url,
  version,
  onDone,
  onClose,
}: {
  name: string;
  url: string;
  version: number;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <NoteDecisionDialog
      title={t("kpi.validation.title", { name })}
      description={t("kpi.validation.description")}
      choiceLabel={t("kpi.validation.result")}
      choices={[
        { value: "validated", label: t("kpi.validation.validated") },
        { value: "rejected", label: t("kpi.validation.rejected") },
      ]}
      noteLabel={t("kpi.validation.note")}
      noteRequired
      confirmLabel={t("kpi.validation.record")}
      url={url}
      version={version}
      toBody={({ choice, note }) => ({ result: choice, note })}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ value pools

function ValuePoolsSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const pools = useRegister<ValuePool>(ws.tid, "value-pools");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [dialog, setDialog] = useState<{ record: ValuePool | null } | null>(null);
  const [validating, setValidating] = useState<ValuePool | null>(null);
  const canEdit = ws.can("diagnostic.edit");
  const canValidate = ws.can("finance.validate");

  const fields: FieldSpec[] = [
    { name: "name", kind: "text", label: t("common.field.name"), required: true, maxLength: 300 },
    { name: "driver", kind: "textarea", label: t("kpi.valuePool.driver") },
    {
      name: "workstreamCode",
      kind: "select",
      label: t("diagnose.workstreams.workstream"),
      options: workstreamOptions(ws.methodology, locale),
    },
    {
      name: "quantificationStatus",
      kind: "select",
      label: t("kpi.valuePool.quantification"),
      hint: t("kpi.valuePool.quantificationHint"),
      options: [
        { value: "quantified", label: t("kpi.valuePool.quantified") },
        { value: "unquantified", label: t("kpi.valuePool.unquantified") },
      ],
    },
    { name: "downsideAmount", kind: "decimal", label: t("kpi.valuePool.downside"), hint: t("kpi.decimalHint") },
    { name: "upsideAmount", kind: "decimal", label: t("kpi.valuePool.upside"), hint: t("kpi.decimalHint") },
    {
      name: "currency",
      kind: "select",
      label: t("common.field.currency"),
      options: [...new Set([ws.tr.currency, "SAR"])].map((c) => ({ value: c, label: c })),
    },
    { name: "unquantifiedReason", kind: "textarea", label: t("kpi.valuePool.unquantifiedReason") },
    {
      name: "materiality",
      kind: "select",
      label: t("kpi.valuePool.materiality"),
      options: MATERIALITIES.map((m) => ({ value: m, label: t(`kpi.valuePool.materialities.${m}`) })),
    },
    {
      name: "confidence",
      kind: "select",
      label: t("diagnose.confidence.label"),
      options: CONFIDENCES.map((c) => ({ value: c, label: t(`diagnose.confidence.${c}`) })),
    },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner") },
  ];

  const columns: RegisterColumn<ValuePool>[] = [
    {
      id: "name",
      header: t("common.field.name"),
      cell: (p) => p.name,
      sortValue: (p) => p.name,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "driver",
      header: t("kpi.valuePool.driver"),
      cell: (p) => <TextCell value={p.driver} />,
      sortValue: (p) => p.driver,
    },
    {
      id: "workstream",
      header: t("diagnose.workstreams.workstream"),
      cell: (p) =>
        workstreamName(ws.methodology, p.workstreamCode, locale) ?? (
          <span className="muted">{t("common.value.none")}</span>
        ),
      sortValue: (p) => workstreamName(ws.methodology, p.workstreamCode, locale),
    },
    {
      id: "value",
      header: t("kpi.valuePool.value"),
      cell: (p) =>
        p.quantificationStatus === "quantified" ? (
          <AmountRange downside={p.downsideAmount} upside={p.upsideAmount} currency={p.currency} />
        ) : (
          <span>
            <Unquantified />
            {p.unquantifiedReason ? <span className="block small text-cell">{p.unquantifiedReason}</span> : null}
          </span>
        ),
      filterText: (p) => p.unquantifiedReason,
    },
    {
      id: "materiality",
      header: t("kpi.valuePool.materiality"),
      cell: (p) =>
        p.materiality === "not_assessed" ? (
          <Unknown hint={t("kpi.valuePool.materialities.not_assessed")} />
        ) : (
          t(`kpi.valuePool.materialities.${p.materiality}`)
        ),
      sortValue: (p) => p.materiality,
    },
    { id: "confidence", header: t("diagnose.confidence.label"), cell: (p) => <ConfidenceChip value={p.confidence} /> },
    {
      id: "validation",
      header: t("kpi.validation.label"),
      cell: (p) => <ValidationChip record={p} />,
      sortValue: (p) => p.validationStatus,
    },
    { id: "owner", header: t("common.field.owner"), cell: (p) => <PersonName id={p.ownerUserId} people={byId} /> },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (p) =>
        canEdit || canValidate ? (
          <span className="row-actions">
            {canEdit ? (
              <button
                type="button"
                className="button button--link button--small"
                onClick={() => setDialog({ record: p })}
              >
                <Icon name="pencil" /> {t("common.action.edit")}
                <span className="visually-hidden">: {p.name}</span>
              </button>
            ) : null}
            {canValidate ? (
              <button type="button" className="button button--link button--small" onClick={() => setValidating(p)}>
                <Icon name="check" /> {t("kpi.validation.action")}
                <span className="visually-hidden">: {p.name}</span>
              </button>
            ) : null}
            {canEdit ? (
              <ArchiveAction
                url={`/api/v1/transformations/${ws.tid}/value-pools/${p.id}`}
                version={p.version}
                name={p.name}
                onDone={refresh}
              />
            ) : null}
          </span>
        ) : (
          <span className="muted small">{t("common.readOnly")}</span>
        ),
    },
  ];

  return (
    <Section
      id="value-pools"
      title={t("kpi.valuePool.title")}
      intro={t("kpi.valuePool.intro")}
      actions={
        canEdit ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setDialog({ record: null })}
          >
            <Icon name="plus" /> {t("kpi.valuePool.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={pools}>
        {(list) => {
          const active = list.filter((p) => p.status !== "archived");
          return (
            <>
              <div className="value-summary" aria-live="polite">
                <ValuePoolTotals pools={active} />
                <p className="muted small">{t("kpi.valuePool.totalNote")}</p>
              </div>
              <RegisterTable
                id="value-pools"
                caption={t("kpi.valuePool.title")}
                rows={active}
                columns={columns}
                getRowId={(p) => p.id}
                emptyTitle={t("kpi.valuePool.empty")}
                emptyBody={t("kpi.valuePool.emptyBody")}
              />
            </>
          );
        }}
      </QueryState>
      {dialog ? (
        <RecordDialog<ValuePool>
          title={dialog.record ? t("kpi.valuePool.editTitle") : t("kpi.valuePool.add")}
          fields={fields}
          record={dialog.record}
          defaults={{
            quantificationStatus: "unquantified",
            currency: ws.tr.currency,
            materiality: "not_assessed",
            ownerUserId: ws.meId,
          }}
          createSchema={valuePoolCreate}
          updateSchema={valuePoolUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/value-pools`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/value-pools/${r.id}`}
          people={people}
          submitLabel={dialog.record ? t("common.action.save") : t("common.action.create")}
          onSaved={async () => {
            await refresh();
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {validating ? (
        <FinanceValidationDialog
          name={validating.name}
          url={`/api/v1/transformations/${ws.tid}/value-pools/${validating.id}/validation`}
          version={validating.version}
          onDone={refresh}
          onClose={() => setValidating(null)}
        />
      ) : null}
    </Section>
  );
}
