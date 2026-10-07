// Row actions shared by the P2 registers: archive with a mandatory reason and If-Match (records are archived, never
// deleted), and a small "decision with a note" dialog for Finance validation, trajectory approval and similar
// business decisions recorded by a person (the UI never decides anything automatically).
// The note follows the blank-text rule of every P2 form (F-DG2-210): "" is "no note" (or "required"), a non-empty note
// with no visible content is an inline `validation.blank` error and nothing is sent, and visible text is sent verbatim.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client.ts";
import { beginSessionGuard } from "../auth/sessionBound.ts";
import { errorMessage, fieldErrorMessages } from "../lib/problem.ts";
import { BLANK_CODE, Dialog, Field, isBlankText, REQUIRED_CODE, useFocusFirstInvalid } from "./Form.tsx";
import { Icon } from "./Icon.tsx";
import { ReasonDialog } from "./ReasonDialog.tsx";

/** "Archive" button + reason dialog: POST {url}/archive with { reason } and If-Match. */
export function ArchiveAction({
  url,
  version,
  name,
  onDone,
}: {
  url: string;
  version: number;
  name: string;
  onDone: () => unknown;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="button button--link button--small" onClick={() => setOpen(true)}>
        <Icon name="archive" /> {t("common.action.archive")}
        <span className="visually-hidden">: {name}</span>
      </button>
      {open ? (
        <ReasonDialog
          title={t("common.archive.title", { name })}
          description={t("common.archive.description")}
          confirmLabel={t("common.action.archive")}
          onConfirm={async (reason) => {
            const action = beginSessionGuard(); // F-DG2-530: every effect below belongs to this session generation
            try {
              await api.send(`${url}/archive`, { method: "POST", body: { reason }, ifMatch: version });
            } catch (e) {
              // A 409 means the row changed meanwhile: refresh so the next attempt uses the current version.
              if (!action.stale(e) && e instanceof ApiError && e.status === 409) await onDone();
              throw e; // ReasonDialog shows it, or drops it silently when the session generation moved
            }
            if (!action.run(() => setOpen(false))) return;
            await onDone();
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export interface DecisionChoice {
  readonly value: string;
  readonly label: string;
}

/**
 * A business decision with a note (Finance validation of a baseline/value pool, trajectory approval, evidence review).
 * The body is built by `toBody`; If-Match carries the record's version.
 */
export function NoteDecisionDialog({
  title,
  description,
  choices,
  choiceLabel,
  noteLabel,
  noteRequired,
  extra,
  confirmLabel,
  url,
  version,
  toBody,
  notePointer = "/note",
  onDone,
  onClose,
}: {
  title: string;
  description?: string;
  choices?: readonly DecisionChoice[];
  choiceLabel?: string;
  noteLabel: string;
  noteRequired: boolean;
  extra?: { label: string; choices: readonly DecisionChoice[] };
  confirmLabel: string;
  url: string;
  version: number;
  toBody: (input: { choice: string; note: string; extra: string }) => Record<string, unknown>;
  /** JSON pointer of the note in the request body, so a server field error on it lands on the note (e.g. "/outcomeText"). */
  notePointer?: string;
  onDone: () => unknown;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState("");
  const [extraValue, setExtraValue] = useState("");
  const [note, setNote] = useState("");
  /** FE12: field-error codes; translated at render time so a visible message follows a language switch. */
  const [errorCodes, setErrors] = useState<Record<string, string>>({});
  const errors = fieldErrorMessages(t, errorCodes);
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (choices && !choice) next["choice"] = REQUIRED_CODE;
    if (extra && !extraValue) next["extra"] = REQUIRED_CODE;
    if (isBlankText(note)) next["note"] = BLANK_CODE;
    else if (noteRequired && note === "") next["note"] = REQUIRED_CODE;
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard(); // F-DG2-530: every effect below belongs to this session generation
    setBusy(true);
    setServerError(null);
    try {
      await api.send(url, {
        method: "POST",
        body: toBody({ choice, note, extra: extraValue }),
        ifMatch: version,
      });
      await onDone();
      if (action.stale()) return;
      onClose();
    } catch (e) {
      if (action.stale(e)) return; // F-DG2-530: silent, the session state was already reset
      const onNote = e instanceof ApiError ? e.fieldErrors.find((fe) => fe.pointer === notePointer) : undefined;
      if (onNote) {
        setErrors({ note: onNote.code });
        focusInvalid();
      } else setServerError(e);
      if (e instanceof ApiError && e.status === 409) await onDone();
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
            {busy ? t("common.state.saving") : confirmLabel}
          </button>
        </>
      }
    >
      {description ? <p>{description}</p> : null}
      {serverError ? (
        <p className="banner banner--error" role="alert" data-state="error">
          <Icon name="alert" /> {errorMessage(t, serverError)}
        </p>
      ) : null}
      {choices ? (
        <fieldset className={`field field--group${errors["choice"] ? " field--invalid" : ""}`}>
          <legend className="field__label">
            {choiceLabel} <span className="field__required">({t("common.form.required")})</span>
          </legend>
          {choices.map((c) => (
            <label key={c.value} className="checkbox">
              <input
                type="radio"
                name="decision-choice"
                value={c.value}
                aria-invalid={errors["choice"] ? true : undefined}
                checked={choice === c.value}
                onChange={() => setChoice(c.value)}
              />
              {c.label}
            </label>
          ))}
          {errors["choice"] ? (
            <p className="field__error">
              <Icon name="alert" /> {errors["choice"]}
            </p>
          ) : null}
        </fieldset>
      ) : null}
      {extra ? (
        <fieldset className={`field field--group${errors["extra"] ? " field--invalid" : ""}`}>
          <legend className="field__label">
            {extra.label} <span className="field__required">({t("common.form.required")})</span>
          </legend>
          {extra.choices.map((c) => (
            <label key={c.value} className="checkbox">
              <input
                type="radio"
                name="decision-extra"
                value={c.value}
                aria-invalid={errors["extra"] ? true : undefined}
                checked={extraValue === c.value}
                onChange={() => setExtraValue(c.value)}
              />
              {c.label}
            </label>
          ))}
          {errors["extra"] ? (
            <p className="field__error">
              <Icon name="alert" /> {errors["extra"]}
            </p>
          ) : null}
        </fieldset>
      ) : null}
      <Field label={noteLabel} error={errors["note"]} required={noteRequired}>
        {(control) => (
          <textarea {...control} rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        )}
      </Field>
    </Dialog>
  );
}
