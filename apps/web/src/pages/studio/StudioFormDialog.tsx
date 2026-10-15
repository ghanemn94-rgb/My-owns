// The Studio's form dialog (T-DG5-FE-B): the same contract as the shared P4FormDialog (pages/my-work/p4ui.tsx, not
// owned by this task), plus PUT, which the element and scoring-defaults writes use (`putConfigElement`). One
// form-level alert; field errors on their fields (the API's `errors[].pointer` too); the request carries If-Match
// with the version the user saw; session-bound (S-7). Blank text (spaces or invisible characters only) is refused
// inline with `validation.blank`, as in every form.
import { hasText } from "@mth/shared/schemas";
import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "../../api/client.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { BLANK_CODE, Dialog, Field, REQUIRED_CODE, useFocusFirstInvalid } from "../../components/Form.tsx";
import { fieldErrorMessage, pointerToField } from "../../lib/problem.ts";
import { FormAlert, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";

export interface StudioFormDialogProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly note?: ReactNode;
  readonly fields: readonly P4FieldSpec[];
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
      {visible.map((f) => (
        <FieldControl
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

function FieldControl({
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
