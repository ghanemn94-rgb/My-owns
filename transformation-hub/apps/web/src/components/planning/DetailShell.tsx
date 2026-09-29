'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { btn, cx } from '../ui';

/** Back link used by planning detail pages (the list keeps its own filters in the URL / state). */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={cx(btn.link, 'mb-3 inline-flex items-center gap-1 text-sm')}>
      <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
      {label}
    </Link>
  );
}

export function Notice({ tone, children }: { tone: 'info' | 'danger' | 'warning'; children: ReactNode }) {
  const cls = tone === 'danger' ? 'border-danger/30 bg-danger-soft text-danger' : tone === 'warning' ? 'border-warning/30 bg-warning-soft text-warning' : 'border-info/30 bg-info-soft text-info';
  return (
    <p className={cx('mb-4 rounded-md border p-3 text-sm', cls)} role="note">
      {children}
    </p>
  );
}
