import { ruleViolation } from './errors';
import { APPLICABILITY_STATUSES, REQUIREMENT_STATUSES } from './enums';
import type { IncorporationStatus, VerificationStatus } from './enums';
import { transition, type Machine } from './workflows';

/**
 * NewCo rules (spec §3 G2, §7.2, §21 step 2; AT-06; REQ-LCY-007, REQ-SET-010, REQ-AGR-004/005/007).
 * Incorporation is its OWN status dimension: recording or verifying it never changes transfers or operations, and the
 * platform never determines legal or regulatory facts — it records specialist assessments with evidence.
 * Every guard input is required (P0 review N-01).
 */

// ---------------------------------------------------------------------------------------------------------
// Incorporation

export type IncorporationVerifyOutcome = 'confirm' | 'reject';

/**
 * REQ-SET-010 / business-gates §1: "incorporated" and "incorporation in progress" each require evidence; "unconfirmed" is
 * the explicit no-evidence state; "not applicable" is a determination that needs a recorded basis.
 */
export function assertIncorporationRecord(i: { status: IncorporationStatus; activeEvidence: number; conflictingEvidence: number; note: string | null }): void {
  if (i.status === 'incorporated' || i.status === 'incorporation_in_progress') {
    if (i.activeEvidence < 1) {
      throw ruleViolation('newco.incorporation.evidence_required', `Recording "${i.status}" requires linked evidence (e.g. the registration record); otherwise record "unconfirmed"`);
    }
    if (i.conflictingEvidence > 0) throw ruleViolation('newco.incorporation.evidence_conflicting', 'Resolve the conflicting incorporation evidence first');
  }
  if (i.status === 'not_applicable' && !i.note?.trim()) {
    throw ruleViolation('newco.incorporation.basis_required', 'Recording that incorporation is not applicable requires the basis of that determination');
  }
}

/** A newly recorded status is a claim until Legal verifies it: `proposed`, or `unknown` when unconfirmed. */
export function verificationAfterRecord(status: IncorporationStatus): VerificationStatus {
  return status === 'unconfirmed' ? 'unknown' : 'proposed';
}

export function assertIncorporationVerification(i: {
  outcome: IncorporationVerifyOutcome;
  status: IncorporationStatus;
  verification: VerificationStatus;
  activeEvidence: number;
  conflictingEvidence: number;
  verifierUserId: string;
  /** Who recorded the status (falls back to the entity creator); null → cannot be verified (re-record first). */
  recordedBy: string | null;
  note: string | null;
}): VerificationStatus {
  if (!i.recordedBy) throw ruleViolation('newco.incorporation.recorder_unknown', 'The status has no accountable recorder — record it again before verification');
  if (i.recordedBy === i.verifierUserId) throw ruleViolation('newco.incorporation.self_verification', 'The person who recorded the incorporation status cannot verify it');
  if (i.status === 'unconfirmed') throw ruleViolation('newco.incorporation.nothing_to_verify', 'An unconfirmed status has nothing to verify — record the status with evidence first');
  if (i.verification !== 'proposed') {
    throw ruleViolation('newco.incorporation.not_pending_verification', `The current status is already ${i.verification}; record it again to re-verify`);
  }
  if (i.outcome === 'reject') {
    if (!i.note?.trim()) throw ruleViolation('newco.incorporation.reason_required', 'A rejected verification requires a reason');
    return 'unknown';
  }
  if (i.activeEvidence < 1) throw ruleViolation('newco.incorporation.evidence_required', 'Verification requires active evidence linked to the legal entity');
  if (i.conflictingEvidence > 0) throw ruleViolation('newco.incorporation.evidence_conflicting', 'Conflicting evidence must be resolved before verification');
  return 'confirmed';
}

// ---------------------------------------------------------------------------------------------------------
// Regulatory / external-party / internal approvals

export type ApplicabilityStatus = (typeof APPLICABILITY_STATUSES)[number];
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

/** REQ-AGR-007: the label shown until a specialist determines applicability. */
export const APPLICABILITY_PENDING_LABEL = 'Assessment pending — specialist';

export function applicabilityLabel(a: ApplicabilityStatus): string {
  if (a === 'applicable') return 'Applicable (specialist assessment)';
  if (a === 'not_applicable') return 'Not applicable (specialist assessment)';
  return APPLICABILITY_PENDING_LABEL;
}

/**
 * Every new entry — including one extracted from the reference image or a workbook — starts `assessment_pending`: the
 * appearance of a licence or approval in a source is never a determination that it is mandatory or obtained.
 */
export function initialApplicability(_origin: 'manual' | 'source_extraction' | 'import'): ApplicabilityStatus {
  return 'assessment_pending';
}

export function assertApplicabilityAssessment(i: { applicability: ApplicabilityStatus; basis: string | null; assessorUserId: string; createdBy: string | null }): void {
  if (!i.basis?.trim()) throw ruleViolation('newco.regulatory.basis_required', 'An applicability assessment requires its basis');
  if (i.createdBy && i.createdBy === i.assessorUserId) {
    throw ruleViolation('newco.regulatory.self_assessment', 'The person who registered the requirement cannot also determine its applicability');
  }
}

export type RequirementCommand =
  | 'start_preparation'
  | 'submit'
  | 'record_grant'
  | 'record_grant_with_conditions'
  | 'record_refusal'
  | 'withdraw'
  | 'mark_expired'
  | 'reopen';

export const REQUIREMENT_MACHINE: Machine<RequirementStatus, RequirementCommand> = {
  start_preparation: { from: ['not_started'], to: 'in_preparation', description: 'Preparation started' },
  submit: { from: ['in_preparation'], to: 'submitted', description: 'Submitted to the authority / party' },
  record_grant: { from: ['in_preparation', 'submitted'], to: 'granted', description: 'Grant recorded with evidence and validity' },
  record_grant_with_conditions: { from: ['in_preparation', 'submitted'], to: 'granted_with_conditions', description: 'Conditional grant recorded' },
  record_refusal: { from: ['submitted'], to: 'refused', description: 'Refusal recorded with evidence' },
  withdraw: { from: ['not_started', 'in_preparation', 'submitted'], to: 'withdrawn', description: 'Withdrawn' },
  mark_expired: { from: ['granted', 'granted_with_conditions'], to: 'expired', description: 'Validity lapsed' },
  reopen: { from: ['refused', 'withdrawn', 'expired'], to: 'in_preparation', description: 'Re-application started' },
};

/** Commands that record the authority's outcome — a verified fact (newco.regulatory.verify, not_self). */
export const OUTCOME_COMMANDS: readonly RequirementCommand[] = ['record_grant', 'record_grant_with_conditions', 'record_refusal'];

export interface RequirementCommandInput {
  command: RequirementCommand;
  status: RequirementStatus;
  applicability: ApplicabilityStatus;
  date: string | null;
  conditions: string | null;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  activeEvidence: number;
  conflictingEvidence: number;
  today: string;
}

export function assertRequirementCommand(i: RequirementCommandInput): RequirementStatus {
  const to = transition('regulatory_requirement', REQUIREMENT_MACHINE, i.status, i.command);
  const needsApplicable: RequirementCommand[] = ['submit', 'record_grant', 'record_grant_with_conditions', 'record_refusal'];
  if (needsApplicable.includes(i.command) && i.applicability !== 'applicable') {
    throw ruleViolation(
      'newco.regulatory.applicability_not_assessed',
      i.applicability === 'not_applicable'
        ? 'A specialist assessed this item as not applicable'
        : `${APPLICABILITY_PENDING_LABEL}: record the specialist applicability assessment first`,
    );
  }
  if (['submit', ...OUTCOME_COMMANDS].includes(i.command)) {
    if (!i.date?.trim()) throw ruleViolation('newco.regulatory.date_required', i.command === 'submit' ? 'Record the submission date' : 'Record the decision date');
    if (i.date > i.today) throw ruleViolation('newco.regulatory.date_in_future', 'The date cannot be in the future');
  }
  if (OUTCOME_COMMANDS.includes(i.command)) {
    if (i.activeEvidence < 1) throw ruleViolation('newco.regulatory.evidence_required', "Recording the authority's outcome requires active evidence (e.g. the licence or decision letter)");
    if (i.conflictingEvidence > 0) throw ruleViolation('newco.regulatory.evidence_conflicting', 'Resolve the conflicting evidence first');
  }
  if (i.command === 'record_grant_with_conditions' && !i.conditions?.trim()) {
    throw ruleViolation('newco.regulatory.conditions_required', 'A conditional grant must state its conditions');
  }
  if ((i.command === 'record_grant' || i.command === 'record_grant_with_conditions') && i.validFrom && i.validTo && i.validTo < i.validFrom) {
    throw ruleViolation('newco.regulatory.validity_inverted', 'Valid-to precedes valid-from');
  }
  if (i.command === 'mark_expired' && !(i.validTo && i.validTo < i.today)) {
    throw ruleViolation('newco.regulatory.not_expired', 'Only an item whose validity has ended can be marked expired');
  }
  if ((i.command === 'withdraw' || i.command === 'reopen') && !i.note?.trim()) {
    throw ruleViolation('newco.regulatory.reason_required', 'A reason is required');
  }
  return to;
}

export type ValidityState = 'not_granted' | 'no_expiry_recorded' | 'not_yet_valid' | 'valid' | 'expiring' | 'expired';

/** REQ-AGR-004 UT: an expired validity is flagged (also when the status was not yet marked expired). */
export function validityState(i: { status: RequirementStatus; validFrom: string | null; validTo: string | null; today: string; warnDays: number }): ValidityState {
  if (i.status === 'expired') return 'expired';
  if (i.status !== 'granted' && i.status !== 'granted_with_conditions') return 'not_granted';
  if (i.validTo && i.validTo < i.today) return 'expired';
  if (i.validFrom && i.validFrom > i.today) return 'not_yet_valid';
  if (!i.validTo) return 'no_expiry_recorded';
  const days = Math.round((Date.parse(i.validTo) - Date.parse(i.today)) / 86_400_000);
  return days <= i.warnDays ? 'expiring' : 'valid';
}

export type ConditionsState = 'none' | 'open' | 'satisfied';

/** REQ-AGR-005 UT: an approval with conditions shows them as open until their satisfaction is evidenced. */
export function conditionsState(i: { status: RequirementStatus; conditions: string | null; conditionsSatisfiedAt: string | null }): ConditionsState {
  if (i.status !== 'granted_with_conditions' && !(i.status === 'granted' && i.conditions?.trim())) return 'none';
  if (!i.conditions?.trim()) return 'none';
  return i.conditionsSatisfiedAt ? 'satisfied' : 'open';
}

export function assertConditionsSatisfied(i: { state: ConditionsState; activeEvidence: number; conflictingEvidence: number; note: string | null; actorUserId: string; outcomeRecordedBy: string | null }): void {
  if (i.state !== 'open') throw ruleViolation('newco.regulatory.no_open_conditions', 'There are no open conditions to close');
  if (!i.note?.trim()) throw ruleViolation('newco.regulatory.note_required', 'Describe how the conditions were satisfied');
  if (i.activeEvidence < 1) throw ruleViolation('newco.regulatory.evidence_required', 'Closing conditions requires active evidence');
  if (i.conflictingEvidence > 0) throw ruleViolation('newco.regulatory.evidence_conflicting', 'Resolve the conflicting evidence first');
  if (i.outcomeRecordedBy && i.outcomeRecordedBy === i.actorUserId) {
    throw ruleViolation('newco.regulatory.self_verification', 'The person who recorded the conditional grant cannot also confirm its conditions');
  }
}
