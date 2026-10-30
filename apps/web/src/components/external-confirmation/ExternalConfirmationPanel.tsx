// The deliverable's external-change confirmation (T-DG6-FE-C; p6-work-split §B/A.9; ADR-0055 §6; REQ-S01-005).
//
// Shown NEXT TO the DG3 acceptance of a deliverable, never instead of it. A deliverable flagged as an external change
// (customer system, network upgrade, procurement transaction, other) carries a separate confirmation state:
//  - "Unconfirmed" until reviewed (verified) evidence or a confirmed connector result sets it. Completing a task or the
//    DG3 acceptance never sets it, and Unconfirmed is never shown green.
//  - "Confirmed by reviewed evidence" with the evidence and who confirmed it, or "Confirmed by connector result" with
//    the connector, the source system id, the source reference and the time. A confirmation never changes.
// external_change.flag (TL, BO, WL, TO) flags, changes or withdraws an unconfirmed flag (If-Match "0" creates it);
// external_change.confirm (BO, TD) confirms with reviewed evidence of the same transformation. A filename-only link
// never confirms (the server refuses with external_change.evidence_not_verified). AUD and other readers see the state
// only. One form-level alert per form; every write belongs to the session its click started under.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { api, apiRequest, ApiError } from "../../api/client.ts";
import { shouldRetry } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { formatDateTime } from "../../lib/format.ts";
import { errorMessage } from "../../lib/problem.ts";
import { useEvidenceRegister } from "../../pages/reports/api.ts";
import { Field } from "../Form.tsx";
import { Icon } from "../Icon.tsx";
import "../../pages/integrations/integrations.css";

export type ExternalChangeType = "customer_system" | "network_upgrade" | "procurement_transaction" | "other";
export const EXTERNAL_CHANGE_TYPES: readonly ExternalChangeType[] = [
  "customer_system",
  "network_upgrade",
  "procurement_transaction",
  "other",
];

export interface ExternalChange {
  readonly id: string;
  readonly isExternalChange: boolean;
  readonly changeType: ExternalChangeType;
  readonly description: string | null;
  readonly confirmationStatus: "unconfirmed" | "confirmed";
  readonly confirmationSource: "reviewed_evidence" | "connector_result" | null;
  readonly evidenceId: string | null;
  readonly outboundWriteId: string | null;
  readonly connectorId: string | null;
  readonly sourceSystemId: string | null;
  readonly sourceReference: string | null;
  readonly sourceConfirmedAt: string | null;
  readonly serviceIdentityId: string | null;
  readonly confirmedAt: string | null;
  readonly confirmedBy: string | null;
  readonly confirmationNote: string | null;
  readonly version: number;
}

export interface DeliverableConfirmation {
  readonly deliverableId: string;
  readonly transformationId: string;
  readonly externalChange: ExternalChange | null;
}

export const confirmationPaths = {
  confirmation: (deliverableId: string) => `/api/v1/deliverables/${encodeURIComponent(deliverableId)}/confirmation`, // getDeliverableConfirmation, confirmDeliverableExternalChange
  externalChange: (deliverableId: string) =>
    `/api/v1/deliverables/${encodeURIComponent(deliverableId)}/external-change`, // putDeliverableExternalChange
};

export const confirmationKeys = {
  all: ["p6", "external-change"] as const,
  one: (deliverableId: string) => ["p6", "external-change", deliverableId] as const,
};

export function useDeliverableConfirmation(deliverableId: string) {
  return useQuery({
    queryKey: confirmationKeys.one(deliverableId),
    queryFn: () => api.get<DeliverableConfirmation>(confirmationPaths.confirmation(deliverableId)),
    enabled: Boolean(deliverableId),
    retry: shouldRetry,
  });
}

/** The state shown: never flagged or withdrawn; unconfirmed; or confirmed by one of the two sources. */
export type ConfirmationDisplay = "not_flagged" | "unconfirmed" | "reviewed_evidence" | "connector_result";

export function confirmationDisplay(x: ExternalChange | null): ConfirmationDisplay {
  if (!x || !x.isExternalChange) return "not_flagged";
  if (x.confirmationStatus !== "confirmed") return "unconfirmed";
  return x.confirmationSource === "connector_result" ? "connector_result" : "reviewed_evidence";
}

function StateChip({ state }: { state: ConfirmationDisplay }) {
  const { t } = useTranslation();
  const [css, icon] =
    state === "reviewed_evidence" || state === "connector_result"
      ? (["status-chip status-chip--on-track", "check"] as const)
      : state === "unconfirmed"
        ? (["status-chip status-chip--at-risk", "question"] as const)
        : (["status-chip status-chip--unknown", "dot"] as const);
  return (
    <span className={css} data-external-change={state}>
      <Icon name={icon} /> {t(`externalChange.state.${state}`)}
    </span>
  );
}

/**
 * The panel of one deliverable. `tid` is the deliverable's transformation (the evidence picker reads its verified
 * evidence); `readOnly` hides every write control (e.g. an archived initiative), on top of the permission hints.
 */
export function ExternalConfirmationPanel({
  tid,
  deliverableId,
  deliverableTitle,
  readOnly = false,
}: {
  tid: string;
  deliverableId: string;
  deliverableTitle: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const q = useDeliverableConfirmation(deliverableId);
  const [open, setOpen] = useState<"flag" | "confirm" | "withdraw" | null>(null);
  const panelId = useId();
  if (q.isPending) return <span className="small muted">{t("externalChange.loading")}</span>;
  if (q.isError)
    return (
      <span className="small muted" data-external-change="unavailable">
        {t("externalChange.unavailable")}
      </span>
    );
  const x = q.data.externalChange;
  const state = confirmationDisplay(x);
  const canFlag =
    !readOnly &&
    canAnywhere(me, "external_change.flag") &&
    state !== "reviewed_evidence" &&
    state !== "connector_result";
  const canConfirm = !readOnly && canAnywhere(me, "external_change.confirm") && state === "unconfirmed";
  return (
    <div className="external-confirmation" data-external-confirmation={deliverableId}>
      <span className="small">{t("externalChange.label")}: </span>
      <StateChip state={state} />
      {x && x.isExternalChange ? (
        <span className="small muted"> · {t(`externalChange.type.${x.changeType}`)}</span>
      ) : null}
      {state === "reviewed_evidence" && x ? (
        <span className="small muted" data-provenance="reviewed_evidence">
          {" · "}
          <Link className="link" to={`/transformations/${tid}/evidence-register`}>
            {t("externalChange.provenance.evidence")}
          </Link>
          {x.confirmedAt ? ` · ${formatDateTime(x.confirmedAt, locale)}` : ""}
        </span>
      ) : null}
      {state === "connector_result" && x ? (
        <span className="small muted" data-provenance="connector_result">
          {" · "}
          {t("externalChange.provenance.connector", {
            source: x.sourceSystemId ?? "",
            reference: x.sourceReference ?? "",
          })}
          {x.sourceConfirmedAt ? ` · ${formatDateTime(x.sourceConfirmedAt, locale)}` : ""}
        </span>
      ) : null}
      {state === "unconfirmed" ? <span className="visually-hidden">{t("externalChange.unconfirmedHint")}</span> : null}
      {canFlag || canConfirm ? (
        <span className="toolbar">
          {canFlag ? (
            <button
              type="button"
              className="button button--secondary button--small"
              aria-expanded={open === "flag"}
              aria-controls={panelId}
              onClick={() => setOpen(open === "flag" ? null : "flag")}
            >
              {state === "not_flagged" ? t("externalChange.flag") : t("externalChange.change")}
              <span className="visually-hidden">: {deliverableTitle}</span>
            </button>
          ) : null}
          {canFlag && state === "unconfirmed" ? (
            <button
              type="button"
              className="button button--secondary button--small"
              aria-expanded={open === "withdraw"}
              aria-controls={panelId}
              onClick={() => setOpen(open === "withdraw" ? null : "withdraw")}
            >
              {t("externalChange.withdraw")}
              <span className="visually-hidden">: {deliverableTitle}</span>
            </button>
          ) : null}
          {canConfirm ? (
            <button
              type="button"
              className="button button--primary button--small"
              aria-expanded={open === "confirm"}
              aria-controls={panelId}
              onClick={() => setOpen(open === "confirm" ? null : "confirm")}
            >
              {t("externalChange.confirm")}
              <span className="visually-hidden">: {deliverableTitle}</span>
            </button>
          ) : null}
        </span>
      ) : null}
      <div id={panelId}>
        {open === "flag" || open === "withdraw" ? (
          <FlagForm
            deliverableId={deliverableId}
            current={x}
            withdraw={open === "withdraw"}
            onDone={() => setOpen(null)}
          />
        ) : null}
        {open === "confirm" && x ? (
          <ConfirmForm tid={tid} deliverableId={deliverableId} current={x} onDone={() => setOpen(null)} />
        ) : null}
      </div>
    </div>
  );
}

function FlagForm({
  deliverableId,
  current,
  withdraw,
  onDone,
}: {
  deliverableId: string;
  current: ExternalChange | null;
  withdraw: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [changeType, setChangeType] = useState<ExternalChangeType>(current?.changeType ?? "customer_system");
  const [description, setDescription] = useState(current?.description ?? "");
  const [descriptionError, setDescriptionError] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const d = description.trim();
    if (!withdraw && changeType === "other" && d === "") {
      setDescriptionError(true);
      return;
    }
    setDescriptionError(false);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await apiRequest<DeliverableConfirmation>(confirmationPaths.externalChange(deliverableId), {
        method: "PUT",
        body: {
          isExternalChange: !withdraw,
          changeType: withdraw ? (current?.changeType ?? changeType) : changeType,
          description: withdraw ? (current?.description ?? null) : d === "" ? null : description,
        },
        ifMatch: current?.version ?? 0,
      });
      if (action.stale()) return;
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: confirmationKeys.one(deliverableId) });
      onDone();
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      setFormError(err);
      if (err instanceof ApiError && err.status === 409)
        await queryClient.invalidateQueries({ queryKey: confirmationKeys.one(deliverableId) });
    }
  };
  return (
    <form
      className="stack external-confirmation__form"
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-busy={busy}
      data-flag-form
    >
      {formError ? (
        <p className="banner banner--error" role="alert">
          <Icon name="alert" /> <span>{errorMessage(t, formError)}</span>
        </p>
      ) : null}
      {withdraw ? (
        <p>{t("externalChange.withdrawBody")}</p>
      ) : (
        <>
          <p className="small muted">{t("externalChange.flagIntro")}</p>
          <Field label={t("externalChange.field.type")} required>
            {(c) => (
              <select {...c} value={changeType} onChange={(e) => setChangeType(e.target.value as ExternalChangeType)}>
                {EXTERNAL_CHANGE_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {t(`externalChange.type.${k}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label={t("externalChange.field.description")}
            hint={t("externalChange.field.descriptionHint")}
            error={descriptionError ? t("externalChange.field.descriptionRequired") : undefined}
            required={changeType === "other"}
          >
            {(c) => (
              <textarea
                {...c}
                rows={2}
                value={description}
                maxLength={2000}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
        </>
      )}
      <div className="toolbar">
        <button
          type="submit"
          className={`button button--small ${withdraw ? "button--danger" : "button--primary"}`}
          disabled={busy}
        >
          {busy ? t("externalChange.saving") : withdraw ? t("externalChange.withdraw") : t("externalChange.save")}
        </button>
        <button type="button" className="button button--secondary button--small" disabled={busy} onClick={onDone}>
          {t("externalChange.cancel")}
        </button>
      </div>
    </form>
  );
}

function ConfirmForm({
  tid,
  deliverableId,
  current,
  onDone,
}: {
  tid: string;
  deliverableId: string;
  current: ExternalChange;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const evidence = useEvidenceRegister(tid, { reviewStatus: "verified" });
  const [evidenceId, setEvidenceId] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ evidence?: boolean; note?: boolean }>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const items = (evidence.data ?? []).filter((e) => e.reviewStatus === "verified");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const n = note.trim();
    const errs = { evidence: evidenceId === "", note: n !== "" && n.length < 3 };
    setErrors(errs);
    if (errs.evidence || errs.note) return;
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await apiRequest<DeliverableConfirmation>(confirmationPaths.confirmation(deliverableId), {
        method: "POST",
        body: { evidenceId, note: n === "" ? null : note },
        ifMatch: current.version,
      });
      if (action.stale()) return;
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: confirmationKeys.one(deliverableId) });
      onDone();
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      setFormError(err);
      if (err instanceof ApiError && err.status === 409)
        await queryClient.invalidateQueries({ queryKey: confirmationKeys.one(deliverableId) });
    }
  };
  return (
    <form
      className="stack external-confirmation__form"
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-busy={busy}
      data-confirm-form
    >
      {formError ? (
        <p className="banner banner--error" role="alert">
          <Icon name="alert" /> <span>{errorMessage(t, formError)}</span>
        </p>
      ) : null}
      <p className="small muted">{t("externalChange.confirmIntro")}</p>
      <Field
        label={t("externalChange.field.evidence")}
        error={errors.evidence ? t("externalChange.field.evidenceRequired") : undefined}
        required
      >
        {(c) => (
          <select {...c} value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)}>
            <option value="">{evidence.isPending ? t("externalChange.loading") : t("common.form.choose")}</option>
            {items.map((ev) => (
              <option key={ev.evidenceId} value={ev.evidenceId}>
                {ev.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      {!evidence.isPending && items.length === 0 ? (
        <p className="small muted">{t("externalChange.noVerifiedEvidence")}</p>
      ) : null}
      <Field
        label={t("externalChange.field.note")}
        error={errors.note ? t("externalChange.field.noteTooShort") : undefined}
      >
        {(c) => <textarea {...c} rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className="toolbar">
        <button type="submit" className="button button--primary button--small" disabled={busy}>
          {busy ? t("externalChange.saving") : t("externalChange.confirmSubmit")}
        </button>
        <button type="button" className="button button--secondary button--small" disabled={busy} onClick={onDone}>
          {t("externalChange.cancel")}
        </button>
      </div>
    </form>
  );
}
