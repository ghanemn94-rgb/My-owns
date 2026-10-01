'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { configRoutes as C } from '@hub/contracts';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { ck, useAdminTemplates, type AdminTemplates } from '@/lib/config';
import { useLocalized } from '@/lib/i18n-data';

type Template = AdminTemplates['items'][number];
type Version = Template['versions'][number];

const DIFF_KEYS = [
  'addedGates',
  'removedGates',
  'changedGates',
  'addedCriteria',
  'removedCriteria',
  'addedWorkstreams',
  'removedWorkstreams',
  'changedWorkstreams',
  'addedActivities',
  'removedActivities',
  'changedActivities',
  'addedKpis',
  'removedKpis',
  'changedKpis',
  'kpiTextsArabicOnly',
  'addedPhases',
  'removedPhases',
  'changedPhases',
  'addedStatusDimensions',
  'removedStatusDimensions',
  'addedReadinessChecks',
  'removedReadinessChecks',
] as const;

/** What a version changes compared with the previous version of the same template (read-only). */
function Diff({ to, from }: { to: Version; from: Version }) {
  const { t, formatNumber } = useI18n();
  const q = useQuery({ queryKey: ck.adminDiff(to.id, from.id), queryFn: ({ signal }) => api(C.adminTemplateDiff, { params: { versionId: to.id }, query: { from: from.id }, signal }) });
  if (q.isLoading) return <LoadingState compact />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!.diff;
  const rows = DIFF_KEYS.filter((k) => d[k].length > 0);
  return (
    <div className="space-y-2 rounded-md bg-surface-muted p-3" data-testid="template-diff" data-to={to.versionNo} data-from={from.versionNo}>
      <p className="text-sm font-medium">{t('config.admin.templates.diffTitle', { from: from.versionNo, to: to.versionNo })}</p>
      {rows.length === 0 && !d.ragPolicyChanged ? <p className="text-sm text-muted">{t('config.admin.templates.noDiff')}</p> : null}
      <ul className="space-y-1 text-sm">
        {rows.map((k) => (
          <li key={k} data-testid="template-diff-row" data-key={k}>
            <span className="font-medium">{t(`config.admin.templates.diff.${k}`)}</span> <span className="tabular text-muted">({formatNumber(d[k].length)})</span>:{' '}
            <span dir="ltr" className="font-mono text-xs">
              {d[k].join(', ')}
            </span>
          </li>
        ))}
        {d.ragPolicyChanged ? <li className="font-medium">{t('config.admin.templates.diff.ragPolicyChanged')}</li> : null}
      </ul>
    </div>
  );
}

function TemplateCard({ tpl }: { tpl: Template }) {
  const { t, tStatus, formatDateTime, formatNumber } = useI18n();
  const loc = useLocalized();
  const [diffOf, setDiffOf] = useState<string | null>(null);
  return (
    <section className={cx(card, 'space-y-3 p-4')} aria-labelledby={`tpl-${tpl.templateId}`} data-testid="admin-template" data-key={tpl.key}>
      <div>
        <h3 id={`tpl-${tpl.templateId}`} className="font-semibold">
          <span dir="auto">{loc(tpl.name, tpl.nameAr)}</span> <span className="text-xs font-normal text-muted">({tStatus('templateKinds', tpl.kind)})</span>
        </h3>
        <p className="text-xs text-muted" dir="ltr">
          {tpl.key}
        </p>
      </div>
      <ul className="space-y-2">
        {tpl.versions.map((v, i) => {
          const prev = tpl.versions[i + 1];
          return (
            <li key={v.id} className="space-y-2 border-t border-line pt-2" data-testid="admin-template-version" data-version={v.versionNo}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{t('config.upgrade.version', { version: v.versionNo })}</span>
                <StatusBadge enumName="templateVersionStatuses" value={v.status} tone={v.status === 'published' ? 'success' : 'neutral'} />
                <span className="text-xs text-muted">{v.publishedAt ? t('config.admin.templates.published', { date: formatDateTime(v.publishedAt) }) : EM_DASH}</span>
                <span className="text-xs text-muted">
                  {t('config.admin.templates.counts', { gates: formatNumber(v.counts.gates), workstreams: formatNumber(v.counts.workstreams), activities: formatNumber(v.counts.activities), kpis: formatNumber(v.counts.kpis) })}
                </span>
                <span className="text-xs" data-testid="admin-template-projects" data-count={v.projects}>
                  {t('config.admin.templates.projects', { count: formatNumber(v.projects) })}
                </span>
                {prev ? (
                  <button type="button" className={btn.ghost} onClick={() => setDiffOf(diffOf === v.id ? null : v.id)} aria-expanded={diffOf === v.id} data-testid="admin-template-diff">
                    {diffOf === v.id ? t('config.admin.templates.hideDiff') : t('config.admin.templates.showDiff', { from: prev.versionNo })}
                  </button>
                ) : null}
              </div>
              {diffOf === v.id && prev ? <Diff to={v} from={prev} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Administration → Templates (REQ-ENT-009): every template version with its status, size and the projects pinned to it, and
 * what each version changes. Read-only: template versions are published from reviewed template files; a project moves to a
 * newer version only through an approved upgrade on its configuration screen.
 */
export function TemplatesTab({ allowed }: { allowed: boolean }) {
  const { t } = useI18n();
  const q = useAdminTemplates(allowed);
  if (!allowed) return <RestrictedState showHomeLink={false} />;
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.isForbidden || q.error.isHidden) ? <RestrictedState showHomeLink={false} /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-4" data-testid="admin-templates">
      <p className="text-sm text-muted">{t('config.admin.templates.hint')}</p>
      {q.data!.items.map((tpl) => (
        <TemplateCard key={tpl.templateId} tpl={tpl} />
      ))}
    </div>
  );
}
