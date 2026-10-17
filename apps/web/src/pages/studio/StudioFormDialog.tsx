// The Studio's form dialog (T-DG5-FE-B): the same contract as the shared P4FormDialog (pages/my-work/p4ui.tsx, not
// owned by this task), plus PUT, which the element and scoring-defaults writes use (`putConfigElement`). One
// form-level alert; field errors on their fields (the API's `errors[].pointer` too); the request carries If-Match
// with the version the user saw; session-bound (S-7). Blank text (spaces or invisible characters only) is refused
// inline with `validation.blank`, as in every form.
import { hasText } from "@mth/shared/schemas";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "../../api/client.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { BLANK_CODE, Dialog, Field, REQUIRED_CODE, useFocusFirstInvalid } from "../../components/Form.tsx";
import { fieldErrorMessage, pointerToField } from "../../lib/problem.ts";
import { FormAlert, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";

/**
 * A field of the Studio dialog: the shared P4 field kinds, plus "roleList" (T-DG5-FE-G2; ADR-0039 §2, ADR-0044 §4), an
 * ORDERED list of role codes (an approver route's `approverRoleCodes`). Its value is the codes joined by new lines, in
 * order; rows can be added, moved up or down and removed with buttons, so the order is set by keyboard too.
 */
export type StudioFieldSpec = Omit<P4FieldSpec, "kind"> & { readonly kind: P4FieldSpec["kind"] | "roleList" };

/** The maximum number of roles of an ordered role list (the `approverRoleCodes` schema: 1-10). */
export const ROLE_LIST_MAX = 10;

/**
 * The rows of a roleList value, empty rows kept while editing. The dialog stores the rows as a JSON array (so one empty
 * row is not lost); plain text with one code per line is read too.
 */
export function roleListRows(value: string): string[] {
  if (value === "") return [];
  if (value.startsWith("[")) {
    try {
      const rows: unknown = JSON.parse(value);
      if (Array.isArray(rows)) return rows.map((r) => (typeof r === "string" ? r : String(r)));
    } catch {
      // not JSON: one code per line
    }
  }
  return value.split("\n");
}

/** The stored value of roleList rows ("" for no rows). */
export const roleListValue = (rows: readonly string[]): string => (rows.length === 0 ? "" : JSON.stringify(rows));

export interface StudioFormDialogProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly note?: ReactNode;
  readonly fields: readonly StudioFieldSpec[];
  readonly initial?: P4Values;
  readonly submitLabel: string;
  readonly danger?: boolean;
  readonly method?: "POST" | "PATCH" | "PUT";
  readonly url: string;
  readonly version?: number;
  readonly toBody: (values: P4Values) => Record<string, unknown> | { readonly fieldErrors: Record<string, string> };
  readonly namespaces?: readonly string[];
  readonly onDone: (result: unknown) => Promise<boolean>;
  readonly onClose: () => void;
  readonly onValuesChange?: (values: P4Values) => void;
}

const isFieldErrors = (x: unknown): x is { fieldErrors: Record<string, string> } =>
  typeof x === "object" && x !== null && "fieldErrors" in x;

export function StudioFormDialog(props: StudioFormDialogProps) {
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
      if (f.kind === "checkbox") continue;
      const v = values[f.name];
      const s = typeof v === "string" ? v : "";
      if ((f.kind === "text" || f.kind === "textarea") && s !== "" && !hasText(s)) next[f.name] = BLANK_CODE;
      else if (f.required && s === "") next[f.name] = REQUIRED_CODE;
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
      // A pointer into the attributes (`/attributes/labelEn`) lands on the field of the same name.
      const fieldOf = (pointer: string) => pointerToField(pointer.replace(/^\/attributes\//, "/"));
      const onFields = fe.filter((x) => x.pointer !== "" && names.has(fieldOf(x.pointer)));
      if (e instanceof ApiError && e.code === "validation" && onFields.length > 0 && onFields.length === fe.length) {
        setErrors(Object.fromEntries(onFields.map((x) => [fieldOf(x.pointer), x.code])));
        focusInvalid();
      } else setServerError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await props.onDone(null);
    } finally {
      if (action.current()) setBusy(false);
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
      <FormAlert error={serverError} namespaces={props.namespaces ?? []} />
      {visible.map((f) =>
        f.kind === "roleList" ? (
          <RoleListControl
            key={f.name}
            spec={f}
            value={typeof values[f.name] === "string" ? (values[f.name] as string) : ""}
            error={errors[f.name] ? fieldErrorMessage(t, errors[f.name]!) : undefined}
            onChange={(v) => set(f.name, v)}
          />
        ) : (
          <FieldControl
            key={f.name}
            spec={f}
            value={values[f.name]}
            error={errors[f.name] ? fieldErrorMessage(t, errors[f.name]!) : undefined}
            onChange={(v) => set(f.name, v)}
          />
        ),
      )}
    </Dialog>
  );
}

function FieldControl({
  spec,
  value,
  error,
  onChange,
}: {
  spec: StudioFieldSpec;
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
          <input
            id={checkId}
            type="checkbox"
            data-field={spec.name}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          {spec.label}
        </label>
        {spec.hint ? <p className="field__hint">{spec.hint}</p> : null}
      </div>
    );
  return (
    <Field label={spec.label} hint={spec.hint} required={spec.required ?? false} error={error}>
      {(control) => {
        const common = { ...control, "data-field": spec.name, ...(spec.ltr ? { dir: "ltr" } : {}) };
        if (spec.kind === "textarea")
          return (
            <textarea {...common} rows={3} maxLength={spec.max} value={s} onChange={(e) => onChange(e.target.value)} />
          );
        if (spec.kind === "select")
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
        return (
          <input {...common} type="text" maxLength={spec.max} value={s} onChange={(e) => onChange(e.target.value)} />
        );
      }}
    </Field>
  );
}

/**
 * The ordered role list (T-DG5-FE-G2; F-DG5-QA-A-3): a fieldset with one LTR code input per step, in order, and buttons
 * to add a role, move a step up or down and remove it. Every control is labelled with its step number; the error is
 * announced with the fieldset (aria-describedby).
 */
function RoleListControl({
  spec,
  value,
  error,
  onChange,
}: {
  spec: StudioFieldSpec;
  value: string;
  error: string | undefined;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const rows = roleListRows(value);
  const focusRow = useRef<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (focusRow.current === null) return;
    const inputs = listRef.current?.querySelectorAll<HTMLInputElement>("input");
    inputs?.[focusRow.current]?.focus();
    focusRow.current = null;
  });
  const update = (next: string[], focus: number | null = null) => {
    focusRow.current = focus;
    onChange(roleListValue(next));
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...rows];
    const [row] = next.splice(i, 1);
    next.splice(i + by, 0, row ?? "");
    update(next, i + by);
  };
  const describedBy = [spec.hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <fieldset
      className={`field field--role-list${error ? " field--invalid" : ""}`}
      data-field={spec.name}
      aria-invalid={error ? true : undefined}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
    >
      <legend className="field__label">{spec.label}</legend>
      {spec.hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {spec.hint}
        </p>
      ) : null}
      {rows.length === 0 ? <p className="muted small">{t("studio.elements.route.noRoles")}</p> : null}
      <ol className="role-list" ref={listRef}>
        {rows.map((code, i) => (
          <li key={i} className="role-list__row" data-step={i + 1}>
            <input
              type="text"
              dir="ltr"
              maxLength={32}
              value={code}
              aria-label={t("studio.elements.route.stepRole", { n: i + 1 })}
              onChange={(e) => {
                const next = [...rows];
                next[i] = e.target.value.trim().toUpperCase();
                update(next);
              }}
            />{" "}
            <button
              type="button"
              className="button button--secondary button--small"
              disabled={i === 0}
              aria-label={t("studio.elements.route.moveUp", { n: i + 1 })}
              onClick={() => move(i, -1)}
            >
              ↑
            </button>{" "}
            <button
              type="button"
              className="button button--secondary button--small"
              disabled={i === rows.length - 1}
              aria-label={t("studio.elements.route.moveDown", { n: i + 1 })}
              onClick={() => move(i, 1)}
            >
              ↓
            </button>{" "}
            <button
              type="button"
              className="button button--secondary button--small"
              aria-label={t("studio.elements.route.removeRole", { n: i + 1 })}
              onClick={() =>
                update(
                  rows.filter((_, j) => j !== i),
                  null,
                )
              }
            >
              {t("studio.elements.route.remove")}
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="button button--secondary button--small"
        disabled={rows.length >= ROLE_LIST_MAX}
        onClick={() => update([...rows, ""], rows.length)}
      >
        {t("studio.elements.route.addRole")}
      </button>
      {error ? (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
