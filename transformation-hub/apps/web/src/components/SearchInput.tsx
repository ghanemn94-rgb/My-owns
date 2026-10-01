'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '@/i18n/provider';
import { cx, input } from './ui';

/**
 * True when a click follows a same-origin link to another URL in this tab (a navigation the app router will perform).
 * Modified clicks (new tab / window / download) and links to the current URL are not navigations of this page.
 */
function isNavigationClick(e: MouseEvent): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== '_self') || a.hasAttribute('download')) return false;
  const url = new URL(a.href, window.location.href);
  return url.origin === window.location.origin && url.pathname + url.search !== window.location.pathname + window.location.search;
}

/**
 * Debounced search box. `onChange` fires after the user pauses typing (or immediately on Enter / clear).
 * QA-P34-07: a navigation the user starts while the update is pending wins. The pending update is cancelled when a link
 * to another URL is followed (e.g. a row of the filtered list) or the history is traversed — otherwise the debounced
 * `router.replace` of the list, dispatched after the navigation, would supersede it (Next applies the latest navigation)
 * and leave the user on the list.
 */
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
    const h = window.setTimeout(() => onChangeRef.current(draft.trim()), delay);
    const cancel = () => window.clearTimeout(h);
    const onClick = (e: MouseEvent) => {
      if (isNavigationClick(e)) cancel();
    };
    // Capture phase: runs before the link's own handler starts the navigation.
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', cancel);
    return () => {
      cancel();
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', cancel);
    };
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
