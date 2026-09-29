'use client';

import { planningRoutes as P } from '@hub/contracts';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { localToday, type ChangeRequest, type Deliverable, type Milestone, type RaidItem, type RaidKindPath, type StatusUpdate, type Task } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import type { CommandSpec } from './CommandBar';

const opt = (s: string) => (s ? s : undefined);

/** Task lifecycle (TASK_MACHINE) — reported vs evidence-verified progress; acceptance by someone other than the submitter. */
export function useTaskCommands(task: Task | undefined): CommandSpec[] {
  const { t } = useI18n();
  const { projectId, me } = useProjectContext();
  if (!task) return [];
  const params = { projectId, taskId: task.id };
  const mine = task.submittedBy === me.user.id;
  const today = localToday();
  return [
    { key: 'activate', label: t('planning.commands.task.activate'), effects: [t('planning.commands.task.activateEffect')], permission: 'planning.task.manage', noteMode: 'optional', primary: true, run: ({ note, expectedVersion }) => api(P.activateTask, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'start', label: t('planning.commands.task.start'), effects: [t('planning.commands.task.startEffect')], permission: 'planning.task.update_progress', noteMode: 'optional', primary: true, extra: { kind: 'date', label: t('planning.task.actualStart'), required: false, defaultValue: today }, run: ({ note, expectedVersion, extra }) => api(P.startTask, { params, body: { expectedVersion, note: opt(note), actualStart: opt(extra) } }) },
    { key: 'block', label: t('planning.commands.task.block'), effects: [t('planning.commands.task.blockEffect')], permission: 'planning.task.update_progress', noteMode: 'required', noteLabel: t('planning.common.reason'), run: ({ note, expectedVersion }) => api(P.blockTask, { params, body: { expectedVersion, reason: note } }) },
    { key: 'unblock', label: t('planning.commands.task.unblock'), effects: [t('planning.commands.task.unblockEffect')], permission: 'planning.task.update_progress', noteMode: 'optional', run: ({ note, expectedVersion }) => api(P.unblockTask, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'submit_for_acceptance', label: t('planning.commands.task.submit'), effects: [t('planning.commands.task.submitEffect')], permission: 'planning.task.update_progress', noteMode: 'optional', primary: true, run: ({ note, expectedVersion }) => api(P.submitTaskForAcceptance, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'accept', label: t('planning.commands.task.accept'), effects: [t('planning.commands.task.acceptEffect'), t('planning.commands.evidenceRule')], permission: 'planning.deliverable.accept', noteMode: 'optional', primary: true, hidden: mine, run: ({ note, expectedVersion }) => api(P.acceptTask, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'reject_acceptance', label: t('planning.commands.task.reject'), effects: [t('planning.commands.task.rejectEffect')], permission: 'planning.deliverable.accept', noteMode: 'required', noteLabel: t('planning.common.reason'), hidden: mine, run: ({ note, expectedVersion }) => api(P.rejectTaskAcceptance, { params, body: { expectedVersion, reason: note } }) },
    { key: 'complete', label: t('planning.commands.task.complete'), effects: [t('planning.commands.task.completeEffect')], permission: 'planning.task.update_progress', noteMode: 'optional', primary: true, extra: { kind: 'date', label: t('planning.task.actualFinish'), required: false, defaultValue: today }, run: ({ note, expectedVersion, extra }) => api(P.completeTask, { params, body: { expectedVersion, note: opt(note), actualFinish: opt(extra) } }) },
    { key: 'cancel', label: t('planning.commands.task.cancel'), effects: [t('planning.commands.task.cancelEffect')], permission: 'planning.task.manage', noteMode: 'required', noteLabel: t('planning.common.reason'), danger: true, run: ({ note, expectedVersion }) => api(P.cancelTask, { params, body: { expectedVersion, reason: note } }) },
    { key: 'reopen', label: t('planning.commands.task.reopen'), effects: [t('planning.commands.task.reopenEffect')], permission: 'planning.task.manage', noteMode: 'required', noteLabel: t('planning.common.reason'), run: ({ note, expectedVersion }) => api(P.reopenTask, { params, body: { expectedVersion, reason: note } }) },
  ];
}

export function useMilestoneCommands(m: Milestone | undefined): CommandSpec[] {
  const { t } = useI18n();
  const { projectId, me } = useProjectContext();
  if (!m) return [];
  const params = { projectId, milestoneId: m.id };
  const mine = m.reportedBy === me.user.id;
  return [
    { key: 'report_achieved', label: t('planning.commands.milestone.report'), effects: [t('planning.commands.milestone.reportEffect')], permission: 'planning.task.update_progress', noteMode: 'optional', primary: true, extra: { kind: 'date', label: t('planning.milestone.actualDate'), required: true, defaultValue: localToday() }, run: ({ note, expectedVersion, extra }) => api(P.reportMilestoneAchieved, { params, body: { expectedVersion, note: opt(note), actualDate: extra } }) },
    { key: 'verify_achieved', label: t('planning.commands.milestone.verify'), effects: [t('planning.commands.milestone.verifyEffect'), t('planning.commands.evidenceRule')], permission: 'planning.deliverable.accept', noteMode: 'optional', primary: true, hidden: mine, run: ({ note, expectedVersion }) => api(P.verifyMilestoneAchieved, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'reject_evidence', label: t('planning.commands.milestone.rejectEvidence'), effects: [t('planning.commands.milestone.rejectEvidenceEffect')], permission: 'planning.deliverable.accept', noteMode: 'required', noteLabel: t('planning.common.reason'), hidden: mine, run: ({ note, expectedVersion }) => api(P.rejectMilestoneEvidence, { params, body: { expectedVersion, reason: note } }) },
    { key: 'flag_at_risk', label: t('planning.commands.milestone.flag'), effects: [t('planning.commands.milestone.flagEffect')], permission: 'planning.task.update_progress', noteMode: 'required', noteLabel: t('planning.common.reason'), run: ({ note, expectedVersion }) => api(P.flagMilestoneAtRisk, { params, body: { expectedVersion, reason: note } }) },
    { key: 'clear_risk', label: t('planning.commands.milestone.clear'), effects: [t('planning.commands.milestone.clearEffect')], permission: 'planning.task.update_progress', noteMode: 'optional', run: ({ note, expectedVersion }) => api(P.clearMilestoneRisk, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'mark_missed', label: t('planning.commands.milestone.missed'), effects: [t('planning.commands.milestone.missedEffect')], permission: 'planning.wbs.manage', noteMode: 'required', noteLabel: t('planning.common.reason'), danger: true, run: ({ note, expectedVersion }) => api(P.markMilestoneMissed, { params, body: { expectedVersion, reason: note } }) },
    { key: 'cancel', label: t('planning.commands.milestone.cancel'), effects: [t('planning.commands.milestone.cancelEffect')], permission: 'planning.wbs.manage', noteMode: 'required', noteLabel: t('planning.common.reason'), danger: true, run: ({ note, expectedVersion }) => api(P.cancelMilestone, { params, body: { expectedVersion, reason: note } }) },
  ];
}

export function useDeliverableCommands(d: Deliverable | undefined): CommandSpec[] {
  const { t } = useI18n();
  const { projectId, me } = useProjectContext();
  if (!d) return [];
  const params = { projectId, deliverableId: d.id };
  const mine = d.submittedBy === me.user.id;
  return [
    { key: 'start', label: t('planning.commands.deliverable.start'), effects: [t('planning.commands.deliverable.startEffect')], permission: 'planning.task.update_progress', noteMode: 'optional', primary: true, run: ({ note, expectedVersion }) => api(P.startDeliverable, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'submit', label: t('planning.commands.deliverable.submit'), effects: [t('planning.commands.deliverable.submitEffect')], permission: 'planning.task.update_progress', noteMode: 'optional', primary: true, run: ({ note, expectedVersion }) => api(P.submitDeliverable, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'accept', label: t('planning.commands.deliverable.accept'), effects: [t('planning.commands.deliverable.acceptEffect'), t('planning.commands.evidenceRule')], permission: 'planning.deliverable.accept', noteMode: 'optional', primary: true, hidden: mine, run: ({ note, expectedVersion }) => api(P.acceptDeliverable, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'reject', label: t('planning.commands.deliverable.reject'), effects: [t('planning.commands.deliverable.rejectEffect')], permission: 'planning.deliverable.accept', noteMode: 'required', noteLabel: t('planning.common.reason'), hidden: mine, run: ({ note, expectedVersion }) => api(P.rejectDeliverable, { params, body: { expectedVersion, reason: note } }) },
    { key: 'cancel', label: t('planning.commands.deliverable.cancel'), effects: [t('planning.commands.deliverable.cancelEffect')], permission: 'planning.wbs.manage', noteMode: 'required', noteLabel: t('planning.common.reason'), danger: true, run: ({ note, expectedVersion }) => api(P.cancelDeliverable, { params, body: { expectedVersion, reason: note } }) },
    { key: 'reopen', label: t('planning.commands.deliverable.reopen'), effects: [t('planning.commands.deliverable.reopenEffect')], permission: 'planning.wbs.manage', noteMode: 'required', noteLabel: t('planning.common.reason'), run: ({ note, expectedVersion }) => api(P.reopenDeliverable, { params, body: { expectedVersion, reason: note } }) },
  ];
}

export function useRaidCommands(kind: RaidKindPath, item: RaidItem | undefined): CommandSpec[] {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  if (!item) return [];
  const params = { projectId, kind, itemId: item.id };
  const perm = 'planning.raid.manage';
  return [
    { key: 'monitor', label: t('planning.commands.raid.monitor'), effects: [t('planning.commands.raid.monitorEffect')], permission: perm, noteMode: 'optional', run: ({ note, expectedVersion }) => api(P.monitorRaid, { params, body: { expectedVersion, note: opt(note) } }) },
    {
      key: 'escalate',
      label: t('planning.commands.raid.escalate'),
      effects: [t('planning.commands.raid.escalateEffect', { level: item.escalationLevel })],
      permission: perm,
      noteMode: 'required',
      noteLabel: t('planning.common.reason'),
      primary: true,
      extra: { kind: 'number', label: t('planning.raid.escalationLevel'), required: true, min: item.escalationLevel + 1, max: 3, defaultValue: String(Math.min(3, item.escalationLevel + 1)) },
      run: ({ note, expectedVersion, extra }) => api(P.escalateRaid, { params, body: { expectedVersion, reason: note, level: Number(extra) } }),
    },
    { key: 'mitigate', label: t('planning.commands.raid.mitigate'), effects: [t('planning.commands.raid.mitigateEffect')], permission: perm, noteMode: 'optional', run: ({ note, expectedVersion }) => api(P.mitigateRaid, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'close', label: t('planning.commands.raid.close'), effects: [t('planning.commands.raid.closeEffect')], permission: perm, noteMode: 'required', noteLabel: t('planning.common.reason'), run: ({ note, expectedVersion }) => api(P.closeRaid, { params, body: { expectedVersion, reason: note } }) },
    { key: 'cancel', label: t('planning.commands.raid.cancel'), effects: [t('planning.commands.raid.cancelEffect')], permission: perm, noteMode: 'required', noteLabel: t('planning.common.reason'), danger: true, run: ({ note, expectedVersion }) => api(P.cancelRaid, { params, body: { expectedVersion, reason: note } }) },
    { key: 'reopen', label: t('planning.commands.raid.reopen'), effects: [t('planning.commands.raid.reopenEffect')], permission: perm, noteMode: 'required', noteLabel: t('planning.common.reason'), run: ({ note, expectedVersion }) => api(P.reopenRaid, { params, body: { expectedVersion, reason: note } }) },
  ];
}

export function useChangeRequestCommands(cr: ChangeRequest | undefined): CommandSpec[] {
  const { t } = useI18n();
  const { projectId, me } = useProjectContext();
  if (!cr) return [];
  const params = { projectId, changeRequestId: cr.id };
  const mine = cr.requestedBy === me.user.id;
  return [
    { key: 'submit', label: t('planning.commands.cr.submit'), effects: [t('planning.commands.cr.submitEffect')], permission: 'planning.change_request.create', noteMode: 'optional', primary: true, run: ({ note, expectedVersion }) => api(P.submitChangeRequest, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'start_review', label: t('planning.commands.cr.startReview'), effects: [t('planning.commands.cr.startReviewEffect')], permission: 'planning.change_request.assess', noteMode: 'optional', primary: true, run: ({ note, expectedVersion }) => api(P.startChangeRequestReview, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'approve', label: t('planning.commands.cr.approve'), effects: [t('planning.commands.cr.approveEffect'), t('planning.commands.notSelf')], permission: 'planning.change_request.approve', noteMode: 'optional', primary: true, hidden: mine, run: ({ note, expectedVersion }) => api(P.approveChangeRequest, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'reject', label: t('planning.commands.cr.reject'), effects: [t('planning.commands.cr.rejectEffect')], permission: 'planning.change_request.approve', noteMode: 'required', noteLabel: t('planning.common.reason'), danger: true, hidden: mine, run: ({ note, expectedVersion }) => api(P.rejectChangeRequest, { params, body: { expectedVersion, reason: note } }) },
    { key: 'withdraw', label: t('planning.commands.cr.withdraw'), effects: [t('planning.commands.cr.withdrawEffect')], permission: 'planning.change_request.create', noteMode: 'required', noteLabel: t('planning.common.reason'), danger: true, run: ({ note, expectedVersion }) => api(P.withdrawChangeRequest, { params, body: { expectedVersion, reason: note } }) },
    { key: 'mark_implemented', label: t('planning.commands.cr.implement'), effects: [t(cr.rebaseline ? 'planning.commands.cr.implementRebaseline' : 'planning.commands.cr.implementEffect')], permission: 'planning.change_request.assess', noteMode: 'optional', run: ({ note, expectedVersion }) => api(P.implementChangeRequest, { params, body: { expectedVersion, note: opt(note) } }) },
  ];
}

export function useStatusUpdateCommands(u: StatusUpdate | undefined): CommandSpec[] {
  const { t } = useI18n();
  const { projectId, me } = useProjectContext();
  if (!u) return [];
  const params = { projectId, statusUpdateId: u.id };
  const mine = u.submittedBy === me.user.id;
  return [
    { key: 'submit', label: t('planning.commands.update.submit'), effects: [t('planning.commands.update.submitEffect')], permission: 'planning.status_update.submit', noteMode: 'optional', primary: true, run: ({ note, expectedVersion }) => api(P.submitStatusUpdate, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'accept', label: t('planning.commands.update.accept'), effects: [t('planning.commands.update.acceptEffect'), t('planning.commands.notSelf')], permission: 'planning.status_update.review', noteMode: 'optional', primary: true, hidden: mine, run: ({ note, expectedVersion }) => api(P.acceptStatusUpdate, { params, body: { expectedVersion, note: opt(note) } }) },
    { key: 'return', label: t('planning.commands.update.return'), effects: [t('planning.commands.update.returnEffect')], permission: 'planning.status_update.review', noteMode: 'required', noteLabel: t('planning.common.reason'), hidden: mine, run: ({ note, expectedVersion }) => api(P.returnStatusUpdate, { params, body: { expectedVersion, reason: note } }) },
  ];
}
