'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { financeRoutes } from '@hub/contracts';
import { VALUATION_DECISION_TYPE_KEYS } from '@hub/domain';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { ScrollRegion } from '@/components/ScrollRegion';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { figureRights, finHref, useFinanceRefresh, useModel, useModelVersion, type FigureCommand, type ModelOutput, type ModelVersionDetail } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { ApprovalPanel, BackToList, Callout, DecisionSelect, Facts, FinCommandDialog, FinanceHistory, MessageList, Panel, Person, SourceText, UText } from '../../../../_components/fin';
import { OutputValue, VersionCheckPanel } from '../../../../_components/version-check';

function OutputsTable({ outputs, caption, testId }: { outputs: ModelOutput[]; caption: string; testId: string }) {
  const { t } = useI18n();
  return (
    <ScrollRegion label={caption} className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" data-testid={testId}>
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-muted">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.versions.outputLabel')}</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.versions.value')}</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.versions.measure')}</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.common.cellRef')}</th>
          </tr>
        </thead>
        <tbody>
          {outputs.map((o) => (
            <tr key={o.key} className="border-t border-line align-top" data-key={o.key} data-basis={o.basis}>
              <th scope="row" className="px-3 py-2 text-start font-medium">
                <span className="flex flex-col gap-0.5">
                  <span dir="auto">{o.label}</span>
                  <code className="text-xs font-normal text-muted" dir="ltr">
                    {o.key}
                  </code>
                </span>
              </th>
              <td className="px-3 py-2">
                <OutputValue o={o} />
              </td>
              <td className="px-3 py-2">{t(`finance.measures.${o.measure}`)}</td>
              <td className="px-3 py-2">{o.sheet || o.cell ? <code dir="ltr">{[o.sheet, o.cell].filter(Boolean).join('!')}</code> : <span className="text-muted">{EM_DASH}</span>}</td>
            </tr>
          ))}
          {outputs.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-2 text-muted">
                {t('finance.versions.noOutputs')}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function VersionCommandDialog({ modelId, v, kind, cmd, onClose }: { modelId: string; v: ModelVersionDetail; kind: string; cmd: FigureCommand | null; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const [decisionId, setDecisionId] = useState('');
  if (!cmd || cmd === 'reopen') return null;
  const params = { projectId, modelId, versionId: v.id };
  const common = { open: true, onClose, expectedVersion: v.version, onReload: () => void refresh() };
  const done = async (msg: string) => {
    await refresh();
    toast.show('success', msg);
    onClose();
  };
  if (cmd === 'validate') {
    return (
      <FinCommandDialog
        {...common}
        title={t('finance.versions.validate.title', { version: v.versionNo })}
        confirmLabel={t('finance.commands.validate')}
        noteMode="required"
        noteLabel={t('finance.figure.validate.note')}
        consequences={[t('finance.versions.validate.effect'), t('finance.figure.validate.sod'), t('common.command.audited')]}
        onConfirm={async ({ note }) => {
          await api(financeRoutes.validateModelVersion, { params, body: { expectedVersion: v.version, note } });
          await done(t('finance.figure.validate.done'));
        }}
      />
    );
  }
  if (cmd === 'approve') {
    if (kind !== 'valuation') return null;
    return (
      <FinCommandDialog
        {...common}
        title={t('finance.versions.approve.title', { version: v.versionNo })}
        confirmLabel={t('finance.versions.approve.confirm')}
        confirmDisabled={!decisionId}
        consequences={[t('finance.versions.approve.effect'), t('finance.figure.approve.sod'), t('common.command.audited')]}
        onConfirm={async ({ note }) => {
          await api(financeRoutes.approveModelValues, { params, body: { expectedVersion: v.version, decisionId, ...(note ? { note } : {}) } });
          await done(t('finance.versions.approve.done'));
        }}
      >
        <DecisionSelect typeKeys={VALUATION_DECISION_TYPE_KEYS} value={decisionId} onChange={setDecisionId} />
      </FinCommandDialog>
    );
  }
  return (
    <FinCommandDialog
      {...common}
      danger
      title={t('finance.versions.reject.title', { version: v.versionNo })}
      confirmLabel={t('finance.commands.reject')}
      noteMode="required"
      noteLabel={t('finance.common.reason')}
      consequences={[t('finance.figure.reject.effect'), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        await api(financeRoutes.rejectModelVersion, { params, body: { expectedVersion: v.version, note } });
        await done(t('finance.figure.reject.done'));
      }}
    />
  );
}

/**
 * A frozen model version (REQ-FIN-005..008, REQ-FIN-010): assumptions, proposed values, approved values (empty until an
 * approval is recorded from a final governance decision), EV / equity / currency / unit findings and the approval trail.
 */
export default function ModelVersionPage() {
  const { modelId, versionId } = useParams<{ modelId: string; versionId: string }>();
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const model = useModel(modelId);
  const q = useModelVersion(modelId, versionId);
  const [cmd, setCmd] = useState<FigureCommand | null>(null);
  const base = finHref(projectId);
  if (q.isLoading || model.isLoading) return <LoadingState />;
  const err = q.error ?? model.error;
  if (err) return isApiError(err) && (err.status === 404 || err.status === 403) ? <RestrictedState /> : <ErrorState error={err} onRetry={() => q.refetch()} />;
  const v = q.data!;
  const m = model.data!;
  const businessPlan = v.kind === 'business_plan';
  const rights = figureRights({ state: v.approvalState, createdBy: v.createdBy, approval: v.approval }, me.user.id, can('finance.snapshot.approve'), { superseded: !!v.supersededById });
  rights.reopen = { offered: false, reason: null };
  if (businessPlan) rights.approve = { offered: false, reason: null };
  const priorHref = v.basedOnVersionId ? `${base}/models/${m.id}/versions/${v.basedOnVersionId}` : null;
  return (
    <>
      <PageHeader
        eyebrow={<BackToList href={`${base}/models/${m.id}`} label={`${m.code} — ${m.name}`} />}
        title={t('finance.versions.heading', { code: m.code, case: tStatus('modelCases', v.modelCase), version: v.versionNo, label: v.versionLabel })}
        badges={
          <>
            <StatusBadge enumName="approvalStates" value={v.approvalState} size="md" />
            <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-muted" data-testid="frozen-badge">
              <Lock aria-hidden="true" className="size-3.5" />
              {t('finance.versions.frozen')}
            </span>
            {v.isDemo ? <DemoBadge /> : null}
          </>
        }
      />
      <div className="space-y-6" data-testid="version-detail" data-state={v.approvalState} data-kind={v.kind}>
        {v.supersededById ? (
          <Callout tone="warning" testId="superseded">
            {t('finance.versions.supersededNote')}{' '}
            <Link className={btn.link} href={`${base}/models/${m.id}/versions/${v.supersededById}`}>
              {t('finance.versions.openNewer')}
            </Link>
          </Callout>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t('finance.versions.proposedValues')} testId="proposed-values">
            <p className="mb-2 text-sm text-muted">{t('finance.versions.proposedHint')}</p>
            <OutputsTable outputs={v.outputs} caption={t('finance.versions.proposedValues')} testId="outputs-table" />
            <p className="mt-2 text-sm">
              {t('finance.versions.headlineBasis')}: <strong>{v.headlineBasis ? tStatus('valueBases', v.headlineBasis) : EM_DASH}</strong>
            </p>
          </Panel>
          <Panel title={t('finance.versions.approvedValues')} testId="approved-values">
            {v.approvedValues ? (
              <OutputsTable outputs={v.approvedValues} caption={t('finance.versions.approvedValues')} testId="approved-table" />
            ) : (
              <p className="text-sm text-ink" data-testid="approved-values-empty">
                {businessPlan ? t('finance.models.approvalNotConfigured') : t('finance.versions.approvedEmpty')}
              </p>
            )}
          </Panel>
        </div>
        <Panel title={t('finance.versions.findings')} testId="version-findings">
          <MessageList messages={v.findingsI18n} fallback={v.findings} tone="warning" empty={t('finance.versions.noFindings')} />
          <p className="mt-2 text-xs text-muted">{t('finance.check.notValuation')}</p>
        </Panel>
        <div className="grid gap-6 lg:grid-cols-2">
          <ApprovalPanel
            approval={v.approval}
            createdBy={v.createdBy}
            people={v.people}
            rights={rights}
            onCommand={setCmd}
            approveRule={businessPlan ? undefined : t('finance.versions.approveRule')}
            notices={
              businessPlan ? (
                <Callout tone="warning" testId="approval-not-configured">
                  {t('finance.models.approvalNotConfigured')}
                </Callout>
              ) : null
            }
            decisionHref={v.approval.approvalDecisionId ? `/projects/${projectId}/committee/decisions/${v.approval.approvalDecisionId}` : null}
          />
          <Panel title={t('finance.versions.source')}>
            <Facts
              items={[
                { label: t('finance.snapshots.source'), value: <SourceText sourceType={v.sourceType} sourceRef={v.sourceRef} sourceDocumentId={v.sourceDocumentId} />, wide: true },
                { label: t('finance.versions.changeNote'), value: <UText value={v.changeNote} multiline />, wide: true },
                {
                  label: t('finance.versions.basedOnLabel'),
                  value: priorHref ? (
                    <Link className={btn.link} href={priorHref}>
                      {t('finance.versions.openPrior')}
                    </Link>
                  ) : (
                    t('finance.versions.firstOfCase')
                  ),
                },
                { label: t('finance.common.classification'), value: tStatus('classifications', v.classification) },
                {
                  label: t('finance.common.created'),
                  value: (
                    <span>
                      <Person id={v.createdBy} people={v.people} /> · <span className="tabular">{formatDateTime(v.createdAt)}</span>
                    </span>
                  ),
                  wide: true,
                },
              ]}
            />
            {v.diffFromBasedOn ? (
              <div className="mt-3 text-sm" data-testid="version-diff">
                <h3 className="font-semibold text-ink">{t('finance.versions.diff')}</h3>
                <ul className="mt-1 space-y-0.5">
                  <li>
                    {t('finance.versions.diffAdded')}: <code dir="ltr">{v.diffFromBasedOn.added.join(', ') || EM_DASH}</code>
                  </li>
                  <li>
                    {t('finance.versions.diffChanged')}: <code dir="ltr">{v.diffFromBasedOn.changed.join(', ') || EM_DASH}</code>
                  </li>
                  <li>
                    {t('finance.versions.diffRemoved')}: <code dir="ltr">{v.diffFromBasedOn.removed.join(', ') || EM_DASH}</code>
                  </li>
                </ul>
              </div>
            ) : null}
          </Panel>
        </div>
        <Panel title={t('finance.versions.assumptions')} testId="assumptions">
          {v.assumptions.length === 0 ? (
            <p className="text-sm text-muted">{t('finance.versions.noAssumptions')}</p>
          ) : (
            <ScrollRegion label={t('finance.versions.assumptions')} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">{t('finance.versions.assumptions')}</caption>
                <thead className="bg-surface-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.versions.assumptionKey')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.versions.assumptionValue')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.versions.assumptionUnit')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.versions.assumptionSource')}</th>
                  </tr>
                </thead>
                <tbody>
                  {v.assumptions.map((a) => (
                    <tr key={a.key} className="border-t border-line">
                      <th scope="row" className="px-3 py-2 text-start font-medium">
                        <code dir="ltr">{a.key}</code>
                      </th>
                      <td className="px-3 py-2" dir="auto">
                        {a.value}
                      </td>
                      <td className="px-3 py-2" dir="auto">
                        {a.unit ?? EM_DASH}
                      </td>
                      <td className="px-3 py-2" dir="auto">
                        {a.source ?? EM_DASH}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </Panel>
        <VersionCheckPanel model={m} versionId={v.id} />
        <FinanceHistory entityType="financial_model_version" entityId={v.id} />
      </div>
      <VersionCommandDialog key={cmd ?? 'none'} modelId={m.id} v={v} kind={v.kind} cmd={cmd} onClose={() => setCmd(null)} />
    </>
  );
}
