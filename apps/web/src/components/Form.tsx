// Form building blocks: every control has a visible <label>, hints and errors are linked with aria-describedby, and
// invalid fields carry aria-invalid (REQ-S15-012). Validation runs the SHARED zod schemas (@mth/shared/schemas), the
// same ones the API uses, and messages are translated from their codes.
import { useCallback, useEffect, useId, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import type { FieldValues, Resolver } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { Icon } from "./Icon.tsx";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean;
  children: (control: FieldControlProps) => ReactElement;
}) {
  const { t } = useTranslation();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label htmlFor={id} className="field__label">
        {label}
        {required ? <span className="field__required"> ({t("common.form.required")})</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      ) : null}
      {children({
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(error ? { "aria-invalid": true } : {}),
        ...(required ? { "aria-required": true } : {}),
      })}
      {error ? (
        <p id={errorId} className="field__error">
          <Icon name="alert" /> {error}
        </p>
      ) : null}
    </div>
  );
}

/** Maps a zod issue to an i18n field-error code (the same codes the API returns in `errors[].code`). */
export function issueCode(issue: z.core.$ZodIssue): string {
  if (typeof issue.message === "string" && /^validation\.[a-z_.]+$/.test(issue.message)) return issue.message;
  switch (issue.code) {
    case "too_small":
      return issue.minimum === 1 ? "validation.required" : "validation.too_small";
    case "too_big":
      return "validation.too_big";
    case "invalid_format":
      return "validation.format";
    case "invalid_type":
      return "validation.required";
    case "invalid_value":
      return "validation.invalid_value";
    default:
      return "validation.invalid";
  }
}

/**
 * react-hook-form resolver that converts the form values to the API payload and validates THAT with a shared schema,
 * so the form accepts exactly what the API accepts. Errors carry i18n codes in `message`.
 */
export function payloadResolver<F extends FieldValues, P>(
  schema: z.ZodType<P>,
  toPayload: (values: F) => unknown,
): Resolver<F> {
  return async (values) => {
    const result = schema.safeParse(toPayload(values));
    if (result.success) return { values, errors: {} };
    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") || "root";
      if (!errors[path]) errors[path] = { type: issue.code, message: issueCode(issue) };
    }
    return { values: {}, errors: errors as never };
  };
}

/** Accessible modal dialog: labelled, focus moves in and returns to the opener, Escape closes. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    const first = ref.current?.querySelector<HTMLElement>("textarea, input, select, button");
    first?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && ref.current) {
        const focusable = [
          ...ref.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), textarea, input, select"),
        ];
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );
  return (
    <div className="dialog-backdrop">
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <div className="dialog__body">{children}</div>
        {footer ? <div className="dialog__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
