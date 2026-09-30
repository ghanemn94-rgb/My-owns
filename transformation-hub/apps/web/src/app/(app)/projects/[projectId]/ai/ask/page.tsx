'use client';

import Link from 'next/link';
import { useId, useRef, useState, type FormEvent } from 'react';
import { aiRoutes } from '@hub/contracts';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, cx, hint, input, label as labelCls } from '@/components/ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { aiHref, useAiRefresh, useAiSettings, useAiStatus, type AiRun } from '@/lib/ai';
import { useProjectContext } from '@/lib/project-context';
import { RunOutputView } from '../_components/answer';
import { AiErrorNotice, AuthorityNotice, Callout, Code, ModeBadge, Panel, ProviderStatusBadge, SimulatedBadge } from '../_components/bits';
import { TabGuard } from '../_components/nav';

const SUGGESTIONS = ['independence', 'overdue', 'committee', 'closing'] as const;

/**
 * Ask the AI project manager (spec §12.2). The answer comes from `POST …/ai/ask`: retrieval runs as the asking user with
 * the ACL applied inside SQL, and only the sources the server returned are shown. When the mode is Off or the emergency
 * stop is active, asking is unavailable and the reason is stated (for callers who may read the status; everyone else
 * gets the server's refusal translated).
 */
export default function AiAskPage() {
  return (
    <TabGuard tab="ask">
      <AskScreen />
    </TabGuard>
  );
}

function AskScreen() {
  const { t, locale } = useI18n();
  const { projectId, can } = useProjectContext();
  const status = useAiStatus();
  const settings = useAiSettings(!can('ai.run.read'));
  const refresh = useAiRefresh();
  const questionId = useId();
  const [question, setQuestion] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [run, setRun] = useState<AiRun | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const mode = status.data?.mode ?? settings.data?.mode ?? null;
  const killSwitch = status.data?.killSwitch ?? settings.data?.killSwitch ?? null;
  const providerStatus = status.data?.providerStatus ?? settings.data?.providerStatus ?? null;
  const unusable = providerStatus !== null && ['not_configured', 'egress_not_approved', 'disabled_by_config'].includes(providerStatus);
  const blocked: 'off' | 'kill_switch' | 'provider' | null = mode === 'off' ? 'off' : killSwitch ? 'kill_switch' : unusable ? 'provider' : null;
  const missing = question.trim().length === 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (missing || blocked) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api(aiRoutes.ask, { params: { projectId }, body: { question: question.trim(), locale, async: false } });
      setRun(r);
      await refresh();
      requestAnimationFrame(() => resultRef.current?.focus());
    } catch (err) {
      setError(err);
      setRun(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('ai.ask.title')} description={t('ai.ask.subtitle')} />
      <div className="space-y-6" data-testid="ai-ask">
        <AuthorityNotice />
        {mode ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink" data-testid="ask-context">
            <span className="text-muted">{t('ai.overview.mode')}</span>
            <ModeBadge mode={mode} testId="mode-badge" />
            {providerStatus ? (
              <>
                <span className="text-muted">{t('ai.overview.provider')}</span>
                <ProviderStatusBadge status={providerStatus} testId="provider-status" />
              </>
            ) : null}
          </p>
        ) : null}
        {blocked ? (
          <Callout tone={blocked === 'kill_switch' ? 'danger' : 'warning'} icon={blocked === 'kill_switch' ? 'stop' : 'alert'} testId="ask-unavailable">
            <p className="font-semibold" data-reason={blocked}>
              {t('ai.ask.unavailableTitle')}
            </p>
            <p>{t(`ai.ask.unavailable.${blocked}` as MessageKey)}</p>
            {blocked === 'off' && can('ai.settings.manage') ? (
              <p>
                <Link className={btn.link} href={aiHref(projectId, '/settings')}>
                  {t('ai.ask.enableLink')}
                </Link>
              </p>
            ) : null}
            <p className="text-xs text-muted">{t('ai.ask.fallback')}</p>
          </Callout>
        ) : null}

        <Panel title={t('ai.ask.formTitle')} testId="ask-form-panel">
          <form onSubmit={submit} className="space-y-3" noValidate>
            <div>
              <label htmlFor={questionId} className={labelCls}>
                {t('ai.ask.question')}
                <span className="text-danger" aria-hidden="true">
                  {' '}
                  *
                </span>
              </label>
              <textarea
                id={questionId}
                dir="auto"
                rows={3}
                className={cx(input, 'mt-1')}
                value={question}
                maxLength={2000}
                onChange={(e) => setQuestion(e.target.value)}
                aria-required="true"
                aria-invalid={touched && missing}
                aria-describedby={`${questionId}-hint`}
                disabled={!!blocked}
                data-testid="ask-question"
              />
              <p id={`${questionId}-hint`} className={hint}>
                {t('ai.ask.questionHint')}
              </p>
              {touched && missing && !blocked ? <p className="mt-1 text-xs font-medium text-danger">{t('common.validation.required')}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('ai.ask.suggestions')}>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className={cx(btn.ghost, 'min-h-9 px-2.5 py-1 text-xs')} onClick={() => setQuestion(t(`ai.ask.suggestion.${s}`))} disabled={!!blocked}>
                  {t(`ai.ask.suggestion.${s}`)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={btn.primary} disabled={busy || !!blocked} aria-busy={busy} data-testid="ask-submit">
                {busy ? t('ai.ask.asking') : t('ai.ask.submit')}
              </button>
              <span className="text-xs text-muted">{t('ai.ask.privacy')}</span>
            </div>
          </form>
          <div aria-live="polite" className="sr-only">
            {busy ? t('ai.ask.asking') : run ? t('ai.ask.answered') : ''}
          </div>
          <AiErrorNotice error={error} className="mt-3" testId="ask-error" />
        </Panel>

        {run ? (
          <div ref={resultRef} tabIndex={-1} className="focus:outline-none" data-testid="ask-result">
            <Panel
              title={t('ai.ask.answerTitle')}
              actions={
                <Link className={btn.secondary} href={aiHref(projectId, `/runs/${run.id}`)} data-testid="answer-run-link">
                  {t('ai.ask.openRun')}
                </Link>
              }
            >
              <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                {run.simulated ? <SimulatedBadge /> : null}
                <StatusBadge enumName="aiRunStatuses" value={run.status} />
                <span className="text-muted">{t('ai.common.runId')}</span>
                <Code testId="answer-run-id">{run.id}</Code>
              </div>
              <RunOutputView run={run} testId="answer" />
            </Panel>
          </div>
        ) : null}
      </div>
    </>
  );
}
