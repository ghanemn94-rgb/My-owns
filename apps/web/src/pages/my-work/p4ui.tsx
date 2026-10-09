// Shared UI kit of the P4 slice I and C screens (T-DG4-FE-A): the one form dialog every action uses, the form-level
// alert, person names, due dates (Unknown with its reason, never a guessed date) and the business-approval note.
//  - S-7: one form-level alert per form (role="alert"); field errors sit on their fields; actions are session-bound
//    (beginSessionGuard); the label is "business approval", never an engineering gate.
//  - Every versioned change sends If-Match with the record version the user saw; a 409 says nothing was saved and
//    reloads the data (the caller's onDone), a 428 is translated like any problem.
//  - Problem codes are translated at render time from `problems.*` (and the page namespace's `<ns>.problem.*` first).
import { useQueries } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { hasText } from "@mth/shared/schemas";
import { ApiError, api } from "../../api/client.ts";
import { keys, shouldRetry } from "../../api/queries.ts";
import type { User } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { BLANK_CODE, Dialog, Field, REQUIRED_CODE, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { errorMessage, fieldErrorMessage, pointerToField, problemKey } from "../../lib/problem.ts";

// ------------------------------------------------------------------------------------------------ problems

const codeKey = (code: string) => code.replace(/\./g, "__");

/** The translated message of an error: the page namespaces' own `problem.*` texts first, then `problems.*`. */
export function p4ProblemMessage(t: TFunction, error: unknown, namespaces: readonly string[] = []): string {
  if (error instanceof ApiError && error.code) {
    const codes = [error.code, ...error.fieldErrors.map((fe) => fe.code)];
    for (const code of codes)
      for (const ns of namespaces) {
        const own = t(`${ns}.problem.${codeKey(code)}`, { defaultValue: "" });
        if (own) return own;
      }
    if (t(problemKey(error.code), { defaultValue: "" })) return t(problemKey(error.code));
  }
  return errorMessage(t, error);
}

/** The form's one alert (S-7). A 409 adds "nothing was saved; the latest data has been loaded". */
export function FormAlert({
  error,
  namespaces = [],
  extra,
}: {
  error: unknown;
  namespaces?: readonly string[];
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  if (!error) return null;
  const conflict = error instanceof ApiError && error.status === 409;
  // A stale business approval is not a "reload and retry" case: the record itself changed (the caller links to it).
  const reloaded = conflict && error.code !== "approval.stale_version";
  return (
    <div
      className="banner banner--error"
      role="alert"
      data-state={conflict ? "conflict" : "error"}
      data-problem={error instanceof ApiError ? (error.code ?? "") : ""}
    >
      <p>
        <Icon name="alert" /> {p4ProblemMessage(t, error, namespaces)}
      </p>
      {reloaded ? <p className="small">{t("myWork.ui.conflictReloaded")}</p> : null}
      {extra}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the form dialog

export type P4FieldKind = "text" | "textarea" | "select" | "date" | "datetime" | "number" | "checkbox";

export interface P4FieldSpec {
  readonly name: string;
  readonly label: string;
  readonly kind: P4FieldKind;
  readonly required?: boolean;
  readonly hint?: string;
  readonly max?: number;
  /** Minimum length of a text (after trimming) or minimum number. */
  readonly min?: number;
  readonly options?: readonly { value: string; label: string }[];
  /** Shown only when this returns true for the current values. */
  readonly when?: (values: P4Values) => boolean;
  /** Left-to-right content (codes, cron expressions, time zones) inside an RTL page. */
  readonly ltr?: boolean;
}

export type P4Values = Record<string, string | boolean>;

export interface P4FormDialogProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly fields: readonly P4FieldSpec[];
  readonly initial?: P4Values;
  readonly submitLabel: string;
  readonly danger?: boolean;
  /** POST (create, actions) or PATCH (versioned edits). */
  readonly method?: "POST" | "PATCH";
  readonly url: string;
  /** The record version the user saw (If-Match); omitted for creates. */
  readonly version?: number;
  /** Builds the request body; may return a map of field -> error code to stop the request (extra validation). */
  readonly toBody: (values: P4Values) => Record<string, unknown> | { readonly fieldErrors: Record<string, string> };
  readonly namespaces?: readonly string[];
  /** A note shown in the dialog (e.g. the business-approval explanation). */
  readonly note?: ReactNode;
  /** Extra content of the alert for a given error (e.g. "open the history" on a stale approval). */
  readonly alertExtra?: (error: unknown) => ReactNode;
  /** Called after success, and after a 409/422 (the data changed or must be re-read). Returns false if stale. */
  readonly onDone: (result: unknown) => Promise<boolean>;
  readonly onClose: () => void;
  /** Called with the new values after every change (e.g. options of one field depend on another). */
  readonly onValuesChange?: (values: P4Values) => void;
}

const isFieldErrors = (x: unknown): x is { fieldErrors: Record<string, string> } =>
  typeof x === "object" && x !== null && "fieldErrors" in x;

/** The value of a text control, or undefined when it holds no visible text (an optional field is then omitted). */
export const textOf = (v: string | boolean | undefined): string | undefined =>
  typeof v === "string" && v !== "" && hasText(v) ? v : undefined;

export function P4FormDialog(props: P4FormDialogProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<P4Values>(props.initial ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);
  const visible = props.fields.filter((f) => !f.when || f.when(values));
  const set = (name: string, value: string | boolean) => {
    const next = { ...values, [name]: value };
    setValues(next);
    props.onValuesChange?.(next);
  };

  const submit = async () => {
    setServerError(null);
    const next: Record<string, string> = {};
    for (const f of visible) {
      const v = values[f.name];
      if (f.kind === "checkbox") continue;
      const s = typeof v === "string" ? v : "";
      if ((f.kind === "text" || f.kind === "textarea") && s !== "" && !hasText(s)) next[f.name] = BLANK_CODE;
      else if (f.required && s === "") next[f.name] = REQUIRED_CODE;
      else if (
        (f.kind === "text" || f.kind === "textarea") &&
        s !== "" &&
        f.min !== undefined &&
        [...s.trim()].length < f.min
      )
        next[f.name] = "validation.too_small";
    }
    let body: Record<string, unknown> | null = null;
    if (Object.keys(next).length === 0) {
      const built = props.toBody(values);
      if (isFieldErrors(built)) Object.assign(next, built.fieldErrors);
      else body = built;
    }
    setErrors(next);
    if (body === null) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      const result = await api.send<unknown>(props.url, {
        method: props.method ?? "POST",
        body,
        ...(props.version === undefined ? {} : { ifMatch: props.version }),
      });
      if (action.stale()) return;
      if (!(await props.onDone(result))) return;
      props.onClose();
    } catch (e) {
      if (action.stale(e)) return;
      const names = new Set(visible.map((f) => f.name));
      const fe = e instanceof ApiError ? e.fieldErrors : [];
      const onFields = fe.filter((x) => x.pointer !== "" && names.has(pointerToField(x.pointer)));
      if (e instanceof ApiError && e.code === "validation" && onFields.length > 0 && onFields.length === fe.length) {
        setErrors(Object.fromEntries(onFields.map((x) => [pointerToField(x.pointer), x.code])));
        focusInvalid();
      } else setServerError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await props.onDone(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={props.title}
      onClose={props.onClose}
      dialogRef={dialogRef}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={props.onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button
            type="button"
            className={`button ${props.danger ? "button--danger" : "button--primary"}`}
            onClick={() => void submit()}
            disabled={busy}
            data-action="submit"
          >
            {busy ? t("common.state.saving") : props.submitLabel}
          </button>
        </>
      }
    >
      {props.note}
      {props.description ? <div className="dialog__description">{props.description}</div> : null}
      <FormAlert error={serverError} namespaces={props.namespaces ?? []} extra={props.alertExtra?.(serverError)} />
      {visible.map((f) => (
        <P4FieldControl
          key={f.name}
          spec={f}
          value={values[f.name]}
          error={errors[f.name] ? fieldErrorMessage(t, errors[f.name]!) : undefined}
          onChange={(v) => set(f.name, v)}
        />
      ))}
    </Dialog>
  );
}

function P4FieldControl({
  spec,
  value,
  error,
  onChange,
}: {
  spec: P4FieldSpec;
  value: string | boolean | undefined;
  error: string | undefined;
  onChange: (v: string | boolean) => void;
}) {
  const { t } = useTranslation();
  const checkId = useId();
  const s = typeof value === "string" ? value : "";
  if (spec.kind === "checkbox")
    return (
      <div className="field">
        <label className="checkbox" htmlFor={checkId}>
          <input id={checkId} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {spec.label}
        </label>
        {spec.hint ? <p className="field__hint">{spec.hint}</p> : null}
      </div>
    );
  return (
    <Field label={spec.label} hint={spec.hint} required={spec.required ?? false} error={error}>
      {(control) => {
        const common = { ...control, "data-field": spec.name, ...(spec.ltr ? { dir: "ltr" } : {}) };
        switch (spec.kind) {
          case "textarea":
            return (
              <textarea
                {...common}
                rows={3}
                maxLength={spec.max}
                value={s}
                onChange={(e) => onChange(e.target.value)}
              />
            );
          case "select":
            return (
              <select {...common} value={s} onChange={(e) => onChange(e.target.value)}>
                <option value="">{t("common.form.choose")}</option>
                {(spec.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
          case "date":
            return <input {...common} type="date" value={s} onChange={(e) => onChange(e.target.value)} />;
          case "datetime":
            return <input {...common} type="datetime-local" value={s} onChange={(e) => onChange(e.target.value)} />;
          case "number":
            return (
              <input
                {...common}
                type="number"
                inputMode="numeric"
                min={spec.min}
                max={spec.max}
                step={1}
                value={s}
                onChange={(e) => onChange(e.target.value)}
              />
            );
          default:
            return (
              <input
                {...common}
                type="text"
                maxLength={spec.max}
                value={s}
                onChange={(e) => onChange(e.target.value)}
              />
            );
        }
      }}
    </Field>
  );
}

// ------------------------------------------------------------------------------------------------ people

/**
 * Display names of people by id: the signed-in user from the session, others from GET /users/{id} where the caller
 * may read users. Someone the caller cannot read is "Person ·abcd" (a short, non-identifying suffix), never blank.
 */
export function useUserNames(ids: readonly (string | null | undefined)[]): (id: string | null | undefined) => string {
  const { t } = useTranslation();
  const me = useMe();
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string" && x !== me.user.id))];
  const users = useQueries({
    queries: unique.map((id) => ({
      queryKey: keys.user(id),
      queryFn: () => api.get<User>(`/api/v1/users/${id}`),
      retry: shouldRetry,
      staleTime: 60_000,
    })),
  });
  const names = new Map<string, string>([[me.user.id, me.user.displayName]]);
  users.forEach((q, i) => {
    if (q.data) names.set(unique[i]!, q.data.displayName);
  });
  return (id) => {
    if (!id) return t("common.value.notAssigned");
    const n = names.get(id);
    if (n) return id === me.user.id ? `${n} · ${t("common.people.me")}` : n;
    return t("myWork.ui.person", { ref: id.slice(-4) });
  };
}

// ------------------------------------------------------------------------------------------------ dates and notes

/** A business date, or Unknown with its reason (never a guessed date, never "on time"). */
export function DueDate({ date, reason }: { date: string | null | undefined; reason?: string | null | undefined }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const formatted = formatBusinessDate(date ?? null, locale);
  if (formatted) return <span data-due={date}>{formatted}</span>;
  return (
    <span className="status-chip status-chip--unknown status-chip--wrap" data-due="unknown">
      <Icon name="question" />{" "}
      <span>
        {t("common.value.unknown")}
        {reason
          ? ` (${t(`myWork.ui.unknownReason.${reason}`, { defaultValue: t("myWork.ui.unknownReason.other") })})`
          : ""}
      </span>
    </span>
  );
}

/** "Business approval" note (S-7): an in-product business decision, never an engineering delivery gate. */
export function BusinessApprovalNote({ body }: { body: string }) {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="business-approval">
      <Icon name="lock" /> <strong>{t("myWork.ui.businessApproval")}</strong>: {body}
    </p>
  );
}

/** The read-only note of a screen the caller can see but not change (AUD and other read-only roles; S-7). */
export function ReadOnlyNote({ body }: { body?: string }) {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="read-only">
      <Icon name="lock" /> {body ?? t("myWork.ui.readOnly")}
    </p>
  );
}

/** "YYYY-MM-DDTHH:mm" (a datetime-local value) -> ISO UTC, read in the given IANA zone; null when invalid. */
export { zonedLocalToUtcIso } from "../../lib/format.ts";
