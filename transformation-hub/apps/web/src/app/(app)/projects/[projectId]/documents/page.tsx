'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { FileStack, Link2, Library } from 'lucide-react';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SectionGuard } from '@/components/SectionGuard';
import { useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { Tabs } from './_components/bits';
import { DocumentsTab } from './_components/DocumentsTab';
import { EvidenceTab } from './_components/EvidenceTab';
import { SourcesTab } from './_components/SourcesTab';

type TabKey = 'documents' | 'evidence' | 'sources';
const TABS: TabKey[] = ['documents', 'evidence', 'sources'];

/** Screen 13 — Document & Evidence Center (spec §10). */
function DocumentCenter() {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('tab') as TabKey | null;
  const tab: TabKey = raw && TABS.includes(raw) ? raw : 'documents';

  return (
    <>
      <PageHeader eyebrow={<span dir="ltr">{project.code}</span>} title={t('documents.title')} description={t('documents.subtitle')} />
      <Tabs
        label={t('documents.title')}
        value={tab}
        onChange={(k) => router.replace(k === 'documents' ? pathname : `${pathname}?tab=${k}`)}
        tabs={[
          { key: 'documents', label: t('documents.tabs.documents'), icon: <FileStack aria-hidden="true" className="size-4" /> },
          { key: 'evidence', label: t('documents.tabs.evidence'), icon: <Link2 aria-hidden="true" className="size-4" /> },
          { key: 'sources', label: t('documents.tabs.sources'), icon: <Library aria-hidden="true" className="size-4" /> },
        ]}
      />
      <div role="tabpanel" aria-label={t(`documents.tabs.${tab}`)}>
        {tab === 'documents' ? <DocumentsTab /> : tab === 'evidence' ? <EvidenceTab /> : <SourcesTab />}
      </div>
    </>
  );
}

export default function DocumentsPage() {
  return (
    <SectionGuard section="documents">
      <Suspense fallback={<LoadingState />}>
        <DocumentCenter />
      </Suspense>
    </SectionGuard>
  );
}
