import Decimal from 'decimal.js';
import { forbidden, invalid, ruleViolation } from './errors';
import type {
  ClosingKind,
  ClosingStatus,
  ConditionStatus,
  DecisionAuthorityOutcome,
  DecisionStatus,
  DdReleaseStatus,
  GateAssessmentStatus,
  PartnerStage,
  RoleKey,
} from './enums';
import { FINDING_STATUSES, NEGOTIATION_ISSUE_STATUSES, POST_CLOSE_STATUSES, FUNDS_FLOW_STATUSES } from './enums';
import { APPROVED_GATE_STATUSES, FINAL_APPROVED_DECISION_STATUSES } from './gates';
import { partnerStageAtLeast } from './carveout';
import { renderMessagesEn, serverMessage, type ServerMessage } from './messages';
import { PARTNER_MACHINE, allowedCommands, type Machine, type PartnerCommand } from './workflows';

/**
 * JV / partner process / due diligence / signing & closing rules (spec §8; REQ-JV-001..019, REQ-LCY-008/009,
 * REQ-ENT-012; AT-03, AT-11, AT-12, AT-13). Pure functions only — the jv module's command services call them before
 * writing. Nothing here invents a partner identity, an ownership percentage, a valuation or a term.
 */

// ---------------------------------------------------------------------------------------------------------
// Vocabularies (stored as varchar + CHECK constraints in packages/db/src/schema/jv.ts)

export const ROOM_TYPES = ['partner', 'internal', 'clean_team'] as const;
export type RoomType = (typeof ROOM_TYPES)[number];
/** read = view the index / disclosed items; contribute = raise DD requests, draft answers, findings; manage = VDR index. */
export const ROOM_ACCESS_LEVELS = ['read', 'contribute', 'manage'] as const;
export type RoomAccessLevel = (typeof ROOM_ACCESS_LEVELS)[number];
/** Roles that exist only inside a room (a grant WITH one of these brings room-scoped permissions). */
export const ROOM_SCOPED_ROLES = ['clean_team', 'external_partner_limited'] as const;
export type RoomScopedRole = (typeof ROOM_SCOPED_ROLES)[number];
export const DISCLOSURE_STATUSES = ['requested', 'released', 'rejected', 'revoked'] as const;
export type DisclosureStatus = (typeof DISCLOSURE_STATUSES)[number];
export const ROOM_ACCESS_EVENT_KINDS = [
  'grant',
  'grant_revoked',
  'disclosure_requested',
  'disclosure_released',
  'disclosure_rejected',
  'disclosure_revoked',
  'dd_answer_released',
  'download',
  'room_locked',
  'room_unlocked',
] as const;
export type RoomAccessEventKind = (typeof ROOM_ACCESS_EVENT_KINDS)[number];
/** Every assessment / proposal entry says whether it is a verifiable fact or the team's judgement (REQ-JV-006). */
export const ASSESSMENT_BASES = ['fact', 'judgement'] as const;
export type AssessmentBasis = (typeof ASSESSMENT_BASES)[number];
export const DD_REQUEST_ORIGINS = ['internal', 'partner'] as const;
export const DD_DOMAINS = ['legal', 'finance', 'tax', 'technical', 'commercial', 'hr', 'regulatory', 'operations', 'other'] as const;
export type DdDomain = (typeof DD_DOMAINS)[number];
/** What the counterparty sees of a DD request (external projection — never drafts, assignees or reviewers). */
export const DD_EXTERNAL_STATUSES = ['open', 'answered', 'withheld'] as const;
export type DdExternalStatus = (typeof DD_EXTERNAL_STATUSES)[number];
export const PARTNER_CONFLICT_STATUSES = ['open', 'mitigated', 'cleared'] as const;
export type PartnerConflictStatus = (typeof PARTNER_CONFLICT_STATUSES)[number];
export const PROGRAM_CLOSURE_STATUSES = ['requested', 'confirmed', 'rejected'] as const;
export type ProgramClosureStatus = (typeof PROGRAM_CLOSURE_STATUSES)[number];
/** Assessment scores are on a 0–5 scale (decimal, ≤ 2 dp). The scale is a template choice, not a Mobily fact. */
export const ASSESSMENT_SCORE_MAX = 5;
/** Proposed maximum validity of an external room grant (access-matrix §4: ≤ 90 days, Mobily to confirm). */
export const EXTERNAL_GRANT_MAX_DAYS = 90;
/** Materiality levels treated as MATERIAL findings (remediation owner mandatory — REQ-JV-011). */
export const MATERIAL_FINDING_LEVELS = ['high', 'critical'] as const;
/** Decision types (DEMO authority matrix keys) that authorize signing / closing confirmation / partner outreach. */
export const SIGNING_DECISION_TYPE_KEYS: readonly string[] = ['jv_signing_authorization'];
export const CLOSING_DECISION_TYPE_KEYS: readonly string[] = ['jv_closing_confirmation'];
export const OUTREACH_DECISION_TYPE_KEYS: readonly string[] = ['partner_outreach_and_access'];

/**
 * Why a decision linked to a JV record does not (or no longer) back it, as shown next to the record (the web translates the
 * code): the linked-decision codes (missing, wrong type, recommended, not approved, …) plus the reliance checks of the
 * decision-use registry (DOM-P4-01) and of the external-approval evidence (DOM-P4-08):
 *  - `evidence_invalid`: the evidence of the external approval is no longer an active, verified link (rejected as
 *    defective, superseded, conflicting) — shown on a confirmed signing / closing too (controlled reassessment needed);
 *  - `already_used`: the decision already backs another closing (one decision confirms one closing);
 *  - `other_subject`: the decision was raised for another record.
 */
export const JV_DECISION_ISSUE_CODES = ['missing', 'wrong_type', 'recommended', 'not_approved', 'external_approval_missing', 'authority_unassessed', 'evidence_invalid', 'already_used', 'other_subject'] as const;
export type JvDecisionIssueCode = (typeof JV_DECISION_ISSUE_CODES)[number];

type FindingStatus = (typeof FINDING_STATUSES)[number];
type NegotiationIssueStatus = (typeof NEGOTIATION_ISSUE_STATUSES)[number];
type PostCloseStatus = (typeof POST_CLOSE_STATUSES)[number];
type FundsFlowStatus = (typeof FUNDS_FLOW_STATUSES)[number];

// ---------------------------------------------------------------------------------------------------------
// Server messages (QA-P1-14): closing / signing blockers are returned as codes + parameters.

export const JV_MESSAGES_EN: Readonly<Record<string, string>> = {
  'jv.closing.no_signing': 'No signing is linked to this closing',
  'jv.closing.signing_not_confirmed': 'Signing {signing} has not been confirmed',
  /** `status` is a condition status enum value. */
  'jv.closing.cp_unmet': 'Blocking condition {ref} is {status}',
  'jv.closing.cp_verified_without_evidence': 'Blocking condition {ref} is verified without active evidence',
  'jv.closing.cp_waiver_not_effective': 'Blocking condition {ref} is waived without an effective approved waiver',
  'jv.closing.cp_validity_lapsed': 'The validity of condition {ref} lapsed on {date}',
  'jv.closing.cp_long_stop_passed': 'The long-stop date {date} of condition {ref} has passed',
  'jv.closing.item_not_accepted': 'Checklist item {ref} is not accepted',
};

export interface EventBlocker {
  kind: 'signing' | 'condition' | 'checklist_item';
  ref: string;
  /** English sentence (audit rows, record history, AI context). */
  message: string;
  messageI18n: ServerMessage[];
}

function blocker(kind: EventBlocker['kind'], ref: string, msg: ServerMessage): EventBlocker {
  return { kind, ref, message: renderMessagesEn([msg], JV_MESSAGES_EN), messageI18n: [msg] };
}

// ---------------------------------------------------------------------------------------------------------
// Partner engagement (REQ-JV-003/004/005)

/** Stages reachable only through their own approval commands (never through the generic `advance`). */
export const PARTNER_GUARDED_STAGES: readonly PartnerStage[] = ['approved_for_contact', 'nda'];

/** Stages the partner can move to next from `current` (withdrawal excluded). */
export function nextPartnerStages(current: PartnerStage): PartnerStage[] {
  return allowedCommands(PARTNER_MACHINE, current)
    .filter((c) => c !== 'withdraw')
    .map((c) => PARTNER_MACHINE[c].to);
}

/**
 * Resolve an engagement move `current → to` to its state-machine command. Moves that skip a stage (or go backwards) are
 * rejected (REQ-JV-003 "stage machine rejects skipped stages").
 */
export function partnerAdvanceCommand(current: PartnerStage, to: PartnerStage): PartnerCommand {
  const cmds = Object.keys(PARTNER_MACHINE) as PartnerCommand[];
  const direct = cmds.find((c) => PARTNER_MACHINE[c].to === to && PARTNER_MACHINE[c].from.includes(current));
  if (direct) return direct;
  const next = nextPartnerStages(current);
  throw ruleViolation(
    'jv.partner.stage_skipped',
    current === 'withdrawn'
      ? 'A withdrawn partner cannot re-enter the process'
      : `Cannot move a partner from "${current}" to "${to}": engagement stages cannot be skipped or reversed (next: ${next.join(', ') || 'none'})`,
    { current, to, next },
  );
}

export interface PartnerStageGuardInput {
  to: PartnerStage;
  outreachApproved: boolean;
  ndaExecuted: boolean;
  /** A signing event of this partner has been confirmed (for the move to `closing`). */
  signingConfirmed: boolean;
  /** The move comes through the dedicated approval command (outreach approval / NDA recording). */
  viaApprovalCommand?: boolean;
}

/** Data guards of an engagement move (checked before the state machine). */
export function assertPartnerStageGuards(i: PartnerStageGuardInput): void {
  if (PARTNER_GUARDED_STAGES.includes(i.to) && !i.viaApprovalCommand) {
    if (i.to === 'nda' && !i.outreachApproved) {
      throw ruleViolation('jv.partner.outreach_approval_required', 'A partner cannot move to NDA without a recorded outreach approval');
    }
    throw ruleViolation(
      'jv.partner.use_approval_command',
      i.to === 'approved_for_contact' ? 'Contact approval is recorded only through the outreach approval (a separate, authorized approval)' : 'NDA execution is recorded only through the NDA recording command (with the executed copy)',
    );
  }
  if (i.to === 'nda' && !i.outreachApproved) throw ruleViolation('jv.partner.outreach_approval_required', 'A partner cannot move to NDA without a recorded outreach approval');
  if (i.to === 'materials_access' && !i.ndaExecuted) throw ruleViolation('jv.partner.nda_required', 'Materials access requires an executed NDA (the NDA itself grants no document access)');
  if (i.to === 'closing' && !i.signingConfirmed) throw ruleViolation('jv.partner.signing_not_confirmed', 'A partner moves to closing only after its signing has been confirmed');
}

/** Separation of duties for outreach approval / NDA recording: not the requester and not a person with an open conflict. */
export function assertPartnerApprovalSeparation(i: { approverUserId: string; requesterUserId: string; conflictedUserIds: readonly string[]; what: string }): void {
  if (i.approverUserId === i.requesterUserId) throw forbidden('jv.partner.self_approval', `${i.what}: the requester cannot approve their own request`);
  if (i.conflictedUserIds.includes(i.approverUserId)) throw forbidden('jv.partner.conflicted_approver', `${i.what}: a person with an open conflict disclosure on this partner cannot approve`);
}

// ---------------------------------------------------------------------------------------------------------
// Screening criteria, weights and assessments (REQ-JV-002, REQ-JV-006)

export interface ScreeningCriterion {
  key: string;
  name: string;
  nameAr?: string | null;
  /** Decimal string, percent of the total (> 0, ≤ 100, max 2 dp). */
  weight: string;
}

const DEC2 = /^\d{1,3}(\.\d{1,2})?$/;
const KEY = /^[a-z][a-z0-9_]{0,31}$/;

/** Weights must be positive and sum to exactly 100 (REQ-JV-002 "weights sum validated"). */
export function assertCriteriaWeights(criteria: readonly ScreeningCriterion[]): { total: string } {
  if (criteria.length === 0) throw ruleViolation('jv.criteria.empty', 'At least one screening criterion is required');
  const keys = new Set<string>();
  let total = new Decimal(0);
  for (const c of criteria) {
    if (!KEY.test(c.key)) throw invalid('jv.criteria.invalid_key', `Criterion key "${c.key}" must be lower_snake_case (max 32 characters)`);
    if (keys.has(c.key)) throw ruleViolation('jv.criteria.duplicate_key', `Criterion key "${c.key}" is used twice`);
    keys.add(c.key);
    if (!c.name.trim()) throw invalid('jv.criteria.name_required', `Criterion "${c.key}" needs a name`);
    if (!DEC2.test(c.weight)) throw invalid('jv.criteria.invalid_weight', `Weight of "${c.key}" must be a decimal with at most 2 decimal places`);
    const w = new Decimal(c.weight);
    if (w.lte(0) || w.gt(100)) throw ruleViolation('jv.criteria.weight_out_of_range', `Weight of "${c.key}" must be greater than 0 and at most 100`);
    total = total.plus(w);
  }
  if (!total.eq(100)) {
    throw ruleViolation('jv.criteria.weights_sum', `Criterion weights must sum to 100 (they sum to ${total.toFixed(2)})`, { total: total.toFixed(2) });
  }
  return { total: total.toFixed(2) };
}

export function assertScore(score: string): Decimal {
  if (!DEC2.test(score)) throw invalid('jv.assessment.invalid_score', 'A score must be a decimal with at most 2 decimal places');
  const s = new Decimal(score);
  if (s.lt(0) || s.gt(ASSESSMENT_SCORE_MAX)) throw ruleViolation('jv.assessment.score_out_of_range', `A score must be between 0 and ${ASSESSMENT_SCORE_MAX}`);
  return s;
}

/**
 * Weighted score of one partner = Σ(weight × score) / 100, on the 0–5 scale. Returns null (not a guess) while any
 * criterion is unscored — a partial score would overstate or understate a partner.
 */
export function weightedScore(criteria: readonly ScreeningCriterion[], scores: Readonly<Record<string, string | null | undefined>>): { score: string | null; missing: string[] } {
  const missing = criteria.filter((c) => scores[c.key] == null).map((c) => c.key);
  if (missing.length || criteria.length === 0) return { score: null, missing };
  let sum = new Decimal(0);
  for (const c of criteria) sum = sum.plus(new Decimal(c.weight).times(new Decimal(scores[c.key]!)));
  return { score: sum.dividedBy(100).toFixed(2), missing: [] };
}

export interface AssessmentEntryInput {
  basis: string | null | undefined;
  statement: string;
  criterionKey?: string | null;
  score?: string | null;
  sourceReference?: string | null;
  documentId?: string | null;
  knownCriterionKeys: readonly string[];
}

/** Every entry is tagged fact or judgement; a fact cites its source; a score belongs to a defined criterion. */
export function assertAssessmentEntry(e: AssessmentEntryInput): AssessmentBasis {
  if (!e.basis || !(ASSESSMENT_BASES as readonly string[]).includes(e.basis)) {
    throw ruleViolation('jv.assessment.basis_required', 'Every assessment entry must be tagged as a fact or as team judgement');
  }
  if (!e.statement.trim()) throw invalid('jv.assessment.statement_required', 'An assessment entry needs a statement');
  if (e.basis === 'fact' && !e.sourceReference?.trim() && !e.documentId) {
    throw ruleViolation('jv.assessment.fact_source_required', 'A fact must cite its source (a document or a source reference); otherwise record it as judgement');
  }
  if (e.score != null) {
    if (!e.criterionKey) throw ruleViolation('jv.assessment.score_needs_criterion', 'A score must be given against a screening criterion');
    assertScore(e.score);
  }
  if (e.criterionKey && !e.knownCriterionKeys.includes(e.criterionKey)) {
    throw ruleViolation('jv.assessment.unknown_criterion', `Criterion "${e.criterionKey}" is not in the approved screening criteria`);
  }
  return e.basis as AssessmentBasis;
}

// ---------------------------------------------------------------------------------------------------------
// Ownership / contribution / governance scenarios (REQ-JV-007)

export interface OwnershipEntry {
  party: string;
  /** Decimal string (0–100, ≤ 4 dp) or null = not determined. Never defaulted by the platform. */
  percent: string | null;
  note?: string | null;
}

const PCT = /^\d{1,3}(\.\d{1,4})?$/;

/**
 * A new scenario lists the parties only — every percentage is `null` (TBD) until a person enters it. The platform never
 * assumes control or a contribution percentage.
 */
export function blankOwnership(parties: readonly string[]): OwnershipEntry[] {
  return parties.map((party) => ({ party, percent: null }));
}

/**
 * Validates entered percentages: each within 0–100; the entered ones never exceed 100 in total; when every party has a
 * percentage, they total exactly 100. Returns the total of the entered values (null when none is entered) and whether
 * the split is complete. It never derives a controlling party.
 */
export function assertOwnershipScenario(entries: readonly OwnershipEntry[]): { complete: boolean; total: string | null } {
  const parties = new Set<string>();
  let total = new Decimal(0);
  let entered = 0;
  for (const e of entries) {
    const party = e.party.trim();
    if (!party) throw invalid('jv.scenario.party_required', 'Every ownership line needs a party');
    if (parties.has(party.toLowerCase())) throw ruleViolation('jv.scenario.duplicate_party', `Party "${party}" is listed twice`);
    parties.add(party.toLowerCase());
    if (e.percent === null || e.percent === undefined) continue;
    if (!PCT.test(e.percent)) throw invalid('jv.scenario.invalid_percent', `The percentage of "${party}" must be a decimal with at most 4 decimal places`);
    const p = new Decimal(e.percent);
    if (p.gt(100)) throw ruleViolation('jv.scenario.percent_out_of_range', `The percentage of "${party}" cannot exceed 100`);
    total = total.plus(p);
    entered++;
  }
  if (total.gt(100)) throw ruleViolation('jv.scenario.ownership_exceeds_100', `Entered ownership percentages total ${total.toFixed(4)} (more than 100)`, { total: total.toFixed(4) });
  const complete = entries.length > 0 && entered === entries.length;
  if (complete && !total.eq(100)) throw ruleViolation('jv.scenario.ownership_not_100', `A complete ownership split must total 100 (it totals ${total.toFixed(4)})`, { total: total.toFixed(4) });
  return { complete, total: entered ? total.toFixed(4) : null };
}

// ---------------------------------------------------------------------------------------------------------
// Terms & negotiation issues (REQ-JV-008)

export type NegotiationCommand = 'propose_resolution' | 'agree' | 'escalate' | 'close' | 'reopen';
export const NEGOTIATION_ISSUE_MACHINE: Machine<NegotiationIssueStatus, NegotiationCommand> = {
  propose_resolution: { from: ['open', 'escalated'], to: 'proposed_resolution', description: 'A resolution is proposed' },
  agree: { from: ['proposed_resolution'], to: 'agreed', description: 'Parties agree (an issue needing approval needs its approved decision)' },
  escalate: { from: ['open', 'proposed_resolution'], to: 'escalated', description: 'Escalated for a decision' },
  close: { from: ['agreed'], to: 'closed', description: 'Closed (reflected in the agreement)' },
  reopen: { from: ['agreed', 'closed', 'escalated'], to: 'open', description: 'Reopened' },
};

/** An issue that needs approval must link the governance decision that approves it (REQ-JV-008). */
export function assertNegotiationIssueLinks(i: { requiresApproval: boolean; decisionId: string | null | undefined }): void {
  if (i.requiresApproval && !i.decisionId) {
    throw ruleViolation('jv.negotiation.decision_required', 'An issue that requires approval must link the governance decision that approves it');
  }
}

export interface LinkedDecisionState {
  status: DecisionStatus;
  authorityOutcome: DecisionAuthorityOutcome;
  externalAuthorityReference?: string | null;
  decisionTypeKey?: string | null;
}

/** A decision authorizes when it is finally approved within mandate, or approved by the external authority (AT-04). */
export function decisionIsFinalApproval(d: LinkedDecisionState | null | undefined, allowedTypeKeys?: readonly string[]): boolean {
  if (!d) return false;
  if (allowedTypeKeys && (!d.decisionTypeKey || !allowedTypeKeys.includes(d.decisionTypeKey))) return false;
  if (!FINAL_APPROVED_DECISION_STATUSES.includes(d.status)) return false;
  if (d.authorityOutcome === 'within_mandate') return true;
  return d.authorityOutcome === 'pending_external_authority' && !!d.externalAuthorityReference?.trim();
}

/** Agreeing / closing an issue that needs approval requires its linked decision to be a FINAL approval. */
export function assertNegotiationAgreementAllowed(i: { requiresApproval: boolean; decision: LinkedDecisionState | null }): void {
  if (!i.requiresApproval) return;
  if (!i.decision) throw ruleViolation('jv.negotiation.decision_required', 'An issue that requires approval must link the governance decision that approves it');
  if (!decisionIsFinalApproval(i.decision)) {
    throw ruleViolation('jv.negotiation.approval_pending', `The linked decision is ${i.decision.status}; the issue can be agreed only after a final approval`);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Rooms, grants and disclosures (REQ-JV-001/005/009, REQ-ENT-012, AT-03, AT-19)

export function roomTypeOf(r: { isCleanTeam: boolean; partnerId: string | null }): RoomType {
  if (r.isCleanTeam) return 'clean_team';
  return r.partnerId ? 'partner' : 'internal';
}

const LEVEL_RANK: Record<RoomAccessLevel, number> = { read: 0, contribute: 1, manage: 2 };
export function accessLevelAllows(held: RoomAccessLevel | null | undefined, required: RoomAccessLevel): boolean {
  return !!held && LEVEL_RANK[held] >= LEVEL_RANK[required];
}

export interface RoomGrantInput {
  room: { type: RoomType; locked: boolean; partnerId: string | null; partnerStage: PartnerStage | null };
  grantee: { userId: string; accountType: 'internal' | 'external'; isActive: boolean; isFullProjectMember: boolean; boundPartnerId: string | null };
  grantorUserId: string;
  grantorRoles: readonly RoleKey[];
  role: RoomScopedRole | null;
  accessLevel: RoomAccessLevel;
  expiresAt: Date | null;
  now: Date;
  attestationRef: string | null;
}

/**
 * Who may be granted what (access-matrix §2.4 `room` / `clean_team`, §2.8, §4). An executed NDA or a partner stage never
 * implies a grant; a grant is the ONLY way into a room (REQ-JV-005).
 */
export function assertRoomGrantAllowed(i: RoomGrantInput): void {
  if (i.grantee.userId === i.grantorUserId) throw forbidden('jv.room.self_grant', 'You cannot grant room access to yourself');
  if (!i.grantee.isActive) throw ruleViolation('jv.room.grantee_inactive', 'The grantee account is not active');
  if (i.room.locked) throw ruleViolation('jv.room.locked', 'The room is locked — unlock it before granting access');
  if (i.expiresAt && i.expiresAt.getTime() <= i.now.getTime()) throw ruleViolation('jv.room.expiry_in_past', 'The grant expiry must be in the future');
  if (i.grantee.accountType === 'external') {
    if (i.role !== 'external_partner_limited') throw ruleViolation('jv.room.external_role_required', 'An external (partner) account can only hold the external_partner_limited role');
    if (i.room.type !== 'partner') throw ruleViolation('jv.room.external_partner_room_only', 'External accounts can only be granted into a partner room');
    if (!i.grantee.boundPartnerId || i.grantee.boundPartnerId !== i.room.partnerId) {
      throw ruleViolation('jv.room.counterparty_mismatch', "The external account is not a contact of this room's partner (an external account is bound to exactly one counterparty)");
    }
    if (!i.room.partnerStage || !partnerStageAtLeast(i.room.partnerStage, 'materials_access')) {
      throw ruleViolation('jv.room.materials_access_required', 'The partner is not at the Materials access stage — an executed NDA alone grants no document access');
    }
    if (i.accessLevel === 'manage') throw ruleViolation('jv.room.external_manage_forbidden', 'External accounts cannot manage a room');
    if (!i.expiresAt) throw ruleViolation('jv.room.expiry_required', 'An external grant requires an expiry date');
    if (i.expiresAt.getTime() - i.now.getTime() > EXTERNAL_GRANT_MAX_DAYS * 86_400_000) {
      throw ruleViolation('jv.room.expiry_too_long', `An external grant may last at most ${EXTERNAL_GRANT_MAX_DAYS} days (proposed default — to be confirmed)`);
    }
    return;
  }
  if (i.role === 'external_partner_limited') throw ruleViolation('jv.room.external_role_internal_account', 'Internal accounts cannot hold the external_partner_limited role');
  if (i.room.type === 'clean_team') {
    if (i.role !== 'clean_team') throw ruleViolation('jv.room.clean_team_role_required', 'Access to a clean-team room is granted only with the clean_team role');
    if (!i.attestationRef?.trim()) throw ruleViolation('jv.room.attestation_required', 'A clean-team grant requires the clean-team attestation reference');
    if (!i.grantorRoles.includes('legal_restricted')) throw forbidden('jv.room.clean_team_legal_only', 'Only Legal may assign clean-team membership');
    return;
  }
  if (i.role === 'clean_team') throw ruleViolation('jv.room.clean_team_room_only', 'The clean_team role can only be granted into a clean-team room');
  if (!i.grantee.isFullProjectMember) throw ruleViolation('jv.room.grantee_not_member', 'Internal room access requires an active project role (room grants never create project membership)');
}

export function assertDisclosureRequestable(i: { roomType: RoomType; roomLocked: boolean; versionUsable: boolean; documentInRoom: boolean }): void {
  if (i.roomType === 'clean_team') throw ruleViolation('jv.disclosure.clean_team_room', 'Clean-team material is never disclosed to a counterparty (use the clean-team output release)');
  if (i.roomType !== 'partner') throw ruleViolation('jv.disclosure.partner_room_only', 'Disclosures are made into a partner room');
  if (i.roomLocked) throw ruleViolation('jv.room.locked', 'The room is locked');
  if (!i.documentInRoom) throw ruleViolation('jv.disclosure.document_not_in_room', 'Only a document filed in this room can be disclosed from it');
  if (!i.versionUsable) throw ruleViolation('jv.disclosure.version_not_usable', 'The document version is quarantined, pending or rejected and cannot be disclosed');
}

/** Release of a disclosure (jv.disclosure.release): an approved, separate person; never the requester or uploader. */
export function assertDisclosureReleasable(i: { status: DisclosureStatus; releaserUserId: string; requesterUserId: string; uploaderUserId: string | null; versionUsable: boolean; roomLocked: boolean }): void {
  if (i.status !== 'requested') throw ruleViolation('jv.disclosure.not_requested', `The disclosure is ${i.status}; only a requested disclosure can be released`);
  if (i.releaserUserId === i.requesterUserId || i.releaserUserId === i.uploaderUserId) {
    throw forbidden('jv.disclosure.self_release', 'The requester or uploader of an item cannot release it');
  }
  if (i.roomLocked) throw ruleViolation('jv.room.locked', 'The room is locked');
  if (!i.versionUsable) throw ruleViolation('jv.disclosure.version_not_usable', 'The document version cannot be disclosed');
}

// ---------------------------------------------------------------------------------------------------------
// DD requests / Q&A (REQ-JV-010)

export function externalDdStatus(s: DdReleaseStatus): DdExternalStatus {
  if (s === 'released') return 'answered';
  if (s === 'withheld') return 'withheld';
  return 'open';
}

export function assertDdReviewAllowed(i: { reviewerUserId: string; drafterUserId: string | null }): void {
  if (i.drafterUserId && i.reviewerUserId === i.drafterUserId) throw forbidden('jv.dd.self_review', 'The drafter of an answer cannot review it');
}

/** One evidence document of a DD answer pinned to the version submitted for review. */
export interface PinnedEvidence {
  documentId: string;
  versionId: string;
}

/**
 * DOM-P4-05 (spec §8 DD Q&A "reviewer, release approval, disclosed version"; REQ-JV-010): the evidence versions shown to
 * the reviewer are pinned when the answer is submitted for review, and the release discloses exactly those versions.
 * Every evidence document must have a pinned version; with `currentVersionByDocument` (at the review), a document whose
 * current version is no longer the pinned one was changed after submission — the reviewer never saw that version, so the
 * answer goes back to draft and is submitted again.
 */
export function assertDdEvidencePinned(i: { evidenceDocumentIds: readonly string[]; pinned: readonly PinnedEvidence[]; currentVersionByDocument?: Readonly<Record<string, string | null>> }): void {
  for (const documentId of i.evidenceDocumentIds) {
    const p = i.pinned.find((x) => x.documentId === documentId);
    if (!p) throw ruleViolation('jv.dd.evidence_not_pinned', 'The evidence of this answer was not pinned when it was submitted for review: return the answer to draft and submit it again', { documentId });
    if (i.currentVersionByDocument && i.currentVersionByDocument[documentId] !== p.versionId) {
      throw ruleViolation(
        'jv.dd.evidence_changed',
        'An evidence document has a newer version than the one submitted for review: return the answer to draft and submit it again, so that the reviewer approves the version that will be disclosed',
        { documentId },
      );
    }
  }
}

/** Release requires a reviewed and approved answer, released by someone other than the drafter (REQ-JV-010). */
export function assertDdReleaseAllowed(i: { status: DdReleaseStatus; releaserUserId: string; drafterUserId: string | null; reviewerUserId: string | null; answer: string | null }): void {
  if (i.status !== 'approved_for_release') {
    throw ruleViolation('jv.dd.release_requires_approval', `An answer can be released only after its review approved the release (current state: ${i.status})`, { status: i.status });
  }
  if (!i.answer?.trim()) throw ruleViolation('jv.dd.answer_missing', 'There is no answer to release');
  if (i.drafterUserId && i.releaserUserId === i.drafterUserId) throw forbidden('jv.dd.self_release', 'The drafter of an answer cannot release it');
  if (!i.reviewerUserId) throw ruleViolation('jv.dd.release_requires_approval', 'The answer has no recorded review approval');
}

// ---------------------------------------------------------------------------------------------------------
// Findings (REQ-JV-011, ARCH-22)

export type FindingCommand = 'plan_remediation' | 'mark_remediated' | 'accept_risk' | 'close' | 'reopen';
export const FINDING_MACHINE: Machine<FindingStatus, FindingCommand> = {
  plan_remediation: { from: ['open'], to: 'remediation_planned', description: 'Remediation owner and plan recorded' },
  mark_remediated: { from: ['remediation_planned'], to: 'remediated', description: 'Remediation reported done' },
  accept_risk: { from: ['open', 'remediation_planned'], to: 'accepted_risk', description: 'Risk accepted with a documented reason' },
  close: { from: ['remediated', 'accepted_risk'], to: 'closed', description: 'Closed' },
  reopen: { from: ['remediated', 'accepted_risk', 'closed'], to: 'open', description: 'Reopened' },
};

export function isMaterialFinding(materiality: string): boolean {
  return (MATERIAL_FINDING_LEVELS as readonly string[]).includes(materiality);
}

/** A material finding (high / critical) must name a remediation owner and a remediation (REQ-JV-011). */
export function assertFindingRemediation(f: { materiality: string; remediationOwnerUserId: string | null | undefined; remediation: string | null | undefined }): void {
  if (!isMaterialFinding(f.materiality)) return;
  if (!f.remediationOwnerUserId) throw ruleViolation('jv.finding.remediation_owner_required', 'A material finding requires a remediation owner');
  if (!f.remediation?.trim()) throw ruleViolation('jv.finding.remediation_required', 'A material finding requires a remediation plan');
}

// ---------------------------------------------------------------------------------------------------------
// Conditions precedent (REQ-JV-013, AT-12, AT-13)

/**
 * The person who LINKED active evidence of a record is "self" for its verification (access-matrix §5.1: "record owner and
 * the person who recorded the status/evidence"; SEC-P34-01): pass the `added_by` of every active evidence link of the
 * target. A verifier who supplied any of the evidence it is asked to verify is refused, whoever ran the status command.
 */
export function isEvidenceLinker(actorUserId: string, evidenceLinkerUserIds: readonly string[]): boolean {
  return evidenceLinkerUserIds.includes(actorUserId);
}

/**
 * verifyCP: evidence is mandatory and the verifier is neither the CP owner, nor the person who submitted the evidence for
 * verification, nor anyone who linked active evidence of the condition (SEC-P34-01).
 */
export function assertCpVerifiable(i: { activeEvidence: number; verifierUserId: string; ownerUserId: string | null; evidenceSubmittedBy: string | null; evidenceLinkerUserIds: readonly string[] }): void {
  if (i.activeEvidence <= 0) throw ruleViolation('jv.cp.evidence_required', 'A condition cannot be verified without linked evidence');
  if (i.verifierUserId === i.ownerUserId) throw forbidden('jv.cp.self_verification', 'The owner of a condition cannot verify it');
  if (i.verifierUserId === i.evidenceSubmittedBy) throw forbidden('jv.cp.self_verification', 'The person who submitted the evidence cannot verify the condition');
  if (isEvidenceLinker(i.verifierUserId, i.evidenceLinkerUserIds)) throw forbidden('jv.cp.self_verification', 'The person who linked evidence of the condition cannot verify it');
}

/**
 * Specialist determination of waivability (business-gates.md §7: set only by authorized LEGAL specialists — permission
 * `jv.cp.set_waivability`): a waivable CP names its waiver authority; the basis is always documented.
 *
 * DOM-P4-03: the determination never RELEASES a blocking condition (blocking → non-blocking). Spec §3: "an exception
 * cannot override a non-waivable condition" — a non-waivable blocking CP stays blocking; a waivable one is released only
 * through the waiver register (basis, impact, approval by the designated authority who is not the requester). `current`
 * is the condition as stored (omit it only when there is none yet).
 */
export function assertCpWaivabilityDetermination(i: { waivable: boolean; waiverAuthorityRole: string | null; basis: string; blocking?: boolean; current?: { blocking: boolean; waivable: boolean } }): void {
  if (!i.basis.trim()) throw ruleViolation('jv.cp.waivability_basis_required', 'The waivability determination needs a documented basis');
  if (i.waivable && !i.waiverAuthorityRole) throw ruleViolation('jv.cp.waiver_authority_required', 'A waivable condition must name the role with waiver authority');
  if (!i.waivable && i.waiverAuthorityRole) throw ruleViolation('jv.cp.non_waivable_no_authority', 'A non-waivable condition has no waiver authority');
  if (i.current?.blocking && i.blocking === false) {
    throw ruleViolation(
      'jv.cp.blocking_release_not_allowed',
      i.current.waivable
        ? 'A blocking condition is not made non-blocking by a determination: a waivable condition is released only through an approved waiver (basis, impact, approval by the waiver authority)'
        : 'A non-waivable blocking condition stays blocking: an exception cannot override a non-waivable condition (spec §3)',
      { waivable: i.current.waivable },
    );
  }
}

// ---------------------------------------------------------------------------------------------------------
// CP validity and long-stop dates (DOM-P4-04; business-gates.md §7, G6-C03)

/**
 * Decision types that approve the extension of a CP long-stop date. PROPOSED (DOM-P4-04): the DEMO authority matrix has no
 * dedicated type; the closing authority's type (`jv_closing_confirmation`, gate G6 — G6-C03 "no CP is past its long-stop
 * date without an approved extension recorded") is required until Legal confirms the actual authority.
 */
export const CP_LONG_STOP_EXTENSION_DECISION_TYPE_KEYS: readonly string[] = ['jv_closing_confirmation'];
/**
 * Warning window before a long-stop date (days) in which an open CP without evidence is escalated. PROPOSED default
 * (the specification gives no window; same value as the TSA end-date warning window) — to be confirmed.
 */
export const CP_LONG_STOP_WARN_DAYS = 30;

/**
 * PATCH of a CP's dates (business-gates.md §7 "an expired approval re-opens the CP"; "passing [the long-stop date]
 * without an approved extension makes the CP lapsed"):
 *  - the validity (`validTo`) of a verified or waived CP is what its verification / waiver relied on: it changes only
 *    after the CP is reopened (explicit command with a reason) and is then verified again;
 *  - a long-stop date is SET freely when none is recorded, and may be brought forward; moving it later, clearing it, or
 *    changing it on a lapsed CP needs an approved extension (`extend-long-stop`).
 */
export function assertCpDatesEditable(i: {
  status: ConditionStatus;
  current: { validTo: string | null; longStopDate: string | null };
  next: { validTo?: string | null; longStopDate?: string | null };
}): void {
  if (i.next.validTo !== undefined && i.next.validTo !== i.current.validTo && (i.status === 'verified' || i.status === 'waived')) {
    throw ruleViolation(
      'jv.cp.validity_locked',
      `The validity date of a ${i.status} condition is what its ${i.status === 'verified' ? 'verification' : 'waiver'} relied on: reopen the condition (with a reason) and have it verified again to change it`,
      { status: i.status },
    );
  }
  if (i.next.longStopDate !== undefined && i.next.longStopDate !== i.current.longStopDate) {
    const cur = i.current.longStopDate;
    const nxt = i.next.longStopDate;
    if (i.status === 'lapsed' || (cur !== null && (nxt === null || nxt > cur))) {
      throw ruleViolation(
        'jv.cp.long_stop_extension_required',
        `Moving the long-stop date${cur ? ` ${cur}` : ''} later, clearing it or changing it on a lapsed condition needs an approved extension (extend the long-stop date with the approving decision)`,
        { longStopDate: cur },
      );
    }
  }
}

/** Extension of a CP long-stop date: a later date, not in the past, on a FINAL approved decision not used for the current extension. */
export function assertCpLongStopExtension(i: {
  status: ConditionStatus;
  currentLongStop: string | null;
  newLongStop: string;
  today: string;
  decisionId: string;
  decision: LinkedDecisionState | null;
  previousExtensionDecisionId: string | null;
}): void {
  if (!(['open', 'evidence_submitted', 'lapsed'] as ConditionStatus[]).includes(i.status)) {
    throw ruleViolation('jv.cp.extension_invalid_state', `A ${i.status} condition needs no long-stop extension`, { status: i.status });
  }
  if (!i.currentLongStop) throw ruleViolation('jv.cp.extension_no_long_stop', 'The condition has no long-stop date to extend (record it on the condition first)');
  if (i.newLongStop <= i.currentLongStop || i.newLongStop < i.today) {
    throw ruleViolation('jv.cp.extension_date_invalid', `The extended long-stop date must be later than ${i.currentLongStop} and not in the past`, { longStopDate: i.currentLongStop });
  }
  if (!decisionIsFinalApproval(i.decision, CP_LONG_STOP_EXTENSION_DECISION_TYPE_KEYS)) {
    throw ruleViolation(
      'jv.cp.extension_decision_not_final',
      `A long-stop extension needs a FINAL approved governance decision of type ${CP_LONG_STOP_EXTENSION_DECISION_TYPE_KEYS.join(' / ')} (within the mandate or approved by the authorized body)`,
      { decisionStatus: i.decision?.status ?? null },
    );
  }
  if (i.previousExtensionDecisionId && i.previousExtensionDecisionId === i.decisionId) {
    throw ruleViolation('jv.cp.extension_decision_already_used', 'This decision already authorized the current extension; a further extension needs a new decision');
  }
}

export type CpLongStopAction =
  | { action: 'none' }
  | { action: 'escalate_approaching'; daysLeft: number }
  | { action: 'mark_lapsed'; daysPast: number }
  | { action: 'ensure_escalation'; daysPast: number };

const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * Long-stop evaluation for the daily scan (business dates in the project timezone). An unsatisfied CP (open / evidence
 * submitted) past its long-stop date lapses; an open CP without evidence inside the warning window is escalated; a lapsed
 * CP keeps (at most) one escalation per long-stop date.
 */
export function assessCpLongStop(i: { status: ConditionStatus; longStopDate: string | null; activeEvidence: number; today: string; warnDays?: number }): CpLongStopAction {
  if (!i.longStopDate) return { action: 'none' };
  if (i.status === 'lapsed') return { action: 'ensure_escalation', daysPast: Math.max(0, dayDiff(i.longStopDate, i.today)) };
  if (i.status !== 'open' && i.status !== 'evidence_submitted') return { action: 'none' };
  if (i.longStopDate < i.today) return { action: 'mark_lapsed', daysPast: dayDiff(i.longStopDate, i.today) };
  const daysLeft = dayDiff(i.today, i.longStopDate);
  if (i.status === 'open' && i.activeEvidence <= 0 && daysLeft <= (i.warnDays ?? CP_LONG_STOP_WARN_DAYS)) return { action: 'escalate_approaching', daysLeft };
  return { action: 'none' };
}

// ---------------------------------------------------------------------------------------------------------
// Signing / closing readiness (REQ-LCY-009, REQ-JV-012/017/018)

export interface EventReadinessInput {
  kind: ClosingKind;
  /** For a closing: its signing (null = none linked). */
  signing: { code: string; status: ClosingStatus } | null;
  conditions: {
    reference: string;
    blocking: boolean;
    waivable: boolean;
    status: ConditionStatus;
    waiverEffective: boolean;
    activeEvidence: number;
    validTo: string | null;
    longStopDate: string | null;
  }[];
  items: { ref: string; status: 'pending' | 'delivered' | 'verified' | 'not_required' }[];
  today: string;
}

/**
 * Everything that blocks confirming a signing or a closing. Task completion is NOT an input: completing a generic task
 * list never closes the transaction (REQ-JV-017). Evaluated again inside the confirm transaction (REQ-JV-018).
 */
export function eventBlockers(i: EventReadinessInput): EventBlocker[] {
  const out: EventBlocker[] = [];
  if (i.kind === 'closing') {
    if (!i.signing) out.push(blocker('signing', 'signing', serverMessage('jv.closing.no_signing')));
    else if (i.signing.status !== 'confirmed') out.push(blocker('signing', i.signing.code, serverMessage('jv.closing.signing_not_confirmed', { signing: i.signing.code })));
  }
  for (const c of i.conditions) {
    if (!c.blocking) continue;
    const verified = c.status === 'verified' && c.activeEvidence > 0;
    const waived = c.status === 'waived' && c.waivable && c.waiverEffective;
    if (c.status === 'verified' && c.activeEvidence <= 0) out.push(blocker('condition', c.reference, serverMessage('jv.closing.cp_verified_without_evidence', { ref: c.reference })));
    else if (c.status === 'waived' && !waived) out.push(blocker('condition', c.reference, serverMessage('jv.closing.cp_waiver_not_effective', { ref: c.reference })));
    else if (!verified && !waived) out.push(blocker('condition', c.reference, serverMessage('jv.closing.cp_unmet', { ref: c.reference, status: c.status })));
    if ((verified || waived) && c.validTo && c.validTo < i.today) out.push(blocker('condition', c.reference, serverMessage('jv.closing.cp_validity_lapsed', { ref: c.reference, date: c.validTo })));
    if (!verified && !waived && c.longStopDate && c.longStopDate < i.today) out.push(blocker('condition', c.reference, serverMessage('jv.closing.cp_long_stop_passed', { ref: c.reference, date: c.longStopDate })));
  }
  for (const it of i.items) {
    if (it.status !== 'verified' && it.status !== 'not_required') out.push(blocker('checklist_item', it.ref, serverMessage('jv.closing.item_not_accepted', { ref: it.ref })));
  }
  return out;
}

/** The business gate whose approval establishes signing readiness (business-gates.md §3 G5, §8 rule 5). */
export const SIGNING_GATE_KEY = 'G5';

/** The current cycle of a business gate, as the JV rules need it. */
export interface GateCycleState {
  assessmentId: string | null;
  status: GateAssessmentStatus | null;
  /** The approval is flagged for controlled reassessment (relied-upon evidence changed — DOM-P2-05). */
  underReassessment: boolean;
  /** The governance decision that backed the cycle's approval. */
  decisionId: string | null;
}

/**
 * DOM-P4-02 (business-gates.md §8 rule 5 "a recorded signing (after G5)"; spec §3 enforceable gates): a signing is
 * requested and recorded only while the CURRENT cycle of gate G5 (JV Signing Readiness) is approved (with or without
 * exceptions) and not flagged for reassessment, and on the decision that approved that cycle — `jv_signing_authorization`
 * is the decision type the authority matrix assigns to G5, so the decision that passes G5 is the signing authorization.
 * Evaluated at the request AND again inside the recording transaction.
 */
export function assertSigningGatePassed(i: { gate: GateCycleState | null; decisionId: string | null }): void {
  const status = i.gate?.status ?? null;
  if (!i.gate || !status || !APPROVED_GATE_STATUSES.includes(status)) {
    throw ruleViolation(
      'jv.signing.g5_not_passed',
      `A signing can be recorded only after gate ${SIGNING_GATE_KEY} (JV Signing Readiness) is approved (${SIGNING_GATE_KEY} is ${status ?? 'not assessed'})`,
      { gateKey: SIGNING_GATE_KEY, gateStatus: status },
    );
  }
  if (i.gate.underReassessment) {
    throw ruleViolation(
      'jv.signing.g5_under_reassessment',
      `The approval of gate ${SIGNING_GATE_KEY} is flagged for controlled reassessment (evidence it relied upon changed): no signing can be recorded until it is reassessed`,
      { gateKey: SIGNING_GATE_KEY, gateStatus: status },
    );
  }
  if (!i.decisionId || i.gate.decisionId !== i.decisionId) {
    throw ruleViolation('jv.signing.decision_not_g5', `The signing must be authorized by the decision that approved the current ${SIGNING_GATE_KEY} cycle`, { gateKey: SIGNING_GATE_KEY });
  }
}

/** Authorized confirmation: separate person, a FINAL approved decision of the right type, and no blocker (AT-12). */
export function assertEventConfirmable(i: {
  kind: ClosingKind;
  blockers: readonly EventBlocker[];
  confirmerUserId: string;
  requesterUserId: string;
  decision: LinkedDecisionState | null;
}): void {
  if (i.confirmerUserId === i.requesterUserId) throw forbidden('jv.closing.self_confirmation', `The requester of the ${i.kind} confirmation cannot confirm it`);
  if (i.blockers.length > 0) {
    throw ruleViolation(
      i.kind === 'closing' ? 'jv.closing.blocked' : 'jv.signing.blocked',
      `The ${i.kind} cannot be confirmed: ${i.blockers.map((b) => b.message).join('; ')}`,
      { blockers: i.blockers.map((b) => ({ kind: b.kind, ref: b.ref, message: b.message, messageI18n: b.messageI18n })) },
    );
  }
  const types = i.kind === 'closing' ? CLOSING_DECISION_TYPE_KEYS : SIGNING_DECISION_TYPE_KEYS;
  if (!decisionIsFinalApproval(i.decision, types)) {
    throw forbidden('jv.closing.outside_authority', `The ${i.kind} confirmation needs a linked FINAL approved governance decision of type ${types.join(' / ')}`);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Closing checklist items / deliverables (REQ-JV-012, REQ-JV-014)

/** Acceptance requires the executed document (a usable stored version) and a person other than the owner/deliverer. */
export function assertChecklistItemAcceptable(i: { status: string; executedVersionUsable: boolean | null; acceptorUserId: string; ownerUserId: string | null; deliveredBy: string | null; evidenceLinkerUserIds: readonly string[] }): void {
  if (i.status !== 'delivered') throw ruleViolation('jv.checklist_item.not_delivered', `Only a delivered item can be accepted (current state: ${i.status})`);
  if (i.executedVersionUsable !== true) throw ruleViolation('jv.checklist_item.executed_document_required', 'Acceptance requires the executed document (a stored, usable version)');
  if (i.acceptorUserId === i.ownerUserId || i.acceptorUserId === i.deliveredBy) throw forbidden('jv.checklist_item.self_acceptance', 'The owner or deliverer of a checklist item cannot accept it');
  if (isEvidenceLinker(i.acceptorUserId, i.evidenceLinkerUserIds)) throw forbidden('jv.checklist_item.self_acceptance', 'The person who linked evidence of a checklist item cannot accept it');
}

/** Checklist states from which an item may still be set "not required" (it is open: nothing was accepted yet). */
export const CHECKLIST_NOT_REQUIRED_FROM: readonly string[] = ['pending', 'delivered'];
/** `approval_request.action` of a "not required" request on a checklist item (SEC-P34-10). */
export const CHECKLIST_NOT_REQUIRED_ACTION = 'jv.checklist_item.not_required';

/**
 * SEC-P34-10 (REQ-JV-012 / REQ-JV-014): marking a signing or closing deliverable "not required" removes it from the event's
 * blockers, so it is a two-person act. The checklist manager (`jv.closing_checklist.manage`) REQUESTS it with a documented
 * reason — the item keeps its state and its blocker; a second person holding `jv.cp.verify` (never the requester) then
 * confirms it against the unchanged item, or rejects it. One pending request per item.
 */
export function assertChecklistNotRequiredRequest(i: { status: string; reason: string | null | undefined; pendingRequest: boolean }): void {
  if (!CHECKLIST_NOT_REQUIRED_FROM.includes(i.status)) throw ruleViolation('jv.checklist_item.invalid_state', `Only a pending or delivered item can be set not required (it is ${i.status})`);
  if (!i.reason?.trim()) throw ruleViolation('jv.checklist_item.reason_required', 'A documented reason is required to set an item not required');
  if (i.pendingRequest) throw ruleViolation('jv.checklist_item.not_required_pending', 'A request to set this item not required is already awaiting a second person');
}

/**
 * The second person's decision on a "not required" request (SEC-P34-10): a pending request must exist for the item as it
 * is now (the item unchanged since the request — same version — and still open); the decider is not the requester; a
 * rejection states its reason.
 */
export function assertChecklistNotRequiredDecision(i: {
  status: string;
  requestPending: boolean;
  requestedVersion: number | null;
  currentVersion: number;
  deciderUserId: string;
  requestedBy: string | null;
  decision: 'confirm' | 'reject';
  note: string | null | undefined;
}): void {
  if (!i.requestPending) throw ruleViolation('jv.checklist_item.no_not_required_request', 'No request to set this item not required is pending');
  if (!CHECKLIST_NOT_REQUIRED_FROM.includes(i.status)) throw ruleViolation('jv.checklist_item.invalid_state', `The item is ${i.status}; the request no longer applies`);
  if (i.requestedVersion !== i.currentVersion) throw ruleViolation('jv.checklist_item.not_required_stale', 'The item changed after the request; the checklist manager requests it again');
  if (!i.requestedBy || i.requestedBy === i.deciderUserId) throw forbidden('jv.checklist_item.not_required_self', 'A second person decides: the requester cannot confirm or reject their own "not required" request');
  if (i.decision === 'reject' && !i.note?.trim()) throw ruleViolation('jv.checklist_item.reason_required', 'A rejection states its reason');
}

// ---------------------------------------------------------------------------------------------------------
// Funds flow — RECORD ONLY (REQ-JV-015)

export const FUNDS_FLOW_NOTICE = 'Record-only: the platform tracks the funds flow and never executes, initiates or instructs a payment.';
export type FundsFlowCommand = 'confirm' | 'report_settled' | 'cancel';
export const FUNDS_FLOW_MACHINE: Machine<FundsFlowStatus, FundsFlowCommand> = {
  confirm: { from: ['planned'], to: 'confirmed_by_finance', description: 'Finance confirms the planned line' },
  report_settled: { from: ['confirmed_by_finance'], to: 'reported_settled', description: 'Settlement REPORTED with its external reference (nothing is paid by the platform)' },
  cancel: { from: ['planned', 'confirmed_by_finance'], to: 'cancelled', description: 'Cancelled' },
};

// ---------------------------------------------------------------------------------------------------------
// Conditions subsequent / post-close obligations (REQ-JV-016)

export type ObligationCommand = 'start' | 'report_complete' | 'verify' | 'reject_completion' | 'mark_overdue' | 'cancel';
export const POST_CLOSE_MACHINE: Machine<PostCloseStatus, ObligationCommand> = {
  start: { from: ['open', 'overdue'], to: 'in_progress', description: 'Work started' },
  report_complete: { from: ['open', 'in_progress', 'overdue'], to: 'completed_pending_evidence', description: 'Reported complete — awaits verification with evidence' },
  verify: { from: ['completed_pending_evidence'], to: 'verified', description: 'Verified by a different person with evidence' },
  reject_completion: { from: ['completed_pending_evidence'], to: 'in_progress', description: 'Completion evidence rejected' },
  mark_overdue: { from: ['open', 'in_progress'], to: 'overdue', description: 'Due date passed (project timezone) — escalated' },
  cancel: { from: ['open', 'in_progress', 'overdue'], to: 'cancelled', description: 'Cancelled with a reason' },
};

/** Overdue = the business due date (project timezone) is before today and the obligation is still open. */
export function assessObligationOverdue(i: { status: PostCloseStatus; dueDate: string | null; today: string }): { overdue: boolean; daysOverdue: number } {
  if (!i.dueDate || !['open', 'in_progress', 'overdue'].includes(i.status) || i.dueDate >= i.today) return { overdue: false, daysOverdue: 0 };
  return { overdue: true, daysOverdue: Math.round((Date.parse(i.today) - Date.parse(i.dueDate)) / 86_400_000) };
}

export function assertObligationVerifiable(i: { activeEvidence: number; verifierUserId: string; ownerUserId: string | null; reportedBy: string | null; evidenceLinkerUserIds: readonly string[] }): void {
  if (i.activeEvidence <= 0) throw ruleViolation('jv.obligation.evidence_required', 'An obligation cannot be verified without linked evidence');
  if (i.verifierUserId === i.ownerUserId || i.verifierUserId === i.reportedBy) throw forbidden('jv.obligation.self_verification', 'The owner or reporter of an obligation cannot verify it');
  if (isEvidenceLinker(i.verifierUserId, i.evidenceLinkerUserIds)) throw forbidden('jv.obligation.self_verification', 'The person who linked evidence of an obligation cannot verify it');
}

// ---------------------------------------------------------------------------------------------------------
// Program closure (REQ-JV-019)

/**
 * Program closure needs gate G7 (Stabilization & Handover) passed — approved, or approved with recorded exceptions — and
 * that approval not flagged for controlled reassessment (DOM-P4-11; DOM-P2-05: a flagged approval no longer counts).
 */
export function assertG7Passed(g7Status: GateAssessmentStatus | null, underReassessment = false): void {
  if (!g7Status || !APPROVED_GATE_STATUSES.includes(g7Status)) {
    throw ruleViolation('jv.program_closure.g7_not_passed', `Program closure requires gate G7 (Stabilization & Handover) to pass (G7 is ${g7Status ?? 'not assessed'})`, { g7Status });
  }
  if (underReassessment) {
    throw ruleViolation('jv.program_closure.g7_under_reassessment', 'The approval of gate G7 is flagged for controlled reassessment (evidence it relied upon changed): program closure waits for the reassessment', { g7Status });
  }
}

/** Program closure is separate from transaction closing: it requires gate G7 to have passed, and a second person. */
export function assertProgramClosureAllowed(i: { g7Status: GateAssessmentStatus | null; g7UnderReassessment?: boolean; confirmerUserId: string; requesterUserId: string }): void {
  assertG7Passed(i.g7Status, i.g7UnderReassessment ?? false);
  if (i.confirmerUserId === i.requesterUserId) throw forbidden('jv.program_closure.self_confirmation', 'The requester cannot confirm the program closure');
}

// ---------------------------------------------------------------------------------------------------------
// Partner preparation in parallel with separation (REQ-LCY-008, AT-11)

export interface PlanNode {
  id: string;
  gateKey: string | null;
  prerequisites: readonly string[];
}

/** Gate keys of every (transitive) prerequisite of `id` — what the node actually waits for. */
export function prerequisiteGateKeys(nodes: readonly PlanNode[], id: string): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const gates = new Set<string>();
  const stack = [...(byId.get(id)?.prerequisites ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const n = byId.get(cur);
    if (!n) continue;
    if (n.gateKey) gates.add(n.gateKey);
    stack.push(...n.prerequisites);
  }
  return gates;
}

/**
 * Separation gates (default G3 Separation & Day-1, G4 Standalone) that a JV-preparation activity waits for. Empty =
 * the activity may be scheduled in parallel with separation; only an explicit dependency adds a separation gate.
 */
export function separationGatesBlocking(nodes: readonly PlanNode[], id: string, separationGates: readonly string[] = ['G3', 'G4']): string[] {
  const g = prerequisiteGateKeys(nodes, id);
  return separationGates.filter((k) => g.has(k));
}
