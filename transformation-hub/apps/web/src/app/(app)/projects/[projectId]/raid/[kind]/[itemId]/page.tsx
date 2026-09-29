'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Pencil, TriangleAlert, UserCog } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { SelectField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { CommandBar } from '@/components/planning/CommandBar';
import { useRaidCommands } from '@/components/planning/commands';
import { BackLink } from '@/components/planning/DetailShell';
import { DateText, Fact, Section } from '@/components/planning/bits';
import { OwnerDialog } from '@/components/planning/dialogs';
import { RaidFormDialog } from '@/components/planning/raid';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { pk, RAID_KIND_PATHS, raidHref, useRefreshPlanning, type RaidItem, type RaidKindPath } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';

function RaiseIssueDialog({ open, onClose, risk }: { open: boolean; onClose: () => void; risk: RaidItem }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const router = useRouter();
  const [sev, setSev] = useState('4');
  return (
    <ConfirmCommandDialog
      open={open}
      onClose={onClose}
      title={t('planning.raid.raiseIssue')}
      confirmLabel={t('planning.raid.raiseIssue')}
      consequences={[t('planning.raid.raiseIssueEffect', { code: risk.code }), t('common.command.audited')]}
      noteMode="none"
      expectedVersion={risk.version}
      onConfirm={async () => {
        const r = await api(P.raiseIssueFromRisk, { params: { projectId, itemId: risk.id }, body: { expectedVersion: risk.version, severity: Number(sev) } });
        await refresh();
        toast.show('success', t('planning.common.createdCode', { code: r.code ?? '' }));
        onClose();
        router.push(raidHref(projectId, 'issues', r.id));
      }}
    >
      <SelectField label={t('planning.raid.severity')} required value={sev} onChange={(e) => setSev(e.target.value)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={String(n)}>
            {n} — {t(`planning.raid.scale_${n as 1}`)}
          </option>
        ))}
      </SelectField>
    </ConfirmCommandDialog>
  );
}

export default function RaidItemPage() {
  const { t, formatNumber } = useI18n();
  const params = useParams<{ kind: string; itemId: string }>();
  const kind = params.kind as RaidKindPath;
  const valid = RAID_KIND_PATHS.includes(kind);
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const q = useQuery({ queryKey: pk.raidItem(projectId, kind, params.itemId), queryFn: ({ signal }) => api(P.getRaid, { params: { projectId, kind, itemId: params.itemId }, signal }), enabled: valid });
  const commands = useRaidCommands(kind, q.data);
  const [edit, setEdit] = useState(false);
  const [owner, setOwner] = useState(false);
  const [raise, setRaise] = useState(false);
  if (!valid) return <RestrictedState />;
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const open = ['open', 'monitoring', 'escalated'].includes(r.status);
  return (
    <SectionGuard section="raid">
      <BackLink href={`/projects/${projectId}/raid?tab=${kind}`} label={t('planning.raid.back')} />
      <PageHeader
        eyebrow={
          <span>
            <span dir="ltr">{r.code}</span> · {t(`planning.raid.kind_${r.kind}`)}
          </span>
        }
        title={<span dir="auto">{r.title}</span>}
        documentTitle={`${r.code} — ${r.title}`}
        badges={
          <>
            <StatusBadge enumName="raidStatuses" value={r.status} size="md" />
            {r.escalationLevel > 0 ? <StatusBadge enumName="ragStatuses" value="red" tone="danger" label={t('planning.raid.levelShort', { level: r.escalationLevel })} /> : null}
            {r.overdue ? <StatusBadge enumName="ragStatuses" value="red" tone="danger" label={t('planning.common.overdue')} /> : null}
            {r.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          <>
            {r.kind === 'risk' && open && can('planning.raid.manage') ? (
              <button type="button" className={btn.secondary} onClick={() => setRaise(true)}>
                <TriangleAlert aria-hidden="true" className="size-4" />
                {t('planning.raid.raiseIssue')}
              </button>
            ) : null}
            {can('planning.raid.manage') && !['closed', 'cancelled'].includes(r.status) ? (
              <button type="button" className={btn.secondary} onClick={() => setEdit(true)}>
                <Pencil aria-hidden="true" className="size-4" />
                {t('planning.common.edit')}
              </button>
            ) : null}
            {can(r.ownerUserId ? 'planning.ownership.reassign' : 'planning.raid.manage') ? (
              <button type="button" className={btn.secondary} onClick={() => setOwner(true)}>
                <UserCog aria-hidden="true" className="size-4" />
                {t('planning.owner.assign')}
              </button>
            ) : null}
          </>
        }
      />
      <CommandBar className="mb-6" commands={commands} allowed={r.allowedCommands} expectedVersion={r.version} onDone={refresh} onReload={() => void q.refetch()} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="r-facts" title={t('planning.raid.facts')}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label={t('planning.task.description')} wide>
              <span dir="auto" className="whitespace-pre-line">{r.description ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.common.owner')}>{r.ownerName ? <span dir="auto">{r.ownerName}</span> : <span className="text-muted">{t('planning.common.unassigned')}</span>}</Fact>
            <Fact label={t('planning.common.workstream')}>
              <span dir="ltr">{r.workstreamCode ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.common.due')}>
              <DateText value={r.dueDate} overdue={r.overdue && r.kind !== 'dependency'} />
            </Fact>
            <Fact label={t('planning.common.gate')}>
              <span dir="ltr">{r.gateKey ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.raid.escalationLevel')}>{formatNumber(r.escalationLevel)}</Fact>
          </dl>
        </Section>
        <Section id="r-kind" title={t(`planning.raid.kind_${r.kind}`)}>
          <dl className="grid gap-3 sm:grid-cols-2">
            {r.kind === 'risk' ? (
              <>
                <Fact label={t('planning.raid.exposureScore')}>
                  {r.probability} × {r.impact} = <strong>{r.score}</strong> ({t(`planning.raid.rating_${(r.rating ?? 'low') as 'low'}`)})
                </Fact>
                <Fact label={t('planning.raid.strategy')}>{r.responseStrategy ? t(`planning.raid.strategy_${r.responseStrategy as 'avoid'}`) : EM_DASH}</Fact>
                <Fact label={t('planning.raid.moneyExposure')}>{r.exposure ? <span dir="ltr">{r.exposure.amount} {r.exposure.currency} (×{r.exposure.unitScale})</span> : EM_DASH}</Fact>
                <Fact label={t('planning.raid.trigger')} wide>
                  <span dir="auto">{r.trigger ?? EM_DASH}</span>
                </Fact>
                <Fact label={t('planning.raid.response')} wide>
                  <span dir="auto">{r.response ?? EM_DASH}</span>
                </Fact>
              </>
            ) : null}
            {r.kind === 'issue' ? (
              <>
                <Fact label={t('planning.raid.severity')}>
                  {r.severity} {r.blocking ? <span className="font-semibold text-danger">· {t('planning.raid.blocking')}</span> : null}
                </Fact>
                <Fact label={t('planning.raid.fromRisk')}>
                  {r.raisedFromRiskId ? (
                    <Link className={btn.link} href={raidHref(projectId, 'risks', r.raisedFromRiskId)}>
                      {t('planning.raid.openRisk')}
                    </Link>
                  ) : (
                    EM_DASH
                  )}
                </Fact>
                <Fact label={t('planning.raid.resolution')} wide>
                  <span dir="auto">{r.resolution ?? EM_DASH}</span>
                </Fact>
              </>
            ) : null}
            {r.kind === 'assumption' ? (
              <>
                <Fact label={t('planning.raid.verification')}>
                  <StatusBadge enumName="verificationStatuses" value={r.verificationStatus} />
                </Fact>
                <Fact label={t('planning.raid.basis')} wide>
                  <span dir="auto">{r.basis ?? EM_DASH}</span>
                </Fact>
                <Fact label={t('planning.raid.validationPlan')} wide>
                  <span dir="auto">{r.validationPlan ?? EM_DASH}</span>
                </Fact>
              </>
            ) : null}
            {r.kind === 'dependency' ? (
              <>
                <Fact label={t('planning.raid.dependsOn')} wide>
                  <span dir="auto">{r.dependsOn ?? EM_DASH}</span>
                </Fact>
                <Fact label={t('planning.raid.neededBy')}>
                  <DateText value={r.neededBy} overdue={r.overdue} />
                </Fact>
              </>
            ) : null}
          </dl>
        </Section>
      </div>
      <ActivityHistory className="mt-6" projectId={projectId} entityType={r.kind === 'dependency' ? 'raid_dependency' : r.kind} entityId={r.id} />
      <RaidFormDialog open={edit} onClose={() => setEdit(false)} kind={kind} item={r} />
      {r.kind === 'risk' ? <RaiseIssueDialog open={raise} onClose={() => setRaise(false)} risk={r} /> : null}
      <OwnerDialog
        open={owner}
        onClose={() => setOwner(false)}
        title={t('planning.owner.title', { code: r.code })}
        current={r.ownerName}
        version={r.version}
        run={(userId, reason) => api(P.assignRaidOwner, { params: { projectId, kind, itemId: r.id }, body: { expectedVersion: r.version, userId, reason } })}
      />
    </SectionGuard>
  );
}
