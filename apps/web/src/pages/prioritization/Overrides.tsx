// Rank overrides (REQ-S09-005; ADR-0022 §5). Proposing needs a reason (3-2000 visible characters; missing -> required,
// invisible-only -> blank, nothing sent; the server's 400 /reason and 422 prioritization.override_reason_required are
// shown on the field). Approve / reject and revoke are business approvals inside the product, decided in person (no
// "on behalf of" control; ADR-0021 §6), never by the proposer (403 approval.approver_is_proposer).
import type { PrioritizationItem, RankingOverride } from "@mth/shared/schemas";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, newIdempotencyKey } from "../../api/client.ts";
import { useP3Refresh } from "../../api/queries.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Dialog, Field, isBlankText, useFocusFirstInvalid } from "../../components/Form.tsx";
import { ReasonDialog } from "../../components/ReasonDialog.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { prioritizationUrls, useOverrides } from "./api.ts";
import {
  BusinessApprovalTag,
  ConflictNotice,
  FormAlert,
  TableRegion,
  codeText,
  isVersionConflict,
  p3ErrorMessage,
  pointerError,
} from "./p3ui.tsx";

export function OverridesSection({ items }: { items: readonly PrioritizationItem[] }) {
  const { t } = useTranslation();
  const { tid, can, meId } = useWorkspace();
  const overrides = useOverrides(tid);
  const refresh = useP3Refresh(tid);
  const [proposing, setProposing] = useState(false);
  const [deciding, setDeciding] = useState<RankingOverride | null>(null);
  const [revoking, setRevoking] = useState<RankingOverride | null>(null);
  const [conflict, setConflict] = useState(false);
  const names = new Map(items.map((i) => [i.initiative.id, `${i.initiative.code} · ${i.initiative.name}`]));
  const canApprove = can("prioritization.approve");

  return (
    <Section
      id="overrides"
      title={t("prioritization.overrides.title")}
      intro={t("prioritization.overrides.intro")}
      actions={
        can("prioritization.edit") ? (
          <button type="button" className="button button--secondary" onClick={() => setProposing(true)}>
            {t("prioritization.overrides.propose")}
          </button>
        ) : null
      }
    >
      {conflict ? <ConflictNotice onDismiss={() => setConflict(false)} /> : null}
      <QueryState query={overrides}>
        {(list) =>
          list.length === 0 ? (
            <p className="muted">{t("prioritization.overrides.empty")}</p>
          ) : (
            <TableRegion label={t("prioritization.overrides.caption")}>
              <table className="table table--compact" data-testid="overrides">
                <caption>{t("prioritization.overrides.caption")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("prioritization.ranked.initiative")}</th>
                    <th scope="col">{t("prioritization.overrides.rank")}</th>
                    <th scope="col">{t("prioritization.overrides.reason")}</th>
                    <th scope="col">{t("prioritization.overrides.status")}</th>
                    <th scope="col">{t("prioritization.weights.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((o) => (
                    <tr key={o.id} data-override-status={o.status}>
                      <td>{names.get(o.initiativeId) ?? t("common.value.notVisible")}</td>
                      <td>{o.overrideRank}</td>
                      <td>{o.reason}</td>
                      <td>{t(`prioritization.overrides.state.${o.status}`)}</td>
                      <td>
                        {o.status === "proposed" && o.proposedBy === meId ? (
                          <span className="muted">{t("prioritization.overrides.ownProposal")}</span>
                        ) : canApprove && o.status === "proposed" ? (
                          <button
                            type="button"
                            className="button button--primary button--small"
                            onClick={() => setDeciding(o)}
                          >
                            {t("prioritization.overrides.decide")}
                          </button>
                        ) : null}
                        {canApprove && o.status === "approved" ? (
                          <button
                            type="button"
                            className="button button--secondary button--small"
                            onClick={() => setRevoking(o)}
                          >
                            {t("prioritization.overrides.revoke")}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
          )
        }
      </QueryState>
      {proposing ? (
        <ProposeOverrideDialog
          items={items}
          onClose={() => setProposing(false)}
          onDone={async () => {
            if (!(await refresh())) return;
            setProposing(false);
          }}
        />
      ) : null}
      {deciding ? (
        <DecideOverrideDialog
          override={deciding}
          label={names.get(deciding.initiativeId) ?? ""}
          onClose={() => setDeciding(null)}
          onConflict={async () => {
            setDeciding(null);
            setConflict(true);
            await refresh();
          }}
          onDone={async () => {
            if (!(await refresh())) return;
            setDeciding(null);
          }}
        />
      ) : null}
      {revoking ? (
        <ReasonDialog
          title={t("prioritization.overrides.revokeTitle")}
          description={t("prioritization.overrides.revokeBody")}
          confirmLabel={t("prioritization.overrides.revoke")}
          onClose={() => setRevoking(null)}
          onConfirm={async (reason) => {
            try {
              await api.send(prioritizationUrls.revokeOverride(tid, revoking.id), {
                method: "POST",
                body: { reason },
                ifMatch: revoking.version,
              });
            } catch (e) {
              if (isVersionConflict(e)) {
                setRevoking(null);
                setConflict(true);
                await refresh();
                return;
              }
              throw e;
            }
            if (!(await refresh())) return;
            setRevoking(null);
          }}
        />
      ) : null}
    </Section>
  );
}

function ProposeOverrideDialog({
  items,
  onClose,
  onDone,
}: {
  items: readonly PrioritizationItem[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const [initiativeId, setInitiativeId] = useState("");
  const [rank, setRank] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const [reasonServer, setReasonServer] = useState<string | undefined>();
  const ref = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(ref);

  const submit = async () => {
    setServerError(null);
    const errs: Record<string, string> = {};
    if (!initiativeId) errs["initiativeId"] = "validation.required";
    if (!/^[1-9][0-9]{0,8}$/.test(rank.trim()))
      errs["overrideRank"] = rank.trim() ? "prioritization.override_rank" : "validation.required";
    if (reason === "") errs["reason"] = "validation.required";
    else if (isBlankText(reason)) errs["reason"] = "validation.blank";
    else if ([...reason.trim()].length < 3) errs["reason"] = "validation.too_small";
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(prioritizationUrls.overrides(tid), {
        method: "POST",
        // The rank is a whole number checked above; JSON needs the integer (digits only, no float parsing).
        body: { initiativeId, overrideRank: Number.parseInt(rank.trim(), 10), reason },
        idempotencyKey: key,
      });
      if (action.stale()) return;
      await onDone();
    } catch (e) {
      if (action.stale(e)) return;
      const onReason = pointerError(t, e, "/reason");
      if (onReason) {
        setErrors({ reason: "server" });
        setServerError(null);
        setReasonServer(onReason);
        focusInvalid();
      } else setServerError(e);
    } finally {
      setBusy(false);
    }
  };
  const msg = (k: string) =>
    errors[k] === "server" ? reasonServer : errors[k] ? (codeText(t, errors[k]!) ?? undefined) : undefined;

  return (
    <Dialog
      title={t("prioritization.overrides.proposeTitle")}
      onClose={onClose}
      dialogRef={ref}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : t("prioritization.overrides.proposeConfirm")}
          </button>
        </>
      }
    >
      <p>{t("prioritization.overrides.proposeBody")}</p>
      <FormAlert message={serverError ? p3ErrorMessage(t, serverError) : null} />
      <Field label={t("prioritization.ranked.initiative")} error={msg("initiativeId")} required>
        {(control) => (
          <select {...control} value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)}>
            <option value="">{t("common.form.choose")}</option>
            {items.map((i) => (
              <option key={i.initiative.id} value={i.initiative.id}>
                {i.initiative.code} · {i.initiative.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t("prioritization.overrides.rank")} error={msg("overrideRank")} required>
        {(control) => (
          <input
            {...control}
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={rank}
            onChange={(e) => setRank(e.target.value)}
          />
        )}
      </Field>
      <Field
        label={t("prioritization.overrides.reason")}
        hint={t("prioritization.overrides.reasonHint")}
        error={msg("reason")}
        required
      >
        {(control) => (
          <textarea {...control} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
        )}
      </Field>
    </Dialog>
  );
}

function DecideOverrideDialog({
  override,
  label,
  onClose,
  onDone,
  onConflict,
}: {
  override: RankingOverride;
  label: string;
  onClose: () => void;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const [result, setResult] = useState<"approved" | "rejected" | "">("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(ref);

  const submit = async () => {
    setServerError(null);
    const errs: Record<string, string> = {};
    if (!result) errs["result"] = "validation.required";
    if (isBlankText(note)) errs["note"] = "validation.blank";
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(prioritizationUrls.decideOverride(tid, override.id), {
        method: "POST",
        body: note ? { result, note } : { result },
        ifMatch: override.version,
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
      title={t("prioritization.overrides.decideTitle")}
      onClose={onClose}
      dialogRef={ref}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : t("prioritization.overrides.decideConfirm")}
          </button>
        </>
      }
    >
      <p>
        <BusinessApprovalTag />
      </p>
      <p>{t("prioritization.overrides.decideBody", { initiative: label, rank: override.overrideRank })}</p>
      <p>
        <strong>{t("prioritization.overrides.reason")}:</strong> {override.reason}
      </p>
      <FormAlert message={serverError ? p3ErrorMessage(t, serverError) : null} />
      <fieldset className="fieldset" aria-invalid={errors["result"] ? true : undefined}>
        <legend>{t("prioritization.overrides.outcome")}</legend>
        {(["approved", "rejected"] as const).map((r) => (
          <label key={r} className="checkbox">
            <input
              type="radio"
              name="override-result"
              value={r}
              checked={result === r}
              aria-invalid={errors["result"] ? true : undefined}
              onChange={() => setResult(r)}
            />
            {t(`prioritization.overrides.result.${r}`)}
          </label>
        ))}
        {errors["result"] ? <p className="field__error">{codeText(t, errors["result"])}</p> : null}
      </fieldset>
      <Field
        label={t("prioritization.shared.noteOptional")}
        error={errors["note"] ? (codeText(t, errors["note"]) ?? undefined) : undefined}
      >
        {(control) => (
          <textarea {...control} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        )}
      </Field>
    </Dialog>
  );
}
