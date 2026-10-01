'use client';

import Link from 'next/link';
import { FileUp, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { AuthorityPolicySchema, governanceRoutes } from '@hub/contracts';
import { CLASSIFICATIONS, COMMITTEE_KINDS, clearanceAllows } from '@hub/domain';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { GovCommandDialog, useCommitteeList, useGovRefresh, useMatrices, type Committee, type MatrixVersion, type PolicyDecisionType } from '../../committee/_components/gov';

type CommitteeKind = (typeof COMMITTEE_KINDS)[number];
type Threshold = 'simple_majority' | 'two_thirds';
type TieRule = 'chair_casting_vote' | 'escalate';

function Block({ id, title, hint, children, testId, actions }: { id: string; title: string; hint?: string; children: ReactNode; testId?: string; actions?: ReactNode }) {
  return (
    <section aria-labelledby={id} className={cx(card, 'space-y-3 p-4')} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={id} className="font-semibold">
            {title}
          </h3>
          {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** "Draft — pending approval" etc.: the state of a matrix version as the wizard shows it (it never approves one). */
function matrixState(m: MatrixVersion): 'pending_approval' | 'pending_verification' | 'approved' | 'superseded' {
  if (m.pendingVerification) return 'pending_verification';
  if (m.status === 'draft') return 'pending_approval';
  return m.status;
}

function CreateCommittee({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel?: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, me } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const [kind, setKind] = useState<CommitteeKind>('program_steering');
  const [name, setName] = useState('');
  const [classification, setClassification] = useState<(typeof CLASSIFICATIONS)[number]>('confidential');
  const [purpose, setPurpose] = useState('');
  const [confirm, setConfirm] = useState(false);
  const classes = CLASSIFICATIONS.filter((c) => clearanceAllows(me.user.clearance, c));
  return (
    <div className="space-y-3 rounded-md border border-line p-3" data-testid="wizard-committee-create">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('governance.committees.create.kind')} required value={kind} onChange={(e) => setKind(e.target.value as CommitteeKind)} hint={t('governance.committees.create.kindHint')}>
          {COMMITTEE_KINDS.map((k) => (
            <option key={k} value={k}>
              {tStatus('committeeKinds', k)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('governance.common.classification')} required value={classification} onChange={(e) => setClassification(e.target.value as typeof classification)}>
          {classes.map((c) => (
            <option key={c} value={c}>
              {tStatus('classifications', c)}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField label={t('governance.committees.create.name')} required value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="wizard-committee-name" />
      <TextAreaField label={t('governance.committees.create.purpose')} value={purpose} maxLength={8000} rows={2} onChange={(e) => setPurpose(e.target.value)} />
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <button type="button" className={btn.secondary} onClick={onCancel}>
            {t('common.actions.cancel')}
          </button>
        ) : null}
        <button type="button" className={btn.primary} disabled={!name.trim()} onClick={() => setConfirm(true)} data-testid="wizard-committee-create-submit">
          {t('governance.committees.create.confirm')}
        </button>
      </div>
      <GovCommandDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('governance.committees.create.title')}
        confirmLabel={t('governance.committees.create.confirm')}
        noteMode="none"
        consequences={[t('governance.committees.create.effect'), t('project.setupWizard.committee.createEffect'), t('common.command.audited')]}
        onConfirm={async () => {
          const r = await api(governanceRoutes.createCommittee, {
            params: { projectId },
            body: { kind, name: name.trim(), classification, charter: { cadenceIsProposal: true, ...(purpose.trim() ? { purpose: purpose.trim() } : {}) } },
          });
          await refresh();
          toast.show('success', t('governance.committees.create.done'));
          setConfirm(false);
          onCreated(r.id);
        }}
      />
    </div>
  );
}

/** Delegation (decision types) as loaded JSON; quorum, threshold and tie rule as form fields. Validated with the API's schema. */
function DelegationForm({ committee, nextVersion }: { committee: Committee; nextVersion: number }) {
  const { t, locale } = useI18n();
  const { projectId, project } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const fileId = useId();
  const [minMembers, setMinMembers] = useState('3');
  const [minPercent, setMinPercent] = useState('50');
  const [threshold, setThreshold] = useState<Threshold>('simple_majority');
  const [tieRule, setTieRule] = useState<TieRule>('escalate');
  const [typesText, setTypesText] = useState('');
  const [demo, setDemo] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const parsed = useMemo(() => {
    if (!typesText.trim()) return { policy: null, types: [] as PolicyDecisionType[], error: null as string | null, issues: [] as string[] };
    let types: unknown;
    try {
      types = JSON.parse(typesText);
    } catch {
      return { policy: null, types: [], error: t('project.setupWizard.committee.invalidJson'), issues: [] };
    }
    const candidate = {
      isDemoPolicy: demo,
      quorum: { minVotingMembersPresent: Number(minMembers), minFractionPresent: Number(minPercent) / 100 },
      approvalThreshold: { type: threshold },
      tieRule,
      decisionTypes: types,
      selfApprovalProhibited: true,
      recusedMembersExcludedFromQuorum: true,
    };
    const r = AuthorityPolicySchema.safeParse(candidate);
    if (!r.success) return { policy: null, types: Array.isArray(types) ? (types as PolicyDecisionType[]) : [], error: null, issues: r.error.issues.map((i) => i.path.join('.') || '—') };
    return { policy: r.data, types: r.data.decisionTypes as PolicyDecisionType[], error: null, issues: [] };
  }, [typesText, demo, minMembers, minPercent, threshold, tieRule, t]);

  const loadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as unknown;
      // A whole policy fills the form; an array is the delegation table alone.
      if (Array.isArray(data)) setTypesText(JSON.stringify(data, null, 2));
      else if (data && typeof data === 'object' && Array.isArray((data as { decisionTypes?: unknown }).decisionTypes)) {
        const p = data as { decisionTypes: unknown[]; quorum?: { minVotingMembersPresent?: number; minFractionPresent?: number }; approvalThreshold?: { type?: Threshold }; tieRule?: TieRule };
        setTypesText(JSON.stringify(p.decisionTypes, null, 2));
        if (p.quorum?.minVotingMembersPresent !== undefined) setMinMembers(String(p.quorum.minVotingMembersPresent));
        if (p.quorum?.minFractionPresent !== undefined) setMinPercent(String(Math.round(p.quorum.minFractionPresent * 100)));
        if (p.approvalThreshold?.type) setThreshold(p.approvalThreshold.type);
        if (p.tieRule) setTieRule(p.tieRule);
      } else setFileError(t('project.setupWizard.committee.fileShape'));
    } catch {
      setFileError(t('project.setupWizard.committee.invalidJson'));
    }
  };

  return (
    <div className="space-y-4" data-testid="wizard-delegation-form">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">{t('project.setupWizard.committee.quorumTitle')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t('project.setupWizard.committee.minMembers')} required type="number" min={1} max={100} dir="ltr" value={minMembers} onChange={(e) => setMinMembers(e.target.value)} data-testid="wizard-quorum-members" />
          <TextField label={t('project.setupWizard.committee.minPercent')} required type="number" min={0} max={100} dir="ltr" value={minPercent} onChange={(e) => setMinPercent(e.target.value)} data-testid="wizard-quorum-percent" />
          <SelectField label={t('project.setupWizard.committee.threshold')} required value={threshold} onChange={(e) => setThreshold(e.target.value as Threshold)}>
            {(['simple_majority', 'two_thirds'] as const).map((x) => (
              <option key={x} value={x}>
                {t(`governance.committee.matrix.thresholds.${x}`)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('project.setupWizard.committee.tieRule')} required value={tieRule} onChange={(e) => setTieRule(e.target.value as TieRule)}>
            {(['escalate', 'chair_casting_vote'] as const).map((x) => (
              <option key={x} value={x}>
                {t(`governance.committee.matrix.ties.${x}`)}
              </option>
            ))}
          </SelectField>
        </div>
        <p className="text-xs text-muted">{t('project.setupWizard.committee.invariants')}</p>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">{t('project.setupWizard.committee.delegationTitle')}</legend>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={fileId} className={cx(btn.secondary, 'cursor-pointer focus-within:outline-2')}>
            <FileUp aria-hidden="true" className="size-4" />
            {t('project.setupWizard.committee.loadFile')}
          </label>
          <input id={fileId} type="file" accept="application/json,.json" className="sr-only" onChange={loadFile} data-testid="wizard-delegation-file" />
          {fileError ? (
            <p className="text-sm text-danger" role="alert">
              {fileError}
            </p>
          ) : null}
        </div>
        <TextAreaField
          label={t('project.setupWizard.committee.delegationJson')}
          required
          rows={8}
          dir="ltr"
          value={typesText}
          onChange={(e) => setTypesText(e.target.value)}
          hint={t('project.setupWizard.committee.delegationHint')}
          error={parsed.error}
          data-testid="wizard-delegation-json"
        />
        {parsed.issues.length > 0 ? (
          <div className="rounded-md border border-danger/40 bg-danger-soft p-2 text-sm text-ink" role="alert" data-testid="wizard-delegation-issues">
            <p className="font-medium">{t('project.setupWizard.committee.invalidPolicy')}</p>
            <ul className="mt-1 list-disc ps-5">
              {parsed.issues.slice(0, 8).map((p, i) => (
                <li key={`${p}-${i}`}>
                  {t('project.setupWizard.committee.invalidAt')}{' '}
                  <code dir="ltr" className="rounded bg-surface px-1">
                    {p}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {parsed.policy ? (
          <DataTable
            caption={t('project.setupWizard.committee.previewTitle')}
            rows={parsed.types}
            rowKey={(x) => x.key}
            emptyTitle={EM_DASH}
            testId="wizard-delegation-preview"
            clientPageSize={20}
            columns={[
              { key: 'name', header: t('governance.committee.matrix.types.name'), isRowHeader: true, cell: (x) => <span dir="auto">{x.name?.[locale] ?? x.key}</span> },
              {
                key: 'limit',
                header: t('governance.committee.matrix.types.limit'),
                cell: (x) =>
                  x.maxAmount ? (
                    <span dir="ltr" className="tabular">
                      {x.maxAmount} {x.currency}
                    </span>
                  ) : (
                    <span className="text-muted">{t('governance.committee.matrix.types.noLimit')}</span>
                  ),
              },
              { key: 'within', header: t('governance.committee.matrix.types.within'), cell: (x) => <StatusBadge enumName="decisionAuthorityOutcomes" value={x.withinCommitteeAuthority ? 'within_mandate' : 'pending_external_authority'} /> },
              { key: 'escalate', header: t('governance.committee.matrix.types.escalateTo'), cell: (x) => <span dir="auto">{x.escalateTo}</span> },
            ]}
          />
        ) : null}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('governance.committee.matrix.draft.effectiveFrom')} type="date" dir="ltr" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        {project.isDemo ? (
          <label className="flex items-start gap-2 self-end text-sm text-ink">
            <input type="checkbox" className="mt-1 size-4" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
            <span>
              {t('project.setupWizard.committee.demoPolicy')} <DemoBadge className="ms-1" />
            </span>
          </label>
        ) : null}
      </div>
      <div className="flex justify-end">
        <button type="button" className={btn.primary} disabled={!parsed.policy} onClick={() => setConfirm(true)} data-testid="wizard-delegation-submit">
          {t('project.setupWizard.committee.saveDraft')}
        </button>
      </div>
      <GovCommandDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('project.setupWizard.committee.saveTitle', { name: committee.name })}
        confirmLabel={t('project.setupWizard.committee.saveDraft')}
        noteMode="none"
        consequences={[
          t('project.setupWizard.committee.saveEffect', { version: nextVersion, name: committee.name }),
          t(demo ? 'project.setupWizard.committee.pendingEffectDemo' : 'project.setupWizard.committee.pendingEffect'),
          t('project.setupWizard.committee.noApproval'),
          t('common.command.audited'),
        ]}
        onConfirm={async () => {
          if (!parsed.policy) return;
          await api(governanceRoutes.createAuthorityMatrixVersion, {
            params: { projectId, committeeId: committee.id },
            body: { policy: parsed.policy, ...(effectiveFrom ? { effectiveFrom } : {}) },
          });
          await refresh();
          toast.show('success', t('project.setupWizard.committee.saved'));
          setConfirm(false);
          setTypesText('');
        }}
      />
    </div>
  );
}

/**
 * Setup wizard step 5 — committee, delegation and quorum (REQ-SET-013): create or select the committee, then load its
 * delegation of authority and quorum rules as a DRAFT authority-matrix version. Nothing is approved here: the charter,
 * the activation and the matrix approval (with its second-person verification) stay with the authorized people on the
 * Committee Hub, and the matrix is not in force until then.
 */
export function StepCommittee() {
  const { t, tStatus, formatDateTime, formatNumber } = useI18n();
  const { projectId, can } = useProjectContext();
  const canRead = can('governance.committee.read');
  const canManage = can('governance.committee.manage');
  const canMatrix = can('governance.authority_matrix.manage');
  const list = useCommitteeList(canRead);
  const [selected, setSelected] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  useEffect(() => {
    if (!selected && items.length > 0) setSelected((items.find((c) => c.kind === 'program_steering') ?? items[0]!).id);
  }, [items, selected]);
  const committee = items.find((c) => c.id === selected) ?? null;
  const matrices = useMatrices(committee?.id);
  const hub = `/projects/${projectId}/committee`;

  if (!canRead) return <RestrictedState showHomeLink={false} />;
  if (list.isLoading) return <LoadingState />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  const nextVersion = Math.max(0, ...(matrices.data?.items ?? []).map((m) => m.versionNo)) + 1;
  const charterLabel = (c: Committee) =>
    c.charterApprovedVersionNo === null
      ? t('project.overview.committees.notApproved')
      : c.charterApprovedVersionNo < c.charterVersionNo
        ? t('project.overview.committees.amendmentPending', { approved: c.charterApprovedVersionNo })
        : t('project.overview.committees.approved');

  return (
    <div className="space-y-4" data-testid="wizard-step-committee">
      <div>
        <h2 className="text-lg font-semibold">{t('project.setupWizard.committee.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('project.setupWizard.committee.hint')}</p>
      </div>

      <Block
        id="wizard-committee-title"
        title={t('project.setupWizard.committee.chooseTitle')}
        hint={t('project.setupWizard.committee.chooseHint')}
        actions={
          canManage && items.length > 0 && !creating ? (
            <button type="button" className={btn.secondary} onClick={() => setCreating(true)} data-testid="wizard-committee-new">
              <Plus aria-hidden="true" className="size-4" />
              {t('governance.committees.create.action')}
            </button>
          ) : null
        }
      >
        {items.length === 0 ? (
          <>
            <EmptyState title={t('project.overview.committees.none')} hint={canManage ? t('project.setupWizard.committee.createFirst') : t('project.setupWizard.committee.askSecretariat')} />
            {canManage ? <CreateCommittee onCreated={setSelected} /> : null}
          </>
        ) : (
          <>
            <fieldset>
              <legend className="sr-only">{t('project.setupWizard.committee.chooseTitle')}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((c) => (
                  <label
                    key={c.id}
                    className={cx('flex cursor-pointer gap-3 rounded-md border p-3', c.id === selected ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-muted')}
                    data-testid="wizard-committee-option"
                  >
                    <input type="radio" name="wizard-committee" className="mt-1 size-4" checked={c.id === selected} onChange={() => setSelected(c.id)} />
                    <span className="min-w-0">
                      <span className="block font-medium" dir="auto">
                        {c.name}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-muted">{tStatus('committeeKinds', c.kind)}</span>
                        <StatusBadge enumName="committeeStatuses" value={c.status} />
                        {c.isDemo ? <DemoBadge /> : null}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {creating ? (
              <CreateCommittee
                onCreated={(id) => {
                  setSelected(id);
                  setCreating(false);
                }}
                onCancel={() => setCreating(false)}
              />
            ) : null}
          </>
        )}
      </Block>

      {committee ? (
        <>
          <Block id="wizard-committee-summary" title={t('project.setupWizard.committee.summaryTitle', { name: committee.name })} testId="wizard-committee-summary">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">{t('project.overview.committees.status')}</dt>
                <dd className="mt-0.5" data-testid="wizard-committee-status" data-status={committee.status}>
                  <StatusBadge enumName="committeeStatuses" value={committee.status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('project.overview.committees.charter')}</dt>
                <dd className="mt-0.5">
                  {t('project.overview.committees.version', { version: committee.charterVersionNo })} · {charterLabel(committee)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('project.setupWizard.committee.seats')}</dt>
                <dd className="mt-0.5">
                  <span className="tabular">{formatNumber(committee.memberCount)}</span>{' '}
                  <Link href={`${hub}/committees/${committee.id}#seats`} className={btn.link}>
                    {t('project.setupWizard.committee.manageSeats')}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('project.setupWizard.committee.inForce')}</dt>
                <dd className="mt-0.5" data-testid="wizard-matrix-in-force" data-version={committee.activeMatrix?.versionNo ?? undefined}>
                  {committee.activeMatrix ? t('documents.versions.label', { version: committee.activeMatrix.versionNo }) : t('project.setupWizard.committee.noneInForce')}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted">{t('project.setupWizard.committee.charterInHub')}</p>
          </Block>

          <Block id="wizard-delegation-title" title={t('project.setupWizard.committee.delegationBlock')} hint={t('project.setupWizard.committee.delegationBlockHint')}>
            {canMatrix ? committee.status === 'dissolved' ? <p className="text-sm text-muted">{t('project.setupWizard.committee.dissolved')}</p> : <DelegationForm committee={committee} nextVersion={nextVersion} /> : <p className="text-sm text-muted">{t('project.setupWizard.committee.cannotLoad')}</p>}
          </Block>

          <Block
            id="wizard-matrices-title"
            title={t('project.setupWizard.committee.versionsTitle')}
            hint={t('project.setupWizard.committee.versionsHint')}
            actions={
              <Link href={`${hub}/committees/${committee.id}#matrix`} className={cx(btn.link, 'text-sm')} data-testid="wizard-open-hub">
                {t('project.setupWizard.committee.openHub')}
              </Link>
            }
          >
            <DataTable
              caption={t('project.setupWizard.committee.versionsTitle')}
              rows={matrices.data?.items}
              rowKey={(m) => m.id}
              isLoading={matrices.isLoading}
              error={matrices.error}
              onRetry={() => matrices.refetch()}
              emptyTitle={t('governance.committee.matrix.versionsEmpty')}
              testId="wizard-matrices-table"
              columns={[
                { key: 'v', header: t('governance.committee.matrix.columns.version'), isRowHeader: true, cell: (m) => <span className="tabular">{t('documents.versions.label', { version: m.versionNo })}</span> },
                {
                  key: 'state',
                  header: t('governance.committee.matrix.columns.status'),
                  cell: (m) => {
                    const s = matrixState(m);
                    return (
                      <span data-testid="wizard-matrix-status" data-version={m.versionNo} data-status={m.status} data-state={s}>
                        <StatusBadge enumName="authorityMatrixStatuses" value={s === 'pending_approval' || s === 'pending_verification' ? 'pending' : s} tone={s === 'approved' ? 'success' : s === 'superseded' ? 'neutral' : 'warning'} label={t(`project.setupWizard.committee.state.${s}`)} />
                      </span>
                    );
                  },
                },
                { key: 'demo', header: t('governance.committee.matrix.columns.demo'), cell: (m) => (m.isDemoPolicy ? <DemoBadge /> : t('governance.committee.matrix.real')) },
                { key: 'created', header: t('project.setupWizard.committee.createdAt'), cell: (m) => <span className="tabular">{formatDateTime(m.createdAt)}</span> },
              ]}
            />
          </Block>
        </>
      ) : null}
    </div>
  );
}
