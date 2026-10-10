// P4 parts of one product gate (T-DG4-FE-F; p4-work-split §H H.6; ADR-0035 §2-§5, §11; ADR-0038 amendment B1):
//  - gate exceptions per mandatory criterion: request (reason, scope, compensating action and owner, expiry), decide
//    (the gate's configured approver; never the requester), withdraw (the requester), revoke (with a reason). An
//    accepted exception COVERS its criterion only while today's business date <= its expiry; after that it is shown as
//    expired and the criterion is missing again (REQ-S04-013). Coverage is the server's `covering`, never computed here.
//  - the per-criterion review table of a frozen submission (the nine M0124 fields; a criterion never reviewed shows its
//    six review fields as "Not reviewed", never as "meets") and the Under Review state that the first review opens.
//  - the G5 approved scale scope (initiative x business unit, conditions with owner and due date) and its editor for a
//    G5 approval (REQ-S04-007).
//  - the exception lines and the Modular-links waiver frozen into a submission's snapshot (REQ-S04-012, REQ-PB-005).
// Every decision here is a business approval inside the product (G1-G6), never an engineering gate (DG0-DG7).
// SYNTHETIC data only in tests and demos.
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { GATE_CRITERION_RECOMMENDATIONS, gateScaleScope } from "@mth/shared/schemas";
import { api, ApiError } from "../../api/client.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { useP2Refresh, useBusinessUnits } from "../../api/queries.ts";
import { useInitiatives } from "../../api/portfolio.ts";
import type { GateView } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Dialog } from "../../components/Form.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { CompletenessChip, GateStatusChip } from "../../components/P2Badges.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { pick } from "../../lib/methodology.ts";
import { FormAlert, P4FormDialog, textOf, type P4FieldSpec } from "../my-work/p4ui.tsx";
import {
  gateP4Paths,
  modularLinksOf,
  snapshotExceptionsOf,
  useGateExceptions,
  useScaleScope,
  useSubmissionCriteria,
  type GateCriterionRow,
  type GateException,
} from "./p4api.ts";

/** The page namespace (its `problem.*` texts are read before `problems.*`). */
export const GATE_NS = ["gates"] as const;

/** Refreshes the live gate view (P2 keys) and every slice H key of the transformation after a mutation. */
export function useGateP4Refresh(tid: string): () => Promise<boolean> {
  const p2 = useP2Refresh(tid);
  const p4 = useP4Refresh(tid);
  return async () => {
    const [a, b] = await Promise.all([p2(), p4()]);
    return a && b;
  };
}

/** A criterion's label from the pinned methodology catalogue (Arabic where shown), else its key. */
export function useCriterionLabel(): (key: string) => string {
  const ws = useWorkspace();
  const locale = useLocale();
  return (key) => {
    const def = ws.methodology.gateDefinitions.flatMap((g) => g.criteria).find((c) => c.key === key);
    return def ? pick(locale, def.labelEn, def.labelAr) : key;
  };
}

// ------------------------------------------------------------------------------------------------ exception status

const EXCEPTION_ICON: Record<string, IconName> = {
  pending: "clock",
  accepted: "lock",
  rejected: "cross",
  withdrawn: "cross",
  revoked: "alert",
};

/** An exception's status with a text label and an icon; an accepted one also says whether it still covers. */
export function ExceptionStatus({ ex }: { ex: GateException }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const expired = ex.status === "accepted" && !ex.covering;
  return (
    <span className="block" data-exception-status={ex.status} data-covering={ex.covering ? "true" : "false"}>
      <span className="chip-row">
        <Icon name={EXCEPTION_ICON[ex.status] ?? "dot"} /> {t(`gates.exception.status.${ex.status}`)}
      </span>
      {ex.status === "accepted" ? (
        expired ? (
          <span className="status-chip status-chip--off-track status-chip--wrap" data-state="expired">
            <Icon name="alert" />{" "}
            <span>
              {t("gates.exception.expired", { date: formatBusinessDate(ex.expiresOn, locale) ?? ex.expiresOn })}
            </span>
          </span>
        ) : (
          <span className="block small" data-state="covering">
            {t("gates.exception.coversUntil", { date: formatBusinessDate(ex.expiresOn, locale) ?? ex.expiresOn })}
          </span>
        )
      ) : null}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ exceptions section

/** Gate exceptions of this gate (every status), with request, decide, withdraw and revoke where the caller may. */
export function GateExceptionsSection({ view }: { view: GateView }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const code = view.definition.code;
  const list = useGateExceptions(ws.tid, code);
  const { byId } = usePeople(ws.tid);
  const label = useCriterionLabel();
  const [dialog, setDialog] = useState<
    { kind: "request" } | { kind: "decide" | "withdraw" | "revoke"; ex: GateException } | null
  >(null);
  const canRequest = ws.can("gate_exception.request") && view.gate.status !== "approved";
  const canDecide = ws.can("gate_exception.decide");
  const mandatory = view.criteria.filter((c) => c.mandatory);
  return (
    <Section
      id="gate-exceptions"
      title={t("gates.exception.title")}
      intro={t("gates.exception.intro")}
      actions={
        canRequest && mandatory.length > 0 ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setDialog({ kind: "request" })}
            data-action="request-exception"
          >
            <Icon name="plus" /> {t("gates.exception.request")}
          </button>
        ) : null
      }
    >
      <QueryState
        query={list}
        isEmpty={(l) => l.length === 0}
        empty={<EmptyState title={t("gates.exception.empty")} />}
      >
        {(rows) => (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("gates.tableRegion.exceptions")}>
            <table className="table table--compact" data-gate-exceptions={code}>
              <caption className="visually-hidden">{t("gates.exception.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("gates.criterion")}</th>
                  <th scope="col">{t("common.field.status")}</th>
                  <th scope="col">{t("gates.exception.reason")}</th>
                  <th scope="col">{t("gates.exception.scope")}</th>
                  <th scope="col">{t("gates.exception.compensatingAction")}</th>
                  <th scope="col">{t("gates.exception.expiresOn")}</th>
                  <th scope="col">{t("gates.exception.approver")}</th>
                  <th scope="col">{t("common.field.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {[...rows]
                  .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
                  .map((ex) => {
                    const requester = ex.requestedBy === ws.meId;
                    return (
                      <tr key={ex.id} data-exception={ex.criterionKey} data-exception-id={ex.id}>
                        <th scope="row">
                          {label(ex.criterionKey)}
                          <span className="block small muted">
                            {t("gates.exception.requestedBy")}: <PersonName id={ex.requestedBy} people={byId} /> ·{" "}
                            {formatDateTime(ex.requestedAt, locale, ws.tr.timezone)}
                          </span>
                        </th>
                        <td>
                          <ExceptionStatus ex={ex} />
                        </td>
                        <td>
                          <TextCell value={ex.reason} />
                        </td>
                        <td>
                          <TextCell value={ex.scope} />
                        </td>
                        <td>
                          <TextCell value={ex.compensatingAction} />
                          <span className="block small muted">
                            {t("gates.exception.compensatingOwner")}:{" "}
                            <PersonName id={ex.compensatingOwnerUserId} people={byId} />
                          </span>
                        </td>
                        <td>
                          <bdi>{formatBusinessDate(ex.expiresOn, locale) ?? ex.expiresOn}</bdi>
                        </td>
                        <td>
                          {ex.decidedBy ? (
                            <span className="block">
                              <PersonName id={ex.decidedBy} people={byId} />
                              {ex.decidedOnBehalfOf ? (
                                <span className="block small muted">
                                  {t("gates.exception.onBehalfOf")}:{" "}
                                  <PersonName id={ex.decidedOnBehalfOf} people={byId} />
                                </span>
                              ) : null}
                              {ex.decisionNote ? <span className="block small">{ex.decisionNote}</span> : null}
                            </span>
                          ) : (
                            <span className="muted">{t("gates.exception.notDecided")}</span>
                          )}
                          {ex.revokeReason ? (
                            <span className="block small" data-revoke-reason="true">
                              {t("gates.exception.revokeReason")}: {ex.revokeReason}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <span className="section__actions">
                            {ex.status === "pending" && canDecide && !requester ? (
                              <button
                                type="button"
                                className="button button--link button--small"
                                data-action="decide-exception"
                                onClick={() => setDialog({ kind: "decide", ex })}
                              >
                                <Icon name="check" /> {t("gates.exception.decide")}
                                <span className="visually-hidden"> {label(ex.criterionKey)}</span>
                              </button>
                            ) : null}
                            {ex.status === "pending" && requester && ws.can("gate_exception.request") ? (
                              <button
                                type="button"
                                className="button button--link button--small"
                                data-action="withdraw-exception"
                                onClick={() => setDialog({ kind: "withdraw", ex })}
                              >
                                <Icon name="cross" /> {t("gates.exception.withdraw")}
                                <span className="visually-hidden"> {label(ex.criterionKey)}</span>
                              </button>
                            ) : null}
                            {ex.status === "accepted" && canDecide && !requester ? (
                              <button
                                type="button"
                                className="button button--link button--small"
                                data-action="revoke-exception"
                                onClick={() => setDialog({ kind: "revoke", ex })}
                              >
                                <Icon name="alert" /> {t("gates.exception.revoke")}
                                <span className="visually-hidden"> {label(ex.criterionKey)}</span>
                              </button>
                            ) : null}
                            {ex.status === "pending" && requester && canDecide ? (
                              <span className="small muted">{t("gates.exception.requesterCannotDecide")}</span>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
      {dialog?.kind === "request" ? <RequestExceptionDialog view={view} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "decide" ? <DecideExceptionDialog ex={dialog.ex} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "revoke" ? <RevokeExceptionDialog ex={dialog.ex} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "withdraw" ? (
        <ConfirmActionDialog
          title={t("gates.exception.withdrawTitle", { criterion: label(dialog.ex.criterionKey) })}
          body={t("gates.exception.withdrawBody")}
          confirmLabel={t("gates.exception.withdraw")}
          url={gateP4Paths.exceptionWithdraw(ws.tid, dialog.ex.id)}
          version={dialog.ex.version}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}

function RequestExceptionDialog({ view, onClose }: { view: GateView; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const refresh = useGateP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const fields: P4FieldSpec[] = [
    {
      name: "criterionKey",
      label: t("gates.criterion"),
      kind: "select",
      required: true,
      options: view.criteria
        .filter((c) => c.mandatory)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((c) => ({
          value: c.key,
          label: `${pick(locale, c.labelEn, c.labelAr)} (${t(`gates.completeness.${c.completeness}`)})`,
        })),
    },
    { name: "reason", label: t("gates.exception.reason"), kind: "textarea", required: true, min: 3, max: 4000 },
    {
      name: "scope",
      label: t("gates.exception.scope"),
      hint: t("gates.exception.scopeHint"),
      kind: "textarea",
      required: true,
      min: 3,
      max: 2000,
    },
    {
      name: "compensatingAction",
      label: t("gates.exception.compensatingAction"),
      kind: "textarea",
      required: true,
      min: 3,
      max: 4000,
    },
    {
      name: "compensatingOwnerUserId",
      label: t("gates.exception.compensatingOwner"),
      kind: "select",
      required: true,
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    {
      name: "expiresOn",
      label: t("gates.exception.expiresOn"),
      hint: t("gates.exception.expiresOnHint"),
      kind: "date",
      required: true,
    },
  ];
  return (
    <P4FormDialog
      title={t("gates.exception.requestTitle", { code: view.definition.code })}
      description={t("gates.exception.requestDescription")}
      fields={fields}
      submitLabel={t("gates.exception.requestSubmit")}
      url={gateP4Paths.exceptions(ws.tid)}
      namespaces={GATE_NS}
      toBody={(v) => ({
        gateCode: view.definition.code,
        criterionKey: v["criterionKey"],
        reason: v["reason"],
        scope: v["scope"],
        compensatingAction: v["compensatingAction"],
        compensatingOwnerUserId: v["compensatingOwnerUserId"],
        expiresOn: v["expiresOn"],
      })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function DecideExceptionDialog({ ex, onClose }: { ex: GateException; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useGateP4Refresh(ws.tid);
  const label = useCriterionLabel();
  return (
    <P4FormDialog
      title={t("gates.exception.decideTitle", { criterion: label(ex.criterionKey) })}
      description={t("gates.exception.decideDescription")}
      note={<BusinessApprovalLine />}
      fields={[
        {
          name: "outcome",
          label: t("gates.exception.outcome"),
          kind: "select",
          required: true,
          options: (["accepted", "rejected"] as const).map((o) => ({
            value: o,
            label: t(`gates.exception.outcomeValue.${o}`),
          })),
        },
        { name: "note", label: t("gates.exception.note"), kind: "textarea", required: true, min: 3, max: 2000 },
      ]}
      submitLabel={t("gates.exception.decideSubmit")}
      url={gateP4Paths.exceptionDecision(ws.tid, ex.id)}
      version={ex.version}
      namespaces={GATE_NS}
      toBody={(v) => ({ outcome: v["outcome"], note: v["note"] })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function RevokeExceptionDialog({ ex, onClose }: { ex: GateException; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useGateP4Refresh(ws.tid);
  const label = useCriterionLabel();
  return (
    <P4FormDialog
      title={t("gates.exception.revokeTitle", { criterion: label(ex.criterionKey) })}
      description={t("gates.exception.revokeDescription")}
      note={<BusinessApprovalLine />}
      danger
      fields={[
        {
          name: "reason",
          label: t("gates.exception.revokeReason"),
          kind: "textarea",
          required: true,
          min: 3,
          max: 1000,
        },
      ]}
      submitLabel={t("gates.exception.revoke")}
      url={gateP4Paths.exceptionRevoke(ws.tid, ex.id)}
      version={ex.version}
      namespaces={GATE_NS}
      toBody={(v) => ({ reason: v["reason"] })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function BusinessApprovalLine() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="business-approval">
      <Icon name="lock" /> <strong>{t("myWork.ui.businessApproval")}</strong>: {t("gates.exception.businessApproval")}
    </p>
  );
}

/**
 * A confirmation for a bodiless versioned action (withdraw): If-Match with the version the user saw, one alert with the
 * translated problem (409 reloads; 403 `approval.not_requester` etc. translated), session-bound.
 */
export function ConfirmActionDialog({
  title,
  body,
  confirmLabel,
  url,
  version,
  danger,
  namespaces = GATE_NS,
  onDone,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  url: string;
  version: number;
  danger?: boolean;
  namespaces?: readonly string[];
  onDone?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const gateRefresh = useGateP4Refresh(ws.tid);
  const refresh = onDone ?? gateRefresh;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setError(null);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(url, { method: "POST", ifMatch: version });
      if (action.stale()) return;
      if (!(await refresh())) return;
      onClose();
    } catch (e) {
      if (action.stale(e)) return;
      setError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button
            type="button"
            className={`button ${danger ? "button--danger" : "button--primary"}`}
            onClick={() => void confirm()}
            disabled={busy}
            data-action="submit"
          >
            {busy ? t("common.state.saving") : confirmLabel}
          </button>
        </>
      }
    >
      <p>{body}</p>
      <FormAlert error={error} namespaces={namespaces} />
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ review table

/** "Meets" / "Meets with conditions" / "Does not meet", or "Not reviewed" (never a default "meets"). */
function RecommendationText({ value }: { value: string | null }) {
  const { t } = useTranslation();
  if (!value)
    return (
      <span className="status-chip status-chip--unknown" data-recommendation="none">
        <Icon name="question" /> {t("gates.review.notReviewed")}
      </span>
    );
  const icon: IconName = value === "meets" ? "check" : value === "does_not_meet" ? "cross" : "alert";
  return (
    <span className="chip-row" data-recommendation={value}>
      <Icon name={icon} /> {t(`gates.review.recommendation.${value}`)}
    </span>
  );
}

/**
 * The per-criterion review table of one frozen submission (REQ-S04-009): criterion, required evidence, completeness
 * (with the covering exception), reviewer, finding, open condition, risk, decision (recommendation) and rationale.
 * A reviewer (gate.review; never the submitter) records a review while the submission is pending; the first review
 * moves the gate to Under Review (REQ-S04-010).
 */
export function CriteriaReviewTable({
  view,
  code,
  no,
  submittedBy,
  pending,
}: {
  view: GateView;
  code: string;
  no: number;
  submittedBy: string;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const rows = useSubmissionCriteria(ws.tid, code, no);
  const { byId } = usePeople(ws.tid);
  const [reviewing, setReviewing] = useState<GateCriterionRow | null>(null);
  const submitter = submittedBy === ws.meId;
  const canReview = ws.can("gate.review") && pending && !submitter;
  return (
    <section className="submission-detail" aria-labelledby={`review-table-${no}`} data-review-table={no}>
      <h4 id={`review-table-${no}`} className="small-heading">
        {t("gates.review.title")}
      </h4>
      <QueryState query={rows}>
        {(list) => (
          <>
            <p className="small" data-review-gate-status={list.gateStatus}>
              {t("common.field.status")}: <GateStatusChip status={list.gateStatus} />{" "}
              <span className="muted">
                · {t("gates.review.snapshot")}{" "}
                <bdi dir="ltr" className="code">
                  {(list.snapshotSha256 ?? "").slice(0, 12)}
                </bdi>
              </span>
            </p>
            {pending && submitter && ws.can("gate.review") ? (
              <p className="small muted">{t("gates.review.submitterCannot")}</p>
            ) : null}
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t("gates.tableRegion.review")}>
              <table className="table table--compact criteria-review-table">
                <caption className="visually-hidden">{t("gates.review.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("gates.criterion")}</th>
                    <th scope="col">{t("gates.review.requiredEvidence")}</th>
                    <th scope="col">{t("gates.completenessLabel")}</th>
                    <th scope="col">{t("gates.review.reviewer")}</th>
                    <th scope="col">{t("gates.review.finding")}</th>
                    <th scope="col">{t("gates.review.openCondition")}</th>
                    <th scope="col">{t("gates.review.risk")}</th>
                    <th scope="col">{t("gates.review.decision")}</th>
                    <th scope="col">{t("gates.review.rationale")}</th>
                    <th scope="col">{t("common.field.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(list.items ?? [])]
                    .sort((a, b) => a.ordinal - b.ordinal)
                    .map((r) => {
                      const none = <span className="muted">{t("gates.review.notReviewed")}</span>;
                      return (
                        <tr key={r.criterionKey} data-review-row={r.criterionKey} data-review-count={r.reviewCount}>
                          <th scope="row">
                            {pick(locale, r.criterionLabelEn, r.criterionLabelAr)}
                            <span className="block small muted">
                              {r.mandatory ? t("gates.mandatory") : t("gates.optional")}
                            </span>
                          </th>
                          <td className="text-cell small">
                            {pick(locale, r.requiredEvidenceEn, r.requiredEvidenceAr)}
                          </td>
                          <td>
                            <CompletenessChip completeness={r.completeness} />
                            {r.exception ? (
                              <span className="block small" data-covered-by-exception={r.exception.id}>
                                <Icon name="lock" /> {t("gates.review.coveredByException")}
                              </span>
                            ) : null}
                          </td>
                          <td>{r.reviewerUserId ? <PersonName id={r.reviewerUserId} people={byId} /> : none}</td>
                          <td>{r.finding ? <TextCell value={r.finding} /> : none}</td>
                          <td>
                            {r.openCondition ? (
                              <TextCell value={r.openCondition} />
                            ) : r.reviewerUserId ? (
                              <span className="muted">{t("common.value.none")}</span>
                            ) : (
                              none
                            )}
                          </td>
                          <td>
                            {r.risk?.note ? (
                              <TextCell value={r.risk.note} />
                            ) : r.reviewerUserId ? (
                              <span className="muted">{t("common.value.none")}</span>
                            ) : (
                              none
                            )}
                            {r.risk?.raidEntryId ? (
                              <Link className="link small block" to={`/transformations/${ws.tid}/raid`}>
                                {t("gates.review.riskLink")}
                              </Link>
                            ) : null}
                          </td>
                          <td>
                            <RecommendationText value={r.decision} />
                            {r.reviewCount > 1 ? (
                              <span className="block small muted">{t("gates.review.count", { n: r.reviewCount })}</span>
                            ) : null}
                          </td>
                          <td>{r.rationale ? <TextCell value={r.rationale} /> : none}</td>
                          <td>
                            {canReview ? (
                              <button
                                type="button"
                                className="button button--link button--small"
                                data-action="review-criterion"
                                onClick={() => setReviewing(r)}
                              >
                                <Icon name="pencil" /> {t("gates.review.action")}
                                <span className="visually-hidden">
                                  {" "}
                                  {pick(locale, r.criterionLabelEn, r.criterionLabelAr)}
                                </span>
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </QueryState>
      {reviewing ? (
        <ReviewDialog view={view} code={code} no={no} row={reviewing} onClose={() => setReviewing(null)} />
      ) : null}
    </section>
  );
}

function ReviewDialog({
  view,
  code,
  no,
  row,
  onClose,
}: {
  view: GateView;
  code: string;
  no: number;
  row: GateCriterionRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const refresh = useGateP4Refresh(ws.tid);
  return (
    <P4FormDialog
      title={t("gates.review.dialogTitle", { criterion: pick(locale, row.criterionLabelEn, row.criterionLabelAr) })}
      description={t("gates.review.dialogDescription")}
      fields={[
        { name: "finding", label: t("gates.review.finding"), kind: "textarea", required: true, max: 4000 },
        {
          name: "recommendation",
          label: t("gates.review.decision"),
          kind: "select",
          required: true,
          options: GATE_CRITERION_RECOMMENDATIONS.map((r) => ({
            value: r,
            label: t(`gates.review.recommendation.${r}`),
          })),
        },
        {
          name: "openCondition",
          label: t("gates.review.openCondition"),
          kind: "textarea",
          required: true,
          max: 2000,
          when: (v) => v["recommendation"] === "meets_with_conditions",
        },
        { name: "riskNote", label: t("gates.review.risk"), kind: "textarea", max: 2000 },
        { name: "rationale", label: t("gates.review.rationale"), kind: "textarea", required: true, min: 3, max: 4000 },
      ]}
      submitLabel={t("gates.review.submit")}
      url={`${gateP4Paths.reviews(ws.tid, code, no, row.criterionKey)}`}
      version={view.gate.version}
      namespaces={GATE_NS}
      toBody={(v) => {
        const body: Record<string, unknown> = {
          finding: v["finding"],
          recommendation: v["recommendation"],
          rationale: v["rationale"],
        };
        const cond = textOf(v["openCondition"]);
        if (v["recommendation"] === "meets_with_conditions" && cond) body["openCondition"] = cond;
        const risk = textOf(v["riskNote"]);
        if (risk) body["riskNote"] = risk;
        return body;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ frozen lines

/**
 * What a frozen submission recorded beyond its criteria: the exception lines (criterion, reason, scope, compensating
 * action and owner, expiry, approver) and, for a Modular G3, the missing-links items and the waiver it relied on.
 */
export function SubmissionFrozenLines({ snapshot }: { snapshot: Record<string, unknown> }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const { byId } = usePeople(ws.tid);
  const label = useCriterionLabel();
  const exceptions = snapshotExceptionsOf(snapshot);
  const modular = modularLinksOf(snapshot);
  return (
    <>
      {exceptions.length > 0 ? (
        <>
          <h4 className="small-heading">{t("gates.exception.frozenTitle")}</h4>
          <ul className="plain-list" data-frozen-exceptions={exceptions.length}>
            {exceptions.map((e) => (
              <li key={e.id || e.criterionKey} data-frozen-exception={e.criterionKey}>
                <Icon name="lock" /> <strong>{label(e.criterionKey)}</strong>
                <span className="block small">
                  {t("gates.exception.reason")}: {e.reason}
                </span>
                <span className="block small">
                  {t("gates.exception.scope")}: {e.scope}
                </span>
                <span className="block small">
                  {t("gates.exception.compensatingAction")}: {e.compensatingAction} ·{" "}
                  {t("gates.exception.compensatingOwner")}:{" "}
                  {e.compensatingOwnerUserId ? <PersonName id={e.compensatingOwnerUserId} people={byId} /> : "—"}
                </span>
                <span className="block small">
                  {t("gates.exception.expiresOn")}: <bdi>{formatBusinessDate(e.expiresOn, locale) ?? e.expiresOn}</bdi>{" "}
                  · {t("gates.exception.approver")}: {e.decidedBy ? <PersonName id={e.decidedBy} people={byId} /> : "—"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {modular ? (
        <div data-modular-links="true">
          <h4 className="small-heading">{t("gates.modularLinks.title")}</h4>
          <ul className="plain-list">
            {modular.missing.map((m) => (
              <li key={m} data-missing-link={m}>
                <Icon name="cross" /> {t(`problems.${m}`, { defaultValue: m })}
              </li>
            ))}
          </ul>
          {modular.waiver ? (
            <p className="small" data-modular-waiver={modular.waiver.dispensationId}>
              <Icon name="lock" /> {t("gates.modularLinks.waiverUsed")}{" "}
              <span className="block">
                {t("gates.exception.reason")}: {modular.waiver.reason}
              </span>
              <span className="block">
                {t("gates.exception.expiresOn")}:{" "}
                <bdi>{formatBusinessDate(modular.waiver.expiresOn, locale) ?? modular.waiver.expiresOn}</bdi> ·{" "}
                {t("gates.exception.approver")}:{" "}
                {modular.waiver.decidedBy ? <PersonName id={modular.waiver.decidedBy} people={byId} /> : "—"}
              </span>
              <Link className="link small" to={`/transformations/${ws.tid}/dispensations`}>
                {t("gates.inheritedApproval.viewDispensations")}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ G5 scale scope

/** The approved G5 scale scope: every item names one initiative and one business unit (never unrestricted). */
export function ScaleScopeSection() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const scope = useScaleScope(ws.tid);
  const initiatives = useInitiatives(ws.tid);
  const units = useBusinessUnits(ws.tr.organizationId);
  const { byId } = usePeople(ws.tid);
  const locale = useLocale();
  const iniName = (id: string) => {
    const i = (initiatives.data ?? []).find((x) => x.id === id);
    return i ? `${i.code} ${i.name}` : t("gates.scale.initiativeNotVisible");
  };
  const unitName = (id: string) =>
    ((u) =>
      u
        ? pick(locale, u.nameEn, u.nameAr)
        : id === ws.tr.businessUnitId
          ? t("gates.scale.ownUnit")
          : t("gates.scale.unitNotVisible"))((units.data ?? []).find((u) => u.id === id));
  return (
    <Section id="scale-scope" title={t("gates.scale.title")} intro={t("gates.scale.intro")}>
      <QueryState query={scope}>
        {(s) =>
          !s.approved ? (
            <p className="banner banner--info" role="note" data-scale-scope="none">
              <Icon name="clock" /> {t("gates.scale.notApproved")}
            </p>
          ) : (
            <>
              <ul className="plain-list" data-scale-scope={s.items.length}>
                {s.items.map((i) => (
                  <li key={i.id} data-scope-item={`${i.initiativeId}:${i.businessUnitId}`}>
                    <Icon name="check" /> <bdi>{iniName(i.initiativeId)}</bdi> · {unitName(i.businessUnitId)}
                    {i.note ? <span className="block small muted">{i.note}</span> : null}
                  </li>
                ))}
              </ul>
              {s.conditions.length > 0 ? (
                <>
                  <h3 className="small-heading">{t("gates.scale.conditions")}</h3>
                  <ol data-scale-conditions={s.conditions.length}>
                    {s.conditions.map((c) => (
                      <li key={c.id}>
                        {c.text}
                        <span className="block small muted">
                          <PersonName id={c.ownerUserId} people={byId} /> · {formatBusinessDate(c.dueDate, locale)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
            </>
          )
        }
      </QueryState>
    </Section>
  );
}

export interface ScaleScopeDraft {
  items: { initiativeId: string; businessUnitId: string; note: string }[];
  conditions: { text: string; ownerUserId: string; dueDate: string }[];
}

export const EMPTY_SCOPE: ScaleScopeDraft = {
  items: [{ initiativeId: "", businessUnitId: "", note: "" }],
  conditions: [],
};

/** The request member of a draft, or a translated-at-render error code when it is not a valid scope. */
export function scaleScopeBody(draft: ScaleScopeDraft): { ok: true; value: unknown } | { ok: false; code: string } {
  const items = draft.items.filter((i) => i.initiativeId || i.businessUnitId || i.note);
  if (items.length === 0 || items.some((i) => !i.initiativeId || !i.businessUnitId))
    return { ok: false, code: "gates.scale.itemIncomplete" };
  const conditions = draft.conditions.filter((c) => c.text || c.ownerUserId || c.dueDate);
  if (conditions.some((c) => !c.text.trim() || !c.ownerUserId || !c.dueDate))
    return { ok: false, code: "gates.scale.conditionIncomplete" };
  const value = {
    items: items.map((i) => ({
      initiativeId: i.initiativeId,
      businessUnitId: i.businessUnitId,
      ...(i.note.trim() ? { note: i.note } : {}),
    })),
    ...(conditions.length > 0 ? { conditions } : {}),
  };
  const parsed = gateScaleScope.safeParse(value);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "";
    return {
      ok: false,
      code: msg === "validation.duplicate_scope_item" ? "gates.scale.duplicate" : "gates.scale.invalid",
    };
  }
  return { ok: true, value };
}

/**
 * The scale-scope editor of a G5 approval (REQ-S04-007): one or more (initiative, business unit) items and optional
 * conditions with owner and due date. A scope is never unrestricted: every item names both.
 */
export function ScaleScopeEditor({
  draft,
  onChange,
  errorCode,
}: {
  draft: ScaleScopeDraft;
  onChange: (d: ScaleScopeDraft) => void;
  errorCode: string | null;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const initiatives = useInitiatives(ws.tid);
  const units = useBusinessUnits(ws.tr.organizationId);
  const { people } = usePeople(ws.tid);
  const locale = useLocale();
  // The organization's units where the caller may read them; the transformation's own unit is always offered (an
  // approver without business_unit.read still sees it), named when readable.
  const own = ws.tr.businessUnitId;
  const unitOptions = [
    ...(units.data ?? []).map((u) => ({ id: u.id, label: pick(locale, u.nameEn, u.nameAr) })),
    ...((units.data ?? []).some((u) => u.id === own) ? [] : [{ id: own, label: t("gates.scale.ownUnit") }]),
  ];
  const setItem = (n: number, k: keyof ScaleScopeDraft["items"][number], v: string) =>
    onChange({ ...draft, items: draft.items.map((i, j) => (j === n ? { ...i, [k]: v } : i)) });
  const setCond = (n: number, k: keyof ScaleScopeDraft["conditions"][number], v: string) =>
    onChange({ ...draft, conditions: draft.conditions.map((c, j) => (j === n ? { ...c, [k]: v } : c)) });
  return (
    <fieldset
      className={`field field--group${errorCode ? " field--invalid" : ""}`}
      data-scale-scope-editor="true"
      aria-describedby="scale-scope-hint"
    >
      <legend className="field__label">
        {t("gates.scale.editorLegend")} <span className="field__required">({t("common.form.required")})</span>
      </legend>
      <p id="scale-scope-hint" className="field__hint">
        {t("gates.scale.editorHint")}
      </p>
      {draft.items.map((item, n) => (
        <div key={`item-${n}`} className="scope-row" data-scope-row={n}>
          <label className="field">
            <span className="field__label">{t("gates.scale.initiative", { n: n + 1 })}</span>
            <select
              value={item.initiativeId}
              aria-invalid={errorCode && !item.initiativeId ? true : undefined}
              onChange={(e) => setItem(n, "initiativeId", e.target.value)}
              data-scope-initiative={n}
            >
              <option value="">{t("common.form.choose")}</option>
              {(initiatives.data ?? [])
                .filter((i) => i.status !== "cancelled")
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} {i.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{t("gates.scale.unit", { n: n + 1 })}</span>
            <select
              value={item.businessUnitId}
              aria-invalid={errorCode && !item.businessUnitId ? true : undefined}
              onChange={(e) => setItem(n, "businessUnitId", e.target.value)}
              data-scope-unit={n}
            >
              <option value="">{t("common.form.choose")}</option>
              {unitOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{t("gates.scale.note", { n: n + 1 })}</span>
            <input
              type="text"
              maxLength={1000}
              value={item.note}
              onChange={(e) => setItem(n, "note", e.target.value)}
            />
          </label>
          {draft.items.length > 1 ? (
            <button
              type="button"
              className="button button--link button--small"
              onClick={() => onChange({ ...draft, items: draft.items.filter((_, j) => j !== n) })}
            >
              <Icon name="cross" /> {t("gates.scale.removeItem", { n: n + 1 })}
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="button button--secondary button--small"
        onClick={() =>
          onChange({ ...draft, items: [...draft.items, { initiativeId: "", businessUnitId: "", note: "" }] })
        }
      >
        <Icon name="plus" /> {t("gates.scale.addItem")}
      </button>
      {draft.conditions.map((c, n) => (
        <div key={`cond-${n}`} className="scope-row" data-condition-row={n}>
          <label className="field">
            <span className="field__label">{t("gates.scale.conditionText", { n: n + 1 })}</span>
            <textarea rows={2} maxLength={2000} value={c.text} onChange={(e) => setCond(n, "text", e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">{t("gates.scale.conditionOwner", { n: n + 1 })}</span>
            <select value={c.ownerUserId} onChange={(e) => setCond(n, "ownerUserId", e.target.value)}>
              <option value="">{t("common.form.choose")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{t("gates.scale.conditionDue", { n: n + 1 })}</span>
            <input type="date" value={c.dueDate} onChange={(e) => setCond(n, "dueDate", e.target.value)} />
          </label>
          <button
            type="button"
            className="button button--link button--small"
            onClick={() => onChange({ ...draft, conditions: draft.conditions.filter((_, j) => j !== n) })}
          >
            <Icon name="cross" /> {t("gates.scale.removeCondition", { n: n + 1 })}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button--secondary button--small"
        onClick={() =>
          onChange({ ...draft, conditions: [...draft.conditions, { text: "", ownerUserId: "", dueDate: "" }] })
        }
      >
        <Icon name="plus" /> {t("gates.scale.addCondition")}
      </button>
      {errorCode ? (
        <p className="field__error" data-state="scale-scope-invalid">
          <Icon name="alert" /> {t(errorCode)}
        </p>
      ) : null}
    </fieldset>
  );
}

// ------------------------------------------------------------------------------------------------ G5/G6 refusals

/** The G5/G6 criterion key a 422 entry names ("/criteria/g5.risk_closure" -> "g5.risk_closure"), or null. */
export function p4RefusedCriterion(pointer: string | undefined): string | null {
  return /^\/criteria\/(g[56]\.[a-z_]+)$/.exec(pointer ?? "")?.[1] ?? null;
}

/**
 * The record a G5/G6 missing item names, read from its English message ("Risk closure: R-01 has High impact …" ->
 * "R-01"): only a code-like token right after the label, so no English sentence is ever shown. Null otherwise.
 */
export function p4ItemSubject(item: { code: string; message?: string | undefined }): string | null {
  if (!/^g[56]\./.test(item.code) || !item.message) return null;
  const at = item.message.indexOf(": ");
  if (at < 0) return null;
  const m = /^([A-Z]{1,4}-?[0-9]{2,6})\b/.exec(item.message.slice(at + 2));
  return m ? m[1]! : null;
}

/** The translated title of a G5/G6 criterion (from the catalogue), for a refusal line. */
export function P4RefusedCriterion({ criterionKey, t }: { criterionKey: string; t: TFunction }) {
  const label = useCriterionLabel();
  return (
    <li data-refused-criterion={criterionKey} data-missing={criterionKey}>
      <Icon name="cross" /> {label(criterionKey)}
      <span className="visually-hidden"> {t("gates.missing")}</span>
    </li>
  );
}
