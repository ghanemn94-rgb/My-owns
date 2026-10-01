'use client';

import Link from 'next/link';
import { Bot, CircleAlert, FlaskConical, OctagonX, RefreshCw, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { DemoBadge } from '@/components/DemoBadge';
import { StatusBadge, type Tone } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { useLocalized } from '@/lib/i18n-data';
import { isApiError } from '@/lib/api';
import { citationHref, type AiCitation, type People } from '@/lib/ai';
import { useProjectContext } from '@/lib/project-context';

// ---------------------------------------------------------------------------------------------------------------
// Layout helpers

export function Panel({ title, children, className, testId, actions, description, id }: { title: string; children: ReactNode; className?: string; testId?: string; actions?: ReactNode; description?: ReactNode; id?: string }) {
  return (
    <section className={cx(card, 'p-4', className)} data-testid={testId} aria-labelledby={id ? `${id}-title` : undefined} id={id}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="text-lg font-semibold text-ink">
            {title}
          </h2>
          {description ? <div className="mt-0.5 text-sm text-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Callout({ tone = 'info', children, testId, className, icon }: { tone?: 'info' | 'danger' | 'warning' | 'success'; children: ReactNode; testId?: string; className?: string; icon?: 'shield' | 'stop' | 'alert' }) {
  const cls =
    tone === 'danger' ? 'border-danger/40 bg-danger-soft' : tone === 'warning' ? 'border-warning/40 bg-warning-soft' : tone === 'success' ? 'border-success/30 bg-success-soft' : 'border-info/30 bg-info-soft';
  const Icon = icon === 'stop' ? OctagonX : icon === 'alert' ? CircleAlert : ShieldAlert;
  return (
    <div role="note" className={cx('flex items-start gap-2 rounded-md border p-3 text-sm text-ink', cls, className)} data-testid={testId}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

export function Facts({ items, testId }: { items: { label: string; value: ReactNode; wide?: boolean; testId?: string }[]; testId?: string }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2" data-testid={testId}>
      {items.map((i) => (
        <div key={i.label} className={i.wide ? 'sm:col-span-2' : undefined} data-testid={i.testId}>
          <dt className="text-sm text-muted">{i.label}</dt>
          <dd className="text-sm break-words text-ink">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Text entered by people or produced by the server: direction follows the content; empty renders an em dash. */
export function UText({ value, multiline = false, className }: { value: string | null | undefined; multiline?: boolean; className?: string }) {
  if (!value) return <span className="text-muted">{EM_DASH}</span>;
  return (
    <span dir="auto" className={cx(multiline ? 'whitespace-pre-wrap' : undefined, className)}>
      {value}
    </span>
  );
}

/** A technical identifier (run id, hash, cron): always left-to-right, monospace. */
export function Code({ children, testId, title }: { children: ReactNode; testId?: string; title?: string }) {
  return (
    <code dir="ltr" className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs break-all" data-testid={testId} title={title}>
      {children}
    </code>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Honesty labels

/** "Simulated" — text + icon, never colour alone. Shown wherever output of the mock provider appears. */
export function SimulatedBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning-soft px-1.5 py-0.5 text-xs font-semibold text-warning', className)}
      data-testid="simulated-badge"
      title={t('ai.common.simulatedLong')}
    >
      <FlaskConical aria-hidden="true" className="size-3.5" />
      {t('ai.common.simulated')}
    </span>
  );
}

/** Badge + plain sentence: "Mock provider — simulated output, not an AI model". */
export function SimulatedNotice({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <p className={cx('flex flex-wrap items-center gap-2 text-sm text-ink', className)} data-testid="simulated-notice">
      <SimulatedBadge />
      <span>{t('ai.common.simulatedLong')}</span>
    </p>
  );
}

const PROVIDER_STATUS_TONE: Record<string, Tone> = {
  off: 'neutral',
  simulated: 'warning',
  not_configured: 'neutral',
  configured_unverified: 'warning',
  egress_not_approved: 'danger',
  disabled_by_config: 'neutral',
};

/** A provider/endpoint status exactly as the API reported it (there is no "connected" state). */
export function ProviderStatusBadge({ status, testId }: { status: string; testId?: string }) {
  const { t } = useI18n();
  return (
    <span data-testid={testId} data-provider-status={status}>
      <StatusBadge enumName="aiProviders" value={status} tone={PROVIDER_STATUS_TONE[status] ?? 'neutral'} label={t(`ai.providerStatus.${status}` as MessageKey)} />
    </span>
  );
}

export function ModeBadge({ mode, testId, size }: { mode: string; testId?: string; size?: 'sm' | 'md' }) {
  const tone: Tone = mode === 'off' ? 'neutral' : mode === 'advisory' ? 'info' : mode === 'assisted' ? 'warning' : 'danger';
  return (
    <span data-testid={testId} data-mode={mode}>
      <StatusBadge enumName="aiModes" value={mode} tone={tone} size={size} />
    </span>
  );
}

export function KillSwitchBadge({ active, testId }: { active: boolean; testId?: string }) {
  const { t } = useI18n();
  return (
    <span data-testid={testId} data-active={active ? 'true' : 'false'}>
      <StatusBadge enumName="aiModes" value={active ? 'kill_switch_active' : 'kill_switch_inactive'} tone={active ? 'danger' : 'success'} label={active ? t('ai.killSwitch.active') : t('ai.killSwitch.inactive')} />
    </span>
  );
}

/** The standing statement: nothing runs without the configured authority mode; prohibited actions do not exist. */
export function AuthorityNotice({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <Callout testId="authority-notice" className={className}>
      <p className="font-semibold">{t('ai.common.authorityTitle')}</p>
      <p>{t('ai.common.authorityNotice')}</p>
    </Callout>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// People and sources

/** A user referenced by an AI record: "You", the member name the server returned, or a short id — never a guess. */
export function Person({ id, people }: { id: string | null | undefined; people: People }) {
  const { t } = useI18n();
  const { me } = useProjectContext();
  if (!id) return <span className="text-muted">{EM_DASH}</span>;
  if (id === me.user.id) return <span className="font-medium">{t('ai.common.you')}</span>;
  const name = people[id];
  return name ? <span dir="auto">{name}</span> : <span dir="ltr">{t('ai.common.unknownUser', { id: id.slice(-6) })}</span>;
}

/**
 * Sources exactly as the API returned them (the server filters them by the reader's CURRENT access before returning).
 * Each one links to its record; the record page re-checks access.
 */
export function CitationLinks({ citations, testId = 'citations' }: { citations: readonly AiCitation[]; testId?: string }) {
  const { t, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const localize = useLocalized(); // QA-P5-04: Arabic template title when the record has one
  if (citations.length === 0) return <span className="text-sm text-muted">{t('ai.answer.noSources')}</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" data-testid={testId} aria-label={t('ai.answer.sources')}>
      {citations.map((c, i) => {
        const href = citationHref(projectId, c);
        const typeName = t(`ai.citationTypes.${c.type}` as MessageKey);
        // Without a server label the record type is the label (never an invented title).
        const label = localize(c.label, c.labelAr) ?? typeName;
        const meta = [c.label ? typeName : null, c.version !== null && c.version !== undefined ? t('ai.common.versionShort', { version: formatNumber(c.version) }) : null, c.location ?? null].filter(Boolean).join(' · ');
        const body = (
          <>
            {/* A source without an Arabic label (a document title, a record typed by a person) is shown as entered. */}
            <span dir="auto" className="font-medium" data-user-text={c.label && !c.labelAr ? true : undefined}>
              {label}
            </span>
            <span className="text-xs text-muted">{meta}</span>
          </>
        );
        return (
          <li key={`${c.type}:${c.id}:${i}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface-muted px-2 py-1 text-sm" data-citation-type={c.type} data-citation-id={c.id}>
            {href ? (
              <Link href={href} className={cx(btn.link, 'inline-flex flex-wrap items-baseline gap-x-1.5')} data-testid="citation-link">
                {body}
              </Link>
            ) : (
              <span className="inline-flex flex-wrap items-baseline gap-x-1.5" data-testid="citation-unlinked">
                {body}
              </span>
            )}
            {c.isDemo ? <DemoBadge /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function AiIcon() {
  return <Bot aria-hidden="true" className="size-4 shrink-0 text-muted" />;
}

// ---------------------------------------------------------------------------------------------------------------
// Errors: server codes translated in the active language (the English detail is only a fallback for unknown codes).

export type ErrorContext = 'proposal' | 'settings' | 'generic';

export function useAiErrorText() {
  const { t, formatNumber } = useI18n();
  return (error: unknown, context: ErrorContext = 'generic'): { title: string; message: string | null; detail: string | null; conflict: boolean; correlationId: string | null } => {
    if (!isApiError(error)) return { title: t('ai.errors.title'), message: t('ai.errors.generic'), detail: null, conflict: false, correlationId: null };
    const correlationId = error.correlationId ?? null;
    const conflict = error.status === 409;
    if (error.status === 404) return { title: t('ai.errors.title'), message: t('ai.errors.notFound'), detail: null, conflict, correlationId };
    if (error.status === 0 || error.status >= 500) return { title: t('ai.errors.title'), message: t('ai.errors.unavailable'), detail: null, conflict, correlationId };
    if (error.code === 'concurrency.version_mismatch') {
      const current = typeof error.details?.currentVersion === 'number' ? formatNumber(error.details.currentVersion as number) : '—';
      const message = context === 'proposal' ? t('ai.errors.staleProposal', { current }) : context === 'settings' ? t('ai.errors.staleSettings', { current }) : t('ai.errors.stale');
      return { title: t('ai.errors.staleTitle'), message, detail: null, conflict, correlationId };
    }
    if (error.status === 400) {
      const issues = Array.isArray(error.details?.issues) ? (error.details!.issues as { path?: string }[]).map((i) => i.path).filter(Boolean).join(', ') : '';
      return { title: t('ai.errors.title'), message: t('ai.errors.validation', { fields: issues || '—' }), detail: null, conflict, correlationId };
    }
    const key = `ai.errors.${error.code}` as MessageKey;
    const known = t(key);
    if (known !== key) return { title: t('ai.errors.title'), message: known, detail: null, conflict, correlationId };
    if (error.status === 403) return { title: t('ai.errors.title'), message: t('ai.errors.forbidden'), detail: error.detail ?? null, conflict, correlationId };
    return { title: t('ai.errors.title'), message: t('ai.errors.generic'), detail: error.detail ?? null, conflict, correlationId };
  };
}

/** Inline, translated refusal. 409 offers "reload and review"; the correlation id is always shown for support. */
export function AiErrorNotice({ error, context = 'generic', onReload, className, testId = 'ai-error' }: { error: unknown; context?: ErrorContext; onReload?: () => void; className?: string; testId?: string }) {
  const { t } = useI18n();
  const text = useAiErrorText();
  const ref = useRef<HTMLDivElement>(null);
  // A refusal may appear below the fold of a long dialog: bring it into view (role="alert" also announces it).
  useEffect(() => {
    if (error) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);
  if (!error) return null;
  const e = text(error, context);
  const code = isApiError(error) ? error.code : undefined;
  return (
    <div ref={ref} role="alert" className={cx('rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger', className)} data-testid={testId} data-code={code}>
      <div className="flex items-start gap-2">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{e.title}</p>
          {e.message ? <p className="text-ink">{e.message}</p> : null}
          {e.detail ? (
            <p className="text-ink">
              <span className="text-muted">{t('ai.errors.serverSaid')} </span>
              <span dir="auto">{e.detail}</span>
            </p>
          ) : null}
          {e.correlationId ? (
            <p className="text-xs">
              {t('states.error.correlation')} <Code>{e.correlationId}</Code>
            </p>
          ) : null}
          {e.conflict && onReload ? (
            <button type="button" className={cx(btn.secondary, 'mt-1')} onClick={onReload} data-testid="reload-and-review">
              <RefreshCw aria-hidden="true" className="size-4" />
              {t('common.actions.reloadAndReview')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Shared status pieces

/** Known run error codes are translated; anything else is shown verbatim as a technical code. */
export function RunError({ code }: { code: string }) {
  const { t } = useI18n();
  const key = `ai.runErrors.${code}` as MessageKey;
  const text = t(key);
  return text !== key ? <span>{text}</span> : <Code>{code}</Code>;
}

/** The four authority modes (spec §12.3), stated plainly. */
export function ModeReference() {
  const { t, tStatus } = useI18n();
  return (
    <Panel title={t('ai.modes.title')} testId="mode-reference" description={t('ai.modes.hint')}>
      <dl className="grid gap-3 sm:grid-cols-2">
        {(['off', 'advisory', 'assisted', 'autopilot'] as const).map((m) => (
          <div key={m}>
            <dt className="text-sm font-semibold text-ink">{tStatus('aiModes', m)}</dt>
            <dd className="text-sm text-muted">{t(`ai.modes.${m}`)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted">{EM_DASH} {t('ai.modes.footer')}</p>
    </Panel>
  );
}
