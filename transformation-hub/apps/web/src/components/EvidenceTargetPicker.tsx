'use client';

import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { gatesRoutes, planningRoutes } from '@hub/contracts';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { PICKABLE_TARGET_TYPES, type PickableTargetType } from '@/lib/documents';
import { useProjectContext } from '@/lib/project-context';
import { SearchInput } from './SearchInput';
import { cx, input, label as labelCls } from './ui';

export interface PickedTarget {
  type: PickableTargetType;
  id: string;
  label: string;
}

const TYPE_PERMISSION: Record<PickableTargetType, string> = {
  task: 'planning.plan.read',
  milestone: 'planning.plan.read',
  deliverable: 'planning.plan.read',
  gate_criterion: 'gates.gate.read',
};

/**
 * Choose a record of this project to attach evidence to. Only record types the caller can read are offered; the
 * lists come from the owning modules' APIs (scoped server-side). Other record types embed <EvidencePanel> on
 * their own screens.
 */
export function EvidenceTargetPicker({
  value,
  onChange,
  only,
}: {
  value: PickedTarget | null;
  onChange: (t: PickedTarget | null) => void;
  /** Restrict the offered record types (e.g. source claims cannot target gate criteria). */
  only?: readonly PickableTargetType[];
}) {
  const { t, locale } = useI18n();
  const { projectId, can } = useProjectContext();
  const typeId = useId();
  const gateId = useId();
  const types = PICKABLE_TARGET_TYPES.filter((ty) => can(TYPE_PERMISSION[ty]) && (!only || only.includes(ty)));
  const [type, setType] = useState<PickableTargetType | ''>(value?.type ?? types[0] ?? '');
  const [q, setQ] = useState('');
  const [gate, setGate] = useState('');
  const loc = (en: string, ar: string | null | undefined) => (locale === 'ar' && ar ? ar : en);

  const records = useQuery({
    queryKey: ['project', projectId, 'evidence-picker', type, q],
    enabled: type === 'task' || type === 'milestone' || type === 'deliverable',
    queryFn: async ({ signal }) => {
      const query = { q: q || undefined, page: 1, pageSize: 20 };
      if (type === 'task') {
        const r = await api(planningRoutes.listTasks, { params: { projectId }, query, signal });
        return r.items.map((x) => ({ id: x.id, code: x.wbsCode, title: loc(x.title, x.titleAr) }));
      }
      if (type === 'milestone') {
        const r = await api(planningRoutes.listMilestones, { params: { projectId }, query, signal });
        return r.items.map((x) => ({ id: x.id, code: x.code, title: loc(x.title, x.titleAr) }));
      }
      const r = await api(planningRoutes.listDeliverables, { params: { projectId }, query, signal });
      return r.items.map((x) => ({ id: x.id, code: x.code, title: loc(x.title, x.titleAr) }));
    },
  });
  const gates = useQuery({
    queryKey: ['project', projectId, 'evidence-picker', 'gates'],
    enabled: type === 'gate_criterion',
    queryFn: ({ signal }) => api(gatesRoutes.listGates, { params: { projectId }, signal }),
  });
  const criteria = useQuery({
    queryKey: ['project', projectId, 'evidence-picker', 'gate', gate],
    enabled: type === 'gate_criterion' && !!gate,
    queryFn: ({ signal }) => api(gatesRoutes.getGate, { params: { projectId, gateId: gate }, signal }),
  });

  if (types.length === 0) return <p className="text-sm text-muted">{t('documents.picker.noTypes')}</p>;

  const options =
    type === 'gate_criterion'
      ? (criteria.data?.criteria ?? []).map((c) => ({ id: c.id, code: c.key, title: loc(c.description, c.descriptionAr) }))
      : (records.data ?? []);
  const loading = type === 'gate_criterion' ? criteria.isLoading && !!gate : records.isLoading;

  return (
    <fieldset className="space-y-3" data-testid="evidence-target-picker">
      <legend className={labelCls}>{t('documents.picker.legend')}</legend>
      <div>
        <label htmlFor={typeId} className="text-xs text-muted">
          {t('documents.picker.type')}
        </label>
        <select
          id={typeId}
          className={input}
          value={type}
          onChange={(e) => {
            setType(e.target.value as PickableTargetType);
            setQ('');
            setGate('');
            onChange(null);
          }}
        >
          {types.map((ty) => (
            <option key={ty} value={ty}>
              {t(`documents.targetTypes.${ty}`)}
            </option>
          ))}
        </select>
      </div>
      {type === 'gate_criterion' ? (
        <div>
          <label htmlFor={gateId} className="text-xs text-muted">
            {t('documents.picker.gate')}
          </label>
          <select id={gateId} className={input} value={gate} onChange={(e) => setGate(e.target.value)}>
            <option value="">{t('documents.picker.chooseGate')}</option>
            {(gates.data?.items ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.key} — {loc(g.name, g.nameAr)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <SearchInput label={t('documents.picker.search')} value={q} onChange={setQ} />
      )}
      <ul className="max-h-56 overflow-y-auto rounded-md border border-line" role="listbox" aria-label={t('documents.picker.results')}>
        {loading ? <li className="px-3 py-2 text-sm text-muted">{t('states.loading')}</li> : null}
        {!loading && options.length === 0 ? <li className="px-3 py-2 text-sm text-muted">{t('documents.picker.none')}</li> : null}
        {options.map((o) => {
          const selected = value?.id === o.id;
          return (
            <li key={o.id} role="option" aria-selected={selected}>
              <button
                type="button"
                className={cx('flex w-full items-start gap-2 px-3 py-2 text-start text-sm hover:bg-surface-muted', selected && 'bg-primary-soft font-semibold text-primary')}
                onClick={() => onChange({ type: type as PickableTargetType, id: o.id, label: `${o.code} — ${o.title}` })}
                data-testid="evidence-target-option"
              >
                <span dir="ltr" className="shrink-0 text-muted">
                  {o.code}
                </span>
                <span dir="auto">{o.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
