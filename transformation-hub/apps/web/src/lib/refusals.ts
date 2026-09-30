'use client';

import { useCallback } from 'react';
import { useI18n, type MessageKey, type Values } from '@/i18n/provider';
import { isApiError } from './api';

/**
 * Translated explanations of business-rule refusals (RFC 7807 `code` → i18n key), so the Arabic and English UI explain
 * WHY a command was refused and what to do next. The server's own (English) `detail` is still shown next to it by
 * `ApiErrorNotice` — it may carry specifics (record codes, amounts) that the translation does not repeat.
 *
 * Only codes listed here are translated; any other refusal falls back to the server's detail. Parameters come from the
 * problem document's `details` object (never invented): a missing value selects the variant without it.
 */
type Details = Record<string, unknown> | undefined;
type Fmt = { formatNumber: (n: number) => string; formatList: (items: string[]) => string };
type Entry = MessageKey | ((d: Details, f: Fmt) => { key: MessageKey; values?: Values });

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const REFUSAL_KEYS: Readonly<Record<string, Entry>> = {
  // External authority decision (DOM-P2-12)
  'governance.external.evidence_required': 'governance.refusal.codes.external_evidence_required',
  'governance.external.evidence_other_target': 'governance.refusal.codes.external_evidence_other_target',
  'governance.external.evidence_not_active': 'governance.refusal.codes.external_evidence_not_active',
  'governance.external.evidence_unverified': 'governance.refusal.codes.external_evidence_unverified',
  // Authority matrix approval and its verification (DOM-P2-12)
  'governance.authority_matrix.evidence_required': 'governance.refusal.codes.matrix_evidence_required',
  'governance.authority_matrix.approval_pending_verification': 'governance.refusal.codes.matrix_approval_pending_verification',
  'governance.authority_matrix.no_pending_approval': 'governance.refusal.codes.matrix_no_pending_approval',
  'governance.authority_matrix.rejection_reason_required': 'governance.refusal.codes.matrix_rejection_reason_required',
  'governance.authority_matrix.evidence_not_visible': 'governance.refusal.codes.matrix_evidence_not_visible',
  'governance.authority_matrix.evidence_not_usable': 'governance.refusal.codes.matrix_evidence_not_usable',
  'governance.authority_matrix.evidence_deleted': 'governance.refusal.codes.matrix_evidence_deleted',
  'governance.authority_matrix.evidence_no_version': 'governance.refusal.codes.matrix_evidence_no_version',
  'governance.authority_matrix.demo_policy_non_demo_project': 'governance.refusal.codes.matrix_demo_policy_non_demo_project',
  'governance.authority_matrix.not_draft': 'governance.refusal.codes.matrix_not_draft',
  // Recusals, attendance and tally integrity (DOM-P2-06, DOM-P2-20)
  'governance.recusal.after_vote': (d, f) => {
    const round = int(d?.['round']);
    return round === null ? { key: 'governance.refusal.codes.recusal_after_vote_noRound' } : { key: 'governance.refusal.codes.recusal_after_vote', values: { round: f.formatNumber(round) } };
  },
  'governance.recusal.reason_required': 'governance.refusal.codes.recusal_reason_required',
  'governance.recusal.not_member': 'governance.refusal.codes.recusal_not_member',
  'governance.recusal.decision_closed': 'governance.refusal.codes.recusal_decision_closed',
  'governance.recusal.duplicate': 'governance.refusal.codes.recusal_duplicate',
  'governance.attendance.frozen_voting_open': (d, f) => {
    const list = Array.isArray(d?.['decisions']) ? (d!['decisions'] as unknown[]).map((x) => str((x as Record<string, unknown> | null)?.['code'])).filter((x): x is string => !!x) : [];
    return list.length ? { key: 'governance.refusal.codes.attendance_frozen_voting_open', values: { decisions: f.formatList(list) } } : { key: 'governance.refusal.codes.attendance_frozen_voting_open_noList' };
  },
  'governance.outcome.vote_integrity': (d, f) => {
    const round = int(d?.['round']);
    const votes = int(d?.['votes']);
    return round !== null && votes !== null
      ? { key: 'governance.refusal.codes.outcome_vote_integrity', values: { round: f.formatNumber(round), count: votes } }
      : { key: 'governance.refusal.codes.outcome_vote_integrity_noCounts' };
  },
  // Voting closure (DOM-P2R-01) and declarations before voting (REQ-GOV-015)
  'governance.outcome.votes_outstanding': (d, f) => {
    const round = int(d?.['round']);
    const count = int(d?.['outstanding']);
    return round !== null && count !== null
      ? { key: 'governance.refusal.codes.outcome_votes_outstanding', values: { round: f.formatNumber(round), count: f.formatNumber(count) } }
      : { key: 'governance.refusal.codes.outcome_votes_outstanding_noCounts' };
  },
  'governance.voting.not_chair': 'governance.refusal.codes.voting_not_chair',
  'governance.voting.no_chair': 'governance.refusal.codes.voting_no_chair',
  'governance.voting.already_closed': 'governance.refusal.codes.voting_already_closed',
  'governance.voting.not_open': 'governance.refusal.codes.voting_not_open',
  'governance.voting.reason_required': 'governance.refusal.codes.voting_reason_required',
  'governance.vote.voting_closed': 'governance.refusal.codes.vote_voting_closed',
  'governance.vote.declaration_required': 'governance.refusal.codes.vote_declaration_required',
  // The record a decision authorizes (DOM-P2R-03) and paper completeness (DOM-P2-14)
  'governance.decision.subject_locked': 'governance.refusal.codes.decision_subject_locked',
  'governance.decision.subject_not_open': 'governance.refusal.codes.decision_subject_not_open',
  'governance.decision.subject_incomplete': 'governance.refusal.codes.decision_subject_incomplete',
  'governance.decision.incomplete_paper': 'governance.refusal.codes.decision_incomplete_paper',
  // Change control within delegated authority (DOM-P2-03, DOM-P2R-02/-03/-04)
  'change_control.decision_no_subject': 'planning.refusal.codes.change_control_decision_no_subject',
  'change_control.decision_other_subject': 'planning.refusal.codes.change_control_decision_other_subject',
  'change_control.decision_evidence_invalid': 'planning.refusal.codes.change_control_decision_evidence_invalid',
  'change_control.amount_unconfirmed': 'planning.refusal.codes.change_control_amount_unconfirmed',
  'change_control.no_usable_matrix': 'planning.refusal.codes.change_control_no_usable_matrix',
  'change_control.outside_delegated_authority': (d) => {
    const body = str(d?.['escalateTo']);
    return body ? { key: 'planning.refusal.codes.change_control_outside_delegated_authority', values: { body } } : { key: 'planning.refusal.codes.change_control_outside_delegated_authority_noBody' };
  },
  'change_control.amount_unquantified': 'planning.refusal.codes.change_control_amount_unquantified',
  'change_control.decision_not_final': 'planning.refusal.codes.change_control_decision_not_final',
  'change_control.decision_type_mismatch': 'planning.refusal.codes.change_control_decision_type_mismatch',
  'change_control.decision_amount_missing': 'planning.refusal.codes.change_control_decision_amount_missing',
  'change_control.decision_amount_currency': 'planning.refusal.codes.change_control_decision_amount_currency',
  'change_control.decision_amount_insufficient': 'planning.refusal.codes.change_control_decision_amount_insufficient',
  'change_control.decision_already_used': 'planning.refusal.codes.change_control_decision_already_used',
  // Prerequisites and cross-project dependencies (DOM-P2-18, DOM-P2-17)
  'planning.prerequisite_pending': (d) => {
    const count = int(d?.['pending']);
    return count === null ? { key: 'planning.refusal.codes.prerequisite_pending_noCount' } : { key: 'planning.refusal.codes.prerequisite_pending', values: { count } };
  },
  'prerequisite.duplicate': 'planning.refusal.codes.prerequisite_duplicate',
  'planning.prerequisite.reason_required': 'planning.refusal.codes.prerequisite_reason_required',
  'planning.prerequisite.removal_by_blocked_party': 'planning.refusal.codes.prerequisite_removal_by_blocked_party',
  // Perimeter versions (DOM-P2R-05) and gates (DOM-P2R-04, QA-P2-03, O-1)
  'perimeter.version.decision_already_used': 'carveout.versions.refusal.decisionAlreadyUsed',
  'perimeter.version.decision_other_subject': 'carveout.versions.refusal.decisionOtherSubject',
  'gates.decide.decision_evidence_invalid': 'gates.refusal.decisionEvidenceInvalid',
  'gates.assessment.review_stale': 'gates.refusal.reviewStale',
  'gates.decide.decision_reused': 'gates.refusal.decisionReused',
  // Decision-use registry backstop (a concurrent gate decision registered the decision first) — same meaning.
  'gates.decide.decision_already_used': 'gates.refusal.decisionReused',
  // Every other refusal the gates module raises (QA-P2-04; apps/web/scripts/check-i18n.mjs checks the list is complete).
  // Gate roles and the gate-level review (DOM-P2-16, REQ-LCY-010)
  'gates.definition.roles_incomplete': 'gates.refusal.rolesIncomplete',
  'gates.not_gate_owner': 'gates.refusal.notGateOwner',
  'gates.not_designated_gate_reviewer': 'gates.refusal.notDesignatedGateReviewer',
  'gates.review.invalid_state': (d) => ({ key: str(d?.['status']) === 'ready_for_decision' ? 'gates.refusal.reviewInvalidStateReady' : 'gates.refusal.reviewInvalidState' }),
  'gates.review.criteria_incomplete': (d, f) => {
    const count = Array.isArray(d?.['blockers']) ? (d!['blockers'] as unknown[]).length : null;
    return count === null ? { key: 'gates.refusal.reviewCriteriaIncompleteNoCount' } : { key: 'gates.refusal.reviewCriteriaIncomplete', values: { count: f.formatNumber(count) } };
  },
  'gates.assessment.review_required': 'gates.refusal.reviewRequired',
  'gates.assessment.review_returned': 'gates.refusal.reviewReturned',
  'gates.assessment.reviewer_cannot_submit': 'gates.refusal.reviewerCannotSubmit',
  // Assessment cycle and decision
  'gates.assessment.not_ready': (d, f) => {
    const count = Array.isArray(d?.['blockers']) ? (d!['blockers'] as unknown[]).length : null;
    return count === null ? { key: 'gates.refusal.assessmentNotReadyNoCount' } : { key: 'gates.refusal.assessmentNotReady', values: { count: f.formatNumber(count) } };
  },
  'gates.assessment.decided': 'gates.refusal.assessmentDecided',
  'gates.assessment.not_editable': (d) => ({ key: str(d?.['status']) === 'ready_for_decision' ? 'gates.refusal.assessmentNotEditableReady' : 'gates.refusal.assessmentNotEditable' }),
  'gates.decision.not_for_gate': 'gates.refusal.decisionNotForGate',
  'gates.decide.decision_not_for_gate': 'gates.refusal.decisionNotForGate',
  'gates.decide.decision_not_final': 'gates.refusal.decisionNotFinal',
  'gates.decide.missing_reason': 'gates.refusal.decideMissingReason',
  'gates.decide.not_ready': (d, f) => {
    const count = Array.isArray(d?.['blockers']) ? (d!['blockers'] as unknown[]).length : null;
    return count === null ? { key: 'gates.refusal.decideNotReadyNoCount' } : { key: 'gates.refusal.decideNotReady', values: { count: f.formatNumber(count) } };
  },
  'gates.decide.no_exceptions': 'gates.refusal.decideNoExceptions',
  'gates.decide.exceptions_present': 'gates.refusal.decideExceptionsPresent',
  'gates.reopen.invalid_state': 'gates.refusal.reopenInvalidState',
  'gates.reopen.missing_reason': 'gates.refusal.reopenMissingReason',
  // Criteria, evidence and not-applicable determinations
  'gates.criterion.evidence_conflict': 'gates.refusal.criterionEvidenceConflict',
  'gates.criterion.no_evidence': 'gates.refusal.criterionNoEvidence',
  'gates.criterion.invalid_transition': 'gates.refusal.criterionInvalidTransition',
  'gates.not_designated_reviewer': 'gates.refusal.notDesignatedReviewer',
  'gates.na.no_proposal': 'gates.refusal.naNoProposal',
  'gates.na.missing_basis': 'gates.refusal.naMissingBasis',
  'gates.na.unauthorized': 'gates.refusal.naUnauthorized',
  'gates.na.self_approval': 'gates.refusal.naSelfApproval',
  // Waivability and waivers (AT-13)
  'gates.waivability.not_designated_specialist': 'gates.refusal.waivabilityNotDesignatedSpecialist',
  'gates.waivability.missing_basis': 'gates.refusal.waivabilityMissingBasis',
  'gates.waivability.missing_authority': 'gates.refusal.waivabilityMissingAuthority',
  'gates.waivability.invalid_authority': 'gates.refusal.waivabilityInvalidAuthority',
  'gates.waiver.not_needed': 'gates.refusal.waiverNotNeeded',
  'gates.waiver.non_waivable': 'gates.refusal.waiverNonWaivable',
  'gates.waiver.expiry_in_past': 'gates.refusal.waiverExpiryInPast',
  'gates.waiver.already_open': 'gates.refusal.waiverAlreadyOpen',
  'gates.waiver.invalid_state': 'gates.refusal.waiverInvalidState',
  'gates.waiver.expired': 'gates.refusal.waiverExpired',
  'gates.waiver.no_approval_request': 'gates.refusal.waiverNoApprovalRequest',
  'gates.waiver.approval_not_pending': 'gates.refusal.waiverApprovalNotPending',
  'gates.waiver.approval_stale': 'gates.refusal.waiverApprovalStale',
  'gates.waiver.unauthorized': 'gates.refusal.waiverUnauthorized',
  'gates.waiver.self_approval': 'gates.refusal.waiverSelfApproval',
  'gates.waiver.missing_basis': 'gates.refusal.waiverMissingBasis',
  'gates.human_only': 'gates.refusal.humanOnly',
  'waiver.unsupported_target': 'gates.refusal.waiverUnsupportedTarget',
  'xproj.same_project': 'planning.refusal.codes.xproj_same_project',
  'xproj.already_closed': 'planning.refusal.codes.xproj_already_closed',
  'xproj.local_item_incomplete': 'planning.refusal.codes.xproj_local_item_incomplete',
};

/** `(error) => translated explanation | null` for the active locale. */
export function useRefusalMessage() {
  const { t, formatNumber, formatList } = useI18n();
  return useCallback(
    (error: unknown): string | null => {
      if (!isApiError(error)) return null;
      const entry = REFUSAL_KEYS[error.code];
      if (!entry) return null;
      if (typeof entry === 'string') return t(entry);
      const r = entry(error.details, { formatNumber: (n) => formatNumber(n), formatList });
      return t(r.key, r.values);
    },
    [t, formatNumber, formatList],
  );
}
