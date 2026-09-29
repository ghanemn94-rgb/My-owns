'use client';

import Link from 'next/link';
import type { ProjectSummary } from '@hub/contracts';
import { STATUS_DIMENSION_KEYS } from '@hub/domain';
import { useI18n } from '@/i18n/provider';
import { StatusBadge } from './StatusBadge';
import { card, cx } from './ui';

type Dimension = ProjectSummary['dimensions'][number];

function ordered(dims: Dimension[]): Dimension[] {
  return [...dims].sort((a, b) => STATUS_DIMENSION_KEYS.indexOf(a.key) - STATUS_DIMENSION_KEYS.indexOf(b.key));
}

/** The four independent status dimensions as a compact list (never merged into one "overall" status). */
export function DimensionList({ dimensions, className }: { dimensions: Dimension[]; className?: string }) {
  const { t, tStatus } = useI18n();
  if (dimensions.length === 0) return <p className={cx('text-sm text-muted', className)}>{t('portfolio.noDimensions')}</p>;
  return (
    <dl className={cx('grid gap-1.5', className)} data-testid="dimension-list">
      {ordered(dimensions).map((d) => (
        <div key={d.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1" data-dimension={d.key}>
          <dt className="text-sm text-muted">{tStatus('statusDimensionKeys', d.key)}</dt>
          <dd>
            <StatusBadge enumName="dimensionStates" value={d.state} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Cockpit cards: one card per dimension, each linking to the register that drives it. */
export function DimensionCards({ dimensions, hrefFor }: { dimensions: Dimension[]; hrefFor: (key: Dimension['key']) => string | null }) {
  const { t, tStatus } = useI18n();
  if (dimensions.length === 0) return <p className="text-sm text-muted">{t('portfolio.noDimensions')}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="dimension-cards">
      {ordered(dimensions).map((d) => {
        const href = hrefFor(d.key);
        return (
          <li key={d.key} className={cx(card, 'flex flex-col gap-2 p-4')} data-dimension={d.key}>
            <h3 className="text-sm font-semibold text-ink">{tStatus('statusDimensionKeys', d.key)}</h3>
            <StatusBadge enumName="dimensionStates" value={d.state} size="md" />
            {d.explanation ? (
              <p className="text-xs text-muted" dir="auto">
                <span className="sr-only">{t('project.cockpit.explanation')}: </span>
                {d.explanation}
              </p>
            ) : null}
            {href ? (
              <Link href={href} className="mt-auto text-xs font-medium text-primary hover:underline">
                {t('project.cockpit.openRegister')}
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
