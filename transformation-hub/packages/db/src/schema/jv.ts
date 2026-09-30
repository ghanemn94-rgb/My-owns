import { pgTable, uuid, text, integer, jsonb, varchar, date, boolean, numeric, unique, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  pk,
  orgIdCol,
  projectIdCol,
  createdAt,
  updatedAt,
  createdBy,
  versionCol,
  isDemo,
  ts,
  projectFk,
  type FkTarget,
  classification,
  partnerStage,
  ndaStatus,
  ddReleaseStatus,
  materiality,
  findingStatus,
  negotiationIssueStatus,
  closingKind,
  closingStatus,
  conditionKind,
  conditionStatus,
  closingDeliverableStatus,
  postCloseKind,
  postCloseStatus,
  fundsFlowStatus,
  approvalState,
  roleKey,
} from './_common';
import { project, legalEntity } from './portfolio';
import { appUser } from './identity';
import { agreement } from './carveout';
import { risk } from './planning';
import { decision, escalation, approvalRequest } from './governance';
import { waiver, gateAssessment } from './gates';
import { document, documentVersion } from './documents';

/**
 * JV / partner process / due diligence / signing & closing (spec §8; REQ-JV-001..019, REQ-ENT-012, REQ-LCY-009).
 * Vocabularies stored as varchar are listed in packages/domain/src/jv.ts (ROOM_TYPES, DISCLOSURE_STATUSES, …).
 * No real default names, percentages, valuations or terms: demo rows are fictional and flagged `is_demo`.
 */

/** Partner (longlist/shortlist). No real default names: demo partners are fictional and flagged. */
export const partner = pgTable(
  'partner',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    legalEntityId: uuid('legal_entity_id').references(() => legalEntity.id),
    stage: partnerStage('stage').notNull().default('identified'),
    stageChangedAt: ts('stage_changed_at'),
    shortlisted: boolean('shortlisted').notNull().default(false),
    /** Outreach approval (REQ-JV-004): pending approval request → approval by an authorized, separate person. */
    outreachRequestId: uuid('outreach_request_id'),
    outreachApprovedBy: uuid('outreach_approved_by'),
    outreachApprovedAt: ts('outreach_approved_at'),
    /** NDA execution (REQ-JV-005): submitted with the executed copy, recorded by Legal. Grants NO document access. */
    ndaStatus: ndaStatus('nda_status').notNull().default('none'),
    ndaExecutedOn: date('nda_executed_on', { mode: 'string' }),
    ndaDocumentId: uuid('nda_document_id'),
    ndaRequestId: uuid('nda_request_id'),
    ndaRecordedBy: uuid('nda_recorded_by'),
    ndaRecordedAt: ts('nda_recorded_at'),
    materialsAccessApprovedBy: uuid('materials_access_approved_by'),
    materialsAccessApprovedAt: ts('materials_access_approved_at'),
    withdrawnReason: text('withdrawn_reason'),
    classification: classification('classification').notNull().default('strictly_confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('partner_pid_uq').on(t.projectId, t.id),
    uniqueIndex('partner_code_uq').on(t.projectId, t.code),
    projectFk('partner_nda_document_fk', t.projectId, t.ndaDocumentId, (): FkTarget => document),
    projectFk('partner_outreach_request_fk', t.projectId, t.outreachRequestId, (): FkTarget => approvalRequest),
    projectFk('partner_nda_request_fk', t.projectId, t.ndaRequestId, (): FkTarget => approvalRequest),
  ],
);

/** Screening criteria and weights of a project's partner process (one versioned set per project; weights sum to 100). */
export const partnerCriteriaSet = pgTable(
  'partner_criteria_set',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    criteria: jsonb('criteria').$type<{ key: string; name: string; nameAr: string | null; weight: string }[]>().notNull(),
    note: text('note'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    updatedBy: uuid('updated_by'),
    version: versionCol(),
  },
  (t) => [uniqueIndex('partner_criteria_set_project_uq').on(t.projectId)],
);

/** Conflict disclosure about a partner (an internal person's interest, or a disclosed partner conflict). */
export const partnerConflict = pgTable(
  'partner_conflict',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    partnerId: uuid('partner_id').notNull(),
    /** Internal person with the interest (null = a conflict of the partner itself). Blocks that person's approvals. */
    declarantUserId: uuid('declarant_user_id'),
    description: text('description').notNull(),
    mitigation: text('mitigation'),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('partner_conflict_partner_fk', t.projectId, t.partnerId, (): FkTarget => partner),
    check('partner_conflict_status_ck', sql`${t.status} in ('open', 'mitigated', 'cleared')`),
  ],
);

/**
 * Binding of an EXTERNAL account to the counterparty (partner) it represents (access-matrix §2.8: exactly one
 * counterparty). A partner room grant for an external account requires this binding to the room's partner.
 */
export const partnerContact = pgTable(
  'partner_contact',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    partnerId: uuid('partner_id').notNull(),
    userId: uuid('user_id').notNull(),
    note: text('note'),
    createdAt: createdAt(),
    createdBy: createdBy(),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by'),
  },
  (t) => [
    unique('partner_contact_pid_uq').on(t.projectId, t.id),
    projectFk('partner_contact_partner_fk', t.projectId, t.partnerId, (): FkTarget => partner),
    uniqueIndex('partner_contact_active_uq').on(t.projectId, t.userId).where(sql`${t.revokedAt} is null`),
  ],
);

/** A partner proposal (scope, terms summary, source document). Assessments of it are separate fact/judgement entries. */
export const partnerProposal = pgTable(
  'partner_proposal',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    partnerId: uuid('partner_id').notNull(),
    code: varchar('code', { length: 32 }).notNull(),
    title: text('title').notNull(),
    receivedOn: date('received_on', { mode: 'string' }),
    scope: text('scope'),
    termsSummary: text('terms_summary'),
    documentId: uuid('document_id'),
    supersedesProposalId: uuid('supersedes_proposal_id'),
    classification: classification('classification').notNull().default('strictly_confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('partner_proposal_pid_uq').on(t.projectId, t.id),
    uniqueIndex('partner_proposal_code_uq').on(t.projectId, t.code),
    projectFk('partner_proposal_partner_fk', t.projectId, t.partnerId, (): FkTarget => partner),
    projectFk('partner_proposal_document_fk', t.projectId, t.documentId, (): FkTarget => document),
    projectFk('partner_proposal_supersedes_fk', t.projectId, t.supersedesProposalId, { projectId: t.projectId, id: t.id }),
  ],
);

/**
 * Comparative assessment entry (REQ-JV-006): every entry is tagged `fact` (with its source) or `judgement` (the team's
 * view). Insert-only; the latest score per partner and criterion counts.
 */
export const partnerAssessmentEntry = pgTable(
  'partner_assessment_entry',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    partnerId: uuid('partner_id').notNull(),
    proposalId: uuid('proposal_id'),
    criterionKey: varchar('criterion_key', { length: 32 }),
    basis: varchar('basis', { length: 16 }).notNull(),
    statement: text('statement').notNull(),
    score: numeric('score', { precision: 5, scale: 2 }),
    sourceReference: text('source_reference'),
    documentId: uuid('document_id'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
  },
  (t) => [
    projectFk('partner_assessment_partner_fk', t.projectId, t.partnerId, (): FkTarget => partner),
    projectFk('partner_assessment_proposal_fk', t.projectId, t.proposalId, (): FkTarget => partnerProposal),
    projectFk('partner_assessment_document_fk', t.projectId, t.documentId, (): FkTarget => document),
    check('partner_assessment_basis_ck', sql`${t.basis} in ('fact', 'judgement')`),
    check('partner_assessment_score_ck', sql`${t.score} is null or (${t.score} >= 0 and ${t.score} <= 5)`),
    check('partner_assessment_fact_source_ck', sql`${t.basis} <> 'fact' or ${t.sourceReference} is not null or ${t.documentId} is not null`),
    index('partner_assessment_partner_idx').on(t.projectId, t.partnerId),
  ],
);

/** Access-controlled partner / internal / clean-team room (type derived: clean team flag, else partner_id set = partner). */
export const partnerRoom = pgTable(
  'partner_room',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    partnerId: uuid('partner_id'),
    name: text('name').notNull(),
    description: text('description'),
    isCleanTeam: boolean('is_clean_team').notNull().default(false),
    classification: classification('classification').notNull().default('strictly_confidential'),
    /** Containment (jv.room.lock): while locked, no grant of the room is in force (scope resolution skips it). */
    lockedAt: ts('locked_at'),
    lockedBy: uuid('locked_by'),
    lockReason: text('lock_reason'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [unique('partner_room_pid_uq').on(t.projectId, t.id), projectFk('partner_room_partner_fk', t.projectId, t.partnerId, (): FkTarget => partner)],
);

/** Explicit, revocable room access grant — the only way into a room (an NDA alone grants nothing). */
export const roomGrant = pgTable(
  'room_grant',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    roomId: uuid('room_id').notNull(),
    userId: uuid('user_id').notNull().references(() => appUser.id),
    accessLevel: varchar('access_level', { length: 16 }).notNull().default('read'), // read | contribute | manage
    /** Room-scoped role (clean_team / external_partner_limited). Null = access under the user's project roles. */
    role: roleKey('role'),
    reason: text('reason').notNull(),
    /** Clean-team attestation reference (required for clean_team grants). */
    attestationRef: text('attestation_ref'),
    grantedBy: uuid('granted_by').notNull(),
    grantedAt: createdAt(),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by'),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    unique('room_grant_pid_uq').on(t.projectId, t.id),
    projectFk('room_grant_room_fk', t.projectId, t.roomId, (): FkTarget => partnerRoom),
    index('room_grant_user_idx').on(t.userId),
    check('room_grant_access_level_ck', sql`${t.accessLevel} in ('read', 'contribute', 'manage')`),
    check('room_grant_role_ck', sql`${t.role} is null or ${t.role} in ('clean_team', 'external_partner_limited')`),
  ],
);

/**
 * VDR disclosure (REQ-JV-009): a specific document VERSION released into a partner room by an authorized, separate
 * person. `room_id` is derived from the document (trigger) — never client-set. History is kept (revoked, never deleted).
 */
export const roomDisclosure = pgTable(
  'room_disclosure',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    roomId: uuid('room_id'),
    documentId: uuid('document_id').notNull(),
    documentVersionId: uuid('document_version_id').notNull(),
    diligenceRequestId: uuid('diligence_request_id'),
    status: varchar('status', { length: 16 }).notNull().default('requested'),
    requestNote: text('request_note'),
    requestedBy: uuid('requested_by').notNull(),
    releasedBy: uuid('released_by'),
    releasedAt: ts('released_at'),
    rejectedBy: uuid('rejected_by'),
    revokedBy: uuid('revoked_by'),
    revokedAt: ts('revoked_at'),
    statusReason: text('status_reason'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('room_disclosure_pid_uq').on(t.projectId, t.id),
    projectFk('room_disclosure_room_fk', t.projectId, t.roomId, (): FkTarget => partnerRoom),
    projectFk('room_disclosure_document_fk', t.projectId, t.documentId, (): FkTarget => document),
    projectFk('room_disclosure_version_fk', t.projectId, t.documentVersionId, (): FkTarget => documentVersion),
    projectFk('room_disclosure_dd_request_fk', t.projectId, t.diligenceRequestId, (): FkTarget => diligenceRequest),
    check('room_disclosure_status_ck', sql`${t.status} in ('requested', 'released', 'rejected', 'revoked')`),
    uniqueIndex('room_disclosure_live_uq').on(t.roomId, t.documentVersionId).where(sql`${t.status} in ('requested', 'released')`),
  ],
);

/**
 * Append-only access & disclosure history of a room (grants, revocations, releases, downloads, locks) — kept after
 * revocation (AT-19: a revoked grant blocks further downloads; history is retained).
 */
export const roomAccessEvent = pgTable(
  'room_access_event',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    roomId: uuid('room_id').notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    actorUserId: uuid('actor_user_id'),
    subjectUserId: uuid('subject_user_id'),
    grantId: uuid('grant_id'),
    disclosureId: uuid('disclosure_id'),
    diligenceRequestId: uuid('diligence_request_id'),
    documentVersionId: uuid('document_version_id'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    projectFk('room_access_event_room_fk', t.projectId, t.roomId, (): FkTarget => partnerRoom),
    projectFk('room_access_event_grant_fk', t.projectId, t.grantId, (): FkTarget => roomGrant),
    projectFk('room_access_event_disclosure_fk', t.projectId, t.disclosureId, (): FkTarget => roomDisclosure),
    projectFk('room_access_event_dd_request_fk', t.projectId, t.diligenceRequestId, (): FkTarget => diligenceRequest),
    projectFk('room_access_event_version_fk', t.projectId, t.documentVersionId, (): FkTarget => documentVersion),
    check(
      'room_access_event_kind_ck',
      sql`${t.kind} in ('grant', 'grant_revoked', 'disclosure_requested', 'disclosure_released', 'disclosure_rejected', 'disclosure_revoked', 'dd_answer_released', 'download', 'room_locked', 'room_unlocked')`,
    ),
    index('room_access_event_room_idx').on(t.projectId, t.roomId, t.createdAt),
  ],
);

/** Ownership / contribution / governance scenario — versioned, never assumes control or percentages. */
export const dealScenario = pgTable(
  'deal_scenario',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    partnerId: uuid('partner_id'),
    code: varchar('code', { length: 32 }),
    name: text('name').notNull(),
    /** Current version (the full history is in deal_scenario_version). */
    versionNo: integer('version_no').notNull().default(1),
    versionLabel: varchar('version_label', { length: 32 }).notNull(),
    ownership: jsonb('ownership').$type<{ party: string; percent: string | null; note?: string | null }[]>().notNull().default([]),
    contributions: jsonb('contributions').$type<{ party: string; description: string; amount?: string | null; currency?: string | null; unitScale?: number | null }[]>().notNull().default([]),
    governanceTerms: text('governance_terms'),
    assumptions: text('assumptions'),
    approvalState: approvalState('approval_state').notNull().default('proposed'),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    classification: classification('classification').notNull().default('strictly_confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('deal_scenario_pid_uq').on(t.projectId, t.id),
    uniqueIndex('deal_scenario_code_uq').on(t.projectId, t.code),
    projectFk('deal_scenario_partner_fk', t.projectId, t.partnerId, (): FkTarget => partner),
  ],
);

/** Immutable versions of a deal scenario (append-only in the database). */
export const dealScenarioVersion = pgTable(
  'deal_scenario_version',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    scenarioId: uuid('scenario_id').notNull(),
    versionNo: integer('version_no').notNull(),
    versionLabel: varchar('version_label', { length: 32 }).notNull(),
    ownership: jsonb('ownership').$type<{ party: string; percent: string | null; note?: string | null }[]>().notNull(),
    contributions: jsonb('contributions').$type<{ party: string; description: string; amount?: string | null; currency?: string | null; unitScale?: number | null }[]>().notNull(),
    governanceTerms: text('governance_terms'),
    assumptions: text('assumptions'),
    changeNote: text('change_note'),
    createdAt: createdAt(),
    createdBy: createdBy(),
  },
  (t) => [
    projectFk('deal_scenario_version_scenario_fk', t.projectId, t.scenarioId, (): FkTarget => dealScenario),
    uniqueIndex('deal_scenario_version_uq').on(t.scenarioId, t.versionNo),
  ],
);

export const negotiationIssue = pgTable(
  'negotiation_issue',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    partnerId: uuid('partner_id'),
    agreementId: uuid('agreement_id'),
    code: varchar('code', { length: 32 }).notNull(),
    issue: text('issue').notNull(),
    positions: jsonb('positions').$type<{ party: string; position: string }[]>().notNull().default([]),
    alternatives: text('alternatives'),
    requiredApproval: text('required_approval'),
    /** An issue that needs approval links the governance decision that approves it (REQ-JV-008). */
    requiresApproval: boolean('requires_approval').notNull().default(false),
    decisionId: uuid('decision_id'),
    documentId: uuid('document_id'),
    documentRef: text('document_ref'),
    resolution: text('resolution'),
    status: negotiationIssueStatus('status').notNull().default('open'),
    classification: classification('classification').notNull().default('strictly_confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('negotiation_issue_pid_uq').on(t.projectId, t.id),
    uniqueIndex('negotiation_issue_code_uq').on(t.projectId, t.code),
    projectFk('negotiation_issue_partner_fk', t.projectId, t.partnerId, (): FkTarget => partner),
    projectFk('negotiation_issue_agreement_fk', t.projectId, t.agreementId, (): FkTarget => agreement),
    projectFk('negotiation_issue_decision_fk', t.projectId, t.decisionId, (): FkTarget => decision),
    projectFk('negotiation_issue_document_fk', t.projectId, t.documentId, (): FkTarget => document),
    check('negotiation_issue_approval_link_ck', sql`not ${t.requiresApproval} or ${t.decisionId} is not null`),
  ],
);

export const diligenceRequest = pgTable(
  'diligence_request',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    partnerId: uuid('partner_id'),
    roomId: uuid('room_id'),
    number: integer('number').notNull(),
    /** `partner` = raised by the counterparty in its room (external projection only); `internal` = deal team. */
    origin: varchar('origin', { length: 16 }).notNull().default('internal'),
    question: text('question').notNull(),
    domain: varchar('domain', { length: 32 }).notNull(), // legal | finance | tax | technical | commercial | hr | regulatory | operations | other
    requesterLabel: text('requester_label'),
    assigneeUserId: uuid('assignee_user_id').references(() => appUser.id),
    dueDate: date('due_date', { mode: 'string' }),
    answerDraft: text('answer_draft'),
    draftedBy: uuid('drafted_by'),
    evidenceDocumentIds: jsonb('evidence_document_ids').$type<string[]>().notNull().default([]),
    reviewerUserId: uuid('reviewer_user_id').references(() => appUser.id),
    submittedForReviewBy: uuid('submitted_for_review_by'),
    submittedForReviewAt: ts('submitted_for_review_at'),
    releaseStatus: ddReleaseStatus('release_status').notNull().default('draft'),
    /** The reviewer who approved the release (not the drafter). */
    releaseApprovedBy: uuid('release_approved_by'),
    releaseApprovedAt: ts('release_approved_at'),
    reviewNote: text('review_note'),
    releasedBy: uuid('released_by'),
    releasedAnswer: text('released_answer'), // frozen disclosed version
    releasedVersion: integer('released_version'),
    releasedAt: ts('released_at'),
    classification: classification('classification').notNull().default('strictly_confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('diligence_request_pid_uq').on(t.projectId, t.id),
    uniqueIndex('diligence_request_number_uq').on(t.projectId, t.partnerId, t.number),
    projectFk('diligence_request_partner_fk', t.projectId, t.partnerId, (): FkTarget => partner),
    projectFk('diligence_request_room_fk', t.projectId, t.roomId, (): FkTarget => partnerRoom),
    check('diligence_request_origin_ck', sql`${t.origin} in ('internal', 'partner')`),
  ],
);

/**
 * DD finding (REQ-JV-011). `room_id` is DERIVED from the DD request it was raised from (trigger, cascaded like
 * document_version.room_id — ARCH-22) so a room's findings are visible only to that room's members.
 */
export const diligenceFinding = pgTable(
  'diligence_finding',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    partnerId: uuid('partner_id'),
    roomId: uuid('room_id'),
    diligenceRequestId: uuid('diligence_request_id'),
    code: varchar('code', { length: 32 }).notNull(),
    title: text('title').notNull(),
    description: text('description'),
    materiality: materiality('materiality').notNull(),
    riskId: uuid('risk_id'),
    remediation: text('remediation'),
    remediationOwnerUserId: uuid('remediation_owner_user_id'),
    remediationDueDate: date('remediation_due_date', { mode: 'string' }),
    valuationImplication: text('valuation_implication'),
    documentImplication: text('document_implication'),
    cpImplication: text('cp_implication'),
    conditionId: uuid('condition_id'),
    statusReason: text('status_reason'),
    status: findingStatus('status').notNull().default('open'),
    classification: classification('classification').notNull().default('strictly_confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('diligence_finding_risk_fk', t.projectId, t.riskId, (): FkTarget => risk),
    unique('diligence_finding_pid_uq').on(t.projectId, t.id),
    uniqueIndex('diligence_finding_code_uq').on(t.projectId, t.code),
    projectFk('diligence_finding_partner_fk', t.projectId, t.partnerId, (): FkTarget => partner),
    projectFk('diligence_finding_room_fk', t.projectId, t.roomId, (): FkTarget => partnerRoom),
    projectFk('diligence_finding_request_fk', t.projectId, t.diligenceRequestId, (): FkTarget => diligenceRequest),
    projectFk('diligence_finding_condition_fk', t.projectId, t.conditionId, (): FkTarget => closingCondition),
    check('diligence_finding_material_owner_ck', sql`${t.materiality} not in ('high', 'critical') or ${t.remediationOwnerUserId} is not null`),
  ],
);

/**
 * A signing or closing event (REQ-LCY-009): separate records, checklists, statuses and confirmations. A transaction can
 * have several closings; each closing depends on its signing and has its own CP set and checklist.
 */
export const closing = pgTable(
  'closing',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    partnerId: uuid('partner_id'),
    kind: closingKind('kind').notNull(),
    code: varchar('code', { length: 32 }),
    sequence: integer('sequence').notNull().default(1),
    name: text('name').notNull(),
    description: text('description'),
    /** For a closing: the signing it follows (a closing can never be the signing). */
    signingId: uuid('signing_id'),
    targetDate: date('target_date', { mode: 'string' }),
    status: closingStatus('status').notNull().default('planned'),
    /** Pending authorized confirmation (approval request by a person other than the confirmer). */
    confirmationRequestId: uuid('confirmation_request_id'),
    executedDocumentId: uuid('executed_document_id'),
    confirmedBy: uuid('confirmed_by'),
    confirmedAt: ts('confirmed_at'),
    confirmationAuthority: text('confirmation_authority'),
    confirmationDecisionId: uuid('confirmation_decision_id'),
    readinessSnapshot: jsonb('readiness_snapshot').$type<Record<string, unknown>>(),
    statusReason: text('status_reason'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('closing_decision_fk', t.projectId, t.confirmationDecisionId, (): FkTarget => decision),
    unique('closing_pid_uq').on(t.projectId, t.id),
    uniqueIndex('closing_seq_uq').on(t.projectId, t.kind, t.sequence),
    uniqueIndex('closing_code_uq').on(t.projectId, t.code),
    projectFk('closing_partner_fk', t.projectId, t.partnerId, (): FkTarget => partner),
    projectFk('closing_signing_fk', t.projectId, t.signingId, { projectId: t.projectId, id: t.id }),
    projectFk('closing_confirmation_request_fk', t.projectId, t.confirmationRequestId, (): FkTarget => approvalRequest),
    projectFk('closing_executed_document_fk', t.projectId, t.executedDocumentId, (): FkTarget => document),
    check('closing_signing_kind_ck', sql`(${t.kind} = 'signing' and ${t.signingId} is null) or ${t.kind} = 'closing'`),
  ],
);

/** Condition precedent / subsequent. */
export const closingCondition = pgTable(
  'closing_condition',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    closingId: uuid('closing_id'),
    kind: conditionKind('kind').notNull().default('condition_precedent'),
    reference: varchar('reference', { length: 32 }).notNull(),
    title: text('title').notNull(),
    description: text('description'),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    parties: text('parties'),
    blocking: boolean('blocking').notNull().default(true),
    /** Specialist determination (default: NOT waivable). */
    waivable: boolean('waivable').notNull().default(false),
    waiverAuthorityRole: roleKey('waiver_authority_role'),
    waiverAuthorityNote: text('waiver_authority_note'),
    waivabilityBasis: text('waivability_basis'),
    waivabilityDeterminedBy: uuid('waivability_determined_by'),
    waivabilityDeterminedAt: ts('waivability_determined_at'),
    validTo: date('valid_to', { mode: 'string' }),
    longStopDate: date('long_stop_date', { mode: 'string' }),
    status: conditionStatus('status').notNull().default('open'),
    evidenceSubmittedBy: uuid('evidence_submitted_by'),
    evidenceSubmittedAt: ts('evidence_submitted_at'),
    verifiedBy: uuid('verified_by'),
    verifiedAt: ts('verified_at'),
    statusNote: text('status_note'),
    waiverId: uuid('waiver_id'),
    gateKey: varchar('gate_key', { length: 16 }),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('closing_condition_waiver_fk', t.projectId, t.waiverId, (): FkTarget => waiver),
    unique('closing_condition_pid_uq').on(t.projectId, t.id),
    uniqueIndex('closing_condition_ref_uq').on(t.projectId, t.reference),
    projectFk('closing_condition_closing_fk', t.projectId, t.closingId, (): FkTarget => closing),
  ],
);

/**
 * Signing / closing checklist item and closing deliverable (REQ-JV-012/014). Belongs to EXACTLY ONE event (a signing or
 * a closing): `closing_id` is required and immutable (trigger). Acceptance requires the executed document version.
 */
export const closingDeliverable = pgTable(
  'closing_deliverable',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    closingId: uuid('closing_id').notNull(),
    code: varchar('code', { length: 32 }),
    title: text('title').notNull(),
    responsibleParty: text('responsible_party'),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    dueDate: date('due_date', { mode: 'string' }),
    decisionId: uuid('decision_id'),
    status: closingDeliverableStatus('status').notNull().default('pending'),
    documentId: uuid('document_id'),
    executedVersionId: uuid('executed_version_id'),
    deliveredBy: uuid('delivered_by'),
    deliveredAt: ts('delivered_at'),
    verifiedBy: uuid('verified_by'),
    verifiedAt: ts('verified_at'),
    statusNote: text('status_note'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('closing_deliverable_doc_fk', t.projectId, t.documentId, (): FkTarget => document),
    projectFk('closing_deliverable_version_fk', t.projectId, t.executedVersionId, (): FkTarget => documentVersion),
    projectFk('closing_deliverable_decision_fk', t.projectId, t.decisionId, (): FkTarget => decision),
    unique('closing_deliverable_pid_uq').on(t.projectId, t.id),
    uniqueIndex('closing_deliverable_code_uq').on(t.projectId, t.code),
    projectFk('closing_deliverable_closing_fk', t.projectId, t.closingId, (): FkTarget => closing),
  ],
);

/** Funds-flow tracking only — the platform never executes, initiates or instructs payments (REQ-JV-015). */
export const fundsFlowItem = pgTable(
  'funds_flow_item',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    closingId: uuid('closing_id').notNull(),
    code: varchar('code', { length: 32 }),
    description: text('description').notNull(),
    payer: text('payer').notNull(),
    payee: text('payee').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }),
    currency: varchar('currency', { length: 3 }),
    unitScale: integer('unit_scale'),
    valueDate: date('value_date', { mode: 'string' }),
    status: fundsFlowStatus('status').notNull().default('planned'),
    confirmedBy: uuid('confirmed_by'),
    confirmedAt: ts('confirmed_at'),
    settlementReference: text('settlement_reference'),
    settlementReportedBy: uuid('settlement_reported_by'),
    settlementReportedAt: ts('settlement_reported_at'),
    statusNote: text('status_note'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('funds_flow_item_pid_uq').on(t.projectId, t.id),
    uniqueIndex('funds_flow_item_code_uq').on(t.projectId, t.code),
    projectFk('funds_flow_closing_fk', t.projectId, t.closingId, (): FkTarget => closing),
    check('funds_flow_scale_ck', sql`${t.unitScale} is null or ${t.unitScale} in (1, 1000, 1000000)`),
    check('funds_flow_money_ck', sql`(${t.amount} is null) = (${t.currency} is null) and (${t.amount} is null) = (${t.unitScale} is null)`),
  ],
);

export const postCloseObligation = pgTable(
  'post_close_obligation',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    kind: postCloseKind('kind').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    responsibleParty: text('responsible_party'),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    dueDate: date('due_date', { mode: 'string' }),
    status: postCloseStatus('status').notNull().default('open'),
    evidenceNote: text('evidence_note'),
    completionReportedBy: uuid('completion_reported_by'),
    completionReportedAt: ts('completion_reported_at'),
    verifiedBy: uuid('verified_by'),
    verifiedAt: ts('verified_at'),
    overdueSince: date('overdue_since', { mode: 'string' }),
    escalationId: uuid('escalation_id'),
    statusNote: text('status_note'),
    closingId: uuid('closing_id'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('post_close_obligation_pid_uq').on(t.projectId, t.id),
    uniqueIndex('post_close_obligation_code_uq').on(t.projectId, t.code),
    projectFk('post_close_obligation_closing_fk', t.projectId, t.closingId, (): FkTarget => closing),
    projectFk('post_close_obligation_escalation_fk', t.projectId, t.escalationId, (): FkTarget => escalation),
  ],
);

/**
 * Program closure (REQ-JV-019): separate from transaction closing; requires gate G7 (Stabilization & Handover) to have
 * passed and an authorized confirmation by a person other than the requester. One row per project.
 */
export const programClosure = pgTable(
  'program_closure',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    status: varchar('status', { length: 16 }).notNull().default('requested'),
    handoverNote: text('handover_note').notNull(),
    g7AssessmentId: uuid('g7_assessment_id'),
    approvalRequestId: uuid('approval_request_id'),
    requestedBy: uuid('requested_by').notNull(),
    requestedAt: createdAt(),
    confirmedBy: uuid('confirmed_by'),
    confirmedAt: ts('confirmed_at'),
    statusNote: text('status_note'),
    isDemo: isDemo(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    uniqueIndex('program_closure_project_uq').on(t.projectId),
    projectFk('program_closure_g7_fk', t.projectId, t.g7AssessmentId, (): FkTarget => gateAssessment),
    projectFk('program_closure_request_fk', t.projectId, t.approvalRequestId, (): FkTarget => approvalRequest),
    check('program_closure_status_ck', sql`${t.status} in ('requested', 'confirmed', 'rejected')`),
  ],
);
