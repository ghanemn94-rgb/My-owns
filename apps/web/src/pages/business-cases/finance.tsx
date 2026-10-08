// Finance validation (REQ-PB-055, ADR-0024 §5): a BUSINESS APPROVAL recorded by a person holding finance.validate
// (FIN) who did not author the record. The UI offers it only to such a person and never decides anything itself;
// the server re-checks permission and separation of duties (403 finance.validator_is_author) and If-Match (409).
// States are shown with an icon and a text label, never by colour alone: Validated, Rejected, Stale (the baseline
// changed after it was validated: no longer counts, never green) and Not validated.
import { financeValidationRequest } from "@mth/shared/schemas";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../api/client.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { BLANK_CODE, Dialog, Field, isBlankText, REQUIRED_CODE, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { caseFieldMessage, FormAlert } from "./formKit.tsx";

export type FinanceState = "unvalidated" | "validated" | "rejected" | "stale";

const STATE: Record<FinanceState, { css: string; icon: IconName }> = {
  validated: { css: "on-track", icon: "check" },
  rejected: { css: "off-track", icon: "cross" },
  stale: { css: "stale", icon: "clock" },
  unvalidated: { css: "unknown", icon: "question" },
};

/** The Finance validation state of a baseline or a formula version: icon + text, never colour alone. */
export function FinanceStateChip({ state }: { state: FinanceState }) {
  const { t } = useTranslation();
  const m = STATE[state];
  return (
    <span className={`status-chip status-chip--${m.css}`} data-finance-validation={state}>
      <Icon name={m.icon} /> {t(`businessCases.finance.state.${state}`)}
    </span>
  );
}

/**
 * "Record Finance validation (business approval)": validated or rejected, with a required note. POST `url` with
 * `{result, note}` and If-Match `version`. `onDone` refreshes (and resolves false when the session changed).
 */
export function FinanceValidationDialog({
  title,
  description,
  url,
  version,
  onDone,
  onClose,
}: {
  title: string;
  description: string;
  url: string;
  version: number;
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [result, setResult] = useState<"" | "validated" | "rejected">("");
  const [note, setNote] = useState("");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!result) next["result"] = REQUIRED_CODE;
    if (isBlankText(note)) next["note"] = BLANK_CODE;
    else if (note === "") next["note"] = REQUIRED_CODE;
    else if (!financeValidationRequest.safeParse({ result: result || "validated", note }).success)
      next["note"] = "validation.too_big";
    setCodes(next);
    setServerError(null);
    if (Object.keys(next).length > 0) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard(); // F-DG2-530: every effect below belongs to this session generation
    setBusy(true);
    try {
      await api.send(url, { method: "POST", body: { result, note }, ifMatch: version });
      if (!(await onDone())) return;
      if (action.stale()) return;
      onClose();
    } catch (e) {
      if (action.stale(e)) return; // silent: the session state was already reset
      const onNote = e instanceof ApiError ? e.fieldErrors.find((fe) => fe.pointer === "/note") : undefined;
      if (onNote) {
        setCodes({ note: onNote.code });
        focusInvalid();
      } else setServerError(e);
      // A 409 means the record changed meanwhile: reload so a new attempt uses the current version.
      if (e instanceof ApiError && e.status === 409) await onDone();
    } finally {
      if (!action.stale()) setBusy(false);
    }
  };

  const resultError = codes["result"] ? caseFieldMessage(t, codes["result"]) : undefined;
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
            {busy ? t("common.state.saving") : t("businessCases.finance.confirm")}
          </button>
        </>
      }
    >
      <p className="banner banner--info" role="note">
        <Icon name="info" /> {t("businessCases.finance.approvalNote")}
      </p>
      <p>{description}</p>
      <FormAlert error={serverError} />
      <fieldset className={`field field--group${resultError ? " field--invalid" : ""}`}>
        <legend className="field__label">
          {t("businessCases.finance.result")} <span className="field__required">({t("common.form.required")})</span>
        </legend>
        {(["validated", "rejected"] as const).map((r) => (
          <label key={r} className="checkbox">
            <input
              type="radio"
              name="finance-result"
              value={r}
              checked={result === r}
              aria-invalid={resultError ? true : undefined}
              aria-describedby={resultError ? "finance-result-error" : undefined}
              onChange={() => setResult(r)}
            />
            {t(`businessCases.finance.choice.${r}`)}
          </label>
        ))}
        {resultError ? (
          <p className="field__error" id="finance-result-error">
            <Icon name="alert" /> {resultError}
          </p>
        ) : null}
      </fieldset>
      <Field
        label={t("businessCases.finance.note")}
        error={codes["note"] ? caseFieldMessage(t, codes["note"]) : undefined}
        required
      >
        {(control) => (
          <textarea {...control} rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        )}
      </Field>
    </Dialog>
  );
}
