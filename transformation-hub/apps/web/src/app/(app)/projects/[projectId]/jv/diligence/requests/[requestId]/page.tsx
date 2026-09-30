'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { jvRoutes } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, cx } from '@/components/ui';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { jk, jvHref, useJvRefresh, useRoomNames, type DdRequestDetail } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { ButtonRow, Callout, CmdButton, DocumentLink, DocumentPicker, Facts, JvCommandDialog, Panel, Person, UText } from '../../../_components/jv';

type Cmd = 'assign' | 'draft' | 'submit' | 'review' | 'release' | null;
const FLOW = ['draft', 'in_review', 'approved_for_release', 'released'] as const;

function RequestDialogs({ r, cmd, onClose }: { r: DdRequestDetail; cmd: Cmd; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const params = { projectId, requestId: r.id };
  const [assignee, setAssignee] = useState<PickedUser | null>(null);
  const [reviewer, setReviewer] = useState<PickedUser | null>(null);
  const [dueDate, setDueDate] = useState(r.dueDate ?? '');
  const [answer, setAnswer] = useState(r.answerDraft ?? '');
  const [evidence, setEvidence] = useState<string[]>(r.evidenceDocumentIds);
  const [outcome, setOutcome] = useState<'approve' | 'return' | 'withhold'>('approve');
  const done = async (msg: string) => {
    await refresh();
    toast.show('success', msg);
    onClose();
  };
  const common = { open: true, onClose, expectedVersion: r.version };
  switch (cmd) {
    case 'assign':
      return (
        <JvCommandDialog
          {...common}
          title={t('jv.dd.cmd.assign.title')}
          confirmLabel={t('jv.dd.cmd.assign.confirm')}
          noteMode="none"
          confirmDisabled={!assignee}
          consequences={[t('jv.dd.cmd.assign.effect'), t('jv.dd.cmd.assign.roomWorkers'), t('common.command.audited')]}
          onConfirm={async () => {
            if (!assignee) return;
            await api(jvRoutes.assignDdRequest, { params, body: { expectedVersion: r.version, assigneeUserId: assignee.id, ...(reviewer ? { reviewerUserId: reviewer.id } : {}), dueDate: dueDate || null } });
            await done(t('jv.common.saved'));
          }}
        >
          <UserPicker label={t('jv.dd.fields.assignee')} required value={assignee} onChange={setAssignee} />
          <UserPicker label={t('jv.dd.fields.reviewer')} value={reviewer} onChange={setReviewer} />
          <TextField label={t('jv.dd.fields.dueDate')} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </JvCommandDialog>
      );
    case 'draft':
      return (
        <JvCommandDialog
          {...common}
          title={t('jv.dd.cmd.draft.title')}
          confirmLabel={t('jv.dd.cmd.draft.confirm')}
          noteMode="none"
          confirmDisabled={!answer.trim()}
          consequences={[t('jv.dd.cmd.draft.effect'), t('jv.dd.releaseRule'), t('common.command.audited')]}
          onConfirm={async () => {
            await api(jvRoutes.draftDdAnswer, { params, body: { expectedVersion: r.version, answerDraft: answer.trim(), evidenceDocumentIds: evidence } });
            await done(t('jv.common.saved'));
          }}
        >
          <TextAreaField label={t('jv.dd.fields.answer')} required rows={6} value={answer} maxLength={20000} onChange={(e) => setAnswer(e.target.value)} data-testid="dd-answer" />
          <DocumentPicker
            label={t('jv.dd.fields.evidence')}
            roomId={r.roomId}
            value=""
            selected={evidence}
            onChange={(id) => setEvidence((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))}
          />
          <p className="text-xs text-muted">{t('jv.dd.fields.evidenceSelected', { count: evidence.length })}</p>
        </JvCommandDialog>
      );
    case 'submit':
      return (
        <JvCommandDialog
          {...common}
          title={t('jv.dd.cmd.submit.title')}
          confirmLabel={t('jv.dd.cmd.submit.confirm')}
          consequences={[t('jv.dd.cmd.submit.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.submitDdAnswer, { params, body: { expectedVersion: r.version, ...(note ? { note } : {}) } });
            await done(t('jv.common.saved'));
          }}
        />
      );
    case 'review':
      return (
        <JvCommandDialog
          {...common}
          title={t('jv.dd.cmd.review.title')}
          confirmLabel={t(`jv.dd.cmd.review.${outcome}`)}
          danger={outcome === 'withhold'}
          consequences={[t(`jv.dd.cmd.review.effect.${outcome}`), t('jv.dd.cmd.review.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.reviewDdAnswer, { params, body: { expectedVersion: r.version, outcome, ...(note ? { note } : {}) } });
            await done(t('jv.common.saved'));
          }}
        >
          <SelectField label={t('jv.common.outcome')} required value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} data-testid="review-outcome">
            <option value="approve">{t('jv.dd.cmd.review.approve')}</option>
            <option value="return">{t('jv.dd.cmd.review.return')}</option>
            <option value="withhold">{t('jv.dd.cmd.review.withhold')}</option>
          </SelectField>
        </JvCommandDialog>
      );
    case 'release':
      return (
        <JvCommandDialog
          {...common}
          title={t('jv.dd.cmd.release.title')}
          confirmLabel={t('jv.dd.cmd.release.confirm')}
          consequences={[t('jv.dd.cmd.release.effect'), t('jv.dd.cmd.release.evidence', { count: r.evidenceDocumentIds.length }), t('jv.rooms.noCopyPrevention'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const x = await api(jvRoutes.releaseDdAnswer, { params, body: { expectedVersion: r.version, ...(note ? { note } : {}) } });
            await done(t('jv.dd.cmd.release.done', { count: x.disclosures }));
          }}
        />
      );
    default:
      return null;
  }
}

/** DD request / Q&A: answer draft → review (another person) → approved release → released to the partner room. */
export default function DdRequestPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const rooms = useRoomNames();
  const [cmd, setCmd] = useState<Cmd>(null);
  const q = useQuery({ queryKey: jk.ddRequest(projectId, requestId), queryFn: ({ signal }) => api(jvRoutes.getDdRequest, { params: { projectId, requestId }, signal }) });
  const base = jvHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data!;
  const people = r.people;
  const allowed = r.allowedCommands;
  const iAmDrafter = r.draftedBy === me.user.id;
  const commands = [
    { key: 'assign' as const, show: can('jv.dd_request.assign') && r.releaseStatus !== 'released' },
    { key: 'draft' as const, show: can('jv.dd_answer.draft') && r.releaseStatus === 'draft' },
    { key: 'submit' as const, show: can('jv.dd_answer.draft') && allowed.includes('submit_for_review') && !!r.answerDraft },
    { key: 'review' as const, show: can('jv.dd_answer.review') && r.releaseStatus === 'in_review' && !iAmDrafter && (!r.reviewerUserId || r.reviewerUserId === me.user.id) },
    { key: 'release' as const, show: can('jv.disclosure.release') && r.releaseStatus === 'approved_for_release' && !iAmDrafter },
  ].filter((c) => c.show);
  const step = FLOW.indexOf(r.releaseStatus as (typeof FLOW)[number]);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`${base}/diligence`} className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t('jv.dd.title')}
          </Link>
        }
        title={t('jv.dd.detailTitle', { number: r.number })}
        badges={
          <>
            <StatusBadge enumName="ddReleaseStatuses" value={r.releaseStatus} size="md" />
            <span className="text-xs text-muted">{tStatus('ddDomains', r.domain)}</span>
            <span className="text-xs text-muted">{tStatus('ddRequestOrigins', r.origin)}</span>
            {r.isDemo ? <DemoBadge /> : null}
          </>
        }
        description={<UText value={r.question} multiline />}
      />
      <div className="space-y-6" data-testid="dd-detail" data-status={r.releaseStatus}>
        <Panel title={t('jv.dd.flowTitle')} testId="dd-flow">
          <ol className="flex flex-wrap gap-1.5" aria-label={t('jv.dd.flowTitle')}>
            {FLOW.map((s, i) => (
              <li key={s} aria-current={s === r.releaseStatus ? 'step' : undefined} className={cx('rounded-full border px-2.5 py-1 text-xs font-medium', s === r.releaseStatus ? 'border-primary bg-primary text-primary-contrast' : i < step ? 'border-success/40 bg-success-soft text-success' : 'border-line text-muted')}>
                {tStatus('ddReleaseStatuses', s)}
              </li>
            ))}
            {r.releaseStatus === 'withheld' ? (
              <li aria-current="step" className="rounded-full border border-warning/40 bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning">
                {tStatus('ddReleaseStatuses', 'withheld')}
              </li>
            ) : null}
          </ol>
          <Callout className="mt-3">{t('jv.dd.releaseRule')}</Callout>
        </Panel>
        <Panel
          title={t('jv.common.commands')}
          testId="dd-commands"
          actions={
            <ButtonRow>
              {commands.map((c) => (
                <CmdButton key={c.key} label={t(`jv.dd.cmd.${c.key}.action`)} onClick={() => setCmd(c.key)} testId={`cmd-${c.key}`} variant={c.key === 'release' || c.key === 'review' ? 'primary' : 'secondary'} />
              ))}
            </ButtonRow>
          }
        >
          {commands.length === 0 ? <p className="text-sm text-muted">{t('jv.common.noCommands')}</p> : null}
          {iAmDrafter && (r.releaseStatus === 'in_review' || r.releaseStatus === 'approved_for_release') ? <p className="text-sm text-muted">{t('jv.dd.drafterNote')}</p> : null}
        </Panel>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t('jv.dd.answerTitle')} testId="dd-answer-panel">
            <Facts
              items={[
                { label: t('jv.dd.fields.answerDraft'), value: <UText value={r.answerDraft} multiline />, wide: true },
                { label: t('jv.dd.fields.draftedBy'), value: <Person id={r.draftedBy} people={people} /> },
                {
                  label: t('jv.dd.fields.evidence'),
                  value: r.evidenceDocumentIds.length ? (
                    <span className="flex flex-col">
                      {r.evidenceDocumentIds.map((id) => (
                        <DocumentLink key={id} id={id} />
                      ))}
                    </span>
                  ) : (
                    EM_DASH
                  ),
                },
                { label: t('jv.dd.fields.submittedBy'), value: r.submittedForReviewBy ? <span><Person id={r.submittedForReviewBy} people={people} /> · <span className="tabular">{formatDateTime(r.submittedForReviewAt)}</span></span> : EM_DASH },
                { label: t('jv.dd.fields.releaseApprovedBy'), value: r.releaseApprovedBy ? <span><Person id={r.releaseApprovedBy} people={people} /> · <span className="tabular">{formatDateTime(r.releaseApprovedAt)}</span></span> : EM_DASH },
                { label: t('jv.dd.fields.reviewNote'), value: <UText value={r.reviewNote} /> },
              ]}
            />
          </Panel>
          <Panel title={t('jv.dd.releasedTitle')} description={t('jv.dd.releasedHint')} testId="dd-released">
            <Facts
              items={[
                { label: t('jv.dd.fields.releasedAnswer'), value: <UText value={r.releasedAnswer} multiline />, wide: true },
                { label: t('jv.dd.fields.releasedVersion'), value: r.releasedVersion ?? EM_DASH },
                { label: t('jv.dd.fields.releasedBy'), value: r.releasedBy ? <span><Person id={r.releasedBy} people={people} /> · <span className="tabular">{formatDateTime(r.releasedAt)}</span></span> : EM_DASH },
              ]}
            />
          </Panel>
        </div>
        <Panel title={t('jv.common.details')}>
          <Facts
            items={[
              { label: t('jv.dd.fields.room'), value: r.roomId ? <Link className={btn.link} href={`${base}/rooms/${r.roomId}`}><span dir="auto">{rooms.label(r.roomId)}</span></Link> : EM_DASH },
              { label: t('jv.dd.fields.requesterLabel'), value: <UText value={r.requesterLabel} /> },
              { label: t('jv.dd.fields.assignee'), value: <Person id={r.assigneeUserId} people={people} /> },
              { label: t('jv.dd.fields.reviewer'), value: <Person id={r.reviewerUserId} people={people} /> },
              { label: t('jv.dd.fields.dueDate'), value: <span className="tabular">{formatDate(r.dueDate)}</span> },
              { label: t('jv.common.classification'), value: tStatus('classifications', r.classification) },
              { label: t('jv.common.createdBy'), value: <Person id={r.createdBy} people={people} /> },
              { label: t('jv.common.createdAt'), value: <span className="tabular">{formatDateTime(r.createdAt)}</span> },
            ]}
          />
          <p className="mt-3 text-sm">
            <Link className={btn.link} href={`${base}/diligence?tab=findings&roomId=${r.roomId ?? ''}`}>
              {t('jv.dd.findingsOfRoom')}
            </Link>
          </p>
        </Panel>
        <ActivityHistory projectId={projectId} entityType="diligence_request" entityId={r.id} />
      </div>
      {cmd ? <RequestDialogs key={`${cmd}-${r.version}`} r={r} cmd={cmd} onClose={() => setCmd(null)} /> : null}
    </>
  );
}
