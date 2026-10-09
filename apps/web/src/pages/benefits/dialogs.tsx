// A dialog for the benefit forms that do not fit FE-A's field-list dialog (allocation rows, the six Finance items, a
// measurement with evidence checkboxes). Same rules (S-7): one form-level alert; the action runs in a session guard;
// If-Match carries the record version the user saw; a 409 or 422 reloads the data (the caller's onDone).
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "../../api/client.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Dialog, useFocusFirstInvalid } from "../../components/Form.tsx";
import { FormAlert } from "../my-work/p4ui.tsx";
import { NS } from "./ui.tsx";

export function SendDialog({
  title,
  description,
  children,
  submitLabel,
  method = "POST",
  url,
  version,
  build,
  onDone,
  onClose,
  danger,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  submitLabel: string;
  method?: "POST" | "PUT" | "PATCH";
  url: string;
  version?: number;
  /** The body, or null when the caller's own checks failed (it shows its field errors itself). */
  build: () => Record<string, unknown> | null | undefined;
  onDone: (result: unknown) => Promise<boolean>;
  onClose: () => void;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);
  const submit = async () => {
    setError(null);
    const body = build();
    if (body === null) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      const result = await api.send<unknown>(url, {
        method,
        ...(body === undefined ? {} : { body }),
        ...(version === undefined ? {} : { ifMatch: version }),
      });
      if (action.stale()) return;
      if (!(await onDone(result))) return;
      onClose();
    } catch (e) {
      if (action.stale(e)) return;
      setError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await onDone(null);
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
          <button
            type="button"
            className={`button ${danger ? "button--danger" : "button--primary"}`}
            onClick={() => void submit()}
            disabled={busy}
            data-action="submit"
          >
            {busy ? t("common.state.saving") : submitLabel}
          </button>
        </>
      }
    >
      {description ? <div className="dialog__description">{description}</div> : null}
      <FormAlert error={error} namespaces={NS} />
      {children}
    </Dialog>
  );
}
