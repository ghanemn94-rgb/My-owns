'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { jvRoutes } from '@hub/contracts';
import { ASSESSMENT_BASES, type AssessmentBasis, type Classification } from '@hub/domain';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { assignableClassifications } from '@/lib/documents';
import { useLocalized } from '@/lib/i18n-data';
import { jvHref, useAssessments, useComparison, useCriteria, useJvRefresh, usePartnerNames, useProposals } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { Callout, DocumentLink, DocumentPicker, JvCommandDialog, Panel, Person, UText, useUrlState } from '../_components/jv';

function BasisTag({ basis }: { basis: AssessmentBasis }) {
  return <StatusBadge enumName="assessmentBases" value={basis} tone={basis === 'fact' ? 'success' : 'info'} />;
}

function ProposalDialog({ partnerId, onClose }: { partnerId: string; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, me } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const proposals = useProposals(partnerId);
  const options = assignableClassifications(me.user.clearance as Classification);
  const [title, setTitle] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [scope, setScope] = useState('');
  const [terms, setTerms] = useState('');
  const [docId, setDocId] = useState('');
  const [supersedes, setSupersedes] = useState('');
  const [classification, setClassification] = useState<Classification>(options.includes('confidential') ? 'confidential' : options[options.length - 1]!);
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.proposals.create.title')}
      confirmLabel={t('jv.proposals.create.confirm')}
      noteMode="none"
      confirmDisabled={!title.trim()}
      consequences={[t('jv.proposals.create.effect'), t('jv.proposals.create.noInvention'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(jvRoutes.addProposal, {
          params: { projectId, partnerId },
          body: {
            title: title.trim(),
            classification,
            ...(receivedOn ? { receivedOn } : {}),
            ...(scope.trim() ? { scope: scope.trim() } : {}),
            ...(terms.trim() ? { termsSummary: terms.trim() } : {}),
            ...(docId ? { documentId: docId } : {}),
            ...(supersedes ? { supersedesProposalId: supersedes } : {}),
          },
        });
        await refresh();
        toast.show('success', t('jv.proposals.create.done', { code: r.code ?? '' }));
        onClose();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField className="sm:col-span-2" label={t('jv.proposals.fields.title')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} data-testid="proposal-title" />
        <TextField label={t('jv.proposals.fields.receivedOn')} type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
        <SelectField label={t('jv.common.classification')} required value={classification} onChange={(e) => setClassification(e.target.value as Classification)}>
          {options.map((c) => (
            <option key={c} value={c}>
              {tStatus('classifications', c)}
            </option>
          ))}
        </SelectField>
        <TextAreaField className="sm:col-span-2" label={t('jv.proposals.fields.scope')} value={scope} maxLength={8000} onChange={(e) => setScope(e.target.value)} />
        <TextAreaField className="sm:col-span-2" label={t('jv.proposals.fields.terms')} hint={t('jv.proposals.fields.termsHint')} value={terms} maxLength={8000} onChange={(e) => setTerms(e.target.value)} />
        <SelectField className="sm:col-span-2" label={t('jv.proposals.fields.supersedes')} value={supersedes} onChange={(e) => setSupersedes(e.target.value)}>
          <option value="">{t('jv.common.none')}</option>
          {(proposals.data?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.title}
            </option>
          ))}
        </SelectField>
        <div className="sm:col-span-2">
          <DocumentPicker label={t('jv.proposals.fields.document')} value={docId} onChange={setDocId} />
        </div>
      </div>
    </JvCommandDialog>
  );
}

function AssessmentDialog({ partnerId, onClose }: { partnerId: string; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const loc = useLocalized();
  const refresh = useJvRefresh();
  const toast = useToast();
  const criteria = useCriteria();
  const proposals = useProposals(partnerId);
  const [basis, setBasis] = useState<AssessmentBasis | ''>('');
  const [statement, setStatement] = useState('');
  const [criterionKey, setCriterionKey] = useState('');
  const [score, setScore] = useState('');
  const [sourceRef, setSourceRef] = useState('');
  const [docId, setDocId] = useState('');
  const [proposalId, setProposalId] = useState('');
  const factWithoutSource = basis === 'fact' && !sourceRef.trim() && !docId;
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.assessments.create.title')}
      confirmLabel={t('jv.assessments.create.confirm')}
      noteMode="none"
      confirmDisabled={!basis || !statement.trim() || factWithoutSource || (!!score && !criterionKey)}
      consequences={[t('jv.assessments.create.effect'), t('jv.assessments.create.basisRule'), t('common.command.audited')]}
      onConfirm={async () => {
        await api(jvRoutes.addAssessment, {
          params: { projectId, partnerId },
          body: {
            basis: basis || undefined,
            statement: statement.trim(),
            ...(criterionKey ? { criterionKey } : {}),
            ...(score.trim() ? { score: score.trim() } : {}),
            ...(sourceRef.trim() ? { sourceReference: sourceRef.trim() } : {}),
            ...(docId ? { documentId: docId } : {}),
            ...(proposalId ? { proposalId } : {}),
          },
        });
        await refresh();
        toast.show('success', t('jv.assessments.create.done'));
        onClose();
      }}
    >
      <fieldset className="space-y-2" data-testid="assessment-basis">
        <legend className="text-sm font-medium text-ink">
          {t('jv.assessments.fields.basis')} <span className="text-danger">*</span>
        </legend>
        <div className="flex flex-wrap gap-4">
          {ASSESSMENT_BASES.map((b) => (
            <label key={b} className="inline-flex items-center gap-2 text-sm">
              <input type="radio" name="basis" value={b} checked={basis === b} onChange={() => setBasis(b)} />
              {t(`jv.assessments.basis.${b}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">{t('jv.assessments.fields.basisHint')}</p>
      </fieldset>
      <TextAreaField label={t('jv.assessments.fields.statement')} required value={statement} maxLength={4000} onChange={(e) => setStatement(e.target.value)} data-testid="assessment-statement" />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t('jv.assessments.fields.criterion')} value={criterionKey} onChange={(e) => setCriterionKey(e.target.value)}>
          <option value="">{t('jv.common.none')}</option>
          {(criteria.data?.criteriaSet?.criteria ?? []).map((c) => (
            <option key={c.key} value={c.key}>
              {loc(c.name, c.nameAr)}
            </option>
          ))}
        </SelectField>
        <TextField label={t('jv.assessments.fields.score')} hint={t('jv.assessments.fields.scoreHint')} inputMode="decimal" value={score} maxLength={4} onChange={(e) => setScore(e.target.value)} dir="ltr" />
        <TextField className="sm:col-span-2" label={t('jv.assessments.fields.source')} hint={basis === 'fact' ? t('jv.assessments.fields.sourceRequired') : undefined} error={factWithoutSource && statement ? t('jv.assessments.fields.sourceRequired') : null} value={sourceRef} maxLength={1000} onChange={(e) => setSourceRef(e.target.value)} />
        <SelectField className="sm:col-span-2" label={t('jv.assessments.fields.proposal')} value={proposalId} onChange={(e) => setProposalId(e.target.value)}>
          <option value="">{t('jv.common.none')}</option>
          {(proposals.data?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.title}
            </option>
          ))}
        </SelectField>
      </div>
      <DocumentPicker label={t('jv.assessments.fields.document')} value={docId} onChange={setDocId} />
    </JvCommandDialog>
  );
}

/**
 * Proposals & comparative assessment (REQ-JV-006): every entry is tagged as a verifiable FACT (with its source) or the
 * team's JUDGEMENT; weighted scores appear only when every criterion is scored (never guessed).
 */
export default function ProposalsPage() {
  const { t, formatDate, formatDateTime, formatNumber } = useI18n();
  const { projectId, can } = useProjectContext();
  const loc = useLocalized();
  const { values, set } = useUrlState(['partnerId'] as const);
  const partners = usePartnerNames();
  const comparison = useComparison();
  const partnerId = values.partnerId || null;
  const proposals = useProposals(partnerId);
  const assessments = useAssessments(partnerId);
  const [dialog, setDialog] = useState<'proposal' | 'assessment' | null>(null);
  const base = jvHref(projectId);
  const crit = comparison.data?.criteria ?? [];
  const canManage = can('jv.proposal.manage');

  return (
    <>
      <PageHeader title={t('jv.proposals.title')} description={t('jv.proposals.subtitle')} />
      <div className="space-y-6">
        <Callout testId="fact-judgement-note">{t('jv.proposals.basisNote')}</Callout>
        <section className="space-y-2" data-testid="comparison">
          <h2 className="text-lg font-semibold text-ink">{t('jv.proposals.comparisonTitle')}</h2>
          <DataTable
            caption={t('jv.proposals.comparisonTitle')}
            columns={[
              {
                key: 'partner',
                header: t('jv.proposals.columns.partner'),
                isRowHeader: true,
                cell: (r) => (
                  <Link className={btn.link} href={`${base}/partners/${r.partnerId}`}>
                    <span dir="ltr">{r.code}</span> — <span dir="auto">{r.name}</span>
                  </Link>
                ),
              },
              { key: 'stage', header: t('jv.partners.columns.stage'), cell: (r) => <StatusBadge enumName="partnerStages" value={r.stage} /> },
              ...crit.map((c) => ({
                key: `c-${c.key}`,
                header: t('jv.proposals.columns.criterion', { name: loc(c.name, c.nameAr), weight: c.weight }),
                cell: (r: NonNullable<typeof comparison.data>['items'][number]) => (r.scores[c.key] ? <span className="tabular" dir="ltr">{r.scores[c.key]}</span> : <span className="text-xs text-muted">{t('jv.proposals.notScored')}</span>),
              })),
              {
                key: 'weighted',
                header: t('jv.proposals.columns.weighted'),
                cell: (r) => (r.weightedScore ? <span className="tabular font-semibold" dir="ltr">{r.weightedScore}</span> : <span className="text-xs text-muted">{t('jv.proposals.incomplete', { count: r.missing.length })}</span>),
              },
              { key: 'facts', header: t('jv.proposals.columns.facts'), cell: (r) => <span className="tabular">{formatNumber(r.facts)}</span> },
              { key: 'judgements', header: t('jv.proposals.columns.judgements'), cell: (r) => <span className="tabular">{formatNumber(r.judgements)}</span> },
              {
                key: 'open',
                header: t('jv.common.commands'),
                cell: (r) => (
                  <button type="button" className={btn.link} onClick={() => set({ partnerId: r.partnerId })} aria-pressed={partnerId === r.partnerId}>
                    {t('jv.proposals.showDetails')}
                  </button>
                ),
              },
            ]}
            rows={comparison.data?.items}
            rowKey={(r) => r.partnerId}
            isLoading={comparison.isLoading}
            error={comparison.error}
            onRetry={() => comparison.refetch()}
            emptyTitle={t('jv.partners.empty')}
            testId="comparison-table"
          />
          {crit.length === 0 && comparison.data ? <p className="text-sm text-muted">{t('jv.criteria.none')}</p> : null}
        </section>

        <Panel title={t('jv.proposals.partnerTitle')} testId="partner-proposals">
          <label className="flex max-w-md flex-col gap-1 text-sm font-medium text-ink">
            {t('jv.proposals.selectPartner')}
            <select className="block min-h-10 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" value={partnerId ?? ''} onChange={(e) => set({ partnerId: e.target.value })} data-testid="proposal-partner">
              <option value="">{t('jv.common.select')}</option>
              {partners.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </label>
          {!partnerId ? <p className="mt-3 text-sm text-muted">{t('jv.proposals.pickPartner')}</p> : null}
        </Panel>

        {partnerId ? (
          <>
            <section className="space-y-2" data-testid="proposals">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-ink">{t('jv.proposals.listTitle', { partner: partners.label(partnerId) ?? '' })}</h2>
                {canManage ? (
                  <button type="button" className={btn.primary} onClick={() => setDialog('proposal')} data-testid="create-proposal">
                    <Plus aria-hidden="true" className="size-4" />
                    {t('jv.proposals.create.action')}
                  </button>
                ) : null}
              </div>
              <DataTable
                caption={t('jv.proposals.listTitle', { partner: partners.label(partnerId) ?? '' })}
                columns={[
                  {
                    key: 'code',
                    header: t('jv.proposals.columns.code'),
                    isRowHeader: true,
                    cell: (p) => (
                      <span className="flex flex-wrap items-center gap-1">
                        <span dir="ltr">{p.code}</span>
                        {p.isDemo ? <DemoBadge /> : null}
                      </span>
                    ),
                  },
                  { key: 'title', header: t('jv.proposals.fields.title'), cell: (p) => <UText value={p.title} /> },
                  { key: 'received', header: t('jv.proposals.fields.receivedOn'), cell: (p) => <span className="tabular">{formatDate(p.receivedOn)}</span> },
                  { key: 'scope', header: t('jv.proposals.fields.scope'), cell: (p) => <UText value={p.scope} multiline /> },
                  { key: 'terms', header: t('jv.proposals.fields.terms'), cell: (p) => <UText value={p.termsSummary} multiline /> },
                  { key: 'doc', header: t('jv.proposals.fields.document'), cell: (p) => <DocumentLink id={p.documentId} /> },
                  { key: 'supersedes', header: t('jv.proposals.fields.supersedes'), cell: (p) => (p.supersedesProposalId ? <span dir="ltr">#{p.supersedesProposalId.slice(-6)}</span> : EM_DASH) },
                ]}
                rows={proposals.data?.items}
                rowKey={(p) => p.id}
                isLoading={proposals.isLoading}
                error={proposals.error}
                onRetry={() => proposals.refetch()}
                emptyTitle={t('jv.proposals.empty')}
                testId="proposals-table"
              />
            </section>
            <section className="space-y-2" data-testid="assessments">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-ink">{t('jv.assessments.title')}</h2>
                {canManage ? (
                  <button type="button" className={btn.primary} onClick={() => setDialog('assessment')} data-testid="create-assessment">
                    <Plus aria-hidden="true" className="size-4" />
                    {t('jv.assessments.create.action')}
                  </button>
                ) : null}
              </div>
              <DataTable
                caption={t('jv.assessments.title')}
                columns={[
                  { key: 'basis', header: t('jv.assessments.fields.basis'), isRowHeader: true, cell: (a) => <BasisTag basis={a.basis} /> },
                  { key: 'statement', header: t('jv.assessments.fields.statement'), cell: (a) => <UText value={a.statement} multiline /> },
                  {
                    key: 'criterion',
                    header: t('jv.assessments.fields.criterion'),
                    cell: (a) => {
                      const c = (comparison.data?.criteria ?? []).find((x) => x.key === a.criterionKey);
                      return a.criterionKey ? <span dir="auto">{c ? loc(c.name, c.nameAr) : a.criterionKey}</span> : EM_DASH;
                    },
                  },
                  { key: 'score', header: t('jv.assessments.fields.score'), cell: (a) => (a.score ? <span className="tabular" dir="ltr">{a.score}</span> : EM_DASH) },
                  {
                    key: 'source',
                    header: t('jv.assessments.fields.source'),
                    cell: (a) => (
                      <span className="flex flex-col gap-0.5">
                        <UText value={a.sourceReference} />
                        {a.documentId ? <DocumentLink id={a.documentId} /> : null}
                      </span>
                    ),
                  },
                  { key: 'by', header: t('jv.common.recordedBy'), cell: (a) => <Person id={a.createdBy} people={assessments.data?.people} /> },
                  {
                    key: 'at',
                    header: t('jv.common.recordedAt'),
                    cell: (a) => (
                      <span className="flex flex-wrap items-center gap-1">
                        <span className="tabular">{formatDateTime(a.createdAt)}</span>
                        {a.isDemo ? <DemoBadge /> : null}
                      </span>
                    ),
                  },
                ]}
                rows={assessments.data?.items}
                rowKey={(a) => a.id}
                isLoading={assessments.isLoading}
                error={assessments.error}
                onRetry={() => assessments.refetch()}
                emptyTitle={t('jv.assessments.empty')}
                testId="assessments-table"
              />
            </section>
          </>
        ) : null}
      </div>
      {dialog === 'proposal' && partnerId ? <ProposalDialog partnerId={partnerId} onClose={() => setDialog(null)} /> : null}
      {dialog === 'assessment' && partnerId ? <AssessmentDialog partnerId={partnerId} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
