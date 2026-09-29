'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useT } from '@/i18n/provider';
import { cx, hint as hintCls, input, label as labelCls } from './ui';

interface FieldChrome {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
}

function Chrome({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldChrome & { id: string; children: ReactNode }) {
  const t = useT();
  return (
    <div className={className}>
      <label htmlFor={id} className={labelCls}>
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {' '}
            *
          </span>
        ) : (
          <span className="font-normal text-muted"> ({t('common.optional')})</span>
        )}
      </label>
      <div className="mt-1">{children}</div>
      {hint ? (
        <p id={`${id}-hint`} className={hintCls}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

export function TextField({
  label,
  hint,
  error,
  required,
  className,
  ...rest
}: FieldChrome & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  const id = useId();
  return (
    <Chrome id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <input
        id={id}
        dir="auto"
        className={input}
        aria-invalid={Boolean(error)}
        aria-required={required}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
    </Chrome>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  required,
  className,
  ...rest
}: FieldChrome & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>) {
  const id = useId();
  return (
    <Chrome id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <textarea
        id={id}
        dir="auto"
        rows={4}
        className={input}
        aria-invalid={Boolean(error)}
        aria-required={required}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
    </Chrome>
  );
}

export function SelectField({
  label,
  hint,
  error,
  required,
  className,
  children,
  ...rest
}: FieldChrome & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>) {
  const id = useId();
  return (
    <Chrome id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <select
        id={id}
        className={cx(input, 'pe-8')}
        aria-invalid={Boolean(error)}
        aria-required={required}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      >
        {children}
      </select>
    </Chrome>
  );
}
