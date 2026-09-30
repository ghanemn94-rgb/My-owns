'use client';

import { Gavel, Link2, Play, RotateCcw, Send, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { gatesRoutes } from '@hub/contracts';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { SelectField } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { holdsRole, useDecisionOptions, useInvalidateGates, type GateDetail } from '@/lib/gates';
import { projectAccess } from '@/lib/queries';
import { useLocalized, useServerMessages } from '@/lib/i18n-data';
import type { ServerMessageDto } from '@hub/contracts';
import { useProjectContext } from '@/lib/project-context';

type Cmd = 'start' | 'markReady' | 'back' | 'link' | 'decide' | 'reopen';
type Outcome = 'approve' | 'approve_with_exceptions' | 'reject';

const DECIDED = ['approved', 'approved_with_exceptions', 'rejected'];

interface DecisionOption {
  id: string;
  code: string;
  title: string;
  status: string;
  authorityOutcome: string;
  blocker: string | null;
  blockerI18n: ServerMessageDto[];
}

/** Decisions offered for linking: those raised for this gate (with their AT-04 blocker) + the visible register. */
function useDecisionChoices(gate: GateDetail, enabled: boolean): DecisionOption[] {
  const { projectId, can } = useProjectContext();
  const register = useDecisionOptions(projectId, enabled && can('governance.decision.read'));
  return useMemo(() => {
    const out = new Map<string, DecisionOption>();
    for (const d of gate.decisions) out.set(d.id, { id: d.id, code: d.code, title: d.title, status: d.status, authorityOutcome: d.authorityOutcome, blocker: d.blocker, blockerI18n: d.blockerI18n });
    if (gate.decision) out.set(gate.decision.id, { ...gate.decision });
    for (const d of register.data?.items ?? []) {
      if (!out.has(d.id)) out.set(d.id, { id: d.id, code: d.code, title: d.title, status: d.status, authorityOutcome: d.authorityOutcome, blocker: null, blockerI18n: [] });
    }
    return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [gate.decisions, gate.decision, register.data]);
}

export function GateActions({ gate }: { gate: GateDetail }) {
  const { t, tStatus } = useI18n();
  const loc = useLocalized();
  const serverText = useServerMessages();
  const { projectId, can, me } = useProjectContext();
  const toast = useToast();
  const invalidate = useInvalidateGates(projectId);
  const [open, setOpen] = useState<Cmd | null>(null);
  const [decisionId, setDecisionId] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('approve');
  const [reset, setReset] = useState<string[]>([]);

  const a = gate.assessment;
  const status = a.status;
  const roles = projectAccess(me, projectId)?.roles;
  const canSubmit = can('gates.assessment.submit');
  const canDecide = can('gates.assessment.decide') && holdsRole(roles, gate.approverRole);
  const canReopen = can('gates.assessment.reopen');
  const decided = DECIDED.includes(status);
  const choices = useDecisionChoices(gate, open === 'link' || open === 'decide');
  const chosen = choices.find((c) => c.id === (decisionId || gate.assessment.decisionId));

  const params = { projectId, gateId: gate.id };
  const close = () => {
    setOpen(null);
    setDecisionId('');
    setOutcome('approve');
    setReset([]);
  };
  const done = async (message: string) => {
    await invalidate();
    toast.show('success', message);
    close();
  };
  const gateLabel = `${gate.key} — ${loc(gate.name, gate.nameAr)}`;

  const buttons: { cmd: Cmd; show: boolean; label: string; icon: typeof Play; primary?: boolean }[] = [
    { cmd: 'start', show: canSubmit && (status === 'not_started' || status === 'reopened'), label: t('gates.actions.start'), icon: Play, primary: true },
    { cmd: 'markReady', show: canSubmit && status === 'in_assessment', label: t('gates.actions.markReady'), icon: Send, primary: gate.evaluation.ready },
    { cmd: 'back', show: canSubmit && status === 'ready_for_decision', label: t('gates.actions.back'), icon: Undo2 },
    { cmd: 'link', show: canSubmit && !decided, label: t('gates.actions.link'), icon: Link2 },
    { cmd: 'decide', show: canDecide && (status === 'ready_for_decision' || status === 'in_assessment'), label: t('gates.actions.decide'), icon: Gavel, primary: status === 'ready_for_decision' },
    { cmd: 'reopen', show: canReopen && decided, label: t('gates.actions.reopen'), icon: RotateCcw },
  ];
  const visible = buttons.filter((b) => b.show);

  const decisionSelect = (
    <SelectField
      label={t('gates.decide.decision')}
      required={open === 'link' || outcome !== 'reject'}
      value={decisionId || (open === 'decide' ? (gate.assessment.decisionId ?? '') : '')}
      onChange={(e) => setDecisionId(e.target.value)}
      hint={t('gates.decide.decisionHint')}
      data-testid="decision-select"
    >
      <option value="">{t('gates.decide.chooseDecision')}</option>
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.code} — {c.title} ({tStatus('decisionStatuses', c.status)})
        </option>
      ))}
    </SelectField>
  );
  const chosenInfo = chosen ? (
    <p className="rounded-md border border-line bg-surface-muted p-2 text-xs text-ink" data-testid="chosen-decision">
      {t('gates.decide.chosenState', { status: tStatus('decisionStatuses', chosen.status), authority: tStatus('decisionAuthorityOutcomes', chosen.authorityOutcome) })}
      {chosen.blocker ? (
        chosen.blockerI18n.length ? (
          <span className="mt-1 block text-danger" dir="auto">
            {serverText(chosen.blockerI18n, chosen.blocker)}
          </span>
        ) : (
          <span className="mt-1 block text-danger" dir="ltr" lang="en">
            {chosen.blocker}
          </span>
        )
      ) : null}
    </p>
  ) : null;

  return (
    <>
      <div className="flex flex-wrap gap-2" data-testid="gate-actions">
        {visible.map((b) => {
          const Icon = b.icon;
          return (
            <button key={b.cmd} type="button" className={b.primary ? btn.primary : btn.secondary} onClick={() => setOpen(b.cmd)} data-testid={`gate-action-${b.cmd}`}>
              <Icon aria-hidden="true" className="size-4" />
              {b.label}
            </button>
          );
        })}
        {!canDecide && can('gates.assessment.decide') && !decided ? (
          <p className="self-center text-xs text-muted">{t('gates.actions.approverOnly', { role: tStatus('roleKeys', gate.approverRole) })}</p>
        ) : null}
      </div>

      <ConfirmCommandDialog
        open={open === 'start'}
        onClose={close}
        title={t('gates.commands.start.title', { gate: gateLabel })}
        confirmLabel={t('gates.actions.start')}
        expectedVersion={a.version}
        consequences={[t('gates.commands.start.effect'), t('gates.commands.start.parallel'), t('common.command.audited')]}
        onReload={invalidate}
        onConfirm={async ({ note }) => {
          await api(gatesRoutes.startAssessment, { params, body: { expectedVersion: a.version, ...(note ? { note } : {}) } });
          await done(t('gates.commands.start.done', { gate: gate.key }));
        }}
      />
      <ConfirmCommandDialog
        open={open === 'markReady'}
        onClose={close}
        title={t('gates.commands.markReady.title', { gate: gateLabel })}
        confirmLabel={t('gates.actions.markReady')}
        expectedVersion={a.version}
        consequences={[
          gate.evaluation.ready ? t('gates.commands.markReady.effect') : t('gates.commands.markReady.notReady', { count: gate.evaluation.blockers.length }),
          t('gates.commands.markReady.frozen'),
          t('common.command.audited'),
        ]}
        onReload={invalidate}
        onConfirm={async ({ note }) => {
          await api(gatesRoutes.markReady, { params, body: { expectedVersion: a.version, ...(note ? { note } : {}) } });
          await done(t('gates.commands.markReady.done', { gate: gate.key }));
        }}
      />
      <ConfirmCommandDialog
        open={open === 'back'}
        onClose={close}
        title={t('gates.commands.back.title', { gate: gateLabel })}
        confirmLabel={t('gates.actions.back')}
        expectedVersion={a.version}
        consequences={[t('gates.commands.back.effect'), t('common.command.audited')]}
        onReload={invalidate}
        onConfirm={async ({ note }) => {
          await api(gatesRoutes.backToAssessment, { params, body: { expectedVersion: a.version, ...(note ? { note } : {}) } });
          await done(t('gates.commands.back.done', { gate: gate.key }));
        }}
      />
      <ConfirmCommandDialog
        open={open === 'link'}
        onClose={close}
        title={t('gates.commands.link.title', { gate: gateLabel })}
        confirmLabel={t('gates.actions.link')}
        noteMode="none"
        expectedVersion={a.version}
        confirmDisabled={!decisionId}
        consequences={[t('gates.commands.link.effect'), t('gates.commands.link.blocked'), t('common.command.audited')]}
        onReload={invalidate}
        onConfirm={async () => {
          await api(gatesRoutes.linkDecision, { params, body: { expectedVersion: a.version, decisionId } });
          await done(t('gates.commands.link.done', { gate: gate.key }));
        }}
      >
        <div className="space-y-2">
          {decisionSelect}
          {chosenInfo}
        </div>
      </ConfirmCommandDialog>
      <ConfirmCommandDialog
        open={open === 'decide'}
        onClose={close}
        title={t('gates.commands.decide.title', { gate: gateLabel })}
        confirmLabel={t('gates.actions.recordDecision')}
        noteMode="required"
        noteLabel={t('gates.decide.note')}
        expectedVersion={a.version}
        danger={outcome === 'reject'}
        consequences={[
          t(`gates.commands.decide.effect.${outcome}`),
          t('gates.commands.decide.recheck'),
          t('gates.commands.decide.finalOnly'),
          t('common.command.audited'),
        ]}
        onReload={invalidate}
        onConfirm={async ({ note }) => {
          const id = decisionId || gate.assessment.decisionId || undefined;
          await api(gatesRoutes.decide, { params, body: { expectedVersion: a.version, outcome, note, ...(id ? { decisionId: id } : {}) } });
          await done(t(`gates.commands.decide.done.${outcome}`, { gate: gate.key }));
        }}
      >
        <div className="space-y-3">
          <SelectField label={t('gates.decide.outcome')} required value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} data-testid="decide-outcome">
            <option value="approve">{t('gates.decide.outcomes.approve')}</option>
            <option value="approve_with_exceptions">{t('gates.decide.outcomes.approve_with_exceptions')}</option>
            <option value="reject">{t('gates.decide.outcomes.reject')}</option>
          </SelectField>
          {decisionSelect}
          {chosenInfo}
        </div>
      </ConfirmCommandDialog>
      <ConfirmCommandDialog
        open={open === 'reopen'}
        onClose={close}
        title={t('gates.commands.reopen.title', { gate: gateLabel })}
        confirmLabel={t('gates.actions.reopen')}
        noteMode="required"
        noteLabel={t('gates.commands.reopen.reason')}
        expectedVersion={a.version}
        danger
        consequences={[
          t('gates.commands.reopen.effect', { cycle: a.cycle + 1 }),
          t('gates.commands.reopen.preserved', { cycle: a.cycle }),
          t('gates.commands.reopen.newDecision'),
          t('common.command.audited'),
        ]}
        onReload={invalidate}
        onConfirm={async ({ note }) => {
          await api(gatesRoutes.reopen, { params, body: { expectedVersion: a.version, reason: note, ...(reset.length ? { resetCriterionIds: reset } : {}) } });
          await done(t('gates.commands.reopen.done', { gate: gate.key, cycle: a.cycle + 1 }));
        }}
      >
        <fieldset>
          <legend className="text-sm font-medium text-ink">
            {t('gates.commands.reopen.resetTitle')} <span className="font-normal text-muted">({t('common.optional')})</span>
          </legend>
          <p className="mt-1 text-xs text-muted">{t('gates.commands.reopen.resetHint')}</p>
          <ul className="mt-2 grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
            {gate.criteria.map((c) => (
              <li key={c.id}>
                <label className="flex min-h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={reset.includes(c.id)}
                    onChange={(e) => setReset((xs) => (e.target.checked ? [...xs, c.id] : xs.filter((x) => x !== c.id)))}
                  />
                  <span dir="ltr">{c.key}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </ConfirmCommandDialog>
    </>
  );
}
