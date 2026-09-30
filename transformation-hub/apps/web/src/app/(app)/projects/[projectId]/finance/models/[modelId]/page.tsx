'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FilePlus2, FileUp, Pencil } from 'lucide-react';
import { useState } from 'react';
import { MODEL_CASES } from '@hub/domain';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { ScrollRegion } from '@/components/ScrollRegion';
import { StatusBadge } from '@/components/StatusBadge';
import { btn } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { isApiError } from '@/lib/api';
import { finHref, useModel } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { BackToList, Callout, Facts, FinanceHistory, Panel, Person, UText } from '../../_components/fin';
import { EditModelDialog, NewVersionDialog } from '../../_components/model-forms';

/** A business plan / valuation model with every version of every case (frozen versions; proposed vs approved values). */
export default function ModelPage() {
  const { modelId } = useParams<{ modelId: string }>();
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const router = useRouter();
  const q = useModel(modelId);
  const [dialog, setDialog] = useState<'edit' | 'create' | 'import' | null>(null);
  const base = finHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data!;
  const manage = can('finance.model.manage');
  const byCase = MODEL_CASES.map((c) => ({ modelCase: c, versions: m.versions.filter((v) => v.modelCase === c).sort((a, b) => b.versionNo - a.versionNo) })).filter((g) => g.versions.length > 0);
  return (
    <>
      <PageHeader
        eyebrow={<BackToList href={`${base}/models`} label={t('finance.models.title')} />}
        title={
          <span>
            <span dir="ltr">{m.code}</span> — <span dir="auto">{m.name}</span>
          </span>
        }
        documentTitle={`${m.code} — ${m.name}`}
        badges={
          <>
            <StatusBadge enumName="modelKinds" value={m.kind} tone="neutral" size="md" />
            {m.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          manage ? (
            <>
              <button type="button" className={btn.primary} onClick={() => setDialog('create')} data-testid="version-create">
                <FilePlus2 aria-hidden="true" className="size-4" />
                {t('finance.versions.create.action')}
              </button>
              <button type="button" className={btn.secondary} onClick={() => setDialog('import')} data-testid="version-import">
                <FileUp aria-hidden="true" className="size-4" />
                {t('finance.versions.import.action')}
              </button>
              <button type="button" className={btn.secondary} onClick={() => setDialog('edit')} data-testid="model-edit">
                <Pencil aria-hidden="true" className="size-4" />
                {t('finance.common.edit')}
              </button>
            </>
          ) : null
        }
      />
      <div className="space-y-6" data-testid="model-detail" data-kind={m.kind}>
        {m.kind === 'business_plan' ? (
          <Callout tone="warning" testId="approval-not-configured">
            {t('finance.models.approvalNotConfigured')}
          </Callout>
        ) : (
          <Callout testId="valuation-approval-rule">{t('finance.models.valuationApprovalRule')}</Callout>
        )}
        <Panel title={t('finance.models.details')}>
          <Facts
            items={[
              { label: t('finance.models.description'), value: <UText value={m.description} multiline />, wide: true },
              { label: t('finance.models.kind'), value: tStatus('modelKinds', m.kind) },
              { label: t('finance.common.classification'), value: tStatus('classifications', m.classification) },
              {
                label: t('finance.common.created'),
                value: (
                  <span>
                    <Person id={m.createdBy} people={m.people} /> · <span className="tabular">{formatDateTime(m.createdAt)}</span>
                  </span>
                ),
              },
            ]}
          />
        </Panel>
        <Panel title={t('finance.models.versions')} testId="model-versions">
          {byCase.length === 0 ? (
            <p className="text-sm text-muted" data-testid="no-versions">
              {t('finance.models.noVersionsHint')}
            </p>
          ) : (
            <div className="space-y-4">
              {byCase.map((g) => (
                <div key={g.modelCase}>
                  <h3 className="mb-2 text-sm font-semibold text-ink">{tStatus('modelCases', g.modelCase)}</h3>
                  <ScrollRegion label={tStatus('modelCases', g.modelCase)} className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <caption className="sr-only">{t('finance.models.versionsOfCase', { case: tStatus('modelCases', g.modelCase) })}</caption>
                      <thead className="bg-surface-muted">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.versions.version')}</th>
                          <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.versions.label')}</th>
                          <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.snapshots.approvalState')}</th>
                          <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.versions.approvedValues')}</th>
                          <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.snapshots.source')}</th>
                          <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.common.created')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.versions.map((v) => (
                          <tr key={v.id} className="border-t border-line" data-version={v.versionNo}>
                            <th scope="row" className="px-3 py-2 text-start font-medium">
                              <Link className={btn.link} href={`${base}/models/${m.id}/versions/${v.id}`} data-testid="version-link">
                                {t('finance.versions.versionNo', { version: v.versionNo })}
                              </Link>
                              {v.isDemo ? <DemoBadge className="ms-1" /> : null}
                            </th>
                            <td className="px-3 py-2" dir="auto">
                              {v.versionLabel}
                            </td>
                            <td className="px-3 py-2">
                              <span className="flex flex-wrap items-center gap-1">
                                <StatusBadge enumName="approvalStates" value={v.approvalState} />
                                {v.supersededById ? <span className="text-xs text-muted">{t('finance.versions.superseded')}</span> : null}
                              </span>
                            </td>
                            <td className="px-3 py-2">{v.hasApprovedValues ? t('finance.versions.approvedRecorded') : <span className="text-muted">{t('finance.versions.noApprovedValues')}</span>}</td>
                            <td className="px-3 py-2">{tStatus('sourceTypes', v.sourceType)}</td>
                            <td className="px-3 py-2">
                              <Person id={v.createdBy} people={m.people} /> · <span className="tabular">{formatDateTime(v.createdAt)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollRegion>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <FinanceHistory entityType="financial_model" entityId={m.id} />
      </div>
      {manage ? (
        <>
          <EditModelDialog model={m} open={dialog === 'edit'} onClose={() => setDialog(null)} />
          <NewVersionDialog model={m} imported={false} open={dialog === 'create'} onClose={() => setDialog(null)} onCreated={(id) => router.push(`${base}/models/${m.id}/versions/${id}`)} />
          <NewVersionDialog model={m} imported open={dialog === 'import'} onClose={() => setDialog(null)} onCreated={(id) => router.push(`${base}/models/${m.id}/versions/${id}`)} />
        </>
      ) : null}
    </>
  );
}
