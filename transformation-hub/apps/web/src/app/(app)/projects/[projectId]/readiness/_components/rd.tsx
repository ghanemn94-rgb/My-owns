'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CircleCheck, CircleX, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { SelectField } from '@/components/Field';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { rdHref, useDecisionsOfTypes, useSites, type People } from '@/lib/readiness';
import { useWorkstreams } from '@/lib/queries';

// Generic list/command helpers are shared with the Committee Hub (same URL state, filter bar and 403-reason dialog).
export { FilterBar, FilterSelect, GovCommandDialog as RdCommandDialog, Facts, Section, UText, Money, ButtonRow, useUrlState } from '../../committee/_components/gov';

const TABS = [
  { key: 'overview', segment: '' },
  { key: 'checks', segment: '/checks' },
  { key: 'cutover', segment: '/cutover' },
  { key: 'tsa', segment: '/tsa' },
  { key: 'waivers', segment: '/waivers' },
] as const;

export function ReadinessTabs() {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const pathname = usePathname() ?? '';
  const base = rdHref(projectId);
  const active = (segment: string) => (segment === '' ? pathname === base : pathname === `${base}${segment}` || pathname.startsWith(`${base}${segment}/`));
  return (
    <nav aria-label={t('readiness.tabs.label')} className="mb-5 overflow-x-auto border-b border-line" data-testid="readiness-tabs">
      <ul className="flex min-w-max gap-1">
        {TABS.map((tab) => {
          const on = active(tab.segment);
          return (
            <li key={tab.key}>
              <Link
                href={`${base}${tab.segment}`}
                aria-current={on ? 'page' : undefined}
                className={cx('inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-medium', on ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}
              >
                {t(`readiness.tabs.${tab.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A user referenced by a record: "You", the display name the server resolved, or a short id — never a guess. */
export function Person({ id, people }: { id: string | null | undefined; people: People | undefined }) {
  const { t } = useI18n();
  const { me } = useProjectContext();
  if (!id) return <span className="text-muted">{EM_DASH}</span>;
  if (id === me.user.id) return <span className="font-medium">{t('readiness.common.you')}</span>;
  const name = people?.[id];
  return name ? <span dir="auto">{name}</span> : <span dir="ltr">{t('readiness.common.unknownUser', { id: id.slice(-6) })}</span>;
}

/** Site / workstream / plan labels for a record's scope. */
export function useScopeLabels() {
  const { t } = useI18n();
  const sites = useSites();
  const ws = useWorkstreams(useProjectContext().projectId);
  const siteName = (id: string | null | undefined) => {
    if (!id) return null;
    const s = sites.data?.items.find((x) => x.id === id);
    return s ? `${s.code} — ${s.name}` : `#${id.slice(-6)}`;
  };
  const wsName = (id: string | null | undefined) => {
    if (!id) return null;
    const w = ws.data?.items.find((x) => x.id === id);
    return w ? `${w.code} — ${w.name}` : `#${id.slice(-6)}`;
  };
  return { sites: sites.data?.items ?? [], workstreams: ws.data?.items ?? [], siteName, wsName, projectLevel: t('readiness.common.projectLevel') };
}

export function CriticalityBadges({ mandatory, blocker, waivable }: { mandatory: boolean; blocker: boolean; waivable?: boolean }) {
  const { t } = useI18n();
  return (
    <span className="flex flex-wrap gap-1">
      {blocker ? <StatusBadge enumName="readinessStatuses" value="blocked" tone="danger" label={t('readiness.checks.blocker')} /> : null}
      <StatusBadge enumName="readinessStatuses" value={mandatory ? 'mandatory' : 'optional'} tone={mandatory ? 'warning' : 'neutral'} label={mandatory ? t('readiness.checks.mandatory') : t('readiness.checks.optional')} />
      {waivable !== undefined ? (
        <StatusBadge enumName="readinessStatuses" value={waivable ? 'waivable' : 'non_waivable'} tone="neutral" label={waivable ? t('readiness.checks.waivable') : t('readiness.checks.nonWaivable')} />
      ) : null}
    </span>
  );
}

/** Pass/fail line used by the prerequisite checklist (text + icon, never colour alone). */
/**
 * Whether a linked governance decision authorizes the action, in the user's language (the server's issue code is
 * translated; `okKey` names what a final approval can back).
 */
export function DecisionIssue({ d, okKey }: { d: { status: string; issueCode: string | null }; okKey: MessageKey }) {
  const { t, tStatus } = useI18n();
  if (!d.issueCode) return <span className="text-success">{t(okKey)}</span>;
  return <span className="text-danger">{t(`readiness.common.decisionIssue.${d.issueCode}` as MessageKey, { status: tStatus('decisionStatuses', d.status) })}</span>;
}

export function Tick({ ok, label, testId }: { ok: boolean; label: string; testId?: string }) {
  const { t } = useI18n();
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <li className="flex items-start gap-2 text-sm" data-testid={testId} data-ok={ok ? 'true' : 'false'}>
      <Icon aria-hidden="true" className={cx('mt-0.5 size-4 shrink-0', ok ? 'text-success' : 'text-danger')} />
      <span className="text-ink">{label}</span>
      <span className={cx('ms-auto text-xs font-medium', ok ? 'text-success' : 'text-danger')}>{ok ? t('readiness.plan.prereq.met') : t('readiness.plan.prereq.missing')}</span>
    </li>
  );
}

export function Callout({ tone = 'info', children, testId }: { tone?: 'info' | 'danger' | 'warning'; children: ReactNode; testId?: string }) {
  const cls = tone === 'danger' ? 'border-danger/40 bg-danger-soft' : tone === 'warning' ? 'border-warning/40 bg-warning-soft' : 'border-info/30 bg-info-soft';
  return (
    <p role="note" className={cx('flex items-start gap-2 rounded-md border p-3 text-sm text-ink', cls)} data-testid={testId}>
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Governance decisions of the accepted types (governance owns them; the server re-validates type and project). */
export function DecisionSelect({ typeKeys, value, onChange, open }: { typeKeys: readonly string[]; value: string; onChange: (id: string) => void; open: boolean }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const decisions = useDecisionsOfTypes(typeKeys, open);
  return (
    <div className="space-y-2">
      <SelectField label={t('readiness.common.decisionPicker')} required value={value} onChange={(e) => onChange(e.target.value)} data-testid="decision-select">
        <option value="">{t('readiness.common.select')}</option>
        {decisions.items.map((d) => (
          <option key={d.id} value={d.id}>
            {d.code} — {d.title} ({tStatus('decisionStatuses', d.status)})
          </option>
        ))}
      </SelectField>
      {decisions.data && decisions.items.length === 0 ? (
        <p className="text-sm text-muted">
          {t('readiness.common.decisionNoneAvailable')}{' '}
          <Link className={btn.link} href={`/projects/${projectId}/committee/decisions`}>
            {t('readiness.common.openCommittee')}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export function Panel({ title, children, className, testId, actions }: { title: string; children: ReactNode; className?: string; testId?: string; actions?: ReactNode }) {
  return (
    <section className={cx(card, 'p-4', className)} data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Short action button used in command rows. */
export function CmdButton({ label, onClick, testId, variant = 'secondary' }: { label: string; onClick: () => void; testId?: string; variant?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <button type="button" className={variant === 'primary' ? btn.primary : variant === 'danger' ? btn.danger : btn.secondary} onClick={onClick} data-testid={testId}>
      {label}
    </button>
  );
}
