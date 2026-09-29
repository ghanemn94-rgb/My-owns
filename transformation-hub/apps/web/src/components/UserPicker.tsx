'use client';

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { portfolioRoutes } from '@hub/contracts';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useT } from '@/i18n/provider';
import { DemoBadge } from './DemoBadge';
import { cx, input, label as labelCls } from './ui';

export interface PickedUser {
  id: string;
  displayName: string;
  email: string;
}

/** Directory search (name/email only) as an accessible combobox. */
export function UserPicker({
  label,
  value,
  onChange,
  required = false,
  invalid = false,
  describedBy,
}: {
  label: string;
  value: PickedUser | null;
  onChange: (u: PickedUser | null) => void;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useT();
  const id = useId();
  const listId = useId();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(h);
  }, [text]);

  const q = useQuery({
    queryKey: qk.directory(debounced),
    queryFn: ({ signal }) => api(portfolioRoutes.directory, { query: { q: debounced }, signal }),
    enabled: open && debounced.length >= 2,
  });
  const items = q.data?.items ?? [];

  const pick = (u: PickedUser) => {
    onChange({ id: u.id, displayName: u.displayName, email: u.email });
    setText('');
    setOpen(false);
  };

  if (value) {
    return (
      <div>
        <span className={labelCls}>{label}</span>
        <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-line-strong bg-surface-muted px-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="font-medium" dir="auto">
              {value.displayName}
            </span>{' '}
            <span className="text-muted" dir="ltr">
              {value.email}
            </span>
          </span>
          <button type="button" className="rounded p-1 text-muted hover:text-ink" onClick={() => onChange(null)} aria-label={t('common.userPicker.change')}>
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={id} className={labelCls}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        dir="auto"
        autoComplete="off"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        aria-required={required}
        aria-describedby={describedBy}
        className={cx(input, 'mt-1')}
        placeholder={t('common.userPicker.placeholder')}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, Math.max(items.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && items[active]) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === 'Escape' && open && text.trim().length > 0) {
            // Close only the suggestion list, not the surrounding dialog.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && debounced.length >= 2 ? (
        <div className="mt-1 rounded-md border border-line bg-surface shadow-sm">
          {q.isLoading ? (
            <p className="px-3 py-2 text-sm text-muted">{t('states.loading')}</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">{t('common.userPicker.noResults')}</p>
          ) : (
            <ul id={listId} role="listbox" aria-label={label} className="max-h-60 overflow-y-auto py-1">
              {items.map((u, i) => (
                <li
                  key={u.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={cx('flex cursor-pointer items-center gap-2 px-3 py-2 text-sm', i === active && 'bg-primary-soft')}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(u);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium" dir="auto">
                      {u.displayName}
                    </span>
                    <span className="block text-xs text-muted" dir="ltr">
                      {u.email}
                      {u.title ? ` · ${u.title}` : ''}
                    </span>
                  </span>
                  {u.isDemo ? <DemoBadge /> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : open && text.trim().length > 0 && text.trim().length < 2 ? (
        <p className="mt-1 text-xs text-muted">{t('common.userPicker.minChars')}</p>
      ) : null}
    </div>
  );
}
