// Weight sets (REQ-PB-049, ADR-0022 §1): the active set, a proposal form with a LIVE 100% check (shared
// validateWeightSet / weightTotal, exact decimals: 95% and 105% are refused before anything is sent, and by the server
// with 422 prioritization.weights_total), the version history, and approve / withdraw. Approving is a business approval
// inside the product; the approver is never the proposer (the server answers 403 approval.approver_is_proposer).
import { CRITERION_CODES, validateWeightSet, weightTotal, type CriterionWeight } from "@mth/shared/calc";
import type { WeightSet } from "@mth/shared/schemas";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, newIdempotencyKey } from "../../api/client.ts";
import { useP3Refresh } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Dialog, Field, isBlankText, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { ReasonDialog } from "../../components/ReasonDialog.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { prioritizationUrls, useWeightSets } from "./api.ts";
import {
  BusinessApprovalTag,
  ConflictNotice,
  FormAlert,
  TableRegion,
  codeText,
  isVersionConflict,
  p3ErrorMessage,
  useDecimal,
} from "./p3ui.tsx";

type Row = { include: boolean; weight: string };
type Rows = Record<(typeof CRITERION_CODES)[number], Row>;

function rowsFrom(set: WeightSet | undefined): Rows {
  const out = {} as Rows;
  for (const c of CRITERION_CODES) {
    const w = set?.weights.find((x) => x.criterionCode === c);
    out[c] = { include: Boolean(w), weight: w ? w.weightPercent : "" };
  }
  return out;
}

/** The weights of the included rows, as typed (strings; never converted to numbers). */
function chosen(rows: Rows): CriterionWeight[] {
  return CRITERION_CODES.filter((c) => rows[c].include).map((c) => ({
    criterionCode: c,
    weightPercent: rows[c].weight.trim(),
  }));
}

export function WeightSetsSection() {
  const { t } = useTranslation();
  const { tid, can, meId } = useWorkspace();
  const sets = useWeightSets(tid);
  const refresh = useP3Refresh(tid);
  const locale = useLocale();
  const fmt = useDecimal();
  const [proposing, setProposing] = useState(false);
  const [approving, setApproving] = useState<WeightSet | null>(null);
  const [withdrawing, setWithdrawing] = useState<WeightSet | null>(null);
  const [conflict, setConflict] = useState(false);

  const canPropose = can("prioritization.edit");
  const canApprove = can("prioritization.approve");

  return (
    <Section
      id="weights"
      title={t("prioritization.weights.title")}
      intro={t("prioritization.weights.intro")}
      actions={
        canPropose ? (
          <button type="button" className="button button--secondary" onClick={() => setProposing(true)}>
            <Icon name="plus" /> {t("prioritization.weights.propose")}
          </button>
        ) : null
      }
    >
      {conflict ? <ConflictNotice onDismiss={() => setConflict(false)} /> : null}
      <QueryState query={sets}>
        {(items) => {
          const active = items.find((s) => s.status === "active");
          const ordered = [...items].sort((a, b) => b.versionNo - a.versionNo);
          return (
            <>
              {active ? (
                <p data-testid="active-weight-set">
                  <strong>{t("prioritization.weights.activeVersion", { n: active.versionNo })}</strong>{" "}
                  <span className="muted">
                    {active.approvalBasis === "source_default"
                      ? t("prioritization.weights.basis.source_default")
                      : t("prioritization.weights.basis.approved")}
                  </span>
                </p>
              ) : (
                <p className="banner banner--warning" role="status">
                  {t("prioritization.weights.noActive")}
                </p>
              )}
              <TableRegion label={t("prioritization.weights.historyCaption")}>
                <table className="table table--compact" data-testid="weight-set-history">
                  <caption>{t("prioritization.weights.historyCaption")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("prioritization.weights.version")}</th>
                      <th scope="col">{t("prioritization.weights.status")}</th>
                      <th scope="col">{t("prioritization.weights.weights")}</th>
                      <th scope="col">{t("prioritization.weights.rationale")}</th>
                      <th scope="col">{t("prioritization.weights.when")}</th>
                      <th scope="col">{t("prioritization.weights.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.map((s) => {
                      const own = s.createdBy === meId;
                      return (
                        <tr key={s.id} data-version={s.versionNo}>
                          <th scope="row">{t("prioritization.weights.versionN", { n: s.versionNo })}</th>
                          <td>
                            <span className="status-chip" data-status={s.status}>
                              {t(`prioritization.weights.state.${s.status}`)}
                            </span>
                          </td>
                          <td>
                            <ul className="plain-list">
                              {s.weights.map((w) => (
                                <li key={w.criterionCode}>
                                  {t(`prioritization.criterion.${w.criterionCode}`)}:{" "}
                                  <bdi>
                                    {t("prioritization.weights.percent", { value: fmt(w.weightPercent, 0, 2) })}
                                  </bdi>
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td>{s.rationale ?? <span className="muted">{t("common.value.none")}</span>}</td>
                          <td>{formatDateTime(s.activatedAt ?? s.createdAt, locale)}</td>
                          <td>
                            {s.status === "proposed" ? (
                              <div className="toolbar">
                                {own ? (
                                  <span className="muted" data-testid="own-proposal-note">
                                    {t("prioritization.weights.ownProposal")}
                                  </span>
                                ) : canApprove ? (
                                  <button
                                    type="button"
                                    className="button button--primary button--small"
                                    onClick={() => setApproving(s)}
                                  >
                                    {t("prioritization.weights.approve", { n: s.versionNo })}
                                  </button>
                                ) : null}
                                {canPropose || canApprove ? (
                                  <button
                                    type="button"
                                    className="button button--secondary button--small"
                                    onClick={() => setWithdrawing(s)}
                                  >
                                    {t("prioritization.weights.withdraw", { n: s.versionNo })}
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableRegion>
              {proposing ? (
                <ProposeWeightsDialog
                  initial={rowsFrom(active)}
                  onClose={() => setProposing(false)}
                  onDone={async (action) => {
                    if (!(await refresh())) return;
                    if (action.stale()) return;
                    setProposing(false);
                  }}
                />
              ) : null}
            </>
          );
        }}
      </QueryState>
      {approving ? (
        <ApproveWeightsDialog
          set={approving}
          onClose={() => setApproving(null)}
          onConflict={async () => {
            setApproving(null);
            setConflict(true);
            await refresh();
          }}
          onDone={async () => {
            if (!(await refresh())) return;
            setApproving(null);
          }}
        />
      ) : null}
      {withdrawing ? (
        <ReasonDialog
          title={t("prioritization.weights.withdrawTitle", { n: withdrawing.versionNo })}
          description={t("prioritization.weights.withdrawBody")}
          confirmLabel={t("prioritization.weights.withdraw", { n: withdrawing.versionNo })}
          onClose={() => setWithdrawing(null)}
          onConfirm={async (reason) => {
            try {
              await api.send(prioritizationUrls.withdrawWeightSet(tid, withdrawing.versionNo), {
                method: "POST",
                body: { reason },
                ifMatch: withdrawing.version,
              });
            } catch (e) {
              if (isVersionConflict(e)) {
                setWithdrawing(null);
                setConflict(true);
                await refresh();
                return;
              }
              throw e;
            }
            if (!(await refresh())) return;
            setWithdrawing(null);
          }}
        />
      ) : null}
    </Section>
  );
}

function ProposeWeightsDialog({
  initial,
  onClose,
  onDone,
}: {
  initial: Rows;
  onClose: () => void;
  onDone: (action: { stale(): boolean }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const fmt = useDecimal();
  const [rows, setRows] = useState<Rows>(initial);
  const [rationale, setRationale] = useState("");
  const [rationaleError, setRationaleError] = useState<string | undefined>();
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const ref = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(ref);
  const totalRef = useRef<HTMLDivElement>(null);

  const weights = chosen(rows);
  const validation = validateWeightSet(weights);
  let total: string | null = null;
  try {
    total = weights.every((w) => /^[0-9]{1,3}(\.[0-9]{1,2})?$/.test(w.weightPercent)) ? weightTotal(weights) : null;
  } catch {
    total = null;
  }
  const problems = validation.ok ? [] : validation.problems;
  const totalText =
    total === null ? t("common.value.unknown") : t("prioritization.weights.percent", { value: fmt(total, 2, 2) });
  const rowProblem = (i: number) => problems.find((p) => p.pointer.startsWith(`/weights/${i}/`));
  const setProblem = problems.find((p) => p.pointer === "/weights");
  const setProblemText = setProblem
    ? codeText(t, setProblem.code, { total: total === null ? t("common.value.unknown") : fmt(total, 2, 2) })
    : null;

  const submit = async () => {
    setAttempted(true);
    setServerError(null);
    let rationaleCode: string | undefined;
    if (rationale === "") rationaleCode = "validation.required";
    else if (isBlankText(rationale)) rationaleCode = "validation.blank";
    setRationaleError(rationaleCode ? (codeText(t, rationaleCode) ?? undefined) : undefined);
    if (problems.some((p) => p.pointer !== "/weights") || rationaleCode) {
      focusInvalid();
      return;
    }
    if (problems.length > 0) {
      // Only the set-level rule failed (e.g. the 100% total): focus the live total check.
      totalRef.current?.focus();
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(prioritizationUrls.weightSets(tid), {
        method: "POST",
        body: { weights, rationale },
        idempotencyKey: key,
      });
      if (action.stale()) return;
      await onDone(action);
    } catch (e) {
      if (action.stale(e)) return;
      setServerError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("prioritization.weights.proposeTitle")}
      onClose={onClose}
      dialogRef={ref}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : t("prioritization.weights.proposeSubmit")}
          </button>
        </>
      }
    >
      <p>{t("prioritization.weights.proposeIntro")}</p>
      <FormAlert
        message={
          serverError
            ? p3ErrorMessage(t, serverError, { total: total === null ? t("common.value.unknown") : fmt(total, 2, 2) })
            : null
        }
      />
      <fieldset className="fieldset" aria-describedby="weights-total">
        <legend>{t("prioritization.weights.criteriaLegend")}</legend>
        {CRITERION_CODES.map((c, idx) => {
          const i = weights.findIndex((w) => w.criterionCode === c);
          const p = i >= 0 ? rowProblem(i) : undefined;
          const err = attempted && p ? (codeText(t, p.code) ?? undefined) : undefined;
          return (
            <div key={c} className="grid grid--2" data-criterion={c}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={rows[c].include}
                  onChange={(e) => setRows({ ...rows, [c]: { ...rows[c], include: e.target.checked } })}
                />
                {t("prioritization.weights.include", { criterion: t(`prioritization.criterion.${c}`) })}
              </label>
              {rows[c].include ? (
                <Field
                  label={t("prioritization.weights.weightFor", { criterion: t(`prioritization.criterion.${c}`) })}
                  error={err}
                >
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={rows[c].weight}
                      onChange={(e) => setRows({ ...rows, [c]: { ...rows[c], weight: e.target.value } })}
                      data-index={idx}
                    />
                  )}
                </Field>
              ) : null}
            </div>
          );
        })}
      </fieldset>
      <div
        id="weights-total"
        ref={totalRef}
        tabIndex={-1}
        className={`banner ${setProblem ? "banner--warning" : "banner--info"}`}
        aria-live="polite"
        data-testid="weights-total"
        data-valid={problems.length === 0 ? "true" : "false"}
      >
        <span>
          <Icon name={problems.length === 0 ? "check" : "alert"} />{" "}
          {t("prioritization.weights.total", { total: totalText })}
        </span>
        {setProblemText ? <span> {setProblemText}</span> : null}
        {problems.length === 0 ? <span> {t("prioritization.weights.totalOk")}</span> : null}
      </div>
      <Field
        label={t("prioritization.weights.rationale")}
        hint={t("prioritization.weights.rationaleHint")}
        error={rationaleError}
        required
      >
        {(control) => (
          <textarea
            {...control}
            rows={3}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            maxLength={4000}
          />
        )}
      </Field>
    </Dialog>
  );
}

function ApproveWeightsDialog({
  set,
  onClose,
  onDone,
  onConflict,
}: {
  set: WeightSet;
  onClose: () => void;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const fmt = useDecimal();
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(ref);

  const confirm = async () => {
    setServerError(null);
    if (isBlankText(note)) {
      setNoteError(codeText(t, "validation.blank") ?? undefined);
      focusInvalid();
      return;
    }
    setNoteError(undefined);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(prioritizationUrls.approveWeightSet(tid, set.versionNo), {
        method: "POST",
        body: note ? { note } : {},
        ifMatch: set.version,
      });
      if (action.stale()) return;
      await onDone();
    } catch (e) {
      if (action.stale(e)) return;
      if (isVersionConflict(e)) {
        await onConflict();
        return;
      }
      setServerError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("prioritization.weights.approveTitle", { n: set.versionNo })}
      onClose={onClose}
      dialogRef={ref}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void confirm()} disabled={busy}>
            {busy ? t("common.state.saving") : t("prioritization.weights.approveConfirm")}
          </button>
        </>
      }
    >
      <p>
        <BusinessApprovalTag />
      </p>
      <p>{t("prioritization.weights.approveBody")}</p>
      <ul>
        {set.weights.map((w) => (
          <li key={w.criterionCode}>
            {t(`prioritization.criterion.${w.criterionCode}`)}:{" "}
            <bdi>{t("prioritization.weights.percent", { value: fmt(w.weightPercent, 0, 2) })}</bdi>
          </li>
        ))}
      </ul>
      <FormAlert message={serverError ? p3ErrorMessage(t, serverError) : null} />
      <Field label={t("prioritization.shared.noteOptional")} error={noteError}>
        {(control) => (
          <textarea {...control} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        )}
      </Field>
    </Dialog>
  );
}
