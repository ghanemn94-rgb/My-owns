'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { gatesRoutes } from '@hub/contracts';
import { STATUS_DIMENSION_KEYS, type StatusDimensionKey } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { useI18n, type StatusEnum } from '@/i18n/provider';
import { api } from '@/lib/api';
import { DIMENSION_GATES, gatesQk, useGates, useStatusDimensions } from '@/lib/gates';
import { useProjectContext } from '@/lib/project-context';
import { useServerMessages } from '@/lib/i18n-data';
import { sectionAppliesTo, sectionByKey, sectionHref, type SectionKey } from '@/lib/sections';
import { LocalizedText } from '@/components/LocalizedText';

/** Register that drives each dimension (spec §3) — P3/P4 registers render their honest placeholder until delivered. */
const REGISTER: Record<StatusDimensionKey, SectionKey> = {
  incorporation: 'newco',
  perimeter_transfer: 'perimeter',
  operational_readiness: 'readiness',
  jv_transaction: 'jv',
};
/** Enum used to label the per-state counts of a dimension. */
const COUNT_ENUM: Partial<Record<StatusDimensionKey, StatusEnum>> = { perimeter_transfer: 'transferStatuses' };

export default function DimensionPage() {
  const { dimensionKey } = useParams<{ dimensionKey: string }>();
  const { t, tStatus, formatDateTime, formatNumber } = useI18n();
  const serverText = useServerMessages();
  const { projectId, project, can } = useProjectContext();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const dims = useStatusDimensions(projectId);
  const gates = useGates(projectId, can('gates.gate.read'));
  const key = dimensionKey as StatusDimensionKey;
  const valid = (STATUS_DIMENSION_KEYS as readonly string[]).includes(dimensionKey);
  const d = dims.data?.items.find((x) => x.key === key);
  const register = valid ? sectionByKey(REGISTER[key]) : null;
  const registerHref = register && sectionAppliesTo(register, project.templateKind) && can(register.permissions) ? sectionHref(projectId, register.key) : null;
  const relatedGates = (gates.data?.items ?? []).filter((g) => valid && DIMENSION_GATES[key]?.includes(g.key));

  return (
    <SectionGuard section="overview">
      <Link href={sectionHref(projectId, 'overview')} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
        <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('gates.dimensions.back')}
      </Link>
      {!valid ? (
        <RestrictedState />
      ) : dims.isLoading ? (
        <LoadingState />
      ) : dims.error ? (
        <ErrorState error={dims.error} onRetry={() => dims.refetch()} />
      ) : !d ? (
        <RestrictedState />
      ) : (
        <>
          <PageHeader
            eyebrow={t('gates.dimensions.eyebrow')}
            title={tStatus('statusDimensionKeys', key)}
            badges={<StatusBadge enumName="dimensionStates" value={d.state} size="md" />}
            description={t('gates.dimensions.independent')}
            actions={
              can('gates.definition.manage') ? (
                <button type="button" className={btn.secondary} onClick={() => setConfirm(true)} data-testid="recompute-dimensions">
                  <RefreshCw aria-hidden="true" className="size-4" />
                  {t('gates.dimensions.recompute')}
                </button>
              ) : null
            }
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <section aria-labelledby="dim-expl" className={cx(card, 'p-4 lg:col-span-2')} data-testid="dimension-detail" data-dimension={key}>
              <h2 id="dim-expl" className="mb-2 text-base font-semibold">
                {t('gates.dimensions.explanation')}
              </h2>
              {d.explanationI18n.length ? (
                <p className="text-sm text-ink" dir="auto" data-testid="dimension-explanation">
                  {serverText(d.explanationI18n, d.explanation)}
                </p>
              ) : (
                <>
                  {/* Computed before explanations carried message codes: shown as recorded, in English. */}
                  <p className="text-sm text-ink" dir="ltr" lang="en" data-testid="dimension-explanation">
                    {d.explanation}
                  </p>
                  <p className="mt-2 text-xs text-muted">{t('gates.dimensions.explanationLanguage')}</p>
                </>
              )}
              <p className="mt-3 text-xs text-muted">
                {t('gates.dimensions.computed', { at: formatDateTime(d.computedAt), version: formatNumber(d.version) })}
              </p>
              {d.counts && Object.keys(d.counts).length > 0 ? (
                <div className="mt-4">
                  <h3 className="mb-1 text-sm font-semibold">{t('gates.dimensions.counts')}</h3>
                  <ul className="flex flex-wrap gap-2">
                    {Object.entries(d.counts).map(([k, n]) => (
                      <li key={k} className="rounded-md border border-line px-2 py-1 text-sm">
                        {COUNT_ENUM[key] ? tStatus(COUNT_ENUM[key]!, k) : k}: <span className="tabular font-semibold">{formatNumber(n)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-4 text-sm font-medium">{dims.data?.carveOutComplete ? t('gates.dimensions.complete') : t('gates.dimensions.notComplete')}</p>
            </section>
            <section aria-labelledby="dim-records" className={cx(card, 'p-4')}>
              <h2 id="dim-records" className="mb-2 text-base font-semibold">
                {t('gates.dimensions.records')}
              </h2>
              {registerHref ? (
                <Link href={registerHref} className="text-sm font-medium text-primary hover:underline">
                  {t('gates.dimensions.openRegister', { register: t(`nav.items.${REGISTER[key]}`) })}
                </Link>
              ) : (
                <p className="text-sm text-muted">{t('gates.dimensions.registerUnavailable')}</p>
              )}
              {relatedGates.length > 0 ? (
                <>
                  <h3 className="mt-4 mb-1 text-sm font-semibold">{t('gates.dimensions.relatedGates')}</h3>
                  <ul className="space-y-1">
                    {relatedGates.map((g) => (
                      <li key={g.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <Link href={`/projects/${projectId}/gates/${g.id}`} className="font-medium text-primary hover:underline">
                          <span dir="ltr">{g.key}</span> — <LocalizedText text={g.name} textAr={g.nameAr} />
                        </Link>
                        <StatusBadge enumName="gateAssessmentStatuses" value={g.assessment.status} />
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          </div>
          <ActivityHistory projectId={projectId} entityType="status_dimension" entityId={d.id} className="mt-4" />
          <ConfirmCommandDialog
            open={confirm}
            onClose={() => setConfirm(false)}
            title={t('gates.dimensions.recomputeTitle')}
            confirmLabel={t('gates.dimensions.recompute')}
            noteMode="none"
            consequences={[t('gates.dimensions.recomputeEffect'), t('common.command.audited')]}
            onConfirm={async () => {
              await api(gatesRoutes.recomputeStatusDimensions, { params: { projectId }, body: {} });
              await Promise.all([qc.invalidateQueries({ queryKey: gatesQk.dimensions(projectId) }), qc.invalidateQueries({ queryKey: ['project', projectId], exact: true })]);
              toast.show('success', t('gates.dimensions.recomputed'));
              setConfirm(false);
            }}
          />
        </>
      )}
    </SectionGuard>
  );
}
