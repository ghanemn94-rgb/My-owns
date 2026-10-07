// Declarative create/edit form for the P2 registers (REQ-S15-011/012, REQ-S16-026). One component gives every native
// form the same guarantees:
//  - every control has a visible label, hints/errors linked by aria-describedby, required marked in text;
//  - the payload is validated with the SHARED zod schema (the one the API uses) before it is sent, and messages are
//    translated from their codes;
//  - creates send an Idempotency-Key (stable for this form instance, so a retry cannot create twice);
//  - edits send only the changed fields with If-Match; a 409 shows "nothing was saved", compares the user's values
//    with the current saved ones and offers re-apply on the current version or discard;
//  - server field errors land on their field; everything else (403, 422 business rules) is a translated banner;
//  - free text is sent verbatim: "" means "no value" (create) or an explicit clear (edit), and a non-empty value with
//    no visible content (the SHARED `hasText`, the server's own predicate) is an inline `validation.blank` error, so
//    nothing is sent and focus moves to the first invalid field (F-DG2-210).
import { hasText } from "@mth/shared/schemas";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { api, ApiError, newIdempotencyKey } from "../api/client.ts";
import { beginSessionGuard } from "../auth/sessionBound.ts";
import {
  distinctFormMessages,
  errorMessage,
  fieldErrorMessage,
  fieldErrorMessages,
  pointerToField,
} from "../lib/problem.ts";
import { Dialog, Field, issueCode } from "./Form.tsx";
import { Icon } from "./Icon.tsx";
import type { Person } from "./People.tsx";

export type FieldKind =
  | "text"
  | "textarea"
  | "date"
  | "decimal"
  | "integer"
  | "select"
  | "checkbox"
  | "tristate"
  | "person"
  | "url"
  /** Dated decimal points, one per line: "YYYY-MM-DD value" (a T02 target trajectory). */
  | "trajectory";

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

export interface FieldSpec {
  readonly name: string;
  readonly kind: FieldKind;
  readonly label: string;
  readonly hint?: string;
  readonly required?: boolean;
  readonly options?: readonly FieldOption[];
  /** The control is shown but cannot be changed (e.g. the T01 dimension of a seeded row). */
  readonly readOnly?: boolean;
  readonly maxLength?: number;
  readonly rows?: number;
  readonly min?: number;
  readonly max?: number;
  /** Not sent when the form edits an existing record (create-only fields). */
  readonly createOnly?: boolean;
  /** Only shown and sent when editing (e.g. a change summary). */
  readonly editOnly?: boolean;
  /**
   * Describes a change rather than being one (e.g. a charter change summary): an update whose only changed fields are
   * annotations is "no changes to save", never a content-free new version (F-DG2-210).
   */
  readonly annotation?: boolean;
  /** Free-text decimals are typed with Latin digits and a dot ("1250000.50"); shown as a hint. */
  readonly dir?: "ltr" | "rtl";
}

type FormValue = string | boolean;
export type FormValues = Record<string, FormValue>;

function toFormValue(spec: FieldSpec, value: unknown): FormValue {
  switch (spec.kind) {
    case "checkbox":
      return value === true;
    case "tristate":
      return value === true ? "yes" : value === false ? "no" : "";
    case "trajectory":
      return Array.isArray(value)
        ? (value as { date: string; value: string }[]).map((p) => `${p.date} ${p.value}`).join("\n")
        : "";
    default:
      return value === null || value === undefined ? "" : String(value);
  }
}

function fromFormValue(spec: FieldSpec, value: FormValue | undefined): unknown {
  switch (spec.kind) {
    case "checkbox":
      return value === true;
    case "tristate":
      return value === "yes" ? true : value === "no" ? false : null;
    case "integer": {
      const s = typeof value === "string" ? value.trim() : "";
      if (s === "") return null;
      // Integers only (levels, ranks, minutes): never money. A non-integer stays a string so the schema rejects it.
      return /^-?\d{1,9}$/.test(s) ? Number(s) : s;
    }
    case "decimal": {
      const s = typeof value === "string" ? value.trim() : "";
      return s === "" ? null : s;
    }
    case "trajectory": {
      const s = typeof value === "string" ? value : "";
      // Each non-empty line is "date value"; a malformed line is passed through so the shared schema rejects it.
      return s
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line) => {
          const [date = "", amount = ""] = line.split(/[\s,;]+/);
          return { date, value: amount };
        });
    }
    default: {
      // Verbatim: only a truly empty control means "no value". Whitespace- or invisible-only text is NOT turned into
      // null; it is caught as `validation.blank` before sending (blankErrors) and by the shared schema (F-DG2-210).
      const s = typeof value === "string" ? value : "";
      return s === "" ? null : s;
    }
  }
}

/** Kinds whose value is user-typed free text (the ones a blank-text rule applies to). */
const FREE_TEXT_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(["text", "textarea", "url"]);

/** True when the control holds text but none of it is visible (spaces, format characters, fillers). */
export function isBlankText(spec: FieldSpec, value: FormValue | undefined): boolean {
  return FREE_TEXT_KINDS.has(spec.kind) && typeof value === "string" && value !== "" && !hasText(value);
}

export function formValuesOf(fields: readonly FieldSpec[], record: Record<string, unknown> | null): FormValues {
  return Object.fromEntries(fields.map((f) => [f.name, toFormValue(f, record?.[f.name])]));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface RecordFormProps<R> {
  readonly fields: readonly FieldSpec[];
  /** The record being edited (needs `version`); null for a create. */
  readonly record: (R & { version: number }) | null;
  /** Initial values for a create (e.g. the dimension of the row being filled). */
  readonly defaults?: Record<string, unknown>;
  readonly createSchema?: z.ZodType;
  readonly updateSchema?: z.ZodType;
  readonly createUrl?: string;
  /** For a POST that changes an existing record (e.g. a conversion): If-Match instead of an Idempotency-Key. */
  readonly createIfMatch?: number;
  readonly updateUrl?: (record: R) => string;
  readonly method?: "PATCH" | "PUT";
  /** Fixed body fields of a create (e.g. transformationId). */
  readonly extra?: Record<string, unknown>;
  /** Reshapes a create body before validation (e.g. option fields A/B/C into an `options` array). */
  readonly mapCreate?: (body: Record<string, unknown>) => Record<string, unknown>;
  /** Extra fields of an update body (e.g. a charter change summary), added when there is a change. */
  readonly updateExtra?: () => Record<string, unknown>;
  /** Loads the latest saved version after a 409 (defaults to GET updateUrl). */
  readonly loadLatest?: (record: R) => Promise<R & { version: number }>;
  readonly people?: readonly Person[];
  readonly submitLabel: string;
  readonly onSaved: (saved: unknown) => unknown;
  readonly onCancel?: () => void;
  /** Rendered between the fields and the buttons (e.g. a computed warning). */
  readonly children?: ReactNode;
  /**
   * Live preview of the values (e.g. the Team assign dialog's role accountability). Called after each change to the
   * form's values is committed (a user edit, or a conflict reapply/discard), not for the initial values.
   */
  readonly onValuesChange?: (values: FormValues) => void;
}

export function useRecordForm<R extends Record<string, unknown>>(props: RecordFormProps<R>) {
  const { t } = useTranslation();
  const { fields, record } = props;
  const idempotencyKey = useRef(newIdempotencyKey());
  const [base, setBase] = useState(record);
  const [values, setValues] = useState<FormValues>(() =>
    formValuesOf(fields, (record as Record<string, unknown> | null) ?? props.defaults ?? null),
  );
  // FE12: field and form-level errors are held as *codes* and translated at render time, so a message that is visible
  // while the user switches language follows the new language. The hook still returns translated `errors`/`unmapped`.
  const [errorCodes, setErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState<unknown>(null);
  const [unmappedCodes, setUnmapped] = useState<string[]>([]);
  const errors = fieldErrorMessages(t, errorCodes);
  const unmapped = unmappedCodes.map((code) => fieldErrorMessage(t, code));
  const [conflict, setConflict] = useState<{
    latest: (R & { version: number }) | null;
    currentVersion: number | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const isEdit = base !== null;
  /** The <form> element, so focus can move to the first invalid control after a failed submit. */
  const formRef = useRef<HTMLFormElement | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);
  const showErrors = (next: Record<string, string>, other: string[]) => {
    setErrors(next);
    setUnmapped([...new Set(other)]);
    if (Object.keys(next).length > 0) setFocusRequest((n) => n + 1);
  };

  // F-DG2-430: a state updater must stay pure. React may run it while rendering (and twice under StrictMode), so the
  // parent's onValuesChange (which sets the parent's own state) is never called from inside it. Committed values are
  // reported from an effect instead: once per new `values` object, never for the initial values on mount.
  const set = (name: string, value: FormValue) => {
    setValues((v) => ({ ...v, [name]: value }));
  };
  const onValuesChange = props.onValuesChange;
  const reportedValues = useRef(values);
  useEffect(() => {
    if (reportedValues.current === values) return;
    reportedValues.current = values;
    onValuesChange?.(values);
  }, [values, onValuesChange]);

  const payloadFor = (vals: FormValues, against: R | null): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    if (against === null) {
      for (const f of fields) {
        if (f.editOnly) continue;
        if (f.readOnly && props.defaults?.[f.name] === undefined) continue;
        const v = fromFormValue(f, vals[f.name]);
        if (v !== null) body[f.name] = v;
      }
      const full = { ...body, ...props.extra };
      return props.mapCreate ? props.mapCreate(full) : full;
    }
    const before = formValuesOf(fields, against as Record<string, unknown>);
    for (const f of fields) {
      if (f.readOnly || f.createOnly) continue;
      const now = fromFormValue(f, vals[f.name]);
      if (!same(now, fromFormValue(f, before[f.name]))) body[f.name] = now;
    }
    if (Object.keys(body).length > 0 && props.updateExtra) Object.assign(body, props.updateExtra());
    return body;
  };

  /**
   * Free-text fields that would be sent but hold no visible content: on a create every sent field, on an edit only the
   * fields the user changed (an untouched legacy value never blocks saving other fields).
   */
  const blankErrors = (vals: FormValues, against: R | null): Record<string, string> => {
    const before = against === null ? null : formValuesOf(fields, against as Record<string, unknown>);
    const out: Record<string, string> = {};
    for (const f of fields) {
      if (f.readOnly) continue;
      if (against === null ? f.editOnly : f.createOnly) continue;
      if (before !== null && vals[f.name] === before[f.name]) continue;
      if (isBlankText(f, vals[f.name])) out[f.name] = "validation.blank";
    }
    return out;
  };

  const validate = (
    body: Record<string, unknown>,
    schema: z.ZodType | undefined,
    blank: Record<string, string>,
  ): boolean => {
    const next: Record<string, string> = { ...blank };
    const other: string[] = [];
    const result = schema?.safeParse(body);
    if (result && !result.success) {
      for (const issue of result.error.issues) {
        const name = String(issue.path[0] ?? "");
        const code = issueCode(issue);
        if (fields.some((f) => f.name === name)) next[name] ??= code;
        else other.push(code);
      }
    }
    showErrors(next, other);
    return Object.keys(next).length === 0 && other.length === 0;
  };

  const send = async (vals: FormValues, against: (R & { version: number }) | null) => {
    const blank = blankErrors(vals, against);
    const body = payloadFor(vals, against);
    if (Object.keys(blank).length === 0 && against !== null) {
      // Nothing changed, or only annotations (a change summary) changed: never write a content-free version.
      const changed = Object.keys(body).filter((k) => !fields.find((f) => f.name === k)?.annotation);
      if (changed.length === 0) {
        showErrors({}, ["validation.empty_update"]);
        return;
      }
    }
    if (!validate(body, against === null ? props.createSchema : props.updateSchema, blank)) return;
    // F-DG2-530: the save's effects (conflict panel, onSaved, banners) belong to the session generation it began under.
    const action = beginSessionGuard();
    setBusy(true);
    setBannerError(null);
    try {
      const saved =
        against === null
          ? await api.send<unknown>(props.createUrl!, {
              method: "POST",
              body,
              ...(props.createIfMatch !== undefined
                ? { ifMatch: props.createIfMatch }
                : { idempotencyKey: idempotencyKey.current }),
            })
          : await api.send<unknown>(props.updateUrl!(against), {
              method: props.method ?? "PATCH",
              body,
              ifMatch: against.version,
            });
      if (action.stale()) return;
      setConflict(null);
      await props.onSaved(saved);
    } catch (e) {
      if (action.stale(e)) return; // F-DG2-530: silent, the session state was already reset
      if (e instanceof ApiError && e.isConflict && against !== null) {
        let latest: (R & { version: number }) | null = null;
        try {
          latest = props.loadLatest
            ? await props.loadLatest(against)
            : await api.get<R & { version: number }>(props.updateUrl!(against));
        } catch (ge) {
          if (action.stale(ge)) return; // F-DG2-530: silent, the session state was already reset
          latest = null;
        }
        if (action.stale()) return;
        setConflict({ latest, currentVersion: e.currentVersion ?? latest?.version ?? null });
        return;
      }
      if (e instanceof ApiError && e.fieldErrors.length > 0) {
        const next: Record<string, string> = {};
        const other: string[] = [];
        for (const fe of e.fieldErrors) {
          const name = pointerToField(fe.pointer).split(".")[0] ?? "";
          if (fields.some((f) => f.name === name)) next[name] ??= fe.code;
          // A business rule repeats its own code as `validation.<code>`: the banner already says it.
          else if (fe.code !== e.code && fe.code !== `validation.${e.code}`) other.push(fe.code);
        }
        showErrors(next, other);
      }
      setBannerError(e);
    } finally {
      setBusy(false);
    }
  };

  return {
    t,
    values,
    set,
    errors,
    bannerError,
    unmapped,
    conflict,
    busy,
    isEdit,
    base,
    formRef,
    submit: () => send(values, base),
    reapply: () => {
      const latest = conflict?.latest ?? null;
      if (!latest) return;
      // The user's own changes, relative to the version they edited, go on top of the current version.
      const mine = payloadFor(values, base);
      const merged = { ...formValuesOf(fields, latest as Record<string, unknown>) };
      for (const f of fields) if (f.name in mine) merged[f.name] = values[f.name]!;
      setBase(latest);
      setValues(merged);
      setConflict(null);
      void send(merged, latest);
    },
    discard: () => {
      const latest = conflict?.latest ?? base;
      setBase(latest);
      setValues(formValuesOf(fields, (latest as Record<string, unknown> | null) ?? null));
      setConflict(null);
      setBannerError(null);
    },
  };
}

type FormState = ReturnType<typeof useRecordForm>;

/** The controls of a record form (shared by the dialog and the inline layout). */
export function RecordFields({
  form,
  fields,
  people,
}: {
  form: FormState;
  fields: readonly FieldSpec[];
  people?: readonly Person[] | undefined;
}) {
  const { t } = form;
  const banner = form.bannerError ? errorMessage(t, form.bannerError) : null;
  // F-DG2-340: a form-level problem is announced once. The banner already says the message of a validation problem
  // whose only field error has pointer "" (errorMessage), so the form-errors list keeps only what the banner does not.
  const formErrors = distinctFormMessages(banner, form.unmapped);
  return (
    <>
      {fields.map((f) => (
        <FieldControl key={f.name} spec={f} form={form} people={people} />
      ))}
      {formErrors.length > 0 ? (
        // The live region is the wrapper; the <ul> keeps its list role so its <li> are valid (F-DG2-211, WCAG 1.3.1).
        <div className="banner banner--error" role="alert" data-state="form-errors">
          <ul className="plain-list">
            {formErrors.map((m) => (
              <li key={m}>
                <Icon name="alert" /> {m}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {banner !== null ? (
        <p className="banner banner--error" role="alert" data-state="error">
          <Icon name="alert" /> {banner}
        </p>
      ) : null}
    </>
  );
}

function FieldControl({
  spec,
  form,
  people,
}: {
  spec: FieldSpec;
  form: FormState;
  people?: readonly Person[] | undefined;
}) {
  const { t } = form;
  const value = form.values[spec.name];
  const error = form.errors[spec.name];
  const disabled = spec.readOnly === true || (spec.createOnly === true && form.isEdit);
  const groupId = useId();
  if (spec.editOnly && !form.isEdit) return null;
  if (spec.kind === "checkbox") {
    return (
      <div className={`field${error ? " field--invalid" : ""}`}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => form.set(spec.name, e.target.checked)}
            aria-describedby={spec.hint ? `${groupId}-hint` : undefined}
          />
          {spec.label}
        </label>
        {spec.hint ? (
          <p id={`${groupId}-hint`} className="field__hint">
            {spec.hint}
          </p>
        ) : null}
        {error ? (
          <p className="field__error">
            <Icon name="alert" /> {error}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <Field label={spec.label} hint={spec.hint} error={error} required={spec.required === true}>
      {(control) => {
        const common = { ...control, disabled, name: spec.name };
        const str = typeof value === "string" ? value : "";
        switch (spec.kind) {
          case "trajectory":
          case "textarea":
            return (
              <textarea
                {...common}
                {...(spec.kind === "trajectory" ? { dir: "ltr", spellCheck: false } : {})}
                rows={spec.rows ?? 3}
                maxLength={spec.maxLength}
                value={str}
                onChange={(e) => form.set(spec.name, e.target.value)}
              />
            );
          case "select":
          case "tristate":
          case "person": {
            const options: readonly FieldOption[] =
              spec.kind === "tristate"
                ? [
                    { value: "yes", label: t("common.answer.yes") },
                    { value: "no", label: t("common.answer.no") },
                  ]
                : spec.kind === "person"
                  ? withCurrent(
                      (people ?? []).map((p) => ({ value: p.id, label: p.label })),
                      str,
                      t("common.people.outsideTeam"),
                    )
                  : (spec.options ?? []);
            return (
              <select {...common} value={str} onChange={(e) => form.set(spec.name, e.target.value)}>
                <option value="">
                  {spec.kind === "tristate"
                    ? t("common.answer.notAssessed")
                    : spec.required
                      ? t("common.form.choose")
                      : t("common.value.none")}
                </option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
          }
          case "date":
            return <input {...common} type="date" value={str} onChange={(e) => form.set(spec.name, e.target.value)} />;
          case "integer":
            return (
              <input
                {...common}
                type="number"
                inputMode="numeric"
                step={1}
                min={spec.min}
                max={spec.max}
                value={str}
                onChange={(e) => form.set(spec.name, e.target.value)}
              />
            );
          case "decimal":
            return (
              <input
                {...common}
                type="text"
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
                value={str}
                onChange={(e) => form.set(spec.name, e.target.value)}
              />
            );
          case "url":
            return (
              <input
                {...common}
                type="url"
                dir="ltr"
                value={str}
                onChange={(e) => form.set(spec.name, e.target.value)}
              />
            );
          default:
            return (
              <input
                {...common}
                type="text"
                maxLength={spec.maxLength}
                value={str}
                onChange={(e) => form.set(spec.name, e.target.value)}
              />
            );
        }
      }}
    </Field>
  );
}

/** Keeps the current value selectable even when that person is not in the visible team. */
function withCurrent(options: FieldOption[], current: string, outsideLabel: string): FieldOption[] {
  if (!current || options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: outsideLabel }];
}

/** Conflict panel of a record form: nothing saved; compare; re-apply or discard. */
export function FormConflict({ form, fields }: { form: FormState; fields: readonly FieldSpec[] }) {
  const { t } = form;
  if (!form.conflict) return null;
  const latest = form.conflict.latest as Record<string, unknown> | null;
  const latestValues = latest ? formValuesOf(fields, latest) : null;
  const display = (f: FieldSpec, v: FormValue | undefined) => {
    if (f.kind === "checkbox") return v === true ? t("common.answer.yes") : t("common.answer.no");
    if (f.kind === "tristate")
      return v === "yes" ? t("common.answer.yes") : v === "no" ? t("common.answer.no") : t("common.answer.notAssessed");
    const s = typeof v === "string" ? v : "";
    if (!s) return t("common.value.none");
    return f.options?.find((o) => o.value === s)?.label ?? s;
  };
  const rows = latestValues ? fields.filter((f) => !same(form.values[f.name], latestValues[f.name])) : [];
  return (
    <section className="banner banner--warning conflict" role="alert" data-state="conflict">
      <h3 className="conflict__title">
        <Icon name="alert" /> {t("common.conflict.title")}
      </h3>
      <p>
        {t("common.conflict.body", {
          yours: form.base?.version ?? t("common.value.unknown"),
          current: form.conflict.currentVersion ?? t("common.value.unknown"),
        })}
      </p>
      {rows.length > 0 ? (
        <table className="table table--compact">
          <caption>{t("common.conflict.compareCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("common.conflict.field")}</th>
              <th scope="col">{t("common.conflict.mine")}</th>
              <th scope="col">{t("common.conflict.current")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.name}>
                <th scope="row">{f.label}</th>
                <td>{display(f, form.values[f.name])}</td>
                <td>{display(f, latestValues?.[f.name])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="form__actions">
        {latest ? (
          <button type="button" className="button button--primary" onClick={form.reapply} disabled={form.busy}>
            {t("common.conflict.reapply")}
          </button>
        ) : null}
        <button type="button" className="button button--secondary" onClick={form.discard} disabled={form.busy}>
          {t("common.conflict.discard")}
        </button>
      </div>
    </section>
  );
}

/** A record form in an accessible modal dialog. */
export function RecordDialog<R extends Record<string, unknown>>(
  props: RecordFormProps<R> & { title: string; description?: string | undefined },
) {
  const form = useRecordForm(props);
  const { t } = form;
  return (
    <Dialog
      title={props.title}
      onClose={() => props.onCancel?.()}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={props.onCancel} disabled={form.busy}>
            {t("common.action.cancel")}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void form.submit()}
            disabled={form.busy || form.conflict !== null}
          >
            {form.busy ? t("common.state.saving") : props.submitLabel}
          </button>
        </>
      }
    >
      {props.description ? <p>{props.description}</p> : null}
      <form
        ref={form.formRef}
        className="form form--dialog"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void form.submit();
        }}
      >
        <FormConflict form={form as FormState} fields={props.fields} />
        <RecordFields form={form as FormState} fields={props.fields} people={props.people} />
        {props.children}
      </form>
    </Dialog>
  );
}

/** A record form inline on the page (e.g. the charter). */
export function InlineRecordForm<R extends Record<string, unknown>>(
  props: RecordFormProps<R> & { sections?: readonly { title: string; fields: readonly string[]; intro?: string }[] },
) {
  const form = useRecordForm(props);
  const { t } = form;
  const byName = new Map(props.fields.map((f) => [f.name, f]));
  return (
    <form
      ref={form.formRef}
      className="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.submit();
      }}
    >
      <FormConflict form={form as FormState} fields={props.fields} />
      {props.sections ? (
        props.sections.map((s) => (
          <fieldset key={s.title} className="plain-fieldset form-section">
            <legend className="card__subtitle">{s.title}</legend>
            {s.intro ? <p className="muted">{s.intro}</p> : null}
            {s.fields.map((name) => {
              const spec = byName.get(name);
              return spec ? (
                <FieldControl key={name} spec={spec} form={form as FormState} people={props.people} />
              ) : null;
            })}
          </fieldset>
        ))
      ) : (
        <RecordFields form={form as FormState} fields={props.fields} people={props.people} />
      )}
      {props.sections ? <RecordFields form={form as FormState} fields={[]} people={props.people} /> : null}
      {props.children}
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={form.busy || form.conflict !== null}>
          {form.busy ? t("common.state.saving") : props.submitLabel}
        </button>
        {props.onCancel ? (
          <button type="button" className="button button--secondary" onClick={props.onCancel} disabled={form.busy}>
            {t("common.action.cancel")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
