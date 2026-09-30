'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { readinessRoutes } from '@hub/contracts';
import { ROLE_KEYS, type RoleKey } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { EvidencePanel } from '@/components/EvidencePanel';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { rdHref, rk, useReadinessRefresh, type ReadinessCheckDetail } from '@/lib/readiness';
import { ButtonRow, Callout, CmdButton, CriticalityBadges, Facts, Panel, Person, RdCommandDialog, UText, useScopeLabels } from '../../_components/rd';
import { AuthorityRole, WaiverDecisionButtons, WaiverStatus, WaiverText } from '../../_components/waivers';

type Cmd = 'test' | 'signoff' | 'determine' | 'reopen' | 'waiver' | 'edit' | null;

function CheckDialogs({ c, cmd, onClose }: { c: ReadinessCheckDetail; cmd: Cmd; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useReadinessRefresh();
  const toast = useToast();
  const [result, setResult] = useState<'passed' | 'failed'>('failed');
  const [outcome, setOutcome] = useState<'passed' | 'not_applicable'>('passed');
  const [mandatory, setMandatory] = useState(c.mandatory);
  const [blocker, setBlocker] = useState(c.blocker);
  const [waivable, setWaivable] = useState(c.waivable);
  const [authority, setAuthority] = useState<RoleKey | ''>(c.waiverAuthorityRole ?? '');
  const [basis, setBasis] = useState('');
  const [impact, setImpact] = useState('');
  const [conditions, setConditions] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [title, setTitle] = useState(c.title);
  const [contingency, setContingency] = useState(c.failureContingency ?? '');
  const [dueDate, setDueDate] = useState(c.dueDate ?? '');
  const params = { projectId, checkId: c.id };
  const done = async (msg: string) => {
    await refresh();
    toast.show('success', msg);
    onClose();
  };
  switch (cmd) {
    case 'test':
      return (
        <RdCommandDialog
          open
          onClose={onClose}
          title={t('readiness.check.record.title')}
          confirmLabel={t('readiness.check.record.confirm')}
          expectedVersion={c.version}
          consequences={[t('readiness.check.record.effect'), t('readiness.check.record.effectFail'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const r = await api(readinessRoutes.recordReadinessTest, { params, body: { expectedVersion: c.version, result, ...(note ? { note } : {}) } });
            await done(t('readiness.check.record.done', { seq: r.seq }));
          }}
        >
          <SelectField label={t('readiness.check.record.result')} required value={result} onChange={(e) => setResult(e.target.value as 'passed' | 'failed')} data-testid="test-result">
            <option value="failed">{t('readiness.check.record.failed')}</option>
            <option value="passed">{t('readiness.check.record.passed')}</option>
          </SelectField>
        </RdCommandDialog>
      );
    case 'signoff':
      return (
        <RdCommandDialog
          open
          onClose={onClose}
          title={t('readiness.check.signoff.title')}
          confirmLabel={t('readiness.check.signoff.confirm')}
          noteMode={outcome === 'not_applicable' ? 'required' : 'optional'}
          expectedVersion={c.version}
          consequences={[t('readiness.check.signoff.effect'), t('readiness.check.signoff.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.signOffReadinessCheck, { params, body: { expectedVersion: c.version, outcome, ...(note ? { note } : {}) } });
            await done(t('readiness.check.signoff.done'));
          }}
        >
          <SelectField label={t('readiness.check.signoff.outcome')} required value={outcome} onChange={(e) => setOutcome(e.target.value as 'passed' | 'not_applicable')} data-testid="signoff-outcome">
            <option value="passed">{t('readiness.check.signoff.passed')}</option>
            <option value="not_applicable">{t('readiness.check.signoff.notApplicable')}</option>
          </SelectField>
        </RdCommandDialog>
      );
    case 'determine':
      return (
        <RdCommandDialog
          open
          onClose={onClose}
          title={t('readiness.check.determine.title')}
          confirmLabel={t('readiness.check.determine.confirm')}
          noteMode="none"
          expectedVersion={c.version}
          confirmDisabled={!basis.trim() || (waivable && !authority)}
          consequences={[t('readiness.check.determine.effect'), t('common.command.audited')]}
          onConfirm={async () => {
            await api(readinessRoutes.determineReadinessCheck, {
              params,
              body: { expectedVersion: c.version, mandatory, blocker, waivable, waiverAuthorityRole: waivable && authority ? authority : null, basis: basis.trim() },
            });
            await done(t('readiness.check.determine.done'));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
              {t('readiness.check.determine.mandatory')}
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={blocker} onChange={(e) => setBlocker(e.target.checked)} />
              {t('readiness.check.determine.blocker')}
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={waivable} onChange={(e) => setWaivable(e.target.checked)} data-testid="determine-waivable" />
              {t('readiness.check.determine.waivable')}
            </label>
          </div>
          {waivable ? (
            <SelectField label={t('readiness.check.determine.authority')} required value={authority} onChange={(e) => setAuthority(e.target.value as RoleKey | '')} data-testid="determine-authority">
              <option value="">{t('readiness.common.select')}</option>
              {ROLE_KEYS.map((r) => (
                <option key={r} value={r}>
                  {tStatus('roleKeys', r)}
                </option>
              ))}
            </SelectField>
          ) : null}
          <TextAreaField label={t('readiness.check.determine.basis')} required value={basis} maxLength={4000} onChange={(e) => setBasis(e.target.value)} data-testid="determine-basis" />
        </RdCommandDialog>
      );
    case 'reopen':
      return (
        <RdCommandDialog
          open
          onClose={onClose}
          title={t('readiness.check.reopen.title')}
          confirmLabel={t('readiness.check.reopen.confirm')}
          noteMode="required"
          noteLabel={t('readiness.common.reason')}
          expectedVersion={c.version}
          consequences={[t('readiness.check.reopen.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.reopenReadinessCheck, { params, body: { expectedVersion: c.version, note } });
            await done(t('readiness.check.reopen.done'));
          }}
        />
      );
    case 'waiver':
      return (
        <RdCommandDialog
          open
          onClose={onClose}
          title={t('readiness.check.waivers.requestTitle')}
          confirmLabel={t('readiness.check.waivers.requestConfirm')}
          noteMode="none"
          confirmDisabled={!basis.trim() || !impact.trim()}
          consequences={[
            c.waivable ? t('readiness.check.waivers.requestEffect') : t('readiness.check.waivers.nonWaivable'),
            ...(c.waiverAuthorityRole ? [t('readiness.check.waivers.authority', { role: tStatus('roleKeys', c.waiverAuthorityRole) })] : []),
            t('common.command.audited'),
          ]}
          onConfirm={async () => {
            await api(readinessRoutes.requestReadinessWaiver, {
              params,
              body: { basis: basis.trim(), impact: impact.trim(), ...(conditions.trim() ? { conditions: conditions.trim() } : {}), ...(expiresOn ? { expiresOn } : {}) },
            });
            await done(t('readiness.check.waivers.done'));
          }}
        >
          <TextAreaField label={t('readiness.check.waivers.basis')} required value={basis} maxLength={4000} onChange={(e) => setBasis(e.target.value)} data-testid="waiver-basis" />
          <TextAreaField label={t('readiness.check.waivers.impact')} required value={impact} maxLength={4000} onChange={(e) => setImpact(e.target.value)} data-testid="waiver-impact" />
          <TextField label={t('readiness.check.waivers.conditions')} value={conditions} maxLength={4000} onChange={(e) => setConditions(e.target.value)} />
          <TextField label={t('readiness.check.waivers.expiresOn')} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </RdCommandDialog>
      );
    case 'edit':
      return (
        <RdCommandDialog
          open
          onClose={onClose}
          title={t('readiness.check.edit.title')}
          confirmLabel={t('readiness.common.save')}
          noteMode="none"
          expectedVersion={c.version}
          confirmDisabled={!title.trim()}
          consequences={[t('readiness.check.edit.effect'), t('common.command.audited')]}
          onConfirm={async () => {
            const r = await api(readinessRoutes.updateReadinessCheck, {
              params,
              body: { expectedVersion: c.version, title: title.trim(), failureContingency: contingency.trim() || null, dueDate: dueDate || null },
            });
            await done(r.version === c.version ? t('readiness.common.noChanges') : t('readiness.common.saved'));
          }}
        >
          <TextField label={t('readiness.checks.create.titleField')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
          <TextAreaField label={t('readiness.checks.create.contingency')} value={contingency} maxLength={8000} onChange={(e) => setContingency(e.target.value)} data-testid="edit-contingency" />
          <TextField label={t('readiness.checks.create.dueDate')} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </RdCommandDialog>
      );
    default:
      return null;
  }
}

export default function ReadinessCheckPage() {
  const { checkId } = useParams<{ checkId: string }>();
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const { siteName, wsName, projectLevel } = useScopeLabels();
  const [cmd, setCmd] = useState<Cmd>(null);
  const q = useQuery({ queryKey: rk.check(projectId, checkId), queryFn: ({ signal }) => api(readinessRoutes.getReadinessCheck, { params: { projectId, checkId }, signal }) });
  const base = rdHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;
  const people = c.people;
  const canManage = can('readiness.check.manage');
  const canSpecialist = can('readiness.check.signoff');
  const cleared = c.status === 'passed' || c.status === 'not_applicable' || c.status === 'waived';
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`${base}/checks`} className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t('readiness.checks.title')}
          </Link>
        }
        title={
          <span>
            <span dir="ltr">{c.code}</span> — <span dir="auto">{c.title}</span>
          </span>
        }
        documentTitle={`${c.code} — ${c.title}`}
        badges={
          <>
            <StatusBadge enumName="readinessStatuses" value={c.status} size="md" />
            <CriticalityBadges mandatory={c.mandatory} blocker={c.blocker} waivable={c.waivable} />
            {c.isDemo ? <DemoBadge /> : null}
          </>
        }
        description={c.titleAr ? <span dir="rtl">{c.titleAr}</span> : undefined}
      />
      <div className="space-y-6" data-testid="check-detail" data-status={c.status}>
        <Panel
          title={t('readiness.common.commands')}
          testId="check-commands"
          actions={
            <ButtonRow>
              {canManage && c.status !== 'not_applicable' ? <CmdButton label={t('readiness.check.record.action')} onClick={() => setCmd('test')} testId="cmd-test" variant="primary" /> : null}
              {canSpecialist && (c.status === 'not_started' || c.status === 'in_progress') ? <CmdButton label={t('readiness.check.signoff.action')} onClick={() => setCmd('signoff')} testId="cmd-signoff" /> : null}
              {canSpecialist ? <CmdButton label={t('readiness.check.determine.action')} onClick={() => setCmd('determine')} testId="cmd-determine" /> : null}
              {canSpecialist && cleared ? <CmdButton label={t('readiness.check.reopen.action')} onClick={() => setCmd('reopen')} testId="cmd-reopen" /> : null}
              {can('gates.waiver.request') && !cleared ? <CmdButton label={t('readiness.check.waivers.request')} onClick={() => setCmd('waiver')} testId="cmd-waiver" /> : null}
              {canManage ? <CmdButton label={t('readiness.common.edit')} onClick={() => setCmd('edit')} testId="cmd-edit" /> : null}
            </ButtonRow>
          }
        >
          {!canManage && !canSpecialist ? <p className="text-sm text-muted">{t('readiness.common.noCommands')}</p> : <p className="text-sm text-muted">{t('readiness.check.signoff.sod')}</p>}
        </Panel>

        <Panel title={t('readiness.check.contingencyTitle')} testId="check-contingency" className={c.status === 'failed' ? 'border-danger/50' : undefined}>
          {c.status === 'failed' && c.blocker ? <Callout tone="danger">{t('readiness.plan.go.blocked')}</Callout> : null}
          <p className="mt-2 text-sm">{c.failureContingency ? <UText value={c.failureContingency} multiline /> : <span className="text-muted">{t('readiness.check.contingencyNone')}</span>}</p>
        </Panel>

        <Panel title={t('readiness.common.details')}>
          <Facts
            items={[
              { label: t('readiness.check.facts.area'), value: tStatus('readinessAreas', c.area) },
              {
                label: t('readiness.check.facts.scope'),
                value: (
                  <span className="flex flex-col">
                    <span>{c.siteId ? siteName(c.siteId) : projectLevel}</span>
                    {c.workstreamId ? <span className="text-muted">{wsName(c.workstreamId)}</span> : null}
                    {c.cutoverPlanId ? (
                      <Link className={btn.link} href={`${base}/cutover/${c.cutoverPlanId}`}>
                        {t('readiness.checks.scopePlan', { plan: `#${c.cutoverPlanId.slice(-6)}` })}
                      </Link>
                    ) : null}
                  </span>
                ),
              },
              { label: t('readiness.check.facts.signoffRole'), value: <AuthorityRole role={c.signoffRole} /> },
              { label: t('readiness.check.facts.owner'), value: <Person id={c.ownerUserId} people={people} /> },
              {
                label: t('readiness.check.facts.signedOff'),
                value: c.signedOffBy ? (
                  <span>
                    <Person id={c.signedOffBy} people={people} /> · <span className="tabular">{formatDateTime(c.signedOffAt)}</span>
                    {c.signoffNote ? (
                      <span className="block text-muted" dir="auto">
                        {c.signoffNote}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  EM_DASH
                ),
                testId: 'fact-signedoff',
              },
              { label: t('readiness.check.facts.dueDate'), value: <span className="tabular">{formatDate(c.dueDate)}</span> },
              {
                label: t('readiness.check.facts.waivability'),
                value: c.waivabilityDeterminedBy ? (c.waivable ? t('readiness.checks.waivable') : t('readiness.checks.nonWaivable')) : t('readiness.check.notDetermined'),
              },
              { label: t('readiness.check.facts.waiverAuthority'), value: <AuthorityRole role={c.waiverAuthorityRole} /> },
              { label: t('readiness.check.facts.waivabilityBasis'), value: <UText value={c.waivabilityBasis} />, wide: true },
              {
                label: t('readiness.check.facts.determinedBy'),
                value: c.waivabilityDeterminedBy ? (
                  <span>
                    <Person id={c.waivabilityDeterminedBy} people={people} /> · <span className="tabular">{formatDateTime(c.waivabilityDeterminedAt)}</span>
                  </span>
                ) : (
                  EM_DASH
                ),
              },
              { label: t('readiness.check.facts.createdBy'), value: <Person id={c.createdBy} people={people} /> },
            ]}
          />
        </Panel>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">{t('readiness.check.tests.title')}</h2>
          <p className="text-sm text-muted">{t('readiness.check.tests.hint')}</p>
          <DataTable
            caption={t('readiness.check.tests.title')}
            columns={[
              { key: 'seq', header: t('readiness.check.tests.seq'), isRowHeader: true, cell: (r) => <span className="tabular">{r.seq}</span> },
              { key: 'result', header: t('readiness.check.tests.result'), cell: (r) => <StatusBadge enumName="readinessStatuses" value={r.result} /> },
              { key: 'note', header: t('readiness.check.tests.note'), cell: (r) => <UText value={r.note} /> },
              { key: 'by', header: t('readiness.check.tests.by'), cell: (r) => <Person id={r.recordedBy} people={people} /> },
              { key: 'at', header: t('readiness.check.tests.at'), cell: (r) => <span className="tabular">{formatDateTime(r.recordedAt)}</span> },
            ]}
            rows={c.testRuns}
            rowKey={(r) => r.id}
            emptyTitle={t('readiness.check.tests.empty')}
            testId="test-runs"
          />
        </section>

        <section className="space-y-2" data-testid="check-waivers">
          <h2 className="text-lg font-semibold text-ink">{t('readiness.check.waivers.title')}</h2>
          {!c.waivable ? <Callout tone="warning">{t('readiness.check.waivers.nonWaivable')}</Callout> : null}
          <DataTable
            caption={t('readiness.check.waivers.title')}
            columns={[
              { key: 'text', header: t('readiness.waivers.columns.basis'), isRowHeader: true, cell: (w) => <WaiverText w={w} /> },
              { key: 'authority', header: t('readiness.waivers.columns.authority'), cell: (w) => <AuthorityRole role={w.authorityRole} /> },
              { key: 'requested', header: t('readiness.waivers.columns.requested'), cell: (w) => <Person id={w.requestedBy} people={people} /> },
              { key: 'status', header: t('readiness.waivers.columns.status'), cell: (w) => <WaiverStatus w={w} people={people} /> },
              { key: 'commands', header: t('readiness.waivers.columns.commands'), cell: (w) => <WaiverDecisionButtons w={w} code={c.code} /> },
            ]}
            rows={c.waivers}
            rowKey={(w) => w.id}
            emptyTitle={t('readiness.check.waivers.empty')}
          />
        </section>

        <EvidencePanel targetType="readiness_check" targetId={c.id} title={t('readiness.check.evidenceTitle')} />
        <ActivityHistory projectId={projectId} entityType="readiness_check" entityId={c.id} />
      </div>
      {cmd ? <CheckDialogs key={`${cmd}-${c.version}`} c={c} cmd={cmd} onClose={() => setCmd(null)} /> : null}
      <span hidden data-me={me.user.id} />
    </>
  );
}
