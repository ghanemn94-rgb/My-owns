// Initiative Card (T05) with its links and lifecycle (T-DG3-FE-A; ADR-0021 §2-§3; REQ-PB-045, REQ-PB-040, REQ-PB-032,
// REQ-PB-006, REQ-PB-004, REQ-S09-003). SYNTHETIC data only in tests and demos.
//  - All 14 T05 fields (B0072), numbered as in the source template; the 3-7 deliverables rule is a WARNING, not a block.
//  - Gap links go to a T03 gap or a diagnosed finding. Any other TOM record is refused by the server with
//    `initiative.not_tom_evidence`, shown translated: 'A project portfolio is not a Target Operating Model…' (B0059).
//  - Outcome contributions: the outcome is required, the KPI (T02 row) optional; both labelled so (B0048).
//  - Transitions submit, withdraw, select, deselect, launch and cancel, each in its reason / rationale / note dialog.
//    Select and deselect are business approvals and labelled so. Every 422 is the dialog's one translated alert.
//    There is no "on behalf of" control (ADR-0021 §6).
//  - A cancelled or completed initiative is read-only (ADR-0021 §2): no edit control is offered.
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { initiativeUpdate } from "@mth/shared/schemas";
import { api, ApiError } from "../../api/client.ts";
import {
  useDecisionLinks,
  useDeliverables,
  useGapLinks,
  useInitiative,
  useMilestones,
  useOutcomeContributions,
  useSelections,
  useWaves,
} from "../../api/portfolio.ts";
import { useDecisions, useP3Refresh, useRegister } from "../../api/queries.ts";
import type {
  Decision,
  DiagnosticFinding,
  Initiative,
  Journey,
  OutcomeKpi,
  Outcome,
  KpiDefinition,
  TomGap,
} from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Unknown } from "../../components/Badges.tsx";
import { BLANK_CODE, Dialog, Field, isBlankText, REQUIRED_CODE, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { Section, SectionNav, TextCell } from "../../components/Section.tsx";
import { NoPermissionState, QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { tomDimensionLabel } from "../../lib/methodology.ts";
import { fieldErrorMessage, isNoPermission } from "../../lib/problem.ts";
import {
  ActionDialog,
  BusinessApprovalTag,
  FundingCell,
  InitiativeStatusChip,
  p3ProblemMessage,
  SelectionCell,
  WarningList,
  waveName,
} from "./common.tsx";

const READ_ONLY_STATUSES: ReadonlySet<string> = new Set(["cancelled", "completed"]);

export function InitiativePage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="portfolio"
      title={t("portfolio.initiativeTitle")}
      writePermissions={["initiative.edit", "initiative.launch", "portfolio.select"]}
    >
      <InitiativeBody />
    </WorkspaceFrame>
  );
}

function InitiativeBody() {
  const { initiativeId = "" } = useParams();
  const ws = useWorkspace();
  const query = useInitiative(ws.tid, initiativeId);
  if (query.isError && isNoPermission(query.error)) return <NoPermissionState error={query.error} />;
  return <QueryState query={query}>{(i) => <InitiativeCard initiative={i} />}</QueryState>;
}

function InitiativeCard({ initiative: i }: { initiative: Initiative }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const readOnly = READ_ONLY_STATUSES.has(i.status);
  return (
    <div data-initiative={i.id} data-status={i.status}>
      <section className="card section" aria-labelledby="initiative-summary-title">
        <div className="card__header section__header">
          <h2 id="initiative-summary-title" className="card__title">
            <bdi dir="ltr" className="code">
              {i.code}
            </bdi>{" "}
            {i.name}
          </h2>
          <Link className="link" to={`/transformations/${ws.tid}/portfolio`}>
            {t("portfolio.card.backToList")}
          </Link>
        </div>
        <dl className="summary-list">
          <div>
            <dt>{t("portfolio.field.status")}</dt>
            <dd>
              <InitiativeStatusChip initiative={i} />
            </dd>
          </div>
          <div>
            <dt>{t("portfolio.field.selection")}</dt>
            <dd>
              <SelectionCell initiative={i} />
            </dd>
          </div>
          <div>
            <dt>{t("portfolio.field.funding")}</dt>
            <dd>
              <FundingCell initiative={i} />
            </dd>
          </div>
        </dl>
        {i.status === "draft" ? (
          <p className="banner banner--info" role="note" data-state="draft">
            <Icon name="pencil" /> {t("portfolio.card.draftNote")}
          </p>
        ) : null}
        {readOnly ? (
          <p className="banner banner--info" role="note" data-state="initiative-read-only">
            <Icon name="lock" /> {t("portfolio.card.readOnly", { status: t(`portfolio.status.${i.status}`) })}
          </p>
        ) : null}
        {i.cancelReason ? (
          <p className="small">
            {t("portfolio.card.cancelReason")}: <span className="text-cell">{i.cancelReason}</span>
          </p>
        ) : null}
        {i.warnings.length > 0 ? (
          <div className="banner banner--warning" role="note" data-state="warnings">
            <p>
              <strong>{t("portfolio.card.warningsTitle")}</strong> {t("portfolio.card.warningsBody")}
            </p>
            <WarningList warnings={i.warnings} />
          </div>
        ) : null}
        <Transitions initiative={i} />
      </section>
      <SectionNav
        sections={[
          { id: "t05", title: t("portfolio.card.t05Title") },
          { id: "gap-links", title: t("portfolio.gap.title") },
          { id: "contributions", title: t("portfolio.contribution.title") },
          { id: "decision-links", title: t("portfolio.decisionLink.title") },
          { id: "deliverables", title: t("portfolio.deliverable.title") },
          { id: "milestones", title: t("portfolio.milestone.title") },
          { id: "selections", title: t("portfolio.selectionHistory.title") },
        ]}
      />
      <T05Card initiative={i} readOnly={readOnly} />
      <GapLinks initiative={i} readOnly={readOnly} />
      <Contributions initiative={i} readOnly={readOnly} />
      <DecisionLinks initiative={i} readOnly={readOnly} />
      <Deliverables initiative={i} />
      <Milestones initiative={i} />
      <SelectionHistory initiative={i} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ transitions

type TransitionId = "submit" | "withdraw" | "select" | "deselect" | "launch" | "cancel";

const TRANSITIONS: Record<
  TransitionId,
  {
    from: readonly string[];
    permission: "initiative.edit" | "initiative.launch" | "portfolio.select";
    text: "note" | "reason" | "rationale";
    required: boolean;
    businessApproval: boolean;
    danger?: boolean;
  }
> = {
  submit: { from: ["draft"], permission: "initiative.edit", text: "note", required: false, businessApproval: false },
  withdraw: {
    from: ["submitted", "ranked"],
    permission: "initiative.edit",
    text: "reason",
    required: true,
    businessApproval: false,
  },
  select: {
    from: ["ranked"],
    permission: "portfolio.select",
    text: "rationale",
    required: true,
    businessApproval: true,
  },
  deselect: {
    from: ["selected", "funded"],
    permission: "portfolio.select",
    text: "rationale",
    required: true,
    businessApproval: true,
  },
  launch: {
    from: ["selected", "funded"],
    permission: "initiative.launch",
    text: "note",
    required: false,
    businessApproval: false,
  },
  cancel: {
    from: ["draft", "submitted", "ranked", "selected", "funded"],
    permission: "initiative.edit",
    text: "reason",
    required: true,
    businessApproval: false,
    danger: true,
  },
};

function Transitions({ initiative: i }: { initiative: Initiative }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP3Refresh(ws.tid);
  const [open, setOpen] = useState<TransitionId | null>(null);
  const available = (Object.keys(TRANSITIONS) as TransitionId[]).filter(
    (id) => TRANSITIONS[id].from.includes(i.status) && ws.can(TRANSITIONS[id].permission),
  );
  if (available.length === 0) return null;
  const spec = open ? TRANSITIONS[open] : null;
  return (
    <div className="section__actions transitions" role="group" aria-label={t("portfolio.transition.label")}>
      {available.map((id) => (
        <button
          key={id}
          type="button"
          className={`button button--small ${TRANSITIONS[id].danger ? "button--secondary" : "button--primary"}`}
          data-transition={id}
          onClick={() => setOpen(id)}
        >
          {t(`portfolio.transition.${id}.action`)}
          {TRANSITIONS[id].businessApproval ? (
            <span className="small"> ({t("portfolio.businessApproval")})</span>
          ) : null}
        </button>
      ))}
      {open && spec ? (
        <ActionDialog
          title={t(`portfolio.transition.${open}.title`, { code: i.code })}
          description={<p>{t(`portfolio.transition.${open}.description`)}</p>}
          businessApproval={spec.businessApproval}
          text={{
            label: t(`portfolio.transition.text.${spec.text}`),
            name: spec.text,
            required: spec.required,
            ...(spec.required ? { min: 3 } : {}),
            max: spec.text === "rationale" ? 4000 : spec.text === "reason" ? 1000 : 2000,
          }}
          confirmLabel={t(`portfolio.transition.${open}.confirm`)}
          {...(spec.danger ? { danger: true } : {})}
          url={`/api/v1/initiatives/${i.id}/${open}`}
          version={i.version}
          onDone={refresh}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ T05 card

function T05Card({ initiative: i, readOnly }: { initiative: Initiative; readOnly: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const { people, byId } = usePeople(ws.tid);
  const waves = useWaves(ws.tid);
  const refresh = useP3Refresh(ws.tid);
  const [editing, setEditing] = useState(false);
  const canEdit = !readOnly && ws.can("initiative.edit");
  const wave = waves.data?.find((w) => w.id === i.waveId);
  const base = `/transformations/${ws.tid}`;

  const rows: { n: number; key: string; value: ReactNode }[] = [
    { n: 1, key: "name", value: <span className="text-cell">{i.name}</span> },
    { n: 2, key: "executiveOwner", value: <PersonName id={i.executiveOwnerUserId} people={byId} /> },
    { n: 3, key: "workstreamLead", value: <PersonName id={i.workstreamLeadUserId} people={byId} /> },
    {
      n: 4,
      key: "problemGap",
      value: (
        <>
          <TextCell value={i.problemStatement} />
          <a className="link block small" href="#gap-links">
            {t("portfolio.card.seeGapLinks")}
          </a>
        </>
      ),
    },
    { n: 5, key: "objective", value: <TextCell value={i.objective} /> },
    {
      n: 6,
      key: "scope",
      value: (
        <>
          <span className="block">
            <strong>{t("portfolio.field.scopeIn")}:</strong> <TextCell value={i.scopeIn} />
          </span>
          <span className="block">
            <strong>{t("portfolio.field.scopeOut")}:</strong> <TextCell value={i.scopeOut} />
          </span>
        </>
      ),
    },
    {
      n: 7,
      key: "deliverables",
      value: (
        <a className="link" href="#deliverables">
          {t("portfolio.card.seeDeliverables")}
        </a>
      ),
    },
    {
      n: 8,
      key: "contribution",
      value: (
        <a className="link" href="#contributions">
          {t("portfolio.card.seeContributions")}
        </a>
      ),
    },
    { n: 9, key: "financialBenefit", value: <TextCell value={i.financialBenefitSummary} /> },
    { n: 10, key: "customerBenefit", value: <TextCell value={i.customerBenefitSummary} /> },
    {
      n: 11,
      key: "dependencies",
      value: (
        <Link className="link" to={`${base}/dependencies`}>
          {t("portfolio.card.seeDependencies")}
        </Link>
      ),
    },
    { n: 12, key: "risks", value: <TextCell value={i.risksSummary} /> },
    {
      n: 13,
      key: "milestones",
      value: (
        <a className="link" href="#milestones">
          {t("portfolio.card.seeMilestones")}
        </a>
      ),
    },
    {
      n: 14,
      key: "decisions",
      value: (
        <a className="link" href="#decision-links">
          {t("portfolio.card.seeDecisions")}
        </a>
      ),
    },
  ];

  const fields: FieldSpec[] = [
    { name: "name", kind: "text", label: t("portfolio.t05.name"), required: true, maxLength: 300 },
    { name: "executiveOwnerUserId", kind: "person", label: t("portfolio.t05.executiveOwner") },
    { name: "workstreamLeadUserId", kind: "person", label: t("portfolio.t05.workstreamLead") },
    {
      name: "problemStatement",
      kind: "textarea",
      label: t("portfolio.field.problemStatement"),
      rows: 3,
      maxLength: 8000,
    },
    { name: "objective", kind: "textarea", label: t("portfolio.t05.objective"), rows: 3, maxLength: 4000 },
    { name: "scopeIn", kind: "textarea", label: t("portfolio.field.scopeIn"), rows: 3, maxLength: 8000 },
    { name: "scopeOut", kind: "textarea", label: t("portfolio.field.scopeOut"), rows: 3, maxLength: 8000 },
    {
      name: "financialBenefitSummary",
      kind: "textarea",
      label: t("portfolio.t05.financialBenefit"),
      hint: t("portfolio.field.financialBenefitHint"),
      rows: 3,
      maxLength: 4000,
    },
    {
      name: "customerBenefitSummary",
      kind: "textarea",
      label: t("portfolio.t05.customerBenefit"),
      rows: 3,
      maxLength: 4000,
    },
    { name: "risksSummary", kind: "textarea", label: t("portfolio.t05.risks"), rows: 3, maxLength: 4000 },
    {
      name: "waveId",
      kind: "select",
      label: t("portfolio.field.wave"),
      options: (waves.data ?? [])
        .filter((w) => w.status === "active")
        .map((w) => ({ value: w.id, label: waveName(w, locale) ?? w.code })),
    },
    { name: "plannedStart", kind: "date", label: t("portfolio.field.plannedStart") },
    { name: "plannedEnd", kind: "date", label: t("portfolio.field.plannedEnd") },
  ];

  return (
    <Section
      id="t05"
      title={t("portfolio.card.t05Title")}
      intro={t("portfolio.card.t05Intro")}
      actions={
        canEdit ? (
          <button type="button" className="button button--secondary button--small" onClick={() => setEditing(true)}>
            <Icon name="pencil" /> {t("portfolio.card.edit")}
          </button>
        ) : null
      }
    >
      <dl className="t05-fields">
        {rows.map((r) => (
          <div key={r.key} data-t05={r.n} className="t05-field">
            <dt>
              <bdi dir="ltr">{r.n}.</bdi> {t(`portfolio.t05.${r.key}`)}
            </dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <dl className="summary-list">
        <div>
          <dt>{t("portfolio.field.wave")}</dt>
          <dd>
            {i.waveId ? (
              (waveName(wave, locale) ?? <Unknown />)
            ) : (
              <span className="muted">{t("portfolio.wave.none")}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("portfolio.field.plannedStart")}</dt>
          <dd>
            {formatBusinessDate(i.plannedStart, locale) ?? <span className="muted">{t("common.value.none")}</span>}
          </dd>
        </div>
        <div>
          <dt>{t("portfolio.field.plannedEnd")}</dt>
          <dd>{formatBusinessDate(i.plannedEnd, locale) ?? <span className="muted">{t("common.value.none")}</span>}</dd>
        </div>
      </dl>
      {editing ? (
        <RecordDialog<Initiative>
          title={t("portfolio.card.editTitle", { code: i.code })}
          fields={fields}
          record={i}
          updateSchema={initiativeUpdate}
          updateUrl={(r) => `/api/v1/initiatives/${r.id}`}
          people={people}
          submitLabel={t("common.action.save")}
          onSaved={async () => {
            if (!(await refresh())) return;
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ link dialog

interface LinkFieldSpec {
  readonly name: string;
  readonly label: string;
  readonly kind: "select" | "textarea";
  readonly required: boolean;
  readonly hint?: string;
  readonly options?: readonly { value: string; label: string; group?: string }[];
  readonly max?: number;
}

/**
 * Create one link of the initiative (gap link, outcome contribution, decision link): a hand-written form with the
 * blank-text rule, inline field errors and ONE translated form-level alert for the server's problem.
 */
function LinkDialog({
  title,
  description,
  fields,
  url,
  toBody,
  submitLabel,
  onChange,
  onDone,
  onClose,
}: {
  title: string;
  description?: string;
  fields: readonly LinkFieldSpec[];
  url: string;
  toBody: (values: Record<string, string>) => Record<string, unknown>;
  submitLabel: string;
  onChange?: (values: Record<string, string>) => void;
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errorCodes, setErrorCodes] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);

  const set = (name: string, value: string) => {
    const next = { ...values, [name]: value };
    setValues(next);
    onChange?.(next);
  };

  const submit = async () => {
    setServerError(null);
    const next: Record<string, string> = {};
    for (const f of fields) {
      const v = values[f.name] ?? "";
      if (f.kind === "textarea" && isBlankText(v)) next[f.name] = BLANK_CODE;
      else if (f.required && v === "") next[f.name] = REQUIRED_CODE;
    }
    setErrorCodes(next);
    if (Object.keys(next).length > 0) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(url, { method: "POST", body: toBody(values) });
      if (action.stale()) return;
      if (!(await onDone())) return;
      onClose();
    } catch (e) {
      if (action.stale(e)) return;
      setServerError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={title}
      onClose={onClose}
      dialogRef={dialogRef}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : submitLabel}
          </button>
        </>
      }
    >
      {description ? <p>{description}</p> : null}
      {serverError ? (
        <div
          className="banner banner--error"
          role="alert"
          data-state="error"
          data-problem={serverError instanceof ApiError ? (serverError.code ?? "") : ""}
        >
          <p>
            <Icon name="alert" /> {p3ProblemMessage(t, serverError)}
          </p>
        </div>
      ) : null}
      {fields.map((f) => (
        <Field
          key={f.name}
          label={f.label}
          hint={f.hint}
          required={f.required}
          error={errorCodes[f.name] ? fieldErrorMessage(t, errorCodes[f.name]!) : undefined}
        >
          {(control) =>
            f.kind === "select" ? (
              <select {...control} value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">{t("common.form.choose")}</option>
                {groupOptions(f.options ?? []).map(([group, opts]) =>
                  group ? (
                    <optgroup key={group} label={group}>
                      {opts.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    opts.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))
                  ),
                )}
              </select>
            ) : (
              <textarea
                {...control}
                rows={3}
                maxLength={f.max}
                value={values[f.name] ?? ""}
                onChange={(e) => set(f.name, e.target.value)}
              />
            )
          }
        </Field>
      ))}
    </Dialog>
  );
}

function groupOptions(
  options: readonly { value: string; label: string; group?: string }[],
): [string, { value: string; label: string }[]][] {
  const out: [string, { value: string; label: string }[]][] = [];
  for (const o of options) {
    const g = o.group ?? "";
    const last = out[out.length - 1];
    if (last && last[0] === g) last[1].push(o);
    else out.push([g, [o]]);
  }
  return out;
}

/** "Remove" action of a link row: a mandatory reason, If-Match on the link's version. */
function RemoveLink({
  url,
  version,
  label,
  onDone,
}: {
  url: string;
  version: number;
  label: string;
  onDone: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="button button--link button--small" onClick={() => setOpen(true)}>
        <Icon name="archive" /> {t("portfolio.link.remove")}
        <span className="visually-hidden">: {label}</span>
      </button>
      {open ? (
        <ActionDialog
          title={t("portfolio.link.removeTitle", { label })}
          description={<p>{t("portfolio.link.removeDescription")}</p>}
          text={{ label: t("portfolio.transition.text.reason"), name: "reason", required: true, min: 3, max: 1000 }}
          confirmLabel={t("portfolio.link.remove")}
          danger
          url={url}
          version={version}
          onDone={onDone}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ gap links

const OTHER_TOM_TYPES = ["journey"] as const;

function GapLinks({ initiative: i, readOnly }: { initiative: Initiative; readOnly: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const links = useGapLinks(ws.tid, i.id);
  const gaps = useRegister<TomGap>(ws.tid, "tom-gaps");
  const findings = useRegister<DiagnosticFinding>(ws.tid, "diagnostic-findings");
  const journeys = useRegister<Journey>(ws.tid, "journeys");
  const refresh = useP3Refresh(ws.tid);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState("");
  const canEdit = !readOnly && ws.can("initiative.edit");

  const gapLabel = (g: TomGap) =>
    `${tomDimensionLabel(ws.methodology, g.dimensionCode, locale) ?? g.dimensionCode}: ${g.gap ?? ""}`.trim();
  const findingLabel = (f: DiagnosticFinding) => f.statement;
  const targetLabel = (l: { targetType: string; tomGapId: string | null; diagnosticFindingId: string | null }) => {
    if (l.targetType === "tom_gap") {
      const g = gaps.data?.find((x) => x.id === l.tomGapId);
      return g ? gapLabel(g) : null;
    }
    const f = findings.data?.find((x) => x.id === l.diagnosticFindingId);
    return f ? findingLabel(f) : null;
  };

  const targetOptions =
    type === "tom_gap"
      ? (gaps.data ?? []).filter((g) => g.status !== "archived").map((g) => ({ value: g.id, label: gapLabel(g) }))
      : type === "diagnostic_finding"
        ? (findings.data ?? [])
            .filter((f) => f.status !== "archived")
            .map((f) => ({ value: f.id, label: findingLabel(f) }))
        : type === "journey"
          ? (journeys.data ?? []).map((j) => ({ value: j.id, label: j.name }))
          : [];

  return (
    <Section
      id="gap-links"
      title={t("portfolio.gap.title")}
      intro={t("portfolio.gap.intro")}
      actions={
        canEdit ? (
          <button type="button" className="button button--secondary button--small" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t("portfolio.gap.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={links}>
        {(list) =>
          list.length === 0 ? (
            <p className="muted" data-state="empty">
              {t("portfolio.gap.empty")}
            </p>
          ) : (
            <ul className="plain-list link-list">
              {list.map((l) => {
                const label = targetLabel(l);
                return (
                  <li key={l.id} data-gap-link={l.targetType}>
                    <span className="lifecycle-chip">{t(`portfolio.gap.type.${l.targetType}`)}</span>{" "}
                    {label ?? <Unknown hint={t("common.value.notVisible")} />}
                    {l.note ? <span className="block small text-cell">{l.note}</span> : null}{" "}
                    {canEdit ? (
                      <RemoveLink
                        url={`/api/v1/initiatives/${i.id}/gap-links/${l.id}/remove`}
                        version={l.version}
                        label={label ?? t(`portfolio.gap.type.${l.targetType}`)}
                        onDone={refresh}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )
        }
      </QueryState>
      {adding ? (
        <LinkDialog
          title={t("portfolio.gap.addTitle", { code: i.code })}
          description={t("portfolio.gap.addDescription")}
          fields={[
            {
              name: "targetType",
              label: t("portfolio.gap.field.type"),
              kind: "select",
              required: true,
              hint: t("portfolio.gap.field.typeHint"),
              options: [
                { value: "tom_gap", label: t("portfolio.gap.type.tom_gap") },
                { value: "diagnostic_finding", label: t("portfolio.gap.type.diagnostic_finding") },
                ...OTHER_TOM_TYPES.map((x) => ({
                  value: x,
                  label: t(`portfolio.gap.type.${x}`),
                  group: t("portfolio.gap.otherTomGroup"),
                })),
              ],
            },
            {
              name: "targetId",
              label: t("portfolio.gap.field.target"),
              kind: "select",
              required: true,
              options: targetOptions,
            },
            { name: "note", label: t("portfolio.gap.field.note"), kind: "textarea", required: false, max: 2000 },
          ]}
          url={`/api/v1/initiatives/${i.id}/gap-links`}
          toBody={(v) => ({
            targetType: v["targetType"],
            targetId: v["targetId"],
            ...(v["note"] ? { note: v["note"] } : {}),
          })}
          submitLabel={t("portfolio.gap.add")}
          onChange={(v) => setType(v["targetType"] ?? "")}
          onDone={refresh}
          onClose={() => {
            setAdding(false);
            setType("");
          }}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ contributions

function Contributions({ initiative: i, readOnly }: { initiative: Initiative; readOnly: boolean }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const contributions = useOutcomeContributions(ws.tid, i.id);
  const outcomes = useRegister<Outcome>(ws.tid, "outcomes");
  const outcomeKpis = useRegister<OutcomeKpi>(ws.tid, "outcome-kpis");
  const kpis = useRegister<KpiDefinition>(ws.tid, "kpi-definitions");
  const refresh = useP3Refresh(ws.tid);
  const [adding, setAdding] = useState(false);
  const [outcomeId, setOutcomeId] = useState("");
  const canEdit = !readOnly && ws.can("initiative.edit");

  const outcomeLabel = (id: string) => outcomes.data?.find((o) => o.id === id)?.statement ?? null;
  const kpiLabel = (outcomeKpiId: string) => {
    const row = outcomeKpis.data?.find((r) => r.id === outcomeKpiId);
    if (!row) return null;
    return kpis.data?.find((k) => k.id === row.kpiDefinitionId)?.name ?? null;
  };

  return (
    <Section
      id="contributions"
      title={t("portfolio.contribution.title")}
      intro={t("portfolio.contribution.intro")}
      actions={
        canEdit ? (
          <button type="button" className="button button--secondary button--small" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t("portfolio.contribution.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={contributions}>
        {(list) =>
          list.length === 0 ? (
            <p className="muted" data-state="empty">
              {t("portfolio.contribution.empty")}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">{t("portfolio.contribution.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("portfolio.contribution.field.outcome")}</th>
                    <th scope="col">{t("portfolio.contribution.field.kpi")}</th>
                    <th scope="col">{t("portfolio.contribution.field.statement")}</th>
                    <th scope="col">{t("portfolio.contribution.field.movement")}</th>
                    {canEdit ? <th scope="col">{t("common.field.actions")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id} data-contribution={c.id} data-has-kpi={c.outcomeKpiId ? "true" : "false"}>
                      <th scope="row">
                        {outcomeLabel(c.outcomeId) ?? <Unknown hint={t("common.value.notVisible")} />}
                      </th>
                      <td>
                        {c.outcomeKpiId ? (
                          (kpiLabel(c.outcomeKpiId) ?? <Unknown hint={t("common.value.notVisible")} />)
                        ) : (
                          <span className="muted">{t("portfolio.contribution.noKpi")}</span>
                        )}
                      </td>
                      <td>
                        <TextCell value={c.contributionStatement} />
                      </td>
                      <td>
                        <TextCell value={c.expectedKpiMovement} />
                      </td>
                      {canEdit ? (
                        <td>
                          <RemoveLink
                            url={`/api/v1/initiatives/${i.id}/outcome-contributions/${c.id}/remove`}
                            version={c.version}
                            label={outcomeLabel(c.outcomeId) ?? t("portfolio.contribution.field.outcome")}
                            onDone={refresh}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryState>
      {adding ? (
        <LinkDialog
          title={t("portfolio.contribution.addTitle", { code: i.code })}
          description={t("portfolio.contribution.addDescription")}
          fields={[
            {
              name: "outcomeId",
              label: t("portfolio.contribution.field.outcome"),
              kind: "select",
              required: true,
              options: (outcomes.data ?? [])
                .filter((o) => o.status !== "archived")
                .map((o) => ({ value: o.id, label: o.statement })),
            },
            {
              name: "outcomeKpiId",
              label: t("portfolio.contribution.field.kpiOptional"),
              hint: t("portfolio.contribution.field.kpiHint"),
              kind: "select",
              required: false,
              options: (outcomeKpis.data ?? [])
                .filter((r) => r.outcomeId === outcomeId && r.status !== "archived")
                .map((r) => ({
                  value: r.id,
                  label: kpis.data?.find((k) => k.id === r.kpiDefinitionId)?.name ?? r.id,
                })),
            },
            {
              name: "contributionStatement",
              label: t("portfolio.contribution.field.statement"),
              kind: "textarea",
              required: true,
              max: 2000,
            },
            {
              name: "expectedKpiMovement",
              label: t("portfolio.contribution.field.movement"),
              kind: "textarea",
              required: false,
              max: 500,
            },
          ]}
          url={`/api/v1/initiatives/${i.id}/outcome-contributions`}
          toBody={(v) => ({
            outcomeId: v["outcomeId"],
            ...(v["outcomeKpiId"] ? { outcomeKpiId: v["outcomeKpiId"] } : {}),
            contributionStatement: v["contributionStatement"],
            ...(v["expectedKpiMovement"] ? { expectedKpiMovement: v["expectedKpiMovement"] } : {}),
          })}
          submitLabel={t("portfolio.contribution.add")}
          onChange={(v) => setOutcomeId(v["outcomeId"] ?? "")}
          onDone={refresh}
          onClose={() => {
            setAdding(false);
            setOutcomeId("");
          }}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ decision links

function DecisionLinks({ initiative: i, readOnly }: { initiative: Initiative; readOnly: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const links = useDecisionLinks(ws.tid, i.id);
  const design = useDecisions(ws.tid, "design");
  const executive = useDecisions(ws.tid, "executive");
  const { byId } = usePeople(ws.tid);
  const refresh = useP3Refresh(ws.tid);
  const [adding, setAdding] = useState(false);
  const canEdit = !readOnly && ws.can("initiative.edit");
  const all: Decision[] = [...(design.data ?? []), ...(executive.data ?? [])];
  const decisionOf = (id: string) => all.find((d) => d.id === id);

  return (
    <Section
      id="decision-links"
      title={t("portfolio.decisionLink.title")}
      intro={t("portfolio.decisionLink.intro")}
      actions={
        canEdit ? (
          <button type="button" className="button button--secondary button--small" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t("portfolio.decisionLink.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={links}>
        {(list) =>
          list.length === 0 ? (
            <p className="muted" data-state="empty">
              {t("portfolio.decisionLink.empty")}
            </p>
          ) : (
            <ul className="plain-list link-list">
              {list.map((l) => {
                const d = decisionOf(l.decisionId);
                return (
                  <li key={l.id} data-decision-link={l.decisionId}>
                    {d ? (
                      <>
                        <bdi dir="ltr" className="code">
                          {d.code}
                        </bdi>{" "}
                        {d.title}{" "}
                        <span className="small muted">
                          {t("portfolio.decisionLink.owner")}: <PersonName id={d.ownerUserId} people={byId} /> ·{" "}
                          {t("portfolio.decisionLink.due")}:{" "}
                          {formatBusinessDate(d.dueDate, locale) ?? t("common.value.none")} ·{" "}
                          {t(`common.recordStatus.${d.status}`, { defaultValue: d.status })}
                        </span>
                      </>
                    ) : (
                      <Unknown hint={t("common.value.notVisible")} />
                    )}{" "}
                    {canEdit ? (
                      <RemoveLink
                        url={`/api/v1/initiatives/${i.id}/decision-links/${l.id}/remove`}
                        version={l.version}
                        label={d?.code ?? t("portfolio.decisionLink.title")}
                        onDone={refresh}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )
        }
      </QueryState>
      {adding ? (
        <LinkDialog
          title={t("portfolio.decisionLink.addTitle", { code: i.code })}
          fields={[
            {
              name: "decisionId",
              label: t("portfolio.decisionLink.field.decision"),
              kind: "select",
              required: true,
              options: all
                .filter((d) => d.status !== "cancelled")
                .map((d) => ({ value: d.id, label: `${d.code} ${d.title}` })),
            },
          ]}
          url={`/api/v1/initiatives/${i.id}/decision-links`}
          toBody={(v) => ({ decisionId: v["decisionId"] })}
          submitLabel={t("portfolio.decisionLink.add")}
          onDone={refresh}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ roadmap parts

function Deliverables({ initiative: i }: { initiative: Initiative }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const list = useDeliverables(ws.tid, i.id);
  const { byId } = usePeople(ws.tid);
  return (
    <Section
      id="deliverables"
      title={t("portfolio.deliverable.title")}
      intro={t("portfolio.deliverable.intro")}
      actions={
        <Link className="link" to={`/transformations/${ws.tid}/roadmap`}>
          {t("portfolio.card.openRoadmap")}
        </Link>
      }
    >
      <QueryState query={list}>
        {(d) => {
          const active = d.items.filter((x) => x.status === "active");
          return (
            <>
              <p data-deliverable-count={active.length}>{t("portfolio.deliverable.count", { count: active.length })}</p>
              {d.countWarning ? (
                <p className="banner banner--warning" role="note" data-warning={d.countWarning.code}>
                  <Icon name="alert" /> {t("portfolio.warning.initiative__deliverable_count")}{" "}
                  {t("portfolio.deliverable.notABlock")}
                </p>
              ) : null}
              {active.length === 0 ? null : (
                <ul className="plain-list">
                  {active
                    .sort((a, b) => a.ordinal - b.ordinal)
                    .map((x) => (
                      <li key={x.id} data-deliverable={x.id}>
                        <bdi dir="ltr">{x.ordinal}.</bdi> {x.title}{" "}
                        <span className="small muted">
                          <PersonName id={x.ownerUserId} people={byId} /> ·{" "}
                          {formatBusinessDate(x.dueDate, locale) ?? t("common.value.none")} ·{" "}
                          {t(`portfolio.deliverable.acceptance.${x.acceptanceStatus}`)}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </>
          );
        }}
      </QueryState>
    </Section>
  );
}

function Milestones({ initiative: i }: { initiative: Initiative }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const list = useMilestones(ws.tid, i.id);
  return (
    <Section
      id="milestones"
      title={t("portfolio.milestone.title")}
      intro={t("portfolio.milestone.intro")}
      actions={
        <Link className="link" to={`/transformations/${ws.tid}/roadmap`}>
          {t("portfolio.card.openRoadmap")}
        </Link>
      }
    >
      <QueryState query={list}>
        {(items) =>
          items.length === 0 ? (
            <p className="muted" data-state="empty">
              {t("portfolio.milestone.empty")}
            </p>
          ) : (
            <ul className="plain-list">
              {items.map((m) => (
                <li key={m.id} data-milestone={m.id}>
                  {m.title}{" "}
                  <span className="small muted">
                    {t("portfolio.milestone.approved")}:{" "}
                    {formatBusinessDate(m.approvedDate, locale) ?? t("portfolio.milestone.notApproved")} ·{" "}
                    {t("portfolio.milestone.forecast")}:{" "}
                    {formatBusinessDate(m.forecastDate, locale) ?? t("common.value.none")}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Section>
  );
}

function SelectionHistory({ initiative: i }: { initiative: Initiative }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const list = useSelections(ws.tid, i.id);
  const { byId } = usePeople(ws.tid);
  return (
    <Section id="selections" title={t("portfolio.selectionHistory.title")} actions={<BusinessApprovalTag />}>
      <QueryState query={list}>
        {(items) =>
          items.length === 0 ? (
            <p className="muted" data-state="empty">
              {t("portfolio.selectionHistory.empty")}
            </p>
          ) : (
            <ul className="plain-list">
              {items.map((s) => (
                <li key={s.id} data-selection-row={s.action}>
                  <strong>{t(`portfolio.selectionHistory.action.${s.action}`)}</strong> —{" "}
                  <span className="text-cell">{s.rationale}</span>{" "}
                  <span className="small muted">
                    {formatDateTime(s.decidedAt, locale, ws.tr.timezone)} ·{" "}
                    <PersonName id={s.decidedBy} people={byId} />
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Section>
  );
}
