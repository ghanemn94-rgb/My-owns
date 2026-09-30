'use client';

import Link from 'next/link';
import { AlarmClock, ChevronRight, CircleAlert, Flag, Gavel, HeartPulse, Lock, RefreshCw, Timer, Users, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { DemoBadge } from '@/components/DemoBadge';
import { LoadingState } from '@/components/LoadingState';
import { MetricCard } from '@/components/MetricCard';
import { RagBadge } from '@/components/planning/bits';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { isApiError } from '@/lib/api';
import {
  AWAITING_COMMITTEE_STATUSES,
  COCKPIT_TOP,
  agendaItemHref,
  decisionHref,
  decisionListHref,
  isDecisionOverdue,
  pendingAgendaHref,
  useOpenDecisions,
  usePendingAgendaRequests,
  type CockpitDecision,
} from '@/lib/cockpit';
import { nextGate, useGates, type GateBlocker, type GateSummary } from '@/lib/gates';
import { useLocalized, useServerMessages } from '@/lib/i18n-data';
import { localToday, useProgress } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { GateStatusBadges } from '../gates/_components/GateBits';

/**
 * DC Executive Cockpit tiles (Screen 2, REQ-UX-005). Every tile reads existing, permission-checked API routes and shows
 * only what the API returned to the caller; a part the caller has no permission for shows a restricted note (it is never
 * requested), and nothing is ever filled with sample values.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Shared tile chrome and states

function Tile({
  id,
  icon: Icon,
  title,
  hint,
  testId,
  className,
  children,
  extra,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  hint?: string;
  testId: string;
  className?: string;
  children: ReactNode;
  extra?: Record<`data-${string}`, string>;
}) {
  return (
    <section aria-labelledby={id} className={cx(card, 'flex min-w-0 flex-col gap-3 p-4', className)} data-testid={testId} {...extra}>
      <div>
        <h3 id={id} className="flex items-center gap-2 font-semibold">
          <Icon aria-hidden="true" className="size-5 shrink-0 text-primary" />
          {title}
        </h3>
        {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A tile part the caller's roles do not grant (the request is never made): no count, no record, no hint of existence. */
function TileRestricted() {
  const { t } = useI18n();
  return (
    <p className="flex items-start gap-2 text-sm text-muted" data-testid="tile-restricted">
      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {t('project.cockpit.restricted')}
    </p>
  );
}

/** Compact failure state inside a tile; 403/404 read as restricted, exactly like the full-page states. */
function TileError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  if (isApiError(error) && (error.isHidden || error.isForbidden)) return <TileRestricted />;
  const correlationId = isApiError(error) ? error.correlationId : undefined;
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm" data-testid="tile-error">
      <p className="flex items-start gap-2 text-ink">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
        {t('project.cockpit.tileError')}
      </p>
      {correlationId ? (
        <p className="text-xs text-muted">
          {t('states.error.correlation')}{' '}
          <code dir="ltr" className="rounded bg-surface-muted px-1 py-0.5 font-mono">
            {correlationId}
          </code>
        </p>
      ) : null}
      <button type="button" className={btn.secondary} onClick={onRetry}>
        <RefreshCw aria-hidden="true" className="size-4" />
        {t('common.actions.retry')}
      </button>
    </div>
  );
}

function SubHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h4 id={id} className="text-sm font-semibold text-ink">
      {children}
    </h4>
  );
}

function OverdueBadge() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger" data-testid="overdue-badge">
      <AlarmClock aria-hidden="true" className="size-3.5 shrink-0" />
      {t('project.cockpit.decisions.overdue')}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Overall health

/**
 * Overall delivery health: the server's worst-of project status (workstreams and critical milestones, with the manual
 * override rules and data-quality flags). It is not a blend of the four status dimensions or of the gates, which the
 * cockpit shows separately (spec §9: a green average must not conceal a red item).
 */
export function OverallHealthTile() {
  const { t, formatNumber, formatDate } = useI18n();
  const { projectId, project, can } = useProjectContext();
  const allowed = can('planning.plan.read');
  const prog = useProgress(projectId, allowed);
  const d = prog.data;
  const healthHref = `/projects/${projectId}/plan?tab=health`;
  return (
    <Tile id="health-tile-title" icon={HeartPulse} title={t('project.cockpit.health.title')} hint={t('project.cockpit.health.hint')} testId="overall-health-tile">
      {!allowed ? (
        <TileRestricted />
      ) : prog.isLoading ? (
        <LoadingState compact />
      ) : prog.error || !d ? (
        <TileError error={prog.error} onRetry={() => prog.refetch()} />
      ) : (
        <>
          <dl className="grid gap-2 text-sm" data-testid="overall-health" data-rag={d.project.rag.effective}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-muted">{t('project.cockpit.health.status')}</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                <RagBadge value={d.project.rag.effective} size="md" />
                {d.project.rag.overridden ? (
                  <span className="text-xs text-muted" data-testid="overall-health-calculated">
                    {t('project.cockpit.health.calculated')} <RagBadge value={d.project.rag.calculated.status} />
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-muted">{t('project.cockpit.health.progress')}</dt>
              <dd className="tabular font-medium">
                {d.project.progress.percent === null ? t('project.cockpit.health.progressNone') : `${formatNumber(d.project.progress.percent)}%`}
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-muted">{t('project.cockpit.health.redCritical')}</dt>
              <dd className={cx('tabular font-medium', d.project.redCritical.length > 0 && 'text-danger')} data-testid="overall-health-red">
                {formatNumber(d.project.redCritical.length)}
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-muted">{t('project.cockpit.health.dataQuality')}</dt>
              <dd className={cx('tabular font-medium', d.project.dataQualityIssues.length > 0 && 'text-warning')}>{formatNumber(d.project.dataQualityIssues.length)}</dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-muted">{t('project.cockpit.health.baseline')}</dt>
              <dd className="font-medium">{d.baseline ? t('project.cockpit.health.baselineVersion', { version: d.baseline.versionNo }) : t('project.cockpit.health.noBaseline')}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted" lang="en" dir="ltr">
            {d.project.aggregate.explanation}
          </p>
          <Link href={healthHref} className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" data-testid="overall-health-link">
            {t('project.cockpit.health.open')}
            <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
          </Link>
          <p className="text-xs text-muted">{t('project.cockpit.health.asOf', { date: formatDate(d.today), tz: project.timezone })}</p>
        </>
      )}
    </Tile>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Next gate

/** The "next gate" from the live gate evaluation (status, RAG, open blockers) when the caller can read gates. */
export function NextGateTile() {
  const { t, formatNumber } = useI18n();
  const loc = useLocalized();
  const { project, projectId, can } = useProjectContext();
  const canGates = can('gates.gate.read');
  const gates = useGates(projectId, canGates);
  const live = gates.data ? nextGate(gates.data.items) : null;
  let body: ReactNode;
  if (canGates && gates.isLoading) body = <LoadingState compact />;
  else if (canGates && gates.error) body = <TileError error={gates.error} onRetry={() => gates.refetch()} />;
  else if (canGates && live) {
    body = (
      <div className="space-y-2" data-testid="next-gate" data-gate-key={live.key}>
        <p className="text-base font-semibold" dir="auto">
          <Link href={`/projects/${projectId}/gates/${live.id}`} className="hover:underline">
            <span dir="ltr">{live.key}</span> — {loc(live.name, live.nameAr)}
          </Link>
        </p>
        <GateStatusBadges gate={live} />
        <p className={cx('text-sm', live.blockers.length > 0 ? 'font-medium text-danger' : 'text-success')} data-testid="next-gate-blocker-count">
          {live.blockers.length > 0 ? t('project.cockpit.gate.blockerCount', { count: formatNumber(live.blockers.length) }) : t('gates.blockers.none')}
        </p>
        <Link href={`/projects/${projectId}/gates/${live.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" data-testid="next-gate-link">
          {t('gates.openGate', { key: live.key })}
          <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Link>
      </div>
    );
  } else if (canGates && gates.data) {
    body = <p className="text-sm text-muted">{gates.data.items.length === 0 ? t('project.cockpit.gate.noGates') : t('project.cockpit.gate.allApproved')}</p>;
  } else if (project.nextGate) {
    body = (
      <div className="space-y-2" data-testid="next-gate">
        <p className="text-base font-semibold" dir="auto">
          <span dir="ltr">{project.nextGate.key}</span> — {loc(project.nextGate.name, project.nextGate.nameAr)}
        </p>
        <StatusBadge enumName="gateAssessmentStatuses" value={project.nextGate.status} size="md" />
      </div>
    );
  } else {
    body = (
      <p className="text-sm text-muted">
        {EM_DASH} {t('portfolio.notVisible')}
      </p>
    );
  }
  return (
    <Tile id="gate-title" icon={Flag} title={t('portfolio.nextGate')} testId="next-gate-tile">
      {body}
      <p className="mt-auto text-xs text-muted">{t('project.cockpit.gateHint')}</p>
    </Tile>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Delay impact (restricted variant; the live tile is components/planning/DelayImpactTile)

export function DelayImpactRestrictedTile() {
  const { t } = useI18n();
  return (
    <Tile id="delay-tile" icon={Timer} title={t('project.cockpit.delayImpact')} testId="delay-impact-tile" extra={{ 'data-restricted': 'true' }}>
      <TileRestricted />
    </Tile>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Top three decisions and blockers

function DecisionRow({ d, rank, today, testId }: { d: CockpitDecision; rank: number; today: string; testId: string }) {
  const { t, formatDate, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const overdue = isDecisionOverdue(d, today);
  return (
    <li
      className={cx('flex items-start gap-2.5 rounded-md border p-2.5', overdue ? 'border-danger/40' : 'border-line')}
      data-testid={testId}
      data-decision-code={d.code}
      data-decision-status={d.status}
      data-overdue={overdue ? 'true' : 'false'}
    >
      {/* The <ol> already announces the position; the number is a visual aid only. */}
      <span aria-hidden="true" className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-ink">
        {formatNumber(rank)}
      </span>
      <div className="min-w-0 flex-1">
        {/* Code and title on their own lines: an English title keeps its own direction inside the Arabic UI. */}
        <Link href={decisionHref(projectId, d.id)} className="group block min-w-0 break-words" data-testid={`${testId}-link`}>
          <span dir="ltr" className="block text-xs font-semibold text-muted">
            {d.code}
          </span>
          <span dir="auto" className="block font-medium text-primary group-hover:underline" data-testid={`${testId}-title`}>
            {d.title}
          </span>
        </Link>
        {d.isDemo ? <DemoBadge className="mt-1" /> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <StatusBadge enumName="decisionStatuses" value={d.status} />
          {overdue ? <OverdueBadge /> : null}
          <span className={cx(overdue ? 'font-medium text-danger' : 'text-muted')}>
            {d.latestSafeDate ? t('project.cockpit.decisions.safeDate', { date: formatDate(d.latestSafeDate) }) : t('project.cockpit.decisions.noSafeDate')}
          </span>
        </div>
      </div>
    </li>
  );
}

function blockerHref(projectId: string, gate: GateSummary, all: readonly GateSummary[], b: GateBlocker): string {
  if (b.kind === 'prerequisite') {
    const prereq = all.find((g) => g.key === b.ref);
    if (prereq) return `/projects/${projectId}/gates/${prereq.id}`;
  }
  // The linked decision is present only when the caller may read it (the API nulls it otherwise).
  if (b.kind === 'decision' && gate.decision) return decisionHref(projectId, gate.decision.id);
  return `/projects/${projectId}/gates/${gate.id}`;
}

function NextGateBlockers() {
  const { t, formatNumber } = useI18n();
  const serverText = useServerMessages();
  const { projectId, can } = useProjectContext();
  const canGates = can('gates.gate.read');
  const gates = useGates(projectId, canGates);
  const live = gates.data ? nextGate(gates.data.items) : null;
  const heading = live ? t('project.cockpit.decisions.blockersTitle', { key: live.key }) : t('project.cockpit.decisions.blockersTitleGeneric');
  let body: ReactNode;
  if (!canGates) body = <TileRestricted />;
  else if (gates.isLoading) body = <LoadingState compact />;
  else if (gates.error || !gates.data) body = <TileError error={gates.error} onRetry={() => gates.refetch()} />;
  else if (!live) body = <p className="text-sm text-muted">{gates.data.items.length === 0 ? t('project.cockpit.gate.noGates') : t('project.cockpit.gate.allApproved')}</p>;
  else if (live.blockers.length === 0) body = <p className="text-sm text-success" data-testid="top-blockers-none">{t('gates.blockers.none')}</p>;
  else {
    const shown = live.blockers.slice(0, COCKPIT_TOP);
    const more = live.blockers.length - shown.length;
    body = (
      <>
        <ul aria-labelledby="top-blockers-title" className="space-y-2" data-testid="top-blockers" data-gate-key={live.key}>
          {shown.map((b, i) => (
            <li key={`${b.kind}-${b.ref}-${i}`} className="flex items-start gap-2 text-sm" data-testid="top-blocker" data-blocker-kind={b.kind} data-blocker-ref={b.ref}>
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
              <span className="min-w-0">
                <Link href={blockerHref(projectId, live, gates.data!.items, b)} className="font-medium text-primary hover:underline" data-testid="top-blocker-link">
                  {t(`gates.blockers.${b.kind}`, { ref: b.ref })}
                </Link>
                {b.messageI18n.length ? (
                  <span className="block text-xs text-muted" dir="auto">
                    {serverText(b.messageI18n, b.message)}
                  </span>
                ) : (
                  <span className="block text-xs text-muted" dir="ltr" lang="en">
                    {b.message}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <Link href={`/projects/${projectId}/gates/${live.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" data-testid="top-blockers-more">
          {more > 0 ? t('project.cockpit.decisions.moreBlockers', { count: formatNumber(more), key: live.key }) : t('gates.openGate', { key: live.key })}
          <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Link>
      </>
    );
  }
  return (
    <div className="space-y-2">
      <SubHeading id="top-blockers-title">{heading}</SubHeading>
      {body}
    </div>
  );
}

/**
 * The three most urgent open decisions (latest safe decision date ascending — overdue first, undated last) and the
 * blockers of the next gate. Decisions come from the decision register (classification applied in SQL), so only
 * decisions the caller may read are ranked, shown or counted.
 */
export function TopDecisionsTile() {
  const { t } = useI18n();
  const { projectId, project, can } = useProjectContext();
  const canDecisions = can('governance.decision.read');
  const decisions = useOpenDecisions(projectId, canDecisions);
  const today = localToday(project.timezone);
  const top = decisions.items.slice(0, COCKPIT_TOP);
  let list: ReactNode;
  if (!canDecisions) list = <TileRestricted />;
  else if (decisions.isLoading) list = <LoadingState compact />;
  else if (decisions.error) list = <TileError error={decisions.error} onRetry={decisions.refetch} />;
  else if (top.length === 0)
    list = (
      <p className="text-sm text-muted" data-testid="top-decisions-empty">
        {t('project.cockpit.decisions.empty')}
      </p>
    );
  else
    list = (
      <ol aria-labelledby="top-decisions-list-title" className="space-y-2" data-testid="top-decisions">
        {top.map((d, i) => (
          <DecisionRow key={d.id} d={d} rank={i + 1} today={today} testId="top-decision" />
        ))}
      </ol>
    );
  return (
    <Tile id="top-decisions-title" icon={Gavel} title={t('project.cockpit.topDecisions')} hint={t('project.cockpit.decisions.hint')} testId="top-decisions-tile">
      <div className="space-y-2">
        <SubHeading id="top-decisions-list-title">{t('project.cockpit.decisions.listTitle')}</SubHeading>
        {list}
        {canDecisions ? (
          <Link href={decisionListHref(projectId)} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" data-testid="top-decisions-all">
            {t('project.cockpit.decisions.viewAll')}
            <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
          </Link>
        ) : null}
      </div>
      <div className="border-t border-line pt-3">
        <NextGateBlockers />
      </div>
    </Tile>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Committee asks

function CountRestricted({ label }: { label: string }) {
  return (
    <div className={cx(card, 'flex h-full flex-col gap-1 p-4')}>
      <span className="text-sm text-muted">{label}</span>
      <TileRestricted />
    </div>
  );
}

/** A count whose list failed to load: an em dash and the reason, never a zero (the retry is offered below). */
function CountUnavailable({ label }: { label: string }) {
  const { t } = useI18n();
  return (
    <div className={cx(card, 'flex h-full flex-col gap-1 p-4')} data-testid="count-unavailable">
      <span className="text-sm text-muted">{label}</span>
      <span className="tabular text-2xl font-semibold text-ink" aria-hidden="true">
        {EM_DASH}
      </span>
      <span className="text-xs text-danger">{t('project.cockpit.tileError')}</span>
    </div>
  );
}

/**
 * What the committee is being asked for: decision papers submitted to it or under its review, and agenda requests
 * awaiting secretariat screening — counts (each opening the filtered register) and the most urgent items. Render it only
 * for callers who can read governance (decision register or meetings); a part they lack is shown as restricted.
 */
export function CommitteeAsksTile() {
  const { t, formatDateTime } = useI18n();
  const { projectId, project, can } = useProjectContext();
  const canDecisions = can('governance.decision.read');
  const canAgenda = can('governance.meeting.read');
  const decisions = useOpenDecisions(projectId, canDecisions);
  const agenda = usePendingAgendaRequests(projectId, canAgenda);
  const today = localToday(project.timezone);
  const awaiting = decisions.items.filter((d) => (AWAITING_COMMITTEE_STATUSES as readonly string[]).includes(d.status)).slice(0, COCKPIT_TOP);

  const counts: { kind: string; label: string; allowed: boolean; loading: boolean; value: number | undefined; href: string }[] = [
    { kind: 'submitted', label: t('project.cockpit.asks.submitted'), allowed: canDecisions, loading: decisions.isLoading, value: decisions.totals.submitted, href: decisionListHref(projectId, 'submitted') },
    { kind: 'under_review', label: t('project.cockpit.asks.underReview'), allowed: canDecisions, loading: decisions.isLoading, value: decisions.totals.under_review, href: decisionListHref(projectId, 'under_review') },
    { kind: 'agenda_requested', label: t('project.cockpit.asks.pendingAgenda'), allowed: canAgenda, loading: agenda.isLoading, value: agenda.data?.total, href: pendingAgendaHref(projectId) },
  ];
  const countCell = (c: (typeof counts)[number]) => {
    if (!c.allowed) return <CountRestricted label={c.label} />;
    if (c.loading)
      return (
        <div className={cx(card, 'h-full p-2')}>
          <LoadingState compact />
        </div>
      );
    if (c.value === undefined) return <CountUnavailable label={c.label} />;
    return <MetricCard label={c.label} value={c.value} href={c.href} className="h-full" />;
  };

  let awaitingBody: ReactNode;
  if (!canDecisions) awaitingBody = <TileRestricted />;
  else if (decisions.isLoading) awaitingBody = <LoadingState compact />;
  else if (decisions.error) awaitingBody = <TileError error={decisions.error} onRetry={decisions.refetch} />;
  else if (awaiting.length === 0)
    awaitingBody = (
      <p className="text-sm text-muted" data-testid="awaiting-committee-empty">
        {t('project.cockpit.asks.awaitingEmpty')}
      </p>
    );
  else
    awaitingBody = (
      <ol aria-labelledby="asks-awaiting-title" className="space-y-2" data-testid="awaiting-committee">
        {awaiting.map((d, i) => (
          <DecisionRow key={d.id} d={d} rank={i + 1} today={today} testId="awaiting-decision" />
        ))}
      </ol>
    );

  let agendaBody: ReactNode;
  if (!canAgenda) agendaBody = <TileRestricted />;
  else if (agenda.isLoading) agendaBody = <LoadingState compact />;
  else if (agenda.error || !agenda.data) agendaBody = <TileError error={agenda.error} onRetry={() => agenda.refetch()} />;
  else if (agenda.data.items.length === 0)
    agendaBody = (
      <p className="text-sm text-muted" data-testid="pending-agenda-empty">
        {t('project.cockpit.asks.agendaEmpty')}
      </p>
    );
  else
    agendaBody = (
      <ol aria-labelledby="asks-agenda-title" className="space-y-2" data-testid="pending-agenda">
        {agenda.data.items.map((a) => (
          <li key={a.id} className="rounded-md border border-line p-2.5" data-testid="pending-agenda-item">
            <Link href={agendaItemHref(projectId, a)} className="break-words font-medium text-primary hover:underline" dir="auto" data-testid="pending-agenda-link">
              {a.title}
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
              <StatusBadge enumName="agendaItemKinds" value={a.kind} tone="neutral" />
              {a.decisionCode ? <span dir="ltr">{a.decisionCode}</span> : null}
              <span>{t('project.cockpit.asks.requestedAt', { date: formatDateTime(a.createdAt) })}</span>
            </div>
          </li>
        ))}
      </ol>
    );

  return (
    <Tile id="asks-tile-title" icon={Users} title={t('project.cockpit.committeeAsks')} hint={t('project.cockpit.asks.hint')} testId="committee-asks-tile">
      <ul className="grid gap-3 sm:grid-cols-3" data-testid="committee-ask-counts">
        {counts.map((c) => (
          <li key={c.kind} data-testid="committee-ask-count" data-kind={c.kind} data-value={c.allowed && !c.loading && c.value !== undefined ? String(c.value) : undefined} className="min-w-0">
            {countCell(c)}
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <SubHeading id="asks-awaiting-title">{t('project.cockpit.asks.awaitingTitle')}</SubHeading>
        {awaitingBody}
      </div>
      <div className="space-y-2 border-t border-line pt-3">
        <SubHeading id="asks-agenda-title">{t('project.cockpit.asks.agendaTitle')}</SubHeading>
        {agendaBody}
      </div>
    </Tile>
  );
}
