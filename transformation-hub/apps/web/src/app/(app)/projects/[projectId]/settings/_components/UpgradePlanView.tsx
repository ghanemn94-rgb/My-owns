'use client';

import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/StatusBadge';
import { useI18n } from '@/i18n/provider';
import type { UpgradePlan } from '@/lib/config';
import { useLocalized } from '@/lib/i18n-data';

function Group({ title, count, testId, children }: { title: string; count: number; testId: string; children: ReactNode }) {
  const { formatNumber } = useI18n();
  return (
    <div data-testid={testId} data-count={count}>
      <h5 className="text-sm font-semibold">
        {title} <span className="tabular font-normal text-muted">({formatNumber(count)})</span>
      </h5>
      {count > 0 ? <ul className="mt-1 space-y-0.5 text-sm">{children}</ul> : null}
    </div>
  );
}

const Key = ({ k }: { k: string }) => (
  <span dir="ltr" className="font-mono text-xs">
    {k}
  </span>
);

/**
 * The plan of a template upgrade (AT-26), in three parts: what the approval CREATES in the project (new elements of the new
 * version, as proposals), what is KEPT as it is (removed / changed in the template — never changed retroactively; any
 * change goes through the owning module's commands) and what changes with the pinned version (texts, phases, the template
 * default RAG thresholds when the project has no approved version of its own).
 */
export function UpgradePlanView({ plan }: { plan: UpgradePlan }) {
  const { t, tStatus, formatNumber } = useI18n();
  const loc = useLocalized();
  const add = plan.add;
  const addCount = add.workstreams.length + add.gates.length + add.activities.length + add.kpis.length;
  const rag = (v: UpgradePlan['ragDefaults']['from']) => t('config.rag.valuesShort', { green: formatNumber(v.greenMaxSlipDays), amber: formatNumber(v.amberMaxSlipDays), stale: formatNumber(v.staleAfterDays) });
  return (
    <div className="space-y-4" data-testid="upgrade-plan" data-version-only={plan.versionOnly ? 'true' : 'false'}>
      <p className="text-sm text-ink">{t('config.upgrade.plan.summary', { from: formatNumber(plan.fromVersionNo), to: formatNumber(plan.toVersionNo) })}</p>
      {plan.versionOnly ? <p className="text-sm text-muted">{t('config.upgrade.plan.versionOnly')}</p> : null}
      <section className="space-y-2">
        <h4 className="font-semibold">{t('config.upgrade.plan.addTitle')}</h4>
        <p className="text-xs text-muted">{t('config.upgrade.plan.addHint')}</p>
        {addCount === 0 ? <p className="text-sm text-muted">{t('config.upgrade.plan.nothingAdded')}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Group title={t('config.upgrade.plan.gates')} count={add.gates.length} testId="plan-add-gates">
            {add.gates.map((g) => (
              <li key={g.key}>
                <Key k={g.key} /> — <span dir="auto">{loc(g.name.en, g.name.ar)}</span> <span className="text-xs text-muted">{t('config.upgrade.plan.criteria', { count: g.criteria })}</span>
              </li>
            ))}
          </Group>
          <Group title={t('config.upgrade.plan.workstreams')} count={add.workstreams.length} testId="plan-add-workstreams">
            {add.workstreams.map((w) => (
              <li key={w.key}>
                <Key k={w.key} /> — <span dir="auto">{loc(w.name.en, w.name.ar)}</span>
              </li>
            ))}
          </Group>
          <Group title={t('config.upgrade.plan.activities')} count={add.activities.length} testId="plan-add-activities">
            {add.activities.map((a) => (
              <li key={a.id}>
                <Key k={a.id} /> — <span dir="auto">{loc(a.title.en, a.title.ar)}</span>
              </li>
            ))}
          </Group>
          <Group title={t('config.upgrade.plan.kpis')} count={add.kpis.length} testId="plan-add-kpis">
            {add.kpis.map((k) => (
              <li key={k.key}>
                <Key k={k.key} /> — <span dir="auto">{loc(k.name.en, k.name.ar)}</span>
              </li>
            ))}
          </Group>
        </div>
      </section>
      <section className="space-y-2">
        <h4 className="font-semibold">{t('config.upgrade.plan.keepTitle')}</h4>
        <p className="text-xs text-muted">{t('config.upgrade.plan.keepHint')}</p>
        {plan.keep.length === 0 ? (
          <p className="text-sm text-muted">{t('config.upgrade.plan.nothingKept')}</p>
        ) : (
          <ul className="space-y-1 text-sm" data-testid="plan-keep">
            {plan.keep.map((k) => (
              <li key={`${k.kind}:${k.key}:${k.reason}`} className="flex flex-wrap items-center gap-2">
                <StatusBadge enumName="upgradeKeepKinds" value={k.kind} tone="neutral" />
                <Key k={k.key} />
                <span className="text-muted">{tStatus('upgradeKeepReasons', k.reason)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h4 className="font-semibold">{t('config.upgrade.plan.textsTitle')}</h4>
        <ul className="list-disc space-y-1 ps-5 text-sm" data-testid="plan-texts">
          {plan.texts.kpisArabic.length ? <li data-testid="plan-kpi-arabic">{t('config.upgrade.plan.kpisArabic', { count: plan.texts.kpisArabic.length })}</li> : null}
          {plan.texts.phasesAdded.length + plan.texts.phasesRemoved.length + plan.texts.phasesChanged.length ? (
            <li>{t('config.upgrade.plan.phases', { count: plan.texts.phasesAdded.length + plan.texts.phasesRemoved.length + plan.texts.phasesChanged.length })}</li>
          ) : null}
          {plan.statusDimensionsAdded.length ? <li>{t('config.upgrade.plan.dimensions', { count: plan.statusDimensionsAdded.length })}</li> : null}
          {plan.readinessChecksAvailable.length ? <li>{t('config.upgrade.plan.readiness', { count: plan.readinessChecksAvailable.length })}</li> : null}
          <li data-testid="plan-rag">
            {plan.ragDefaults.changed
              ? plan.ragDefaults.appliesToProject
                ? t('config.upgrade.plan.ragChangedApplies', { from: rag(plan.ragDefaults.from), to: rag(plan.ragDefaults.to) })
                : t('config.upgrade.plan.ragChangedNotApplied', { from: rag(plan.ragDefaults.from), to: rag(plan.ragDefaults.to) })
              : t('config.upgrade.plan.ragUnchanged', { values: rag(plan.ragDefaults.to) })}
          </li>
        </ul>
      </section>
    </div>
  );
}
