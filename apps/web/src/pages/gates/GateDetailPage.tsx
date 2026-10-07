// One product gate (business approval): definition, configured approver, the LIVE readiness of every required output
// with its evidence state, submission (gate.submit; If-Match on the gate), the approver's decision with a mandatory
// rationale, and the submission history with the frozen criteria. The 403 (not the approver / submitter cannot decide)
// and 409 (submission superseded, version conflict) problems are shown as translated messages; nothing is assumed.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { GATE_OUTCOMES, gateApproverConfig, gateDecisionCreate, gateSubmissionCreate } from "@mth/shared/schemas";
import { api, ApiError, isSessionChangedError } from "../../api/client.ts";
import { useGate, useGateSubmission, useGateSubmissions, useP2Refresh, useRegister } from "../../api/queries.ts";
import type {
  Evidence,
  GateCriterionEvaluation,
  GateView,
  KpiDefinition,
  Outcome,
  TomGap,
  Decision,
} from "../../api/types.ts";
import { useDecisions } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { BLANK_CODE, Dialog, Field, isBlankText, issueCode, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { CompletenessChip, EvidenceStateChip, GateStatusChip } from "../../components/P2Badges.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { diagnosticDimensionLabel, gateLabel, pick, tomDimensionLabel } from "../../lib/methodology.ts";
import { errorMessage, fieldErrorMessage, fieldErrorMessages } from "../../lib/problem.ts";
import { BusinessApprovalNote, readiness } from "./GatesPage.tsx";

export function GateDetailPage() {
  const { t } = useTranslation();
  const { gateCode = "" } = useParams();
  return (
    <WorkspaceFrame
      tab="gates"
      title={t("gates.gateTitle", { code: gateCode })}
      writePermissions={["gate.submit", "gate.decide", "gate.configure"]}
    >
      <BusinessApprovalNote />
      <GateBody code={gateCode} />
    </WorkspaceFrame>
  );
}

function GateBody({ code }: { code: string }) {
  const ws = useWorkspace();
  const gate = useGate(ws.tid, code);
  return <QueryState query={gate}>{(view) => <GateContent view={view} />}</QueryState>;
}

function GateContent({ view }: { view: GateView }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [submitting, setSubmitting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const def = view.definition;
  const r = readiness(view);
  const current = view.currentSubmission;
  const canConfigure = ws.can("gate.configure") && !(current && current.status === "pending");

  return (
    <>
      <Section
        id="gate"
        title={gateLabel(def, locale)}
        actions={
          <span className="section__actions">
            {view.submissionEnabled && view.canSubmit ? (
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => setSubmitting(true)}
              >
                <Icon name="check" /> {t("gates.submit.action")}
              </button>
            ) : null}
            {view.submissionEnabled && !view.canSubmit && ws.can("gate.submit") && view.gate.status !== "approved" ? (
              <button
                type="button"
                className="button button--primary button--small"
                disabled
                aria-describedby="gate-submit-blocked"
                data-submit-blocked="true"
              >
                <Icon name="check" /> {t("gates.submit.action")}
              </button>
            ) : null}
            {view.canDecide && current && current.status === "pending" ? (
              <button type="button" className="button button--primary button--small" onClick={() => setDeciding(true)}>
                <Icon name="check" /> {t("gates.decision.action")}
              </button>
            ) : null}
            {canConfigure ? (
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={() => setConfiguring(true)}
              >
                <Icon name="pencil" /> {t("gates.configure.action")}
              </button>
            ) : null}
          </span>
        }
      >
        <dl className="details">
          <div>
            <dt>{t("gates.decisionQuestion")}</dt>
            <dd>{pick(locale, def.sourceDecisionQuestionEn, def.decisionQuestionAr)}</dd>
          </div>
          <div>
            <dt>{t("gates.evidenceRequired")}</dt>
            <dd>{pick(locale, def.sourceEvidenceRequiredEn, def.evidenceRequiredAr)}</dd>
          </div>
          <div>
            <dt>{t("common.field.status")}</dt>
            <dd>
              <GateStatusChip status={view.gate.status} />
            </dd>
          </div>
          <div>
            <dt>{t("gates.approver")}</dt>
            <dd>
              {t(`transformations.audit.role.${view.gate.approverRoleCode}`, {
                defaultValue: view.gate.approverRoleCode,
              })}
              {view.gate.approverUserId ? (
                <span className="block">
                  <PersonName id={view.gate.approverUserId} people={byId} />
                </span>
              ) : (
                <span className="block muted small">{t("gates.anyRoleHolder")}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("gates.phase")}</dt>
            <dd>
              {t(`transformations.phase.${def.phase}`)}
              {def.nextPhase ? (
                <span className="block muted small">
                  {t("gates.nextPhase", { phase: t(`transformations.phase.${def.nextPhase}`) })}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t("gates.currentSubmission")}</dt>
            <dd>
              {current ? (
                <>
                  {t("gates.submissionN", { n: current.submissionNo })} ·{" "}
                  {t(`gates.submissionStatus.${current.status}`)}
                  <span className="block muted small">
                    {formatDateTime(current.submittedAt, locale, ws.tr.timezone)} ·{" "}
                    <PersonName id={current.submittedBy} people={byId} />
                  </span>
                </>
              ) : (
                <span className="muted">{t("gates.notSubmitted")}</span>
              )}
            </dd>
          </div>
        </dl>
        {view.submissionEnabled && !view.canSubmit && ws.can("gate.submit") && view.gate.status !== "approved" ? (
          <p id="gate-submit-blocked" className="banner banner--warning" role="note">
            <Icon name="alert" /> {t("gates.submit.blocked", { complete: r.complete, total: r.total })}
          </p>
        ) : null}
        {!view.submissionEnabled ? (
          <p className="banner banner--info" role="note">
            <Icon name="clock" /> {t("gates.notEnabledBody")}
          </p>
        ) : null}
      </Section>

      <Section id="readiness" title={t("gates.readinessTitle")} intro={t("gates.readinessIntro")}>
        <p
          className={`banner ${r.ready ? "banner--success" : "banner--warning"}`}
          role="status"
          data-readiness={`${r.complete}/${r.total}`}
        >
          <Icon name={r.ready ? "check" : "alert"} /> {t("gates.readiness", { complete: r.complete, total: r.total })}
          {r.unverified > 0 ? <> · {t("gates.unverifiedCount", { n: r.unverified })}</> : null}
        </p>
        <CriteriaTable criteria={view.criteria} />
      </Section>

      <SubmissionHistory code={def.code} />

      {submitting ? (
        <SubmitDialog
          view={view}
          onClose={() => setSubmitting(false)}
          onDone={async () => {
            await refresh();
            setSubmitting(false);
          }}
        />
      ) : null}
      {deciding && current ? (
        <DecideDialog
          view={view}
          submissionNo={current.submissionNo}
          onClose={() => setDeciding(false)}
          onDone={async () => {
            await refresh();
            setDeciding(false);
          }}
          onStale={refresh}
        />
      ) : null}
      {configuring ? (
        <RecordDialog<GateView["gate"]>
          title={t("gates.configure.title", { code: def.code })}
          description={t("gates.configure.description")}
          fields={
            [
              {
                name: "approverRoleCode",
                kind: "select",
                label: t("gates.configure.role"),
                required: true,
                options: def.allowedApproverRoleCodes.map((c) => ({
                  value: c,
                  label: t(`transformations.audit.role.${c}`, { defaultValue: c }),
                })),
              },
              {
                name: "approverUserId",
                kind: "person",
                label: t("gates.configure.user"),
                hint: t("gates.configure.userHint"),
              },
            ] satisfies FieldSpec[]
          }
          record={view.gate}
          updateSchema={gateApproverConfig}
          updateUrl={() => `/api/v1/transformations/${ws.tid}/gates/${def.code}`}
          loadLatest={async () => (await api.get<GateView>(`/api/v1/transformations/${ws.tid}/gates/${def.code}`)).gate}
          people={people}
          submitLabel={t("common.action.save")}
          onSaved={async () => {
            await refresh();
            setConfiguring(false);
          }}
          onCancel={() => setConfiguring(false)}
        />
      ) : null}
    </>
  );
}

/** Live (or frozen) evaluation of the required outputs, each with completeness, what is missing and evidence state. */
function CriteriaTable({ criteria }: { criteria: readonly GateCriterionEvaluation[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const evidence = useRegister<Evidence>(ws.tid, "evidence");
  const resolve = useSubjectResolver();
  return (
    <div className="table-wrap">
      <table className="table criteria-table">
        <caption className="visually-hidden">{t("gates.readinessTitle")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("gates.criterion")}</th>
            <th scope="col">{t("gates.completenessLabel")}</th>
            <th scope="col">{t("gates.missing")}</th>
            <th scope="col">{t("gates.evidenceState")}</th>
          </tr>
        </thead>
        <tbody>
          {[...criteria]
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((c) => (
              <tr key={c.key} data-criterion={c.key} data-completeness={c.completeness}>
                <th scope="row">
                  {pick(locale, c.labelEn, c.labelAr)}
                  <span className="block small muted">
                    {c.mandatory ? t("gates.mandatory") : t("gates.optional")}
                    {c.requiresVerifiedEvidence ? ` · ${t("gates.needsVerified")}` : ""}
                  </span>
                </th>
                <td>
                  <CompletenessChip completeness={c.completeness} />
                </td>
                <td>
                  {c.missing.length === 0 ? (
                    <span className="muted">{t("common.value.none")}</span>
                  ) : (
                    <ul className="plain-list missing-list">
                      {c.missing.map((m, i) => {
                        const subject = resolve(m.pointer);
                        return (
                          <li key={`${m.code}-${i}`} data-missing={m.code}>
                            <Icon name="cross" />{" "}
                            {t(`gates.missingItems.${m.code.replace(/\./g, "__")}`, {
                              defaultValue: t("gates.missingItems.generic"),
                            })}
                            {subject ? (
                              <>
                                {" — "}
                                {subject.to ? (
                                  <Link className="link" to={subject.to}>
                                    {subject.label}
                                  </Link>
                                ) : (
                                  subject.label
                                )}
                              </>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </td>
                <td>
                  {c.unverifiedEvidenceIds.length === 0 ? (
                    c.requiresVerifiedEvidence ? (
                      <span className="small">
                        {c.completeness === "complete" ? t("gates.evidenceVerified") : t("gates.evidenceMissing")}
                      </span>
                    ) : (
                      <span className="muted small">{t("gates.evidenceNotRequired")}</span>
                    )
                  ) : (
                    <ul className="plain-list" data-unverified-evidence={c.unverifiedEvidenceIds.length}>
                      {c.unverifiedEvidenceIds.map((id) => {
                        const e = evidence.data?.find((x) => x.id === id);
                        return (
                          <li key={id}>
                            <EvidenceStateChip reviewStatus={e?.reviewStatus ?? "unverified"} />{" "}
                            <Link className="link" to={`/transformations/${ws.tid}/evidence#ev-${id}`}>
                              {e?.title ?? t("evidence.itemNotVisible")}
                            </Link>
                            <span className="block small muted">{t("gates.unverifiedNote")}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

/** Resolves a criterion pointer ("/outcomes/<id>", "/tomCanvas/<code>", "/charter/<field>") to a localized name. */
function useSubjectResolver() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const outcomes = useRegister<Outcome>(ws.tid, "outcomes");
  const kpis = useRegister<KpiDefinition>(ws.tid, "kpi-definitions");
  const gaps = useRegister<TomGap>(ws.tid, "tom-gaps");
  const decisions = useDecisions(ws.tid, "design");
  const base = `/transformations/${ws.tid}`;
  return (pointer: string | undefined): { label: string; to?: string } | null => {
    if (!pointer) return null;
    const [, kind = "", id = ""] = pointer.split("/");
    switch (kind) {
      case "diagnosticItems":
        return { label: diagnosticDimensionLabel(ws.methodology, id, locale) ?? id, to: `${base}/diagnose#t01` };
      case "outcomes":
        return {
          label: outcomes.data?.find((o) => o.id === id)?.statement ?? t("gates.subject.outcome"),
          to: `${base}/define#outcomes`,
        };
      case "kpiDefinitions":
        return {
          label: kpis.data?.find((k) => k.id === id)?.name ?? t("gates.subject.kpi"),
          to: `${base}/define#kpi-definitions`,
        };
      case "outcomeKpis":
        return { label: t("gates.subject.t02Row"), to: `${base}/define#t02` };
      case "tomCanvas":
        return { label: tomDimensionLabel(ws.methodology, id, locale) ?? id, to: `${base}/design#canvas` };
      case "tomGaps": {
        const g = gaps.data?.find((x) => x.id === id);
        return {
          label: g
            ? (tomDimensionLabel(ws.methodology, g.dimensionCode, locale) ?? g.dimensionCode)
            : t("gates.subject.t03Row"),
          to: `${base}/design#t03`,
        };
      }
      case "decisions": {
        const d: Decision | undefined = decisions.data?.find((x) => x.id === id);
        return { label: d ? `${d.code} ${d.title}` : t("gates.subject.decision"), to: `${base}/decisions` };
      }
      case "charter":
        return {
          label: id
            ? t(`define.charter.field.${id}`, { defaultValue: t("define.charter.title") })
            : t("define.charter.title"),
          to: `${base}/charter`,
        };
      default:
        return null;
    }
  };
}

function SubmitDialog({ view, onClose, onDone }: { view: GateView; onClose: () => void; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP2Refresh(ws.tid);
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<unknown>(null);
  /** FE12: the note's field-error code; translated at render time so a visible message follows a language switch. */
  const [fieldErrorCode, setFieldErrorCode] = useState<string | undefined>();
  const fieldError = fieldErrorCode === undefined ? undefined : fieldErrorMessage(t, fieldErrorCode);
  const [busy, setBusy] = useState(false);
  const r = readiness(view);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);
  const showNoteError = (code: string) => {
    setFieldErrorCode(code);
    focusInvalid();
  };

  const submit = async () => {
    // F-DG2-210: "" means "no note"; a note with no visible content is refused inline; visible text is sent verbatim.
    if (isBlankText(note)) {
      showNoteError(BLANK_CODE);
      return;
    }
    const body: Record<string, unknown> = {};
    if (note !== "") body["submissionNote"] = note;
    if (dueDate) body["dueDate"] = dueDate;
    const parsed = gateSubmissionCreate.safeParse(body);
    if (!parsed.success) {
      showNoteError(issueCode(parsed.error.issues[0]!));
      return;
    }
    setFieldErrorCode(undefined);
    setBusy(true);
    setError(null);
    try {
      await api.send(`/api/v1/transformations/${ws.tid}/gates/${view.definition.code}/submissions`, {
        method: "POST",
        body,
        ifMatch: view.gate.version,
      });
      await onDone();
    } catch (e) {
      if (isSessionChangedError(e)) return; // F-DG2-530: silent, the session state was already reset
      const onNote = e instanceof ApiError ? e.fieldErrors.find((fe) => fe.pointer === "/submissionNote") : undefined;
      if (onNote) showNoteError(onNote.code);
      else setError(e);
      // A conflict or a refused submission: reload the live readiness so the user sees the current state.
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("gates.submit.title", { code: view.definition.code })}
      onClose={onClose}
      dialogRef={dialogRef}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : t("gates.submit.confirm")}
          </button>
        </>
      }
    >
      <p>{t("gates.submit.description")}</p>
      {!r.ready ? (
        <p className="banner banner--warning" role="status">
          <Icon name="alert" /> {t("gates.submit.incompleteWarning", { complete: r.complete, total: r.total })}
        </p>
      ) : null}
      {error ? <GateProblem error={error} /> : null}
      <Field label={t("gates.submit.note")} error={fieldError}>
        {(control) => (
          <textarea {...control} rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
        )}
      </Field>
      <Field label={t("gates.submit.dueDate")} hint={t("gates.submit.dueDateHint")}>
        {(control) => <input {...control} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

/** The approver's decision: one of four outcomes with a mandatory rationale; the submission number is the current one. */
function DecideDialog({
  view,
  submissionNo,
  onClose,
  onDone,
  onStale,
}: {
  view: GateView;
  submissionNo: number;
  onClose: () => void;
  onDone: () => Promise<void>;
  onStale: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [outcome, setOutcome] = useState("");
  const [rationale, setRationale] = useState("");
  const [comments, setComments] = useState("");
  /** FE12: field-error codes; translated at render time so a visible message follows a language switch. */
  const [errorCodes, setErrors] = useState<Record<string, string>>({});
  const errors = fieldErrorMessages(t, errorCodes);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);
  const showErrors = (next: Record<string, string>) => {
    setErrors(next);
    if (Object.keys(next).length > 0) focusInvalid();
  };

  const submit = async () => {
    // F-DG2-210: the rationale and comments are sent verbatim. "" keeps its meaning (rationale required, no comments);
    // text with no visible content is refused inline before anything is sent.
    const next: Record<string, string> = {};
    if (isBlankText(rationale)) next["rationale"] = BLANK_CODE;
    if (isBlankText(comments)) next["comments"] = BLANK_CODE;
    const body: Record<string, unknown> = { submissionNo, outcome, rationale };
    if (comments !== "") body["comments"] = comments;
    const parsed = gateDecisionCreate.safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issueCode(issue);
    }
    if (Object.keys(next).length > 0) {
      showErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await api.send(`/api/v1/transformations/${ws.tid}/gates/${view.definition.code}/decision`, {
        method: "POST",
        body,
      });
      await onDone();
    } catch (e) {
      if (isSessionChangedError(e)) return; // F-DG2-530: silent, the session state was already reset
      const mapped: Record<string, string> = {};
      if (e instanceof ApiError) {
        for (const fe of e.fieldErrors) {
          const field = /^\/(outcome|rationale|comments)$/.exec(fe.pointer)?.[1];
          if (field) mapped[field] ??= fe.code;
        }
      }
      if (Object.keys(mapped).length > 0) showErrors(mapped);
      else setError(e);
      if (e instanceof ApiError && e.status === 409) await onStale();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("gates.decision.title", { code: view.definition.code, n: submissionNo })}
      onClose={onClose}
      dialogRef={dialogRef}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : t("gates.decision.confirm")}
          </button>
        </>
      }
    >
      <p>{t("gates.decision.description")}</p>
      {error ? <GateProblem error={error} /> : null}
      <fieldset className={`field field--group${errors["outcome"] ? " field--invalid" : ""}`}>
        <legend className="field__label">
          {t("gates.decision.outcome")} <span className="field__required">({t("common.form.required")})</span>
        </legend>
        {GATE_OUTCOMES.map((o) => (
          <label key={o} className="checkbox">
            <input
              type="radio"
              name="gate-outcome"
              value={o}
              checked={outcome === o}
              aria-invalid={errors["outcome"] ? true : undefined}
              onChange={() => setOutcome(o)}
            />
            {t(`gates.outcome.${o}`)}
          </label>
        ))}
        {errors["outcome"] ? (
          <p className="field__error">
            <Icon name="alert" /> {errors["outcome"]}
          </p>
        ) : null}
      </fieldset>
      <Field
        label={t("gates.decision.rationale")}
        hint={t("gates.decision.rationaleHint")}
        error={errors["rationale"]}
        required
      >
        {(control) => (
          <textarea
            {...control}
            rows={4}
            maxLength={8000}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        )}
      </Field>
      <Field label={t("gates.decision.comments")} error={errors["comments"]}>
        {(control) => (
          <textarea
            {...control}
            rows={3}
            maxLength={8000}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

/**
 * Gate problems in words: 403 not the approver / submitter cannot decide, 409 submission superseded or version
 * conflict, 422 incomplete mandatory criteria (each listed), anything else through the generic mapping.
 */
export function GateProblem({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const code = error instanceof ApiError ? error.code : null;
  const conflict = error instanceof ApiError && error.status === 409;
  const incomplete = error instanceof ApiError && code === "gate_criteria_incomplete";
  return (
    <div
      className="banner banner--error"
      role="alert"
      data-state={conflict ? "conflict" : "error"}
      data-problem={code ?? ""}
    >
      <p>
        <Icon name="alert" /> {errorMessage(t, error)}
      </p>
      {incomplete && error instanceof ApiError ? (
        <ul className="plain-list">
          {error.fieldErrors.map((fe, i) => (
            <li key={`${fe.pointer}-${i}`}>
              {t(`gates.missingItems.${fe.code.replace(/\./g, "__")}`, {
                defaultValue: t("gates.missingItems.generic"),
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {conflict ? <p className="small">{t("gates.reloaded")}</p> : null}
    </div>
  );
}

function SubmissionHistory({ code }: { code: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const subs = useGateSubmissions(ws.tid, code);
  const { byId } = usePeople(ws.tid);
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <Section id="submissions" title={t("gates.history.title")} intro={t("gates.history.intro")}>
      <QueryState query={subs} isEmpty={(l) => l.length === 0} empty={<EmptyState title={t("gates.history.empty")} />}>
        {(list) => (
          <>
            <div className="table-wrap">
              <table className="table table--compact">
                <caption className="visually-hidden">{t("gates.history.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("gates.history.no")}</th>
                    <th scope="col">{t("common.field.status")}</th>
                    <th scope="col">{t("gates.history.submitted")}</th>
                    <th scope="col">{t("gates.approver")}</th>
                    <th scope="col">{t("gates.submit.dueDate")}</th>
                    <th scope="col">{t("common.field.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...list]
                    .sort((a, b) => b.submissionNo - a.submissionNo)
                    .map((s) => (
                      <tr key={s.id} data-submission={s.submissionNo}>
                        <th scope="row">
                          <bdi dir="ltr">#{s.submissionNo}</bdi>
                        </th>
                        <td>{t(`gates.submissionStatus.${s.status}`)}</td>
                        <td>
                          {formatDateTime(s.submittedAt, locale, ws.tr.timezone)}
                          <span className="block small muted">
                            <PersonName id={s.submittedBy} people={byId} />
                          </span>
                        </td>
                        <td>
                          {t(`transformations.audit.role.${s.approverRoleCode}`, { defaultValue: s.approverRoleCode })}
                        </td>
                        <td>
                          {formatBusinessDate(s.dueDate, locale) ?? (
                            <span className="muted">{t("common.value.none")}</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button button--link button--small"
                            aria-expanded={selected === s.submissionNo}
                            onClick={() => setSelected(selected === s.submissionNo ? null : s.submissionNo)}
                          >
                            {t("gates.history.view")}
                            <span className="visually-hidden"> #{s.submissionNo}</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {selected !== null ? <SubmissionDetail code={code} no={selected} /> : null}
          </>
        )}
      </QueryState>
    </Section>
  );
}

function SubmissionDetail({ code, no }: { code: string; no: number }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const sub = useGateSubmission(ws.tid, code, no);
  const { byId } = usePeople(ws.tid);
  return (
    <section className="submission-detail" aria-labelledby="submission-detail-title" data-submission-detail={no}>
      <h3 id="submission-detail-title" className="card__subtitle">
        {t("gates.history.detailTitle", { n: no })}
      </h3>
      <QueryState query={sub}>
        {(v) => (
          <>
            {v.submission.submissionNote ? (
              <p>
                <strong>{t("gates.submit.note")}:</strong> {v.submission.submissionNote}
              </p>
            ) : null}
            <h4 className="small-heading">{t("gates.history.frozenCriteria")}</h4>
            <ul className="plain-list">
              {[...v.criteria]
                .sort((a, b) => a.ordinal - b.ordinal)
                .map((c) => {
                  const def = ws.methodology.gateDefinitions
                    .flatMap((g) => g.criteria)
                    .find((x) => x.key === c.criterionKey);
                  return (
                    <li key={c.id}>
                      <CompletenessChip completeness={c.completeness} />{" "}
                      {def ? pick(locale, def.labelEn, def.labelAr) : c.criterionKey}
                    </li>
                  );
                })}
            </ul>
            <h4 className="small-heading">{t("gates.history.decision")}</h4>
            {v.decision ? (
              <dl className="details" data-gate-decision={v.decision.outcome}>
                <div>
                  <dt>{t("gates.decision.outcome")}</dt>
                  <dd>{t(`gates.outcome.${v.decision.outcome}`)}</dd>
                </div>
                <div>
                  <dt>{t("gates.decision.rationale")}</dt>
                  <dd className="text-cell">{v.decision.rationale}</dd>
                </div>
                {v.decision.comments ? (
                  <div>
                    <dt>{t("gates.decision.comments")}</dt>
                    <dd className="text-cell">{v.decision.comments}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{t("gates.decision.decidedBy")}</dt>
                  <dd>
                    <PersonName id={v.decision.decidedBy} people={byId} /> ·{" "}
                    {formatDateTime(v.decision.decidedAt, locale, ws.tr.timezone)}
                    <span className="block small muted">{t(`gates.approverBasis.${v.decision.approverBasis}`)}</span>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="muted">{t("gates.history.noDecision")}</p>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
