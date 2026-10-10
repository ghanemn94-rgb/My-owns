// Risks and Actions > Corrective actions and their rules (T-DG4-FE-D; p4-work-split §E.5; ADR-0031 §5-§6).
// SYNTHETIC data only.
//  - A case shows its source (KPI deviation, benefit variance with the benefit's lifecycle step, adoption or control
//    check, Value Review finding), its owner or "Unassigned", its follow-up date or Unknown with the reason, the
//    signals that opened or updated it, its recovery plan and its actions (REQ-PB-085, REQ-S12-016).
//  - The worker opens and updates event cases; a person opens a Value Review case. An existing open case is updated,
//    never duplicated (409 corrective_case.already_open is translated).
//  - The rules page labels a rule without a stored row "Default" (ADR-0031 §5.2); saving it creates the row.
//  - `/transformations/:id/corrective-actions/:caseId` is the work-item link of `corrective_case_follow_up`.
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { CORRECTIVE_CASE_STATUSES, CORRECTIVE_SOURCE_KINDS, type CorrectiveRuleKind } from "@mth/shared/schemas";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { actionCreateBody, actionCreateFields, ActionsTable, EditActionDialog } from "../actions/ActionsPage.tsx";
import { DueDate, P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import {
  raidPaths,
  useCorrectiveCase,
  useCorrectiveCaseActions,
  useCorrectiveCases,
  useCorrectiveRules,
  useCorrectiveSignals,
  type CorrectiveActionRule,
  type CorrectiveCase,
  type RaidAction,
} from "./api.ts";
import { Code, CORRECTIVE_WRITE_PERMISSIONS, NS, RaidSubNav, StatusText, vocabOptions } from "./ui.tsx";

// ------------------------------------------------------------------------------------------------ small parts

/** Owner, or "Unassigned" (label + icon) when the worker could not resolve one. */
function CaseOwner({ c, byId }: { c: CorrectiveCase; byId: ReturnType<typeof usePeople>["byId"] }) {
  const { t } = useTranslation();
  if (c.ownerStatus === "unassigned" || !c.ownerUserId)
    return (
      <span className="status-chip status-chip--unknown status-chip--wrap" data-owner="unassigned">
        <Icon name="question" /> {t("raidP4.corrective.unassigned")}
      </span>
    );
  return <PersonName id={c.ownerUserId} people={byId} />;
}

/** The follow-up date, or Unknown with its reason (never a guessed date). */
function FollowUp({ c }: { c: CorrectiveCase }) {
  return <DueDate date={c.followUpDate} reason={c.followUpUnknownReason} />;
}

/** Source of a case: its kind and the record it comes from; a benefit case shows the benefit's lifecycle step. */
function CaseSource({ c, tid }: { c: CorrectiveCase; tid: string }) {
  const { t } = useTranslation();
  return (
    <span className="block" data-source-kind={c.sourceKind}>
      {t(`raidP4.corrective.source.${c.sourceKind}`)}
      {c.kpiDefinitionId ? (
        <Link className="link block small" to={`/transformations/${tid}/kpis/${c.kpiDefinitionId}`}>
          {t("raidP4.corrective.openKpi")}
        </Link>
      ) : null}
      {c.benefitId ? (
        <span className="block small">
          <Link className="link" to={`/transformations/${tid}/benefits/${c.benefitId}`}>
            {t("raidP4.corrective.openBenefit")}
          </Link>
          {c.benefitLifecycleStep ? (
            <span data-benefit-step={c.benefitLifecycleStep}>
              {" "}
              · {t("raidP4.corrective.benefitStep")}:{" "}
              {t(`benefitsP4.step.${c.benefitLifecycleStep}`, { defaultValue: c.benefitLifecycleStep })}
            </span>
          ) : null}
        </span>
      ) : null}
      {c.sourceKind === "value_review" ? (
        <span className="block small muted">
          {t("raidP4.corrective.finding")}: <bdi>{c.sourceScopeKey}</bdi>
        </span>
      ) : null}
    </span>
  );
}

/** A KPI RAG observed by a signal: label + icon; unknown, stale and not computable are never green. */
function ObservedRag({ rag }: { rag: string | null }) {
  const { t } = useTranslation();
  if (rag === "red" || rag === "amber" || rag === "green")
    return (
      <span
        className={`status-chip status-chip--${rag === "red" ? "off-track" : rag === "amber" ? "at-risk" : "on-track"}`}
        data-rag={rag}
      >
        <Icon name={rag === "red" ? "alert" : rag === "amber" ? "pause" : "check"} /> {t(`raidP4.rag.${rag}`)}
      </span>
    );
  if (rag === null) return <span className="muted">{t("raidP4.na")}</span>;
  return (
    <span className="status-chip status-chip--unknown" data-rag={rag}>
      <Icon name="question" /> {t(`raidP4.rag.${rag}`, { defaultValue: t("common.value.unknown") })}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ list

export function CorrectiveActionsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="corrective-actions"
      title={t("raidP4.corrective.title")}
      subtitle={t("raidP4.corrective.intro")}
      writePermissions={CORRECTIVE_WRITE_PERMISSIONS}
    >
      <CorrectiveList />
    </WorkspaceFrame>
  );
}

function CorrectiveList() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [sourceKind, setSourceKind] = useState("");
  const [status, setStatus] = useState("");
  const cases = useCorrectiveCases(ws.tid, { ...(sourceKind ? { sourceKind } : {}), ...(status ? { status } : {}) });
  const { byId } = usePeople(ws.tid);
  const [creating, setCreating] = useState(false);
  const columns: RegisterColumn<CorrectiveCase>[] = [
    {
      id: "case",
      header: t("raidP4.corrective.col.case"),
      rowHeader: true,
      hideable: false,
      cell: (c) => (
        <Link className="link" to={`/transformations/${ws.tid}/corrective-actions/${c.id}`} data-case={c.code}>
          <Code>{c.code}</Code> {c.title}
        </Link>
      ),
      sortValue: (c) => c.code,
      filterText: (c) => `${c.code} ${c.title}`,
    },
    {
      id: "source",
      header: t("raidP4.corrective.col.source"),
      cell: (c) => <CaseSource c={c} tid={ws.tid} />,
      sortValue: (c) => c.sourceKind,
      filterText: (c) => t(`raidP4.corrective.source.${c.sourceKind}`),
    },
    {
      id: "owner",
      header: t("raidP4.corrective.col.owner"),
      cell: (c) => <CaseOwner c={c} byId={byId} />,
      sortValue: (c) => (c.ownerUserId ? (byId.get(c.ownerUserId)?.label ?? c.ownerUserId) : null),
    },
    {
      id: "followUp",
      header: t("raidP4.corrective.col.followUp"),
      cell: (c) => <FollowUp c={c} />,
      sortValue: (c) => c.followUpDate,
    },
    {
      id: "persistence",
      header: t("raidP4.corrective.col.persistence"),
      cell: (c) =>
        c.consecutiveOffTrack === null ? (
          <span className="muted">{t("raidP4.na")}</span>
        ) : (
          <span data-consecutive={c.consecutiveOffTrack}>
            {t("raidP4.corrective.consecutive", { count: c.consecutiveOffTrack })}
          </span>
        ),
      sortValue: (c) => c.consecutiveOffTrack,
    },
    {
      id: "signals",
      header: t("raidP4.corrective.col.signals"),
      cell: (c) => <span data-signal-count={c.signalCount}>{c.signalCount}</span>,
      sortValue: (c) => c.signalCount,
    },
    {
      id: "status",
      header: t("raidP4.corrective.col.status"),
      cell: (c) => <StatusText status={c.status} />,
      sortValue: (c) => c.status,
      filterText: (c) => t(`raidP4.status.${c.status}`),
    },
  ];
  return (
    <>
      <RaidSubNav tid={ws.tid} />
      <Section
        id="corrective-cases"
        title={t("raidP4.corrective.tableTitle")}
        intro={t("raidP4.corrective.tableIntro")}
        actions={
          ws.can("corrective_action.manage") ? (
            <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> {t("raidP4.corrective.create")}
            </button>
          ) : null
        }
      >
        <div className="filters" role="group" aria-label={t("raidP4.register.filters")}>
          <div className="filters__select">
            <label htmlFor="case-filter-source">{t("raidP4.corrective.col.source")}</label>
            <select id="case-filter-source" value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
              <option value="">{t("raidP4.all")}</option>
              {CORRECTIVE_SOURCE_KINDS.map((v) => (
                <option key={v} value={v}>
                  {t(`raidP4.corrective.source.${v}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="filters__select">
            <label htmlFor="case-filter-status">{t("raidP4.corrective.col.status")}</label>
            <select id="case-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("raidP4.all")}</option>
              {CORRECTIVE_CASE_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {t(`raidP4.status.${v}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <QueryState query={cases}>
          {(rows) => (
            <RegisterTable
              id="corrective-cases"
              caption={t("raidP4.corrective.tableTitle")}
              rows={rows}
              columns={columns}
              getRowId={(c) => c.id}
              emptyTitle={t("raidP4.corrective.empty")}
              emptyBody={t("raidP4.corrective.emptyBody")}
              defaultSort={{ id: "case", dir: "desc" }}
            />
          )}
        </QueryState>
      </Section>
      {creating ? <CreateCaseDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function CreateCaseDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  return (
    <P4FormDialog
      title={t("raidP4.corrective.create")}
      description={t("raidP4.corrective.createIntro")}
      fields={[
        { name: "findingRef", label: t("raidP4.corrective.finding"), kind: "text", required: true, max: 150 },
        { name: "title", label: t("raidP4.corrective.col.title"), kind: "text", required: true, max: 500 },
        { name: "recoveryPlan", label: t("raidP4.corrective.recoveryPlan"), kind: "textarea", max: 8000 },
        {
          name: "ownerUserId",
          label: t("raidP4.corrective.col.owner"),
          kind: "select",
          required: true,
          options: people.map((p) => ({ value: p.id, label: p.label })),
        },
        { name: "followUpDate", label: t("raidP4.corrective.col.followUp"), kind: "date", required: true },
      ]}
      initial={{ ownerUserId: ws.meId }}
      submitLabel={t("raidP4.corrective.createSubmit")}
      url={raidPaths.cases(ws.tid)}
      namespaces={NS}
      toBody={(v) => ({
        findingRef: v["findingRef"],
        title: v["title"],
        ...(textOf(v["recoveryPlan"]) ? { recoveryPlan: v["recoveryPlan"] } : {}),
        ownerUserId: v["ownerUserId"],
        followUpDate: v["followUpDate"],
      })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ one case

export function CorrectiveCasePage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="corrective-actions"
      title={t("raidP4.corrective.caseTitle")}
      writePermissions={CORRECTIVE_WRITE_PERMISSIONS}
    >
      <CaseBody />
    </WorkspaceFrame>
  );
}

type CaseDialog = "edit" | "close" | "action" | { action: RaidAction } | null;

function CaseBody() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const { caseId = "" } = useParams();
  const c = useCorrectiveCase(ws.tid, caseId);
  const signals = useCorrectiveSignals(ws.tid, caseId);
  const actions = useCorrectiveCaseActions(ws.tid, caseId);
  const { byId, people } = usePeople(ws.tid);
  const refresh = useP4Refresh(ws.tid);
  const [dialog, setDialog] = useState<CaseDialog>(null);
  const canManage = ws.can("corrective_action.manage");
  return (
    <>
      <RaidSubNav tid={ws.tid} />
      <QueryState query={c}>
        {(k) => (
          <>
            <Section
              id="corrective-case"
              title={`${k.code} · ${k.title}`}
              actions={
                canManage && k.status !== "closed" ? (
                  <span className="chip-row">
                    <button type="button" className="button button--secondary" onClick={() => setDialog("edit")}>
                      <Icon name="pencil" /> {t("raidP4.register.edit")}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => setDialog("close")}
                      data-close-case={k.code}
                    >
                      <Icon name="check" /> {t("raidP4.register.close")}
                    </button>
                  </span>
                ) : null
              }
            >
              <dl className="details" data-case-detail={k.code}>
                <div>
                  <dt>{t("raidP4.corrective.col.source")}</dt>
                  <dd>
                    <CaseSource c={k} tid={ws.tid} />
                  </dd>
                </div>
                <div>
                  <dt>{t("raidP4.corrective.col.owner")}</dt>
                  <dd>
                    <CaseOwner c={k} byId={byId} />
                  </dd>
                </div>
                <div>
                  <dt>{t("raidP4.corrective.col.followUp")}</dt>
                  <dd>
                    <FollowUp c={k} />
                  </dd>
                </div>
                <div>
                  <dt>{t("raidP4.corrective.col.status")}</dt>
                  <dd>
                    <StatusText status={k.status} />
                  </dd>
                </div>
                <div>
                  <dt>{t("raidP4.corrective.col.persistence")}</dt>
                  <dd>
                    {k.consecutiveOffTrack === null
                      ? t("raidP4.na")
                      : t("raidP4.corrective.consecutive", { count: k.consecutiveOffTrack })}
                  </dd>
                </div>
                <div>
                  <dt>{t("raidP4.corrective.recoveryPlan")}</dt>
                  <dd data-recovery-plan>
                    <TextCell value={k.recoveryPlan} />
                  </dd>
                </div>
                <div>
                  <dt>{t("raidP4.corrective.createdBy")}</dt>
                  <dd>
                    {k.createdSource === "worker" ? (
                      t("raidP4.corrective.byWorker")
                    ) : (
                      <PersonName id={k.createdBy} people={byId} />
                    )}
                  </dd>
                </div>
                {k.status === "closed" ? (
                  <div>
                    <dt>{t("raidP4.register.closureNote")}</dt>
                    <dd>
                      <TextCell value={k.closureNote} />
                    </dd>
                  </div>
                ) : null}
              </dl>
            </Section>
            <Section
              id="case-signals"
              title={t("raidP4.corrective.signalsTitle")}
              intro={t("raidP4.corrective.signalsIntro")}
            >
              <QueryState query={signals}>
                {(rows) => (
                  <RegisterTable
                    id="case-signals"
                    caption={t("raidP4.corrective.signalsTitle")}
                    rows={rows}
                    getRowId={(s) => s.id}
                    emptyTitle={t("raidP4.corrective.noSignals")}
                    defaultSort={{ id: "received", dir: "desc" }}
                    columns={[
                      {
                        id: "period",
                        header: t("raidP4.corrective.signal.period"),
                        rowHeader: true,
                        cell: (s) => <bdi>{s.periodKey}</bdi>,
                        sortValue: (s) => s.periodStart ?? s.periodKey,
                      },
                      {
                        id: "rag",
                        header: t("raidP4.corrective.signal.rag"),
                        cell: (s) => <ObservedRag rag={s.observedRag} />,
                      },
                      {
                        id: "offTrack",
                        header: t("raidP4.corrective.signal.offTrack"),
                        cell: (s) =>
                          s.offTrack === null ? (
                            <span className="status-chip status-chip--unknown">
                              <Icon name="question" /> {t("common.value.unknown")}
                            </span>
                          ) : (
                            t(s.offTrack ? "raidP4.yes" : "raidP4.no")
                          ),
                      },
                      {
                        id: "consecutive",
                        header: t("raidP4.corrective.col.persistence"),
                        cell: (s) => (s.consecutiveOffTrack === null ? t("raidP4.na") : String(s.consecutiveOffTrack)),
                      },
                      {
                        id: "outcome",
                        header: t("raidP4.corrective.signal.outcome"),
                        cell: (s) => t(`raidP4.corrective.outcome.${s.outcome}`),
                      },
                      {
                        id: "received",
                        header: t("raidP4.corrective.signal.received"),
                        cell: (s) => formatDateTime(s.receivedAt, locale),
                        sortValue: (s) => s.receivedAt,
                      },
                    ]}
                  />
                )}
              </QueryState>
            </Section>
            <Section
              id="case-actions"
              title={t("raidP4.actions.tableTitle")}
              actions={
                ws.can("action.edit") && k.status !== "closed" ? (
                  <button type="button" className="button button--secondary" onClick={() => setDialog("action")}>
                    <Icon name="plus" /> {t("raidP4.actions.add")}
                  </button>
                ) : null
              }
            >
              <QueryState query={actions}>
                {(rows) => (
                  <ActionsTable id="case-actions" rows={rows} compact onEdit={(a) => setDialog({ action: a })} />
                )}
              </QueryState>
            </Section>
            {dialog === "edit" ? <EditCaseDialog c={k} onClose={() => setDialog(null)} /> : null}
            {dialog === "close" ? (
              <P4FormDialog
                title={t("raidP4.register.closeTitle", { code: k.code })}
                description={t("raidP4.corrective.closeIntro")}
                fields={[
                  {
                    name: "closureNote",
                    label: t("raidP4.register.closureNote"),
                    kind: "textarea",
                    required: true,
                    min: 3,
                    max: 2000,
                  },
                ]}
                submitLabel={t("raidP4.register.close")}
                url={raidPaths.caseClose(ws.tid, k.id)}
                version={k.version}
                namespaces={NS}
                toBody={(v) => ({ closureNote: v["closureNote"] })}
                onDone={refresh}
                onClose={() => setDialog(null)}
              />
            ) : null}
            {dialog === "action" ? (
              <P4FormDialog
                title={t("raidP4.actions.addTitle", { code: k.code })}
                fields={actionCreateFields(
                  t,
                  people.map((p) => ({ value: p.id, label: p.label })),
                )}
                initial={{ ownerUserId: k.ownerUserId ?? ws.meId }}
                submitLabel={t("raidP4.actions.add")}
                url={raidPaths.caseActions(ws.tid, k.id)}
                namespaces={NS}
                toBody={actionCreateBody}
                onDone={refresh}
                onClose={() => setDialog(null)}
              />
            ) : null}
            {dialog && typeof dialog === "object" ? (
              <EditActionDialog action={dialog.action} onClose={() => setDialog(null)} />
            ) : null}
          </>
        )}
      </QueryState>
    </>
  );
}

function EditCaseDialog({ c, onClose }: { c: CorrectiveCase; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const initial: P4Values = {
    title: c.title,
    recoveryPlan: c.recoveryPlan ?? "",
    ownerUserId: c.ownerUserId ?? "",
    followUpDate: c.followUpDate ?? "",
    status: c.status,
  };
  const fields: P4FieldSpec[] = [
    { name: "title", label: t("raidP4.corrective.col.title"), kind: "text", required: true, max: 500 },
    { name: "recoveryPlan", label: t("raidP4.corrective.recoveryPlan"), kind: "textarea", max: 8000 },
    {
      name: "ownerUserId",
      label: t("raidP4.corrective.col.owner"),
      kind: "select",
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    { name: "followUpDate", label: t("raidP4.corrective.col.followUp"), kind: "date" },
    {
      name: "status",
      label: t("raidP4.corrective.col.status"),
      kind: "select",
      required: true,
      options: vocabOptions(t, "status", ["open", "in_progress"]),
    },
  ];
  return (
    <P4FormDialog
      title={t("raidP4.register.editTitle", { code: c.code })}
      fields={fields}
      initial={initial}
      submitLabel={t("raidP4.form.save")}
      method="PATCH"
      url={raidPaths.case(ws.tid, c.id)}
      version={c.version}
      namespaces={NS}
      toBody={(v) => {
        const body: Record<string, unknown> = {};
        for (const f of fields) {
          const now = v[f.name] ?? "";
          if (now === (initial[f.name] ?? "")) continue;
          if (now === "" && f.name !== "recoveryPlan") continue; // owner and follow-up date are never cleared
          body[f.name] = now === "" ? null : now;
        }
        return Object.keys(body).length === 0 ? { fieldErrors: { title: "validation.empty_patch" } } : body;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ rules

export function CorrectiveRulesPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="corrective-actions"
      title={t("raidP4.rules.title")}
      subtitle={t("raidP4.rules.intro")}
      writePermissions={["corrective_rule.configure"]}
    >
      <RulesBody />
    </WorkspaceFrame>
  );
}

function ruleFields(t: TFunction, kind: CorrectiveRuleKind): P4FieldSpec[] {
  return [
    ...(kind === "kpi_deviation"
      ? [
          {
            name: "minKpiRag",
            label: t("raidP4.rules.col.severity"),
            kind: "select",
            required: true,
            options: vocabOptions(t, "rag", ["amber", "red"]),
          } satisfies P4FieldSpec,
        ]
      : []),
    ...(kind === "kpi_deviation" || kind === "benefit_variance"
      ? [
          {
            name: "persistenceCycles",
            label: t("raidP4.rules.col.persistence"),
            kind: "number",
            required: true,
            min: 1,
            max: 12,
          } satisfies P4FieldSpec,
        ]
      : []),
    {
      name: "followUpWorkingDays",
      label: t("raidP4.rules.col.followUp"),
      kind: "number",
      required: true,
      min: 1,
      max: 60,
    },
    { name: "enabled", label: t("raidP4.rules.col.enabled"), kind: "checkbox" },
  ];
}

function RulesBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const rules = useCorrectiveRules(ws.tid);
  const refresh = useP4Refresh(ws.tid);
  const [editing, setEditing] = useState<CorrectiveActionRule | null>(null);
  const canConfigure = ws.can("corrective_rule.configure");
  return (
    <>
      <RaidSubNav tid={ws.tid} />
      <Section id="corrective-rules" title={t("raidP4.rules.tableTitle")} intro={t("raidP4.rules.tableIntro")}>
        <QueryState query={rules}>
          {(rows) => (
            <RegisterTable
              id="corrective-rules"
              caption={t("raidP4.rules.tableTitle")}
              rows={rows}
              getRowId={(r) => r.sourceKind}
              emptyTitle={t("raidP4.rules.empty")}
              columns={[
                {
                  id: "source",
                  header: t("raidP4.rules.col.source"),
                  rowHeader: true,
                  hideable: false,
                  cell: (r) => (
                    <span className="block" data-rule={r.sourceKind}>
                      {t(`raidP4.corrective.source.${r.sourceKind}`)}{" "}
                      {r.isDefault ? (
                        <span className="lifecycle-chip lifecycle-chip--draft" data-default="true">
                          {t("raidP4.rules.default")}
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  id: "severity",
                  header: t("raidP4.rules.col.severity"),
                  sortValue: (r) => r.minKpiRag,
                  cell: (r) => (r.minKpiRag ? t(`raidP4.rules.severity.${r.minKpiRag}`) : t("raidP4.na")),
                },
                {
                  id: "persistence",
                  header: t("raidP4.rules.col.persistence"),
                  cell: (r) => t("raidP4.rules.cycles", { count: r.persistenceCycles }),
                  sortValue: (r) => r.persistenceCycles,
                },
                {
                  id: "followUp",
                  header: t("raidP4.rules.col.followUp"),
                  cell: (r) => t("raidP4.rules.workingDays", { count: r.followUpWorkingDays }),
                },
                {
                  id: "enabled",
                  header: t("raidP4.rules.col.enabled"),
                  cell: (r) => (
                    <span className="chip-row">
                      <Icon name={r.enabled ? "check" : "pause"} />{" "}
                      {t(r.enabled ? "raidP4.rules.on" : "raidP4.rules.off")}
                    </span>
                  ),
                },
                {
                  id: "rowActions",
                  header: t("raidP4.col.actions"),
                  hideable: false,
                  cell: (r) =>
                    canConfigure ? (
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={() => setEditing(r)}
                        data-edit-rule={r.sourceKind}
                      >
                        <Icon name="pencil" /> {t("raidP4.register.edit")}
                        <span className="visually-hidden"> {t(`raidP4.corrective.source.${r.sourceKind}`)}</span>
                      </button>
                    ) : null,
                },
              ]}
            />
          )}
        </QueryState>
      </Section>
      {editing ? (
        <P4FormDialog
          title={t("raidP4.rules.editTitle", { source: t(`raidP4.corrective.source.${editing.sourceKind}`) })}
          description={editing.isDefault ? t("raidP4.rules.defaultIntro") : undefined}
          fields={ruleFields(t, editing.sourceKind)}
          initial={{
            minKpiRag: editing.minKpiRag ?? "",
            persistenceCycles: String(editing.persistenceCycles),
            followUpWorkingDays: String(editing.followUpWorkingDays),
            enabled: editing.enabled,
          }}
          submitLabel={t("raidP4.form.save")}
          method={editing.isDefault ? "POST" : "PATCH"}
          url={editing.isDefault ? raidPaths.rules(ws.tid) : raidPaths.rule(ws.tid, editing.sourceKind)}
          {...(editing.isDefault || editing.version === null ? {} : { version: editing.version })}
          namespaces={NS}
          toBody={(v) => {
            const kind = editing.sourceKind;
            return {
              ...(editing.isDefault ? { sourceKind: kind } : {}),
              ...(kind === "kpi_deviation" ? { minKpiRag: v["minKpiRag"] } : {}),
              ...(kind === "kpi_deviation" || kind === "benefit_variance"
                ? { persistenceCycles: Number(v["persistenceCycles"]) }
                : editing.isDefault
                  ? { persistenceCycles: 1 }
                  : {}),
              followUpWorkingDays: Number(v["followUpWorkingDays"]),
              enabled: v["enabled"] === true,
            };
          }}
          onDone={refresh}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
