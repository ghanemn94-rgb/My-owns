'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Pencil, UserX } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { isApiError } from '@/lib/api';
import { finHref, useBenefit } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { BenefitCommandDialog, BenefitFormDialog, type BenefitCommand } from '../../_components/benefit-forms';
import { Amount, BackToList, ButtonRow, CmdButton, Facts, FinanceEvidence, FinanceHistory, Panel, Person, UText, useWorkstreamLabel } from '../../_components/fin';

const MANAGE_COMMANDS: BenefitCommand[] = ['start_tracking', 'record_realization', 'cancel'];
const VERIFY_COMMANDS: BenefitCommand[] = ['approve', 'verify', 'reject_realization'];

/** A benefit (REQ-FIN-009): definition, realization reported with its source, verified by someone independent. */
export default function BenefitPage() {
  const { benefitId } = useParams<{ benefitId: string }>();
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const scope = useWorkstreamLabel();
  const q = useBenefit(benefitId);
  const [cmd, setCmd] = useState<BenefitCommand | null>(null);
  const [edit, setEdit] = useState(false);
  const base = finHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data!;
  const allowed = b.allowedCommands as BenefitCommand[];
  const manage = can('finance.benefit.manage');
  const verifier = can('finance.benefit.verify');
  // Separation of duties (server-enforced; mirrored so the command is not offered to the people it excludes).
  const blocked: Partial<Record<BenefitCommand, MessageKey>> = {};
  if (me.user.id === b.createdBy) blocked.approve = 'finance.sod.youCreatedBenefit';
  if (me.user.id === b.ownerUserId) {
    blocked.approve = 'finance.sod.youOwnBenefit';
    blocked.verify = 'finance.sod.youOwnBenefit';
  }
  if (me.user.id === b.realizationRecordedBy) {
    blocked.verify = 'finance.sod.youReported';
    blocked.reject_realization = 'finance.sod.youReported';
  }
  const buttons: ReactNode[] = [];
  const reasons: [BenefitCommand, MessageKey][] = [];
  for (const c of allowed) {
    const permitted = (VERIFY_COMMANDS.includes(c) && verifier) || (MANAGE_COMMANDS.includes(c) && manage);
    if (!permitted) continue;
    const why = blocked[c];
    if (why) {
      reasons.push([c, why]);
      continue;
    }
    buttons.push(<CmdButton key={c} label={t(`finance.benefits.commands.${c}`)} onClick={() => setCmd(c)} testId={`cmd-${c}`} variant={c === 'cancel' || c === 'reject_realization' ? 'danger' : c === 'verify' || c === 'approve' ? 'primary' : 'secondary'} />);
  }
  const closed = b.status === 'realized_verified' || b.status === 'cancelled';
  return (
    <>
      <PageHeader
        eyebrow={<BackToList href={`${base}/benefits`} label={t('finance.benefits.title')} />}
        title={
          <span>
            <span dir="ltr">{b.code}</span> — <span dir="auto">{b.title}</span>
          </span>
        }
        documentTitle={`${b.code} — ${b.title}`}
        badges={
          <>
            <StatusBadge enumName="benefitStatuses" value={b.status} size="md" />
            {b.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          manage && !closed ? (
            <button type="button" className={btn.secondary} onClick={() => setEdit(true)} data-testid="benefit-edit">
              <Pencil aria-hidden="true" className="size-4" />
              {t('finance.common.edit')}
            </button>
          ) : null
        }
      />
      <div className="space-y-6" data-testid="benefit-detail" data-status={b.status}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t('finance.benefits.definitionTitle')} testId="benefit-definition">
            <Facts
              items={[
                { label: t('finance.benefits.definition'), value: <UText value={b.measurementDefinition} multiline />, wide: true },
                { label: t('finance.benefits.baseline'), value: <UText value={b.baselineValue} /> },
                { label: t('finance.benefits.target'), value: <UText value={b.targetValue} /> },
                { label: t('finance.benefits.unit'), value: <UText value={b.unit} /> },
                { label: t('finance.benefits.value'), value: <Amount value={b.value} showUnits /> },
                { label: t('finance.benefits.owner'), value: <Person id={b.ownerUserId} people={b.people} /> },
                { label: t('finance.benefits.realizationDate'), value: <span className="tabular">{formatDate(b.realizationDate)}</span> },
                { label: t('finance.benefits.verificationSource'), value: <UText value={b.verificationSource} multiline />, wide: true },
                { label: t('finance.common.workstream'), value: scope(b.workstreamId) },
                { label: t('finance.common.classification'), value: tStatus('classifications', b.classification) },
                {
                  label: t('finance.benefits.accepted'),
                  value: b.approvedBy ? (
                    <span>
                      <Person id={b.approvedBy} people={b.people} /> · <span className="tabular">{formatDateTime(b.approvedAt)}</span>
                    </span>
                  ) : (
                    EM_DASH
                  ),
                  wide: true,
                },
              ]}
            />
          </Panel>
          <Panel title={t('finance.benefits.realizationTitle')} testId="benefit-realization" actions={<ButtonRow>{buttons}</ButtonRow>}>
            <Facts
              items={[
                { label: t('finance.benefits.actual'), value: <UText value={b.actualValue} /> },
                { label: t('finance.benefits.realized'), value: <Amount value={b.realized} showUnits /> },
                { label: t('finance.benefits.realizedOn'), value: <span className="tabular">{formatDate(b.realizedOn)}</span> },
                {
                  label: t('finance.benefits.reportedBy'),
                  value: b.realizationRecordedBy ? (
                    <span>
                      <Person id={b.realizationRecordedBy} people={b.people} /> · <span className="tabular">{formatDateTime(b.realizationRecordedAt)}</span>
                    </span>
                  ) : (
                    EM_DASH
                  ),
                },
                {
                  label: t('finance.benefits.verifiedBy'),
                  value: b.verifiedBy ? (
                    <span data-testid="benefit-verified-by">
                      <Person id={b.verifiedBy} people={b.people} /> · <span className="tabular">{formatDateTime(b.verifiedAt)}</span>
                    </span>
                  ) : (
                    <span className="text-muted">{t('finance.benefits.notVerified')}</span>
                  ),
                  wide: true,
                },
                { label: t('finance.benefits.verificationNote'), value: <UText value={b.verificationNote} multiline />, wide: true },
                { label: t('finance.benefits.statusNote'), value: <UText value={b.statusNote} multiline />, wide: true },
                { label: t('finance.common.evidence'), value: <span className="tabular">{t('finance.common.evidenceCount', { active: b.evidence.active, conflicting: b.evidence.conflicting })}</span> },
              ]}
            />
            <ul className="mt-3 list-disc space-y-1 ps-5 text-sm text-ink" data-testid="who-may-act">
              <li>{t('finance.benefits.ruleApprove')}</li>
              <li>{t('finance.benefits.ruleVerify')}</li>
            </ul>
            {reasons.length ? (
              <ul className="mt-3 space-y-1" data-testid="sod-reasons">
                {reasons.map(([c, why]) => (
                  <li key={c} className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-2 text-sm text-ink" data-testid="sod-reason" data-command={c}>
                    <UserX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span>
                      <span className="font-semibold">{t(`finance.benefits.commands.${c}`)}: </span>
                      {t(why)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {buttons.length === 0 && reasons.length === 0 ? <p className="mt-3 text-sm text-muted">{t('finance.common.noCommands')}</p> : null}
          </Panel>
        </div>
        <Panel title={t('finance.benefits.kpis')} testId="benefit-kpis">
          {b.kpis.length === 0 ? (
            <p className="text-sm text-muted">{t('finance.benefits.noKpis')}</p>
          ) : (
            <ul className="flex flex-wrap gap-3 text-sm">
              {b.kpis.map((k) => (
                <li key={k.id}>
                  <Link className={btn.link} href={`${base}/kpis/${k.id}`}>
                    <code dir="ltr">{k.key}</code> — <span dir="auto">{k.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <FinanceEvidence targetType="benefit" targetId={b.id} classification={b.classification} />
        <FinanceHistory entityType="benefit" entityId={b.id} />
      </div>
      <BenefitCommandDialog key={cmd ?? 'none'} b={b} cmd={cmd} onClose={() => setCmd(null)} />
      {manage ? <BenefitFormDialog benefit={b} open={edit} onClose={() => setEdit(false)} /> : null}
    </>
  );
}
