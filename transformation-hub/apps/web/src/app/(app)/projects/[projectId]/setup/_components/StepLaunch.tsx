'use client';

import { Rocket } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { configRoutes as C } from '@hub/contracts';
import type { OnboardingWarning } from '@hub/domain';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DataTable } from '@/components/DataTable';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { useRefreshConfig, useSetup, type SetupState } from '@/lib/config';
import { useProjectContext } from '@/lib/project-context';

type Item = SetupState['checklist']['items'][number];
const TONE: Record<Item['state'], 'success' | 'danger' | 'neutral'> = { done: 'success', open: 'danger', not_applicable: 'neutral' };

function Launched({ s }: { s: SetupState }) {
  const { t, tStatus, formatDateTime, formatList } = useI18n();
  const l = s.launch!;
  return (
    <section className={cx(card, 'space-y-2 border-success/40 p-4')} data-testid="wizard-launched" aria-labelledby="wizard-launched-title">
      <h3 id="wizard-launched-title" className="flex flex-wrap items-center gap-2 font-semibold">
        {t('config.setup.launch.launchedTitle')}
        <StatusBadge enumName="projectStatuses" value={s.status} tone="success" />
      </h3>
      <p className="text-sm">{t('config.setup.launch.launchedBy', { name: l.byName ?? EM_DASH, date: formatDateTime(l.at) })}</p>
      <p className="text-sm">
        {l.acknowledgedGaps.length ? t('config.setup.launch.acknowledged', { gaps: formatList(l.acknowledgedGaps.map((g) => tStatus('onboardingWarnings', g))) }) : t('config.setup.launch.noGapsAtLaunch')}
      </p>
      {l.note ? (
        <p className="text-sm">
          <span className="text-muted">{t('config.setup.launch.note')}: </span>
          <span dir="auto" data-user-text>
            {l.note}
          </span>
        </p>
      ) : null}
    </section>
  );
}

/**
 * Setup wizard step 8 (REQ-SET-016) and the onboarding approvals of a real project (REQ-SET-007): the checklist of required
 * approvals — each given through its own module's command by the roles shown (never a named person) — the explicit gap
 * list, and the launch of monitoring (setup → active), refused while a required item is open; remaining gaps must be
 * acknowledged and are recorded with the launch.
 */
export function StepLaunch() {
  const { t, tStatus, formatDateTime, formatList } = useI18n();
  const { projectId, can } = useProjectContext();
  const q = useSetup(projectId);
  const refresh = useRefreshConfig(projectId);
  const toast = useToast();
  const [ack, setAck] = useState<OnboardingWarning[]>([]);
  const [open, setOpen] = useState(false);
  let body: ReactNode;
  if (q.isLoading) body = <LoadingState />;
  else if (q.error) body = isApiError(q.error) && (q.error.isHidden || q.error.isForbidden) ? <RestrictedState showHomeLink={false} /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  else {
    const s = q.data!;
    const c = s.checklist;
    const canLaunch = s.status === 'setup' && can('config.project_settings.manage');
    const allAck = c.warnings.every((w) => ack.includes(w));
    body = (
      <>
        {s.launch ? <Launched s={s} /> : null}
        <section className={cx(card, 'space-y-3 p-4')} aria-labelledby="wizard-gaps-title" data-testid="wizard-gap-list" data-blocking={c.blockingGaps.join(',')} data-warnings={c.warnings.join(',')}>
          <h3 id="wizard-gaps-title" className="font-semibold">
            {t('config.setup.launch.gapsTitle')}
          </h3>
          {c.blockingGaps.length === 0 && c.warnings.length === 0 ? <p className="text-sm text-success">{t('config.setup.launch.noGaps')}</p> : null}
          {c.blockingGaps.length ? (
            <div>
              <p className="text-sm font-medium text-danger">{t('config.setup.launch.blocking', { count: c.blockingGaps.length })}</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {c.blockingGaps.map((g) => (
                  <li key={g}>
                    <StatusBadge enumName="onboardingItems" value={g} tone="danger" />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {c.warnings.length ? (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-warning">{t('config.setup.launch.warnings')}</legend>
              {c.warnings.map((w) => (
                <label key={w} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!canLaunch}
                    checked={ack.includes(w)}
                    onChange={(e) => setAck((xs) => (e.target.checked ? [...xs, w] : xs.filter((x) => x !== w)))}
                    data-testid="wizard-ack"
                    data-warning={w}
                  />
                  <span>
                    <span className="font-medium">{tStatus('onboardingWarnings', w)}</span> — {t(`config.setup.launch.warningHint.${w}`)}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {canLaunch ? (
            <div className="space-y-1">
              <button type="button" className={btn.primary} onClick={() => setOpen(true)} disabled={c.blockingGaps.length > 0 || !allAck} data-testid="wizard-launch">
                <Rocket aria-hidden="true" className="size-4" />
                {t('config.setup.launch.launch')}
              </button>
              <p className="text-xs text-muted">{c.blockingGaps.length ? t('config.setup.launch.blockedHint') : !allAck ? t('config.setup.launch.ackHint') : t('config.setup.launch.readyHint')}</p>
            </div>
          ) : s.status === 'setup' ? (
            <p className="text-xs text-muted">{t('config.setup.launch.whoLaunches')}</p>
          ) : null}
        </section>
        <section className="space-y-2" aria-labelledby="wizard-checklist-title">
          <h3 id="wizard-checklist-title" className="font-semibold">
            {t('config.setup.launch.checklistTitle')}
          </h3>
          <p className="text-xs text-muted">{t('config.setup.launch.checklistHint')}</p>
          <DataTable
            caption={t('config.setup.launch.checklistTitle')}
            rows={c.items}
            rowKey={(i) => i.key}
            emptyTitle={EM_DASH}
            testId="wizard-checklist"
            columns={[
              { key: 'item', header: t('config.setup.launch.columns.item'), isRowHeader: true, cell: (i) => <span data-testid="wizard-checklist-item" data-key={i.key} data-state={i.state}>{tStatus('onboardingItems', i.key)}</span> },
              { key: 'step', header: t('config.setup.launch.columns.step'), cell: (i) => t(`project.setupWizard.steps.${i.step}`) },
              { key: 'state', header: t('config.setup.launch.columns.state'), cell: (i) => <StatusBadge enumName="checklistStates" value={i.state} tone={TONE[i.state]} /> },
              { key: 'roles', header: t('config.setup.launch.columns.roles'), cell: (i) => <span className="text-xs">{formatList(i.byRoles.map((r) => tStatus('roleKeys', r)))}</span> },
              {
                key: 'evidence',
                header: t('config.setup.launch.columns.evidence'),
                cell: (i) => (i.evidence ? <span className="text-xs">{t('config.setup.launch.evidence', { name: i.evidence.byName ?? EM_DASH, date: formatDateTime(i.evidence.at) })}</span> : EM_DASH),
              },
            ]}
          />
        </section>
        <ConfirmCommandDialog
          open={open}
          onClose={() => setOpen(false)}
          title={t('config.setup.launch.launch')}
          confirmLabel={t('config.setup.launch.launch')}
          noteMode="optional"
          expectedVersion={s.version}
          consequences={[
            t('config.setup.launch.effectActive'),
            ack.length ? t('config.setup.launch.effectGaps', { gaps: formatList(ack.map((g) => tStatus('onboardingWarnings', g))) }) : t('config.setup.launch.effectNoGaps'),
            t('common.command.audited'),
          ]}
          onConfirm={async ({ note }) => {
            await api(C.launch, { params: { projectId }, body: { expectedVersion: s.version, acknowledgedGaps: ack, ...(note ? { note } : {}) } });
            await refresh();
            toast.show('success', t('config.setup.launch.launched'));
            setOpen(false);
          }}
        />
      </>
    );
  }
  return (
    <div className="space-y-4" data-testid="wizard-step-launch">
      <div>
        <h2 className="text-lg font-semibold">{t('config.setup.launch.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('config.setup.launch.hint')}</p>
      </div>
      {body}
    </div>
  );
}
