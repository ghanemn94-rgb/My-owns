'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { governanceRoutes } from '@hub/contracts';
import { FINAL_APPROVED_DECISION_STATES } from '@hub/domain';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { ErrorState } from '../ErrorState';
import { SelectField } from '../Field';
import { StatusBadge } from '../StatusBadge';
import { btn } from '../ui';
import { MoneyText } from './money';

export type ApprovalDecisionType = 'baseline_approval' | 'change_request_budget';
/** The record being approved: a decision backs it only when raised for it (DOM-P2R-03). */
export interface ApprovalSubject {
  subjectType: 'change_request' | 'baseline_version';
  subjectId: string;
}

const FINAL: readonly string[] = FINAL_APPROVED_DECISION_STATES;

/**
 * Optional `decisionId` of a baseline / change-request approval (DOM-P2-03): outside the approver's delegated authority —
 * or when no approved matrix is in force — the approval must rest on a FINAL committee decision of the matching type that
 * covers the amount (approved within the committee mandate, or approved by the external authority and recorded) and that
 * was raised for THIS record (DOM-P2R-03). Only such decisions are offered; the server re-checks finality, the evidence of an
 * external approval, type, subject, amount, currency, project and single use.
 */
export function ApprovalDecisionPicker({ decisionTypeKey, subject, value, onChange }: { decisionTypeKey: ApprovalDecisionType; subject: ApprovalSubject; value: string; onChange: (id: string) => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const readable = can('governance.decision.read');
  const list = useQuery({
    queryKey: ['gov', projectId, 'decisions', { approvalPicker: decisionTypeKey, ...subject }],
    queryFn: ({ signal }) => api(governanceRoutes.listDecisions, { params: { projectId }, query: { page: 1, pageSize: 100, subjectType: subject.subjectType, subjectId: subject.subjectId, decisionTypeKey }, signal }),
    enabled: readable,
  });
  const selected = useQuery({
    queryKey: ['gov', projectId, 'decision', value],
    queryFn: ({ signal }) => api(governanceRoutes.getDecision, { params: { projectId, decisionId: value }, signal }),
    enabled: readable && !!value,
  });
  const typeLabel = t(`planning.approvalDecision.types.${decisionTypeKey}`);
  if (!readable) {
    return (
      <p role="note" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink" data-testid="approval-decision-restricted">
        {t('planning.approvalDecision.noAccess')}
      </p>
    );
  }
  const ofType = (list.data?.items ?? []).filter((d) => d.decisionTypeKey === decisionTypeKey);
  const final = ofType.filter((d) => FINAL.includes(d.status));
  const notFinal = ofType.length - final.length;
  const d = selected.data;
  return (
    <div className="space-y-2" data-testid="approval-decision-picker">
      {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
      <SelectField
        label={t('planning.approvalDecision.label')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        hint={`${t('planning.approvalDecision.hint', { type: typeLabel })} ${t('planning.approvalDecision.subjectHint')}`}
        data-testid="approval-decision-select"
      >
        <option value="">{list.isLoading ? t('planning.approvalDecision.loading') : t('planning.approvalDecision.none')}</option>
        {final.map((x) => (
          <option key={x.id} value={x.id}>
            {x.code} — {x.title} ({tStatus('decisionStatuses', x.status)})
          </option>
        ))}
      </SelectField>
      {!list.isLoading && !list.error && final.length === 0 ? (
        <p className="text-xs text-muted" data-testid="approval-decision-empty">
          {t('planning.approvalDecision.empty', { type: typeLabel })}
        </p>
      ) : null}
      {notFinal > 0 ? <p className="text-xs text-muted">{t('planning.approvalDecision.notFinal', { count: notFinal })}</p> : null}
      {d ? (
        <div className="rounded-md border border-line p-3 text-sm" data-testid="approval-decision-selected">
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge enumName="decisionStatuses" value={d.status} />
            {d.authorityOutcome !== 'not_assessed' ? <StatusBadge enumName="decisionAuthorityOutcomes" value={d.authorityOutcome} /> : null}
            <Link href={`/projects/${projectId}/committee/decisions/${d.id}`} className={btn.link} dir="ltr">
              {d.code}
            </Link>
          </p>
          <p className="mt-1">
            <span className="text-muted">{t('planning.approvalDecision.amount')}: </span>
            <MoneyText value={d.amount} />
          </p>
          {d.externalAuthorityReference ? (
            <p className="mt-1">
              <span className="text-muted">{t('planning.approvalDecision.externalReference')}: </span>
              <span dir="auto">{d.externalAuthorityReference}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
