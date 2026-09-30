'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CircleCheck, CircleX, FileText, ShieldAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { SelectField } from '@/components/Field';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { useServerMessages } from '@/lib/i18n-data';
import { jvHref, useDecisionOptions, useJvDocuments, type Condition, type EventBlocker, type People, type TxEventDetail } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';

// Generic list/command helpers are shared with the Committee Hub (same URL state, filter bar and 403-reason dialog).
export { FilterBar, FilterSelect, GovCommandDialog as JvCommandDialog, Facts, Section, UText, Money, ButtonRow, useUrlState } from '../../committee/_components/gov';

type TabKey = 'overview' | 'partners' | 'proposals' | 'scenarios' | 'negotiation' | 'rooms' | 'diligence' | 'closing' | 'funds' | 'obligations';

const TABS: readonly { key: TabKey; segment: string; permissions: readonly string[] }[] = [
  { key: 'overview', segment: '', permissions: [] },
  { key: 'partners', segment: '/partners', permissions: ['jv.partner.read'] },
  { key: 'proposals', segment: '/proposals', permissions: ['jv.deal.read'] },
  { key: 'scenarios', segment: '/scenarios', permissions: ['jv.deal.read'] },
  { key: 'negotiation', segment: '/negotiation', permissions: ['jv.deal.read'] },
  { key: 'rooms', segment: '/rooms', permissions: ['jv.room.read'] },
  { key: 'diligence', segment: '/diligence', permissions: ['jv.dd_request.read'] },
  { key: 'closing', segment: '/closing', permissions: ['jv.deal.read'] },
  { key: 'funds', segment: '/funds-flow', permissions: ['jv.deal.read'] },
  { key: 'obligations', segment: '/obligations', permissions: ['jv.deal.read'] },
];

/** Sub-navigation of the JV & Diligence section; tabs the caller has no read permission for are not offered. */
export function JvTabs() {
  const { t } = useI18n();
  const { projectId, can } = useProjectContext();
  const pathname = usePathname() ?? '';
  const base = jvHref(projectId);
  const active = (segment: string) => (segment === '' ? pathname === base : pathname === `${base}${segment}` || pathname.startsWith(`${base}${segment}/`));
  return (
    <nav aria-label={t('jv.tabs.label')} className="mb-5 overflow-x-auto border-b border-line" data-testid="jv-tabs">
      <ul className="flex min-w-max gap-1">
        {TABS.filter((tab) => tab.permissions.length === 0 || can(tab.permissions)).map((tab) => {
          const on = active(tab.segment);
          return (
            <li key={tab.key}>
              <Link
                href={`${base}${tab.segment}`}
                aria-current={on ? 'page' : undefined}
                data-tab={tab.key}
                className={cx('inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-medium', on ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}
              >
                {t(`jv.tabs.${tab.key}`)}
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
  if (id === me.user.id) return <span className="font-medium">{t('jv.common.you')}</span>;
  const name = people?.[id];
  return name ? <span dir="auto">{name}</span> : <span dir="ltr">{t('jv.common.unknownUser', { id: id.slice(-6) })}</span>;
}

export function Panel({ title, children, className, testId, actions, description }: { title: string; children: ReactNode; className?: string; testId?: string; actions?: ReactNode; description?: ReactNode }) {
  return (
    <section className={cx(card, 'p-4', className)} data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Callout({ tone = 'info', children, testId, className }: { tone?: 'info' | 'danger' | 'warning' | 'success'; children: ReactNode; testId?: string; className?: string }) {
  const cls =
    tone === 'danger' ? 'border-danger/40 bg-danger-soft' : tone === 'warning' ? 'border-warning/40 bg-warning-soft' : tone === 'success' ? 'border-success/30 bg-success-soft' : 'border-info/30 bg-info-soft';
  return (
    <div role="note" className={cx('flex items-start gap-2 rounded-md border p-3 text-sm text-ink', cls, className)} data-testid={testId}>
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Short action button used in command rows. */
export function CmdButton({ label, onClick, testId, variant = 'secondary', disabled = false, describedBy }: { label: string; onClick: () => void; testId?: string; variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; describedBy?: string }) {
  return (
    <button type="button" className={variant === 'primary' ? btn.primary : variant === 'danger' ? btn.danger : btn.secondary} onClick={onClick} data-testid={testId} disabled={disabled} aria-describedby={describedBy}>
      {label}
    </button>
  );
}

/** Pass/fail line (text + icon, never colour alone). */
export function Tick({ ok, label, testId }: { ok: boolean; label: ReactNode; testId?: string }) {
  const { t } = useI18n();
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <li className="flex items-start gap-2 text-sm" data-testid={testId} data-ok={ok ? 'true' : 'false'}>
      <Icon aria-hidden="true" className={cx('mt-0.5 size-4 shrink-0', ok ? 'text-success' : 'text-danger')} />
      <span className="min-w-0 text-ink">{label}</span>
      <span className={cx('ms-auto shrink-0 text-xs font-medium', ok ? 'text-success' : 'text-danger')}>{ok ? t('jv.common.met') : t('jv.common.notMet')}</span>
    </li>
  );
}

/** Labelled boolean shown as text + icon (e.g. "Blocking", "Not waivable"). */
export function Flag({ on, onLabel, offLabel, danger = false, testId }: { on: boolean; onLabel: string; offLabel: string; danger?: boolean; testId?: string }) {
  return (
    <span data-testid={testId} data-on={on ? 'true' : 'false'}>
      <StatusBadge enumName="conditionStatuses" value={on ? 'on' : 'off'} tone={on ? (danger ? 'danger' : 'warning') : 'neutral'} label={on ? onLabel : offLabel} />
    </span>
  );
}

/**
 * Live blockers of a signing / closing (server evaluation — the same rule the confirm command enforces). Messages are
 * server codes translated in the active language; each blocker names the CP / checklist item / signing it concerns.
 */
export function BlockerList({ blockers, testId = 'event-blockers' }: { blockers: readonly EventBlocker[]; testId?: string }) {
  const { t } = useI18n();
  const render = useServerMessages();
  return (
    <ul className="space-y-1.5" data-testid={testId}>
      {blockers.map((b, i) => (
        <li key={`${b.kind}-${b.ref}-${i}`} className="flex items-start gap-2 text-sm" data-kind={b.kind} data-ref={b.ref}>
          <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          <span className="min-w-0">
            <span className="me-1 text-xs font-semibold text-muted">{t(`jv.blockerKinds.${b.kind}`)}</span>
            <span dir="auto" className="text-ink">
              {render(b.messageI18n, b.message)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Blockers carried by a 422 refusal (`details.blockers`), when the server sent them. */
export function blockersOf(error: unknown): EventBlocker[] {
  const details = (error as { details?: { blockers?: unknown } } | null)?.details;
  return Array.isArray(details?.blockers) ? (details!.blockers as EventBlocker[]) : [];
}

/** A linked governance decision: code, status and whether it authorizes the action (issue translated from its code). */
export type LinkedDecisionSummary = NonNullable<TxEventDetail['decision']>;

export function LinkedDecision({ d, testId }: { d: LinkedDecisionSummary | null; testId?: string }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  if (!d) return <span className="text-muted" data-testid={testId}>{t('jv.common.noDecision')}</span>;
  return (
    <span className="flex flex-col gap-1" data-testid={testId} data-authorizes={d.issueCode ? 'false' : 'true'}>
      <span className="flex flex-wrap items-center gap-2">
        <Link className={btn.link} href={`/projects/${projectId}/committee/decisions/${d.id}`} dir="ltr">
          {d.code}
        </Link>
        <StatusBadge enumName="decisionStatuses" value={d.status} />
      </span>
      {d.issueCode ? (
        <span className="text-xs text-danger">{t(`jv.common.decisionIssue.${d.issueCode}` as MessageKey, { status: tStatus('decisionStatuses', d.status) })}</span>
      ) : (
        <span className="text-xs text-success">{t('jv.common.decisionFinal')}</span>
      )}
    </span>
  );
}

/** Governance decisions of the accepted types (governance owns them; the server re-validates type and final approval). */
export function DecisionSelect({ typeKeys, value, onChange, testId = 'decision-select', required = true }: { typeKeys: readonly string[] | null; value: string; onChange: (id: string) => void; testId?: string; required?: boolean }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const decisions = useDecisionOptions(typeKeys);
  return (
    <div className="space-y-2">
      <SelectField label={t('jv.common.decision')} required={required} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        <option value="">{required ? t('jv.common.select') : t('jv.common.none')}</option>
        {decisions.items.map((d) => (
          <option key={d.id} value={d.id}>
            {d.code} — {d.title} ({tStatus('decisionStatuses', d.status)})
          </option>
        ))}
      </SelectField>
      {decisions.data && decisions.items.length === 0 ? (
        <p className="text-sm text-muted">
          {t('jv.common.noDecisionAvailable')}{' '}
          <Link className={btn.link} href={`/projects/${projectId}/committee/decisions`}>
            {t('jv.common.openCommittee')}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Pick a document visible to the caller (the documents module owns them). `roomId` restricts the choice to documents
 * filed in that room; the server re-checks visibility, room filing and version usability.
 */
export function DocumentPicker({ value, onChange, roomId, label, required = false, testId = 'document-picker', selected }: { value: string; onChange: (id: string) => void; roomId?: string | null; label: string; required?: boolean; testId?: string; /** Multi-select: the ids currently chosen (each click toggles one). */ selected?: readonly string[] }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const docs = useJvDocuments(q, true);
  const items = (docs.data?.items ?? []).filter((d) => (roomId === undefined ? true : d.roomId === roomId) && d.currentVersion);
  return (
    <fieldset className="space-y-2" data-testid={testId}>
      <legend className="text-sm font-medium text-ink">
        {label}
        {required ? <span className="text-danger"> *</span> : <span className="font-normal text-muted"> ({t('common.optional')})</span>}
      </legend>
      <SearchInput label={t('jv.common.searchDocuments')} value={q} onChange={setQ} />
      <ul className="max-h-44 overflow-y-auto rounded-md border border-line" aria-label={label}>
        {docs.isLoading ? <li className="px-3 py-2 text-sm text-muted">{t('states.loading')}</li> : null}
        {!docs.isLoading && items.length === 0 ? <li className="px-3 py-2 text-sm text-muted">{t('jv.common.noDocuments')}</li> : null}
        {items.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              aria-pressed={selected ? selected.includes(d.id) : value === d.id}
              data-document-title={d.title}
              className={cx('flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-surface-muted', (selected ? selected.includes(d.id) : value === d.id) && 'bg-primary-soft font-semibold text-primary')}
              onClick={() => onChange(selected ? d.id : value === d.id ? '' : d.id)}
            >
              <FileText aria-hidden="true" className="size-4 shrink-0 text-muted" />
              <span dir="auto" className="min-w-0 truncate">
                {d.title}
              </span>
              <span className="ms-auto shrink-0 text-xs text-muted">{t('jv.common.versionShort', { version: d.currentVersion?.versionNo ?? 0 })}</span>
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** Link to a document of the Document & Evidence Center (the API decides whether it can be opened). */
export function DocumentLink({ id, label }: { id: string | null | undefined; label?: string }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  if (!id) return <span className="text-muted">{EM_DASH}</span>;
  return (
    <Link className={btn.link} href={`/projects/${projectId}/documents/${id}`}>
      {label ?? t('jv.common.openDocument', { id: id.slice(-6) })}
    </Link>
  );
}

/** Record-only statement for anything touching money (REQ-JV-015): the platform never pays. */
export function RecordOnlyNotice({ testId = 'record-only' }: { testId?: string }) {
  const { t } = useI18n();
  return (
    <Callout tone="warning" testId={testId}>
      {t('jv.funds.recordOnly')}
    </Callout>
  );
}

export function NdaNoAccessNotice({ testId = 'nda-no-access' }: { testId?: string }) {
  const { t } = useI18n();
  return (
    <Callout tone="info" testId={testId}>
      {t('jv.partners.ndaNoAccess')}
    </Callout>
  );
}

/** Waivability of a CP: waivable (with its authority) / not waivable (specialist determination) / not yet determined. */
export function WaivabilityBadge({ c }: { c: Pick<Condition, 'waivable' | 'waivabilityDeterminedBy'> }) {
  const { t } = useI18n();
  if (c.waivable) return <Flag on onLabel={t('jv.cp.waivable')} offLabel={t('jv.cp.waivable')} testId="cp-waivable" />;
  return <Flag on danger onLabel={c.waivabilityDeterminedBy ? t('jv.cp.nonWaivable') : t('jv.cp.notDetermined')} offLabel="" testId="cp-non-waivable" />;
}

