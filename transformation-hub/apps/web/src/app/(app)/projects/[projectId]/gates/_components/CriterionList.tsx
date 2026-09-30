'use client';

import { ChevronDown, FilePlus2, Scale, ShieldCheck, ShieldX, Stamp } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { documentsRoutes, gatesRoutes } from '@hub/contracts';
import { ROLE_KEYS, type RoleKey } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DemoBadge } from '@/components/DemoBadge';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useCriterionEvidence, useDocumentOptions, useInvalidateGates, gatesQk, isDesignatedReviewer, type GateCriterion, type GateDetail, type GateWaiver } from '@/lib/gates';
import { useProjectContext } from '@/lib/project-context';
import { projectAccess } from '@/lib/queries';
import { useLocalized } from '@/lib/i18n-data';
import { useQueryClient } from '@tanstack/react-query';

type Dlg =
  | { kind: 'evidence' }
  | { kind: 'submit' }
  | { kind: 'review'; outcome: 'met' | 'unmet' }
  | { kind: 'proposeNa' }
  | { kind: 'determineNa'; approve: boolean }
  | { kind: 'waiver' }
  | { kind: 'waivability' }
  | { kind: 'approveWaiver'; waiver: GateWaiver }
  | { kind: 'rejectWaiver'; waiver: GateWaiver };

const EDITABLE = ['not_started', 'in_assessment', 'reopened'];
const DECIDED = ['approved', 'approved_with_exceptions', 'rejected'];
/** Roles able to approve waivers (policy matrix: gates.waiver.approve) — the server re-validates the choice. */
const WAIVER_AUTHORITIES: RoleKey[] = ['committee_chair', 'sponsor'];

function Flag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'danger' | 'info' }) {
  return (
    <span
      className={cx(
        'rounded border px-1.5 py-0.5 text-[11px] font-medium',
        tone === 'danger' ? 'border-danger/30 bg-danger-soft text-danger' : tone === 'info' ? 'border-info/30 bg-info-soft text-info' : 'border-line bg-surface-muted text-muted',
      )}
    >
      {children}
    </span>
  );
}

function EvidenceList({ projectId, criterionId }: { projectId: string; criterionId: string }) {
  const { t, formatDateTime } = useI18n();
  const ev = useCriterionEvidence(projectId, criterionId);
  if (ev.isLoading) return <LoadingState compact />;
  if (ev.error) return <p className="text-sm text-muted">{t('gates.evidence.unavailable')}</p>;
  const items = ev.data?.items ?? [];
  if (items.length === 0) return <p className="text-sm text-muted">{t('gates.evidence.none')}</p>;
  return (
    <ul className="space-y-1.5" data-testid="criterion-evidence">
      {items.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2 py-1.5 text-sm" data-evidence-status={l.status}>
          <StatusBadge enumName="evidenceLinkStatuses" value={l.status} />
          <span className="min-w-0 flex-1" dir="auto">
            {l.documentTitle ? (
              <>
                {l.documentTitle}
                {l.versionNo ? <span className="text-muted"> · v{l.versionNo}</span> : null}
              </>
            ) : (
              l.note
            )}
          </span>
          <span className="text-xs text-muted">{l.reviewedAt ? t('gates.evidence.reviewed', { at: formatDateTime(l.reviewedAt) }) : t('gates.evidence.unreviewed')}</span>
          {l.conflictNote ? (
            <span className="basis-full text-xs text-danger" dir="auto">
              {t('gates.evidence.conflict')}: {l.conflictNote}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CriterionRow({ gate, c, onAction, expanded, onToggle }: { gate: GateDetail; c: GateCriterion; onAction: (d: Dlg) => void; expanded: boolean; onToggle: () => void }) {
  const { t, tStatus, formatNumber, formatDateTime } = useI18n();
  const loc = useLocalized();
  const { projectId, can, me } = useProjectContext();
  const s = c.assessment.status;
  const na = c.assessment.notApplicable;
  const editable = EDITABLE.includes(gate.assessment.status);
  const decided = DECIDED.includes(gate.assessment.status);
  const canAttach = can('gates.evidence.attach');
  // Only the criterion's designated reviewer role accepts, returns or determines N/A (the server enforces it).
  const canReview = can('gates.assessment.review') && isDesignatedReviewer(projectAccess(me, projectId), c.reviewerRole);
  const waivers = gate.waivers.filter((w) => w.targetId === c.id);
  const panelId = `criterion-panel-${c.id}`;

  const actions: { key: string; show: boolean; label: string; dlg: Dlg; icon: typeof Stamp; danger?: boolean }[] = [
    { key: 'evidence', show: canAttach && can('documents.evidence.link') && !decided, label: t('gates.criterion.actions.addEvidence'), dlg: { kind: 'evidence' }, icon: FilePlus2 },
    { key: 'submit', show: canAttach && editable && (s === 'unmet' || s === 'conflicting'), label: t('gates.criterion.actions.submit'), dlg: { kind: 'submit' }, icon: Stamp },
    { key: 'met', show: canReview && editable && ['unmet', 'evidence_submitted', 'conflicting'].includes(s), label: t('gates.criterion.actions.met'), dlg: { kind: 'review', outcome: 'met' }, icon: ShieldCheck },
    {
      key: 'unmet',
      show: canReview && editable && (['evidence_submitted', 'met', 'conflicting'].includes(s) || (s === 'not_applicable' && !na.approved)),
      label: t('gates.criterion.actions.return'),
      dlg: { kind: 'review', outcome: 'unmet' },
      icon: ShieldX,
      danger: true,
    },
    { key: 'proposeNa', show: canAttach && editable && ['unmet', 'evidence_submitted', 'conflicting'].includes(s), label: t('gates.criterion.actions.proposeNa'), dlg: { kind: 'proposeNa' }, icon: Scale },
    { key: 'approveNa', show: canReview && editable && s === 'not_applicable' && !na.approved, label: t('gates.criterion.actions.approveNa'), dlg: { kind: 'determineNa', approve: true }, icon: ShieldCheck },
    { key: 'rejectNa', show: canReview && editable && s === 'not_applicable' && !na.approved, label: t('gates.criterion.actions.rejectNa'), dlg: { kind: 'determineNa', approve: false }, icon: ShieldX, danger: true },
    {
      key: 'waiver',
      show: can('gates.waiver.request') && !decided && !['met', 'waived'].includes(s) && !waivers.some((w) => w.status === 'requested'),
      label: t('gates.criterion.actions.requestWaiver'),
      dlg: { kind: 'waiver' },
      icon: Scale,
    },
    { key: 'waivability', show: can('gates.criterion.set_waivability'), label: t('gates.criterion.actions.waivability'), dlg: { kind: 'waivability' }, icon: Scale },
  ];
  const visible = actions.filter((a) => a.show);

  return (
    <li className={cx(card, 'p-3')} data-testid="criterion-row" data-criterion-key={c.key} data-criterion-status={s}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          {/* The criterion key is the row's heading (h3 under the "Criteria" h2), so the h4 sections below nest correctly. */}
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            <h3 dir="ltr">{c.key}</h3>
            {c.mandatory ? <Flag>{t('gates.criterion.mandatory')}</Flag> : <Flag>{t('gates.criterion.optionalObservation')}</Flag>}
            {c.blocking ? <Flag tone="danger">{t('gates.criterion.blocking')}</Flag> : null}
            {c.waivable ? (
              <Flag tone="info">{t('gates.criterion.waivableBy', { role: tStatus('roleKeys', c.waiverAuthorityRole) })}</Flag>
            ) : (
              <Flag>{t('gates.criterion.nonWaivable')}</Flag>
            )}
          </div>
          <p className={cx('mt-1 text-sm text-ink', !expanded && 'line-clamp-2')} dir="auto">
            {loc(c.description, c.descriptionAr)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge enumName="criterionStatuses" value={s} />
          <span className="text-xs text-muted" data-testid="criterion-evidence-counts">
            {t('gates.criterion.evidenceCounts', { active: formatNumber(c.evidence.active), conflicting: formatNumber(c.evidence.conflicting) })}
          </span>
        </div>
      </div>
      <button type="button" className="mt-2 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle} data-testid="criterion-toggle">
        <ChevronDown aria-hidden="true" className={cx('size-4 transition-transform', expanded && 'rotate-180')} />
        {expanded ? t('gates.criterion.hideDetails') : t('gates.criterion.showDetails')}
      </button>
      {expanded ? (
        <div id={panelId} className="mt-3 space-y-4 border-t border-line pt-3">
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">{t('gates.criterion.owner')}</dt>
              <dd>{tStatus('roleKeys', c.ownerRole)}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('gates.criterion.reviewer')}</dt>
              <dd>{tStatus('roleKeys', c.reviewerRole)}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('gates.criterion.evidenceType')}</dt>
              <dd>{c.evidenceType ? t(`gates.evidenceTypes.${c.evidenceType as 'approved_document'}`) : EM_DASH}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('gates.criterion.applicability')}</dt>
              <dd>{c.applicability === 'proposed' ? t('gates.criterion.applicabilityProposed') : c.applicability}</dd>
            </div>
            {c.waivabilityBasis ? (
              <div className="sm:col-span-2">
                <dt className="text-muted">{t('gates.criterion.waivabilityBasis')}</dt>
                <dd dir="auto">{c.waivabilityBasis}</dd>
              </div>
            ) : null}
            {c.assessment.assessedAt ? (
              <div>
                <dt className="text-muted">{t('gates.criterion.assessedAt')}</dt>
                <dd className="tabular">{formatDateTime(c.assessment.assessedAt)}</dd>
              </div>
            ) : null}
            {c.assessment.note ? (
              <div className="sm:col-span-2">
                <dt className="text-muted">{t('gates.criterion.note')}</dt>
                <dd dir="auto">{c.assessment.note}</dd>
              </div>
            ) : null}
          </dl>

          {s === 'not_applicable' ? (
            <div className="rounded-md border border-warning/30 bg-warning-soft p-2 text-sm" data-testid="na-determination">
              <p className="font-medium">{na.approved ? t('gates.na.approved', { role: tStatus('roleKeys', na.determinedRole) }) : t('gates.na.pending', { role: tStatus('roleKeys', c.reviewerRole) })}</p>
              {na.basis ? (
                <p className="mt-1" dir="auto">
                  {t('gates.na.basis')}: {na.basis}
                </p>
              ) : null}
            </div>
          ) : null}

          <section>
            <h4 className="mb-1.5 text-sm font-semibold">{t('gates.evidence.title')}</h4>
            <EvidenceList projectId={projectId} criterionId={c.id} />
          </section>

          {waivers.length > 0 ? (
            <section>
              <h4 className="mb-1.5 text-sm font-semibold">{t('gates.waivers.forCriterion')}</h4>
              <ul className="space-y-1.5">
                {waivers.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2 py-1.5 text-sm" data-testid="criterion-waiver" data-waiver-status={w.status}>
                    <StatusBadge enumName="waiverStatuses" value={w.status} />
                    <span className="min-w-0 flex-1" dir="auto">
                      {w.basis}
                      {w.isDemo ? <DemoBadge className="ms-1" /> : null}
                    </span>
                    {w.status === 'requested' && can('gates.waiver.approve') ? (
                      <span className="flex gap-1">
                        <button type="button" className={btn.secondary} onClick={() => onAction({ kind: 'approveWaiver', waiver: w })} data-testid="waiver-approve">
                          {t('gates.waivers.approve')}
                        </button>
                        <button type="button" className={btn.secondary} onClick={() => onAction({ kind: 'rejectWaiver', waiver: w })} data-testid="waiver-reject">
                          {t('gates.waivers.reject')}
                        </button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {visible.length > 0 ? (
            <div className="flex flex-wrap gap-2" data-testid="criterion-actions">
              {visible.map((a) => {
                const Icon = a.icon;
                return (
                  <button key={a.key} type="button" className={a.danger ? cx(btn.secondary, 'text-danger') : btn.secondary} onClick={() => onAction(a.dlg)} data-testid={`criterion-action-${a.key}`}>
                    <Icon aria-hidden="true" className="size-4" />
                    {a.label}
                  </button>
                );
              })}
            </div>
          ) : !editable ? (
            <p className="text-xs text-muted">{t('gates.criterion.frozen')}</p>
          ) : null}

          {c.assessment.id ? <ActivityHistory projectId={projectId} entityType="criterion_assessment" entityId={c.assessment.id} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function CriterionDialogs({ gate, c, dlg, onClose }: { gate: GateDetail; c: GateCriterion; dlg: Dlg; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateGates(projectId);
  const docs = useDocumentOptions(projectId, dlg.kind === 'evidence' && can('documents.document.read'));
  const [text, setText] = useState('');
  const [text2, setText2] = useState('');
  const [text3, setText3] = useState('');
  const [date, setDate] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [waivable, setWaivable] = useState(c.waivable);
  const [role, setRole] = useState<RoleKey | ''>(c.waiverAuthorityRole ?? '');

  const params = { projectId, gateId: gate.id, criterionId: c.id };
  const v = c.assessment.version;
  const label = `${c.key}`;
  const finish = async (message: string) => {
    await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: gatesQk.evidence(projectId, c.id) })]);
    toast.show('success', message);
    onClose();
  };
  const common = { open: true, onClose, onReload: invalidate } as const;

  switch (dlg.kind) {
    case 'evidence':
      return (
        <ConfirmCommandDialog
          {...common}
          title={t('gates.dialogs.evidence.title', { criterion: label })}
          confirmLabel={t('gates.dialogs.evidence.confirm')}
          noteMode="none"
          confirmDisabled={!documentId && !text.trim()}
          consequences={[t('gates.dialogs.evidence.effect'), t('gates.dialogs.evidence.unverified'), t('common.command.audited')]}
          onConfirm={async () => {
            await api(documentsRoutes.linkEvidence, {
              params: { projectId },
              body: { targetType: 'gate_criterion', targetId: c.id, ...(documentId ? { documentId } : {}), ...(text.trim() ? { note: text.trim() } : {}), ...(text2.trim() ? { purpose: text2.trim() } : {}) },
            });
            await finish(t('gates.dialogs.evidence.done', { criterion: label }));
          }}
        >
          <div className="space-y-3">
            {can('documents.document.read') ? (
              <SelectField label={t('gates.dialogs.evidence.document')} value={documentId} onChange={(e) => setDocumentId(e.target.value)} hint={t('gates.dialogs.evidence.documentHint')}>
                <option value="">{t('gates.dialogs.evidence.noDocument')}</option>
                {(docs.data?.items ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </SelectField>
            ) : null}
            <TextAreaField label={t('gates.dialogs.evidence.note')} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} rows={3} required={!documentId} data-testid="evidence-note" />
            <TextField label={t('gates.dialogs.evidence.purpose')} value={text2} onChange={(e) => setText2(e.target.value)} maxLength={500} />
          </div>
        </ConfirmCommandDialog>
      );
    case 'submit':
      return (
        <ConfirmCommandDialog
          {...common}
          title={t('gates.dialogs.submit.title', { criterion: label })}
          confirmLabel={t('gates.criterion.actions.submit')}
          expectedVersion={v}
          consequences={[t('gates.dialogs.submit.effect'), t('gates.dialogs.submit.reviewer', { role: tStatus('roleKeys', c.reviewerRole) }), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(gatesRoutes.submitEvidence, { params, body: { expectedVersion: v, ...(note ? { note } : {}) } });
            await finish(t('gates.dialogs.submit.done', { criterion: label }));
          }}
        />
      );
    case 'review':
      return (
        <ConfirmCommandDialog
          {...common}
          title={t(dlg.outcome === 'met' ? 'gates.dialogs.met.title' : 'gates.dialogs.return.title', { criterion: label })}
          confirmLabel={dlg.outcome === 'met' ? t('gates.criterion.actions.met') : t('gates.criterion.actions.return')}
          expectedVersion={v}
          danger={dlg.outcome === 'unmet'}
          consequences={
            dlg.outcome === 'met'
              ? [t('gates.dialogs.met.effect'), t('gates.dialogs.met.rules'), t('common.command.audited')]
              : [t('gates.dialogs.return.effect'), t('common.command.audited')]
          }
          onConfirm={async ({ note }) => {
            await api(gatesRoutes.reviewCriterion, { params, body: { expectedVersion: v, outcome: dlg.outcome, ...(note ? { note } : {}) } });
            await finish(t(dlg.outcome === 'met' ? 'gates.dialogs.met.done' : 'gates.dialogs.return.done', { criterion: label }));
          }}
        />
      );
    case 'proposeNa':
      return (
        <ConfirmCommandDialog
          {...common}
          title={t('gates.dialogs.proposeNa.title', { criterion: label })}
          confirmLabel={t('gates.criterion.actions.proposeNa')}
          noteMode="none"
          expectedVersion={v}
          confirmDisabled={!text.trim()}
          consequences={[t('gates.dialogs.proposeNa.effect'), t('gates.dialogs.proposeNa.determination', { role: tStatus('roleKeys', c.reviewerRole) }), t('common.command.audited')]}
          onConfirm={async () => {
            await api(gatesRoutes.proposeNotApplicable, { params, body: { expectedVersion: v, basis: text.trim() } });
            await finish(t('gates.dialogs.proposeNa.done', { criterion: label }));
          }}
        >
          <TextAreaField label={t('gates.dialogs.proposeNa.basis')} required value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} rows={4} />
        </ConfirmCommandDialog>
      );
    case 'determineNa':
      return (
        <ConfirmCommandDialog
          {...common}
          title={t(dlg.approve ? 'gates.dialogs.approveNa.title' : 'gates.dialogs.rejectNa.title', { criterion: label })}
          confirmLabel={dlg.approve ? t('gates.criterion.actions.approveNa') : t('gates.criterion.actions.rejectNa')}
          expectedVersion={v}
          danger={!dlg.approve}
          consequences={
            dlg.approve
              ? [t('gates.dialogs.approveNa.effect'), t('gates.dialogs.approveNa.rules', { role: tStatus('roleKeys', c.reviewerRole) }), t('common.command.audited')]
              : [t('gates.dialogs.rejectNa.effect'), t('common.command.audited')]
          }
          onConfirm={async ({ note }) => {
            await api(gatesRoutes.determineNotApplicable, { params, body: { expectedVersion: v, approve: dlg.approve, ...(note ? { note } : {}) } });
            await finish(t(dlg.approve ? 'gates.dialogs.approveNa.done' : 'gates.dialogs.rejectNa.done', { criterion: label }));
          }}
        >
          {c.assessment.notApplicable.basis ? (
            <p className="rounded-md border border-line bg-surface-muted p-2 text-sm" dir="auto">
              {t('gates.na.basis')}: {c.assessment.notApplicable.basis}
            </p>
          ) : null}
        </ConfirmCommandDialog>
      );
    case 'waiver':
      return (
        <ConfirmCommandDialog
          {...common}
          title={t('gates.dialogs.waiver.title', { criterion: label })}
          confirmLabel={t('gates.dialogs.waiver.confirm')}
          noteMode="none"
          confirmDisabled={!text.trim() || !text2.trim()}
          consequences={[
            c.waivable ? t('gates.dialogs.waiver.effect', { role: tStatus('roleKeys', c.waiverAuthorityRole) }) : t('gates.dialogs.waiver.nonWaivable'),
            t('gates.dialogs.waiver.notSelf'),
            t('common.command.audited'),
          ]}
          onConfirm={async () => {
            await api(gatesRoutes.requestWaiver, {
              params,
              body: { basis: text.trim(), impact: text2.trim(), ...(text3.trim() ? { conditions: text3.trim() } : {}), ...(date ? { expiresOn: date } : {}) },
            });
            await finish(t('gates.dialogs.waiver.done', { criterion: label }));
          }}
        >
          <div className="space-y-3">
            {!c.waivable ? (
              <p className="rounded-md border border-warning/30 bg-warning-soft p-2 text-sm text-ink" data-testid="non-waivable-warning">
                {t('gates.dialogs.waiver.nonWaivableWarning')}
              </p>
            ) : null}
            <TextAreaField label={t('gates.dialogs.waiver.basis')} required value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} rows={3} data-testid="waiver-basis" />
            <TextAreaField label={t('gates.dialogs.waiver.impact')} required value={text2} onChange={(e) => setText2(e.target.value)} maxLength={4000} rows={3} hint={t('gates.dialogs.waiver.impactHint')} data-testid="waiver-impact" />
            <TextAreaField label={t('gates.dialogs.waiver.conditions')} value={text3} onChange={(e) => setText3(e.target.value)} maxLength={4000} rows={2} />
            <TextField label={t('gates.dialogs.waiver.expiresOn')} type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </ConfirmCommandDialog>
      );
    case 'waivability':
      return (
        <ConfirmCommandDialog
          {...common}
          title={t('gates.dialogs.waivability.title', { criterion: label })}
          confirmLabel={t('gates.dialogs.waivability.confirm')}
          noteMode="none"
          expectedVersion={c.version}
          confirmDisabled={!text.trim() || (waivable && !role)}
          consequences={[
            waivable ? t('gates.dialogs.waivability.waivable', { role: role ? tStatus('roleKeys', role) : EM_DASH }) : t('gates.dialogs.waivability.nonWaivable'),
            t('gates.dialogs.waivability.versioned'),
            t('common.command.audited'),
          ]}
          onConfirm={async () => {
            await api(gatesRoutes.setWaivability, {
              params,
              body: { expectedVersion: c.version, waivable, waiverAuthorityRole: waivable ? (role as RoleKey) : null, waivabilityBasis: text.trim() },
            });
            await finish(t('gates.dialogs.waivability.done', { criterion: label }));
          }}
        >
          <div className="space-y-3">
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={waivable} onChange={(e) => setWaivable(e.target.checked)} />
              {t('gates.dialogs.waivability.waivableLabel')}
            </label>
            {waivable ? (
              <SelectField label={t('gates.dialogs.waivability.authority')} required value={role} onChange={(e) => setRole(e.target.value as RoleKey | '')}>
                <option value="">{t('gates.dialogs.waivability.chooseRole')}</option>
                {ROLE_KEYS.filter((r) => WAIVER_AUTHORITIES.includes(r)).map((r) => (
                  <option key={r} value={r}>
                    {tStatus('roleKeys', r)}
                  </option>
                ))}
              </SelectField>
            ) : null}
            <TextAreaField label={t('gates.dialogs.waivability.basis')} required value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} rows={3} hint={t('gates.dialogs.waivability.basisHint')} />
          </div>
        </ConfirmCommandDialog>
      );
    case 'approveWaiver':
    case 'rejectWaiver': {
      const approve = dlg.kind === 'approveWaiver';
      const w = dlg.waiver;
      return (
        <ConfirmCommandDialog
          {...common}
          title={t(approve ? 'gates.dialogs.approveWaiver.title' : 'gates.dialogs.rejectWaiver.title', { criterion: label })}
          confirmLabel={approve ? t('gates.waivers.approve') : t('gates.waivers.reject')}
          noteMode={approve ? 'optional' : 'required'}
          expectedVersion={w.version}
          danger={!approve}
          consequences={
            approve
              ? [t('gates.dialogs.approveWaiver.effect'), t('gates.dialogs.approveWaiver.rules', { role: tStatus('roleKeys', w.authorityRole) }), t('common.command.audited')]
              : [t('gates.dialogs.rejectWaiver.effect'), t('common.command.audited')]
          }
          onConfirm={async ({ note }) => {
            if (approve) await api(gatesRoutes.approveWaiver, { params: { projectId, waiverId: w.id }, body: { expectedVersion: w.version, ...(note ? { note } : {}) } });
            else await api(gatesRoutes.rejectWaiver, { params: { projectId, waiverId: w.id }, body: { expectedVersion: w.version, note } });
            await finish(t(approve ? 'gates.dialogs.approveWaiver.done' : 'gates.dialogs.rejectWaiver.done', { criterion: label }));
          }}
        >
          <dl className="space-y-1 rounded-md border border-line bg-surface-muted p-2 text-sm">
            <div>
              <dt className="inline font-medium">{t('gates.waivers.basis')}: </dt>
              <dd className="inline" dir="auto">
                {w.basis}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">{t('gates.waivers.impact')}: </dt>
              <dd className="inline" dir="auto">
                {w.impact}
              </dd>
            </div>
          </dl>
        </ConfirmCommandDialog>
      );
    }
  }
}

export function CriterionList({ gate }: { gate: GateDetail }) {
  const [active, setActive] = useState<{ criterionId: string; dlg: Dlg } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const activeCriterion = active ? gate.criteria.find((c) => c.id === active.criterionId) : undefined;
  return (
    <>
      <ul className="space-y-2" data-testid="criterion-list">
        {gate.criteria.map((c) => (
          <CriterionRow
            key={c.id}
            gate={gate}
            c={c}
            expanded={expanded.has(c.id)}
            onToggle={() =>
              setExpanded((s) => {
                const n = new Set(s);
                if (n.has(c.id)) n.delete(c.id);
                else n.add(c.id);
                return n;
              })
            }
            onAction={(dlg) => setActive({ criterionId: c.id, dlg })}
          />
        ))}
      </ul>
      {active && activeCriterion ? <CriterionDialogs key={`${active.criterionId}-${active.dlg.kind}`} gate={gate} c={activeCriterion} dlg={active.dlg} onClose={() => setActive(null)} /> : null}
    </>
  );
}
