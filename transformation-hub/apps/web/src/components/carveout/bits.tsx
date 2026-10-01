'use client';

import { CircleCheck, CircleX } from 'lucide-react';
import { EM_DASH, useI18n } from '@/i18n/provider';
import type { Day1Position, ImpactEntry } from '@/lib/carveout';
import { useServerMessages } from '@/lib/i18n-data';
import { StatusBadge, type Tone } from '../StatusBadge';
import { cx } from '../ui';

/** Person reference from the API ({ userId, name } | null). */
export function PersonText({ person, emptyKey = 'carveout.common.unassigned' }: { person: { userId: string; name: string | null } | null | undefined; emptyKey?: 'carveout.common.unassigned' | 'carveout.common.notRecorded' }) {
  const { t } = useI18n();
  if (!person) return <span className="text-muted">{t(emptyKey)}</span>;
  return <span dir="auto">{person.name ?? EM_DASH}</span>;
}

/**
 * Legal and economic transfer are separate facts (P0 review D-05): both are always shown, with the combined status
 * (the least advanced of the two) — a verified legal transfer never reads as "transferred" while economics lag.
 */
export function TransferView({ transfer, compact = false }: { transfer: { legal: string; economic: string; combined: string }; compact?: boolean }) {
  const { t } = useI18n();
  if (compact) {
    return (
      <span className="inline-flex flex-col gap-1" data-testid="transfer-view" data-legal={transfer.legal} data-economic={transfer.economic}>
        <span className="inline-flex items-center gap-1 text-xs">
          <span className="w-16 shrink-0 text-muted">{t('carveout.aspect.legal')}</span>
          <StatusBadge enumName="transferStatuses" value={transfer.legal} />
        </span>
        <span className="inline-flex items-center gap-1 text-xs">
          <span className="w-16 shrink-0 text-muted">{t('carveout.aspect.economic')}</span>
          <StatusBadge enumName="transferStatuses" value={transfer.economic} />
        </span>
      </span>
    );
  }
  return (
    <dl className="grid gap-2 sm:grid-cols-3" data-testid="transfer-view" data-legal={transfer.legal} data-economic={transfer.economic} data-combined={transfer.combined}>
      {(['legal', 'economic', 'combined'] as const).map((k) => (
        <div key={k}>
          <dt className="text-xs text-muted">{t(`carveout.aspect.${k}`)}</dt>
          <dd className="mt-0.5">
            <StatusBadge enumName="transferStatuses" value={transfer[k]} size="md" />
          </dd>
        </div>
      ))}
    </dl>
  );
}

const MISSING_KEYS = ['specialistClassification', 'interimArrangement', 'serviceAccountableOwner', 'billingAccountableOwner', 'slaAccountableOwner', 'remediationPlan'] as const;
type MissingKey = (typeof MISSING_KEYS)[number];

/** Label of a Day-1 position gap reported by the server. */
export function useMissingLabel() {
  const { t } = useI18n();
  return (m: string) => (MISSING_KEYS.includes(m as MissingKey) ? t(`carveout.day1.missing.${m as MissingKey}`) : m);
}

/** AT-08: the Day-1 position of a contract — OK, or the list of what is still missing. */
export function Day1Badge({ position }: { position: Pick<Day1Position, 'applicable' | 'ok' | 'missing'> }) {
  const { t } = useI18n();
  if (!position.applicable) return <span className="text-sm text-muted">{t('carveout.day1.notApplicable')}</span>;
  const tone: Tone = position.ok ? 'success' : 'danger';
  return (
    <StatusBadge
      enumName="consentStatuses"
      value={position.ok ? 'granted' : 'refused'}
      tone={tone}
      label={position.ok ? t('carveout.day1.ok') : t('carveout.day1.incomplete', { count: position.missing.length })}
    />
  );
}

export function Day1Checklist({ position }: { position: Day1Position }) {
  const { t } = useI18n();
  const label = useMissingLabel();
  if (!position.applicable) return <p className="text-sm text-muted">{t('carveout.day1.notApplicable')}</p>;
  const rows: { key: MissingKey; value: string | null }[] = [
    { key: 'specialistClassification', value: null },
    { key: 'interimArrangement', value: position.interimArrangement },
    { key: 'serviceAccountableOwner', value: position.serviceAccountable?.name ?? null },
    { key: 'billingAccountableOwner', value: position.billingAccountable?.name ?? null },
    { key: 'slaAccountableOwner', value: position.slaAccountable?.name ?? null },
    { key: 'remediationPlan', value: position.remediationPlan },
  ];
  return (
    <div data-testid="day1-position" data-ok={position.ok ? 'true' : 'false'}>
      <p className="mb-2 text-sm">
        {position.consentGranted ? t('carveout.day1.consentGranted') : t('carveout.day1.consentOutstanding')}
      </p>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const missing = position.missing.includes(r.key);
          return (
            <li key={r.key} className="flex items-start gap-2 text-sm" data-missing={missing ? 'true' : 'false'}>
              {missing ? <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" /> : <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />}
              <span className="min-w-0">
                <span className={cx('font-medium', missing && 'text-danger')}>{label(r.key)}</span>
                <span className="sr-only">: {missing ? t('carveout.day1.missingWord') : t('carveout.day1.presentWord')}</span>
                {r.value ? (
                  <span className="block text-muted" dir="auto">
                    {r.value}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const IMPACT_TONE: Record<ImpactEntry['status'], Tone> = { identified: 'info', assessment_pending: 'warning', none_identified: 'success', not_visible: 'neutral' };

/** REQ-PER-004: impact entries across modules; figures are never computed — specialist assessment is shown as pending. */
export function ImpactEntries({ entries, narrative }: { entries: ImpactEntry[]; narrative?: Record<string, string> }) {
  const { t } = useI18n();
  const serverText = useServerMessages();
  return (
    <ul className="grid gap-2 md:grid-cols-2" data-testid="impact-entries">
      {entries.map((e) => (
        <li key={e.area} className="rounded-md border border-line p-3" data-area={e.area} data-impact={e.status}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">{t(`carveout.impact.area.${e.area}`)}</span>
            <StatusBadge enumName="applicabilityStatuses" value={e.status} tone={IMPACT_TONE[e.status]} label={t(`carveout.impact.status.${e.status}`)} />
          </div>
          {/* QA-P34-01f: the derived summary is translated from its codes (entries stored before the codes show the English). */}
          <p className="mt-1 text-sm text-ink" dir={e.summaryI18n.length ? undefined : 'auto'}>
            {serverText(e.summaryI18n, e.summary)}
          </p>
          {e.references.length ? (
            <p className="mt-1 text-xs text-muted" dir="ltr">
              {e.references.map((r) => r.code).join(' · ')}
            </p>
          ) : null}
          {narrative?.[e.area] ? (
            <p className="mt-1 text-xs text-ink" dir="auto">
              <span className="text-muted">{t('carveout.impact.specialistNote')}: </span>
              {narrative[e.area]}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
