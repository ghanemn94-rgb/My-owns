'use client';

import Link from 'next/link';
import { CircleAlert, FileSearch, Lightbulb, ListChecks } from 'lucide-react';
import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, cx } from '@/components/ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { useLocalized } from '@/lib/i18n-data';
import { aiHref, citationHref, type AiDetection, type AiRun } from '@/lib/ai';
import { useProjectContext } from '@/lib/project-context';
import { CitationLinks, Code, SimulatedNotice, UText } from './bits';

function Block({ title, children, testId, icon }: { title: string; children: ReactNode; testId?: string; icon?: ReactNode }) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * The stored output of a run, exactly as the API returned it: the headline is composed deterministically by the server;
 * every finding carries the sources the server kept for the CURRENT reader (claims whose sources are no longer visible
 * were dropped before this response). Nothing here is computed or re-worded by the client.
 */
export function RunOutputView({ run, testId = 'run-output' }: { run: AiRun; testId?: string }) {
  const { t, formatNumber, formatDateTime } = useI18n();
  const { projectId } = useProjectContext();
  const out = run.output;
  if (!out) {
    return (
      <p className="text-sm text-muted" data-testid={testId}>
        {t('ai.answer.noOutput')}
      </p>
    );
  }
  const w = out.withheldFromProvider;
  return (
    <div className="space-y-5" data-testid={testId}>
      {out.simulated ? <SimulatedNotice /> : null}
      <p className="text-base font-medium text-ink" data-testid="answer-headline">
        <UText value={out.headline} />
      </p>

      <Block title={t('ai.answer.findings', { count: formatNumber(out.claims.length) })} testId="answer-claims" icon={<FileSearch aria-hidden="true" className="size-4 text-muted" />}>
        {out.claims.length === 0 ? (
          <p className="text-sm text-muted">{t('ai.answer.noFindings')}</p>
        ) : (
          <ol className="space-y-3">
            {out.claims.map((c, i) => (
              <li key={i} className="rounded-md border border-line p-3" data-testid="answer-claim" data-kind={c.kind}>
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <StatusBadge enumName="aiModes" value={c.kind} tone={c.kind === 'fact' ? 'info' : 'warning'} label={t(`ai.answer.kinds.${c.kind}` as MessageKey)} />
                </div>
                <p className="text-sm text-ink">
                  <UText value={c.text} />
                </p>
                <div className="mt-2">
                  <CitationLinks citations={c.citations} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Block>

      {out.missing.length ? (
        <Block title={t('ai.answer.missing')} testId="answer-missing" icon={<CircleAlert aria-hidden="true" className="size-4 text-muted" />}>
          <ul className="list-disc space-y-1 ps-5 text-sm text-ink">
            {out.missing.map((m, i) => (
              <li key={`${m.key}-${i}`}>
                <UText value={m.description} />
                {m.ownerRole ? <span className="text-muted"> — {t('ai.answer.ownerRole', { role: m.ownerRole })}</span> : null}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {out.conflicts.length ? (
        <Block title={t('ai.answer.conflicts')} testId="answer-conflicts">
          <ul className="space-y-2 text-sm">
            {out.conflicts.map((c, i) => (
              <li key={i} className="space-y-1">
                <UText value={c.description} />
                <CitationLinks citations={c.citations} />
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block title={t('ai.answer.freshness')} testId="answer-freshness">
        <p className="text-sm text-ink">
          {t('ai.answer.freshnessLine', {
            asOf: formatDateTime(out.freshness.asOf),
            oldest: formatDateTime(out.freshness.oldestSource),
            newest: formatDateTime(out.freshness.newestSource),
            stale: formatNumber(out.freshness.staleSources),
          })}
        </p>
      </Block>

      {out.warnings.length ? (
        <Block title={t('ai.answer.warnings')} testId="answer-warnings">
          <ul className="list-disc space-y-1 ps-5 text-sm text-ink">
            {out.warnings.map((x, i) => (
              <li key={i}>
                <UText value={x} />
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block title={t('ai.answer.safeguards')} testId="answer-safeguards" icon={<ListChecks aria-hidden="true" className="size-4 text-muted" />}>
        <ul className="list-disc space-y-1 ps-5 text-sm text-ink">
          <li>{t('ai.answer.withheld', { above: formatNumber(w.aboveCeiling), room: formatNumber(w.roomRestricted) })}</li>
          <li>{t('ai.answer.dropped', { count: formatNumber(out.droppedClaims) })}</li>
          <li>{t('ai.answer.refusedCount', { count: formatNumber(out.refusedToolCalls.length) })}</li>
        </ul>
        {out.refusedToolCalls.length ? (
          <ul className="space-y-1 text-sm" data-testid="answer-refused">
            {out.refusedToolCalls.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <Code>{r.name}</Code>
                <UText value={r.reason} className="text-muted" />
              </li>
            ))}
          </ul>
        ) : null}
      </Block>

      {out.preparedRequests.length ? (
        <Block title={t('ai.answer.prepared')} testId="answer-prepared" icon={<Lightbulb aria-hidden="true" className="size-4 text-muted" />}>
          <p className="text-sm text-muted">{t('ai.answer.preparedHint')}</p>
          <ul className="space-y-2">
            {out.preparedRequests.map((p, i) => (
              <li key={i} className="rounded-md border border-line p-3 text-sm">
                <p className="text-xs font-semibold text-muted">{t(`ai.actions.${p.action}` as MessageKey)}</p>
                <UText value={p.text} multiline />
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {out.proposals.length ? (
        <Block title={t('ai.answer.proposals')} testId="answer-proposals">
          <ul className="space-y-1 text-sm">
            {out.proposals.map((p, i) => (
              <li key={`${p.id}-${i}`} className="flex flex-wrap items-center gap-2">
                <Link className={btn.link} href={aiHref(projectId, `/proposals/${p.id}`)}>
                  {t(`ai.actions.${p.actionType}` as MessageKey)}
                </Link>
                <StatusBadge enumName="aiProposalStatuses" value={p.status} />
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {out.detections.length ? (
        <Block title={t('ai.answer.detections', { count: formatNumber(out.detections.length) })} testId="answer-detections">
          <DetectionList items={out.detections} limit={20} />
        </Block>
      ) : null}

      <p className="rounded-md border border-line bg-surface-muted p-3 text-xs text-muted" data-testid="answer-disclaimer">
        <UText value={out.disclaimer} />
      </p>
    </div>
  );
}

/** Compact detection list (rules-only findings) with a link to each record. */
export function DetectionList({ items, limit }: { items: readonly AiDetection[]; limit?: number }) {
  const { t, formatDate, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const localize = useLocalized(); // QA-P5-04: Arabic template title when the record has one
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <>
      <ul className="space-y-1.5">
        {shown.map((d, i) => {
          const href = citationHref(projectId, { type: d.entityType, id: d.entityId, label: d.label });
          return (
            <li key={`${d.code}-${d.entityId}-${i}`} className="flex flex-wrap items-center gap-2 text-sm" data-detection={d.code}>
              <StatusBadge enumName="aiModes" value={d.severity} tone={d.severity === 'critical' ? 'danger' : d.severity === 'warning' ? 'warning' : 'info'} label={t(`ai.detections.severities.${d.severity}` as MessageKey)} />
              <span className="text-xs font-semibold text-muted">{t(`ai.detections.codes.${d.code}` as MessageKey)}</span>
              {href ? (
                <Link className={cx(btn.link)} href={href}>
                  <span dir="auto" data-user-text={d.labelAr ? undefined : true}>
                    {localize(d.label, d.labelAr)}
                  </span>
                </Link>
              ) : (
                <span data-user-text={d.labelAr ? undefined : true}>
                  <UText value={localize(d.label, d.labelAr)} />
                </span>
              )}
              {d.dueDate ? <span className="text-xs text-muted">{t('ai.detections.due', { date: formatDate(d.dueDate) })}</span> : null}
            </li>
          );
        })}
      </ul>
      {limit && items.length > limit ? <p className="mt-2 text-xs text-muted">{t('ai.answer.moreDetections', { count: formatNumber(items.length - limit) })}</p> : null}
    </>
  );
}
