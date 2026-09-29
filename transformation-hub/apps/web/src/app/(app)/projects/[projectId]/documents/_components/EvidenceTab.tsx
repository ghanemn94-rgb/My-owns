'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { EVIDENCE_TARGET_TYPES, type EvidenceTargetType } from '@hub/domain';
import { EvidencePanel } from '@/components/EvidencePanel';
import { EvidenceTargetPicker, type PickedTarget } from '@/components/EvidenceTargetPicker';
import { btn, card, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Evidence by record. Deep-linkable (`?tab=evidence&targetType=task&targetId=…`) so other screens can link here
 * until they embed <EvidencePanel> themselves.
 */
export function EvidenceTab() {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawType = params.get('targetType') ?? '';
  const rawId = params.get('targetId') ?? '';
  const target =
    (EVIDENCE_TARGET_TYPES as readonly string[]).includes(rawType) && UUID.test(rawId) ? { type: rawType as EvidenceTargetType, id: rawId, label: params.get('label') ?? '' } : null;

  const choose = (p: PickedTarget | null) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', 'evidence');
    if (p) {
      sp.set('targetType', p.type);
      sp.set('targetId', p.id);
      sp.set('label', p.label);
    } else {
      sp.delete('targetType');
      sp.delete('targetId');
      sp.delete('label');
    }
    router.replace(`${pathname}?${sp.toString()}`);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('documents.evidence.tabIntro')}</p>
      {target ? (
        <>
          <div className={cx(card, 'flex flex-wrap items-center justify-between gap-2 p-3')}>
            <p className="text-sm">
              <span className="text-muted">{t(`documents.targetTypes.${target.type}`)}: </span>
              <span dir="auto" className="font-medium" data-testid="evidence-target-label">
                {target.label || target.id}
              </span>
            </p>
            <button type="button" className={btn.secondary} onClick={() => choose(null)}>
              {t('documents.picker.change')}
            </button>
          </div>
          <EvidencePanel targetType={target.type} targetId={target.id} />
        </>
      ) : (
        <div className={cx(card, 'p-4')}>
          <EvidenceTargetPicker value={null} onChange={(p) => p && choose(p)} />
        </div>
      )}
    </div>
  );
}
