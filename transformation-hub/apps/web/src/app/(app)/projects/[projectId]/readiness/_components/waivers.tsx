'use client';

import { useState } from 'react';
import { readinessRoutes } from '@hub/contracts';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { useReadinessRefresh, type People, type ReadinessWaiver } from '@/lib/readiness';
import { Person, RdCommandDialog } from './rd';

/** Basis / impact / conditions of a waiver (user text). */
export function WaiverText({ w }: { w: ReadinessWaiver }) {
  const { t, formatDate } = useI18n();
  return (
    <dl className="space-y-1 text-xs">
      <div>
        <dt className="inline font-semibold">{t('readiness.check.waivers.basis')}: </dt>
        <dd className="inline" dir="auto">
          {w.basis}
        </dd>
      </div>
      <div>
        <dt className="inline font-semibold">{t('readiness.check.waivers.impact')}: </dt>
        <dd className="inline" dir="auto">
          {w.impact}
        </dd>
      </div>
      {w.conditions ? (
        <div>
          <dt className="inline font-semibold">{t('readiness.check.waivers.conditions')}: </dt>
          <dd className="inline" dir="auto">
            {w.conditions}
          </dd>
        </div>
      ) : null}
      {w.expiresOn ? (
        <div>
          <dt className="inline font-semibold">{t('readiness.check.waivers.expiresOn')}: </dt>
          <dd className="inline tabular">{formatDate(w.expiresOn)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function WaiverStatus({ w, people }: { w: ReadinessWaiver; people: People | undefined }) {
  const { t, formatDateTime } = useI18n();
  return (
    <span className="flex flex-col items-start gap-1 text-xs">
      <StatusBadge enumName="waiverStatuses" value={w.status} />
      {w.status === 'approved' ? <span className={w.effective ? 'text-success' : 'text-danger'}>{w.effective ? t('readiness.waivers.effective') : t('readiness.waivers.notEffective')}</span> : null}
      {w.decidedBy ? (
        <span className="text-muted">
          <Person id={w.decidedBy} people={people} /> · <span className="tabular">{formatDateTime(w.decidedAt)}</span>
        </span>
      ) : null}
      {w.decisionNote ? (
        <span className="text-muted" dir="auto">
          {w.decisionNote}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Approve / reject commands of a requested waiver. Shown to holders of the waiver-approval permission who are not the
 * requester; the server additionally requires the specialist-set authority role (N-02) and refuses with a reason.
 */
export function WaiverDecisionButtons({ w, code }: { w: ReadinessWaiver; code: string }) {
  const { t, tStatus } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useReadinessRefresh();
  const toast = useToast();
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  if (w.status !== 'requested' || !can('gates.waiver.approve') || w.requestedBy === me.user.id) return null;
  return (
    <>
      <span className="flex flex-wrap gap-2">
        <button type="button" className={cx(btn.primary, 'min-h-9 px-2.5 py-1')} onClick={() => setMode('approve')} data-testid="waiver-approve" aria-label={`${t('readiness.waivers.approve.action')} — ${code}`}>
          {t('readiness.waivers.approve.action')}
        </button>
        <button type="button" className={cx(btn.secondary, 'min-h-9 px-2.5 py-1')} onClick={() => setMode('reject')} data-testid="waiver-reject" aria-label={`${t('readiness.waivers.reject.action')} — ${code}`}>
          {t('readiness.waivers.reject.action')}
        </button>
      </span>
      {mode === 'approve' ? (
        <RdCommandDialog
          open
          onClose={() => setMode(null)}
          title={t('readiness.waivers.approve.title', { code })}
          confirmLabel={t('readiness.waivers.approve.confirm')}
          noteMode="optional"
          expectedVersion={w.version}
          consequences={[
            t('readiness.waivers.approve.effect'),
            w.authorityRole ? t('readiness.check.waivers.authority', { role: tStatus('roleKeys', w.authorityRole) }) : t('readiness.waivers.approve.authorityHint'),
            t('common.command.audited'),
          ]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.approveReadinessWaiver, { params: { projectId, waiverId: w.id }, body: { expectedVersion: w.version, ...(note ? { note } : {}) } });
            await refresh();
            toast.show('success', t('readiness.waivers.approve.done'));
            setMode(null);
          }}
        />
      ) : null}
      {mode === 'reject' ? (
        <RdCommandDialog
          open
          onClose={() => setMode(null)}
          title={t('readiness.waivers.reject.title', { code })}
          confirmLabel={t('readiness.waivers.reject.confirm')}
          noteMode="required"
          noteLabel={t('readiness.common.reason')}
          expectedVersion={w.version}
          danger
          consequences={[t('readiness.waivers.reject.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.rejectReadinessWaiver, { params: { projectId, waiverId: w.id }, body: { expectedVersion: w.version, note } });
            await refresh();
            toast.show('success', t('readiness.waivers.reject.done'));
            setMode(null);
          }}
        />
      ) : null}
    </>
  );
}

export function AuthorityRole({ role }: { role: string | null }) {
  const { tStatus } = useI18n();
  return role ? <span>{tStatus('roleKeys', role)}</span> : <span className="text-muted">{EM_DASH}</span>;
}
