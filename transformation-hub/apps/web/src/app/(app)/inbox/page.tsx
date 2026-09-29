'use client';

import { Main } from '@/components/Main';
import { NotImplementedYet } from '@/components/NotImplementedYet';
import { PageHeader } from '@/components/PageHeader';
import { useI18n } from '@/i18n/provider';

export default function InboxPage() {
  const { t } = useI18n();
  return (
    <Main>
      <PageHeader title={t('nav.inbox')} description={t('project.screens.inbox.purpose')} />
      <NotImplementedYet phase="P2" feature={t('nav.inbox')} />
    </Main>
  );
}
