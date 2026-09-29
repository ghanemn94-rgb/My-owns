'use client';

import { FlaskConical } from 'lucide-react';
import { useT } from '@/i18n/provider';

/** Always-visible notice while the API runs in demo mode (synthetic users and data only). */
export function DemoModeBanner() {
  const t = useT();
  return (
    <div className="border-t border-demo-line bg-demo-soft text-demo" data-testid="demo-banner">
      <p className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5 text-sm">
        <FlaskConical aria-hidden="true" className="size-4 shrink-0" />
        <strong className="font-semibold">{t('common.demo.bannerTitle')}</strong>
        <span className="hidden sm:inline">— {t('common.demo.bannerBody')}</span>
      </p>
    </div>
  );
}
