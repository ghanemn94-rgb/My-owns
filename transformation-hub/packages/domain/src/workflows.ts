import { ruleViolation } from './errors';
import type {
  DecisionStatus,
  TaskStatus,
  TsaStatus,
  PartnerStage,
  ActionItemStatus,
  ChangeRequestStatus,
  ConditionStatus,
  DeliverableStatus,
  UpdateStatus,
  ClosingStatus,
  GateAssessmentStatus,
  TransferStatus,
  DdReleaseStatus,
  AiProposalStatus,
  BaselineStatus,
  MilestoneStatus,
} from './enums';

/**
 * Explicit state machines. The API executes *commands*; each command lists the states it may start from and
 * the resulting state. Anything else is a rule violation (HTTP 422). Guards that need data (quorum, evidence,
 * authority…) live in the module-specific rule files and are checked by the command service before
 * `transition()` is applied.
 */
export interface Transition<S extends string> {
  from: readonly S[];
  to: S;
  description: string;
}
export type Machine<S extends string, C extends string> = Record<C, Transition<S>>;

export function transition<S extends string, C extends string>(
  machineName: string,
  machine: Machine<S, C>,
  current: S,
  command: C,
): S {
  const t = machine[command];
  if (!t) throw ruleViolation(`${machineName}.unknown_command`, `Unknown command ${command}`);
  if (!t.from.includes(current)) {
    throw ruleViolation(
      `${machineName}.invalid_transition`,
      `Cannot ${command} a ${machineName} in state "${current}" (allowed from: ${t.from.join(', ')})`,
      { current, command, allowedFrom: t.from },
    );
  }
  return t.to;
}

export function allowedCommands<S extends string, C extends string>(machine: Machine<S, C>, current: S): C[] {
  return (Object.keys(machine) as C[]).filter((c) => machine[c].from.includes(current));
}

// Decision lifecycle (spec §4.2). Approval ≠ implementation.
export type DecisionCommand =
  | 'submit'
  | 'return_to_draft'
  | 'start_review'
  | 'record_recommendation'
  | 'record_approval'
  | 'record_rejection'
  | 'defer'
  | 'resume'
  | 'supersede'
  | 'start_implementation'
  | 'verify_implementation';

export const DECISION_MACHINE: Machine<DecisionStatus, DecisionCommand> = {
  submit: { from: ['draft'], to: 'submitted', description: 'Requester submits the decision paper' },
  return_to_draft: { from: ['submitted', 'under_review'], to: 'draft', description: 'Secretariat returns paper for rework' },
  start_review: { from: ['submitted'], to: 'under_review', description: 'Secretariat accepts the paper onto an agenda / circulation' },
  record_recommendation: {
    from: ['under_review'],
    to: 'recommended',
    description: 'Committee supports it but the matter exceeds delegated authority — pending external authority',
  },
  record_approval: {
    from: ['under_review', 'recommended'],
    to: 'approved',
    description:
      'Approved within mandate (vote/circulation) or by the external authority for a recommendation — guarded by governance.assertApprovalAllowed',
  },
  record_rejection: { from: ['under_review', 'recommended'], to: 'rejected', description: 'Rejected' },
  defer: { from: ['submitted', 'under_review', 'recommended'], to: 'deferred', description: 'Deferred' },
  resume: { from: ['deferred'], to: 'under_review', description: 'Deferred item brought back for review' },
  supersede: {
    from: ['approved', 'recommended', 'deferred', 'implementation_pending', 'rejected'],
    to: 'superseded',
    description: 'Replaced by a later decision (link required)',
  },
  start_implementation: { from: ['approved'], to: 'implementation_pending', description: 'Implementation tracking begins' },
  verify_implementation: {
    from: ['implementation_pending'],
    to: 'implemented_verified',
    description: 'Implementation verified with evidence',
  },
};

export type TaskCommand = 'activate' | 'start' | 'block' | 'unblock' | 'submit_for_acceptance' | 'accept' | 'reject_acceptance' | 'complete' | 'cancel' | 'reopen';
export const TASK_MACHINE: Machine<TaskStatus, TaskCommand> = {
  activate: { from: ['draft'], to: 'not_started', description: 'Proposed activity confirmed into the plan' },
  start: { from: ['not_started'], to: 'in_progress', description: 'Work started' },
  block: { from: ['not_started', 'in_progress'], to: 'blocked', description: 'Blocked' },
  unblock: { from: ['blocked'], to: 'in_progress', description: 'Unblocked' },
  submit_for_acceptance: { from: ['in_progress'], to: 'submitted_for_acceptance', description: 'Submitted for acceptance' },
  accept: { from: ['submitted_for_acceptance'], to: 'accepted', description: 'Accepted by approver with evidence' },
  reject_acceptance: { from: ['submitted_for_acceptance'], to: 'in_progress', description: 'Returned by approver' },
  complete: { from: ['in_progress'], to: 'done', description: 'Completed (only for tasks that do not require acceptance)' },
  cancel: { from: ['draft', 'not_started', 'in_progress', 'blocked'], to: 'cancelled', description: 'Cancelled (excluded from progress, not counted complete)' },
  reopen: { from: ['done', 'accepted', 'cancelled'], to: 'in_progress', description: 'Reopened' },
};

export type MilestoneCommand = 'flag_at_risk' | 'clear_risk' | 'report_achieved' | 'verify_achieved' | 'reject_evidence' | 'mark_missed' | 'cancel';
export const MILESTONE_MACHINE: Machine<MilestoneStatus, MilestoneCommand> = {
  flag_at_risk: { from: ['planned'], to: 'at_risk', description: 'At risk' },
  clear_risk: { from: ['at_risk'], to: 'planned', description: 'Risk cleared' },
  report_achieved: { from: ['planned', 'at_risk', 'missed'], to: 'achieved_pending_evidence', description: 'Reported achieved' },
  verify_achieved: { from: ['achieved_pending_evidence'], to: 'achieved_verified', description: 'Verified with evidence' },
  reject_evidence: { from: ['achieved_pending_evidence', 'achieved_verified'], to: 'at_risk', description: 'Evidence rejected / found defective' },
  mark_missed: { from: ['planned', 'at_risk'], to: 'missed', description: 'Missed' },
  cancel: { from: ['planned', 'at_risk', 'missed'], to: 'cancelled', description: 'Cancelled' },
};

export type DeliverableCommand = 'start' | 'submit' | 'accept' | 'reject' | 'cancel' | 'reopen';
export const DELIVERABLE_MACHINE: Machine<DeliverableStatus, DeliverableCommand> = {
  start: { from: ['planned'], to: 'in_progress', description: 'Started' },
  submit: { from: ['in_progress', 'rejected'], to: 'submitted', description: 'Submitted for acceptance' },
  accept: { from: ['submitted'], to: 'accepted', description: 'Accepted' },
  reject: { from: ['submitted'], to: 'rejected', description: 'Rejected' },
  cancel: { from: ['planned', 'in_progress', 'rejected'], to: 'cancelled', description: 'Cancelled' },
  reopen: { from: ['accepted', 'cancelled'], to: 'in_progress', description: 'Reopened (defective evidence)' },
};

export type ActionCommand = 'start' | 'report_done' | 'verify_closure' | 'reject_closure' | 'cancel';
export const ACTION_ITEM_MACHINE: Machine<ActionItemStatus, ActionCommand> = {
  start: { from: ['open'], to: 'in_progress', description: 'Started' },
  report_done: { from: ['open', 'in_progress'], to: 'done_pending_verification', description: 'Owner reports done with closure evidence' },
  verify_closure: { from: ['done_pending_verification'], to: 'verified_closed', description: 'Closure verified by a different person' },
  reject_closure: { from: ['done_pending_verification'], to: 'in_progress', description: 'Closure evidence insufficient' },
  cancel: { from: ['open', 'in_progress'], to: 'cancelled', description: 'Cancelled' },
};

export type ChangeRequestCommand = 'submit' | 'start_review' | 'approve' | 'reject' | 'withdraw' | 'mark_implemented';
export const CHANGE_REQUEST_MACHINE: Machine<ChangeRequestStatus, ChangeRequestCommand> = {
  submit: { from: ['draft'], to: 'submitted', description: 'Submitted' },
  start_review: { from: ['submitted'], to: 'under_review', description: 'Under review' },
  approve: { from: ['under_review'], to: 'approved', description: 'Approved' },
  reject: { from: ['under_review'], to: 'rejected', description: 'Rejected' },
  withdraw: { from: ['draft', 'submitted', 'under_review'], to: 'withdrawn', description: 'Withdrawn' },
  mark_implemented: { from: ['approved'], to: 'implemented', description: 'Implemented (e.g. rebaselined)' },
};

export type BaselineCommand = 'propose' | 'approve' | 'reject' | 'supersede';
export const BASELINE_MACHINE: Machine<BaselineStatus, BaselineCommand> = {
  propose: { from: ['draft'], to: 'proposed', description: 'Proposed for approval' },
  approve: { from: ['proposed'], to: 'approved', description: 'Approved' },
  reject: { from: ['proposed'], to: 'rejected', description: 'Rejected' },
  supersede: { from: ['approved'], to: 'superseded', description: 'Superseded by a newer approved baseline' },
};

export type UpdateCommand = 'submit' | 'return' | 'accept';
export const STATUS_UPDATE_MACHINE: Machine<UpdateStatus, UpdateCommand> = {
  submit: { from: ['draft', 'returned'], to: 'submitted', description: 'Submitted' },
  return: { from: ['submitted'], to: 'returned', description: 'Returned for rework' },
  accept: { from: ['submitted'], to: 'accepted', description: 'Accepted (frozen)' },
};

/** Reopen is NOT a transition: a new assessment row is created in status `reopened` (see gates.ts planReopen). */
export type GateCommand = 'start_assessment' | 'mark_ready' | 'approve' | 'approve_with_exceptions' | 'reject' | 'back_to_assessment';
export const GATE_ASSESSMENT_MACHINE: Machine<GateAssessmentStatus, GateCommand> = {
  start_assessment: { from: ['not_started', 'reopened'], to: 'in_assessment', description: 'Assessment started' },
  mark_ready: { from: ['in_assessment'], to: 'ready_for_decision', description: 'All mandatory criteria met/waived — ready for decision' },
  back_to_assessment: { from: ['ready_for_decision'], to: 'in_assessment', description: 'Criteria changed; back to assessment' },
  approve: { from: ['ready_for_decision'], to: 'approved', description: 'Gate approved' },
  approve_with_exceptions: { from: ['ready_for_decision'], to: 'approved_with_exceptions', description: 'Approved with recorded waivers' },
  reject: { from: ['ready_for_decision', 'in_assessment'], to: 'rejected', description: 'Gate rejected' },
};

// TSA (spec §7.3). End date ≠ exit. No automatic extension.
export type TsaCommand =
  | 'start_negotiation'
  | 'approve'
  | 'activate'
  | 'start_exit'
  | 'accept_exit'
  | 'record_extension'
  | 'record_breach'
  | 'remedy_breach'
  | 'mark_expired_unresolved';
export const TSA_MACHINE: Machine<TsaStatus, TsaCommand> = {
  start_negotiation: { from: ['proposed'], to: 'negotiating', description: 'Negotiation started' },
  approve: { from: ['negotiating'], to: 'approved', description: 'Terms approved' },
  activate: { from: ['approved'], to: 'active', description: 'Service active' },
  start_exit: { from: ['active', 'extended'], to: 'exit_in_progress', description: 'Exit plan executing' },
  accept_exit: {
    from: ['exit_in_progress', 'expired_unresolved'],
    to: 'exit_accepted',
    description: 'Exit accepted — replacement service accepted with evidence',
  },
  record_extension: {
    // `extended` included: a further extension needs its own approved decision (the guard runs on every extension).
    from: ['active', 'extended', 'exit_in_progress', 'expired_unresolved', 'breached'],
    to: 'extended',
    description: 'Extension recorded ONLY with an approved decision (guard: assertTsaExtensionAllowed); never automatic',
  },
  record_breach: { from: ['active', 'extended', 'exit_in_progress'], to: 'breached', description: 'SLA/contract breach recorded' },
  remedy_breach: { from: ['breached'], to: 'active', description: 'Breach remedied' },
  mark_expired_unresolved: {
    // `approved` included (P0 review D-25): an approved TSA whose end date passes without an exit is not "ok".
    from: ['approved', 'active', 'extended', 'exit_in_progress', 'breached'],
    to: 'expired_unresolved',
    description: 'End date passed without accepted exit — escalation required',
  },
};

// Partner engagement (spec §8). Stages are ordered; NDA does not grant materials access.
export type PartnerCommand =
  | 'approve_contact'
  | 'record_nda_executed'
  | 'open_materials_access'
  | 'start_dd'
  | 'record_proposal'
  | 'start_negotiation'
  | 'move_to_signing'
  | 'move_to_closing'
  | 'withdraw';
export const PARTNER_MACHINE: Machine<PartnerStage, PartnerCommand> = {
  approve_contact: { from: ['identified'], to: 'approved_for_contact', description: 'Outreach approved' },
  record_nda_executed: { from: ['approved_for_contact'], to: 'nda', description: 'NDA executed (grants no document access by itself)' },
  open_materials_access: { from: ['nda'], to: 'materials_access', description: 'Materials access approved (explicit room grants still required)' },
  start_dd: { from: ['materials_access'], to: 'dd', description: 'Due diligence started' },
  // REQ-JV-003: stages are never skipped (a proposal is recorded after due diligence has started).
  record_proposal: { from: ['dd'], to: 'proposal', description: 'Proposal received' },
  start_negotiation: { from: ['proposal'], to: 'negotiation', description: 'Negotiation' },
  move_to_signing: { from: ['negotiation'], to: 'signing', description: 'Signing preparation' },
  move_to_closing: { from: ['signing'], to: 'closing', description: 'Signed — closing preparation' },
  withdraw: {
    from: ['identified', 'approved_for_contact', 'nda', 'materials_access', 'dd', 'proposal', 'negotiation', 'signing'],
    to: 'withdrawn',
    description: 'Withdrawn',
  },
};

export type ConditionCommand = 'submit_evidence' | 'verify' | 'reject_evidence' | 'waive' | 'mark_failed' | 'mark_lapsed' | 'reopen' | 'extend_long_stop';
export const CONDITION_MACHINE: Machine<ConditionStatus, ConditionCommand> = {
  submit_evidence: { from: ['open'], to: 'evidence_submitted', description: 'Evidence submitted' },
  verify: { from: ['evidence_submitted'], to: 'verified', description: 'Verified by authorized reviewer' },
  reject_evidence: { from: ['evidence_submitted'], to: 'open', description: 'Evidence rejected' },
  waive: { from: ['open', 'evidence_submitted'], to: 'waived', description: 'Waived by the authorized party (waivable conditions only)' },
  mark_failed: { from: ['open', 'evidence_submitted'], to: 'failed', description: 'Failed' },
  mark_lapsed: { from: ['open', 'evidence_submitted'], to: 'lapsed', description: 'Long-stop date passed' },
  reopen: { from: ['verified', 'waived'], to: 'open', description: 'Reopened (defective evidence)' },
  extend_long_stop: { from: ['lapsed'], to: 'open', description: 'Long-stop date extended on an approved decision (DOM-P4-04) — the condition is open again' },
};

export type ClosingCommand = 'start_preparation' | 'mark_ready' | 'confirm' | 'abort' | 'back_to_preparation';
export const CLOSING_MACHINE: Machine<ClosingStatus, ClosingCommand> = {
  start_preparation: { from: ['planned'], to: 'in_preparation', description: 'Preparation started' },
  mark_ready: { from: ['in_preparation'], to: 'ready_for_confirmation', description: 'All blocking conditions/deliverables satisfied' },
  back_to_preparation: { from: ['ready_for_confirmation'], to: 'in_preparation', description: 'Conditions changed' },
  confirm: { from: ['ready_for_confirmation'], to: 'confirmed', description: 'Authorized confirmation recorded' },
  abort: { from: ['planned', 'in_preparation', 'ready_for_confirmation'], to: 'aborted', description: 'Aborted' },
};

export type TransferCommand = 'plan' | 'start' | 'report_transferred' | 'verify' | 'reject_evidence' | 'block' | 'unblock' | 'mark_not_applicable';
export const TRANSFER_MACHINE: Machine<TransferStatus, TransferCommand> = {
  plan: { from: ['not_started'], to: 'planned', description: 'Transfer mechanism and date planned' },
  start: { from: ['planned'], to: 'in_progress', description: 'Transfer in progress' },
  report_transferred: { from: ['in_progress'], to: 'transferred_pending_evidence', description: 'Reported transferred' },
  verify: { from: ['transferred_pending_evidence'], to: 'transferred_verified', description: 'Transfer verified with evidence' },
  reject_evidence: { from: ['transferred_pending_evidence', 'transferred_verified'], to: 'in_progress', description: 'Evidence rejected' },
  block: { from: ['not_started', 'planned', 'in_progress'], to: 'blocked', description: 'Blocked' },
  unblock: { from: ['blocked'], to: 'planned', description: 'Unblocked' },
  mark_not_applicable: { from: ['not_started', 'planned'], to: 'not_applicable', description: 'Not transferring (excluded/retained)' },
};

export type DdReleaseCommand = 'submit_for_review' | 'approve_release' | 'release' | 'withhold' | 'return_to_draft';
export const DD_RELEASE_MACHINE: Machine<DdReleaseStatus, DdReleaseCommand> = {
  submit_for_review: { from: ['draft'], to: 'in_review', description: 'Answer submitted for review' },
  approve_release: { from: ['in_review'], to: 'approved_for_release', description: 'Release approved' },
  release: { from: ['approved_for_release'], to: 'released', description: 'Released to the partner room' },
  withhold: { from: ['in_review', 'approved_for_release'], to: 'withheld', description: 'Withheld' },
  return_to_draft: { from: ['in_review', 'withheld'], to: 'draft', description: 'Returned to draft' },
};

export type AiProposalCommand = 'approve' | 'reject' | 'invalidate' | 'start_execution' | 'mark_executed' | 'mark_failed' | 'expire' | 'cancel';
export const AI_PROPOSAL_MACHINE: Machine<AiProposalStatus, AiProposalCommand> = {
  approve: { from: ['proposed'], to: 'approved', description: 'Approved (bound to payload hash + target version)' },
  reject: { from: ['proposed'], to: 'rejected', description: 'Rejected' },
  invalidate: { from: ['proposed', 'approved'], to: 'invalidated', description: 'Payload/target changed — approval invalid' },
  start_execution: { from: ['approved'], to: 'executing', description: 'Execution started' },
  mark_executed: { from: ['executing'], to: 'executed', description: 'Executed' },
  mark_failed: { from: ['executing'], to: 'failed', description: 'Failed' },
  expire: { from: ['proposed', 'approved'], to: 'expired', description: 'Approval window expired' },
  cancel: { from: ['proposed', 'approved'], to: 'cancelled', description: 'Cancelled (e.g. kill switch)' },
};
