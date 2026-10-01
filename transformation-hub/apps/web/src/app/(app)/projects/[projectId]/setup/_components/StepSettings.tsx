'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { configRoutes as C } from '@hub/contracts';
import { CLASSIFICATIONS, RETENTION_YEARS_BOUNDS, type Classification } from '@hub/domain';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { ErrorState } from '@/components/ErrorState';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { useRefreshConfig, useSetup, type SetupState } from '@/lib/config';
import { useProjectContext } from '@/lib/project-context';

function Block({ id, title, hint, children, testId }: { id: string; title: string; hint?: string; children: ReactNode; testId?: string }) {
  return (
    <section aria-labelledby={id} className={cx(card, 'space-y-3 p-4')} data-testid={testId}>
      <div>
        <h3 id={id} className="font-semibold">
          {title}
        </h3>
        {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

const rank = (c: Classification) => CLASSIFICATIONS.indexOf(c);

/** Confidentiality (project classification) and retention: the PM sets them while the project is in setup. */
function PoliciesForm({ s }: { s: SetupState }) {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useRefreshConfig(projectId);
  const toast = useToast();
  const [classification, setClassification] = useState<Classification>(s.policies.classification);
  const [tbd, setTbd] = useState(s.policies.retentionYears === null);
  const [years, setYears] = useState(s.policies.retentionYears === null ? '' : String(s.policies.retentionYears));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const editable = s.status === 'setup' && can('config.project_settings.manage');
  const lowered = rank(classification) < rank(s.policies.classification);
  const y = /^\d{1,3}$/.test(years.trim()) ? Number(years.trim()) : null;
  const yearsError = !tbd && (y === null || y < RETENTION_YEARS_BOUNDS.min || y > RETENTION_YEARS_BOUNDS.max) ? t('config.setup.settings.retentionRange', { min: RETENTION_YEARS_BOUNDS.min, max: RETENTION_YEARS_BOUNDS.max }) : null;
  const reasonMissing = lowered && reason.trim().length === 0;
  const options = CLASSIFICATIONS.filter((c) => rank(c) <= rank(me.user.clearance as Classification));
  const save = async () => {
    if (yearsError || reasonMissing) return;
    setBusy(true);
    setError(null);
    try {
      await api(C.setupPolicies, { params: { projectId }, body: { expectedVersion: s.version, classification, retentionYears: tbd ? null : y, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
      await refresh();
      setReason('');
      toast.show('success', t('config.setup.settings.saved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Block id="wizard-policies-title" title={t('config.setup.settings.policiesTitle')} hint={t('config.setup.settings.policiesHint')} testId="wizard-policies">
      <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="wizard-policies-state" data-reviewed={s.policies.reviewedAt ? 'true' : 'false'}>
        {s.policies.reviewedAt ? (
          <>
            <StatusBadge enumName="checklistStates" value="done" tone="success" />
            {t('config.setup.settings.reviewed', { name: s.policies.reviewedByName ?? EM_DASH, date: formatDateTime(s.policies.reviewedAt) })}
          </>
        ) : (
          <>
            <StatusBadge enumName="checklistStates" value="open" tone="warning" />
            {t('config.setup.settings.notReviewed')}
          </>
        )}
      </p>
      {editable ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label={t('config.setup.settings.classification')} hint={t('config.setup.settings.classificationHint')} value={classification} onChange={(e) => setClassification(e.target.value as Classification)} required data-testid="wizard-classification">
            {options.map((c) => (
              <option key={c} value={c}>
                {tStatus('classifications', c)}
              </option>
            ))}
          </SelectField>
          <div className="space-y-2">
            <TextField
              label={t('config.setup.settings.retentionYears')}
              hint={t('config.setup.settings.retentionHint')}
              inputMode="numeric"
              value={years}
              disabled={tbd}
              onChange={(e) => setYears(e.target.value)}
              error={yearsError}
              required={!tbd}
              data-testid="wizard-retention"
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={tbd} onChange={(e) => setTbd(e.target.checked)} data-testid="wizard-retention-tbd" />
              {t('config.setup.settings.retentionTbd')}
            </label>
          </div>
          {lowered ? (
            <TextAreaField
              className="sm:col-span-2"
              label={t('config.setup.settings.loweringReason')}
              hint={t('config.setup.settings.loweringHint')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              error={reasonMissing ? t('config.setup.settings.reasonRequired') : null}
              data-testid="wizard-classification-reason"
            />
          ) : null}
          <div className="sm:col-span-2 space-y-2">
            {error ? <ApiErrorNotice error={error} /> : null}
            <button type="button" className={btn.primary} onClick={() => void save()} disabled={busy || !!yearsError || reasonMissing} data-testid="wizard-policies-save">
              {t('config.setup.settings.save')}
            </button>
          </div>
        </div>
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">{t('config.setup.settings.classification')}</dt>
            <dd>{tStatus('classifications', s.policies.classification)}</dd>
          </div>
          <div>
            <dt className="text-muted">{t('config.setup.settings.retentionYears')}</dt>
            <dd>{s.policies.retentionYears === null ? t('config.setup.settings.retentionTbd') : t('config.setup.settings.years', { years: s.policies.retentionYears })}</dd>
          </div>
          <dd className="text-xs text-muted sm:col-span-2">{s.status === 'setup' ? t('config.setup.settings.readOnly') : t('config.setup.settings.afterLaunch')}</dd>
        </dl>
      )}
      <p className="text-xs text-muted">{t('config.setup.settings.retentionEnforcement')}</p>
    </Block>
  );
}

/**
 * Setup wizard step 7 (REQ-SET-015): confidentiality and retention are set here (in setup); the AI mode is shown (Off by
 * default — changed only in the AI PM Center by an authorized role) and every integration with its honest status (Not
 * configured until a real connectivity check; integrations are managed in Administration).
 */
export function StepSettings() {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const q = useSetup(projectId);
  let body: ReactNode;
  if (q.isLoading) body = <LoadingState />;
  else if (q.error) body = isApiError(q.error) && (q.error.isHidden || q.error.isForbidden) ? <RestrictedState showHomeLink={false} /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  else {
    const s = q.data!;
    body = (
      <>
        <PoliciesForm key={`${s.version}`} s={s} />
        <Block id="wizard-ai-title" title={t('config.setup.settings.aiTitle')} hint={t('config.setup.settings.aiHint')} testId="wizard-ai">
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="wizard-ai-mode" data-mode={s.ai.mode}>
            <StatusBadge enumName="aiModes" value={s.ai.mode} tone={s.ai.mode === 'off' ? 'neutral' : 'info'} />
            {s.ai.isDefault ? <span className="text-muted">{t('config.setup.settings.aiDefault')}</span> : null}
            {s.ai.killSwitch ? <StatusBadge enumName="checklistStates" value="open" label={t('config.setup.settings.killSwitch')} tone="danger" /> : null}
          </p>
          {can('ai.settings.manage') ? (
            <Link href={`/projects/${projectId}/ai/settings`} className={cx(btn.link, 'text-sm')} data-testid="wizard-ai-settings">
              {t('config.setup.settings.aiOpen')}
            </Link>
          ) : (
            <p className="text-xs text-muted">{t('config.setup.settings.aiWho')}</p>
          )}
        </Block>
        <Block id="wizard-integrations-title" title={t('config.setup.settings.integrationsTitle')} hint={t('config.setup.settings.integrationsHint')} testId="wizard-integrations">
          {s.integrations.length === 0 ? (
            <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="wizard-integrations-none">
              <StatusBadge enumName="integrationStatuses" value="not_configured" tone="neutral" />
              {t('config.setup.settings.integrationsNone')}
            </p>
          ) : (
            <ul className="space-y-1.5" data-testid="wizard-integrations-list">
              {s.integrations.map((i) => (
                <li key={`${i.kind}:${i.name}`} className="flex flex-wrap items-center gap-2 text-sm" data-status={i.status}>
                  <span className="font-medium">{tStatus('integrationKinds', i.kind)}</span>
                  <span dir="auto" data-user-text className="text-muted">
                    {i.name}
                  </span>
                  <StatusBadge enumName="integrationStatuses" value={i.status} tone={i.status === 'verified' ? 'success' : i.status === 'failed' ? 'danger' : 'neutral'} />
                  {!i.enabled ? <span className="text-xs text-muted">{t('config.setup.settings.disabled')}</span> : null}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">{t('config.setup.settings.integrationsWho')}</p>
        </Block>
      </>
    );
  }
  return (
    <div className="space-y-4" data-testid="wizard-step-settings">
      <div>
        <h2 className="text-lg font-semibold">{t('config.setup.settings.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('config.setup.settings.hint')}</p>
      </div>
      {body}
    </div>
  );
}
