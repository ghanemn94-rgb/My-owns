'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { DoorOpen } from 'lucide-react';
import { jvRoutes } from '@hub/contracts';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Main } from '@/components/Main';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { btn, card, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { counterpartyProjects, partnerAccessHref, xk } from '@/lib/jv';
import { useMe } from '@/lib/queries';

function ProjectRooms({ projectId, index }: { projectId: string; index: number }) {
  const { t } = useI18n();
  const rooms = useQuery({ queryKey: xk.rooms(projectId), queryFn: ({ signal }) => api(jvRoutes.listExternalRooms, { params: { projectId }, signal }) });
  if (rooms.isLoading) return <LoadingState compact />;
  if (rooms.error) return <ErrorState error={rooms.error} onRetry={() => rooms.refetch()} />;
  const items = rooms.data?.items ?? [];
  return (
    <section className={cx(card, 'p-4')} aria-labelledby={`workspace-${index}`} data-testid="partner-workspace">
      <h2 id={`workspace-${index}`} className="text-lg font-semibold text-ink">
        {t('jv.external.workspace', { n: index + 1 })}
      </h2>
      {items.length === 0 ? (
        <EmptyState title={t('jv.external.noRooms')} hint={t('jv.external.noRoomsHint')} />
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((r) => (
            <li key={r.id}>
              <Link className={cx(btn.secondary, 'justify-start')} href={partnerAccessHref(projectId, r.id)} data-testid="external-room-link">
                <DoorOpen aria-hidden="true" className="size-4" />
                <span dir="auto">{r.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Counterparty view (external partner accounts): only the rooms the account is granted, through the partner-access
 * projection. No internal record, directory, other room or AI feature is reachable from here (access-matrix §2.8).
 */
export default function PartnerAccessPage() {
  const { t } = useI18n();
  const me = useMe();
  if (me.isLoading) return <Main><LoadingState /></Main>;
  const projects = counterpartyProjects(me.data);
  if (projects.length === 0) {
    return (
      <Main>
        <RestrictedState />
      </Main>
    );
  }
  return (
    <Main>
      <PageHeader title={t('jv.external.title')} description={t('jv.external.subtitle')} />
      <div className="space-y-4" data-testid="partner-access">
        <p role="note" className="rounded-md border border-info/30 bg-info-soft p-3 text-sm text-ink">
          {t('jv.external.onlyDisclosed')}
        </p>
        {projects.map((p, i) => (
          <ProjectRooms key={p.projectId} projectId={p.projectId} index={i} />
        ))}
      </div>
    </Main>
  );
}
