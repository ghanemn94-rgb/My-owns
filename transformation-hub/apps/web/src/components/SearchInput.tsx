'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '@/i18n/provider';
import { cx, input } from './ui';

/** Debounced search box. `onChange` fires after the user pauses typing (or immediately on clear). */
export function SearchInput({
  value,
  onChange,
  label,
  placeholder,
  delay = 300,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  delay?: number;
  className?: string;
}) {
  const t = useT();
  const id = useId();
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const h = setTimeout(() => onChangeRef.current(draft.trim()), delay);
    return () => clearTimeout(h);
  }, [draft, value, delay]);

  return (
    <div className={cx('relative', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        id={id}
        type="text"
        role="searchbox"
        autoComplete="off"
        dir="auto"
        className={cx(input, 'ps-9 pe-9')}
        value={draft}
        placeholder={placeholder ?? label}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onChangeRef.current(draft.trim());
        }}
      />
      {draft ? (
        <button
          type="button"
          className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
          onClick={() => {
            setDraft('');
            onChangeRef.current('');
          }}
          aria-label={t('common.actions.clearSearch')}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
