// Mandatory-reason confirmation (archive, revoke, remove): the reason is validated with the shared `reason` schema
// (3–1000 characters, trimmed by the server) before the request, and server errors are shown translated inside the
// dialog. The blank-text rule of every P2 form applies (F-DG2-210, BE7): a non-empty reason with no visible content
// (spaces or invisible characters such as U+200F only) is an inline `validation.blank` error and nothing is sent; a
// server 400 on `/reason` lands on the field, never as a generic failure. The text is sent as typed.
import { reasonRequest } from "@mth/shared/schemas";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, isSessionChangedError } from "../api/client.ts";
import { errorMessage, fieldErrorMessage } from "../lib/problem.ts";
import { BLANK_CODE, Dialog, Field, isBlankText, issueCode, useFocusFirstInvalid } from "./Form.tsx";

export function ReasonDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  /** FE12: the field-error code; translated at render time so a visible message follows a language switch. */
  const [fieldErrorCode, setFieldErrorCode] = useState<string | undefined>();
  const fieldError = fieldErrorCode === undefined ? undefined : fieldErrorMessage(t, fieldErrorCode);
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);

  const showFieldError = (code: string) => {
    setFieldErrorCode(code);
    focusInvalid();
  };

  const submit = async () => {
    setServerError(null);
    if (isBlankText(reason)) {
      showFieldError(BLANK_CODE);
      return;
    }
    const parsed = reasonRequest.safeParse({ reason });
    if (!parsed.success) {
      showFieldError(issueCode(parsed.error.issues[0]!));
      return;
    }
    setFieldErrorCode(undefined);
    setBusy(true);
    try {
      await onConfirm(reason);
    } catch (err) {
      if (isSessionChangedError(err)) {
        setBusy(false);
        return; // F-DG2-530: silent, the session state was already reset
      }
      const onReason = err instanceof ApiError ? err.fieldErrors.find((fe) => fe.pointer === "/reason") : undefined;
      if (onReason) showFieldError(onReason.code);
      else setServerError(err);
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
          <button type="button" className="button button--danger" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : confirmLabel}
          </button>
        </>
      }
    >
      <p>{description}</p>
      {serverError ? (
        <p className="banner banner--error" role="alert">
          {errorMessage(t, serverError)}
        </p>
      ) : null}
      <Field label={t("common.form.reason")} hint={t("common.form.reasonHint")} error={fieldError} required>
        {(control) => (
          <textarea {...control} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        )}
      </Field>
    </Dialog>
  );
}
