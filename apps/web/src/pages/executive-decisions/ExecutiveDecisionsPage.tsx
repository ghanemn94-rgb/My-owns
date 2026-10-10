// Governance > Executive decisions (T16), escalations and escalation rules (T-DG4-FE-D; p4-work-split §D.5;
// ADR-0032 §6-§8). SYNTHETIC data only.
//  - The T16 log (B0130): ID, Decision, Why now, Options, Recommendation, Owner, Decision date, Impact if delayed and
//    Outcome, with an overdue filter (the server's Asia/Riyadh business day). A DG3 funding decision listed with
//    `askOrigin: "earlier_record"` shows Unknown for the T16 columns it does not have (REQ-PB-081).
//  - An executive ask states all seven elements; the server refuses an incomplete one with field errors (400
//    executive_decision.field_required, REQ-S10-012) that land on their fields.
//  - Recording an Outcome is a **business decision** of the owner or the owner's active delegate, never an
//    engineering delivery gate (DG0–DG7 are never named here).
//  - Escalations show the level, the party and person reached, the delay impact, and routing errors as visible rows
//    (REQ-S12-011). The rules page labels a rule without a stored row "Default" (ADR-0032 §8.1).
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { EXECUTIVE_DECISION_STATUSES } from "@mth/shared/schemas";
import { useGovernanceParties, useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { DueDate, P4FormDialog, textOf, type P4FieldSpec } from "../my-work/p4ui.tsx";
import {
  govPaths,
  useDecisionEscalations,
  useEscalationRules,
  useExecutiveDecision,
  useExecutiveDecisions,
  type DecisionEscalation,
  type EscalationRule,
  type ExecutiveDecision,
} from "../meetings/api.ts";
import { BusinessDecisionNote, Code, DECISION_WRITE_PERMISSIONS, GovSubNav, NS, OverdueFlag } from "../meetings/ui.tsx";

/** A T16 text column: the text, or Unknown when an earlier record does not have it (never blank, never "None"). */
function T16Text({ d, value }: { d: ExecutiveDecision; value: string | null }) {
  const { t } = useTranslation();
  if (value !== null && value !== "") return <span className="text-cell">{value}</span>;
  if (d.askOrigin === "earlier_record")
    return (
      <span className="status-chip status-chip--unknown status-chip--wrap" data-t16="unknown">
        <Icon name="question" /> {t("common.value.unknown")}
        <span className="visually-hidden"> ({t("governanceP4.decisions.earlierRecord")})</span>
      </span>
    );
  return <span className="muted">{t("common.value.none")}</span>;
}

function OptionsCell({ d }: { d: ExecutiveDecision }) {
  const { t } = useTranslation();
  if (d.options.length === 0) return <T16Text d={d} value={null} />;
  return (
    <ul className="plain-list small" data-options={d.options.length}>
      {d.options.map((o) => (
        <li key={o.label}>
          <Code>{o.label}</Code> {o.title}
          {d.recommendationOptionLabel === o.label ? (
            <span className="small muted"> ({t("governanceP4.decisions.recommended")})</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function OwnerCell({ d, byId }: { d: ExecutiveDecision; byId: ReturnType<typeof usePeople>["byId"] }) {
  const { t } = useTranslation();
  if (d.ownerStatus === "unassigned" || !d.ownerUserId)
    return (
      <span className="status-chip status-chip--unknown status-chip--wrap" data-owner="unassigned">
        <Icon name="question" /> {t("governanceP4.decisions.unassigned")}
      </span>
    );
  return <PersonName id={d.ownerUserId} people={byId} />;
}

function OutcomeCell({ d }: { d: ExecutiveDecision }) {
  const { t } = useTranslation();
  return (
    <span className="block" data-decision-status={d.status}>
      <span className="chip-row">
        <Icon
          name={
            d.status === "decided"
              ? "check"
              : d.status === "open"
                ? "clock"
                : d.status === "deferred"
                  ? "pause"
                  : "cross"
          }
        />{" "}
        {t(`governanceP4.decisions.status.${d.status}`)}
        <OverdueFlag overdue={d.overdue} />
      </span>
      {d.chosenOptionLabel ? (
        <span className="block small">
          {t("governanceP4.decisions.chosenOption")}: <Code>{d.chosenOptionLabel}</Code>
        </span>
      ) : null}
      {d.outcome ? <span className="block small text-cell">{d.outcome}</span> : null}
    </span>
  );
}

/** The nine T16 columns (B0130), shared by the log and the detail page. */
function t16Columns(
  t: TFunction,
  tid: string,
  byId: ReturnType<typeof usePeople>["byId"],
): RegisterColumn<ExecutiveDecision>[] {
  return [
    {
      id: "code",
      header: t("governanceP4.decisions.col.id"),
      rowHeader: true,
      hideable: false,
      cell: (d) => (
        <Link className="link" to={`/transformations/${tid}/executive-decisions/${d.id}`} data-decision={d.code}>
          <Code>{d.code}</Code>
        </Link>
      ),
      sortValue: (d) => d.code,
    },
    {
      id: "decision",
      header: t("governanceP4.decisions.col.decision"),
      cell: (d) => d.decision,
      sortValue: (d) => d.decision,
    },
    { id: "whyNow", header: t("governanceP4.decisions.col.whyNow"), cell: (d) => <T16Text d={d} value={d.whyNow} /> },
    { id: "options", header: t("governanceP4.decisions.col.options"), cell: (d) => <OptionsCell d={d} /> },
    {
      id: "recommendation",
      header: t("governanceP4.decisions.col.recommendation"),
      cell: (d) =>
        d.recommendationOptionLabel ? (
          <span>
            <Code>{d.recommendationOptionLabel}</Code> <T16Text d={d} value={d.recommendationText} />
          </span>
        ) : (
          <T16Text d={d} value={d.recommendationText} />
        ),
    },
    { id: "owner", header: t("governanceP4.decisions.col.owner"), cell: (d) => <OwnerCell d={d} byId={byId} /> },
    {
      id: "decisionDate",
      header: t("governanceP4.decisions.col.decisionDate"),
      cell: (d) => <DueDate date={d.decisionDate} />,
      sortValue: (d) => d.decisionDate,
    },
    {
      id: "impactOfDelay",
      header: t("governanceP4.decisions.col.impactOfDelay"),
      cell: (d) => <T16Text d={d} value={d.impactOfDelay} />,
    },
    {
      id: "outcome",
      header: t("governanceP4.decisions.col.outcome"),
      cell: (d) => <OutcomeCell d={d} />,
      sortValue: (d) => `${d.overdue ? 0 : 1}${d.status}`,
      filterText: (d) => `${t(`governanceP4.decisions.status.${d.status}`)} ${d.outcome ?? ""}`,
    },
  ];
}

// ------------------------------------------------------------------------------------------------ the log

export function ExecutiveDecisionsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="executive-decisions"
      title={t("governanceP4.decisions.title")}
      subtitle={t("governanceP4.decisions.intro")}
      writePermissions={DECISION_WRITE_PERMISSIONS}
    >
      <LogBody />
    </WorkspaceFrame>
  );
}

function LogBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [status, setStatus] = useState("");
  const [overdue, setOverdue] = useState(false);
  const log = useExecutiveDecisions(ws.tid, { ...(status ? { status } : {}), ...(overdue ? { overdue: "true" } : {}) });
  const { byId } = usePeople(ws.tid);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <GovSubNav tid={ws.tid} />
      <Section
        id="t16-log"
        title={t("governanceP4.decisions.tableTitle")}
        intro={t("governanceP4.decisions.tableIntro")}
        actions={
          ws.can("executive_decision.create") ? (
            <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> {t("governanceP4.decisions.create")}
            </button>
          ) : null
        }
      >
        <div className="filters" role="group" aria-label={t("governanceP4.filters")}>
          <div className="filters__select">
            <label htmlFor="t16-filter-status">{t("governanceP4.meetings.status")}</label>
            <select id="t16-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("governanceP4.all")}</option>
              {EXECUTIVE_DECISION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`governanceP4.decisions.status.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={overdue}
              onChange={(e) => setOverdue(e.target.checked)}
              data-filter="overdue"
            />
            {t("governanceP4.decisions.overdueOnly")}
          </label>
        </div>
        <QueryState query={log}>
          {(rows) => (
            <RegisterTable
              id="t16-log"
              caption={t("governanceP4.decisions.tableTitle")}
              rows={rows}
              columns={t16Columns(t, ws.tid, byId)}
              getRowId={(d) => d.id}
              emptyTitle={overdue ? t("governanceP4.decisions.emptyOverdue") : t("governanceP4.decisions.empty")}
              defaultSort={{ id: "code", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
      {creating ? <CreateDecisionDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function askFields(t: TFunction, people: readonly { value: string; label: string }[]): P4FieldSpec[] {
  return [
    { name: "title", label: t("governanceP4.ask.decision_required"), kind: "text", required: true, max: 500 },
    { name: "whyNow", label: t("governanceP4.ask.why_now"), kind: "textarea", required: true, max: 4000 },
    {
      name: "options",
      label: t("governanceP4.ask.options"),
      kind: "textarea",
      required: true,
      hint: t("governanceP4.ask.optionsHint"),
    },
    {
      name: "recommendation",
      label: t("governanceP4.ask.recommendation"),
      hint: t("governanceP4.ask.recommendationHint"),
      kind: "textarea",
      required: true,
      max: 4000,
    },
    {
      name: "impactOfDelay",
      label: t("governanceP4.ask.impact_of_delay"),
      kind: "textarea",
      required: true,
      max: 4000,
    },
    {
      name: "ownerUserId",
      label: t("governanceP4.ask.decision_owner"),
      kind: "select",
      required: true,
      options: people,
    },
    { name: "requiredDate", label: t("governanceP4.ask.required_date"), kind: "date", required: true },
    { name: "context", label: t("governanceP4.decisions.context"), kind: "textarea", max: 20000 },
  ];
}

const optionLines = (v: string | boolean | undefined) =>
  (typeof v === "string" ? v.split("\n") : []).map((s) => s.trim()).filter((s) => s !== "");

function CreateDecisionDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  return (
    <P4FormDialog
      title={t("governanceP4.decisions.create")}
      description={t("governanceP4.ask.intro")}
      fields={askFields(
        t,
        people.map((p) => ({ value: p.id, label: p.label })),
      )}
      submitLabel={t("governanceP4.decisions.createSubmit")}
      url={govPaths.decisions(ws.tid)}
      namespaces={NS}
      toBody={(v) => {
        const options = optionLines(v["options"]);
        if (options.length < 2) return { fieldErrors: { options: "executive_decision.options_too_few" } };
        return {
          title: v["title"],
          whyNow: v["whyNow"],
          options: options.map((title) => ({ title })),
          recommendation: v["recommendation"],
          impactOfDelay: v["impactOfDelay"],
          ownerUserId: v["ownerUserId"],
          requiredDate: v["requiredDate"],
          ...(textOf(v["context"]) ? { context: v["context"] } : {}),
        };
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ one decision

export function ExecutiveDecisionPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="executive-decisions"
      title={t("governanceP4.decisions.decisionTitle")}
      writePermissions={DECISION_WRITE_PERMISSIONS}
    >
      <DecisionBody />
    </WorkspaceFrame>
  );
}

function DecisionBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { decisionId = "" } = useParams();
  const decision = useExecutiveDecision(ws.tid, decisionId);
  const escalations = useDecisionEscalations(ws.tid, decisionId);
  const { byId } = usePeople(ws.tid);
  const refresh = useP4Refresh(ws.tid);
  const [dialog, setDialog] = useState<"outcome" | null>(null);
  return (
    <>
      <GovSubNav tid={ws.tid} />
      <QueryState query={decision}>
        {(d) => {
          const columns = t16Columns(t, ws.tid, byId);
          return (
            <>
              <Section
                id="t16-decision"
                title={`${d.code} · ${d.decision}`}
                actions={
                  d.status === "open" && ws.can("executive_decision.decide") ? (
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => setDialog("outcome")}
                      data-record-outcome={d.code}
                    >
                      {t("governanceP4.decisions.recordOutcome")}
                    </button>
                  ) : null
                }
              >
                <dl className="details" data-t16-detail={d.code}>
                  {columns.slice(1).map((c) => (
                    <div key={c.id} data-t16-col={c.id}>
                      <dt>{c.header}</dt>
                      <dd>{c.cell(d)}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>{t("governanceP4.decisions.origin")}</dt>
                    <dd data-origin={d.askOrigin}>{t(`governanceP4.decisions.originKind.${d.askOrigin}`)}</dd>
                  </div>
                  <div>
                    <dt>{t("governanceP4.decisions.slaDue")}</dt>
                    <dd>
                      <DueDate
                        date={d.slaDueDate}
                        reason={d.slaUnknownReason ?? (d.decisionRightId ? null : "no_sla")}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>{t("governanceP4.decisions.escalationLevel")}</dt>
                    <dd data-escalation-level={d.escalationLevel}>{d.escalationLevel}</dd>
                  </div>
                  {d.missingElements.length > 0 ? (
                    <div>
                      <dt>{t("governanceP4.ask.missing", { count: d.missingElements.length })}</dt>
                      <dd>
                        <ul className="small" data-missing={d.missingElements.join(",")}>
                          {d.missingElements.map((e) => (
                            <li key={e}>{t(`governanceP4.ask.${e}`)}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ) : null}
                  {d.decidedBy ? (
                    <div>
                      <dt>{t("governanceP4.decisions.decidedBy")}</dt>
                      <dd>
                        <PersonName id={d.decidedBy} people={byId} />
                        {d.decidedOnBehalfOfUserId ? (
                          <span className="block small">
                            {t("governanceP4.decisions.onBehalfOf")}{" "}
                            <PersonName id={d.decidedOnBehalfOfUserId} people={byId} />
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </Section>
              <Section id="t16-escalations" title={t("governanceP4.escalations.title")}>
                <QueryState query={escalations}>{(rows) => <EscalationsTable rows={rows} />}</QueryState>
              </Section>
              {dialog === "outcome" ? (
                <P4FormDialog
                  title={t("governanceP4.decisions.recordOutcome")}
                  note={<BusinessDecisionNote />}
                  fields={[
                    {
                      name: "outcome",
                      label: t("governanceP4.agenda.outcomeLabel"),
                      kind: "select",
                      required: true,
                      options: ["decided", "deferred", "cancelled"].map((o) => ({
                        value: o,
                        label: t(`governanceP4.decisions.status.${o}`),
                      })),
                    },
                    {
                      name: "chosenOptionLabel",
                      label: t("governanceP4.decisions.chosenOption"),
                      kind: "select",
                      required: true,
                      options: d.options.map((o) => ({ value: o.label, label: `${o.label} · ${o.title}` })),
                      when: (v) => v["outcome"] === "decided",
                    },
                    {
                      name: "deferUntil",
                      label: t("governanceP4.decisions.deferUntil"),
                      kind: "date",
                      required: true,
                      when: (v) => v["outcome"] === "deferred",
                    },
                    {
                      name: "outcomeText",
                      label: t("governanceP4.decisions.outcomeText"),
                      kind: "textarea",
                      max: 8000,
                    },
                  ]}
                  submitLabel={t("governanceP4.decisions.recordOutcome")}
                  url={govPaths.decisionOutcome(ws.tid, d.id)}
                  version={d.version}
                  namespaces={NS}
                  toBody={(v) => ({
                    outcome: v["outcome"],
                    ...(v["outcome"] === "decided" ? { chosenOptionLabel: v["chosenOptionLabel"] } : {}),
                    ...(v["outcome"] === "deferred" ? { deferUntil: v["deferUntil"] } : {}),
                    ...(textOf(v["outcomeText"]) ? { outcomeText: v["outcomeText"] } : {}),
                  })}
                  onDone={refresh}
                  onClose={() => setDialog(null)}
                />
              ) : null}
            </>
          );
        }}
      </QueryState>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ escalations

function EscalationsTable({ rows }: { rows: readonly DecisionEscalation[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const { byId } = usePeople(ws.tid);
  return (
    <RegisterTable
      id="decision-escalations"
      caption={t("governanceP4.escalations.title")}
      rows={rows}
      getRowId={(e) => e.id}
      emptyTitle={t("governanceP4.escalations.empty")}
      defaultSort={{ id: "at", dir: "desc" }}
      columns={[
        {
          id: "decision",
          header: t("governanceP4.decisions.col.id"),
          rowHeader: true,
          hideable: false,
          cell: (e) => (
            <Link className="link" to={`/transformations/${ws.tid}/executive-decisions/${e.decisionId}`}>
              <Code>{e.decisionCode}</Code>
            </Link>
          ),
          sortValue: (e) => e.decisionCode,
        },
        {
          id: "level",
          header: t("governanceP4.decisions.escalationLevel"),
          cell: (e) => e.level,
          sortValue: (e) => e.level,
        },
        { id: "sla", header: t("governanceP4.decisions.slaDue"), cell: (e) => <DueDate date={e.slaDueDate} /> },
        {
          id: "to",
          header: t("governanceP4.escalations.to"),
          cell: (e) =>
            e.routingError ? (
              <span
                className="status-chip status-chip--off-track status-chip--wrap"
                data-routing-error={e.routingError}
              >
                <Icon name="alert" /> {t(`governanceP4.escalations.routingError.${e.routingError}`)}
                {e.partyCode ? (
                  <>
                    {" "}
                    (<Code>{e.partyCode}</Code>)
                  </>
                ) : null}
              </span>
            ) : (
              <span>
                {e.partyCode ? <Code>{e.partyCode}</Code> : null}{" "}
                {e.targetUserId ? <PersonName id={e.targetUserId} people={byId} /> : null}
                {e.targetGroupId ? t("governanceP4.participants.group") : null}
              </span>
            ),
        },
        {
          id: "impact",
          header: t("governanceP4.escalations.delayImpact"),
          cell: (e) => <TextCell value={e.delayImpact} />,
        },
        {
          id: "at",
          header: t("governanceP4.escalations.at"),
          cell: (e) => formatDateTime(e.escalatedAt, locale),
          sortValue: (e) => e.escalatedAt,
        },
      ]}
    />
  );
}

export function EscalationsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="executive-decisions"
      title={t("governanceP4.escalations.pageTitle")}
      subtitle={t("governanceP4.escalations.intro")}
      writePermissions={["escalation_rule.configure"]}
    >
      <EscalationsBody />
    </WorkspaceFrame>
  );
}

function EscalationsBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const escalations = useDecisionEscalations(ws.tid);
  const rules = useEscalationRules(ws.tid);
  const parties = useGovernanceParties();
  const refresh = useP4Refresh(ws.tid);
  const [editing, setEditing] = useState<EscalationRule | null>(null);
  const canConfigure = ws.can("escalation_rule.configure");
  const partyOptions = (parties.data ?? []).map((p) => ({ value: p.code, label: `${p.code} · ${p.labelEn}` }));
  return (
    <>
      <GovSubNav tid={ws.tid} />
      <Section id="escalations" title={t("governanceP4.escalations.title")}>
        <QueryState query={escalations}>{(rows) => <EscalationsTable rows={rows} />}</QueryState>
      </Section>
      <Section id="escalation-rules" title={t("governanceP4.rules.title")} intro={t("governanceP4.rules.intro")}>
        <QueryState query={rules}>
          {(rows) => (
            <RegisterTable
              id="escalation-rules"
              caption={t("governanceP4.rules.title")}
              rows={rows}
              getRowId={(r) => r.ruleKind}
              emptyTitle={t("governanceP4.rules.empty")}
              columns={[
                {
                  id: "kind",
                  header: t("governanceP4.rules.kind"),
                  rowHeader: true,
                  hideable: false,
                  cell: (r) => (
                    <span data-rule={r.ruleKind}>
                      {t(`governanceP4.rules.ruleKind.${r.ruleKind}`)}{" "}
                      {r.isDefault ? (
                        <span className="lifecycle-chip lifecycle-chip--draft" data-default="true">
                          {t("governanceP4.rules.default")}
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  id: "settings",
                  header: t("governanceP4.rules.settings"),
                  sortValue: (r) => r.ruleKind,
                  cell: (r) =>
                    r.ruleKind === "decision_sla" ? (
                      <span>
                        {t("governanceP4.rules.chain")}:{" "}
                        {(r.escalationChain ?? []).map((p, i) => (
                          <span key={p}>
                            {i > 0 ? " → " : ""}
                            <Code>{p}</Code>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="block">
                        {t("governanceP4.rules.redCycles", { count: r.redCycles ?? 0 })} ·{" "}
                        {t("governanceP4.forums.workingDays", { count: r.deadlineWorkingDays ?? 0 })} ·{" "}
                        {t("governanceP4.rules.owner")}: {r.ownerPartyCode ? <Code>{r.ownerPartyCode}</Code> : null}
                      </span>
                    ),
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
                  header: t("governanceP4.actionsCol"),
                  hideable: false,
                  cell: (r) =>
                    canConfigure ? (
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={() => setEditing(r)}
                        data-edit-rule={r.ruleKind}
                      >
                        <Icon name="pencil" /> {t("raidP4.register.edit")}
                        <span className="visually-hidden"> {t(`governanceP4.rules.ruleKind.${r.ruleKind}`)}</span>
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
          title={t(`governanceP4.rules.ruleKind.${editing.ruleKind}`)}
          description={editing.isDefault ? t("governanceP4.rules.defaultIntro") : undefined}
          fields={
            editing.ruleKind === "decision_sla"
              ? [
                  {
                    name: "escalationChain",
                    label: t("governanceP4.rules.chain"),
                    kind: "text",
                    required: true,
                    ltr: true,
                    hint: t("governanceP4.rules.chainHint"),
                  },
                  { name: "enabled", label: t("raidP4.rules.col.enabled"), kind: "checkbox" },
                ]
              : [
                  {
                    name: "redCycles",
                    label: t("governanceP4.rules.redCyclesLabel"),
                    kind: "number",
                    required: true,
                    min: 2,
                    max: 12,
                  },
                  {
                    name: "deadlineWorkingDays",
                    label: t("governanceP4.rules.deadline"),
                    kind: "number",
                    required: true,
                    min: 1,
                    max: 60,
                  },
                  {
                    name: "ownerPartyCode",
                    label: t("governanceP4.rules.owner"),
                    kind: "select",
                    required: true,
                    options: partyOptions,
                  },
                  { name: "enabled", label: t("raidP4.rules.col.enabled"), kind: "checkbox" },
                ]
          }
          initial={{
            escalationChain: (editing.escalationChain ?? []).join(", "),
            redCycles: editing.redCycles === null ? "" : String(editing.redCycles),
            deadlineWorkingDays: editing.deadlineWorkingDays === null ? "" : String(editing.deadlineWorkingDays),
            ownerPartyCode: editing.ownerPartyCode ?? "",
            enabled: editing.enabled,
          }}
          submitLabel={t("governanceP4.save")}
          method={editing.isDefault ? "POST" : "PATCH"}
          url={editing.isDefault ? govPaths.escalationRules(ws.tid) : govPaths.escalationRule(ws.tid, editing.ruleKind)}
          {...(editing.isDefault || editing.version === null ? {} : { version: editing.version })}
          namespaces={NS}
          toBody={(v) => {
            const base = editing.isDefault ? { ruleKind: editing.ruleKind } : {};
            if (editing.ruleKind === "decision_sla")
              return {
                ...base,
                escalationChain: String(v["escalationChain"])
                  .split(/[,\s]+/)
                  .map((s) => s.trim())
                  .filter((s) => s !== ""),
                enabled: v["enabled"] === true,
              };
            return {
              ...base,
              redCycles: Number(v["redCycles"]),
              deadlineWorkingDays: Number(v["deadlineWorkingDays"]),
              ownerPartyCode: v["ownerPartyCode"],
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
