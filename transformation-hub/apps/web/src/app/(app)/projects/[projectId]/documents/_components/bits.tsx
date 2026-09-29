'use client';

import { Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/StatusBadge';
import { cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { type UploadPolicy } from '@/lib/documents';

/** Honest statement of what "scanned" means in this deployment (ADR-0010). */
export function ScanNotice({ policy, className }: { policy: UploadPolicy | undefined; className?: string }) {
  const { t } = useI18n();
  if (!policy) return null;
  if (policy.scanner.enterprise) {
    return (
      <p className={cx('flex items-start gap-2 text-sm text-muted', className)}>
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
        {t('documents.scan.enterprise', { engine: policy.scanner.engine })}
      </p>
    );
  }
  return (
    <p role="note" className={cx('flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink', className)} data-testid="scan-notice">
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>
        {t('documents.scan.notice')} {policy.allowUnscanned ? null : t('documents.scan.noticeBlocked')}
        {policy.storageStatus === 'not_configured' ? ` ${t('documents.scan.storageNotConfigured')}` : null}
      </span>
    </p>
  );
}

/** Search snippet: the server marks hits with «…»; render them as <mark> (text only, never HTML). */
export function Snippet({ text }: { text: string | null }) {
  if (!text) return null;
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <span dir="auto" className="text-sm text-muted">
      {parts.map((p, i) =>
        p.startsWith('«') && p.endsWith('»') ? (
          <mark key={i} className="rounded bg-warning-soft px-0.5 text-ink">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

export function ClassificationBadge({ value }: { value: string }) {
  const tone = value === 'restricted' || value === 'strictly_confidential' ? 'danger' : value === 'confidential' ? 'warning' : 'neutral';
  return <StatusBadge enumName="classifications" value={value} tone={tone} />;
}

export function RoomBadge({ roomId }: { roomId: string | null }) {
  const { t } = useI18n();
  if (!roomId) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-info/30 bg-info-soft px-2 py-0.5 text-xs font-medium text-info" title={roomId}>
      <Lock aria-hidden="true" className="size-3.5" />
      {t('documents.list.room')}
    </span>
  );
}

export function HoldBadge() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger" data-testid="legal-hold-badge">
      <ShieldAlert aria-hidden="true" className="size-3.5" />
      {t('documents.list.legalHold')}
    </span>
  );
}

/** Accessible tab strip (buttons with aria-selected; content rendered by the caller). */
export function Tabs<K extends string>({ tabs, value, onChange, label }: { tabs: { key: K; label: string; icon?: ReactNode }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === value}
          className={cx(
            '-mb-px inline-flex min-h-10 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium',
            tab.key === value ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink',
          )}
          onClick={() => onChange(tab.key)}
          data-testid={`tab-${tab.key}`}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

