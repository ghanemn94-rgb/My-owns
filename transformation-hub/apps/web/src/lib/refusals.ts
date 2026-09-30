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
  // Change control within delegated authority (DOM-P2-03)
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
  'xproj.same_project': 'planning.refusal.codes.xproj_same_project',
  'xproj.already_closed': 'planning.refusal.codes.xproj_already_closed',
  'xproj.local_item_incomplete': 'planning.refusal.codes.xproj_local_item_incomplete',
  // JV: signing after G5 (DOM-P4-02), CP determinations and dates (DOM-P4-03/04), DD evidence (DOM-P4-05), G7 (DOM-P4-11)
  'jv.signing.g5_not_passed': 'jv.refusal.codes.signing_g5_not_passed',
  'jv.signing.g5_under_reassessment': 'jv.refusal.codes.signing_g5_under_reassessment',
  'jv.signing.decision_not_g5': 'jv.refusal.codes.signing_decision_not_g5',
  'jv.cp.blocking_release_not_allowed': (d) => ({ key: d?.['waivable'] === true ? 'jv.refusal.codes.cp_blocking_release_waivable' : 'jv.refusal.codes.cp_blocking_release_non_waivable' }),
  'jv.cp.validity_locked': 'jv.refusal.codes.cp_validity_locked',
  'jv.cp.long_stop_extension_required': 'jv.refusal.codes.cp_long_stop_extension_required',
  'jv.cp.extension_invalid_state': 'jv.refusal.codes.cp_extension_invalid_state',
  'jv.cp.extension_no_long_stop': 'jv.refusal.codes.cp_extension_no_long_stop',
  'jv.cp.extension_date_invalid': 'jv.refusal.codes.cp_extension_date_invalid',
  'jv.cp.extension_decision_not_final': 'jv.refusal.codes.cp_extension_decision_not_final',
  'jv.cp.extension_decision_already_used': 'jv.refusal.codes.cp_extension_decision_already_used',
  'jv.dd.evidence_changed': 'jv.refusal.codes.dd_evidence_changed',
  'jv.dd.evidence_not_pinned': 'jv.refusal.codes.dd_evidence_not_pinned',
  'jv.program_closure.g7_under_reassessment': 'jv.refusal.codes.program_closure_g7_under_reassessment',
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
