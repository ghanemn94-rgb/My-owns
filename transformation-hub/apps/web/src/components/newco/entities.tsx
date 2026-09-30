'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { newcoRoutes as N } from '@hub/contracts';
import { ENTITY_KINDS, INCORPORATION_STATUSES, type IncorporationStatus } from '@hub/domain';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { ck, entityHref, useRefreshCarveout, type LegalEntity } from '@/lib/carveout';
import { useStatusDimensions } from '@/lib/gates';
import { useProjectContext } from '@/lib/project-context';
import { ConfirmCommandDialog } from '../ConfirmCommandDialog';
import { DataTable, type Column } from '../DataTable';
import { DemoBadge } from '../DemoBadge';
import { SelectField, TextAreaField, TextField } from '../Field';
import { DimensionCards } from '../ProjectDimensions';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../Toast';
import { VerificationBadge } from '../VerificationBadge';
import { btn, cx, hint } from '../ui';
import { CodeLink, Section } from '../planning/bits';
import { FormDialog } from '../planning/dialogs';

type Incorporation = LegalEntity['incorporation'];
type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * Incorporation status as RECORDED and its VERIFICATION, always side by side (AT-06): a recorded "incorporated" stays a
 * claim (amber) until someone other than the recorder verifies it against evidence.
 */
export function IncorporationBadges({ inc, size = 'sm' }: { inc: Incorporation; size?: 'sm' | 'md' }) {
  const verified = inc.verification === 'confirmed';
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="incorporation-badges" data-status={inc.status} data-verification={inc.verification}>
      <StatusBadge enumName="incorporationStatuses" value={inc.status} size={size} tone={verified || inc.status === 'not_applicable' ? undefined : inc.status === 'unconfirmed' ? 'neutral' : 'warning'} />
      <VerificationBadge value={inc.verification} />
    </span>
  );
}

/** The four independent status dimensions and the carve-out completion flag (computed by the gates module). */
export function DimensionsSummary({ className }: { className?: string }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const dims = useStatusDimensions(projectId);
  if (!dims.data) return null;
  return (
    <Section id="status-dimensions" title={t('newco.dimensions.title')} hint={t('newco.dimensions.hint')} className={className}>
      <DimensionCards dimensions={dims.data.items} hrefFor={(k) => `/projects/${projectId}/dimensions/${k}`} linkLabel={t('newco.dimensions.open')} />
      <p className="mt-3 text-sm" data-testid="carveout-complete" data-value={String(dims.data.carveOutComplete)}>
        <span className="font-medium">{t('newco.dimensions.carveOutComplete')}: </span>
        {dims.data.carveOutComplete ? t('newco.common.yes') : t('newco.common.no')}
        <span className="block text-xs text-muted">{t('newco.dimensions.carveOutCompleteHint')}</span>
      </p>
    </Section>
  );
}

export function EntitiesPanel() {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const q = useQuery({ queryKey: ck.entities(projectId), queryFn: ({ signal }) => api(N.listLegalEntities, { params: { projectId }, signal }) });
  const [create, setCreate] = useState(false);
  const [setup, setSetup] = useState(false);
  const hasNewco = (q.data?.items ?? []).some((e) => e.role === 'newco');
  const columns: Column<LegalEntity>[] = [
    {
      key: 'name',
      header: t('newco.entities.name'),
      isRowHeader: true,
      sortValue: (e) => e.name,
      cell: (e) => (
        <span className="flex flex-col gap-0.5">
          <CodeLink href={entityHref(projectId, e.id)} code={e.name} testId="entity-link" />
          {e.ownedByThisProject ? null : (
            <span className="text-xs text-muted" data-testid="entity-not-owned-hint">
              {t('newco.entities.managedElsewhere')}
            </span>
          )}
        </span>
      ),
    },
    { key: 'role', header: t('newco.entities.role'), sortValue: (e) => tStatus('entityKinds', e.role), cell: (e) => tStatus('entityKinds', e.role) },
    { key: 'inc', header: t('newco.incorporation.recordedStatus'), cell: (e) => <IncorporationBadges inc={e.incorporation} /> },
    {
      key: 'recorded',
      header: t('newco.incorporation.recorded'),
      cell: (e) => (e.incorporation.recordedAt ? <span className="text-sm"><span dir="auto">{e.incorporation.recordedBy?.name ?? EM_DASH}</span> · {formatDateTime(e.incorporation.recordedAt)}</span> : <span className="text-sm text-muted">{t('newco.incorporation.notRecorded')}</span>),
    },
    {
      key: 'verified',
      header: t('newco.incorporation.verified'),
      cell: (e) => (e.incorporation.verifiedAt ? <span className="text-sm"><span dir="auto">{e.incorporation.verifiedBy?.name ?? EM_DASH}</span> · {formatDateTime(e.incorporation.verifiedAt)}</span> : <span className="text-sm text-muted">{t('newco.incorporation.notVerified')}</span>),
    },
    { key: 'ev', header: t('newco.common.evidence'), cell: (e) => <span className="tabular">{t('newco.common.evidenceCount', { active: e.evidence.active, conflicting: e.evidence.conflicting })}</span> },
    { key: 'reg', header: t('newco.entities.registrationRef'), cell: (e) => <span dir="auto">{e.registrationRef ?? EM_DASH}</span> },
    { key: 'demo', header: '', cell: (e) => (e.isDemo ? <DemoBadge /> : null) },
  ];
  return (
    <div className="space-y-4" data-testid="legal-entities">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">{t('newco.entities.explain')}</p>
        <div className="flex flex-wrap gap-2">
          {q.data && !hasNewco && can('newco.incorporation.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setSetup(true)} data-testid="newco-setup">
              <Building2 aria-hidden="true" className="size-4" />
              {t('newco.setup.open')}
            </button>
          ) : null}
          {can('newco.legal_entity.manage') ? (
            <button type="button" className={btn.secondary} onClick={() => setCreate(true)} data-testid="entity-create">
              <Plus aria-hidden="true" className="size-4" />
              {t('newco.entities.add')}
            </button>
          ) : null}
        </div>
      </div>
      <DataTable
        caption={t('newco.tabs.entities')}
        columns={columns}
        rows={q.data?.items}
        rowKey={(e) => e.id}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        emptyTitle={t('newco.entities.empty')}
        emptyHint={t('newco.entities.emptyHint')}
        testId="entities-table"
      />
      <DimensionsSummary />
      <CreateEntityDialog open={create} onClose={() => setCreate(false)} />
      <SetupNewcoDialog open={setup} onClose={() => setSetup(false)} entities={q.data?.items ?? []} />
    </div>
  );
}

function CreateEntityDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const blank = { name: '', kind: 'counterparty' as EntityKind, role: '' as EntityKind | '', registrationRef: '', jurisdiction: '' };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('newco.entities.add')}
      submitLabel={t('newco.entities.add')}
      disabled={!f.name.trim()}
      testId="entity-form"
      onSubmit={async () => {
        await api(N.createLegalEntity, {
          params: { projectId },
          body: { name: f.name.trim(), kind: f.kind, role: f.role || undefined, registrationRef: f.registrationRef.trim() || undefined, jurisdiction: f.jurisdiction.trim() || undefined },
        });
        await refresh();
        toast.show('success', t('newco.entities.created'));
        onClose();
      }}
    >
      <p className={hint}>{t('newco.entities.createHint')}</p>
      <TextField label={t('newco.entities.name')} required value={f.name} maxLength={300} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('newco.entities.kind')} required value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as EntityKind })}>
          {ENTITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {tStatus('entityKinds', k)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('newco.entities.role')} hint={t('newco.entities.roleHint')} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as EntityKind | '' })}>
          <option value="">{t('newco.entities.sameAsKind')}</option>
          {ENTITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {tStatus('entityKinds', k)}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('newco.entities.registrationRef')} value={f.registrationRef} maxLength={200} onChange={(e) => setF({ ...f, registrationRef: e.target.value })} />
        <TextField label={t('newco.entities.jurisdiction')} value={f.jurisdiction} maxLength={200} onChange={(e) => setF({ ...f, jurisdiction: e.target.value })} />
      </div>
    </FormDialog>
  );
}

const SETUP_STATUSES = ['incorporated', 'incorporation_in_progress', 'unconfirmed'] as const;

/** Setup wizard step 2 (REQ-SET-010): NewCo status with evidence; "incorporated" without evidence is refused by the API. */
function SetupNewcoDialog({ open, onClose, entities }: { open: boolean; onClose: () => void; entities: LegalEntity[] }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  // Only an entity owned by this project can be set up here (SEC-P1R-03: linked projects get 403 newco.legal_entity.not_owner).
  const candidates = entities.filter((e) => e.kind === 'newco' && e.ownedByThisProject);
  const blank = { mode: (candidates.length ? 'existing' : 'new') as 'existing' | 'new', legalEntityId: candidates[0]?.id ?? '', name: '', status: 'unconfirmed' as (typeof SETUP_STATUSES)[number], registrationRef: '', evidenceNote: '', note: '' };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const ok = f.mode === 'existing' ? !!f.legalEntityId : !!f.name.trim();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('newco.setup.title')}
      submitLabel={t('newco.setup.submit')}
      disabled={!ok}
      testId="newco-setup-form"
      onSubmit={async () => {
        const r = await api(N.setupNewcoStatus, {
          params: { projectId },
          body: {
            mode: f.mode,
            ...(f.mode === 'existing' ? { legalEntityId: f.legalEntityId } : { name: f.name.trim() }),
            status: f.status,
            registrationRef: f.registrationRef.trim() || undefined,
            evidence: f.evidenceNote.trim() ? { note: f.evidenceNote.trim() } : undefined,
            note: f.note.trim() || undefined,
          },
        });
        await refresh();
        toast.show('success', t('newco.setup.done', { status: tStatus('incorporationStatuses', r.status) }));
        onClose();
      }}
    >
      <p className={hint}>{t('newco.setup.hint')}</p>
      {candidates.length ? (
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">{t('newco.setup.mode')}</legend>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="newco-mode" checked={f.mode === 'existing'} onChange={() => setF({ ...f, mode: 'existing' })} />
            {t('newco.setup.existing')}
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="newco-mode" checked={f.mode === 'new'} onChange={() => setF({ ...f, mode: 'new' })} />
            {t('newco.setup.new')}
          </label>
        </fieldset>
      ) : null}
      {f.mode === 'existing' ? (
        <SelectField label={t('newco.entities.name')} required value={f.legalEntityId} onChange={(e) => setF({ ...f, legalEntityId: e.target.value })}>
          {candidates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <TextField label={t('newco.entities.name')} required value={f.name} maxLength={300} onChange={(e) => setF({ ...f, name: e.target.value })} />
      )}
      <SelectField label={t('newco.incorporation.status')} required value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as (typeof SETUP_STATUSES)[number] })}>
        {SETUP_STATUSES.map((s) => (
          <option key={s} value={s}>
            {tStatus('incorporationStatuses', s)}
          </option>
        ))}
      </SelectField>
      <TextField label={t('newco.entities.registrationRef')} value={f.registrationRef} maxLength={200} onChange={(e) => setF({ ...f, registrationRef: e.target.value })} />
      <TextAreaField label={t('newco.setup.evidenceNote')} hint={t('newco.setup.evidenceHint')} rows={2} value={f.evidenceNote} maxLength={2000} onChange={(e) => setF({ ...f, evidenceNote: e.target.value })} />
      <TextAreaField label={t('newco.common.note')} rows={2} value={f.note} maxLength={2000} onChange={(e) => setF({ ...f, note: e.target.value })} />
    </FormDialog>
  );
}

/** Record the incorporation status (a claim, "proposed" until verified). Never changes transfers or operations (AT-06). */
export function RecordIncorporationDialog({ entity, open, onClose }: { entity: LegalEntity; open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const [status, setStatus] = useState<IncorporationStatus>(entity.incorporation.status);
  const [evidenceNote, setEvidenceNote] = useState('');
  useEffect(() => {
    if (open) {
      setStatus(entity.incorporation.status);
      setEvidenceNote(entity.incorporation.evidenceNote ?? '');
    }
  }, [open, entity]);
  const needsEvidence = status === 'incorporated' || status === 'incorporation_in_progress';
  return (
    <ConfirmCommandDialog
      open={open}
      onClose={onClose}
      title={t('newco.incorporation.recordTitle', { name: entity.name })}
      confirmLabel={t('newco.incorporation.record')}
      expectedVersion={entity.version}
      noteMode={status === 'not_applicable' ? 'required' : 'optional'}
      noteLabel={status === 'not_applicable' ? t('newco.incorporation.basis') : t('newco.common.note')}
      consequences={[
        status === 'unconfirmed' ? t('newco.incorporation.effectUnconfirmed') : t('newco.incorporation.effectProposed', { status: tStatus('incorporationStatuses', status) }),
        ...(needsEvidence ? [t('newco.incorporation.evidenceRule', { count: entity.evidence.active })] : []),
        t('newco.incorporation.separate'),
        t('common.command.audited'),
      ]}
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        const r = await api(N.recordIncorporation, {
          params: { projectId, entityId: entity.id },
          body: { expectedVersion: entity.version, status, evidenceNote: evidenceNote.trim() || undefined, note: note || undefined },
        });
        await refresh();
        toast.show('success', t('newco.incorporation.recordedToast', { status: tStatus('incorporationStatuses', r.status), verification: tStatus('verificationStatuses', r.verification) }));
        onClose();
      }}
    >
      <div className="space-y-3" data-testid="incorporation-form">
        <SelectField label={t('newco.incorporation.status')} required value={status} onChange={(e) => setStatus(e.target.value as IncorporationStatus)} data-testid="incorporation-status-select">
          {INCORPORATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus('incorporationStatuses', s)}
            </option>
          ))}
        </SelectField>
        <TextAreaField label={t('newco.incorporation.evidenceNote')} hint={t('newco.incorporation.evidenceNoteHint')} rows={2} value={evidenceNote} maxLength={2000} onChange={(e) => setEvidenceNote(e.target.value)} />
      </div>
    </ConfirmCommandDialog>
  );
}

/** Verify (or reject) the recorded status against the linked evidence — not the recorder (SoD enforced by the API). */
export function VerifyIncorporationDialog({ entity, outcome, onClose }: { entity: LegalEntity; outcome: 'confirm' | 'reject' | null; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  if (!outcome) return null;
  return (
    <ConfirmCommandDialog
      open
      onClose={onClose}
      title={outcome === 'confirm' ? t('newco.incorporation.verifyTitle', { name: entity.name }) : t('newco.incorporation.rejectTitle', { name: entity.name })}
      confirmLabel={outcome === 'confirm' ? t('newco.incorporation.verify') : t('newco.incorporation.reject')}
      expectedVersion={entity.version}
      danger={outcome === 'reject'}
      noteMode={outcome === 'reject' ? 'required' : 'optional'}
      noteLabel={outcome === 'reject' ? t('newco.common.reason') : t('newco.common.note')}
      consequences={[
        outcome === 'confirm'
          ? t('newco.incorporation.verifyEffect', { status: tStatus('incorporationStatuses', entity.incorporation.status), count: entity.evidence.active })
          : t('newco.incorporation.rejectEffect'),
        t('newco.incorporation.notSelf'),
        t('newco.incorporation.separate'),
        t('common.command.audited'),
      ]}
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        const r = await api(N.verifyIncorporation, { params: { projectId, entityId: entity.id }, body: { expectedVersion: entity.version, outcome, note: note || undefined } });
        await refresh();
        toast.show('success', t('newco.incorporation.verifiedToast', { verification: tStatus('verificationStatuses', r.verification) }));
        onClose();
      }}
    />
  );
}

export function EditEntityDialog({ entity, open, onClose }: { entity: LegalEntity; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const init = () => ({ name: entity.name, registrationRef: entity.registrationRef ?? '', jurisdiction: entity.jurisdiction ?? '' });
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entity]);
  const nn = (v: string) => (v.trim() ? v.trim() : null);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('newco.entities.editTitle', { name: entity.name })}
      submitLabel={t('common.actions.save')}
      disabled={!f.name.trim()}
      onReload={() => void refresh()}
      onSubmit={async () => {
        const body: { name?: string; registrationRef?: string | null; jurisdiction?: string | null } = {};
        if (f.name.trim() !== entity.name) body.name = f.name.trim();
        if (nn(f.registrationRef) !== entity.registrationRef) body.registrationRef = nn(f.registrationRef);
        if (nn(f.jurisdiction) !== entity.jurisdiction) body.jurisdiction = nn(f.jurisdiction);
        if (Object.keys(body).length === 0) return onClose();
        await api(N.updateLegalEntity, { params: { projectId, entityId: entity.id }, body: { expectedVersion: entity.version, ...body } });
        await refresh();
        toast.show('success', t('newco.common.saved'));
        onClose();
      }}
    >
      <p className={hint}>{t('newco.entities.editHint')}</p>
      <TextField label={t('newco.entities.name')} required value={f.name} maxLength={300} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <div className={cx('grid gap-3 sm:grid-cols-2')}>
        <TextField label={t('newco.entities.registrationRef')} value={f.registrationRef} maxLength={200} onChange={(e) => setF({ ...f, registrationRef: e.target.value })} />
        <TextField label={t('newco.entities.jurisdiction')} value={f.jurisdiction} maxLength={200} onChange={(e) => setF({ ...f, jurisdiction: e.target.value })} />
      </div>
    </FormDialog>
  );
}
