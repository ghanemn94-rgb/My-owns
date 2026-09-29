'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, LogOut, User } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { identityRoutes, type Me } from '@hub/contracts';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n/provider';
import { DemoBadge } from './DemoBadge';
import { cx } from './ui';

export function UserMenu({ me }: { me: Me }) {
  const { t, tStatus } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const logout = async () => {
    setBusy(true);
    try {
      await api(identityRoutes.logout);
    } catch {
      /* the session may already be gone; continue to the login page either way */
    }
    queryClient.clear();
    window.location.assign('/login');
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-10 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted"
        data-testid="user-menu"
      >
        <User aria-hidden="true" className="size-4" />
        <span className="max-w-40 truncate" dir="auto">
          {me.user.displayName}
        </span>
        <ChevronDown aria-hidden="true" className="size-4" />
      </button>
      {open ? (
        <div id={menuId} className="absolute end-0 z-30 mt-1 w-72 rounded-lg border border-line bg-surface p-3 shadow-lg">
          <p className="font-medium text-ink" dir="auto">
            {me.user.displayName}
          </p>
          <p className="text-sm text-muted" dir="ltr">
            {me.user.email}
          </p>
          <p className="mt-2 text-xs text-muted" dir="auto">
            {me.org.name}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {me.user.isDemo ? <DemoBadge /> : null}
            {me.orgRoles.map((r) => (
              <span key={r} className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-ink">
                {tStatus('roleKeys', r)}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {t('common.user.clearance')}: {tStatus('classifications', me.user.clearance)}
          </p>
          <button
            type="button"
            onClick={logout}
            disabled={busy}
            className={cx('mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm font-medium hover:bg-surface-muted')}
            data-testid="logout"
          >
            <LogOut aria-hidden="true" className="size-4 rtl:-scale-x-100" />
            {t('common.actions.signOut')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
