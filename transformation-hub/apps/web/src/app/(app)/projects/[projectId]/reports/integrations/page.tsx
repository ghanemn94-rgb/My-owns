'use client';

import { ErrorState } from '@/components/ErrorState';
import { IntegrationList } from '@/components/integrations/IntegrationList';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { useI18n } from '@/i18n/provider';
import { useProjectIntegrations } from '@/lib/integrations';
import { useProjectContext } from '@/lib/project-context';
import { Callout } from '../_components/rp';

/**
 * Integrations (screen 16b, integrations part; REQ-UX-020, REQ-INT-013/014): every connector with its honest status and
 * the manual alternative to use meanwhile. Configuration and checks are organisation administration (platform
 * administrators); nothing is sent outside from this hub while no connector is verified and authorised.
 */
export default function ProjectIntegrationsPage() {
  const { t } = useI18n();
  const { projectId, can } = useProjectContext();
  const allowed = can('integrations.connection.read');
  const q = useProjectIntegrations(projectId, allowed);
  if (!allowed) return <RestrictedState showHomeLink={false} />;
  return (
    <>
      <PageHeader title={t('integrations.title')} description={t('integrations.subtitle')} />
      <div className="mb-4">
        <Callout testId="integrations-honesty">{t('integrations.honesty')}</Callout>
      </div>
      {q.isLoading ? <LoadingState /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <IntegrationList items={q.data.items} />}
    </>
  );
}
