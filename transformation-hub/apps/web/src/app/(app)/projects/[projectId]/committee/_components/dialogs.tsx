'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { governanceRoutes } from '@hub/contracts';
import { AGENDA_ITEM_KINDS, CLASSIFICATIONS, clearanceAllows } from '@hub/domain';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { Dialog } from '@/components/Dialog';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { btn, cx, hint } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { GovCommandDialog, useCommitteeList, useDecisionList, useDecisionTypes, useGovRefresh, useMeetingList, type DecisionDetail } from './gov';

type Classification = (typeof CLASSIFICATIONS)[number];
type AgendaKind = (typeof AGENDA_ITEM_KINDS)[number];
const DECIMAL = /^\d{1,16}(\.\d{1,4})?$/;

// ---------------------------------------------------------------------------------------------------------------
// Decision paper (create or edit a draft)

interface PaperState {
  committeeId: string;
  title: string;
  decisionTypeKey: string;
  issue: string;
  whyNow: string;
  alternatives: { title: string; summary: string }[];
  recommendation: string;
  financial: string;
  operational: string;
  schedule: string;
  amount: string;
  currency: string;
  unitScale: '1' | '1000' | '1000000';
  risks: string;
  dependencies: string;
  latestSafeDate: string;
  requiredAuthority: string;
  classification: Classification;
}

function fromDecision(d: DecisionDetail | null, committeeId: string): PaperState {
  return {
    committeeId: d?.committeeId ?? committeeId,
    title: d?.title ?? '',
    decisionTypeKey: d?.decisionTypeKey ?? '',
    issue: d?.issue ?? '',
    whyNow: d?.whyNow ?? '',
    alternatives: d?.alternatives.map((a) => ({ title: a.title, summary: a.summary ?? '' })) ?? [{ title: '', summary: '' }],
    recommendation: d?.recommendation ?? '',
    financial: d?.impacts.financial ?? '',
    operational: d?.impacts.operational ?? '',
    schedule: d?.impacts.schedule ?? '',
    amount: d?.amount?.amount ?? '',
    currency: d?.amount?.currency ?? 'SAR',
    unitScale: String(d?.amount?.unitScale ?? 1) as PaperState['unitScale'],
    risks: d?.risks ?? '',
    dependencies: d?.dependencies ?? '',
    latestSafeDate: d?.latestSafeDate ?? '',
    requiredAuthority: d?.requiredAuthority ?? '',
    classification: (d?.classification ?? 'confidential') as Classification,
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

export function DecisionPaperDialog({
  open,
  onClose,
  decision,
  defaultCommitteeId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Edit this draft; null = create a new paper. */
  decision: DecisionDetail | null;
  defaultCommitteeId?: string;
  onCreated?: (id: string) => void;
}) {
  const { t, tStatus, locale } = useI18n();
  const { projectId, me } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const committees = useCommitteeList(open && !decision);
  const [s, setS] = useState<PaperState>(() => fromDecision(decision, defaultCommitteeId ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  const types = useDecisionTypes(s.committeeId || null);

  useEffect(() => {
    if (open) {
      setS(fromDecision(decision, defaultCommitteeId ?? ''));
      setError(null);
      setTouched(false);
    }
  }, [open, decision, defaultCommitteeId]);
  useEffect(() => {
    if (open && !decision && !s.committeeId && committees.data?.items[0]) setS((x) => ({ ...x, committeeId: committees.data!.items[0]!.id }));
  }, [open, decision, s.committeeId, committees.data]);

  const up = <K extends keyof PaperState>(k: K, v: PaperState[K]) => setS((x) => ({ ...x, [k]: v }));
  const amountBad = s.amount.trim() !== '' && !DECIMAL.test(s.amount.trim());
  const titleMissing = s.title.trim() === '';
  const classes = CLASSIFICATIONS.filter((c) => clearanceAllows(me.user.clearance, c));

  const submit = async () => {
    setTouched(true);
    if (titleMissing || amountBad || !s.committeeId) return;
    setBusy(true);
    setError(null);
    const alternatives = s.alternatives.filter((a) => a.title.trim()).map((a) => (a.summary.trim() ? { title: a.title.trim(), summary: a.summary.trim() } : { title: a.title.trim() }));
    const paper = {
      title: s.title.trim(),
      decisionTypeKey: orNull(s.decisionTypeKey),
      issue: orNull(s.issue),
      whyNow: orNull(s.whyNow),
      alternatives,
      recommendation: orNull(s.recommendation),
      impacts: {
        ...(s.financial.trim() ? { financial: s.financial.trim() } : {}),
        ...(s.operational.trim() ? { operational: s.operational.trim() } : {}),
        ...(s.schedule.trim() ? { schedule: s.schedule.trim() } : {}),
      },
      amount: s.amount.trim() ? { amount: s.amount.trim(), currency: s.currency.trim().toUpperCase(), unitScale: Number(s.unitScale) as 1 | 1000 | 1000000 } : null,
      risks: orNull(s.risks),
      dependencies: orNull(s.dependencies),
      latestSafeDate: s.latestSafeDate || null,
      requiredAuthority: orNull(s.requiredAuthority),
      classification: s.classification,
    };
    try {
      if (decision) {
        await api(governanceRoutes.updateDecision, { params: { projectId, decisionId: decision.id }, body: { expectedVersion: decision.version, ...paper } });
        toast.show('success', t('governance.paper.saved'));
      } else {
        const r = await api(governanceRoutes.createDecision, { params: { projectId }, body: { committeeId: s.committeeId, ...paper } });
        toast.show('success', t('governance.decisions.create.done', { code: r.code }));
        onCreated?.(r.id);
      }
      await refresh();
      onClose();
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
      busy={busy}
      size="lg"
      title={decision ? t('governance.paper.editTitle', { code: decision.code }) : t('governance.decisions.create.title')}
      description={decision ? undefined : t('governance.decisions.create.effect')}
      footer={
        <>
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            {t('common.actions.cancel')}
          </button>
          <button type="button" className={btn.primary} onClick={submit} disabled={busy} aria-busy={busy} data-testid="paper-save">
            {busy ? t('common.actions.working') : decision ? t('governance.paper.save') : t('governance.decisions.create.confirm')}
          </button>
        </>
      }
    >
      <div className="space-y-4" data-testid="paper-form">
        {!decision ? (
          <SelectField label={t('governance.common.committee')} required value={s.committeeId} onChange={(e) => up('committeeId', e.target.value)}>
            {!committees.data ? <option value="">{t('governance.common.loadingList')}</option> : null}
            {(committees.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {tStatus('committeeKinds', c.kind)}
              </option>
            ))}
          </SelectField>
        ) : null}
        <TextField label={t('governance.paper.titleField')} required value={s.title} maxLength={300} onChange={(e) => up('title', e.target.value)} error={touched && titleMissing ? t('common.validation.required') : null} />
        <SelectField label={t('governance.paper.decisionType')} value={s.decisionTypeKey} onChange={(e) => up('decisionTypeKey', e.target.value)} hint={t('governance.paper.decisionTypeHint')} data-testid="paper-type">
          <option value="">{t('governance.common.select')}</option>
          {types.map((dt) => (
            <option key={dt.key} value={dt.key}>
              {dt.name?.[locale] ?? dt.key}
            </option>
          ))}
          {s.decisionTypeKey && !types.some((x) => x.key === s.decisionTypeKey) ? (
            <option value={s.decisionTypeKey}>{t('governance.paper.notInMatrix', { key: s.decisionTypeKey })}</option>
          ) : null}
        </SelectField>
        <TextAreaField label={t('governance.paper.issue')} value={s.issue} maxLength={8000} onChange={(e) => up('issue', e.target.value)} />
        <TextAreaField label={t('governance.paper.whyNow')} value={s.whyNow} maxLength={8000} onChange={(e) => up('whyNow', e.target.value)} />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">{t('governance.paper.alternatives')}</legend>
          {s.alternatives.map((a, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
              <TextField
                label={t('governance.paper.alternativeTitle', { n: i + 1 })}
                value={a.title}
                maxLength={300}
                onChange={(e) => up('alternatives', s.alternatives.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
              />
              <TextField
                label={t('governance.paper.alternativeSummary', { n: i + 1 })}
                value={a.summary}
                maxLength={4000}
                onChange={(e) => up('alternatives', s.alternatives.map((x, j) => (j === i ? { ...x, summary: e.target.value } : x)))}
              />
              <button
                type="button"
                className={cx(btn.ghost, 'self-end')}
                onClick={() => up('alternatives', s.alternatives.filter((_, j) => j !== i))}
                aria-label={t('governance.paper.removeAlternative', { n: i + 1 })}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </div>
          ))}
          {s.alternatives.length < 20 ? (
            <button type="button" className={btn.secondary} onClick={() => up('alternatives', [...s.alternatives, { title: '', summary: '' }])}>
              <Plus aria-hidden="true" className="size-4" />
              {t('governance.paper.addAlternative')}
            </button>
          ) : null}
        </fieldset>
        <TextAreaField label={t('governance.paper.recommendation')} value={s.recommendation} maxLength={8000} onChange={(e) => up('recommendation', e.target.value)} />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">{t('governance.paper.impacts')}</legend>
          <p className={hint}>{t('governance.paper.impactsHint')}</p>
          <TextField label={t('governance.paper.impactFinancial')} value={s.financial} maxLength={4000} onChange={(e) => up('financial', e.target.value)} />
          <TextField label={t('governance.paper.impactOperational')} value={s.operational} maxLength={4000} onChange={(e) => up('operational', e.target.value)} />
          <TextField label={t('governance.paper.impactSchedule')} value={s.schedule} maxLength={4000} onChange={(e) => up('schedule', e.target.value)} />
        </fieldset>
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="mb-1 text-sm font-medium text-ink">{t('governance.paper.amount')}</legend>
          <TextField
            label={t('governance.paper.amountValue')}
            dir="ltr"
            inputMode="decimal"
            value={s.amount}
            onChange={(e) => up('amount', e.target.value)}
            error={amountBad ? t('governance.paper.amountInvalid') : null}
          />
          <TextField label={t('governance.paper.currency')} dir="ltr" maxLength={3} value={s.currency} onChange={(e) => up('currency', e.target.value)} />
          <SelectField label={t('governance.paper.unitScale')} value={s.unitScale} onChange={(e) => up('unitScale', e.target.value as PaperState['unitScale'])}>
            {(['1', '1000', '1000000'] as const).map((u) => (
              <option key={u} value={u}>
                {t(`governance.paper.units.${u}`)}
              </option>
            ))}
          </SelectField>
        </fieldset>
        <TextAreaField label={t('governance.paper.risks')} value={s.risks} maxLength={8000} onChange={(e) => up('risks', e.target.value)} />
        <TextAreaField label={t('governance.paper.dependencies')} value={s.dependencies} maxLength={8000} onChange={(e) => up('dependencies', e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('governance.paper.latestSafeDate')} type="date" dir="ltr" value={s.latestSafeDate} onChange={(e) => up('latestSafeDate', e.target.value)} />
          <SelectField label={t('governance.common.classification')} required value={s.classification} onChange={(e) => up('classification', e.target.value as Classification)}>
            {classes.map((c) => (
              <option key={c} value={c}>
                {tStatus('classifications', c)}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField label={t('governance.paper.requiredAuthority')} value={s.requiredAuthority} maxLength={500} onChange={(e) => up('requiredAuthority', e.target.value)} />
        <ApiErrorNotice error={error} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Schedule a meeting

export function ScheduleMeetingDialog({ open, onClose, committeeId }: { open: boolean; onClose: () => void; committeeId?: string }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const committees = useCommitteeList(open);
  const active = useMemo(() => (committees.data?.items ?? []).filter((c) => c.status === 'active'), [committees.data]);
  const [cid, setCid] = useState(committeeId ?? '');
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [location, setLocation] = useState('');
  useEffect(() => {
    if (open) {
      setCid(committeeId ?? '');
      setTitle('');
      setWhen('');
      setLocation('');
    }
  }, [open, committeeId]);
  useEffect(() => {
    if (open && !cid && active[0]) setCid(active[0].id);
  }, [open, cid, active]);
  return (
    <GovCommandDialog
      open={open}
      onClose={onClose}
      title={t('governance.meetings.create.title')}
      confirmLabel={t('governance.meetings.create.confirm')}
      noteMode="none"
      confirmDisabled={!cid || !title.trim() || !when}
      consequences={[t('governance.meetings.create.effect'), t('common.command.audited')]}
      onConfirm={async () => {
        // datetime-local is interpreted as Asia/Riyadh (UTC+3, no daylight saving).
        const scheduledAt = new Date(`${when}:00+03:00`).toISOString();
        const r = await api(governanceRoutes.createMeeting, {
          params: { projectId, committeeId: cid },
          body: { title: title.trim(), scheduledAt, ...(location.trim() ? { location: location.trim() } : {}) },
        });
        await refresh();
        toast.show('success', t('governance.meetings.create.done', { number: r.number }));
        onClose();
      }}
    >
      <div className="space-y-4">
        <SelectField label={t('governance.meetings.create.committee')} required value={cid} onChange={(e) => setCid(e.target.value)} hint={t('governance.meetings.create.committeeHint')}>
          <option value="">{t('governance.common.select')}</option>
          {active.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <TextField label={t('governance.meetings.create.titleField')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        <TextField label={t('governance.meetings.create.scheduledAt')} required type="datetime-local" dir="ltr" value={when} onChange={(e) => setWhen(e.target.value)} />
        <TextField label={t('governance.meetings.create.location')} value={location} maxLength={300} onChange={(e) => setLocation(e.target.value)} />
      </div>
    </GovCommandDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Request an agenda item

export function AgendaRequestDialog({ open, onClose, committeeId, meetingId, decisionId }: { open: boolean; onClose: () => void; committeeId?: string; meetingId?: string; decisionId?: string }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const committees = useCommitteeList(open && !committeeId);
  const [cid, setCid] = useState(committeeId ?? '');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<AgendaKind>(decisionId ? 'decision' : 'decision');
  const [did, setDid] = useState(decisionId ?? '');
  const [mid, setMid] = useState(meetingId ?? '');
  const decisions = useDecisionList({ committeeId: cid || undefined, pageSize: 100 }, open && Boolean(cid));
  const meetings = useMeetingList({ committeeId: cid || undefined, pageSize: 100, isCirculation: 'false' }, open && Boolean(cid));
  useEffect(() => {
    if (open) {
      setCid(committeeId ?? '');
      setTitle('');
      setDid(decisionId ?? '');
      setMid(meetingId ?? '');
      setKind('decision');
    }
  }, [open, committeeId, meetingId, decisionId]);
  const openDecisions = (decisions.data?.items ?? []).filter((d) => ['draft', 'submitted', 'under_review', 'deferred'].includes(d.status));
  const openMeetings = (meetings.data?.items ?? []).filter((m) => m.status === 'planned' || m.status === 'agenda_published');
  return (
    <GovCommandDialog
      open={open}
      onClose={onClose}
      title={t('governance.agenda.request.title')}
      confirmLabel={t('governance.agenda.request.confirm')}
      noteMode="none"
      confirmDisabled={!cid || !title.trim()}
      consequences={[t('governance.agenda.request.effect'), t('common.command.audited')]}
      onConfirm={async () => {
        await api(governanceRoutes.createAgendaRequest, {
          params: { projectId },
          body: { committeeId: cid, title: title.trim(), kind, ...(did ? { decisionId: did } : {}), ...(mid ? { meetingId: mid } : {}) },
        });
        await refresh();
        toast.show('success', t('governance.agenda.request.done'));
        onClose();
      }}
    >
      <div className="space-y-4">
        {!committeeId ? (
          <SelectField label={t('governance.agenda.request.committee')} required value={cid} onChange={(e) => setCid(e.target.value)}>
            <option value="">{t('governance.common.select')}</option>
            {(committees.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        <TextField label={t('governance.agenda.request.itemTitle')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        <SelectField label={t('governance.agenda.request.kind')} required value={kind} onChange={(e) => setKind(e.target.value as AgendaKind)}>
          {AGENDA_ITEM_KINDS.map((k) => (
            <option key={k} value={k}>
              {tStatus('agendaItemKinds', k)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('governance.agenda.request.decision')} value={did} onChange={(e) => setDid(e.target.value)} data-testid="agenda-decision">
          <option value="">{t('governance.common.none')}</option>
          {openDecisions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} — {d.title}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('governance.agenda.request.meeting')} value={mid} onChange={(e) => setMid(e.target.value)}>
          <option value="">{t('governance.common.none')}</option>
          {openMeetings.map((m) => (
            <option key={m.id} value={m.id}>
              {t('governance.common.meetingNumber', { number: m.number })} — {m.title}
            </option>
          ))}
        </SelectField>
      </div>
    </GovCommandDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Create an action

export function CreateActionDialog({ open, onClose, decisionId, meetingId }: { open: boolean; onClose: () => void; decisionId?: string; meetingId?: string }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [due, setDue] = useState('');
  const [did, setDid] = useState(decisionId ?? '');
  const decisions = useDecisionList({ pageSize: 100 }, open && !decisionId);
  useEffect(() => {
    if (open) {
      setTitle('');
      setOwner(null);
      setDue('');
      setDid(decisionId ?? '');
    }
  }, [open, decisionId]);
  return (
    <GovCommandDialog
      open={open}
      onClose={onClose}
      title={t('governance.actions.create.title')}
      confirmLabel={t('governance.actions.create.confirm')}
      noteMode="none"
      confirmDisabled={!title.trim() || !owner || !due}
      consequences={[t('governance.actions.create.effect'), t('common.command.audited')]}
      onConfirm={async () => {
        if (!owner) return;
        const r = await api(governanceRoutes.createAction, {
          params: { projectId },
          body: { title: title.trim(), ownerUserId: owner.id, dueDate: due, ...(did ? { decisionId: did } : {}), ...(meetingId ? { meetingId } : {}) },
        });
        await refresh();
        toast.show('success', t('governance.actions.create.done', { code: r.code }));
        onClose();
      }}
    >
      <div className="space-y-4">
        <TextField label={t('governance.actions.create.titleField')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        <UserPicker label={t('governance.actions.create.owner')} value={owner} onChange={setOwner} required />
        <p className={hint}>{t('governance.actions.create.ownerHint')}</p>
        <TextField label={t('governance.actions.create.dueDate')} required type="date" dir="ltr" value={due} onChange={(e) => setDue(e.target.value)} />
        {!decisionId ? (
          <SelectField label={t('governance.actions.create.decision')} value={did} onChange={(e) => setDid(e.target.value)}>
            <option value="">{t('governance.common.none')}</option>
            {(decisions.data?.items ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.title}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>
    </GovCommandDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Raise an escalation

const SOURCE_TYPES = ['decision', 'other'] as const;

export function RaiseEscalationDialog({ open, onClose, decisionId }: { open: boolean; onClose: () => void; decisionId?: string }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState<(typeof SOURCE_TYPES)[number]>(decisionId ? 'decision' : 'other');
  const [did, setDid] = useState(decisionId ?? '');
  const [requested, setRequested] = useState('');
  const [deadline, setDeadline] = useState('');
  const [target, setTarget] = useState('');
  const [options, setOptions] = useState<{ title: string; impact: string }[]>([{ title: '', impact: '' }]);
  const decisions = useDecisionList({ pageSize: 100 }, open && sourceType === 'decision' && !decisionId);
  useEffect(() => {
    if (open) {
      setTitle('');
      setSourceType(decisionId ? 'decision' : 'other');
      setDid(decisionId ?? '');
      setRequested('');
      setDeadline('');
      setTarget('');
      setOptions([{ title: '', impact: '' }]);
    }
  }, [open, decisionId]);
  const validOptions = options.filter((o) => o.title.trim());
  return (
    <GovCommandDialog
      open={open}
      onClose={onClose}
      title={t('governance.escalations.raise.title')}
      confirmLabel={t('governance.escalations.raise.confirm')}
      noteMode="none"
      confirmDisabled={!title.trim() || !requested.trim() || !deadline || validOptions.length === 0 || (sourceType === 'decision' && !did)}
      consequences={[t('governance.escalations.raise.effect'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(governanceRoutes.raiseEscalation, {
          params: { projectId },
          body: {
            title: title.trim(),
            sourceType,
            ...(sourceType === 'decision' && did ? { sourceId: did } : {}),
            requestedAction: requested.trim(),
            decisionDeadline: deadline,
            options: validOptions.map((o) => (o.impact.trim() ? { title: o.title.trim(), impact: o.impact.trim() } : { title: o.title.trim() })),
            ...(target.trim() ? { target: target.trim() } : {}),
          },
        });
        await refresh();
        toast.show('success', t('governance.escalations.raise.done', { code: r.code }));
        onClose();
      }}
    >
      <div className="space-y-4">
        <TextField label={t('governance.escalations.raise.titleField')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        {!decisionId ? (
          <SelectField label={t('governance.escalations.raise.sourceType')} required value={sourceType} onChange={(e) => setSourceType(e.target.value as (typeof SOURCE_TYPES)[number])}>
            {SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`governance.escalations.sources.${s}`)}
              </option>
            ))}
          </SelectField>
        ) : null}
        {sourceType === 'decision' && !decisionId ? (
          <SelectField label={t('governance.escalations.raise.decision')} required value={did} onChange={(e) => setDid(e.target.value)}>
            <option value="">{t('governance.common.select')}</option>
            {(decisions.data?.items ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.title}
              </option>
            ))}
          </SelectField>
        ) : null}
        <TextAreaField label={t('governance.escalations.raise.requestedAction')} required value={requested} maxLength={2000} onChange={(e) => setRequested(e.target.value)} />
        <TextField label={t('governance.escalations.raise.deadline')} required type="date" dir="ltr" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">
            {t('governance.escalations.raise.options')} <span className="text-danger">*</span>
          </legend>
          {options.map((o, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
              <TextField label={t('governance.escalations.raise.optionTitle', { n: i + 1 })} value={o.title} maxLength={300} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <TextField label={t('governance.escalations.raise.optionImpact', { n: i + 1 })} value={o.impact} maxLength={2000} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, impact: e.target.value } : x)))} />
              <button type="button" className={cx(btn.ghost, 'self-end')} onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label={t('governance.escalations.raise.removeOption', { n: i + 1 })} disabled={options.length === 1}>
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </div>
          ))}
          {options.length < 10 ? (
            <button type="button" className={btn.secondary} onClick={() => setOptions([...options, { title: '', impact: '' }])}>
              <Plus aria-hidden="true" className="size-4" />
              {t('governance.escalations.raise.addOption')}
            </button>
          ) : null}
        </fieldset>
        <TextField label={t('governance.escalations.raise.target')} value={target} maxLength={300} onChange={(e) => setTarget(e.target.value)} />
      </div>
    </GovCommandDialog>
  );
}
