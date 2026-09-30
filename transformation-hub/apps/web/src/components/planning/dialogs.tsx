'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useRefreshPlanning, type Task } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { useWorkstreams } from '@/lib/queries';
import { workstreamName, workstreamNameLang } from '@/lib/workstreams';
import { ApiErrorNotice } from '../ApiErrorNotice';
import { Dialog } from '../Dialog';
import { SelectField, TextAreaField, TextField } from '../Field';
import { useToast } from '../Toast';
import { UserPicker, type PickedUser } from '../UserPicker';
import { btn, hint } from '../ui';

/** Form dialog shell: submit button, server error display (409 → reload and review), busy handling. */
export function FormDialog({
  open,
  onClose,
  title,
  submitLabel,
  onSubmit,
  onReload,
  disabled,
  children,
  size = 'md',
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  onSubmit: () => Promise<unknown>;
  onReload?: () => void;
  disabled?: boolean;
  children: ReactNode;
  size?: 'md' | 'lg';
  testId?: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      busy={busy}
      size={size}
      footer={
        <>
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            {t('common.actions.cancel')}
          </button>
          <button type="button" className={btn.primary} onClick={submit} disabled={busy || disabled} aria-busy={busy} data-testid={testId ? `${testId}-submit` : undefined}>
            {busy ? t('common.actions.working') : submitLabel}
          </button>
        </>
      }
    >
      <form
        className="space-y-4"
        data-testid={testId}
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled) void submit();
        }}
      >
        {children}
        <ApiErrorNotice
          error={error}
          onReload={
            onReload
              ? () => {
                  onReload();
                  onClose();
                }
              : undefined
          }
        />
      </form>
    </Dialog>
  );
}

const num = (s: string) => (s.trim() === '' ? null : Number(s));

/** Create a task (Not started) or edit the plan fields of an existing one — status/owner/actuals are commands. */
export function TaskFormDialog({ open, onClose, task, defaultWorkstreamId }: { open: boolean; onClose: () => void; task?: Task; defaultWorkstreamId?: string }) {
  const { t, locale } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const ws = useWorkstreams(projectId, open && !task);
  const [f, setF] = useState({ workstreamId: '', title: '', description: '', durationDays: '', plannedStart: '', plannedFinish: '', requiresAcceptance: true, gateKey: '' });
  useEffect(() => {
    if (!open) return;
    setF({
      workstreamId: task?.workstreamId ?? defaultWorkstreamId ?? '',
      title: task?.title ?? '',
      description: task?.description ?? '',
      durationDays: task?.durationDays !== null && task?.durationDays !== undefined ? String(task.durationDays) : '',
      plannedStart: task?.plannedStart ?? '',
      plannedFinish: task?.plannedFinish ?? '',
      requiresAcceptance: task?.requiresAcceptance ?? true,
      gateKey: task?.gateKey ?? '',
    });
  }, [open, task, defaultWorkstreamId]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const valid = f.title.trim().length > 0 && (!!task || !!f.workstreamId);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      testId="task-form"
      title={task ? t('planning.task.editTitle', { code: task.wbsCode }) : t('planning.task.createTitle')}
      submitLabel={task ? t('common.actions.save') : t('planning.common.create')}
      disabled={!valid}
      onReload={() => void refresh()}
      onSubmit={async () => {
        if (task) {
          await api(P.updateTask, {
            params: { projectId, taskId: task.id },
            body: {
              expectedVersion: task.version,
              title: f.title.trim(),
              description: f.description.trim() || null,
              durationDays: num(f.durationDays),
              plannedStart: f.plannedStart || null,
              plannedFinish: f.plannedFinish || null,
              requiresAcceptance: f.requiresAcceptance,
              gateKey: f.gateKey.trim() || null,
            },
          });
          toast.show('success', t('planning.common.saved'));
        } else {
          const r = await api(P.createTask, {
            params: { projectId },
            body: {
              workstreamId: f.workstreamId,
              title: f.title.trim(),
              description: f.description.trim() || undefined,
              durationDays: num(f.durationDays) ?? undefined,
              plannedStart: f.plannedStart || undefined,
              plannedFinish: f.plannedFinish || undefined,
              requiresAcceptance: f.requiresAcceptance,
              gateKey: f.gateKey.trim() || undefined,
            },
          });
          toast.show('success', t('planning.task.created', { code: r.code ?? '' }));
        }
        await refresh();
        onClose();
      }}
    >
      {!task ? (
        <SelectField label={t('planning.common.workstream')} required value={f.workstreamId} onChange={set('workstreamId')}>
          <option value="">{t('planning.common.choose')}</option>
          {ws.data?.items.map((w) => (
            <option key={w.id} value={w.id} lang={workstreamNameLang(w, locale).lang}>
              {w.code} — {workstreamName(w, locale)}
            </option>
          ))}
        </SelectField>
      ) : null}
      <TextField label={t('planning.common.title')} required value={f.title} onChange={set('title')} maxLength={300} />
      <TextAreaField label={t('planning.task.description')} value={f.description} onChange={set('description')} maxLength={4000} rows={3} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={t('planning.task.duration')} type="number" min={0} max={2000} value={f.durationDays} onChange={set('durationDays')} dir="ltr" hint={t('planning.task.durationHint')} />
        <TextField label={t('planning.task.plannedStart')} type="date" value={f.plannedStart} onChange={set('plannedStart')} dir="ltr" />
        <TextField label={t('planning.task.plannedFinish')} type="date" value={f.plannedFinish} onChange={set('plannedFinish')} dir="ltr" />
      </div>
      <TextField label={t('planning.common.gate')} value={f.gateKey} onChange={set('gateKey')} maxLength={16} dir="ltr" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4" checked={f.requiresAcceptance} onChange={(e) => setF((x) => ({ ...x, requiresAcceptance: e.target.checked }))} />
        <span>
          {t('planning.task.requiresAcceptance')}
          <span className={hint}> — {t('planning.task.requiresAcceptanceHint')}</span>
        </span>
      </label>
    </FormDialog>
  );
}

/** Reported progress (a claim) and forecast dates — never evidence-verified progress. */
export function ProgressDialog({ open, onClose, task }: { open: boolean; onClose: () => void; task: Task }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [pct, setPct] = useState('0');
  const [fs, setFs] = useState('');
  const [ff, setFf] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!open) return;
    setPct(String(task.reportedProgress));
    setFs(task.forecastStart ?? '');
    setFf(task.forecastFinish ?? '');
    setNote('');
  }, [open, task]);
  const n = Number(pct);
  const valid = pct.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 100;
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      testId="progress-form"
      title={t('planning.task.progressTitle', { code: task.wbsCode })}
      submitLabel={t('planning.task.progressSave')}
      disabled={!valid}
      onReload={() => void refresh()}
      onSubmit={async () => {
        await api(P.updateTaskProgress, {
          params: { projectId, taskId: task.id },
          body: { expectedVersion: task.version, reportedProgress: n, forecastStart: fs || null, forecastFinish: ff || null, note: note.trim() || undefined },
        });
        toast.show('success', t('planning.task.progressSaved'));
        await refresh();
        onClose();
      }}
    >
      <p className="text-sm text-muted">{t('planning.task.progressHint')}</p>
      <TextField label={t('planning.task.reported')} type="number" min={0} max={100} required value={pct} onChange={(e) => setPct(e.target.value)} dir="ltr" error={valid ? null : t('planning.task.progressRange')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('planning.task.forecastStart')} type="date" value={fs} onChange={(e) => setFs(e.target.value)} dir="ltr" />
        <TextField label={t('planning.task.forecastFinish')} type="date" value={ff} onChange={(e) => setFf(e.target.value)} dir="ltr" />
      </div>
      <TextAreaField label={t('common.command.note')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} />
      <p className={hint}>{t('common.command.basedOnVersion', { version: task.version })}</p>
    </FormDialog>
  );
}

/** Single accountable owner: first assignment is planning; changing an existing owner needs ownership.reassign. */
export function OwnerDialog({
  open,
  onClose,
  title,
  current,
  version,
  run,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  current: string | null;
  version: number;
  run: (userId: string, reason: string | undefined) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [user, setUser] = useState<PickedUser | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setUser(null);
      setReason('');
    }
  }, [open]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      testId="owner-form"
      title={title}
      submitLabel={t('planning.owner.assign')}
      disabled={!user}
      onReload={() => void refresh()}
      onSubmit={async () => {
        if (!user) return;
        await run(user.id, reason.trim() || undefined);
        toast.show('success', t('planning.owner.assigned', { user: user.displayName }));
        await refresh();
        onClose();
      }}
    >
      <p className="text-sm text-muted">{current ? t('planning.owner.replaces', { user: current }) : t('planning.owner.first')}</p>
      <UserPicker label={t('planning.common.accountable')} value={user} onChange={setUser} required />
      <TextAreaField label={t('planning.common.reason')} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} />
      <p className={hint}>{t('planning.owner.memberRule')}</p>
      <p className={hint}>{t('common.command.basedOnVersion', { version })}</p>
    </FormDialog>
  );
}
