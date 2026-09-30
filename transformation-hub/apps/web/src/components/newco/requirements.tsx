'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { newcoRoutes as N, REQUIREMENT_OUTCOME_COMMANDS, REQUIREMENT_PROGRESS_COMMANDS } from '@hub/contracts';
import { APPLICABILITY_STATUSES, APPROVAL_REGISTER_CATEGORIES, REQUIREMENT_STATUSES } from '@hub/domain';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { ck, localToday, requirementHref, useRefreshCarveout, type Requirement } from '@/lib/carveout';
import { useProjectContext } from '@/lib/project-context';
import { ConfirmCommandDialog } from '../ConfirmCommandDialog';
import { DataTable, type Column } from '../DataTable';
import { DemoBadge } from '../DemoBadge';
import { SelectField, TextAreaField, TextField } from '../Field';
import { SearchInput } from '../SearchInput';
import { StatusBadge, type Tone } from '../StatusBadge';
import { useToast } from '../Toast';
import { UserPicker, type PickedUser } from '../UserPicker';
import { btn, cx, hint } from '../ui';
import { CodeLink, FilterSelect } from '../planning/bits';
import { FormDialog } from '../planning/dialogs';
import { PersonText } from '../carveout/bits';

export type ProgressCmd = (typeof REQUIREMENT_PROGRESS_COMMANDS)[number];
export type OutcomeCmd = (typeof REQUIREMENT_OUTCOME_COMMANDS)[number];
type Category = (typeof APPROVAL_REGISTER_CATEGORIES)[number];
type Validity = Requirement['validityState'];

const VALIDITY_TONE: Record<Validity, Tone> = { not_granted: 'neutral', no_expiry_recorded: 'warning', not_yet_valid: 'info', valid: 'success', expiring: 'warning', expired: 'danger' };
const CONDITIONS_TONE: Record<Requirement['conditionsState'], Tone> = { none: 'neutral', open: 'warning', satisfied: 'success' };

/** "Assessment pending — specialist" until a specialist records applicability (REQ-AGR-007); never inferred. */
export function ApplicabilityBadge({ value, size = 'sm' }: { value: Requirement['applicability']; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  return <StatusBadge enumName="applicabilityStatuses" value={value} size={size} label={value === 'assessment_pending' ? t('newco.req.pendingSpecialist') : undefined} />;
}

export function ValidityBadge({ value }: { value: Validity }) {
  const { t } = useI18n();
  return <StatusBadge enumName="requirementStatuses" value={value} tone={VALIDITY_TONE[value]} label={t(`newco.req.validity.${value}`)} />;
}

export function ConditionsBadge({ value }: { value: Requirement['conditionsState'] }) {
  const { t } = useI18n();
  if (value === 'none') return <span className="text-xs text-muted">{t('newco.req.conditions.none')}</span>;
  return <StatusBadge enumName="conditionStatuses" value={value} tone={CONDITIONS_TONE[value]} label={t(`newco.req.conditions.${value}`)} />;
}

const PAGE = 20;

export function RequirementsRegister() {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [applicability, setApplicability] = useState('');
  const [status, setStatus] = useState('');
  const [validity, setValidity] = useState('');
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  useEffect(() => setPage(1), [q, category, applicability, status, validity]);
  const query = {
    page,
    pageSize: PAGE,
    q: q || undefined,
    category: (category || undefined) as Category | undefined,
    applicability: (applicability || undefined) as Requirement['applicability'] | undefined,
    status: (status || undefined) as Requirement['status'] | undefined,
    validity: (validity || undefined) as 'expired' | 'expiring' | undefined,
  };
  const list = useQuery({ queryKey: ck.requirements(projectId, query), queryFn: ({ signal }) => api(N.listRequirements, { params: { projectId }, query, signal }), placeholderData: keepPreviousData });
  const columns: Column<Requirement>[] = [
    { key: 'code', header: t('newco.req.code'), isRowHeader: true, sortValue: (r) => r.code, cell: (r) => <CodeLink href={requirementHref(projectId, r.id)} code={r.code} title={r.title} testId="requirement-link" /> },
    { key: 'category', header: t('newco.req.category'), cell: (r) => tStatus('approvalRegisterCategories', r.category) },
    { key: 'authority', header: t('newco.req.authority'), cell: (r) => <span dir="auto">{r.authority}</span> },
    { key: 'applicability', header: t('newco.req.applicability'), cell: (r) => <ApplicabilityBadge value={r.applicability} /> },
    { key: 'status', header: t('newco.common.status'), cell: (r) => <StatusBadge enumName="requirementStatuses" value={r.status} /> },
    { key: 'validity', header: t('newco.req.validityCol'), cell: (r) => <ValidityBadge value={r.validityState} /> },
    { key: 'conditions', header: t('newco.req.conditionsCol'), cell: (r) => <ConditionsBadge value={r.conditionsState} /> },
    { key: 'owner', header: t('newco.common.owner'), cell: (r) => <PersonText person={r.owner} /> },
    { key: 'gate', header: t('newco.req.gate'), cell: (r) => <span dir="ltr">{r.gateKey ?? EM_DASH}</span> },
    { key: 'demo', header: '', cell: (r) => (r.isDemo ? <DemoBadge /> : null) },
  ];
  return (
    <div className="space-y-3" data-testid="requirements-register">
      <p className="max-w-3xl text-sm text-muted">{t('newco.req.explain')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput className="w-full sm:w-64" label={t('newco.req.search')} value={q} onChange={setQ} />
        <FilterSelect label={t('newco.req.category')} value={category} onChange={setCategory} className="w-full sm:w-40">
          <option value="">{t('newco.common.all')}</option>
          {APPROVAL_REGISTER_CATEGORIES.map((v) => (
            <option key={v} value={v}>
              {tStatus('approvalRegisterCategories', v)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label={t('newco.req.applicability')} value={applicability} onChange={setApplicability} className="w-full sm:w-52" testId="filter-applicability">
          <option value="">{t('newco.common.all')}</option>
          {APPLICABILITY_STATUSES.map((v) => (
            <option key={v} value={v}>
              {v === 'assessment_pending' ? t('newco.req.pendingSpecialist') : tStatus('applicabilityStatuses', v)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label={t('newco.common.status')} value={status} onChange={setStatus} className="w-full sm:w-44">
          <option value="">{t('newco.common.all')}</option>
          {REQUIREMENT_STATUSES.map((v) => (
            <option key={v} value={v}>
              {tStatus('requirementStatuses', v)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label={t('newco.req.validityCol')} value={validity} onChange={setValidity} className="w-full sm:w-40">
          <option value="">{t('newco.common.all')}</option>
          <option value="expiring">{t('newco.req.validity.expiring')}</option>
          <option value="expired">{t('newco.req.validity.expired')}</option>
        </FilterSelect>
        {can('newco.regulatory.manage') ? (
          <button type="button" className={cx(btn.primary, 'ms-auto')} onClick={() => setCreate(true)} data-testid="requirement-create">
            <Plus aria-hidden="true" className="size-4" />
            {t('newco.req.add')}
          </button>
        ) : null}
      </div>
      <DataTable
        caption={t('newco.tabs.requirements')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('newco.req.empty')}
        emptyHint={t('newco.req.emptyHint')}
        pagination={list.data ? { page, pageSize: PAGE, total: list.data.total, onPageChange: setPage } : undefined}
        testId="requirements-table"
      />
      <RequirementFormDialog open={create} onClose={() => setCreate(false)} />
    </div>
  );
}

/** Register (no requirement) or edit the descriptive fields (never applicability, status or validity). */
export function RequirementFormDialog({ open, onClose, requirement }: { open: boolean; onClose: () => void; requirement?: Requirement }) {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const entities = useQuery({ queryKey: ck.entities(projectId), enabled: open, queryFn: ({ signal }) => api(N.listLegalEntities, { params: { projectId }, signal }) });
  const init = () => ({
    category: (requirement?.category ?? 'regulatory') as Category,
    authority: requirement?.authority ?? '',
    title: requirement?.title ?? '',
    description: requirement?.description ?? '',
    sourceReference: requirement?.sourceReference ?? '',
    legalEntityId: requirement?.legalEntity?.id ?? '',
    gateKey: requirement?.gateKey ?? '',
  });
  const [f, setF] = useState(init);
  const [owner, setOwner] = useState<PickedUser | null>(null);
  useEffect(() => {
    if (!open) return;
    setF(init());
    setOwner(requirement?.owner ? { id: requirement.owner.userId, displayName: requirement.owner.name ?? '', email: '' } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requirement]);
  const gateOk = !f.gateKey.trim() || /^G[0-9]{1,2}$/.test(f.gateKey.trim());
  const nn = (v: string) => (v.trim() ? v.trim() : null);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={requirement ? t('newco.req.editTitle', { code: requirement.code }) : t('newco.req.add')}
      submitLabel={requirement ? t('common.actions.save') : t('newco.req.add')}
      disabled={!f.title.trim() || !f.authority.trim() || !gateOk}
      size="lg"
      testId="requirement-form"
      onReload={() => void refresh()}
      onSubmit={async () => {
        if (!requirement) {
          const r = await api(N.createRequirement, {
            params: { projectId },
            body: {
              category: f.category,
              authority: f.authority.trim(),
              title: f.title.trim(),
              description: f.description.trim() || undefined,
              origin: 'manual',
              sourceReference: f.sourceReference.trim() || undefined,
              ownerUserId: owner?.id,
              legalEntityId: f.legalEntityId || undefined,
              gateKey: f.gateKey.trim() || undefined,
            },
          });
          await refresh();
          toast.show('success', t('newco.req.created', { code: r.code }));
          return onClose();
        }
        const body: Record<string, unknown> = {};
        if (f.title.trim() !== requirement.title) body.title = f.title.trim();
        if (f.authority.trim() !== requirement.authority) body.authority = f.authority.trim();
        if (nn(f.description) !== requirement.description) body.description = nn(f.description);
        if (nn(f.sourceReference) !== requirement.sourceReference) body.sourceReference = nn(f.sourceReference);
        if ((f.legalEntityId || null) !== (requirement.legalEntity?.id ?? null)) body.legalEntityId = f.legalEntityId || null;
        if (nn(f.gateKey) !== requirement.gateKey) body.gateKey = nn(f.gateKey);
        if ((owner?.id ?? null) !== (requirement.owner?.userId ?? null)) body.ownerUserId = owner?.id ?? null;
        if (Object.keys(body).length === 0) return onClose();
        await api(N.updateRequirement, { params: { projectId, requirementId: requirement.id }, body: { expectedVersion: requirement.version, ...body } });
        await refresh();
        toast.show('success', t('newco.common.saved'));
        onClose();
      }}
    >
      <p className={hint}>{requirement ? t('newco.req.editHint') : t('newco.req.createHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {requirement ? (
          <p className="text-sm">
            <span className="font-medium">{t('newco.req.category')}: </span>
            {tStatus('approvalRegisterCategories', requirement.category)}
          </p>
        ) : (
          <SelectField label={t('newco.req.category')} required value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Category })}>
            {APPROVAL_REGISTER_CATEGORIES.map((v) => (
              <option key={v} value={v}>
                {tStatus('approvalRegisterCategories', v)}
              </option>
            ))}
          </SelectField>
        )}
        <TextField label={t('newco.req.authority')} hint={t('newco.req.authorityHint')} required value={f.authority} maxLength={200} onChange={(e) => setF({ ...f, authority: e.target.value })} />
      </div>
      <TextField label={t('newco.req.title')} required value={f.title} maxLength={300} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <TextAreaField label={t('newco.req.description')} rows={2} value={f.description} maxLength={4000} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <TextField label={t('newco.req.sourceReference')} value={f.sourceReference} maxLength={1000} onChange={(e) => setF({ ...f, sourceReference: e.target.value })} />
      <UserPicker label={t('newco.common.owner')} value={owner} onChange={setOwner} />
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        {can('newco.register.read') ? (
          <SelectField label={t('newco.req.legalEntity')} value={f.legalEntityId} onChange={(e) => setF({ ...f, legalEntityId: e.target.value })}>
            <option value="">{EM_DASH}</option>
            {entities.data?.items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        <TextField label={t('newco.req.gate')} dir="ltr" placeholder="G2" value={f.gateKey} maxLength={3} error={gateOk ? null : t('newco.req.gateInvalid')} onChange={(e) => setF({ ...f, gateKey: e.target.value.toUpperCase() })} />
      </div>
    </FormDialog>
  );
}

/** Specialist applicability assessment with its basis (newco.regulatory.verify; not the registrant — enforced by the API). */
export function AssessApplicabilityDialog({ r, open, onClose }: { r: Requirement; open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const [value, setValue] = useState<'applicable' | 'not_applicable'>('applicable');
  useEffect(() => {
    if (open) setValue(r.applicability === 'not_applicable' ? 'not_applicable' : 'applicable');
  }, [open, r]);
  return (
    <ConfirmCommandDialog
      open={open}
      onClose={onClose}
      title={t('newco.req.assessTitle', { code: r.code })}
      confirmLabel={t('newco.req.assess')}
      expectedVersion={r.version}
      noteMode="required"
      noteLabel={t('newco.req.basis')}
      consequences={[t('newco.req.assessEffect', { value: tStatus('applicabilityStatuses', value) }), t('newco.req.assessNotSelf'), t('newco.req.notDetermination'), t('common.command.audited')]}
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        await api(N.assessApplicability, { params: { projectId, requirementId: r.id }, body: { expectedVersion: r.version, applicability: value, basis: note } });
        await refresh();
        toast.show('success', t('newco.req.assessed'));
        onClose();
      }}
    >
      <SelectField label={t('newco.req.applicability')} required value={value} onChange={(e) => setValue(e.target.value as 'applicable' | 'not_applicable')} data-testid="applicability-select">
        <option value="applicable">{tStatus('applicabilityStatuses', 'applicable')}</option>
        <option value="not_applicable">{tStatus('applicabilityStatuses', 'not_applicable')}</option>
      </SelectField>
    </ConfirmCommandDialog>
  );
}

/** Progress commands (newco.regulatory.manage): start preparation, submit (date), withdraw / reopen (reason), mark expired. */
export function ProgressDialog({ r, command, onClose }: { r: Requirement; command: ProgressCmd | null; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const [date, setDate] = useState(localToday());
  if (!command) return null;
  const needsDate = command === 'submit';
  const reason = command === 'withdraw' || command === 'reopen';
  return (
    <ConfirmCommandDialog
      open
      onClose={onClose}
      title={t(`newco.req.cmd.${command}`)}
      confirmLabel={t(`newco.req.cmd.${command}`)}
      expectedVersion={r.version}
      danger={command === 'withdraw'}
      noteMode={reason ? 'required' : 'optional'}
      noteLabel={reason ? t('newco.common.reason') : t('newco.common.note')}
      confirmDisabled={needsDate && !date}
      consequences={[t(`newco.req.effect.${command}`), t('common.command.audited')]}
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        await api(N.requirementProgress, { params: { projectId, requirementId: r.id }, body: { expectedVersion: r.version, command, ...(needsDate ? { date } : {}), note: note || undefined } });
        await refresh();
        toast.show('success', t('newco.req.done'));
        onClose();
      }}
    >
      {needsDate ? <TextField label={t('newco.req.submittedOn')} type="date" dir="ltr" required max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} /> : null}
    </ConfirmCommandDialog>
  );
}

/** The authority's outcome with evidence and validity (newco.regulatory.verify; not the registrant — enforced by the API). */
export function OutcomeDialog({ r, command, onClose }: { r: Requirement; command: OutcomeCmd | null; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const [f, setF] = useState({ date: localToday(), validFrom: '', validTo: '', conditions: '' });
  useEffect(() => {
    if (command) setF({ date: localToday(), validFrom: '', validTo: '', conditions: '' });
  }, [command]);
  if (!command) return null;
  const grant = command !== 'record_refusal';
  const needsConditions = command === 'record_grant_with_conditions';
  return (
    <ConfirmCommandDialog
      open
      onClose={onClose}
      title={t(`newco.req.cmd.${command}`)}
      confirmLabel={t(`newco.req.cmd.${command}`)}
      expectedVersion={r.version}
      danger={command === 'record_refusal'}
      noteMode="optional"
      noteLabel={t('newco.common.note')}
      confirmDisabled={!f.date || (needsConditions && !f.conditions.trim())}
      consequences={[t(`newco.req.effect.${command}`), t('newco.req.outcomeEvidence', { count: r.evidence.active }), t('newco.req.assessNotSelf'), t('common.command.audited')]}
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        await api(N.recordRequirementOutcome, {
          params: { projectId, requirementId: r.id },
          body: {
            expectedVersion: r.version,
            command,
            date: f.date,
            ...(grant && f.validFrom ? { validFrom: f.validFrom } : {}),
            ...(grant && f.validTo ? { validTo: f.validTo } : {}),
            ...(f.conditions.trim() ? { conditions: f.conditions.trim() } : {}),
            note: note || undefined,
          },
        });
        await refresh();
        toast.show('success', t('newco.req.done'));
        onClose();
      }}
    >
      <div className="space-y-3" data-testid="outcome-form">
        <TextField label={t('newco.req.decisionOn')} type="date" dir="ltr" required max={localToday()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        {grant ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t('newco.req.validFrom')} type="date" dir="ltr" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
            <TextField label={t('newco.req.validTo')} type="date" dir="ltr" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />
          </div>
        ) : null}
        {grant ? <TextAreaField label={t('newco.req.conditionsText')} required={needsConditions} rows={3} value={f.conditions} maxLength={4000} onChange={(e) => setF({ ...f, conditions: e.target.value })} /> : null}
      </div>
    </ConfirmCommandDialog>
  );
}

/** Close the open conditions of a conditional approval with evidence (not the person who recorded the grant). */
export function ConditionsSatisfiedDialog({ r, open, onClose }: { r: Requirement; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  return (
    <ConfirmCommandDialog
      open={open}
      onClose={onClose}
      title={t('newco.req.conditionsTitle', { code: r.code })}
      confirmLabel={t('newco.req.conditionsConfirm')}
      expectedVersion={r.version}
      noteMode="required"
      noteLabel={t('newco.req.conditionsHow')}
      consequences={[t('newco.req.conditionsEffect'), t('newco.req.outcomeEvidence', { count: r.evidence.active }), t('newco.req.conditionsNotSelf'), t('common.command.audited')]}
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        await api(N.conditionsSatisfied, { params: { projectId, requirementId: r.id }, body: { expectedVersion: r.version, note } });
        await refresh();
        toast.show('success', t('newco.req.done'));
        onClose();
      }}
    />
  );
}
