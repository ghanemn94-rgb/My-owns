import { forbidden, ruleViolation } from './errors';
import { CUTOVER_STATUSES, READINESS_AREAS } from './enums';
import type { DecisionAuthorityOutcome, DecisionStatus, ReadinessArea, ReadinessStatus, RoleKey, TsaStatus } from './enums';
import { FINAL_APPROVED_DECISION_STATUSES } from './gates';
import { TSA_MACHINE } from './workflows';
import type { Machine } from './workflows';
import { goDecisionBlockers, missingCutoverPrerequisites } from './carveout';
import type { CutoverPrerequisites, TsaExpiryAssessment } from './carveout';
import { parseRenderedMessage, renderMessageEn, type ServerMessage } from './messages';

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
 * recorded its latest status/evidence (access-matrix §2.4, §5.1). `selfUserIds` carries the owner, the creator, the
 * recorder of the latest test run AND every person who linked the check's current (active / conflicting) evidence
 * (DOM-P3-10 / SEC-P34-01). A "passed" sign-off needs active, non-conflicting evidence and a latest test run that did not
 * fail; "not applicable" needs a documented basis.
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

/** States in which a readiness check is cleared (a waived one only with an effective waiver — checked by the caller). */
export const READINESS_CLEARED_STATUSES: readonly ReadinessStatus[] = ['passed', 'not_applicable', 'waived'];

/** Cutover-plan states in which the set of checks gating the plan is under decision or already decided (GO). */
export const GO_DECIDED_PLAN_STATUSES: readonly CutoverStatus[] = ['ready_for_decision', 'approved_go'];

/**
 * Specialist determination of a check's criticality and waivability (spec §3: "authorized specialists determine
 * waivability and waiver authority"). Waivable checks must name the waiver authority role; a basis is always recorded.
 *
 * DOM-P3-02 (spec §3 "an exception cannot override a non-waivable condition"; the rule adopted for CPs in DOM-P4-03): a
 * determination never RELEASES an open gating check. Lowering `blocker` or `mandatory` is refused while the check has
 * FAILED, and while it is not cleared and gates a plan that is under go/no-go decision or has a GO. Releasing such a check
 * goes through the waiver register (waivable only; basis, impact, the specialist-set waiver authority, not the requester).
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
  /** Current status and criticality of the check, and the criticality the determination would set (all REQUIRED, N-01). */
  status: ReadinessStatus;
  current: { mandatory: boolean; blocker: boolean };
  next: { mandatory: boolean; blocker: boolean };
  /** The check gates a plan at ready_for_decision / approved_go. */
  gatesDecidedPlan: boolean;
}): void {
  assertAssignedSpecialist('determination', i.checkCode, i.signoffRole, i.actorRoles);
  if (i.creatorUserId && i.creatorUserId === i.actorUserId) {
    throw forbidden('readiness.determination.self', 'Separation of duties: the author of a readiness check cannot determine its criticality/waivability');
  }
  const lowers = (i.current.blocker === true && i.next.blocker !== true) || (i.current.mandatory === true && i.next.mandatory !== true);
  const cleared = READINESS_CLEARED_STATUSES.includes(i.status);
  if (lowers && (i.status === 'failed' || (!cleared && i.gatesDecidedPlan !== false))) {
    throw ruleViolation(
      'readiness.determination.release_not_allowed',
      `${i.checkCode} is ${i.status === 'failed' ? 'a failed' : 'an open'} gating check${i.status === 'failed' ? '' : ' of a transition under go/no-go decision'}: a determination cannot release it — a waivable check is released only through the waiver register (basis, impact, waiver authority); a non-waivable one cannot be released`,
      { status: i.status, gatesDecidedPlan: i.gatesDecidedPlan },
    );
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
  // `approved_go` included (DOM-P3-04): a GO flagged because a gating check is open again is withdrawn for a new decision
  // (the consumed go/no-go decision cannot back the new GO).
  return_to_planning: { from: ['ready_for_decision', 'no_go', 'rolled_back', 'approved_go'], to: 'planning', description: 'Back to planning (earlier decisions stay in the history; a withdrawn GO needs a new decision)' },
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

export interface RebindPlan {
  id: string;
  code: string;
  status: CutoverStatus;
}

/**
 * DOM-P3-01: which transition(s) a check gates (`cutoverPlanId`, `siteId`) is a scope attribute, changed only through the
 * re-binding command — never by a descriptive edit. A gating (mandatory / blocker) check that is not cleared:
 *  - that has FAILED keeps gating the plan(s) it was raised for until it is cleared (passed, waived, not applicable);
 *  - is never taken out of a plan that is under go/no-go decision or has a GO (`ready_for_decision`, `approved_go`).
 * A reason is required; plans the check leaves / enters get an entry in their decision history.
 */
export function assertReadinessCheckRebind(i: { checkCode: string; status: ReadinessStatus; gating: boolean; cleared: boolean; leaving: readonly RebindPlan[]; reason: string | null | undefined }): void {
  if (!i.reason?.trim()) throw ruleViolation('readiness.check.rebind_reason_required', 'Re-binding a readiness check to another transition requires a reason');
  if (!i.gating || i.cleared) return;
  if (i.status === 'failed') {
    throw ruleViolation('readiness.check.rebind_failed', `${i.checkCode} failed: a failed gating check keeps gating the transition(s) it was raised for until it is cleared (passed, waived or not applicable)`, {
      status: i.status,
    });
  }
  const locked = i.leaving.filter((p) => GO_DECIDED_PLAN_STATUSES.includes(p.status));
  if (locked.length) {
    throw ruleViolation('readiness.check.rebind_plan_locked', `${i.checkCode} is open and gates ${locked.map((p) => `${p.code} (${p.status})`).join(', ')}, which is under go/no-go decision or has a GO — it cannot be taken out of that transition`, {
      plans: locked.map((p) => ({ id: p.id, code: p.code, status: p.status })),
    });
  }
}

/**
 * DOM-P3-04 (AT-09 "a failed test blocks go-live according to the blocker"): recording that a transition was executed is
 * refused while a gating check of the plan is open again after the GO — until it is cleared / waived, or the GO is withdrawn
 * (return to planning) and a new GO is decided on a new decision.
 */
export function assertExecutionAllowed(i: { planCode: string; blockers: readonly { id: string; title: string; status: ReadinessStatus; blocker: boolean }[] }): void {
  if (i.blockers.length > 0) {
    throw ruleViolation('readiness.execution_blocked', `The GO of ${i.planCode} is flagged: ${i.blockers.length} gating readiness check(s) are open again after the GO — clear or waive them, or withdraw the GO for a new decision`, {
      blockers: i.blockers,
    });
  }
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
  switch (linkedDecisionIssueCode(d, allowedTypeKeys)) {
    case null:
      return null;
    case 'missing':
      return `No governance decision is linked for ${purpose}`;
    case 'wrong_type':
      return `The linked decision is not of type ${allowedTypeKeys.join(' / ')}`;
    case 'recommended':
      return 'The linked decision is recommended — pending the external authority; it is not a final approval';
    case 'not_approved':
      return `The linked decision is ${d!.status}; only an approved decision counts`;
    case 'external_approval_missing':
      return 'The linked decision is outside the committee delegation and no approval by the authorized body is recorded';
    case 'authority_unassessed':
      return 'The linked decision has no authority assessment (within mandate / external authority)';
  }
}

/** Machine-readable reason behind {@link linkedDecisionIssue} (the web translates it); null when the decision authorizes. */
export const LINKED_DECISION_ISSUE_CODES = ['missing', 'wrong_type', 'recommended', 'not_approved', 'external_approval_missing', 'authority_unassessed'] as const;
export type LinkedDecisionIssueCode = (typeof LINKED_DECISION_ISSUE_CODES)[number];

export function linkedDecisionIssueCode(d: LinkedDecision | null, allowedTypeKeys: readonly string[]): LinkedDecisionIssueCode | null {
  if (!d) return 'missing';
  if (!d.decisionTypeKey || !allowedTypeKeys.includes(d.decisionTypeKey)) return 'wrong_type';
  if (!FINAL_APPROVED_DECISION_STATUSES.includes(d.status)) return d.status === 'recommended' ? 'recommended' : 'not_approved';
  if (d.authorityOutcome === 'within_mandate') return null;
  if (d.authorityOutcome === 'pending_external_authority' && d.externalAuthorityReference?.trim()) return null;
  return d.authorityOutcome === 'pending_external_authority' ? 'external_approval_missing' : 'authority_unassessed';
}

// ---------------------------------------------------------------------------------------------------------
// TSA commands (§7.3; REQ-TSA-001..006; AT-10)

/** Commands executable through the generic transition endpoint; guarded commands have dedicated endpoints. */
export const TSA_SIMPLE_COMMANDS = ['start_negotiation', 'activate', 'start_exit', 'record_breach', 'remedy_breach', 'accelerate_exit'] as const;
export type TsaSimpleCommand = (typeof TSA_SIMPLE_COMMANDS)[number];

/** Statuses a breach can return to when remedied (DOM-P3-17). */
const PRE_BREACH_STATUSES: readonly TsaStatus[] = ['active', 'extended', 'exit_in_progress'];

/** DOM-P3-17: a remedied breach returns the TSA to the status it had when the breach was recorded (`active` if unknown). */
export function statusAfterRemedy(preBreachStatus: TsaStatus | null | undefined): TsaStatus {
  return preBreachStatus && PRE_BREACH_STATUSES.includes(preBreachStatus) ? preBreachStatus : 'active';
}

/**
 * DOM-P3-17 (business-gates.md §6 "approved → active: service start date reached and service confirmed"): a TSA is activated
 * only once its start date is reached (project timezone).
 */
export function assertTsaActivatable(t: { startDate: string | null; today: string }): void {
  if (!t.startDate || t.startDate > t.today) {
    throw ruleViolation('tsa.activate.not_started', t.startDate ? `The service starts on ${t.startDate}; it can be activated from that date` : 'The TSA has no start date', { startDate: t.startDate });
  }
}

/** Whether a TSA's terms are approved (its descriptive terms are then part of the approval — DOM-P3-15). */
export const TSA_TERMS_OPEN_STATUSES: readonly TsaStatus[] = ['proposed', 'negotiating'];

/**
 * DOM-P3-06: the terms of an extension request (end date, continuity plan) are bound to the decision they were linked to
 * once that decision has left `draft` (the paper went to the committee with them): a different end date or continuity plan
 * needs a NEW decision. Returns `same` when the request repeats the bound terms (idempotent), `free` when they may change.
 */
export function extensionTermsBinding(i: {
  linkedDecisionId: string | null;
  requestedDecisionId: string;
  linkedDecisionStatus: DecisionStatus | null;
  bound: { proposedEndDate: string | null; continuityPlan: string | null };
  requested: { proposedEndDate: string; continuityPlan: string };
}): 'free' | 'same' {
  if (!i.linkedDecisionId || i.linkedDecisionId !== i.requestedDecisionId || !i.bound.proposedEndDate) return 'free';
  const same = i.bound.proposedEndDate === i.requested.proposedEndDate && (i.bound.continuityPlan ?? '') === i.requested.continuityPlan;
  if (same) return 'same';
  if (i.linkedDecisionStatus === 'draft') return 'free';
  throw ruleViolation(
    'tsa.extension.terms_bound',
    `The extension requested on this decision (end date ${i.bound.proposedEndDate}) is before the committee: a different end date or continuity plan needs a new decision`,
    { boundEndDate: i.bound.proposedEndDate, requestedEndDate: i.requested.proposedEndDate },
  );
}

/** DOM-P3-07: an extension ends after "today" (project timezone) — an expired TSA is never "extended" into the past. */
export function assertExtensionEndDateAhead(proposedEndDate: string, today: string): void {
  if (proposedEndDate <= today) {
    throw ruleViolation('tsa.extension.end_date_past', `The new end date ${proposedEndDate} is not after today (${today}); an extension must extend the service`, { proposedEndDate, today });
  }
}

/**
 * The continuity options attached to every TSA escalation (expiry or replacement failure). The server stores the
 * English title/impact on the escalation record; the web shows the translated text for these keys.
 */
export const TSA_ESCALATION_OPTIONS = [
  { key: 'extend', title: 'Extend the TSA', impact: 'Requires an approved decision recorded against the TSA (request-extension → record-extension); cost and obligations continue' },
  { key: 'interim', title: 'Alternative interim / continuity arrangement', impact: 'Continuity plan executed; the TSA stays unresolved until an exit is accepted with evidence' },
  { key: 'replan', title: 'Accelerate / re-plan the replacement service', impact: 'Exit only after the replacement is accepted with evidence and the exit approved' },
] as const;
export type TsaEscalationOptionKey = (typeof TSA_ESCALATION_OPTIONS)[number]['key'];

/**
 * English templates of the texts the TSA escalation stores on the governance escalation record (QA-P34-01b): the requested
 * action and the routing target. They are persisted as plain text (the escalation table is shared with the committee
 * escalations), so the API recovers the codes with {@link tsaEscalationI18n}. `{endDate}` is a business date; `{name}`,
 * `{failureSummary}`, `{continuityPlan}`, `{committee}` and `{escalateTo}` are recorded data (shown as entered);
 * `{decisionType}` is a decision-type key. Web catalogue: `readiness.messages.tsa.*` (en + ar).
 */
export const TSA_MESSAGES_EN: Readonly<Record<string, string>> = {
  'tsa.escalation.expired_unresolved':
    'TSA {code} ({name}) reached its end date {endDate} without an accepted replacement service. This is NOT an exit. Decide on continuity: an extension (approved decision required; never automatic) or an alternative arrangement.',
  'tsa.escalation.replacement_failure':
    'The replacement for TSA {code} ({name}) failed: {failureSummary}. Decide on continuity: extension of the TSA (requires an approved decision; never automatic) or an alternative interim arrangement. Continuity plan: {continuityPlan}',
  'tsa.routing.within_authority': '{committee} — within its delegated authority ({decisionType}, matrix v{matrixVersion})',
  'tsa.routing.delegating_authority_tbc': 'Delegating authority — to be confirmed ({decisionType}, matrix v{matrixVersion})',
  'tsa.routing.escalate_to': '{escalateTo} ({decisionType}, matrix v{matrixVersion})',
  'tsa.routing.no_matrix': 'Authorized body — to be confirmed (no approved authority matrix covers TSA decisions)',
};

/** Parameters of the TSA escalation texts that are codes / keys / numbers / dates (parsed as single tokens). */
const TSA_MESSAGE_TOKENS = ['code', 'endDate', 'decisionType', 'matrixVersion'] as const;

/** English TSA escalation text rendered from {@link TSA_MESSAGES_EN} (what the escalation record stores). */
export function tsaEscalationText(code: string, params: Record<string, string | number> = {}): string {
  return renderMessageEn(code, params, TSA_MESSAGES_EN);
}

/** Codes + parameters of a stored TSA escalation text; empty when it matches no template (shown as stored). */
export function tsaEscalationI18n(text: string | null | undefined): ServerMessage[] {
  const m = parseRenderedMessage(text, TSA_MESSAGES_EN, TSA_MESSAGE_TOKENS);
  return m ? [m] : [];
}

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

/** An extension request states the new end date (after the current one AND after today — DOM-P3-07) and the continuity plan. */
export function assertExtensionRequestValid(t: { status: TsaStatus; currentEndDate: string | null; proposedEndDate: string; continuityPlan: string; today: string }): void {
  if (!TSA_MACHINE.record_extension.from.includes(t.status)) {
    throw ruleViolation('tsa.extension.invalid_state', `An extension cannot be requested while the TSA is ${t.status}`);
  }
  if (t.currentEndDate && t.proposedEndDate <= t.currentEndDate) {
    throw ruleViolation('tsa.extension.end_date_not_later', `The proposed end date must be after the current end date (${t.currentEndDate})`);
  }
  assertExtensionEndDateAhead(t.proposedEndDate, t.today);
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
