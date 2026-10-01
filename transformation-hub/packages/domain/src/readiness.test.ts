import { describe, expect, it } from 'vitest';
import {
  assertGoAllowed,
  assertReadinessWaiverAllowed,
  assessTsaExpiry,
  assertTsaExitAcceptable,
  assertTsaExtensionAllowed,
  missingCutoverPrerequisites,
  CutoverPrerequisites,
} from './carveout';
import {
  CUTOVER_MACHINE,
  GO_DECIDED_PLAN_STATUSES,
  READINESS_CHECK_MACHINE,
  DAY1_READINESS_AREAS,
  assertExecutionAllowed,
  assertExtensionEndDateAhead,
  assertReadinessCheckRebind,
  assertCutoverPlanSiteChange,
  assertTsaActivatable,
  extensionTermsBinding,
  assertExtensionTermsRecordable,
  statusAfterRemedy,
  assertCutoverSubmittable,
  assertDecisionLinkable,
  assertExtensionRequestValid,
  assertPostTransitionAcceptance,
  assertReadinessDetermination,
  assertReadinessSignoffAllowed,
  assertReplacementAcceptable,
  assertTsaApprovable,
  assertTsaExitApprovalSeparation,
  assertTsaExitStartable,
  cutoverPrerequisitesOf,
  evaluateGo,
  linkedDecisionIssue,
  linkedDecisionIssueCode,
  readinessCheckAppliesToPlan,
  statusAfterTestRun,
  tsaExpiryAction,
  uncoveredReadinessAreas,
  GO_DECISION_TYPE_KEYS,
  TSA_DECISION_TYPE_KEYS,
  CutoverPlanFacts,
} from './readiness';
import { transition, TSA_MACHINE } from './workflows';
import { DomainError } from './errors';

const ALL: CutoverPrerequisites = {
  hasRunbook: true,
  hasRollbackPlan: true,
  communicationsApproved: true,
  hasWindow: true,
  hasServiceImpact: true,
  hasAccountableOwner: true,
  testingDone: true,
  hasApprovedGoDecision: true,
};

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof DomainError ? `${e.kind}:${e.code}` : `other:${(e as Error).message}`;
  }
}

describe('N-01 — cutover prerequisites fail closed', () => {
  it('every §7.4 element and the approved decision are required; an omitted field blocks GO', () => {
    expect(() => assertGoAllowed([], ALL)).not.toThrow();
    for (const k of Object.keys(ALL) as (keyof CutoverPrerequisites)[]) {
      const partial = { ...ALL } as Record<string, unknown>;
      delete partial[k]; // an untyped caller forgetting the field
      expect(codeOf(() => assertGoAllowed([], partial as unknown as CutoverPrerequisites)), k).toBe('rule_violation:readiness.go_blocked');
      expect(missingCutoverPrerequisites({ ...ALL, [k]: false })).toHaveLength(1);
    }
  });
  it('the missing list names each element (and the decision only when asked)', () => {
    const none = Object.fromEntries(Object.keys(ALL).map((k) => [k, false])) as unknown as CutoverPrerequisites;
    expect(missingCutoverPrerequisites(none)).toEqual([
      'runbook',
      'contingency/rollback plan',
      'approved communications',
      'transition window',
      'service-impact assessment',
      'accountable owner',
      'testing / rehearsal',
      'approved go/no-go decision',
    ]);
    expect(missingCutoverPrerequisites(none, { includeDecision: false })).not.toContain('approved go/no-go decision');
  });
});

describe('N-02 — readiness waiver authority and impact', () => {
  const base = { checkCode: 'RC-001', waivable: true, blocker: true, waiverAuthorityRole: 'sponsor', approverRoles: ['sponsor'], approverUserId: 'a', requesterUserId: 'b', basis: 'Documented basis', impact: 'Documented impact' };
  it('passes with waivability, the specialist-set authority role, a different approver, basis and impact', () => {
    expect(() => assertReadinessWaiverAllowed(base)).not.toThrow();
  });
  it('rejects an approver without the waiver authority role', () => {
    expect(codeOf(() => assertReadinessWaiverAllowed({ ...base, approverRoles: ['committee_chair'] }))).toBe('rule_violation:readiness.waiver.unauthorized');
  });
  it('rejects when no waiver authority role was determined', () => {
    expect(codeOf(() => assertReadinessWaiverAllowed({ ...base, waiverAuthorityRole: null }))).toBe('rule_violation:readiness.waiver.unauthorized');
  });
  it('requires an impact statement (and a basis)', () => {
    expect(codeOf(() => assertReadinessWaiverAllowed({ ...base, impact: '  ' }))).toBe('rule_violation:readiness.waiver.missing_basis');
    expect(codeOf(() => assertReadinessWaiverAllowed({ ...base, basis: '' }))).toBe('rule_violation:readiness.waiver.missing_basis');
  });
  it('rejects self-approval and non-waivable checks (AT-13)', () => {
    expect(codeOf(() => assertReadinessWaiverAllowed({ ...base, approverUserId: 'b' }))).toBe('rule_violation:readiness.waiver.self_approval');
    expect(codeOf(() => assertReadinessWaiverAllowed({ ...base, waivable: false }))).toBe('rule_violation:readiness.waiver.non_waivable');
  });
});

describe('Readiness checks (REQ-RDY-001/002, AT-09)', () => {
  it('REQ-RDY-002: the Day-1 areas are the fourteen §7.4 domains', () => {
    expect(DAY1_READINESS_AREAS).toHaveLength(14);
    expect(uncoveredReadinessAreas(['power', 'cooling'])).toContain('incident_management');
    expect(uncoveredReadinessAreas([...DAY1_READINESS_AREAS])).toEqual([]);
  });
  it('a failed test after a pass (or a sign-off) sets failed; a pass never signs off; N/A takes no tests; a waiver persists', () => {
    expect(statusAfterTestRun('not_started', 'passed')).toBe('in_progress');
    expect(statusAfterTestRun('passed', 'failed')).toBe('failed');
    expect(statusAfterTestRun('failed', 'passed')).toBe('in_progress');
    expect(statusAfterTestRun('passed', 'passed')).toBe('passed');
    expect(statusAfterTestRun('waived', 'failed')).toBe('waived');
    expect(codeOf(() => statusAfterTestRun('not_applicable', 'passed'))).toBe('rule_violation:readiness.test.not_applicable');
  });
  it('the check machine allows a waiver only on an uncleared check and reopening only of a cleared one', () => {
    expect(transition('readiness_check', READINESS_CHECK_MACHINE, 'failed', 'apply_waiver')).toBe('waived');
    expect(() => transition('readiness_check', READINESS_CHECK_MACHINE, 'passed', 'apply_waiver')).toThrow();
    expect(() => transition('readiness_check', READINESS_CHECK_MACHINE, 'failed', 'sign_off')).toThrow();
    expect(transition('readiness_check', READINESS_CHECK_MACHINE, 'waived', 'reopen')).toBe('in_progress');
  });
  const so = {
    checkCode: 'RC-001',
    outcome: 'passed' as const,
    signoffRole: 'functional_approver' as const,
    actorRoles: ['functional_approver'],
    actorUserId: 'spec',
    selfUserIds: ['owner', 'tester'],
    latestTestResult: 'in_progress' as const,
    activeEvidenceCount: 1,
    conflictingEvidenceCount: 0,
    note: null,
  };
  it('REQ-RDY-001: sign-off by a non-assigned role is rejected (403)', () => {
    expect(() => assertReadinessSignoffAllowed(so)).not.toThrow();
    expect(codeOf(() => assertReadinessSignoffAllowed({ ...so, actorRoles: ['sponsor'] }))).toBe('forbidden:readiness.signoff.not_assigned_role');
    expect(codeOf(() => assertReadinessSignoffAllowed({ ...so, signoffRole: null }))).toBe('rule_violation:readiness.signoff.no_role');
  });
  it('sign-off: owner / latest recorder excluded; evidence required; latest failed test blocks; N/A needs a basis', () => {
    expect(codeOf(() => assertReadinessSignoffAllowed({ ...so, actorUserId: 'tester' }))).toBe('forbidden:readiness.signoff.self');
    expect(codeOf(() => assertReadinessSignoffAllowed({ ...so, activeEvidenceCount: 0 }))).toBe('rule_violation:readiness.signoff.no_evidence');
    expect(codeOf(() => assertReadinessSignoffAllowed({ ...so, conflictingEvidenceCount: 1 }))).toBe('rule_violation:readiness.signoff.conflicting_evidence');
    expect(codeOf(() => assertReadinessSignoffAllowed({ ...so, latestTestResult: 'failed' }))).toBe('rule_violation:readiness.signoff.latest_test_failed');
    expect(codeOf(() => assertReadinessSignoffAllowed({ ...so, outcome: 'not_applicable', activeEvidenceCount: 0 }))).toBe('rule_violation:readiness.signoff.na_basis_required');
    expect(() => assertReadinessSignoffAllowed({ ...so, outcome: 'not_applicable', activeEvidenceCount: 0, note: 'Site has no generator' })).not.toThrow();
  });
  it('waivability determination: assigned specialist, not the author, authority role for waivable checks, basis', () => {
    const d = {
      checkCode: 'RC-1',
      signoffRole: 'functional_approver' as const,
      actorRoles: ['functional_approver'],
      actorUserId: 'spec',
      creatorUserId: 'pm',
      waivable: true,
      waiverAuthorityRole: 'sponsor' as const,
      basis: 'Specialist basis',
      status: 'not_started' as const,
      current: { mandatory: true, blocker: true },
      next: { mandatory: true, blocker: true },
      gatesDecidedPlan: false,
    };
    expect(() => assertReadinessDetermination(d)).not.toThrow();
    expect(codeOf(() => assertReadinessDetermination({ ...d, waiverAuthorityRole: null }))).toBe('rule_violation:readiness.determination.authority_required');
    expect(codeOf(() => assertReadinessDetermination({ ...d, creatorUserId: 'spec' }))).toBe('forbidden:readiness.determination.self');
    expect(codeOf(() => assertReadinessDetermination({ ...d, basis: '' }))).toBe('rule_violation:readiness.determination.basis_required');
    expect(codeOf(() => assertReadinessDetermination({ ...d, actorRoles: ['project_manager'] }))).toBe('forbidden:readiness.signoff.not_assigned_role');
  });
  it('DOM-P3-02: a determination never releases an open gating check (failed, or open while a plan is under decision / has a GO)', () => {
    const d = {
      checkCode: 'RC-2',
      signoffRole: 'functional_approver' as const,
      actorRoles: ['functional_approver'],
      actorUserId: 'spec',
      creatorUserId: 'pm',
      waivable: false,
      waiverAuthorityRole: null,
      basis: 'Specialist basis',
      status: 'failed' as const,
      current: { mandatory: true, blocker: true },
      next: { mandatory: true, blocker: false },
      gatesDecidedPlan: false,
    };
    expect(codeOf(() => assertReadinessDetermination(d))).toBe('rule_violation:readiness.determination.release_not_allowed');
    expect(codeOf(() => assertReadinessDetermination({ ...d, next: { mandatory: false, blocker: true } }))).toBe('rule_violation:readiness.determination.release_not_allowed');
    expect(codeOf(() => assertReadinessDetermination({ ...d, status: 'in_progress', gatesDecidedPlan: true }))).toBe('rule_violation:readiness.determination.release_not_allowed');
    // Not lowering (waivability only), an open check not under decision, or a cleared check: the specialist decides.
    expect(() => assertReadinessDetermination({ ...d, next: { mandatory: true, blocker: true }, waivable: true, waiverAuthorityRole: 'sponsor' })).not.toThrow();
    expect(() => assertReadinessDetermination({ ...d, status: 'in_progress' })).not.toThrow();
    expect(() => assertReadinessDetermination({ ...d, status: 'passed', gatesDecidedPlan: true })).not.toThrow();
  });
});

describe('DOM-P3-01 / DOM-P3-04 / DOM-P3-09 — a Day-1 blocker keeps blocking go-live', () => {
  const plan = (code: string, status: 'planning' | 'ready_for_decision' | 'approved_go' | 'executed') => ({ id: code, code, status });
  it('re-binding: reason required; a failed gating check never; an open one never leaves a plan under decision or with a GO', () => {
    const r = { checkCode: 'RC-3', status: 'in_progress' as const, gating: true, cleared: false, leaving: [plan('CO-1', 'planning')], reason: 'Moved to the core transition' };
    expect(() => assertReadinessCheckRebind(r)).not.toThrow();
    expect(codeOf(() => assertReadinessCheckRebind({ ...r, reason: ' ' }))).toBe('rule_violation:readiness.check.rebind_reason_required');
    expect(codeOf(() => assertReadinessCheckRebind({ ...r, status: 'failed', leaving: [] }))).toBe('rule_violation:readiness.check.rebind_failed');
    expect(codeOf(() => assertReadinessCheckRebind({ ...r, leaving: [plan('CO-2', 'ready_for_decision')] }))).toBe('rule_violation:readiness.check.rebind_plan_locked');
    expect(codeOf(() => assertReadinessCheckRebind({ ...r, leaving: [plan('CO-3', 'approved_go')] }))).toBe('rule_violation:readiness.check.rebind_plan_locked');
    // Cleared or non-gating checks, or plans already executed: free to move.
    expect(() => assertReadinessCheckRebind({ ...r, cleared: true, status: 'passed', leaving: [plan('CO-2', 'ready_for_decision')] })).not.toThrow();
    expect(() => assertReadinessCheckRebind({ ...r, gating: false, status: 'failed' })).not.toThrow();
    expect(() => assertReadinessCheckRebind({ ...r, leaving: [plan('CO-4', 'executed')] })).not.toThrow();
  });
  it('a passed check clears the GO only while its sign-off evidence is valid (fails closed when unknown)', () => {
    const pre = cutoverPrerequisitesOf(
      { runbookDocumentId: null, runbookSummary: 'R', windowStart: '2026-10-01T20:00:00Z', windowEnd: '2026-10-02T02:00:00Z', serviceImpact: 'S', accountableUserId: 'o', communicationsApproved: true, testingSummary: 'T', rehearsalDone: true, contingencyPlan: 'C', rollbackPlan: 'B' },
      true,
    );
    const c = { id: 'c1', title: 'Connectivity', mandatory: true, blocker: true, status: 'passed' as const };
    expect(evaluateGo([{ ...c, signoffEvidenceValid: true }], pre).allowed).toBe(true);
    expect(evaluateGo([{ ...c, signoffEvidenceValid: false }], pre).blockers).toEqual([{ id: 'c1', title: 'Connectivity', status: 'passed', blocker: true, evidenceInvalid: true }]);
    expect(evaluateGo([c], pre).allowed).toBe(false);
  });
  it('execution after a GO is refused while a gating check is open again; the GO can be withdrawn (return to planning)', () => {
    expect(() => assertExecutionAllowed({ planCode: 'CO-1', blockers: [] })).not.toThrow();
    expect(codeOf(() => assertExecutionAllowed({ planCode: 'CO-1', blockers: [{ id: 'c1', title: 'x', status: 'failed', blocker: true }] }))).toBe('rule_violation:readiness.execution_blocked');
    expect(transition('cutover', CUTOVER_MACHINE, 'approved_go', 'return_to_planning')).toBe('planning');
    expect(GO_DECIDED_PLAN_STATUSES).toEqual(['ready_for_decision', 'approved_go']);
  });
});

describe('Cutover and go/no-go (REQ-RDY-003/004/005, AT-09)', () => {
  const facts: CutoverPlanFacts = {
    runbookDocumentId: null,
    runbookSummary: 'Runbook v1 (synthetic)',
    windowStart: '2026-10-01T20:00:00Z',
    windowEnd: '2026-10-02T02:00:00Z',
    serviceImpact: 'No customer impact expected (synthetic)',
    accountableUserId: 'owner',
    communicationsApproved: true,
    testingSummary: 'Rehearsal passed (synthetic)',
    rehearsalDone: true,
    contingencyPlan: 'Contingency runbook (synthetic)',
    rollbackPlan: 'Rollback to the current NOC (synthetic)',
  };
  it('REQ-RDY-003: a plan without rollback (or contingency, window, testing…) cannot be submitted for go/no-go', () => {
    expect(() => assertCutoverSubmittable(facts)).not.toThrow();
    expect(codeOf(() => assertCutoverSubmittable({ ...facts, rollbackPlan: ' ' }))).toBe('rule_violation:readiness.cutover.incomplete');
    expect(codeOf(() => assertCutoverSubmittable({ ...facts, contingencyPlan: null }))).toBe('rule_violation:readiness.cutover.incomplete');
    expect(codeOf(() => assertCutoverSubmittable({ ...facts, windowEnd: '2026-10-01T19:00:00Z' }))).toBe('rule_violation:readiness.cutover.incomplete');
    expect(codeOf(() => assertCutoverSubmittable({ ...facts, rehearsalDone: false }))).toBe('rule_violation:readiness.cutover.incomplete');
  });
  it('AT-09 / REQ-RDY-004: a failed mandatory blocker blocks GO even with every prerequisite and an approved decision', () => {
    const pre = cutoverPrerequisitesOf(facts, true);
    expect(evaluateGo([], pre)).toEqual({ allowed: true, blockers: [], missing: [] });
    const ev = evaluateGo([{ id: 'c1', title: 'Connectivity tested', mandatory: true, blocker: true, status: 'failed' }], pre);
    expect(ev.allowed).toBe(false);
    expect(ev.blockers).toEqual([{ id: 'c1', title: 'Connectivity tested', status: 'failed', blocker: true }]);
    expect(evaluateGo([], cutoverPrerequisitesOf(facts, false)).missing).toEqual(['approved go/no-go decision']);
  });
  it('the cutover machine: GO/NO-GO only from ready_for_decision; acceptance only after execution', () => {
    expect(transition('cutover', CUTOVER_MACHINE, 'ready_for_decision', 'decide_go')).toBe('approved_go');
    expect(() => transition('cutover', CUTOVER_MACHINE, 'planning', 'decide_go')).toThrow();
    expect(() => transition('cutover', CUTOVER_MACHINE, 'approved_go', 'accept')).toThrow();
    expect(transition('cutover', CUTOVER_MACHINE, 'executed', 'accept')).toBe('accepted');
    expect(transition('cutover', CUTOVER_MACHINE, 'no_go', 'return_to_planning')).toBe('planning');
  });
  it('check applicability: bound checks gate their plan only; the Day-1 plan takes every unbound check; a site plan its site', () => {
    const plan = { id: 'p1', siteId: 's1' };
    const day1 = { id: 'p0', siteId: null };
    expect(readinessCheckAppliesToPlan({ cutoverPlanId: 'p1', siteId: null }, plan)).toBe(true);
    expect(readinessCheckAppliesToPlan({ cutoverPlanId: 'p2', siteId: 's1' }, plan)).toBe(false);
    expect(readinessCheckAppliesToPlan({ cutoverPlanId: null, siteId: 's1' }, plan)).toBe(true);
    expect(readinessCheckAppliesToPlan({ cutoverPlanId: null, siteId: 's2' }, plan)).toBe(false);
    expect(readinessCheckAppliesToPlan({ cutoverPlanId: null, siteId: null }, plan)).toBe(false);
    expect(readinessCheckAppliesToPlan({ cutoverPlanId: null, siteId: 's2' }, day1)).toBe(true);
    expect(readinessCheckAppliesToPlan({ cutoverPlanId: null, siteId: null }, day1)).toBe(true);
    expect(readinessCheckAppliesToPlan({ cutoverPlanId: 'p1', siteId: null }, day1)).toBe(false);
  });
  it('REQ-RDY-005: acceptance without evidence is rejected; only the accountable owner, never the executor', () => {
    const a = { acceptorUserId: 'owner', accountableUserId: 'owner', executedBy: 'ops', activeEvidenceCount: 1, conflictingEvidenceCount: 0, note: 'Accepted (synthetic)' };
    expect(() => assertPostTransitionAcceptance(a)).not.toThrow();
    expect(codeOf(() => assertPostTransitionAcceptance({ ...a, activeEvidenceCount: 0 }))).toBe('rule_violation:readiness.acceptance.no_evidence');
    expect(codeOf(() => assertPostTransitionAcceptance({ ...a, acceptorUserId: 'other' }))).toBe('forbidden:readiness.acceptance.not_accountable_owner');
    expect(codeOf(() => assertPostTransitionAcceptance({ ...a, executedBy: 'owner' }))).toBe('forbidden:readiness.acceptance.self');
  });
});

describe('Linked governance decisions', () => {
  const d = { id: 'd', status: 'approved' as const, authorityOutcome: 'within_mandate' as const, externalAuthorityReference: null, decisionTypeKey: 'day1_go_no_go' };
  it('only a final approval of the right type authorizes; recommended / draft / wrong type do not', () => {
    expect(linkedDecisionIssue(d, GO_DECISION_TYPE_KEYS, 'go-live')).toBeNull();
    expect(linkedDecisionIssue({ ...d, status: 'recommended', authorityOutcome: 'pending_external_authority' }, GO_DECISION_TYPE_KEYS, 'go-live')).toMatch(/recommended/);
    expect(linkedDecisionIssue({ ...d, status: 'approved', authorityOutcome: 'pending_external_authority', externalAuthorityReference: 'REF' }, GO_DECISION_TYPE_KEYS, 'go-live')).toBeNull();
    expect(linkedDecisionIssue({ ...d, status: 'under_review' }, GO_DECISION_TYPE_KEYS, 'go-live')).toMatch(/under_review/);
    expect(linkedDecisionIssue({ ...d, decisionTypeKey: 'change_request_budget' }, GO_DECISION_TYPE_KEYS, 'go-live')).toMatch(/not of type/);
    expect(linkedDecisionIssue(null, TSA_DECISION_TYPE_KEYS, 'extension')).toMatch(/No governance decision/);
  });
  it('issue codes mirror the issue messages (the web translates the code)', () => {
    expect(linkedDecisionIssueCode(d, GO_DECISION_TYPE_KEYS)).toBeNull();
    expect(linkedDecisionIssueCode(null, GO_DECISION_TYPE_KEYS)).toBe('missing');
    expect(linkedDecisionIssueCode({ ...d, decisionTypeKey: 'change_request_budget' }, GO_DECISION_TYPE_KEYS)).toBe('wrong_type');
    expect(linkedDecisionIssueCode({ ...d, status: 'recommended' }, GO_DECISION_TYPE_KEYS)).toBe('recommended');
    expect(linkedDecisionIssueCode({ ...d, status: 'draft' }, GO_DECISION_TYPE_KEYS)).toBe('not_approved');
    expect(linkedDecisionIssueCode({ ...d, authorityOutcome: 'pending_external_authority' }, GO_DECISION_TYPE_KEYS)).toBe('external_approval_missing');
    expect(linkedDecisionIssueCode({ ...d, authorityOutcome: 'pending_external_authority', externalAuthorityReference: 'REF' }, GO_DECISION_TYPE_KEYS)).toBeNull();
  });
  it('linking checks the type and refuses dead decisions', () => {
    expect(() => assertDecisionLinkable({ ...d, status: 'draft' }, GO_DECISION_TYPE_KEYS, 'go-live')).not.toThrow();
    expect(codeOf(() => assertDecisionLinkable({ ...d, decisionTypeKey: null }, GO_DECISION_TYPE_KEYS, 'go-live'))).toBe('rule_violation:readiness.decision.wrong_type');
    expect(codeOf(() => assertDecisionLinkable({ ...d, status: 'rejected' }, GO_DECISION_TYPE_KEYS, 'go-live'))).toBe('rule_violation:readiness.decision.not_linkable');
  });
});

describe('TSA (REQ-TSA-001..006, AT-10, D-25)', () => {
  const tsa = { ownerUserId: 'o', startDate: '2026-10-01', endDate: '2027-03-31', exitMilestones: [{ title: 'Replacement NOC live' }], replacementService: 'NewCo NOC (synthetic)', scope: 'NOC monitoring (synthetic)' };
  it('REQ-TSA-001: a TSA without exit milestones (or owner / end date / replacement) cannot be approved', () => {
    expect(() => assertTsaApprovable(tsa)).not.toThrow();
    expect(codeOf(() => assertTsaApprovable({ ...tsa, exitMilestones: [] }))).toBe('rule_violation:tsa.approve.incomplete');
    let err: DomainError | null = null;
    try {
      assertTsaApprovable({ ...tsa, ownerUserId: null, endDate: null, replacementService: '' });
    } catch (e) {
      err = e as DomainError;
    }
    expect(err?.details).toEqual({ missing: ['owner', 'end date', 'replacement service / plan'] });
  });
  it('REQ-TSA-002: the TSA state machine rejects illegal transitions', () => {
    expect(() => transition('tsa', TSA_MACHINE, 'proposed', 'activate')).toThrow(/Cannot activate/);
    expect(() => transition('tsa', TSA_MACHINE, 'approved', 'start_exit')).toThrow();
    expect(() => transition('tsa', TSA_MACHINE, 'exit_accepted', 'record_extension')).toThrow();
    expect(() => transition('tsa', TSA_MACHINE, 'active', 'accept_exit')).toThrow();
    expect(transition('tsa', TSA_MACHINE, 'extended', 'record_extension')).toBe('extended');
    expect(transition('tsa', TSA_MACHINE, 'approved', 'mark_expired_unresolved')).toBe('expired_unresolved');
  });
  it('REQ-TSA-003 / D-25: end date passed is never an exit', () => {
    expect(assessTsaExpiry({ status: 'approved', endDate: '2026-09-01', replacementAccepted: false, today: '2026-09-29', warnDays: 30 })).toEqual({ kind: 'expired_unresolved', daysOverdue: 28 });
    expect(assessTsaExpiry({ status: 'active', endDate: '2026-09-01', replacementAccepted: true, today: '2026-09-29', warnDays: 30 })).toEqual({ kind: 'exit_acceptance_pending', daysOverdue: 28 });
    expect(assessTsaExpiry({ status: 'active', endDate: '2026-10-09', replacementAccepted: false, today: '2026-09-29', warnDays: 30 })).toEqual({ kind: 'expiring', daysLeft: 10 });
    expect(assessTsaExpiry({ status: 'exit_accepted', endDate: '2026-09-01', replacementAccepted: true, today: '2026-09-29', warnDays: 30 })).toEqual({ kind: 'ok' });
  });
  it('the expiry job escalates (once) and never exits or extends', () => {
    expect(tsaExpiryAction('active', { kind: 'expired_unresolved', daysOverdue: 3 })).toEqual({ action: 'mark_expired_unresolved', daysOverdue: 3 });
    expect(tsaExpiryAction('expired_unresolved', { kind: 'expired_unresolved', daysOverdue: 4 })).toEqual({ action: 'ensure_escalation', daysOverdue: 4 });
    expect(tsaExpiryAction('active', { kind: 'expiring', daysLeft: 5 })).toEqual({ action: 'notify_expiring', daysLeft: 5 });
    expect(tsaExpiryAction('active', { kind: 'ok' })).toEqual({ action: 'none' });
  });
  it('REQ-TSA-005: an extension needs an approved decision, a later end date and a continuity plan', () => {
    expect(codeOf(() => assertTsaExtensionAllowed({ extensionDecisionApproved: false, newEndDate: '2027-06-30', continuityPlan: 'x' }))).toBe('rule_violation:tsa.extension_requires_decision');
    const today = '2026-09-30';
    expect(codeOf(() => assertExtensionRequestValid({ status: 'active', currentEndDate: '2027-03-31', proposedEndDate: '2027-03-01', continuityPlan: 'x', today }))).toBe('rule_violation:tsa.extension.end_date_not_later');
    expect(codeOf(() => assertExtensionRequestValid({ status: 'proposed', currentEndDate: null, proposedEndDate: '2027-03-01', continuityPlan: 'x', today }))).toBe('rule_violation:tsa.extension.invalid_state');
    expect(codeOf(() => assertExtensionRequestValid({ status: 'active', currentEndDate: '2027-03-31', proposedEndDate: '2027-06-30', continuityPlan: ' ', today }))).toBe('rule_violation:tsa.extension_requires_continuity_plan');
    // DOM-P3-07: an expired TSA (end 2026-09-20) is not "extended" to a date that has already passed.
    expect(codeOf(() => assertExtensionRequestValid({ status: 'expired_unresolved', currentEndDate: '2026-09-20', proposedEndDate: '2026-09-25', continuityPlan: 'x', today }))).toBe('rule_violation:tsa.extension.end_date_past');
    expect(() => assertExtensionRequestValid({ status: 'expired_unresolved', currentEndDate: '2026-09-20', proposedEndDate: '2026-10-25', continuityPlan: 'x', today })).not.toThrow();
    expect(codeOf(() => assertExtensionEndDateAhead('2026-09-30', today))).toBe('rule_violation:tsa.extension.end_date_past');
  });
  it('DOM-P3-06: the extension terms are bound to their decision once it left draft; the same terms are idempotent', () => {
    const terms = { tsaServiceId: 't1', proposedEndDate: '2027-01-19', continuityPlan: 'Keep the bridge' };
    const base = { decisionStatus: 'under_review' as const, bound: terms, requested: terms };
    expect(extensionTermsBinding(base)).toBe('same');
    expect(codeOf(() => extensionTermsBinding({ ...base, requested: { ...terms, proposedEndDate: '2036-09-28' } }))).toBe('rule_violation:tsa.extension.terms_bound');
    expect(codeOf(() => extensionTermsBinding({ ...base, decisionStatus: 'approved', requested: { ...terms, continuityPlan: 'Another plan' } }))).toBe('rule_violation:tsa.extension.terms_bound');
    expect(extensionTermsBinding({ ...base, decisionStatus: 'draft', requested: { ...terms, proposedEndDate: '2027-02-19' } })).toBe('rebind');
    expect(extensionTermsBinding({ ...base, bound: null })).toBe('new');
  });
  it('DOM-P34R-04: the terms are bound per DECISION — another TSA is refused, and record-extension applies only the bound terms', () => {
    const terms = { tsaServiceId: 't1', proposedEndDate: '2027-01-19', continuityPlan: 'Keep the bridge' };
    expect(codeOf(() => extensionTermsBinding({ decisionStatus: 'approved', bound: terms, requested: { ...terms, tsaServiceId: 't2' } }))).toBe('rule_violation:tsa.extension.decision_other_tsa');
    expect(() => assertExtensionTermsRecordable({ decisionCode: 'DEC-1', bound: terms, stored: terms })).not.toThrow();
    expect(codeOf(() => assertExtensionTermsRecordable({ decisionCode: 'DEC-1', bound: terms, stored: { ...terms, proposedEndDate: '2036-09-28' } }))).toBe('rule_violation:tsa.extension.terms_mismatch');
    expect(codeOf(() => assertExtensionTermsRecordable({ decisionCode: 'DEC-1', bound: terms, stored: { ...terms, tsaServiceId: 't2' } }))).toBe('rule_violation:tsa.extension.terms_mismatch');
    expect(codeOf(() => assertExtensionTermsRecordable({ decisionCode: 'DEC-1', bound: null, stored: terms }))).toBe('rule_violation:tsa.extension.terms_mismatch');
  });
  it('DOM-P3-17: activation needs the start date reached; a remedied breach returns to the status before the breach; a breach may accelerate the exit', () => {
    expect(codeOf(() => assertTsaActivatable({ startDate: '2026-10-05', today: '2026-09-30' }))).toBe('rule_violation:tsa.activate.not_started');
    expect(codeOf(() => assertTsaActivatable({ startDate: null, today: '2026-09-30' }))).toBe('rule_violation:tsa.activate.not_started');
    expect(() => assertTsaActivatable({ startDate: '2026-09-30', today: '2026-09-30' })).not.toThrow();
    expect(statusAfterRemedy('extended')).toBe('extended');
    expect(statusAfterRemedy('exit_in_progress')).toBe('exit_in_progress');
    expect(statusAfterRemedy(null)).toBe('active');
    expect(statusAfterRemedy('breached')).toBe('active');
    expect(transition('tsa', TSA_MACHINE, 'breached', 'accelerate_exit')).toBe('exit_in_progress');
    expect(() => transition('tsa', TSA_MACHINE, 'active', 'accelerate_exit')).toThrow();
  });
  it('REQ-TSA-006: approveTSAExit without acceptance evidence is rejected; the approver is independent', () => {
    expect(codeOf(() => assertTsaExitAcceptable({ replacementAccepted: true, acceptanceEvidenceCount: 0 }))).toBe('rule_violation:tsa.exit_not_evidenced');
    expect(() => assertTsaExitAcceptable({ replacementAccepted: true, acceptanceEvidenceCount: 1 })).not.toThrow();
    expect(codeOf(() => assertTsaExitApprovalSeparation({ approverUserId: 'o', requesterUserId: 'r', ownerUserId: 'o', replacementAcceptedBy: 'x' }))).toBe('forbidden:tsa.exit.self_approval');
    expect(codeOf(() => assertTsaExitApprovalSeparation({ approverUserId: 'x', requesterUserId: 'r', ownerUserId: 'o', replacementAcceptedBy: 'x' }))).toBe('forbidden:tsa.exit.self_approval');
    expect(() => assertTsaExitApprovalSeparation({ approverUserId: 'a', requesterUserId: 'r', ownerUserId: 'o', replacementAcceptedBy: 'x' })).not.toThrow();
  });
  it('replacement acceptance needs evidence; exit start needs a replacement plan', () => {
    const r = { status: 'exit_in_progress' as const, replacementService: 'NewCo NOC', replacementAccepted: false, activeEvidenceCount: 1, conflictingEvidenceCount: 0, note: 'Accepted (synthetic)' };
    expect(() => assertReplacementAcceptable(r)).not.toThrow();
    expect(codeOf(() => assertReplacementAcceptable({ ...r, activeEvidenceCount: 0 }))).toBe('rule_violation:tsa.replacement.no_evidence');
    expect(codeOf(() => assertReplacementAcceptable({ ...r, status: 'proposed' }))).toBe('rule_violation:tsa.replacement.invalid_state');
    expect(codeOf(() => assertTsaExitStartable({ replacementService: null }))).toBe('rule_violation:tsa.exit.no_replacement_plan');
  });
});

describe('DOM-P34R-01 — the plan\'s site is a scope command', () => {
  const failed = { id: 'c1', code: 'RC-001', status: 'failed' as const, gating: true, cleared: false };
  it('reason required; only before the go/no-go; refused while a FAILED gating check would stop gating the plan', () => {
    expect(codeOf(() => assertCutoverPlanSiteChange({ planCode: 'CO-1', planStatus: 'planning', reason: ' ', leaving: [] }))).toBe('rule_violation:readiness.cutover.site_reason_required');
    for (const planStatus of ['ready_for_decision', 'approved_go', 'executed'] as const) {
      expect(codeOf(() => assertCutoverPlanSiteChange({ planCode: 'CO-1', planStatus, reason: 'r', leaving: [] }))).toBe('rule_violation:readiness.cutover.locked');
    }
    expect(codeOf(() => assertCutoverPlanSiteChange({ planCode: 'CO-1', planStatus: 'rehearsal', reason: 'r', leaving: [failed] }))).toBe('rule_violation:readiness.cutover.site_change_failed_check');
    // An open (not failed) check, or a non-gating one, may leave a plan before its go/no-go.
    expect(() => assertCutoverPlanSiteChange({ planCode: 'CO-1', planStatus: 'planning', reason: 'r', leaving: [{ ...failed, status: 'in_progress' }] })).not.toThrow();
    expect(() => assertCutoverPlanSiteChange({ planCode: 'CO-1', planStatus: 'planning', reason: 'r', leaving: [{ ...failed, gating: false }] })).not.toThrow();
  });
});
