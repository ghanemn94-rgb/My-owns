'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { aiRoutes, type RouteBody } from '@hub/contracts';
import { AI_AUTOPILOT_ELIGIBLE, AI_MODES, AI_PROVIDERS, CLASSIFICATIONS, type AiProposableAction } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { ErrorState } from '@/components/ErrorState';
import { SelectField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, cx, hint } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useAiRefresh, useAiSettings, useAiStatus, useMemberNames, type AiEndpoint, type AiSettings } from '@/lib/ai';
import { useProjectContext } from '@/lib/project-context';
import { AuthorityNotice, Callout, Facts, KillSwitchBadge, ModeBadge, ModeReference, Panel, Person, ProviderStatusBadge } from '../_components/bits';
import { AiCommandDialog } from '../_components/dialogs';
import { TabGuard } from '../_components/nav';

type UpdateBody = RouteBody<typeof aiRoutes.updateSettings>;

/**
 * AI settings and controls (spec §12.3–12.4). Authority mode and budgets through `PUT …/ai/settings`; autopilot policy
 * proposed here and approved by a DIFFERENT person; emergency stop activated with a reason and released by someone other
 * than the activator. No AI action runs without the configured authority mode — this page says so plainly.
 */
export default function AiSettingsPage() {
  return (
    <TabGuard tab="settings">
      <SettingsScreen />
    </TabGuard>
  );
}

function SettingsScreen() {
  const { t } = useI18n();
  const { projectId, can } = useProjectContext();
  const settings = useAiSettings();
  const status = useAiStatus();
  const canManage = can('ai.settings.manage');
  return (
    <>
      <PageHeader title={t('ai.settings.title')} description={t('ai.settings.subtitle')} />
      <div className="space-y-6" data-testid="ai-settings">
        <AuthorityNotice />
        {canManage ? (
          settings.isLoading ? (
            <LoadingState />
          ) : settings.error || !settings.data ? (
            <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
          ) : (
            <>
              <SettingsForm key={settings.data.version} s={settings.data} endpoints={status.data?.endpoints ?? null} onReload={() => settings.refetch()} />
              <AutopilotPanel s={settings.data} onReload={() => settings.refetch()} />
            </>
          )
        ) : (
          <Callout testId="settings-not-manager">
            <p>{t('ai.settings.notManager')}</p>
          </Callout>
        )}
        {can(['ai.killswitch.activate', 'ai.killswitch.release']) ? <EmergencyStop settings={settings.data ?? null} statusKill={status.data?.killSwitch ?? null} loading={canManage ? settings.isLoading : status.isLoading} /> : null}
        <ModeReference />
        <ActivityHistory projectId={projectId} entityType="ai_project_settings" />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Authority mode, provider and budgets

interface FormState {
  mode: string;
  provider: string;
  model: string;
  ceiling: string;
  monthlyTokenBudget: string;
  perRunTokenLimit: string;
  perRunTimeoutSec: string;
  monthlyCostBudget: string;
  costCurrency: string;
  quietStart: string;
  quietEnd: string;
  briefingCron: string;
  briefingTimezone: string;
}

function toForm(s: AiSettings): FormState {
  return {
    mode: s.mode,
    provider: s.provider,
    model: s.model ?? '',
    ceiling: s.maxClassificationToProvider,
    monthlyTokenBudget: String(s.monthlyTokenBudget),
    perRunTokenLimit: String(s.perRunTokenLimit),
    perRunTimeoutSec: String(Math.round(s.perRunTimeoutMs / 1000)),
    monthlyCostBudget: s.monthlyCostBudget ?? '',
    costCurrency: s.costCurrency ?? '',
    quietStart: s.quietHoursStart === null ? '' : String(s.quietHoursStart),
    quietEnd: s.quietHoursEnd === null ? '' : String(s.quietHoursEnd),
    briefingCron: s.briefingCron ?? '',
    briefingTimezone: s.briefingTimezone,
  };
}

const intOrNull = (v: string) => (v.trim() === '' ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);

function SettingsForm({ s, endpoints, onReload }: { s: AiSettings; endpoints: AiEndpoint[] | null; onReload: () => void }) {
  const { t, tStatus, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useAiRefresh();
  const toast = useToast();
  const [f, setF] = useState<FormState>(() => toForm(s));
  const [confirm, setConfirm] = useState(false);
  const [touched, setTouched] = useState(false);
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const endpointStatus = (p: string) => endpoints?.find((e) => e.provider === p)?.status ?? null;
  const unusable = (st: string | null) => st !== null && ['not_configured', 'egress_not_approved', 'disabled_by_config'].includes(st);
  const autopilotApproved = s.autopilotPolicy?.status === 'approved';

  // ---- client-side checks (the server validates again and refuses with a translated reason) ----
  const errors: Partial<Record<keyof FormState, string>> = {};
  const budget = intOrNull(f.monthlyTokenBudget);
  if (budget === null || Number.isNaN(budget) || budget < 0) errors.monthlyTokenBudget = t('ai.settings.errors.integer');
  else if (f.mode !== 'off' && budget <= 0) errors.monthlyTokenBudget = t('ai.settings.errors.budgetRequired');
  const perRun = intOrNull(f.perRunTokenLimit);
  if (perRun === null || Number.isNaN(perRun) || perRun < 500 || perRun > 200000) errors.perRunTokenLimit = t('ai.settings.errors.range', { min: formatNumber(500), max: formatNumber(200000) });
  const timeout = intOrNull(f.perRunTimeoutSec);
  if (timeout === null || Number.isNaN(timeout) || timeout < 1 || timeout > 300) errors.perRunTimeoutSec = t('ai.settings.errors.range', { min: formatNumber(1), max: formatNumber(300) });
  for (const k of ['quietStart', 'quietEnd'] as const) {
    const h = intOrNull(f[k]);
    if (h !== null && (Number.isNaN(h) || h < 0 || h > 23)) errors[k] = t('ai.settings.errors.range', { min: formatNumber(0), max: formatNumber(23) });
  }
  if (f.monthlyCostBudget.trim() && !/^\d{1,16}(\.\d{1,4})?$/.test(f.monthlyCostBudget.trim())) errors.monthlyCostBudget = t('ai.settings.errors.decimal');
  if (f.costCurrency.trim() && !/^[A-Z]{3}$/.test(f.costCurrency.trim())) errors.costCurrency = t('ai.settings.errors.currency');
  if (f.monthlyCostBudget.trim() && !f.costCurrency.trim()) errors.costCurrency = t('ai.settings.errors.currencyRequired');
  if (f.mode !== 'off' && f.provider === 'off') errors.provider = t('ai.settings.errors.providerRequired');
  if (f.briefingCron.trim() && !/^(\S+\s+){4}\S+$/.test(f.briefingCron.trim())) errors.briefingCron = t('ai.settings.errors.cron');
  const hasErrors = Object.keys(errors).length > 0;

  // ---- the exact change set that will be sent (only changed fields) ----
  const base = toForm(s);
  const changes: { label: string; from: string; to: string }[] = [];
  const body: UpdateBody = { expectedVersion: s.version };
  const note = (label: string, from: string, to: string) => changes.push({ label, from: from || EM_DASH, to: to || EM_DASH });
  if (f.mode !== base.mode) {
    body.mode = f.mode as UpdateBody['mode'];
    note(t('ai.settings.mode'), tStatus('aiModes', base.mode), tStatus('aiModes', f.mode));
  }
  if (f.provider !== base.provider) {
    body.provider = f.provider as UpdateBody['provider'];
    note(t('ai.settings.provider'), t(`ai.providers.${base.provider}` as MessageKey), t(`ai.providers.${f.provider}` as MessageKey));
  }
  if (f.model.trim() !== base.model) {
    body.model = f.model.trim() || null;
    note(t('ai.settings.model'), base.model, f.model.trim());
  }
  if (f.ceiling !== base.ceiling) {
    body.maxClassificationToProvider = f.ceiling as UpdateBody['maxClassificationToProvider'];
    note(t('ai.settings.ceiling'), tStatus('classifications', base.ceiling), tStatus('classifications', f.ceiling));
  }
  if (!hasErrors) {
    if (f.monthlyTokenBudget !== base.monthlyTokenBudget) {
      body.monthlyTokenBudget = Number(f.monthlyTokenBudget);
      note(t('ai.settings.monthlyTokenBudget'), formatNumber(Number(base.monthlyTokenBudget)), formatNumber(Number(f.monthlyTokenBudget)));
    }
    if (f.perRunTokenLimit !== base.perRunTokenLimit) {
      body.perRunTokenLimit = Number(f.perRunTokenLimit);
      note(t('ai.settings.perRunTokenLimit'), formatNumber(Number(base.perRunTokenLimit)), formatNumber(Number(f.perRunTokenLimit)));
    }
    if (f.perRunTimeoutSec !== base.perRunTimeoutSec) {
      body.perRunTimeoutMs = Number(f.perRunTimeoutSec) * 1000;
      note(t('ai.settings.perRunTimeout'), base.perRunTimeoutSec, f.perRunTimeoutSec);
    }
    if (f.monthlyCostBudget.trim() !== base.monthlyCostBudget || f.costCurrency.trim() !== base.costCurrency) {
      body.monthlyCostBudget = f.monthlyCostBudget.trim() || null;
      body.costCurrency = f.costCurrency.trim() || null;
      note(t('ai.settings.costBudget'), `${base.monthlyCostBudget} ${base.costCurrency}`.trim(), `${f.monthlyCostBudget.trim()} ${f.costCurrency.trim()}`.trim());
    }
    if (f.quietStart !== base.quietStart || f.quietEnd !== base.quietEnd) {
      body.quietHoursStart = intOrNull(f.quietStart);
      body.quietHoursEnd = intOrNull(f.quietEnd);
      note(t('ai.settings.quietHours'), `${base.quietStart}–${base.quietEnd}`, `${f.quietStart}–${f.quietEnd}`);
    }
  }
  if (f.briefingCron.trim() !== base.briefingCron) {
    body.briefingCron = f.briefingCron.trim() || null;
    note(t('ai.settings.briefingCron'), base.briefingCron, f.briefingCron.trim());
  }
  if (f.briefingTimezone.trim() !== base.briefingTimezone && f.briefingTimezone.trim()) {
    body.briefingTimezone = f.briefingTimezone.trim();
    note(t('ai.settings.briefingTimezone'), base.briefingTimezone, f.briefingTimezone.trim());
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (hasErrors || changes.length === 0) return;
    setConfirm(true);
  };
  const err = (k: keyof FormState) => (touched ? (errors[k] ?? null) : null);

  return (
    <Panel title={t('ai.settings.formTitle')} testId="settings-form-panel" description={t('ai.settings.formHint')}>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{t('ai.settings.current')}</span>
        <ModeBadge mode={s.mode} testId="current-mode" />
        <ProviderStatusBadge status={s.providerStatus} testId="current-provider-status" />
        <span className="text-xs text-muted">{t('ai.common.versionShort', { version: formatNumber(s.version) })}</span>
      </div>
      <form onSubmit={submit} className="space-y-5" noValidate data-testid="settings-form">
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-ink">{t('ai.settings.authorityLegend')}</legend>
          <SelectField label={t('ai.settings.mode')} required value={f.mode} onChange={set('mode')} hint={t(`ai.modes.${f.mode}` as MessageKey)} data-testid="settings-mode">
            {AI_MODES.map((m) => (
              <option key={m} value={m} disabled={m === 'autopilot' && !autopilotApproved && s.mode !== 'autopilot'}>
                {tStatus('aiModes', m)}
                {m === 'autopilot' && !autopilotApproved ? ` — ${t('ai.settings.autopilotNeedsPolicy')}` : ''}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('ai.settings.provider')} required value={f.provider} onChange={set('provider')} error={err('provider')} hint={t('ai.settings.providerHint')} data-testid="settings-provider">
            {AI_PROVIDERS.map((p) => {
              const st = p === 'off' ? null : endpointStatus(p);
              return (
                <option key={p} value={p} disabled={unusable(st) && p !== s.provider}>
                  {t(`ai.providers.${p}` as MessageKey)}
                  {st ? ` — ${t(`ai.providerStatus.${st}` as MessageKey)}` : ''}
                </option>
              );
            })}
          </SelectField>
          <TextField label={t('ai.settings.model')} value={f.model} onChange={set('model')} hint={t('ai.settings.modelHint')} dir="ltr" maxLength={128} data-testid="settings-model" />
          <SelectField label={t('ai.settings.ceiling')} required value={f.ceiling} onChange={set('ceiling')} hint={t('ai.settings.ceilingHint')} data-testid="settings-ceiling">
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {tStatus('classifications', c)}
              </option>
            ))}
          </SelectField>
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-ink">{t('ai.settings.budgetLegend')}</legend>
          <TextField label={t('ai.settings.monthlyTokenBudget')} required inputMode="numeric" value={f.monthlyTokenBudget} onChange={set('monthlyTokenBudget')} error={err('monthlyTokenBudget')} hint={t('ai.settings.monthlyTokenBudgetHint')} dir="ltr" data-testid="settings-budget" />
          <TextField label={t('ai.settings.perRunTokenLimit')} required inputMode="numeric" value={f.perRunTokenLimit} onChange={set('perRunTokenLimit')} error={err('perRunTokenLimit')} dir="ltr" data-testid="settings-per-run" />
          <TextField label={t('ai.settings.perRunTimeout')} required inputMode="numeric" value={f.perRunTimeoutSec} onChange={set('perRunTimeoutSec')} error={err('perRunTimeoutSec')} hint={t('ai.settings.perRunTimeoutHint')} dir="ltr" data-testid="settings-timeout" />
          <TextField label={t('ai.settings.monthlyCostBudget')} inputMode="decimal" value={f.monthlyCostBudget} onChange={set('monthlyCostBudget')} error={err('monthlyCostBudget')} hint={t('ai.settings.costHint')} dir="ltr" data-testid="settings-cost" />
          <TextField label={t('ai.settings.costCurrency')} value={f.costCurrency} onChange={(e) => setF((x) => ({ ...x, costCurrency: e.target.value.toUpperCase() }))} error={err('costCurrency')} maxLength={3} dir="ltr" data-testid="settings-currency" />
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="mb-2 text-sm font-semibold text-ink">{t('ai.settings.scheduleLegend')}</legend>
          <TextField label={t('ai.settings.quietStart')} inputMode="numeric" value={f.quietStart} onChange={set('quietStart')} error={err('quietStart')} hint={t('ai.settings.quietHint')} dir="ltr" data-testid="settings-quiet-start" />
          <TextField label={t('ai.settings.quietEnd')} inputMode="numeric" value={f.quietEnd} onChange={set('quietEnd')} error={err('quietEnd')} dir="ltr" data-testid="settings-quiet-end" />
          <TextField label={t('ai.settings.briefingCron')} value={f.briefingCron} onChange={set('briefingCron')} error={err('briefingCron')} hint={t('ai.settings.briefingCronHint')} dir="ltr" data-testid="settings-cron" />
          <TextField label={t('ai.settings.briefingTimezone')} required value={f.briefingTimezone} onChange={set('briefingTimezone')} dir="ltr" data-testid="settings-timezone" />
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={btn.primary} disabled={changes.length === 0 && !touched} data-testid="settings-save">
            {t('ai.settings.review')}
          </button>
          <button type="button" className={btn.secondary} onClick={() => setF(toForm(s))} disabled={changes.length === 0}>
            {t('ai.settings.discard')}
          </button>
          {touched && changes.length === 0 && !hasErrors ? <span className="text-sm text-muted">{t('ai.settings.noChanges')}</span> : null}
        </div>
      </form>
      <AiCommandDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('ai.settings.confirmTitle')}
        confirmLabel={t('ai.settings.save')}
        consequences={[
          ...changes.map((c) => (
            <span key={c.label} data-testid="settings-change">
              {t('ai.settings.changeLine', { field: c.label, from: c.from, to: c.to })}
            </span>
          )),
          body.mode && body.mode !== 'off' && s.mode === 'off' ? t('ai.settings.enableConsequence') : t('ai.settings.saveConsequence'),
        ]}
        basedOn={t('ai.settings.boundTo', { version: formatNumber(s.version) })}
        errorContext="settings"
        onReload={() => {
          setConfirm(false);
          onReload();
        }}
        testId="settings-confirm"
        onConfirm={async ({ reason }) => {
          await api(aiRoutes.updateSettings, { params: { projectId }, body: { ...body, ...(reason ? { reason } : {}) } });
          setConfirm(false);
          toast.show('success', t('ai.settings.saved'));
          await refresh();
        }}
      />
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Autopilot policy: proposed here, approved by a DIFFERENT person, revocable at once.

function isoDateIn(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function AutopilotPanel({ s, onReload }: { s: AiSettings; onReload: () => void }) {
  const { t, formatDate, formatDateTime, formatNumber, formatList } = useI18n();
  const { projectId, me, can } = useProjectContext();
  const people = useMemberNames();
  const refresh = useAiRefresh();
  const toast = useToast();
  const p = s.autopilotPolicy;
  const [dialog, setDialog] = useState<'propose' | 'approve' | 'revoke' | null>(null);
  const [allow, setAllow] = useState<AiProposableAction[]>([]);
  const [maxPerDay, setMaxPerDay] = useState('10');
  const [expires, setExpires] = useState(isoDateIn(30));
  const isProposer = !!p?.proposedBy && p.proposedBy === me.user.id;
  const maxN = Number(maxPerDay);
  const proposeInvalid = allow.length === 0 || !Number.isInteger(maxN) || maxN < 1 || maxN > 50 || !/^\d{4}-\d{2}-\d{2}$/.test(expires);
  const done = async (msg: string) => {
    setDialog(null);
    toast.show('success', msg);
    await refresh();
  };

  let approveNote: string | null = null;
  if (p?.status === 'proposed') {
    if (!can('ai.autopilot_policy.approve')) approveNote = t('ai.autopilot.approveNeedsPermission');
    else if (isProposer) approveNote = t('ai.autopilot.selfApproval');
  }

  return (
    <Panel title={t('ai.autopilot.title')} testId="autopilot-panel" description={t('ai.autopilot.hint')}>
      <div className="space-y-3">
        {p ? (
          <Facts
            testId="autopilot-policy"
            items={[
              {
                label: t('ai.autopilot.status'),
                value: (
                  <span data-testid="autopilot-status" data-status={p.status}>
                    <StatusBadge enumName="aiModes" value={p.status} tone={p.status === 'approved' ? 'success' : p.status === 'proposed' ? 'warning' : 'neutral'} label={t(`ai.autopilot.statuses.${p.status}` as MessageKey)} />
                  </span>
                ),
              },
              { label: t('ai.autopilot.allowlist'), value: formatList(p.allowlist.map((a) => t(`ai.actions.${a}` as MessageKey))) || EM_DASH, wide: true },
              { label: t('ai.autopilot.maxPerDay'), value: formatNumber(p.maxActionsPerDay) },
              { label: t('ai.autopilot.expires'), value: formatDate(p.expiresOn) },
              { label: t('ai.autopilot.proposedBy'), value: <Person id={p.proposedBy} people={people} /> },
              { label: t('ai.autopilot.approvedBy'), value: p.approvedBy ? <span className="flex flex-wrap gap-2"><Person id={p.approvedBy} people={people} /><span className="text-xs text-muted">{formatDateTime(p.approvedAt)}</span></span> : EM_DASH },
            ]}
          />
        ) : (
          <p className="text-sm text-muted" data-testid="autopilot-none">
            {t('ai.autopilot.none')}
          </p>
        )}
        {approveNote ? (
          <p className="text-sm text-muted" data-testid="autopilot-approve-unavailable">
            {approveNote}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {can('ai.settings.manage') ? (
            <button type="button" className={btn.secondary} onClick={() => setDialog('propose')} data-testid="autopilot-propose">
              {p && p.status !== 'revoked' && p.status !== 'expired' ? t('ai.autopilot.replace') : t('ai.autopilot.propose')}
            </button>
          ) : null}
          {p?.status === 'proposed' && !approveNote ? (
            <button type="button" className={btn.primary} onClick={() => setDialog('approve')} data-testid="autopilot-approve">
              {t('ai.autopilot.approve')}
            </button>
          ) : null}
          {p && can('ai.settings.manage') && (p.status === 'proposed' || p.status === 'approved') ? (
            <button type="button" className={btn.danger} onClick={() => setDialog('revoke')} data-testid="autopilot-revoke">
              {t('ai.autopilot.revoke')}
            </button>
          ) : null}
        </div>
      </div>

      <AiCommandDialog
        open={dialog === 'propose'}
        onClose={() => setDialog(null)}
        title={t('ai.autopilot.proposeTitle')}
        confirmLabel={t('ai.autopilot.proposeConfirm')}
        consequences={[t('ai.autopilot.proposeC1'), t('ai.autopilot.proposeC2'), t('ai.autopilot.proposeC3')]}
        basedOn={t('ai.settings.boundTo', { version: formatNumber(s.version) })}
        errorContext="settings"
        onReload={onReload}
        confirmDisabled={proposeInvalid}
        testId="autopilot-propose-dialog"
        onConfirm={async ({ reason }) => {
          await api(aiRoutes.updateSettings, {
            params: { projectId },
            body: { expectedVersion: s.version, autopilotPolicy: { allowlist: allow, maxActionsPerDay: maxN, expiresOn: expires }, ...(reason ? { reason } : {}) },
          });
          await done(t('ai.autopilot.proposed'));
        }}
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">{t('ai.autopilot.allowlist')}</legend>
          {AI_AUTOPILOT_ELIGIBLE.map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="size-4" checked={allow.includes(a)} onChange={(e) => setAllow((x) => (e.target.checked ? [...x, a] : x.filter((y) => y !== a)))} data-testid={`autopilot-allow-${a}`} />
              {t(`ai.actions.${a}` as MessageKey)}
            </label>
          ))}
          <p className={hint}>{t('ai.autopilot.allowlistHint')}</p>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t('ai.autopilot.maxPerDay')} required inputMode="numeric" value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} hint={t('ai.autopilot.maxHint')} dir="ltr" />
          <TextField label={t('ai.autopilot.expires')} required type="date" value={expires} onChange={(e) => setExpires(e.target.value)} hint={t('ai.autopilot.expiresHint')} />
        </div>
      </AiCommandDialog>
      <AiCommandDialog
        open={dialog === 'approve'}
        onClose={() => setDialog(null)}
        title={t('ai.autopilot.approveTitle')}
        confirmLabel={t('ai.autopilot.approve')}
        consequences={[t('ai.autopilot.approveC1'), t('ai.autopilot.approveC2')]}
        basedOn={t('ai.settings.boundTo', { version: formatNumber(s.version) })}
        errorContext="settings"
        onReload={onReload}
        testId="autopilot-approve-dialog"
        onConfirm={async ({ reason }) => {
          await api(aiRoutes.approveAutopilot, { params: { projectId }, body: { expectedVersion: s.version, ...(reason ? { note: reason } : {}) } });
          await done(t('ai.autopilot.approved'));
        }}
      />
      <AiCommandDialog
        open={dialog === 'revoke'}
        onClose={() => setDialog(null)}
        title={t('ai.autopilot.revokeTitle')}
        confirmLabel={t('ai.autopilot.revoke')}
        danger
        reasonMode="required"
        consequences={[t('ai.autopilot.revokeC1'), t('ai.autopilot.revokeC2')]}
        basedOn={t('ai.settings.boundTo', { version: formatNumber(s.version) })}
        errorContext="settings"
        onReload={onReload}
        testId="autopilot-revoke-dialog"
        onConfirm={async ({ reason }) => {
          await api(aiRoutes.revokeAutopilot, { params: { projectId }, body: { expectedVersion: s.version, reason } });
          await done(t('ai.autopilot.revoked'));
        }}
      />
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Emergency stop (kill switch): activate with a reason; released by a DIFFERENT person.

function EmergencyStop({ settings, statusKill, loading }: { settings: AiSettings | null; statusKill: boolean | null; loading: boolean }) {
  const { t, formatDateTime, formatNumber } = useI18n();
  const { projectId, me, can } = useProjectContext();
  const people = useMemberNames();
  const refresh = useAiRefresh();
  const toast = useToast();
  const [dialog, setDialog] = useState<'activate' | 'release' | null>(null);
  const active = settings?.killSwitch ?? statusKill;
  const activator = settings?.killSwitchBy ?? null;
  const selfActivated = !!activator && activator === me.user.id;

  let body: ReactNode;
  if (loading && active === null) body = <LoadingState compact />;
  else if (active === null) body = <p className="text-sm text-muted">{t('ai.killSwitch.stateUnknown')}</p>;
  else
    body = (
      <div className="space-y-3">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <KillSwitchBadge active={active} testId="kill-switch-state" />
          {active && settings?.killSwitchAt ? (
            <span className="text-muted">
              {t('ai.killSwitch.since', { at: formatDateTime(settings.killSwitchAt) })} <Person id={activator} people={people} />
            </span>
          ) : null}
        </p>
        {active ? (
          <Callout tone="danger" icon="stop">
            <p>{t('ai.killSwitch.bannerBody')}</p>
          </Callout>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {!active && can('ai.killswitch.activate') ? (
            <button type="button" className={btn.danger} onClick={() => setDialog('activate')} data-testid="kill-switch-activate">
              {t('ai.killSwitch.activate')}
            </button>
          ) : null}
          {active && can('ai.killswitch.release') && !selfActivated ? (
            <button type="button" className={btn.primary} onClick={() => setDialog('release')} data-testid="kill-switch-release">
              {t('ai.killSwitch.release')}
            </button>
          ) : null}
        </div>
        {active && selfActivated ? (
          <p className="text-sm text-muted" data-testid="release-unavailable" data-reason="self">
            {t('ai.killSwitch.selfRelease')}
          </p>
        ) : active && !can('ai.killswitch.release') ? (
          <p className="text-sm text-muted" data-testid="release-unavailable" data-reason="permission">
            {t('ai.killSwitch.releaseNeedsPermission')}
          </p>
        ) : null}
      </div>
    );

  return (
    <Panel title={t('ai.killSwitch.title')} testId="emergency-stop" id="emergency-stop" description={t('ai.killSwitch.hint')}>
      {body}
      <AiCommandDialog
        open={dialog === 'activate'}
        onClose={() => setDialog(null)}
        title={t('ai.killSwitch.activateTitle')}
        confirmLabel={t('ai.killSwitch.activateConfirm')}
        danger
        reasonMode="required"
        consequences={[t('ai.killSwitch.activateC1'), t('ai.killSwitch.activateC2'), t('ai.killSwitch.activateC3'), t('ai.killSwitch.activateC4')]}
        testId="kill-switch-activate-dialog"
        onConfirm={async ({ reason }) => {
          const r = await api(aiRoutes.activateKillSwitch, { params: { projectId }, body: { reason } });
          setDialog(null);
          toast.show(
            'success',
            t('ai.killSwitch.activated', { jobs: formatNumber(r.cancelledJobs), approvals: formatNumber(r.invalidatedApprovals), proposals: formatNumber(r.cancelledProposals), deliveries: formatNumber(r.cancelledDeliveries) }),
          );
          await refresh();
        }}
      />
      <AiCommandDialog
        open={dialog === 'release'}
        onClose={() => setDialog(null)}
        title={t('ai.killSwitch.releaseTitle')}
        confirmLabel={t('ai.killSwitch.release')}
        reasonMode="required"
        consequences={[t('ai.killSwitch.releaseC1'), t('ai.killSwitch.releaseC2')]}
        testId="kill-switch-release-dialog"
        onConfirm={async ({ reason }) => {
          await api(aiRoutes.releaseKillSwitch, { params: { projectId }, body: { reason } });
          setDialog(null);
          toast.show('success', t('ai.killSwitch.released'));
          await refresh();
        }}
      />
      <p className={cx(hint, 'mt-3')}>{t('ai.killSwitch.sod')}</p>
    </Panel>
  );
}
