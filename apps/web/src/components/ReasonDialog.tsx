// Mandatory-reason confirmation (archive, revoke): the reason is validated with the shared `reason` schema (3–1000
// characters, trimmed) before the request, and server errors are shown translated inside the dialog.
import { reasonRequest } from "@mth/shared/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../lib/problem.ts";
import { Dialog, Field, issueCode } from "./Form.tsx";
import { fieldErrorMessage } from "../lib/problem.ts";

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
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = reasonRequest.safeParse({ reason });
    if (!parsed.success) {
      setFieldError(fieldErrorMessage(t, issueCode(parsed.error.issues[0]!)));
      return;
    }
    setFieldError(undefined);
    setServerError(null);
    setBusy(true);
    try {
      await onConfirm(parsed.data.reason);
    } catch (err) {
      setServerError(err);
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
