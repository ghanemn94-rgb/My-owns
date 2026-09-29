'use client';

import { BadgeCheck, CircleHelp, CircleX, History, Lightbulb, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { VerificationStatus } from '@hub/domain';
import { useI18n } from '@/i18n/provider';
import { cx } from './ui';

const STYLE: Record<VerificationStatus, { icon: LucideIcon; cls: string }> = {
  confirmed: { icon: BadgeCheck, cls: 'bg-success-soft text-success border-success/30' },
  historical_unverified: { icon: History, cls: 'bg-warning-soft text-warning border-warning/30' },
  proposed: { icon: Lightbulb, cls: 'bg-info-soft text-info border-info/30' },
  assumed: { icon: TriangleAlert, cls: 'bg-warning-soft text-warning border-warning/30' },
  conflicting: { icon: CircleX, cls: 'bg-danger-soft text-danger border-danger/30' },
  unknown: { icon: CircleHelp, cls: 'bg-neutral-soft text-neutral border-neutral/25' },
};

/** Verification status of a fact (Confirmed / Historical-unverified / Proposed / Assumed / Conflicting / Unknown). */
export function VerificationBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  const { t, tStatus } = useI18n();
  const key = (value && value in STYLE ? value : 'unknown') as VerificationStatus;
  const { icon: Icon, cls } = STYLE[key];
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium', cls, className)}
      data-verification={key}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">{t('common.verification')}: </span>
      {tStatus('verificationStatuses', value ?? 'unknown')}
    </span>
  );
}
