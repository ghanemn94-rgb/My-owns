'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Bot,
  Building2,
  ChartColumn,
  ChevronDown,
  FileText,
  FolderOpen,
  Gauge,
  Handshake,
  Landmark,
  Layers,
  ListChecks,
  Network,
  ShieldAlert,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Me, ProjectSummary } from '@hub/contracts';
import { canInProject } from '@/lib/queries';
import { PROJECT_SECTIONS, sectionAppliesTo, sectionHref, type SectionKey } from '@/lib/sections';
import { useI18n } from '@/i18n/provider';
import { DemoBadge } from './DemoBadge';
import { cx } from './ui';

const ICONS: Record<SectionKey, LucideIcon> = {
  overview: Gauge,
  charter: FileText,
  committee: Landmark,
  plan: ListChecks,
  workstreams: Layers,
  raid: ShieldAlert,
  perimeter: Network,
  newco: Building2,
  readiness: ListChecks,
  finance: Wallet,
  jv: Handshake,
  documents: FolderOpen,
  ai: Bot,
  reports: ChartColumn,
  members: Users,
};

/** Project workspace navigation. Items the user has no permission for are hidden (the API still decides). */
export function ProjectNav({ me, project }: { me: Me; project: Pick<ProjectSummary, 'id' | 'code' | 'name' | 'isDemo' | 'templateKind'> }) {
  const { t } = useI18n();
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const base = `/projects/${project.id}`;

  const items = PROJECT_SECTIONS.filter((s) => sectionAppliesTo(s, project.templateKind) && canInProject(me, project.id, s.permissions));
  const isActive = (key: SectionKey) => {
    const href = sectionHref(project.id, key);
    return key === 'overview' ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav aria-label={t('nav.projectNav')} className="md:w-64 md:shrink-0" data-testid="project-nav">
      <div className="rounded-lg border border-line bg-surface p-3 md:sticky md:top-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted" dir="ltr">
              {project.code}
            </p>
            <p className="line-clamp-2 text-sm font-semibold text-ink" dir="auto">
              {project.name}
            </p>
            {project.isDemo ? <DemoBadge className="mt-1" /> : null}
          </div>
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-1 rounded-md border border-line-strong px-2 text-sm md:hidden"
            aria-expanded={open}
            aria-controls="project-nav-list"
            onClick={() => setOpen((o) => !o)}
          >
            {t('nav.sectionsToggle')}
            <ChevronDown aria-hidden="true" className={cx('size-4 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
        <ul id="project-nav-list" className={cx('mt-3 flex-col gap-0.5', open ? 'flex' : 'hidden md:flex')}>
          {items.map((s) => {
            const Icon = ICONS[s.key];
            const active = isActive(s.key);
            return (
              <li key={s.key}>
                <Link
                  href={sectionHref(project.id, s.key)}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={cx(
                    'flex min-h-10 items-center gap-2 rounded-md px-2.5 py-2 text-sm',
                    active ? 'bg-primary-soft font-semibold text-primary' : 'text-ink hover:bg-surface-muted',
                  )}
                  data-section={s.key}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 leading-snug">{t(`nav.items.${s.key}`)}</span>
                  {s.phase ? (
                    <span className="rounded bg-surface-muted px-1 text-[11px] font-medium text-muted" title={t('nav.phaseHint', { phase: s.phase })}>
                      {s.phase}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
