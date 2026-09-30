'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleDashed, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { carveoutRoutes, documentsRoutes, gatesRoutes, governanceRoutes, planningRoutes as P, type RouteResponse } from '@hub/contracts';
import { FINAL_APPROVED_DECISION_STATES, type EvidenceTargetType, type PrerequisiteType } from '@hub/domain';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useLocalized } from '@/lib/i18n-data';
import { pk, useRefreshPlanning } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { ConfirmCommandDialog } from '../ConfirmCommandDialog';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { EvidenceTargetPicker, type PickedTarget } from '../EvidenceTargetPicker';
import { SelectField, TextAreaField } from '../Field';
import { LoadingState } from '../LoadingState';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../Toast';
import { btn, cx } from '../ui';
import { Section } from './bits';
import { FormDialog } from './dialogs';

type Prerequisite = RouteResponse<typeof P.listPrerequisites>['items'][number];
/** Types that can be picked on this screen (approval requests have no register screen yet — see the hint). */
type PickableType = Exclude<PrerequisiteType, 'approval_request'>;
const PICKABLE: readonly PickableType[] = ['decision', 'gate', 'agreement', 'evidence_link'];
const TYPE_READ: Record<PickableType, string> = {
  decision: 'governance.decision.read',
  gate: 'gates.gate.read',
  agreement: 'carveout.register.read',
  evidence_link: 'documents.document.read',
};

function recordHref(projectId: string, p: Prerequisite): string | null {
  switch (p.predecessorType) {
    case 'decision':
      return `/projects/${projectId}/committee/decisions/${p.predecessorId}`;
    case 'gate':
      return `/projects/${projectId}/gates/${p.predecessorId}`;
    case 'agreement':
      return `/projects/${projectId}/perimeter/agreements/${p.predecessorId}`;
    default:
      return null;
  }
}

/**
 * Non-schedule prerequisites of a task or milestone (DOM-P2-18): decisions, gates, agreements, approval requests and
 * evidence links that must be satisfied before the task can START / the milestone can be REPORTED ACHIEVED. They are not
 * schedule (CPM) dependencies. Only prerequisites whose record the caller can see are listed; the server counts all of
 * them when it refuses a start (`planning.prerequisite_pending`, count only).
 */
export function PrerequisitesPanel({ successorType, successorId, successorCode }: { successorType: 'task' | 'milestone'; successorId: string; successorCode: string }) {
  const { t, formatDateTime, formatNumber } = useI18n();
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<Prerequisite | null>(null);
  const q = useQuery({
    queryKey: [...pk.all(projectId), 'prerequisites', successorType, successorId],
    queryFn: ({ signal }) => api(P.listPrerequisites, { params: { projectId }, query: { successorType, successorId }, signal }),
  });
  const items = q.data?.items ?? [];
  const pending = items.filter((p) => !p.satisfied).length;
  const canManage = can('planning.dependency.manage');
  const blocked = successorType === 'task' ? 'planning.prerequisites.blocksStart' : 'planning.prerequisites.blocksReport';
  return (
    <Section
      id={`prereq-${successorId}`}
      title={t('planning.prerequisites.title')}
      hint={t('planning.prerequisites.hint')}
      actions={
        canManage ? (
          <button type="button" className={btn.secondary} onClick={() => setAddOpen(true)} data-testid="prerequisite-add">
            <Plus aria-hidden="true" className="size-4" />
            {t('planning.prerequisites.add')}
          </button>
        ) : null
      }
    >
      <div data-testid="prerequisites" data-pending={pending}>
        {q.isLoading ? <LoadingState compact /> : null}
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.data && items.length === 0 ? <EmptyState title={t('planning.prerequisites.empty')} hint={t('planning.prerequisites.emptyHint')} /> : null}
        {pending > 0 ? (
          <p role="note" className="mb-3 rounded-md border border-warning/40 bg-warning-soft p-2 text-sm text-ink" data-testid="prerequisites-pending">
            {t(blocked, { count: formatNumber(pending) })}
          </p>
        ) : null}
        {items.length > 0 ? (
          <ul className="divide-y divide-line">
            {items.map((p) => {
              const href = recordHref(projectId, p);
              return (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2" data-testid="prerequisite" data-type={p.predecessorType} data-satisfied={p.satisfied ? 'true' : 'false'}>
                  <div className="min-w-0 space-y-0.5 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      {p.satisfied ? (
                        <StatusBadge enumName="ragStatuses" value="satisfied" tone="success" label={t('planning.prerequisites.satisfied')} />
                      ) : (
                        <StatusBadge enumName="ragStatuses" value="pending" tone="warning" label={t('planning.prerequisites.unsatisfied')} />
                      )}
                      <span className="text-xs text-muted">{t(`planning.prerequisites.types.${p.predecessorType}`)}</span>
                    </p>
                    <p>
                      {href ? (
                        <Link href={href} className={btn.link} dir="auto">
                          {p.predecessorLabel}
                        </Link>
                      ) : (
                        <span dir="auto">{p.predecessorLabel || EM_DASH}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted">{t(`planning.prerequisites.rule.${p.predecessorType}`)}</p>
                    {p.note ? (
                      <p className="text-xs text-muted" dir="auto">
                        {p.note}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted">{t('planning.prerequisites.addedAt', { date: formatDateTime(p.createdAt) })}</p>
                  </div>
                  {canManage ? (
                    <button type="button" className={cx(btn.ghost, 'min-h-8 px-2 py-1')} onClick={() => setRemoving(p)} aria-label={t('planning.prerequisites.removeLabel', { label: p.predecessorLabel })} data-testid="prerequisite-remove">
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="mt-2 text-xs text-muted">{t('planning.prerequisites.hiddenNote')}</p>
      </div>
      {canManage ? <AddPrerequisiteDialog open={addOpen} onClose={() => setAddOpen(false)} successorType={successorType} successorId={successorId} successorCode={successorCode} /> : null}
      {removing ? (
        <ConfirmCommandDialog
          open
          onClose={() => setRemoving(null)}
          title={t('planning.prerequisites.removeTitle')}
          confirmLabel={t('planning.prerequisites.remove')}
          danger
          noteMode="required"
          noteLabel={t('planning.common.reason')}
          consequences={[
            t('planning.prerequisites.removeEffect', { code: successorCode, label: removing.predecessorLabel, type: t(`planning.prerequisites.types.${removing.predecessorType}`) }),
            // DOM-P2R-07: a reason, and — while it still blocks — not by the person accountable for the task / milestone.
            t('planning.prerequisites.removeRule'),
            t('common.command.audited'),
          ]}
          onConfirm={async ({ note }) => {
            await api(P.removePrerequisite, { params: { projectId, prerequisiteId: removing.id }, body: { reason: note } });
            await refresh();
            toast.show('success', t('planning.prerequisites.removed'));
            setRemoving(null);
          }}
        />
      ) : null}
    </Section>
  );
}

interface Option {
  id: string;
  label: string;
  hint?: string;
}

function AddPrerequisiteDialog({ open, onClose, successorType, successorId, successorCode }: { open: boolean; onClose: () => void; successorType: 'task' | 'milestone'; successorId: string; successorCode: string }) {
  const { t, tStatus } = useI18n();
  const loc = useLocalized();
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const types = PICKABLE.filter((ty) => can(TYPE_READ[ty]));
  const [type, setType] = useState<PickableType | ''>('');
  const [recordId, setRecordId] = useState('');
  const [evTarget, setEvTarget] = useState<PickedTarget | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setType(types[0] ?? '');
      setRecordId('');
      setEvTarget(null);
      setNote('');
    }
  }, [open]);

  const options = useQuery({
    queryKey: [...pk.all(projectId), 'prerequisite-options', type, evTarget?.type ?? '', evTarget?.id ?? ''],
    enabled: open && !!type && (type !== 'evidence_link' || !!evTarget),
    queryFn: async ({ signal }): Promise<Option[]> => {
      if (type === 'decision') {
        const r = await api(governanceRoutes.listDecisions, { params: { projectId }, query: { page: 1, pageSize: 100 }, signal });
        return r.items.map((d) => ({ id: d.id, label: `${d.code} — ${d.title}`, hint: tStatus('decisionStatuses', d.status) + ((FINAL_APPROVED_DECISION_STATES as readonly string[]).includes(d.status) ? '' : ` · ${t('planning.prerequisites.notYetFinal')}`) }));
      }
      if (type === 'gate') {
        const r = await api(gatesRoutes.listGates, { params: { projectId }, signal });
        return r.items.map((g) => ({ id: g.id, label: `${g.key} — ${loc(g.name, g.nameAr)}` }));
      }
      if (type === 'agreement') {
        const r = await api(carveoutRoutes.listAgreements, { params: { projectId }, query: { page: 1, pageSize: 100 }, signal });
        return r.items.map((a) => ({ id: a.id, label: `${a.code} — ${a.title}` }));
      }
      if (type === 'evidence_link' && evTarget) {
        const r = await api(documentsRoutes.listEvidence, { params: { projectId }, query: { targetType: evTarget.type as EvidenceTargetType, targetId: evTarget.id, includeInactive: 'false' }, signal });
        return r.items.map((l) => ({
          id: l.id,
          label: `${l.documentTitle ?? l.note ?? l.purpose ?? EM_DASH} (#${l.id.slice(-6)})`,
          hint: l.reviewedBy ? t('planning.prerequisites.evidenceVerified') : t('planning.prerequisites.evidenceUnverified'),
        }));
      }
      return [];
    },
  });
  const opts = options.data ?? [];
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      size="lg"
      testId="prerequisite-form"
      title={t('planning.prerequisites.addTitle', { code: successorCode })}
      submitLabel={t('planning.prerequisites.add')}
      disabled={!type || !recordId}
      onSubmit={async () => {
        if (!type) return;
        await api(P.createPrerequisite, { params: { projectId }, body: { successorType, successorId, predecessorType: type, predecessorId: recordId, note: note.trim() || undefined } });
        toast.show('success', t('planning.prerequisites.added'));
        await refresh();
        onClose();
      }}
    >
      <p className="text-sm text-muted">{t(successorType === 'task' ? 'planning.prerequisites.addHintTask' : 'planning.prerequisites.addHintMilestone')}</p>
      {types.length === 0 ? (
        <p role="note" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink">
          {t('planning.prerequisites.noTypes')}
        </p>
      ) : null}
      <SelectField
        label={t('planning.prerequisites.type')}
        required
        value={type}
        onChange={(e) => {
          setType(e.target.value as PickableType);
          setRecordId('');
          setEvTarget(null);
        }}
        hint={t('planning.prerequisites.approvalRequestHint')}
        data-testid="prerequisite-type"
      >
        {types.map((ty) => (
          <option key={ty} value={ty}>
            {t(`planning.prerequisites.types.${ty}`)}
          </option>
        ))}
      </SelectField>
      {type ? <p className="text-xs text-muted">{t(`planning.prerequisites.rule.${type}`)}</p> : null}
      {type === 'evidence_link' ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('planning.prerequisites.evidenceRecord')}</p>
          <EvidenceTargetPicker
            value={evTarget}
            onChange={(v) => {
              setEvTarget(v);
              setRecordId('');
            }}
          />
        </div>
      ) : null}
      {type && (type !== 'evidence_link' || evTarget) ? (
        <>
          {options.error ? <ErrorState error={options.error} onRetry={() => options.refetch()} /> : null}
          <SelectField label={t(`planning.prerequisites.pick.${type}`)} required value={recordId} onChange={(e) => setRecordId(e.target.value)} data-testid="prerequisite-record">
            <option value="">{options.isLoading ? t('planning.xproj.loading') : opts.length === 0 ? t('planning.prerequisites.noRecords') : t('planning.common.choose')}</option>
            {opts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.hint ? `${o.label} — ${o.hint}` : o.label}
              </option>
            ))}
          </SelectField>
        </>
      ) : null}
      <TextAreaField label={t('common.command.note')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
      <p className="flex items-start gap-2 text-xs text-muted">
        <CircleDashed aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {t('planning.prerequisites.notCpm')}
      </p>
      <p className="flex items-start gap-2 text-xs text-muted">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {t('planning.prerequisites.visibility')}
      </p>
    </FormDialog>
  );
}
