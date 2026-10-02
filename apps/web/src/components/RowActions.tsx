// Row actions shared by the P2 registers: archive with a mandatory reason and If-Match (records are archived, never
// deleted), and a small "decision with a note" dialog for Finance validation, trajectory approval and similar
// business decisions recorded by a person (the UI never decides anything automatically).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "../api/client.ts";
import { errorMessage } from "../lib/problem.ts";
import { Dialog, Field } from "./Form.tsx";
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
  onDone: () => void | Promise<void>;
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
            try {
              await api.send(`${url}/archive`, { method: "POST", body: { reason }, ifMatch: version });
            } catch (e) {
              // A 409 means the row changed meanwhile: refresh so the next attempt uses the current version.
              if (e instanceof ApiError && e.status === 409) await onDone();
              throw e;
            }
            setOpen(false);
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
  onDone: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState("");
  const [extraValue, setExtraValue] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (choices && !choice) next["choice"] = t("problems.validation__required");
    if (extra && !extraValue) next["extra"] = t("problems.validation__required");
    if (noteRequired && note.trim().length === 0) next["note"] = t("problems.validation__required");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    setServerError(null);
    try {
      await api.send(url, {
        method: "POST",
        body: toBody({ choice, note: note.trim(), extra: extraValue }),
        ifMatch: version,
      });
      await onDone();
      onClose();
    } catch (e) {
      setServerError(e);
      if (e instanceof ApiError && e.status === 409) await onDone();
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
