import { forbidden, ruleViolation } from './errors';

/**
 * Rules about RELYING on a governance decision (P2 domain re-review DOM-P2R-03, DOM-P2R-04, DOM-P2R-05; QA-P2-01).
 *
 * A committee decision authorizes one record (its SUBJECT) and — when the committee only recommended — rests on the
 * external authority's approval, evidenced by a verified evidence link on the decision (DOM-P2-12). Whenever a decision is
 * relied upon (gate approval, change-request / baseline approval, prerequisite satisfaction, perimeter-version approval)
 * the evidence of that external approval must STILL be active and verified: a rejected, superseded or conflicting evidence
 * link means the external approval is no longer evidenced and the decision stops backing new approvals.
 *
 * Pure functions (no I/O); the API loads the decision, its evidence link and the subject, then calls these rules.
 */

// ---------------------------------------------------------------------------------------------------------------
// Subject of a decision (DOM-P2R-03)

/** Records a decision paper can be raised for (the record the decision authorizes). */
export const DECISION_SUBJECT_TYPES = ['change_request', 'baseline_version', 'perimeter_version'] as const;
export type DecisionSubjectType = (typeof DECISION_SUBJECT_TYPES)[number];

export interface DecisionSubject {
  type: DecisionSubjectType;
  id: string;
}

/**
 * Subject states at which a paper may still be raised for the record: the record is awaiting its approval (a change
 * request not yet decided, a proposed baseline or perimeter version).
 */
export const DECISION_SUBJECT_OPEN_STATES: Readonly<Record<DecisionSubjectType, readonly string[]>> = {
  change_request: ['draft', 'submitted', 'under_review'],
  baseline_version: ['proposed'],
  perimeter_version: ['proposed'],
};

/** The pair is all-or-nothing (both set, or both cleared). */
export function decisionSubjectOf(type: string | null | undefined, id: string | null | undefined): DecisionSubject | null {
  if (!type && !id) return null;
  if (!type || !id || !(DECISION_SUBJECT_TYPES as readonly string[]).includes(type)) {
    throw ruleViolation('governance.decision.subject_incomplete', 'A decision subject needs both its type (change request, baseline version or perimeter version) and the record');
  }
  return { type: type as DecisionSubjectType, id };
}

/**
 * The subject is set when the paper is drafted and can no longer change once the paper has been submitted (even if the
 * secretariat returns it to draft): votes and the external approval are about THAT record.
 */
export function assertDecisionSubjectChangeable(input: { current: DecisionSubject | null; next: DecisionSubject | null; submittedBefore: boolean }): void {
  const same = (input.current?.type ?? null) === (input.next?.type ?? null) && (input.current?.id ?? null) === (input.next?.id ?? null);
  if (same) return;
  if (input.submittedBefore) {
    throw ruleViolation('governance.decision.subject_locked', 'The record this paper authorizes was fixed when the paper was submitted; raise a new paper for another record');
  }
}

/** The subject record exists in the project and is still awaiting its approval (checked when the paper is drafted). */
export function assertDecisionSubjectOpen(subject: DecisionSubject, status: string): void {
  if (!DECISION_SUBJECT_OPEN_STATES[subject.type].includes(status)) {
    throw ruleViolation('governance.decision.subject_not_open', `The ${subject.type.replace('_', ' ')} is ${status}; a decision paper can be raised only for a record awaiting approval`, {
      subjectType: subject.type,
      status,
    });
  }
}

/**
 * The approval of `record` may rest on a decision only when the decision was raised for that record. Returns the refusal
 * (code + reason) or null. `prefix` is the calling module's code family (e.g. `change_control`, `perimeter.version`).
 */
export function decisionSubjectIssue(
  decision: { code: string; subjectType: string | null; subjectId: string | null },
  record: DecisionSubject,
  prefix: string,
): { code: string; reason: string } | null {
  if (!decision.subjectType || !decision.subjectId) {
    return {
      code: `${prefix}.decision_no_subject`,
      reason: `Decision ${decision.code} was not raised for a specific record; only a decision raised for this ${record.type.replace('_', ' ')} can back its approval`,
    };
  }
  if (decision.subjectType !== record.type || decision.subjectId !== record.id) {
    return {
      code: `${prefix}.decision_other_subject`,
      reason: `Decision ${decision.code} authorizes another record (${decision.subjectType.replace('_', ' ')}); it cannot back the approval of this ${record.type.replace('_', ' ')}`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Evidence of an external approval, at every reliance (DOM-P2R-04)

/** The evidence link recorded with an external approval, as it is NOW. */
export interface ExternalEvidenceState {
  linkId: string | null;
  /** Evidence link status (active | conflicting | rejected | superseded) — null when the link is missing. */
  status: string | null;
  /** A second person accepted it in verification (documents module). */
  verified: boolean;
}

export type ExternalEvidenceIssue = { kind: 'missing' } | { kind: 'not_active'; status: string } | { kind: 'unverified' };

/**
 * A decision approved by an external authority (committee recommendation + recorded external approval) counts as final only
 * while the evidence of that approval is an ACTIVE evidence link that a second person VERIFIED. Returns null when the
 * evidence still stands (or when no external approval is involved), otherwise what is wrong. Missing evidence (a decision
 * recorded before DOM-P2-12, or loaded without its link) fails closed.
 */
export function externalApprovalEvidenceIssue(d: {
  authorityOutcome: string;
  externalAuthorityReference?: string | null;
  externalEvidence?: ExternalEvidenceState | null;
}): ExternalEvidenceIssue | null {
  if (d.authorityOutcome !== 'pending_external_authority' || !d.externalAuthorityReference?.trim()) return null;
  const e = d.externalEvidence;
  if (!e || !e.linkId || !e.status) return { kind: 'missing' };
  if (e.status !== 'active') return { kind: 'not_active', status: e.status };
  if (!e.verified) return { kind: 'unverified' };
  return null;
}

/** Why a decided (approved) gate relying on a decision needs a controlled reassessment because of the decision's evidence. */
export type DecisionEvidenceReassessmentReason = 'evidence_defective' | 'evidence_superseded' | 'evidence_conflict';

/**
 * DOM-P2R-04 (extension of DOM-P2-05): an approved gate cycle relied on a decision approved by the external authority. When
 * the evidence of that external approval is later rejected (found defective), superseded or marked conflicting, the gate
 * is flagged for controlled reassessment. The decision itself and the decided cycle are never modified.
 */
export function decisionEvidenceReassessment(d: {
  authorityOutcome: string;
  externalAuthorityReference?: string | null;
  externalEvidence?: ExternalEvidenceState | null;
}): { reason: DecisionEvidenceReassessmentReason; linkId: string } | null {
  const issue = externalApprovalEvidenceIssue(d);
  if (!issue || issue.kind !== 'not_active' || !d.externalEvidence?.linkId) return null;
  const reason: DecisionEvidenceReassessmentReason = issue.status === 'rejected' ? 'evidence_defective' : issue.status === 'superseded' ? 'evidence_superseded' : 'evidence_conflict';
  return { reason, linkId: d.externalEvidence.linkId };
}

// ---------------------------------------------------------------------------------------------------------------
// One decision backs one record per kind of use: the decision-use registry (DOM-P2R-05, QA-P2-01, O-1)

/**
 * Kinds of use that CONSUME a committee decision. Each registered use is a `decision_use` row (decision, kind, record) —
 * unique per decision and kind — written in the same transaction as the approval, under a row lock on the decision
 * (docs/architecture/module-guide.md, "Relying on a governance decision"). One decision therefore backs ONE record of each
 * kind (a G1 decision may back the G1 gate cycle AND one perimeter version, never two perimeter versions).
 *
 * A module that relies on decisions adds its kind here with the record type it backs; `hub_target_table()` in
 * post-migrate.sql must list that record type. P4 (DOM-P4-01/06/07): a JV closing confirmation (`closing`), the approved
 * values of a valuation model version (`financial_model_version`) and a budget-line approval (`budget_line`).
 *
 * A JV SIGNING is not a kind of its own: it is recorded on the decision that approved the current G5 cycle (DOM-P4-02) —
 * the signing is part of that gate approval, whose use is the `gate_cycle` row — so the signing relies on the decision
 * without consuming it again (final + evidence re-checked, no registry row).
 */
export const DECISION_USE_KINDS = ['change_request', 'baseline_version', 'perimeter_version', 'gate_cycle', 'closing', 'financial_model_version', 'budget_line'] as const;
export type DecisionUseKind = (typeof DECISION_USE_KINDS)[number];

/** Record type backed by each kind of use (the `subject_type` of its `decision_use` rows). */
export const DECISION_USE_SUBJECT_TYPE: Readonly<Record<DecisionUseKind, string>> = {
  change_request: 'change_request',
  baseline_version: 'baseline_version',
  perimeter_version: 'perimeter_version',
  gate_cycle: 'gate_assessment',
  closing: 'closing',
  financial_model_version: 'financial_model_version',
  budget_line: 'budget_line',
};

/** A registered use of a decision (a `decision_use` row). */
export interface DecisionUseRecord {
  kind: string;
  subjectType: string;
  subjectId: string;
}

/**
 * The registered use that stops `decision` from backing `subjectId` for `kind`: an earlier use of the SAME kind for ANOTHER
 * record. A use for the same record is not an obstacle (the same approval re-evaluated). Null when the decision is free.
 */
export function decisionUseConflict(uses: readonly DecisionUseRecord[], kind: DecisionUseKind, subjectId: string): DecisionUseRecord | null {
  return uses.find((u) => u.kind === kind && u.subjectId !== subjectId) ?? null;
}

/**
 * A decision already relied upon by another approval of the same kind cannot back this one (change requests, baseline
 * versions, perimeter versions). The API checks it under a row lock on the decision; the registry's unique index backs it up.
 */
export function assertDecisionNotReused(input: { decisionCode: string; usedByOtherRecord: boolean; code: string }): void {
  if (input.usedByOtherRecord) throw ruleViolation(input.code, `Decision ${input.decisionCode} already backs another approval; one decision backs one approval`);
}

// ---------------------------------------------------------------------------------------------------------------
// Generic reliance check: final, evidence still standing, raised for this record, not used for another record

/** Decision states that are FINAL approvals (within the committee mandate, or recorded from the external authority). */
const FINAL_STATES: readonly string[] = ['approved', 'implementation_pending', 'implemented_verified'];

/** A decision as relied upon (loaded — and row-locked — by the caller, with its external evidence as it is NOW). */
export interface RelianceDecision {
  id: string;
  code: string;
  status: string;
  authorityOutcome: string;
  externalAuthorityReference?: string | null;
  decisionTypeKey?: string | null;
  subjectType: string | null;
  subjectId: string | null;
  externalEvidence?: ExternalEvidenceState | null;
}

/**
 * How a caller binds decisions to its records (DOM-P2R-03):
 *  - `required`: the decision must have been raised for this very record (change requests, baselines — the default for a
 *    new consumer whose record type a decision paper can name, `DECISION_SUBJECT_TYPES`);
 *  - `if_set`: a decision raised for a specific record backs only that record; one raised for none is accepted (perimeter
 *    versions, whose G1 papers are bound by gate key; JV closings and valuation model versions — a paper cannot name them
 *    yet, see docs/architecture/module-guide.md "Relying on a governance decision");
 *  - `none`: the binding is checked by the caller (gate papers and JV signings: by gate key; budget lines: the decision is
 *    raised for the change request / baseline it approves and the line records the amount of that approval).
 */
export type DecisionSubjectRule = 'required' | 'if_set' | 'none';

export interface DecisionRelianceInput {
  decision: RelianceDecision;
  /** The record the decision is relied upon for, and the kind of use (null kind: a reliance that does not consume the decision, e.g. prerequisite satisfaction). */
  use: { kind: DecisionUseKind | null; subjectType: string; subjectId: string };
  /** Uses already registered for the decision (`decision_use` rows, read under the decision row lock). */
  uses: readonly DecisionUseRecord[];
  subjectRule: DecisionSubjectRule;
  /** Decision types (authority-matrix keys) that may back the record; omitted = the caller checks the type itself. */
  decisionTypeKeys?: readonly string[];
  /** Code family of the calling module: `${codePrefix}.decision_not_final` etc. (e.g. `change_control`, `perimeter.version`, `jv.closing`). */
  codePrefix: string;
  /**
   * `false` when a decision is LINKED before it is final (e.g. a JV confirmation request names the decision that the
   * confirmer will rely on): the finality checks are skipped — the evidence of an external approval, once recorded, the
   * type, the registered uses and the subject are still checked. Default `true` (the decision is relied upon now).
   */
  requireFinal?: boolean;
}

export type DecisionRelianceIssueKind = 'not_final' | 'evidence_invalid' | 'type_mismatch' | 'no_subject' | 'other_subject' | 'already_used';

export interface DecisionRelianceIssue {
  kind: DecisionRelianceIssueKind;
  /** `${codePrefix}.decision_${kind}` */
  code: string;
  reason: string;
  params: Record<string, string | number | null>;
}

/**
 * The single check every module runs before a decision backs one of its records (DOM-P2R-03/-04/-05, QA-P2-01), in this
 * order: the decision is a FINAL approval (a recommendation counts only with the external approval recorded); the evidence
 * of that external approval is still an active, verified evidence link; it is of an allowed type (`decisionTypeKeys`); it
 * has not been used for another record of the same kind; it was raised for this record (`subjectRule`). Further module
 * rules (amount coverage, gate key, authority matrix) are checked by the module after it. Returns the first issue, or null.
 */
export function decisionRelianceIssue(input: DecisionRelianceInput): DecisionRelianceIssue | null {
  const d = input.decision;
  const issue = (kind: DecisionRelianceIssueKind, reason: string, params: Record<string, string | number | null> = {}): DecisionRelianceIssue => ({
    kind,
    code: `${input.codePrefix}.decision_${kind}`,
    reason,
    params: { decisionId: d.id, ...params },
  });
  if (input.requireFinal !== false) {
    if (!FINAL_STATES.includes(d.status)) {
      return issue('not_final', `Decision ${d.code} is ${d.status}: only a final approval (within the committee mandate, or recorded from the external authority) can back this record`, { decisionStatus: d.status });
    }
    if (d.authorityOutcome === 'pending_external_authority' && !d.externalAuthorityReference?.trim()) {
      return issue('not_final', `Decision ${d.code} is a recommendation without a recorded external approval`, { decisionStatus: d.status });
    }
    if (d.authorityOutcome !== 'within_mandate' && d.authorityOutcome !== 'pending_external_authority') {
      return issue('not_final', `Decision ${d.code} carries no approving authority (${d.authorityOutcome})`, { decisionStatus: d.status });
    }
  }
  const ev = externalApprovalEvidenceIssue(d);
  if (ev) {
    return issue(
      'evidence_invalid',
      ev.kind === 'missing'
        ? `The external approval of decision ${d.code} has no evidence link on record; it cannot back this record`
        : ev.kind === 'not_active'
          ? `The evidence of the external approval of decision ${d.code} is now ${ev.status}; the decision no longer backs approvals until the external approval is evidenced again`
          : `The evidence of the external approval of decision ${d.code} is not verified by a second person`,
      { evidence: ev.kind, evidenceStatus: ev.kind === 'not_active' ? ev.status : null },
    );
  }
  if (input.decisionTypeKeys && (!d.decisionTypeKey || !input.decisionTypeKeys.includes(d.decisionTypeKey))) {
    return issue('type_mismatch', `Decision ${d.code} is of type "${d.decisionTypeKey ?? 'none'}"; this record needs a decision of type "${input.decisionTypeKeys.join('" or "')}"`, {
      decisionTypeKey: d.decisionTypeKey ?? null,
    });
  }
  // A decision consumed by another record of this kind is refused as such, whatever record it was raised for.
  if (input.use.kind) {
    const used = decisionUseConflict(input.uses, input.use.kind, input.use.subjectId);
    if (used) {
      return issue('already_used', `Decision ${d.code} already backs another ${used.subjectType.replace(/_/g, ' ')}; one decision backs one record of each kind`, { usedBySubjectType: used.subjectType, usedBySubjectId: used.subjectId });
    }
  }
  const bound = !!(d.subjectType || d.subjectId);
  if (input.subjectRule === 'required' || (input.subjectRule === 'if_set' && bound)) {
    const label = input.use.subjectType.replace(/_/g, ' ');
    if (!d.subjectType || !d.subjectId) {
      return issue('no_subject', `Decision ${d.code} was not raised for a specific record; only a decision raised for this ${label} can back it`);
    }
    if (d.subjectType !== input.use.subjectType || d.subjectId !== input.use.subjectId) {
      return issue('other_subject', `Decision ${d.code} authorizes another record (${d.subjectType.replace(/_/g, ' ')}); it cannot back this ${label}`, { decisionSubjectType: d.subjectType });
    }
  }
  return null;
}

/** `decisionRelianceIssue`, thrown as a 422 business-rule violation with the issue's code and parameters. */
export function assertDecisionReliance(input: DecisionRelianceInput): void {
  const issue = decisionRelianceIssue(input);
  if (issue) throw ruleViolation(issue.code, issue.reason, issue.params);
}

// ---------------------------------------------------------------------------------------------------------------
// Prerequisite removal (DOM-P2R-07)

/**
 * Removing a non-schedule prerequisite requires a reason. While it still BLOCKS the task / milestone (not satisfied), it may
 * not be removed by the person accountable for that task / milestone — the person it blocks (separation of duties, like
 * the other "not by the person concerned" rules). The removal is audited with its reason.
 */
export function assertPrerequisiteRemovable(input: { satisfied: boolean; reason: string | null | undefined; actorUserId: string | null; blockedUserIds: readonly (string | null | undefined)[] }): void {
  if (!input.reason?.trim()) throw ruleViolation('planning.prerequisite.reason_required', 'Removing a prerequisite requires a reason');
  if (input.satisfied) return;
  if (!input.actorUserId) throw forbidden('policy.sod_subject_unknown', 'Separation of duties cannot be established: the person removing the prerequisite is unknown');
  if (input.blockedUserIds.some((u) => u && u === input.actorUserId)) {
    throw forbidden('planning.prerequisite.removal_by_blocked_party', 'A prerequisite that still blocks your own task or milestone must be removed by someone else (separation of duties)');
  }
}
