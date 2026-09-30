'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { jvRoutes } from '@hub/contracts';
import { MATERIALITY } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { jk, jvHref, useJvRefresh, useMemberNames, useRoomNames, type Finding } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { ButtonRow, Callout, CmdButton, Facts, JvCommandDialog, Panel, Person, UText } from '../../../_components/jv';

type FindingCommand = 'plan_remediation' | 'mark_remediated' | 'accept_risk' | 'close' | 'reopen';
const COMMANDS: readonly FindingCommand[] = ['plan_remediation', 'mark_remediated', 'accept_risk', 'close', 'reopen'];

function EditFindingDialog({ f, onClose }: { f: Finding; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const [title, setTitle] = useState(f.title);
  const [materiality, setMateriality] = useState(f.materiality);
  const [remediation, setRemediation] = useState(f.remediation ?? '');
  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [dueDate, setDueDate] = useState(f.remediationDueDate ?? '');
  const [valuation, setValuation] = useState(f.valuationImplication ?? '');
  const [documentImpl, setDocumentImpl] = useState(f.documentImplication ?? '');
  const [cpImpl, setCpImpl] = useState(f.cpImplication ?? '');
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.findings.edit.title')}
      confirmLabel={t('jv.common.save')}
      noteMode="none"
      expectedVersion={f.version}
      confirmDisabled={!title.trim()}
      consequences={[t('jv.findings.edit.effect'), t('jv.findings.materialRule'), t('common.command.audited')]}
      onConfirm={async () => {
        await api(jvRoutes.updateFinding, {
          params: { projectId, findingId: f.id },
          body: {
            expectedVersion: f.version,
            title: title.trim(),
            materiality,
            remediation: remediation.trim() || null,
            remediationDueDate: dueDate || null,
            valuationImplication: valuation.trim() || null,
            documentImplication: documentImpl.trim() || null,
            cpImplication: cpImpl.trim() || null,
            ...(owner ? { remediationOwnerUserId: owner.id } : {}),
          },
        });
        await refresh();
        toast.show('success', t('jv.common.saved'));
        onClose();
      }}
    >
      <TextField label={t('jv.findings.fields.title')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
      <SelectField label={t('jv.findings.fields.materiality')} required value={materiality} onChange={(e) => setMateriality(e.target.value as Finding['materiality'])}>
        {MATERIALITY.map((m) => (
          <option key={m} value={m}>
            {tStatus('materiality', m)}
          </option>
        ))}
      </SelectField>
      <TextAreaField label={t('jv.findings.fields.remediation')} value={remediation} maxLength={4000} onChange={(e) => setRemediation(e.target.value)} />
      <UserPicker label={t('jv.findings.fields.ownerChange')} value={owner} onChange={setOwner} />
      <TextField label={t('jv.findings.fields.dueDate')} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      <TextAreaField label={t('jv.findings.fields.valuation')} value={valuation} maxLength={4000} onChange={(e) => setValuation(e.target.value)} />
      <TextAreaField label={t('jv.findings.fields.documentImpl')} value={documentImpl} maxLength={4000} onChange={(e) => setDocumentImpl(e.target.value)} />
      <TextAreaField label={t('jv.findings.fields.cpImpl')} value={cpImpl} maxLength={4000} onChange={(e) => setCpImpl(e.target.value)} />
    </JvCommandDialog>
  );
}

/** A DD finding with its materiality, remediation (owner) and valuation / document / CP implications. */
export default function FindingPage() {
  const { findingId } = useParams<{ findingId: string }>();
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const rooms = useRoomNames();
  const members = useMemberNames();
  const [pending, setPending] = useState<FindingCommand | 'edit' | null>(null);
  const q = useQuery({ queryKey: jk.finding(projectId, findingId), queryFn: ({ signal }) => api(jvRoutes.getFinding, { params: { projectId, findingId }, signal }) });
  const base = jvHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const f = q.data!;
  const canManage = can('jv.finding.manage');
  const cmds = canManage ? COMMANDS.filter((c) => f.allowedCommands.includes(c)) : [];
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`${base}/diligence?tab=findings`} className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t('jv.findings.title')}
          </Link>
        }
        title={
          <span>
            <span dir="ltr">{f.code}</span> — <span dir="auto">{f.title}</span>
          </span>
        }
        documentTitle={`${f.code} — ${f.title}`}
        badges={
          <>
            <StatusBadge enumName="findingStatuses" value={f.status} size="md" />
            <StatusBadge enumName="materiality" value={f.materiality} />
            {f.material ? <span className="text-xs font-semibold text-danger">{t('jv.findings.material')}</span> : null}
            {f.isDemo ? <DemoBadge /> : null}
          </>
        }
        description={f.description ? <UText value={f.description} multiline /> : undefined}
      />
      <div className="space-y-6" data-testid="finding-detail" data-status={f.status}>
        {f.material && !f.remediationOwnerUserId ? <Callout tone="danger">{t('jv.findings.materialRule')}</Callout> : null}
        <Panel
          title={t('jv.common.commands')}
          testId="finding-commands"
          actions={
            <ButtonRow>
              {cmds.map((c) => (
                <CmdButton key={c} label={t(`jv.findings.cmd.${c}`)} onClick={() => setPending(c)} testId={`cmd-${c}`} />
              ))}
              {canManage ? <CmdButton label={t('jv.common.edit')} onClick={() => setPending('edit')} testId="cmd-edit-finding" /> : null}
            </ButtonRow>
          }
        >
          {!canManage ? <p className="text-sm text-muted">{t('jv.common.noCommands')}</p> : null}
        </Panel>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t('jv.findings.remediationTitle')} testId="finding-remediation">
            <Facts
              items={[
                { label: t('jv.findings.fields.remediation'), value: <UText value={f.remediation} multiline />, wide: true },
                { label: t('jv.findings.fields.owner'), value: <Person id={f.remediationOwnerUserId} people={members} />, testId: 'remediation-owner' },
                { label: t('jv.findings.fields.dueDate'), value: <span className="tabular">{formatDate(f.remediationDueDate)}</span> },
                { label: t('jv.findings.fields.statusReason'), value: <UText value={f.statusReason} /> },
              ]}
            />
          </Panel>
          <Panel title={t('jv.findings.implicationsTitle')} testId="finding-implications">
            <Facts
              items={[
                { label: t('jv.findings.fields.valuation'), value: <UText value={f.valuationImplication} multiline />, wide: true },
                { label: t('jv.findings.fields.documentImpl'), value: <UText value={f.documentImplication} multiline />, wide: true },
                { label: t('jv.findings.fields.cpImpl'), value: <UText value={f.cpImplication} multiline />, wide: true },
                { label: t('jv.findings.fields.condition'), value: f.conditionId ? <Link className={btn.link} href={`${base}/closing/conditions/${f.conditionId}`}>{t('jv.findings.openCondition')}</Link> : EM_DASH },
              ]}
            />
          </Panel>
        </div>
        <Panel title={t('jv.common.details')}>
          <Facts
            items={[
              { label: t('jv.dd.fields.room'), value: f.roomId ? <Link className={btn.link} href={`${base}/rooms/${f.roomId}`}><span dir="auto">{rooms.label(f.roomId)}</span></Link> : t('jv.findings.projectLevel') },
              { label: t('jv.findings.fields.request'), value: f.diligenceRequestId ? <Link className={btn.link} href={`${base}/diligence/requests/${f.diligenceRequestId}`}>{t('jv.findings.openRequest')}</Link> : EM_DASH },
              { label: t('jv.findings.fields.risk'), value: f.riskId ? <Link className={btn.link} href={`/projects/${projectId}/raid/risks/${f.riskId}`}>{t('jv.findings.openRisk')}</Link> : EM_DASH },
              { label: t('jv.common.classification'), value: tStatus('classifications', f.classification) },
              { label: t('jv.common.createdAt'), value: <span className="tabular">{formatDateTime(f.createdAt)}</span> },
              { label: t('jv.common.updated'), value: <span className="tabular">{formatDateTime(f.updatedAt)}</span> },
            ]}
          />
        </Panel>
        <ActivityHistory projectId={projectId} entityType="diligence_finding" entityId={f.id} />
      </div>
      {pending === 'edit' ? <EditFindingDialog key={f.version} f={f} onClose={() => setPending(null)} /> : null}
      {pending && pending !== 'edit' ? (
        <JvCommandDialog
          open
          onClose={() => setPending(null)}
          title={t(`jv.findings.cmd.${pending}`)}
          confirmLabel={t(`jv.findings.cmd.${pending}`)}
          noteMode={pending === 'accept_risk' || pending === 'reopen' ? 'required' : 'optional'}
          expectedVersion={f.version}
          consequences={[t(`jv.findings.effect.${pending}`), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const r = await api(jvRoutes.transitionFinding, { params: { projectId, findingId: f.id }, body: { expectedVersion: f.version, command: pending, ...(note ? { note } : {}) } });
            await refresh();
            toast.show('success', t('jv.common.statusNow', { status: tStatus('findingStatuses', r.status) }));
            setPending(null);
          }}
        />
      ) : null}
    </>
  );
}
