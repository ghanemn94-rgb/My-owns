import { forbidden, ruleViolation } from './errors';
import { CUTOVER_STATUSES, READINESS_AREAS } from './enums';
import type { DecisionAuthorityOutcome, DecisionStatus, ReadinessArea, ReadinessStatus, RoleKey, TsaStatus } from './enums';
import { FINAL_APPROVED_DECISION_STATUSES } from './gates';
import { TSA_MACHINE } from './workflows';
import type { Machine } from './workflows';
import { goDecisionBlockers, missingCutoverPrerequisites } from './carveout';
import type { CutoverPrerequisites, TsaExpiryAssessment } from './carveout';

/**
 * Day-1 readiness, cutover / go-no-go and TSA rules (spec §7.3, §7.4; AT-09, AT-10; REQ-RDY-*, REQ-TSA-*).
 * Pure functions only — the readiness module's command services call them before writing.
 * The existing primitives (`goDecisionBlockers`, `assertGoAllowed`, `assertReadinessWaiverAllowed`, `assessTsaExpiry`,
 * `assertTsaExtensionAllowed`, `assertTsaExitAcceptable`) live in `carveout.ts`.
 */

export type CutoverStatus = (typeof CUTOVER_STATUSES)[number];

/** Areas a Day-1 checklist must cover (§7.4; `other` is a catch-all, not a required domain). REQ-RDY-002. */
export const DAY1_READINESS_AREAS: readonly ReadinessArea[] = READINESS_AREAS.filter((a) => a !== 'other');

/** Required Day-1 areas that the given checklist does not cover. */
export function uncoveredReadinessAreas(areas: readonly string[]): ReadinessArea[] {
  const have = new Set(areas);
  return DAY1_READINESS_AREAS.filter((a) => !have.has(a));
}

// ---------------------------------------------------------------------------------------------------------
// Readiness check lifecycle

export type ReadinessCheckCommand = 'record_pass' | 'record_fail' | 'sign_off' | 'determine_not_applicable' | 'apply_waiver' | 'reopen';

export const READINESS_CHECK_MACHINE: Machine<ReadinessStatus, ReadinessCheckCommand> = {
  record_pass: { from: ['not_started', 'in_progress', 'failed'], to: 'in_progress', description: 'Passing test recorded — awaits the specialist sign-off' },
  record_fail: { from: ['not_started', 'in_progress', 'failed', 'passed'], to: 'failed', description: 'Failing test recorded — a failed blocker blocks GO (AT-09); an earlier sign-off no longer counts' },
  sign_off: { from: ['not_started', 'in_progress'], to: 'passed', description: 'Specialist sign-off with evidence (REQ-RDY-001)' },
  determine_not_applicable: { from: ['not_started', 'in_progress', 'failed'], to: 'not_applicable', description: 'Specialist determination that the check does not apply (documented basis)' },
  apply_waiver: { from: ['not_started', 'in_progress', 'failed'], to: 'waived', description: 'Approved waiver applied (waivable checks only, via the waiver register)' },
  reopen: { from: ['passed', 'not_applicable', 'waived'], to: 'in_progress', description: 'Specialist reopens a cleared check (history preserved)' },
};

/**
 * Status after a recorded test run. The run itself is always appended (a failed test stays visible after a later pass).
 * A passing test never signs a check off — the specialist does. A waived check keeps its (approved) waiver.
 */
export function statusAfterTestRun(current: ReadinessStatus, result: 'passed' | 'failed'): ReadinessStatus {
  if (current === 'not_applicable') {
    throw ruleViolation('readiness.test.not_applicable', 'The check was determined not applicable; reopen it before recording tests');
  }
  if (current === 'waived') return 'waived';
  if (current === 'passed' && result === 'passed') return 'passed';
  const cmd: ReadinessCheckCommand = result === 'passed' ? 'record_pass' : 'record_fail';
  const t = READINESS_CHECK_MACHINE[cmd];
  if (!t.from.includes(current)) {
    throw ruleViolation('readiness_check.invalid_transition', `Cannot ${cmd} a readiness check in state "${current}"`, { current, command: cmd });
  }
  return t.to;
}

/** Who may act as "the specialist role assigned to the check" (REQ-RDY-001). */
export function assertAssignedSpecialist(what: string, checkCode: string, signoffRole: RoleKey | null, actorRoles: readonly string[]) {
  if (!signoffRole) {
    throw ruleViolation('readiness.signoff.no_role', `Readiness check ${checkCode} has no assigned specialist sign-off role; ${what} is not possible until one is assigned`);
  }
  if (!actorRoles.includes(signoffRole)) {
    throw forbidden('readiness.signoff.not_assigned_role', `Only the specialist role assigned to ${checkCode} (${signoffRole}) may perform the ${what}`);
  }
}

/**
 * Specialist sign-off (REQ-RDY-001): by the assigned specialist role only, never by the record owner or by whoever
 * recorded its latest status/evidence (access-matrix §2.4). A "passed" sign-off needs active, non-conflicting evidence
 * and a latest test run that did not fail; "not applicable" needs a documented basis.
 */
export function assertReadinessSignoffAllowed(i: {
  checkCode: string;
  outcome: 'passed' | 'not_applicable';
  signoffRole: RoleKey | null;
  actorRoles: readonly string[];
  actorUserId: string;
  selfUserIds: readonly (string | null | undefined)[];
  latestTestResult: ReadinessStatus | null;
  activeEvidenceCount: number;
  conflictingEvidenceCount: number;
  note: string | null | undefined;
}): void {
  assertAssignedSpecialist('sign-off', i.checkCode, i.signoffRole, i.actorRoles);
  if (i.selfUserIds.some((u) => !!u && u === i.actorUserId)) {
    throw forbidden('readiness.signoff.self', 'Separation of duties: the owner of the check or the person who recorded its latest status/evidence cannot sign it off');
  }
  if (i.outcome === 'not_applicable') {
    if (!i.note?.trim()) throw ruleViolation('readiness.signoff.na_basis_required', 'A "not applicable" determination requires a documented basis');
    return;
  }
  if (i.latestTestResult === 'failed') {
    throw ruleViolation('readiness.signoff.latest_test_failed', `The latest test of ${i.checkCode} failed; record a passing test before sign-off`);
  }
  if (i.conflictingEvidenceCount > 0) {
    throw ruleViolation('readiness.signoff.conflicting_evidence', `${i.checkCode} has conflicting evidence; resolve it before sign-off`);
  }
  if (i.activeEvidenceCount < 1) {
    throw ruleViolation('readiness.signoff.no_evidence', `${i.checkCode} has no active evidence; Day-1 readiness is signed off on evidence`);
  }
}

/**
 * Specialist determination of a check's criticality and waivability (spec §3: "authorized specialists determine
 * waivability and waiver authority"). Waivable checks must name the waiver authority role; a basis is always recorded.
 */
export function assertReadinessDetermination(i: {
  checkCode: string;
  signoffRole: RoleKey | null;
  actorRoles: readonly string[];
  actorUserId: string;
  creatorUserId: string | null;
  waivable: boolean;
  waiverAuthorityRole: RoleKey | null;
  basis: string;
}): void {
  assertAssignedSpecialist('determination', i.checkCode, i.signoffRole, i.actorRoles);
  if (i.creatorUserId && i.creatorUserId === i.actorUserId) {
    throw forbidden('readiness.determination.self', 'Separation of duties: the author of a readiness check cannot determine its criticality/waivability');
  }
  if (i.waivable && !i.waiverAuthorityRole) {
    throw ruleViolation('readiness.determination.authority_required', 'A waivable check must name the role that holds the waiver authority');
  }
  if (!i.waivable && i.waiverAuthorityRole) {
    throw ruleViolation('readiness.determination.authority_without_waivability', 'A waiver authority role is only meaningful for a waivable check');
  }
  if (!i.basis.trim()) throw ruleViolation('readiness.determination.basis_required', 'The specialist determination requires a documented basis');
}

// ---------------------------------------------------------------------------------------------------------
// Cutover plan and go/no-go (§7.4; AT-09; REQ-RDY-003/004/005)

export type CutoverCommand = 'record_rehearsal' | 'submit_for_decision' | 'return_to_planning' | 'decide_go' | 'decide_no_go' | 'record_execution' | 'record_rollback' | 'accept';

export const CUTOVER_MACHINE: Machine<CutoverStatus, CutoverCommand> = {
  record_rehearsal: { from: ['planning', 'rehearsal'], to: 'rehearsal', description: 'Rehearsal / testing recorded' },
  submit_for_decision: { from: ['planning', 'rehearsal'], to: 'ready_for_decision', description: 'Submitted for go/no-go (all §7.4 elements documented)' },
  return_to_planning: { from: ['ready_for_decision', 'no_go', 'rolled_back'], to: 'planning', description: 'Back to planning (earlier decisions stay in the history)' },
  decide_go: { from: ['ready_for_decision'], to: 'approved_go', description: 'GO recorded — blockers and prerequisites re-evaluated on the server' },
  decide_no_go: { from: ['ready_for_decision'], to: 'no_go', description: 'NO-GO recorded' },
  record_execution: { from: ['approved_go'], to: 'executed', description: 'Transition executed in the approved operational systems (evidence recorded here; no device control)' },
  record_rollback: { from: ['approved_go', 'executed'], to: 'rolled_back', description: 'Contingency / rollback invoked' },
  accept: { from: ['executed'], to: 'accepted', description: 'Post-transition acceptance with evidence' },
};

/** Descriptive fields of a cutover plan can change only before it goes to decision (never after a GO). */
export const CUTOVER_EDITABLE_STATUSES: readonly CutoverStatus[] = ['planning', 'rehearsal'];

export interface CutoverPlanFacts {
  runbookDocumentId: string | null;
  runbookSummary: string | null;
  windowStart: Date | string | null;
  windowEnd: Date | string | null;
  serviceImpact: string | null;
  accountableUserId: string | null;
  communicationsApproved: boolean;
  testingSummary: string | null;
  rehearsalDone: boolean;
  contingencyPlan: string | null;
  rollbackPlan: string | null;
}

const filled = (s: string | null | undefined) => !!s && s.trim().length > 0;
const instant = (d: Date | string | null) => (d == null ? null : new Date(d).getTime());

/** Map a cutover plan's stored facts to the (all-required) §7.4 prerequisites. */
export function cutoverPrerequisitesOf(p: CutoverPlanFacts, hasApprovedGoDecision: boolean): CutoverPrerequisites {
  const ws = instant(p.windowStart);
  const we = instant(p.windowEnd);
  return {
    hasRunbook: !!p.runbookDocumentId || filled(p.runbookSummary),
    hasRollbackPlan: filled(p.rollbackPlan) && filled(p.contingencyPlan),
    communicationsApproved: p.communicationsApproved === true,
    hasWindow: ws !== null && we !== null && we > ws,
    hasServiceImpact: filled(p.serviceImpact),
    hasAccountableOwner: !!p.accountableUserId,
    testingDone: p.rehearsalDone === true && filled(p.testingSummary),
    hasApprovedGoDecision,
  };
}

/** REQ-RDY-003: a plan goes to go/no-go only with every §7.4 element documented (e.g. never without rollback). */
export function assertCutoverSubmittable(p: CutoverPlanFacts): void {
  const missing = missingCutoverPrerequisites(cutoverPrerequisitesOf(p, false), { includeDecision: false });
  if (missing.length) {
    throw ruleViolation('readiness.cutover.incomplete', `The cutover plan cannot be submitted for go/no-go; missing: ${missing.join(', ')}`, { missing });
  }
}

/**
 * Which readiness checks gate a cutover plan's GO: a check bound to a plan gates only that plan; a project-wide (Day-1)
 * plan (no site) is gated by every unbound check of the project; a site plan is gated by the unbound checks of its site.
 */
export function readinessCheckAppliesToPlan(check: { cutoverPlanId: string | null; siteId: string | null }, plan: { id: string; siteId: string | null }): boolean {
  if (check.cutoverPlanId) return check.cutoverPlanId === plan.id;
  if (plan.siteId === null) return true;
  return check.siteId === plan.siteId;
}

export interface GoEvaluation {
  allowed: boolean;
  blockers: ReturnType<typeof goDecisionBlockers>;
  missing: string[];
}

/** Server-side GO evaluation (the same rule `assertGoAllowed` enforces) for display before the decision. */
export function evaluateGo(checks: Parameters<typeof goDecisionBlockers>[0], prerequisites: CutoverPrerequisites): GoEvaluation {
  const blockers = goDecisionBlockers(checks);
  const missing = missingCutoverPrerequisites(prerequisites);
  return { allowed: blockers.length === 0 && missing.length === 0, blockers, missing };
}

/**
 * REQ-RDY-005: post-transition acceptance by the accountable owner — not by whoever recorded the execution — with
 * active, non-conflicting acceptance evidence and a note.
 */
export function assertPostTransitionAcceptance(i: {
  acceptorUserId: string;
  accountableUserId: string | null;
  executedBy: string | null;
  activeEvidenceCount: number;
  conflictingEvidenceCount: number;
  note: string | null | undefined;
}): void {
  if (!i.accountableUserId || i.accountableUserId !== i.acceptorUserId) {
    throw forbidden('readiness.acceptance.not_accountable_owner', 'Post-transition acceptance is recorded by the accountable owner of the transition');
  }
  if (i.executedBy && i.executedBy === i.acceptorUserId) {
    throw forbidden('readiness.acceptance.self', 'Separation of duties: the person who recorded the execution cannot accept the transition');
  }
  if (i.conflictingEvidenceCount > 0) throw ruleViolation('readiness.acceptance.conflicting_evidence', 'The acceptance evidence is conflicting; resolve it first');
  if (i.activeEvidenceCount < 1) throw ruleViolation('readiness.acceptance.no_evidence', 'Post-transition acceptance requires acceptance evidence');
  if (!i.note?.trim()) throw ruleViolation('readiness.acceptance.note_required', 'Record the acceptance basis');
}

// ---------------------------------------------------------------------------------------------------------
// Governance decisions linked to readiness / TSA commands (governance owns decisions; we only link them)

export interface LinkedDecision {
  id: string;
  status: DecisionStatus;
  authorityOutcome: DecisionAuthorityOutcome;
  externalAuthorityReference?: string | null;
  decisionTypeKey: string | null;
}

/** Decision types (DEMO authority matrix keys) that may authorize a go-live / a TSA approval or extension. */
export const GO_DECISION_TYPE_KEYS: readonly string[] = ['day1_go_no_go'];
export const TSA_DECISION_TYPE_KEYS: readonly string[] = ['tsa_approval_or_extension'];

/** A decision of the right type that is not dead (rejected/superseded) may be linked while it is still being decided. */
export function assertDecisionLinkable(d: LinkedDecision, allowedTypeKeys: readonly string[], purpose: string): void {
  if (!d.decisionTypeKey || !allowedTypeKeys.includes(d.decisionTypeKey)) {
    throw ruleViolation('readiness.decision.wrong_type', `${purpose} needs a governance decision of type ${allowedTypeKeys.join(' / ')} (this one is ${d.decisionTypeKey ?? 'untyped'})`, {
      decisionTypeKey: d.decisionTypeKey,
      allowed: allowedTypeKeys,
    });
  }
  if (d.status === 'rejected' || d.status === 'superseded') {
    throw ruleViolation('readiness.decision.not_linkable', `A ${d.status} decision cannot be linked for ${purpose}`);
  }
}

/**
 * Null when the decision is a FINAL approval for the purpose (approved within the committee mandate, or approved by the
 * authorized body with its reference recorded — as for gates, AT-04); otherwise the reason it is not.
 */
export function linkedDecisionIssue(d: LinkedDecision | null, allowedTypeKeys: readonly string[], purpose: string): string | null {
  if (!d) return `No governance decision is linked for ${purpose}`;
  if (!d.decisionTypeKey || !allowedTypeKeys.includes(d.decisionTypeKey)) return `The linked decision is not of type ${allowedTypeKeys.join(' / ')}`;
  if (!FINAL_APPROVED_DECISION_STATUSES.includes(d.status)) {
    return d.status === 'recommended'
      ? 'The linked decision is recommended — pending the external authority; it is not a final approval'
      : `The linked decision is ${d.status}; only an approved decision counts`;
  }
  if (d.authorityOutcome === 'within_mandate') return null;
  if (d.authorityOutcome === 'pending_external_authority' && d.externalAuthorityReference?.trim()) return null;
  return d.authorityOutcome === 'pending_external_authority'
    ? 'The linked decision is outside the committee delegation and no approval by the authorized body is recorded'
    : 'The linked decision has no authority assessment (within mandate / external authority)';
}

// ---------------------------------------------------------------------------------------------------------
// TSA commands (§7.3; REQ-TSA-001..006; AT-10)

/** Commands executable through the generic transition endpoint; guarded commands have dedicated endpoints. */
export const TSA_SIMPLE_COMMANDS = ['start_negotiation', 'activate', 'start_exit', 'record_breach', 'remedy_breach'] as const;
export type TsaSimpleCommand = (typeof TSA_SIMPLE_COMMANDS)[number];

/** REQ-TSA-001 (proposed test "a TSA without exit milestones cannot be Approved"): approval needs a complete record. */
export function assertTsaApprovable(t: {
  ownerUserId: string | null;
  startDate: string | null;
  endDate: string | null;
  exitMilestones: readonly { title: string }[];
  replacementService: string | null;
  scope: string | null;
}): void {
  const missing: string[] = [];
  if (!t.ownerUserId) missing.push('owner');
  if (!filled(t.scope)) missing.push('scope');
  if (!t.startDate) missing.push('start date');
  if (!t.endDate) missing.push('end date');
  if (t.startDate && t.endDate && t.endDate <= t.startDate) missing.push('end date after start date');
  if (!t.exitMilestones.some((m) => filled(m.title))) missing.push('exit milestones');
  if (!filled(t.replacementService)) missing.push('replacement service / plan');
  if (missing.length) throw ruleViolation('tsa.approve.incomplete', `The TSA cannot be approved; missing: ${missing.join(', ')}`, { missing });
}

/** Starting the exit needs a replacement plan. */
export function assertTsaExitStartable(t: { replacementService: string | null }): void {
  if (!filled(t.replacementService)) throw ruleViolation('tsa.exit.no_replacement_plan', 'Define the replacement service before starting the exit');
}

const REPLACEMENT_ACCEPTANCE_STATUSES: readonly TsaStatus[] = ['active', 'extended', 'exit_in_progress', 'expired_unresolved', 'breached'];

/** Replacement acceptance needs a defined replacement and active, non-conflicting acceptance evidence. */
export function assertReplacementAcceptable(t: { status: TsaStatus; replacementService: string | null; replacementAccepted: boolean; activeEvidenceCount: number; conflictingEvidenceCount: number; note: string | null | undefined }): void {
  if (!REPLACEMENT_ACCEPTANCE_STATUSES.includes(t.status)) throw ruleViolation('tsa.replacement.invalid_state', `A replacement cannot be accepted while the TSA is ${t.status}`);
  if (t.replacementAccepted) throw ruleViolation('tsa.replacement.already_accepted', 'The replacement service is already accepted');
  if (!filled(t.replacementService)) throw ruleViolation('tsa.replacement.not_defined', 'No replacement service is defined');
  if (t.conflictingEvidenceCount > 0) throw ruleViolation('tsa.replacement.conflicting_evidence', 'The replacement acceptance evidence is conflicting');
  if (t.activeEvidenceCount < 1) throw ruleViolation('tsa.replacement.no_evidence', 'Replacement acceptance requires acceptance evidence linked to the TSA service');
  if (!filled(t.note)) throw ruleViolation('tsa.replacement.note_required', 'Record the acceptance basis');
}

/** An extension request states the new end date (after the current one) and the continuity plan. */
export function assertExtensionRequestValid(t: { status: TsaStatus; currentEndDate: string | null; proposedEndDate: string; continuityPlan: string }): void {
  if (!TSA_MACHINE.record_extension.from.includes(t.status)) {
    throw ruleViolation('tsa.extension.invalid_state', `An extension cannot be requested while the TSA is ${t.status}`);
  }
  if (t.currentEndDate && t.proposedEndDate <= t.currentEndDate) {
    throw ruleViolation('tsa.extension.end_date_not_later', `The proposed end date must be after the current end date (${t.currentEndDate})`);
  }
  if (!filled(t.continuityPlan)) throw ruleViolation('tsa.extension_requires_continuity_plan', 'An extension must reference the continuity plan');
}

/** approveTSAExit (REQ-TSA-006): the approver is neither the requester, the TSA owner nor the replacement acceptor. */
export function assertTsaExitApprovalSeparation(i: { approverUserId: string; requesterUserId: string | null; ownerUserId: string | null; replacementAcceptedBy: string | null }): void {
  const self = [i.requesterUserId, i.ownerUserId, i.replacementAcceptedBy].filter((x): x is string => !!x);
  if (self.includes(i.approverUserId)) {
    throw forbidden('tsa.exit.self_approval', 'Separation of duties: the TSA owner, the exit requester or the replacement acceptor cannot approve the exit');
  }
}

export type TsaExpiryAction =
  | { action: 'none' }
  | { action: 'notify_expiring'; daysLeft: number }
  | { action: 'mark_expired_unresolved'; daysOverdue: number }
  | { action: 'ensure_escalation'; daysOverdue: number }
  | { action: 'notify_exit_acceptance_pending'; daysOverdue: number };

/**
 * What the TSA expiry job does for one service (AT-10, REQ-TSA-003): an end date passed without an accepted
 * replacement moves the TSA to expired_unresolved and raises an escalation — never an exit, never an extension.
 */
export function tsaExpiryAction(status: TsaStatus, a: TsaExpiryAssessment): TsaExpiryAction {
  switch (a.kind) {
    case 'ok':
      return { action: 'none' };
    case 'expiring':
      return status === 'expired_unresolved' ? { action: 'none' } : { action: 'notify_expiring', daysLeft: a.daysLeft };
    case 'exit_acceptance_pending':
      return { action: 'notify_exit_acceptance_pending', daysOverdue: a.daysOverdue };
    case 'expired_unresolved':
      if (status === 'expired_unresolved') return { action: 'ensure_escalation', daysOverdue: a.daysOverdue };
      if (TSA_MACHINE.mark_expired_unresolved.from.includes(status)) return { action: 'mark_expired_unresolved', daysOverdue: a.daysOverdue };
      return { action: 'none' };
  }
}
