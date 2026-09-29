'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../ui';

export interface TabDef<K extends string> {
  key: K;
  label: string;
  badge?: ReactNode;
}

/** Selected tab synced to `?tab=` so screens are linkable (metrics and inbox items deep-link into a tab). */
export function useTabParam<K extends string>(keys: readonly K[], fallback: K, param = 'tab'): [K, (k: K) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = sp.get(param) as K | null;
  const current = raw && keys.includes(raw) ? raw : fallback;
  const set = (k: K) => {
    const next = new URLSearchParams(sp.toString());
    next.set(param, k);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return [current, set];
}

/** WAI-ARIA tabs (roving tabindex, arrow keys mirror in RTL via logical order). */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
  children,
  testId,
}: {
  tabs: TabDef<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const rtl = document.documentElement.dir === 'rtl';
    let n = i;
    if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) n = (i + 1) % tabs.length;
    else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    else return;
    e.preventDefault();
    const k = tabs[n]!.key;
    onChange(k);
    refs.current[k]?.focus();
  };
  return (
    <div data-testid={testId}>
      <div role="tablist" aria-label={label} className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((tab, i) => {
          const selected = tab.key === value;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                refs.current[tab.key] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              data-tab={tab.key}
              onClick={() => onChange(tab.key)}
              onKeyDown={(e) => onKey(e, i)}
              className={cx(
                '-mb-px inline-flex min-h-10 shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
                selected ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {tab.label}
              {tab.badge}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} tabIndex={0} className="focus:outline-none">
        {children}
      </div>
    </div>
  );
}
