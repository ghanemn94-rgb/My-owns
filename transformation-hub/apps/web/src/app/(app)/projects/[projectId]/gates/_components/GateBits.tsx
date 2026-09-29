'use client';

import { CircleAlert, CircleCheck, RotateCcw } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import type { GateBlocker, GateSummary } from '@/lib/gates';

/**
 * Blockers rendered from their structured kind + reference (translated); the server's English sentence is kept as the
 * accessible description so no nuance is lost.
 */
export function BlockerList({ blockers, limit, className }: { blockers: GateBlocker[]; limit?: number; className?: string }) {
  const { t, formatNumber } = useI18n();
  if (blockers.length === 0) {
    return (
      <p className={cx('flex items-center gap-1.5 text-sm text-success', className)} data-testid="gate-no-blockers">
        <CircleCheck aria-hidden="true" className="size-4" />
        {t('gates.blockers.none')}
      </p>
    );
  }
  const shown = limit ? blockers.slice(0, limit) : blockers;
  return (
    <div className={className}>
      <ul className="space-y-1" data-testid="gate-blockers">
        {shown.map((b, i) => (
          <li key={`${b.kind}-${b.ref}-${i}`} className="flex items-start gap-1.5 text-sm text-ink" data-blocker-kind={b.kind} data-blocker-ref={b.ref}>
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
            <span>
              {t(`gates.blockers.${b.kind}`, { ref: b.ref })}
              <span className="sr-only"> — </span>
              <span className="block text-xs text-muted" dir="ltr" lang="en">
                {b.message}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {limit && blockers.length > limit ? (
        <p className="mt-1 text-xs text-muted">{t('gates.blockers.more', { count: formatNumber(blockers.length - limit) })}</p>
      ) : null}
    </div>
  );
}

/** Status + RAG + cycle + reassessment flag for a gate's current cycle. */
export function GateStatusBadges({ gate, size = 'sm' }: { gate: Pick<GateSummary, 'assessment' | 'rag'>; size?: 'sm' | 'md' }) {
  const { t, formatNumber } = useI18n();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusBadge enumName="gateAssessmentStatuses" value={gate.assessment.status} size={size} />
      <StatusBadge enumName="ragStatuses" value={gate.rag} size={size} label={t('gates.ragLabel', { rag: t(`gates.rag.${gate.rag}`) })} />
      <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{t('gates.cycle', { cycle: formatNumber(gate.assessment.cycle) })}</span>
      {gate.assessment.reassessment.needsReassessment ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger" data-testid="needs-reassessment">
          <RotateCcw aria-hidden="true" className="size-3.5" />
          {t('gates.reassessment.badge')}
        </span>
      ) : null}
    </span>
  );
}

/** Prerequisite gates with their current status (only genuinely sequential dependencies exist — G5 needs only G1). */
export function PrerequisiteList({ prerequisites }: { prerequisites: GateSummary['prerequisites'] }) {
  const { t } = useI18n();
  if (prerequisites.length === 0) return <p className="text-sm text-muted">{t('gates.prerequisites.none')}</p>;
  return (
    <ul className="flex flex-wrap gap-2" data-testid="gate-prerequisites">
      {prerequisites.map((p) => (
        <li key={p.gateKey} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-sm">
          <span dir="ltr" className="font-semibold">
            {p.gateKey}
          </span>
          {p.status === 'none' ? (
            <span className="text-xs text-muted">{t('gates.prerequisites.missing')}</span>
          ) : (
            <StatusBadge enumName="gateAssessmentStatuses" value={p.status} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Criteria counts line (met / waived / not applicable / total) — never task progress. */
export function CriteriaCounts({ counts }: { counts: GateSummary['evaluation']['counts'] }) {
  const { t, formatNumber } = useI18n();
  return (
    <p className="text-sm text-muted" data-testid="gate-counts">
      {t('gates.counts', {
        met: formatNumber(counts.met),
        waived: formatNumber(counts.waived),
        na: formatNumber(counts.notApplicable),
        total: formatNumber(counts.total),
      })}
    </p>
  );
}
