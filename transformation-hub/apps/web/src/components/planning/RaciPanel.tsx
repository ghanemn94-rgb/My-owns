'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { nodeHref, pk, useRefreshPlanning } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { ConfirmCommandDialog } from '../ConfirmCommandDialog';
import { SelectField, TextField } from '../Field';
import { useToast } from '../Toast';
import { UserPicker, type PickedUser } from '../UserPicker';
import { btn, cx } from '../ui';
import { CodeLink, Section } from './bits';
import { FormDialog } from './dialogs';

type EntityType = 'task' | 'milestone' | 'deliverable' | 'workstream';

/** RACI of a record: the single accountable owner is the derived "A"; additional R/C/I entries are managed here. */
export function RaciPanel({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const list = useQuery({ queryKey: pk.raci(projectId, entityType, entityId), queryFn: ({ signal }) => api(P.listRaci, { params: { projectId }, query: { entityType, entityId }, signal }) });
  const [add, setAdd] = useState(false);
  const [remove, setRemove] = useState<{ id: string; label: string } | null>(null);
  const canManage = can('planning.task.manage');
  return (
    <Section
      id={`raci-${entityId}`}
      title={t('planning.raci.title')}
      hint={t('planning.raci.hint')}
      actions={
        canManage ? (
          <button type="button" className={btn.secondary} onClick={() => setAdd(true)}>
            <UserPlus aria-hidden="true" className="size-4" />
            {t('planning.raci.add')}
          </button>
        ) : null
      }
    >
      {list.isLoading ? null : !list.data?.items.length ? (
        <p className="text-sm text-muted">{t('planning.raci.empty')}</p>
      ) : (
        <ul className="divide-y divide-line" data-testid="raci-list">
          {list.data.items.map((r) => (
            <li key={r.id ?? 'owner'} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded bg-primary-soft text-xs font-bold text-primary" aria-hidden="true">
                  {r.raci}
                </span>
                <span className="min-w-0">
                  <span dir="auto">{r.displayName ?? r.functionLabel ?? '—'}</span>
                  <span className="ms-2 text-xs text-muted">
                    {tStatus('raciValues', r.raci)}
                    {r.derived ? ` · ${t('planning.raci.derived')}` : ''}
                  </span>
                </span>
              </span>
              {!r.derived && r.id && canManage ? (
                <button type="button" className={cx(btn.ghost, 'min-h-8 px-2 py-1')} aria-label={t('planning.raci.remove')} onClick={() => setRemove({ id: r.id!, label: r.displayName ?? r.functionLabel ?? '' })}>
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <AddRaciDialog open={add} onClose={() => setAdd(false)} entityType={entityType} entityId={entityId} />
      {remove ? (
        <ConfirmCommandDialog
          open
          onClose={() => setRemove(null)}
          title={t('planning.raci.remove')}
          confirmLabel={t('planning.raci.remove')}
          danger
          consequences={[t('planning.raci.removeEffect', { who: remove.label }), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(P.removeRaci, { params: { projectId, raciId: remove.id }, body: { reason: note || undefined } });
            await refresh();
            toast.show('success', t('planning.raci.removed'));
            setRemove(null);
          }}
        />
      ) : null}
    </Section>
  );
}

function AddRaciDialog({ open, onClose, entityType, entityId }: { open: boolean; onClose: () => void; entityType: EntityType; entityId: string }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [user, setUser] = useState<PickedUser | null>(null);
  const [fn, setFn] = useState('');
  const [raci, setRaci] = useState<'R' | 'C' | 'I'>('R');
  useEffect(() => {
    if (open) {
      setUser(null);
      setFn('');
      setRaci('R');
    }
  }, [open]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('planning.raci.add')}
      submitLabel={t('planning.raci.add')}
      disabled={!user && !fn.trim()}
      onSubmit={async () => {
        await api(P.addRaci, { params: { projectId }, body: { entityType, entityId, userId: user?.id, functionLabel: fn.trim() || undefined, raci } });
        toast.show('success', t('planning.raci.added'));
        await refresh();
        onClose();
      }}
    >
      <SelectField label={t('planning.raci.role')} required value={raci} onChange={(e) => setRaci(e.target.value as 'R')}>
        {(['R', 'C', 'I'] as const).map((r) => (
          <option key={r} value={r}>
            {tStatus('raciValues', r)}
          </option>
        ))}
      </SelectField>
      <UserPicker label={t('planning.raci.person')} value={user} onChange={setUser} />
      <TextField label={t('planning.raci.function')} value={fn} onChange={(e) => setFn(e.target.value)} maxLength={200} hint={t('planning.raci.functionHint')} />
      <p className="text-xs text-muted">{t('planning.raci.accountableRule')}</p>
    </FormDialog>
  );
}

/** Predecessors / successors of one schedule node. */
export function NodeDependencies({ nodeId }: { nodeId: string }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const deps = useQuery({ queryKey: pk.dependencies(projectId, nodeId), queryFn: ({ signal }) => api(P.listDependencies, { params: { projectId }, query: { nodeId }, signal }) });
  const items = deps.data?.items ?? [];
  const preds = items.filter((d) => d.successorId === nodeId);
  const succs = items.filter((d) => d.predecessorId === nodeId);
  const row = (d: (typeof items)[number], other: 'pred' | 'succ') => (
    <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
      {other === 'pred' ? (
        <CodeLink href={nodeHref(projectId, d.predecessorType, d.predecessorId)} code={d.predecessorCode} title={d.predecessorTitle} />
      ) : (
        <CodeLink href={nodeHref(projectId, d.successorType, d.successorId)} code={d.successorCode} title={d.successorTitle} />
      )}
      <span className="shrink-0 text-xs text-muted">
        {tStatus('dependencyTypes', d.type)}
        {d.lagDays ? ` · ${t('planning.dependency.lagShort', { days: d.lagDays })}` : ''}
      </span>
    </li>
  );
  return (
    <Section id={`deps-${nodeId}`} title={t('planning.tabs.dependencies')} actions={<Link className={btn.link} href={`/projects/${projectId}/plan?tab=dependencies`}>{t('planning.dependency.manage')}</Link>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">{t('planning.dependency.predecessors')}</h3>
          {preds.length ? <ul className="divide-y divide-line">{preds.map((d) => row(d, 'pred'))}</ul> : <p className="text-sm text-muted">{t('planning.common.none')}</p>}
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t('planning.dependency.successors')}</h3>
          {succs.length ? <ul className="divide-y divide-line">{succs.map((d) => row(d, 'succ'))}</ul> : <p className="text-sm text-muted">{t('planning.common.none')}</p>}
        </div>
      </div>
    </Section>
  );
}
