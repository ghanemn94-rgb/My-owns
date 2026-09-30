import { forbidden, ruleViolation } from './errors';
import { formatMessage, serverMessage, type ServerMessage } from './messages';
import { canonicalJson } from './canonical';
import { externalApprovalEvidenceIssue, type ExternalEvidenceState } from './decision-reliance';
import type { CriterionStatus, GateAssessmentStatus, DecisionStatus, DecisionAuthorityOutcome, GateReviewOutcome, GateReviewState } from './enums';

/**
 * Gate evaluation (spec §3). A gate is ready for decision only when every mandatory criterion is met with
 * accepted evidence (or legitimately waived / marked not applicable by the authorized specialist) and all
 * prerequisite gates are approved. Task completion percentages are deliberately NOT an input.
 */
export interface CriterionState {
  key: string;
  mandatory: boolean;
  blocking: boolean;
  waivable: boolean;
  evidenceRequired: boolean;
  status: CriterionStatus;
  activeEvidenceCount: number;
  conflictingEvidenceCount: number;
  /** Set when status = waived: the approved waiver id. */
  approvedWaiverId?: string | null;
  /**
   * Set when status = not_applicable: the recorded specialist determination (who, basis, approved). Without an
   * approved determination "not applicable" does NOT satisfy the criterion (P0 review D-01).
   */
  naDetermination?: { approved: boolean; basis: string; byUserId: string } | null;
}

export interface GateEvaluationInput {
  criteria: CriterionState[];
  prerequisites: { gateKey: string; status: GateAssessmentStatus | 'none' }[];
}

export interface GateBlocker {
  kind: 'criterion' | 'prerequisite' | 'evidence_conflict' | 'decision';
  ref: string;
  /** English sentence (kept for problem details, audit and AI context); rendered from `messageI18n`. */
  message: string;
  /** The same sentence as a translatable code + parameters (QA-P1-14); clients translate `gates.messages.<code>`. */
  messageI18n: ServerMessage[];
}

/**
 * English templates of every gate blocker code. The web catalogue (`gates.messages.gate.*`, en + ar) carries the same codes
 * and placeholders. `{status}` is a decision status enum value.
 */
export const GATE_MESSAGES_EN: Readonly<Record<string, string>> = {
  'gate.blocker.evidence_conflict': 'Criterion {criterion} has conflicting evidence requiring reassessment',
  'gate.blocker.met_without_evidence': 'Criterion {criterion} is marked met but has no active evidence',
  'gate.blocker.waiver_invalid': 'Criterion {criterion} waiver is not valid',
  'gate.blocker.not_applicable_undetermined': 'Criterion {criterion} is marked not applicable without an approved specialist determination',
  'gate.blocker.criterion_unmet': 'Mandatory criterion {criterion} is not met',
  'gate.blocker.prerequisite_not_approved': 'Prerequisite gate {gate} is not approved',
  'gate.blocker.no_decision': 'No approved governance decision is linked to gate {gate}',
  'gate.blocker.decision_other_gate': 'The linked decision was raised for gate {decisionGate}, not {gate}',
  'gate.blocker.decision_recommended': 'The linked decision is recommended — pending the external authority; it is not a final approval and the gate stays blocked',
  'gate.blocker.decision_not_approved': 'The linked decision is {status}; only an approved decision can back a gate approval',
  'gate.blocker.decision_external_unrecorded': 'The linked decision is outside the committee delegation and no approval by the authorized body is recorded',
  // DOM-P2R-04: the external approval counts only while its evidence link is active and verified.
  'gate.blocker.decision_external_evidence_missing': 'The approval by the authorized body recorded on the linked decision has no evidence link; it cannot back the gate',
  'gate.blocker.decision_external_evidence_invalid': 'The evidence of the approval by the authorized body recorded on the linked decision is now {status}; the decision no longer backs the gate',
  'gate.blocker.decision_external_evidence_unverified': 'The evidence of the approval by the authorized body recorded on the linked decision is not verified by a second person',
  'gate.blocker.decision_no_authority': 'The linked decision has no authority assessment (within mandate / external authority)',
  // DOM-P2-01: the decision must be of a type the approved authority matrix assigns to THIS gate.
  'gate.blocker.decision_no_gate': 'The linked decision was not raised for a gate; only a decision raised for gate {gate} can back it',
  'gate.blocker.decision_no_matrix': 'The deciding committee has no approved authority matrix, so its decision cannot back gate {gate}',
  'gate.blocker.decision_type_missing': 'The linked decision has no decision type; the approved authority matrix must assign its type to gate {gate}',
  'gate.blocker.decision_type_unknown': 'Decision type {decisionType} is not in the approved authority matrix of the deciding committee',
  'gate.blocker.decision_type_not_for_gate': 'The approved authority matrix does not assign decision type {decisionType} to gate {gate}',
  'gate.blocker.decision_body_not_authorized': 'Decision type {decisionType} is reserved to a higher authority; the committee approval alone cannot back gate {gate}',
};

function blocker(kind: GateBlocker['kind'], ref: string, code: string, params: Record<string, string | number> = {}): GateBlocker {
  const template = GATE_MESSAGES_EN[code];
  if (template === undefined) throw new Error(`No English template for message code ${code}`);
  return { kind, ref, message: formatMessage(template, params), messageI18n: [serverMessage(code, params)] };
}

export interface GateEvaluation {
  ready: boolean;
  hasWaivers: boolean;
  blockers: GateBlocker[];
  /** `blockingUnmet` = blocking criteria not satisfied (forces the gate RAG to red — business-gates.md §2.1). */
  counts: { total: number; mandatory: number; met: number; waived: number; notApplicable: number; unmet: number; blockingUnmet: number };
}

const APPROVED: (GateAssessmentStatus | 'none')[] = ['approved', 'approved_with_exceptions'];

export function evaluateGate(input: GateEvaluationInput): GateEvaluation {
  const blockers: GateBlocker[] = [];
  let met = 0, waived = 0, na = 0, unmet = 0, blockingUnmet = 0;
  for (const c of input.criteria) {
    const conflicting = c.conflictingEvidenceCount > 0 || c.status === 'conflicting';
    if (conflicting) {
      blockers.push(blocker('evidence_conflict', c.key, 'gate.blocker.evidence_conflict', { criterion: c.key }));
    }
    let satisfied = false;
    switch (c.status) {
      case 'met':
        if (c.evidenceRequired && c.activeEvidenceCount === 0) {
          unmet++;
          if (c.mandatory || c.blocking) blockers.push(blocker('criterion', c.key, 'gate.blocker.met_without_evidence', { criterion: c.key }));
        } else {
          met++;
          satisfied = true;
        }
        break;
      case 'waived':
        if (!c.waivable || !c.approvedWaiverId) {
          unmet++;
          if (c.mandatory || c.blocking) blockers.push(blocker('criterion', c.key, 'gate.blocker.waiver_invalid', { criterion: c.key }));
        } else {
          waived++;
          satisfied = true;
        }
        break;
      case 'not_applicable':
        if (!c.naDetermination?.approved || !c.naDetermination.basis.trim()) {
          unmet++;
          if (c.mandatory || c.blocking) {
            blockers.push(blocker('criterion', c.key, 'gate.blocker.not_applicable_undetermined', { criterion: c.key }));
          }
        } else {
          na++;
          satisfied = true;
        }
        break;
      default:
        unmet++;
        if (c.mandatory || c.blocking) blockers.push(blocker('criterion', c.key, 'gate.blocker.criterion_unmet', { criterion: c.key }));
    }
    if (c.blocking && (!satisfied || conflicting)) blockingUnmet++;
  }
  for (const p of input.prerequisites) {
    if (!APPROVED.includes(p.status)) {
      blockers.push(blocker('prerequisite', p.gateKey, 'gate.blocker.prerequisite_not_approved', { gate: p.gateKey }));
    }
  }
  return {
    ready: blockers.length === 0,
    hasWaivers: waived > 0,
    blockers,
    counts: {
      total: input.criteria.length,
      mandatory: input.criteria.filter((c) => c.mandatory).length,
      met,
      waived,
      notApplicable: na,
      unmet,
      blockingUnmet,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Assessment lifecycle guards used by the gates command service

/** Assessments whose status and decision are final for their cycle (never modified afterwards — reopen creates a new cycle). */
export const DECIDED_GATE_STATUSES: readonly GateAssessmentStatus[] = ['approved', 'approved_with_exceptions', 'rejected'];
export const APPROVED_GATE_STATUSES: readonly GateAssessmentStatus[] = ['approved', 'approved_with_exceptions'];
/**
 * Criterion assessments may be changed only while the cycle is being assessed. From `ready_for_decision` the owner must
 * first send the gate back to assessment (explicit command), so a decision is never taken on a moving target.
 */
export const CRITERION_EDITABLE_GATE_STATUSES: readonly GateAssessmentStatus[] = ['not_started', 'in_assessment', 'reopened'];

export function assertCriterionEditable(gateKey: string, status: GateAssessmentStatus): void {
  if (!CRITERION_EDITABLE_GATE_STATUSES.includes(status)) {
    throw ruleViolation(
      'gates.assessment.not_editable',
      status === 'ready_for_decision'
        ? `Gate ${gateKey} is ready for decision — send it back to assessment before changing criteria`
        : `Gate ${gateKey} assessment is ${status}; criteria of a decided cycle are preserved (use the controlled reopen)`,
      { status },
    );
  }
}

/**
 * Decision states that are a final approval. Approval ≠ implementation (spec §4.2): the implementation-tracking states
 * that follow `approved` are still approved decisions.
 */
export const FINAL_APPROVED_DECISION_STATUSES: readonly DecisionStatus[] = ['approved', 'implementation_pending', 'implemented_verified'];

export interface GateDecisionBacking {
  id: string;
  status: DecisionStatus;
  authorityOutcome: DecisionAuthorityOutcome;
  /** Reference of the external authority's approval (recorded when a recommendation was approved by the authorized body). */
  externalAuthorityReference?: string | null;
  /** Gate the decision was raised for (decision.gate_key), when set. */
  gateKey?: string | null;
  /** Decision type key (decision.decision_type_key). Required by `gateApprovalDecisionIssue`. */
  decisionTypeKey?: string | null;
  /**
   * The evidence link of the external approval as it is NOW (DOM-P2R-04). Required when the decision was approved by the
   * external authority: missing, inactive or unverified evidence keeps the decision from backing anything (fail closed).
   */
  externalEvidence?: ExternalEvidenceState | null;
}

/** Blocker codes about the evidence of a recorded external approval (DOM-P2R-04). */
export const GATE_DECISION_EVIDENCE_CODES: readonly string[] = [
  'gate.blocker.decision_external_evidence_missing',
  'gate.blocker.decision_external_evidence_invalid',
  'gate.blocker.decision_external_evidence_unverified',
];

/**
 * A decision type row of an approved authority matrix, as far as gate approvals are concerned (authority-matrix.md §2.2,
 * DOM-P2-01): the gates whose passage this type may approve (`gateKeys`) and whether the committee may give the final
 * approval itself (`withinCommitteeAuthority = false` → reserved to `escalateTo`; the committee only recommends).
 */
export interface GateAuthorityDecisionType {
  key: string;
  gateKeys: readonly string[];
  withinCommitteeAuthority: boolean;
}

/**
 * The authority under which a decision can back a gate: the approved matrix version of the DECIDING committee (the version
 * recorded with the committee outcome, or — before an outcome — the committee's approved matrix) and the decision's type in
 * it. Always passed explicitly; a missing matrix or type fails closed.
 */
export interface GateDecisionAuthority {
  matrixVersionId: string | null;
  decisionType: GateAuthorityDecisionType | null;
}

/**
 * Looks the decision type up in an approved authority matrix policy. A type row without `gateKeys` approves no gate
 * (fail closed — matrices approved before gate assignments existed must be amended to back gates).
 */
export function gateAuthorityOf(
  matrix: { id: string; policy: { decisionTypes?: readonly { key: string; gateKeys?: readonly string[] | null; withinCommitteeAuthority: boolean }[] } } | null,
  decisionTypeKey: string | null | undefined,
): GateDecisionAuthority {
  if (!matrix) return { matrixVersionId: null, decisionType: null };
  const t = decisionTypeKey ? (matrix.policy.decisionTypes ?? []).find((x) => x.key === decisionTypeKey) : undefined;
  return {
    matrixVersionId: matrix.id,
    decisionType: t ? { key: t.key, gateKeys: [...(t.gateKeys ?? [])], withinCommitteeAuthority: t.withinCommitteeAuthority === true } : null,
  };
}

/** Blocker codes meaning "this decision can never back this gate" (as opposed to "not final yet"). */
export const GATE_DECISION_NOT_FOR_GATE_CODES: readonly string[] = [
  'gate.blocker.decision_no_gate',
  'gate.blocker.decision_other_gate',
  'gate.blocker.decision_no_matrix',
  'gate.blocker.decision_type_missing',
  'gate.blocker.decision_type_unknown',
  'gate.blocker.decision_type_not_for_gate',
  'gate.blocker.decision_body_not_authorized',
];

export const isNotForGateBlocker = (b: GateBlocker | null): boolean => !!b && GATE_DECISION_NOT_FOR_GATE_CODES.includes(b.messageI18n[0]?.code ?? '');

/**
 * AT-04: a gate approval must be backed by a FINAL governance decision. A decision that is only `recommended` (outside the
 * committee's delegation, pending the external authority), still in review, deferred, rejected or superseded keeps the
 * gate blocked. A decision is final when approved within the committee mandate, or when the authorized body approved a
 * recommendation (status approved + external approval reference recorded — governance.assertApprovalAllowed).
 * Returns null when the decision can back the approval, otherwise the blocker.
 */
export function gateDecisionIssue(d: GateDecisionBacking | null, gateKey: string): GateBlocker | null {
  if (!d) return blocker('decision', gateKey, 'gate.blocker.no_decision', { gate: gateKey });
  if (d.gateKey && d.gateKey !== gateKey) return blocker('decision', d.id, 'gate.blocker.decision_other_gate', { decisionGate: d.gateKey, gate: gateKey });
  if (!FINAL_APPROVED_DECISION_STATUSES.includes(d.status)) {
    return d.status === 'recommended'
      ? blocker('decision', d.id, 'gate.blocker.decision_recommended')
      : blocker('decision', d.id, 'gate.blocker.decision_not_approved', { status: d.status });
  }
  if (d.authorityOutcome === 'within_mandate') return null;
  if (d.authorityOutcome === 'pending_external_authority' && d.externalAuthorityReference?.trim()) {
    // DOM-P2R-04: the external approval is final only while its evidence is still active and verified.
    const ev = externalApprovalEvidenceIssue(d);
    if (!ev) return null;
    if (ev.kind === 'missing') return blocker('decision', d.id, 'gate.blocker.decision_external_evidence_missing');
    if (ev.kind === 'not_active') return blocker('decision', d.id, 'gate.blocker.decision_external_evidence_invalid', { status: ev.status });
    return blocker('decision', d.id, 'gate.blocker.decision_external_evidence_unverified');
  }
  return d.authorityOutcome === 'pending_external_authority'
    ? blocker('decision', d.id, 'gate.blocker.decision_external_unrecorded')
    : blocker('decision', d.id, 'gate.blocker.decision_no_authority');
}

/**
 * DOM-P2-01 (spec §4.2 "approval interfaces enforcing delegated authority", AT-04, REQ-GOV-003/022/023): the decision that
 * backs a GATE approval must
 *  1. have been raised for this gate (`gateKey` = the gate; a decision without a gate key backs no gate);
 *  2. be final (`gateDecisionIssue`: approved within the mandate, or a recommendation approved by the authorized body);
 *  3. be of a decision type that the deciding committee's approved authority matrix assigns to this gate (`gateKeys`) —
 *     e.g. the operational gate type (G1–G4, G7) can never back G0 ("the committee cannot approve its own mandate");
 *  4. have been decided by the body holding that authority: a type reserved to a higher authority
 *     (`withinCommitteeAuthority = false`) backs the gate only through the recorded external approval, never through a
 *     committee approval "within mandate".
 * Returns null when the decision can back the gate approval, otherwise the blocker (checked in this order).
 */
export function gateApprovalDecisionIssue(d: GateDecisionBacking | null, gateKey: string, authority: GateDecisionAuthority | null): GateBlocker | null {
  if (!d) return blocker('decision', gateKey, 'gate.blocker.no_decision', { gate: gateKey });
  const key = gateKeyIssue(d, gateKey);
  if (key) return key;
  const finality = gateDecisionIssue(d, gateKey);
  if (finality) return finality;
  const type = gateDecisionTypeIssue(d, gateKey, authority);
  if (type) return type;
  const t = authority!.decisionType!;
  if (!t.withinCommitteeAuthority && d.authorityOutcome !== 'pending_external_authority') {
    return blocker('decision', d.id, 'gate.blocker.decision_body_not_authorized', { decisionType: t.key, gate: gateKey });
  }
  return null;
}

function gateKeyIssue(d: GateDecisionBacking, gateKey: string): GateBlocker | null {
  if (!d.gateKey) return blocker('decision', d.id, 'gate.blocker.decision_no_gate', { gate: gateKey });
  if (d.gateKey !== gateKey) return blocker('decision', d.id, 'gate.blocker.decision_other_gate', { decisionGate: d.gateKey, gate: gateKey });
  return null;
}

/**
 * The part of `gateApprovalDecisionIssue` that does not depend on the decision's progress: gate key, approved matrix of the
 * deciding committee, and a decision type that matrix assigns to this gate. Used when LINKING a decision to a gate cycle, so
 * a decision that can never back the gate is refused up front.
 */
export function gateDecisionTypeIssue(d: GateDecisionBacking, gateKey: string, authority: GateDecisionAuthority | null): GateBlocker | null {
  const key = gateKeyIssue(d, gateKey);
  if (key) return key;
  if (!authority?.matrixVersionId) return blocker('decision', d.id, 'gate.blocker.decision_no_matrix', { gate: gateKey });
  if (!d.decisionTypeKey) return blocker('decision', d.id, 'gate.blocker.decision_type_missing', { gate: gateKey });
  const t = authority.decisionType;
  if (!t || t.key !== d.decisionTypeKey) return blocker('decision', d.id, 'gate.blocker.decision_type_unknown', { decisionType: d.decisionTypeKey });
  if (!t.gateKeys.includes(gateKey)) return blocker('decision', d.id, 'gate.blocker.decision_type_not_for_gate', { decisionType: t.key, gate: gateKey });
  return null;
}

export type GateDecisionOutcome = 'approve' | 'approve_with_exceptions' | 'reject';

/**
 * Guard for the gate decision command (server-side re-evaluation at decision time; spec §3 "Task completion reaching 100%
 * does not unlock a gate. Validate evidence, approvals, and mandatory criteria on the server").
 */
export function assertGateDecisionAllowed(input: {
  gateKey: string;
  outcome: GateDecisionOutcome;
  evaluation: GateEvaluation;
  decision: GateDecisionBacking | null;
  /** Authority of the deciding committee for this decision (DOM-P2-01) — always passed explicitly (null fails closed). */
  authority: GateDecisionAuthority | null;
  /**
   * Decisions linked to an earlier cycle of the same gate — approved OR rejected (O-1 of the P2 QA review: a decision that
   * backed a rejected cycle cannot back a later cycle either; proposed, pending the governance owner). A reopened gate needs
   * a fresh decision.
   */
  decisionIdsUsedByPriorCycles: string[];
  /**
   * QA-P2-03: the gate reviewer's review state of the cycle NOW (`gateReviewState` against the current criterion basis). An
   * approval is decided only on the state the reviewer endorsed; omitted (legacy callers) = not checked.
   */
  reviewState?: GateReviewState;
  note: string;
}): void {
  if (input.outcome === 'reject') {
    if (!input.note.trim()) throw ruleViolation('gates.decide.missing_reason', 'A gate rejection requires a recorded reason');
    return;
  }
  if (!input.evaluation.ready) {
    throw ruleViolation('gates.decide.not_ready', `Gate ${input.gateKey} is not ready at decision time`, { blockers: input.evaluation.blockers });
  }
  if (input.reviewState !== undefined && input.reviewState !== 'endorsed') {
    throw ruleViolation(
      'gates.assessment.review_stale',
      `The criteria of gate ${input.gateKey} changed after the gate reviewer's endorsement (evidence, status, waiver or applicability); the owner sends the gate back to assessment for a fresh review before it is decided`,
      { reviewState: input.reviewState },
    );
  }
  const issue = gateApprovalDecisionIssue(input.decision, input.gateKey, input.authority);
  if (issue) {
    const code = issue.messageI18n[0]?.code ?? '';
    throw ruleViolation(isNotForGateBlocker(issue) ? 'gates.decide.decision_not_for_gate' : GATE_DECISION_EVIDENCE_CODES.includes(code) ? 'gates.decide.decision_evidence_invalid' : 'gates.decide.decision_not_final', issue.message, {
      decisionId: input.decision?.id ?? null,
      decisionStatus: input.decision?.status ?? null,
      authorityOutcome: input.decision?.authorityOutcome ?? null,
      decisionTypeKey: input.decision?.decisionTypeKey ?? null,
      messageI18n: issue.messageI18n,
    });
  }
  if (input.decision && input.decisionIdsUsedByPriorCycles.includes(input.decision.id)) {
    throw ruleViolation('gates.decide.decision_reused', 'This decision already backed an earlier cycle of the gate; a reopened gate needs a fresh decision');
  }
  if (input.outcome === 'approve_with_exceptions' && !input.evaluation.hasWaivers) {
    throw ruleViolation('gates.decide.no_exceptions', 'Approve with exceptions requires at least one approved waiver');
  }
  if (input.outcome === 'approve' && input.evaluation.hasWaivers) {
    throw ruleViolation('gates.decide.exceptions_present', 'Approved waivers exist — record the decision as approved with exceptions so the exceptions stay visible');
  }
}

/**
 * Gate RAG from criteria and blockers only (never from task progress or the workstream average — spec §9 rule 3).
 */
export function gateRag(status: GateAssessmentStatus, evaluation: GateEvaluation, needsReassessment: boolean): 'green' | 'amber' | 'red' {
  if (needsReassessment) return 'red';
  if (APPROVED_GATE_STATUSES.includes(status)) return 'green';
  if (status === 'rejected') return 'red';
  if (evaluation.blockers.some((b) => b.kind === 'evidence_conflict') || evaluation.counts.blockingUnmet > 0) return 'red';
  if (evaluation.ready) return 'green';
  return 'amber';
}

/** A waiver counts only when approved and not past its expiry (business date, inclusive). */
export function waiverIsEffective(w: { status: string; expiresOn: string | null } | null | undefined, today: string): boolean {
  return !!w && w.status === 'approved' && (!w.expiresOn || w.expiresOn >= today);
}

export interface PriorCriterionAssessment {
  criterionId: string;
  status: CriterionStatus;
  waiverId: string | null;
}

/**
 * Criterion states of a new (reopened) cycle. The prior cycle is never modified; the new cycle starts from its states
 * except: criteria whose evidence is now conflicting → `conflicting`; criteria named by the reopener → `unmet` (re-review);
 * a prior `conflicting` state that is no longer conflicting → `unmet` (must be re-assessed, never silently "met").
 */
export function carryForwardCriteria(
  prior: PriorCriterionAssessment[],
  opts: { conflictingCriterionIds: ReadonlySet<string>; resetCriterionIds: ReadonlySet<string> },
): { criterionId: string; status: CriterionStatus; waiverId: string | null; carriedFrom: CriterionStatus }[] {
  return prior.map((p) => {
    let status: CriterionStatus = p.status;
    if (opts.conflictingCriterionIds.has(p.criterionId)) status = 'conflicting';
    else if (opts.resetCriterionIds.has(p.criterionId) || p.status === 'conflicting') status = 'unmet';
    return { criterionId: p.criterionId, status, waiverId: status === 'waived' ? p.waiverId : null, carriedFrom: p.status };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Evidence changes → controlled reassessment (spec §3 "If approved evidence is found defective, reopen the assessment
// through a controlled process", §14, AT-14, REQ-LCY-015, REQ-DAT-014; DOM-P2-05)

export const REASSESSMENT_REASONS = ['evidence_conflict', 'evidence_defective', 'evidence_superseded'] as const;
export type ReassessmentReason = (typeof REASSESSMENT_REASONS)[number];

/** Criterion states whose evidence was relied upon (a change of that evidence invalidates them). */
export const EVIDENCE_RELIANT_CRITERION_STATUSES: readonly CriterionStatus[] = ['met', 'evidence_submitted'];

export interface CriterionEvidenceLink {
  id: string;
  status: 'active' | 'conflicting' | 'rejected' | 'superseded';
  /** Epoch ms the link was added. */
  createdAtMs: number;
  /** Epoch ms of the last verification decision (accept / reject), null when never verified. */
  reviewedAtMs: number | null;
}

/**
 * Why a criterion of a DECIDED, approved cycle needs a controlled reassessment — or null. The decided cycle itself is never
 * modified; the caller flags it (reassessment flags, escalation, notifications, outbox) and downstream approved gates.
 *  - conflicting evidence → `evidence_conflict` (AT-14);
 *  - a link relied upon at the decision (`reliedLinkIds`, recorded in the decision snapshot) is now rejected — found
 *    defective by verification → `evidence_defective`; now superseded → `evidence_superseded` (REQ-DAT-014);
 *  - cycles decided before relied-upon link ids were recorded (`reliedLinkIds = null`): required evidence with no active
 *    link left → `evidence_defective` when a link was rejected, otherwise `evidence_superseded`.
 * Only criteria that relied on evidence (met / evidence_submitted in the decided cycle) are concerned.
 */
export function decidedCriterionReassessment(c: {
  status: CriterionStatus;
  evidenceRequired: boolean;
  reliedLinkIds: readonly string[] | null;
  links: readonly CriterionEvidenceLink[];
}): { reason: ReassessmentReason; linkIds: string[] } | null {
  if (!EVIDENCE_RELIANT_CRITERION_STATUSES.includes(c.status)) return null;
  const conflicting = c.links.filter((l) => l.status === 'conflicting');
  if (conflicting.length) return { reason: 'evidence_conflict', linkIds: conflicting.map((l) => l.id) };
  if (c.reliedLinkIds) {
    const relied = c.links.filter((l) => c.reliedLinkIds!.includes(l.id));
    const rejected = relied.filter((l) => l.status === 'rejected');
    if (rejected.length) return { reason: 'evidence_defective', linkIds: rejected.map((l) => l.id) };
    const superseded = relied.filter((l) => l.status === 'superseded');
    if (superseded.length) return { reason: 'evidence_superseded', linkIds: superseded.map((l) => l.id) };
    return null;
  }
  if (c.evidenceRequired && !c.links.some((l) => l.status === 'active')) {
    const rejected = c.links.filter((l) => l.status === 'rejected');
    if (rejected.length) return { reason: 'evidence_defective', linkIds: rejected.map((l) => l.id) };
    const superseded = c.links.filter((l) => l.status === 'superseded');
    return { reason: 'evidence_superseded', linkIds: superseded.map((l) => l.id) };
  }
  return null;
}

/**
 * On an UNDECIDED cycle: a criterion the designated reviewer accepted as met, whose accepted evidence was afterwards
 * rejected as defective, must be re-reviewed. Returns the ids of the links that existed when the criterion was accepted
 * and were rejected after it (empty = nothing to do).
 */
export function evidenceRejectedSinceAcceptance(c: { status: CriterionStatus; assessedAtMs: number | null; links: readonly CriterionEvidenceLink[] }): string[] {
  if (c.status !== 'met' || c.assessedAtMs === null) return [];
  const at = c.assessedAtMs;
  return c.links.filter((l) => l.status === 'rejected' && l.createdAtMs <= at && l.reviewedAtMs !== null && l.reviewedAtMs >= at).map((l) => l.id);
}

// ---------------------------------------------------------------------------------------------------------
// Specialist determinations (spec §3 "Authorized specialists determine waivability and waiver authority", REQ-LCY-005;
// DOM-P2-15)

/**
 * The specialist role designated to determine a criterion's waivability: the criterion's reviewer role when that role is a
 * waivability specialist (holds `gates.criterion.set_waivability`), otherwise the functional approver (the platform's
 * generic functional specialist). Only that role may make the determination.
 */
export function designatedWaivabilityRole(reviewerRole: string, specialistRoles: readonly string[]): string {
  return specialistRoles.includes(reviewerRole) ? reviewerRole : 'functional_approver';
}

/** Waivability is determined by the designated specialist only, and only while the gate cycle is being assessed. */
export function assertWaivabilityDeterminer(input: { criterionKey: string; designatedRole: string; actorRoles: readonly string[]; gateKey: string; gateStatus: GateAssessmentStatus }): void {
  if (!input.actorRoles.includes(input.designatedRole)) {
    throw forbidden('gates.waivability.not_designated_specialist', `Only the designated specialist role (${input.designatedRole}) may determine the waivability of ${input.criterionKey}`);
  }
  assertCriterionEditable(input.gateKey, input.gateStatus);
}

/** Whether a role may approve waivers at all (waiver authority must be a role holding the approve permission). */
export function assertWaivabilityDetermination(input: { waivable: boolean; waiverAuthorityRole: string | null; basis: string; authorityRoleCanApprove: boolean }): void {
  if (!input.basis.trim()) throw ruleViolation('gates.waivability.missing_basis', 'A waivability determination requires a documented specialist basis');
  if (input.waivable) {
    if (!input.waiverAuthorityRole) throw ruleViolation('gates.waivability.missing_authority', 'A waivable criterion must name the waiver authority role');
    if (!input.authorityRoleCanApprove) {
      throw ruleViolation('gates.waivability.invalid_authority', `Role ${input.waiverAuthorityRole} cannot approve waivers under the policy matrix`);
    }
  }
}

/** AT-13: non-waivable conditions cannot be waived; waivers need an authorized approver distinct from requester. */
export function assertWaiverAllowed(input: {
  criterionKey: string;
  waivable: boolean;
  waiverAuthorityRole: string | null;
  approverRoles: string[];
  approverUserId: string;
  requesterUserId: string;
  basis: string;
  impact: string;
}): void {
  if (!input.waivable) {
    throw ruleViolation('gates.waiver.non_waivable', `Criterion ${input.criterionKey} is not waivable`);
  }
  if (!input.waiverAuthorityRole || !input.approverRoles.includes(input.waiverAuthorityRole)) {
    throw ruleViolation('gates.waiver.unauthorized', `Waiver requires the ${input.waiverAuthorityRole ?? 'designated'} authority`);
  }
  if (input.approverUserId === input.requesterUserId) {
    throw ruleViolation('gates.waiver.self_approval', 'The waiver requester cannot approve their own waiver');
  }
  if (!input.basis.trim() || !input.impact.trim()) {
    throw ruleViolation('gates.waiver.missing_basis', 'A waiver requires a documented basis and impact');
  }
}

/**
 * "Not applicable" is a specialist determination distinct from a waiver: it needs a documented basis, must be made by
 * the criterion's reviewer role, and cannot be made by the person who proposed it (P0 review D-01).
 */
export function assertNotApplicableAllowed(input: {
  criterionKey: string;
  reviewerRole: string;
  determinerRoles: string[];
  determinerUserId: string;
  proposerUserId: string;
  basis: string;
}): void {
  if (!input.basis.trim()) throw ruleViolation('gates.na.missing_basis', 'A not-applicable determination requires a documented basis');
  if (!input.determinerRoles.includes(input.reviewerRole)) {
    throw ruleViolation('gates.na.unauthorized', `Only the ${input.reviewerRole} role may determine ${input.criterionKey} not applicable`);
  }
  if (input.determinerUserId === input.proposerUserId) {
    throw ruleViolation('gates.na.self_approval', 'The proposer cannot approve their own not-applicable determination');
  }
}

/**
 * Controlled reopen (spec §3, P0 review D-09): the approved/rejected assessment is NEVER modified; a new assessment
 * cycle is created in status "reopened" that supersedes it.
 */
export function planReopen(prev: { id: string; cycle: number; status: string }, reason: string) {
  if (!['approved', 'approved_with_exceptions', 'rejected'].includes(prev.status)) {
    throw ruleViolation('gates.reopen.invalid_state', `Only decided assessments can be reopened (current: ${prev.status})`);
  }
  if (!reason.trim()) throw ruleViolation('gates.reopen.missing_reason', 'Reopening requires a reason (e.g. evidence found defective)');
  return { cycle: prev.cycle + 1, supersedesAssessmentId: prev.id, status: 'reopened' as const, reason };
}

// ---------------------------------------------------------------------------------------------------------
// Gate roles and the gate-level review (spec §3 "Each gate must have … owner, reviewer, approver"; REQ-LCY-010;
// DOM-P2-16 — docs/governance/business-gates.md §2.4)
//
//  - OWNER: the gate's `ownerRole` (or the project manager — access-matrix §2.4 `own_workstream`) starts the cycle,
//    links the backing decision, submits the cycle for decision (mark-ready) and sends it back to assessment.
//  - REVIEWER: the gate's `reviewerRole` endorses or returns the owner's assessment while the cycle is in assessment.
//    Separation of duties: never the person who started the cycle, and the person who submits the cycle is never the
//    reviewer whose endorsement it relies on.
//  - APPROVER: the gate's `approverRole` decides; never the submitter nor the gate reviewer.

/**
 * REQ-LCY-010 "Each gate has … owner, reviewer, approver" (AT: a gate without an approver cannot be assessed; security rule:
 * owner, reviewer and approver distinct): the three roles are present, distinct, and hold their gate permissions under the
 * policy matrix. Checked when a cycle is started (422 `gates.definition.roles_incomplete`), so a misconfigured gate
 * definition fails closed instead of producing a cycle nobody can review or decide.
 */
export function assertGateRolesComplete(
  gate: { key: string; ownerRole: string | null | undefined; reviewerRole: string | null | undefined; approverRole: string | null | undefined },
  permissionsOfRole: (role: string) => readonly string[],
): void {
  const needs = [
    ['owner', gate.ownerRole, 'gates.assessment.submit'],
    ['reviewer', gate.reviewerRole, 'gates.assessment.review'],
    ['approver', gate.approverRole, 'gates.assessment.decide'],
  ] as const;
  const problems: string[] = [];
  for (const [what, role, permission] of needs) {
    if (!role) problems.push(`no ${what} role`);
    else if (!permissionsOfRole(role).includes(permission)) problems.push(`${what} role ${role} does not hold ${permission}`);
  }
  const present = needs.map(([, role]) => role).filter((r): r is string => !!r);
  if (new Set(present).size < present.length) problems.push('owner, reviewer and approver roles must be distinct');
  if (problems.length) throw ruleViolation('gates.definition.roles_incomplete', `Gate ${gate.key} cannot be assessed: ${problems.join('; ')}`, { problems });
}

/** The gate reviewer may review a cycle only while it is under assessment. */
export const GATE_REVIEWABLE_STATUSES: readonly GateAssessmentStatus[] = ['in_assessment'];

export function assertGateReviewable(gateKey: string, status: GateAssessmentStatus): void {
  if (!GATE_REVIEWABLE_STATUSES.includes(status)) {
    throw ruleViolation(
      'gates.review.invalid_state',
      status === 'ready_for_decision'
        ? `Gate ${gateKey} is already submitted for decision — the owner must send it back to assessment before it can be reviewed again`
        : `Gate ${gateKey} assessment is ${status}; only a cycle in assessment can be reviewed`,
      { status },
    );
  }
}

/**
 * The owner's assessment of the criteria is complete: no criterion or evidence-conflict blocker is left. Prerequisite
 * gates are not part of it (they are sequencing, checked again at mark-ready and at decision time).
 */
export function gateCriteriaComplete(evaluation: GateEvaluation): boolean {
  return !evaluation.blockers.some((b) => b.kind === 'criterion' || b.kind === 'evidence_conflict');
}

/**
 * The gate reviewer's outcome is valid for the cycle: an ENDORSEMENT needs the criteria assessment to be complete (422
 * `gates.review.criteria_incomplete` with the blockers); a RETURN for rework is always possible while in assessment.
 */
export function assertGateReviewOutcomeAllowed(input: { gateKey: string; outcome: GateReviewOutcome; evaluation: GateEvaluation }): void {
  if (input.outcome === 'endorse' && !gateCriteriaComplete(input.evaluation)) {
    const blockers = input.evaluation.blockers.filter((b) => b.kind === 'criterion' || b.kind === 'evidence_conflict');
    throw ruleViolation('gates.review.criteria_incomplete', `Gate ${input.gateKey} cannot be endorsed: ${blockers.length} criterion blocker(s) remain — return it for rework instead`, { blockers });
  }
}

/**
 * Everything whose change after an endorsement makes it out of date: the gate's criteria and their assessment rows,
 * evidence links and waivers (versions increase on every change; ids appear when a record is added).
 */
export interface GateReviewBasisInput {
  /**
   * Criteria of the gate: definition version (waivability, applicability) and the cycle's assessment row version
   * (status, evidence submission, review, not-applicable, waiver, working note) — `null` while the row does not exist.
   */
  criteria: readonly { id: string; version: number; assessmentVersion: number | null }[];
  /** Every evidence link of those criteria, whatever its status (added, verified, rejected, conflicting, superseded). */
  evidence: readonly { id: string; criterionId: string; status: string; version: number }[];
  /** Every waiver of those criteria (requested, approved, rejected, withdrawn). */
  waivers: readonly { id: string; criterionId: string; status: string; version: number }[];
}

/**
 * Canonical fingerprint of a cycle's criterion state (what the gate reviewer endorses). It changes with any change of
 * evidence, criterion status, waiver or applicability of the gate's criteria — independent of clocks and of the order of
 * the input lists. The API stores its SHA-256 with the review; an endorsement is current only while it is unchanged.
 */
export function gateReviewBasis(input: GateReviewBasisInput): string {
  const byId = <T extends { id: string }>(xs: readonly T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return canonicalJson({
    criteria: byId(input.criteria).map((c) => [c.id, c.version, c.assessmentVersion ?? 0]),
    evidence: byId(input.evidence).map((e) => [e.id, e.criterionId, e.status, e.version]),
    waivers: byId(input.waivers).map((w) => [w.id, w.criterionId, w.status, w.version]),
  });
}

export interface GateReviewRecord {
  outcome: GateReviewOutcome | null;
  reviewedBy: string | null;
  /** Fingerprint (hash) of the criterion state recorded with the review. */
  basis: string | null;
}

/**
 * Review state of a cycle: not reviewed; returned for rework; endorsed (and nothing changed since); or stale (endorsed,
 * but a criterion changed after the endorsement — a fresh endorsement is needed).
 */
export function gateReviewState(review: GateReviewRecord, currentBasis: string): GateReviewState {
  if (!review.outcome) return 'not_reviewed';
  if (review.outcome === 'return') return 'returned';
  return review.basis !== null && review.basis === currentBasis ? 'endorsed' : 'stale';
}

/** Whether the gate reviewer has work on the cycle: nothing reviewed yet, or the criteria changed after the last review. */
export function gateReviewPending(review: GateReviewRecord, currentBasis: string): boolean {
  return !review.outcome || review.basis === null || review.basis !== currentBasis;
}

/**
 * Submission guard (mark-ready): the cycle needs an ENDORSEMENT by the gate reviewer recorded after the cycle's last
 * criterion change (422 otherwise), and the submitter must not be that reviewer (403 — separation of duties; an
 * endorsement whose reviewer is unknown fails closed, I-R3).
 */
export function assertGateEndorsedForSubmission(input: {
  gateKey: string;
  reviewerRole: string;
  review: GateReviewRecord;
  currentBasis: string;
  submitterUserId: string | null;
}): void {
  const state = gateReviewState(input.review, input.currentBasis);
  if (state === 'not_reviewed') {
    throw ruleViolation('gates.assessment.review_required', `Gate ${input.gateKey} cannot be submitted: the gate reviewer (${input.reviewerRole}) has not endorsed the assessment`, {
      reviewState: state,
    });
  }
  if (state === 'returned') {
    throw ruleViolation('gates.assessment.review_returned', `Gate ${input.gateKey} was returned for rework by the gate reviewer; a fresh endorsement is needed before it is submitted`, {
      reviewState: state,
    });
  }
  if (state === 'stale') {
    throw ruleViolation(
      'gates.assessment.review_stale',
      `The endorsement of gate ${input.gateKey} predates a later change of its criteria (evidence, status, waiver or applicability); the gate reviewer must endorse the current assessment`,
      { reviewState: state },
    );
  }
  if (!input.review.reviewedBy || !input.submitterUserId) {
    throw forbidden('policy.sod_subject_unknown', 'Separation of duties cannot be established: the gate reviewer or the submitter is unknown');
  }
  if (input.review.reviewedBy === input.submitterUserId) {
    throw forbidden('gates.assessment.reviewer_cannot_submit', 'Separation of duties: the gate reviewer who endorsed the assessment cannot also submit it for decision');
  }
}

/**
 * The `not_self` subject when several people must differ from the actor (I-R3): unknown (null — fails closed) when any of
 * them is unknown; the actor when the actor is one of them (so the check fails); otherwise the first of them.
 */
export function separationSubject(actorUserId: string | null | undefined, subjects: readonly (string | null | undefined)[]): string | null {
  if (subjects.length === 0 || subjects.some((s) => !s)) return null;
  if (actorUserId && subjects.includes(actorUserId)) return actorUserId;
  return subjects[0]!;
}
