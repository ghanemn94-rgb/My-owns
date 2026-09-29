import { pgTable, uuid, text, integer, jsonb, varchar, date, boolean, index, unique, uniqueIndex } from 'drizzle-orm/pg-core';
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
  moneyCols,
  classification,
  committeeKind,
  committeeStatus,
  committeeMemberRole,
  authorityMatrixStatus,
  meetingStatus,
  agendaItemKind,
  agendaScreeningStatus,
  attendanceStatus,
  decisionStatus,
  decisionAuthorityOutcome,
  voteChoice,
  actionItemStatus,
  escalationStatus,
  approvalRequestStatus,
} from './_common';
import { project, program } from './portfolio';
import { appUser } from './identity';
import { issue } from './planning';
import { reportSnapshot } from './reporting';
import { document } from './documents';

/** Program committee (distinct from NewCo board / JV board via `kind`). Anchored to a project for isolation. */
export const committee = pgTable(
  'committee',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    programId: uuid('program_id').references(() => program.id),
    kind: committeeKind('kind').notNull(),
    name: text('name').notNull(),
    status: committeeStatus('status').notNull().default('draft'),
    charter: jsonb('charter')
      .$type<{
        purpose?: string;
        scope?: string;
        delegatedAuthority?: string;
        exclusions?: string;
        reservedMatters?: string;
        cadence?: string;
        cadenceIsProposal?: boolean;
        classification?: string;
        minutesRetention?: string;
        escalation?: string;
        conflictsOfInterest?: string;
        circulation?: string;
      }>()
      .notNull()
      .default({}),
    charterDocumentId: uuid('charter_document_id'),
    /** Current (working) charter version; every charter change is snapshotted in record_version (committee_charter). */
    charterVersionNo: integer('charter_version_no').notNull().default(1),
    /** Charter version that was approved (null = never approved; < charterVersionNo = amendment pending approval). */
    charterApprovedVersionNo: integer('charter_approved_version_no'),
    charterApprovedBy: uuid('charter_approved_by'),
    charterApprovedAt: ts('charter_approved_at'),
    classification: classification('classification').notNull().default('confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('committee_charter_doc_fk', t.projectId, t.charterDocumentId, (): FkTarget => document),unique('committee_pid_uq').on(t.projectId, t.id)],
);

export const committeeMembership = pgTable(
  'committee_membership',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    committeeId: uuid('committee_id').notNull(),
    userId: uuid('user_id').references(() => appUser.id), // null = role to be confirmed
    roleLabel: text('role_label').notNull(), // e.g. "Chair — Role to be confirmed", "Finance"
    memberRole: committeeMemberRole('member_role').notNull(),
    voting: boolean('voting').notNull().default(false),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    delegateOfMembershipId: uuid('delegate_of_membership_id'),
    createdAt: createdAt(),
    createdBy: createdBy(),
    version: versionCol(),
  },
  (t) => [
    projectFk('committee_membership_delegate_fk', t.projectId, t.delegateOfMembershipId, { projectId: t.projectId, id: t.id }),
    unique('committee_membership_pid_uq').on(t.projectId, t.id),
    projectFk('committee_membership_committee_fk', t.projectId, t.committeeId, (): FkTarget => committee),
    index('committee_membership_committee_idx').on(t.committeeId),
  ],
);

/** Delegation / authority matrix version. Production authority stays inactive until an approved matrix exists. */
export const authorityMatrixVersion = pgTable(
  'authority_matrix_version',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    committeeId: uuid('committee_id').notNull(),
    versionNo: integer('version_no').notNull(),
    status: authorityMatrixStatus('status').notNull().default('draft'),
    isDemoPolicy: boolean('is_demo_policy').notNull().default(false),
    policy: jsonb('policy').$type<Record<string, unknown>>().notNull(),
    policyHash: text('policy_hash').notNull(),
    /** Delegation validity window (P0 review D-12). */
    effectiveFrom: date('effective_from', { mode: 'string' }),
    effectiveTo: date('effective_to', { mode: 'string' }),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    approvalReference: text('approval_reference'),
    createdAt: createdAt(),
    createdBy: createdBy(),
  },
  (t) => [
    unique('authority_matrix_pid_uq').on(t.projectId, t.id),
    projectFk('authority_matrix_committee_fk', t.projectId, t.committeeId, (): FkTarget => committee),
    uniqueIndex('authority_matrix_version_uq').on(t.committeeId, t.versionNo),
  ],
);

export const meeting = pgTable(
  'meeting',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    committeeId: uuid('committee_id').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    scheduledAt: ts('scheduled_at').notNull(),
    location: text('location'),
    status: meetingStatus('status').notNull().default('planned'),
    isCirculation: boolean('is_circulation').notNull().default(false),
    /** Resolution by circulation: response deadline (business date, project timezone). */
    responseDeadline: date('response_deadline', { mode: 'string' }),
    quorumSnapshot: jsonb('quorum_snapshot').$type<Record<string, unknown>>(),
    packSnapshotId: uuid('pack_snapshot_id'),
    minutesText: text('minutes_text'),
    /** Drafter of the current minutes version (separation of duties for minutes approval). */
    minutesDraftedBy: uuid('minutes_drafted_by'),
    minutesApprovedBy: uuid('minutes_approved_by'),
    minutesApprovedAt: ts('minutes_approved_at'),
    authorityMatrixVersionId: uuid('authority_matrix_version_id'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('meeting_matrix_fk', t.projectId, t.authorityMatrixVersionId, (): FkTarget => authorityMatrixVersion),
    projectFk('meeting_pack_fk', t.projectId, t.packSnapshotId, (): FkTarget => reportSnapshot),
    unique('meeting_pid_uq').on(t.projectId, t.id),
    projectFk('meeting_committee_fk', t.projectId, t.committeeId, (): FkTarget => committee),
    uniqueIndex('meeting_number_uq').on(t.committeeId, t.number),
  ],
);

export const decision = pgTable(
  'decision',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    committeeId: uuid('committee_id').notNull(),
    code: varchar('code', { length: 32 }).notNull(),
    title: text('title').notNull(),
    decisionTypeKey: varchar('decision_type_key', { length: 64 }),
    issue: text('issue'),
    whyNow: text('why_now'),
    alternatives: jsonb('alternatives').$type<{ title: string; summary?: string }[]>().notNull().default([]),
    recommendation: text('recommendation'),
    impacts: jsonb('impacts').$type<{ financial?: string; operational?: string; schedule?: string }>().notNull().default({}),
    ...moneyCols('amount'),
    risks: text('risks'),
    dependencies: text('dependencies'),
    latestSafeDate: date('latest_safe_date', { mode: 'string' }),
    requiredAuthority: text('required_authority'),
    requesterUserId: uuid('requester_user_id').references(() => appUser.id),
    status: decisionStatus('status').notNull().default('draft'),
    /** Voting round; incremented when a deferred decision is resumed (P0 review D-11). */
    voteRound: integer('vote_round').notNull().default(1),
    recommendationRecordedBy: uuid('recommendation_recorded_by'),
    authorityOutcome: decisionAuthorityOutcome('authority_outcome').notNull().default('not_assessed'),
    authorityReason: text('authority_reason'),
    escalatedTo: text('escalated_to'),
    externalAuthorityReference: text('external_authority_reference'),
    meetingId: uuid('meeting_id'),
    decidedViaCirculation: boolean('decided_via_circulation').notNull().default(false),
    outcomeRecordedAt: ts('outcome_recorded_at'),
    outcomeRecordedBy: uuid('outcome_recorded_by'),
    tallySnapshot: jsonb('tally_snapshot').$type<Record<string, unknown>>(),
    supersededByDecisionId: uuid('superseded_by_decision_id'),
    /** Who started implementation tracking (the verifier of the implementation must be a different person). */
    implementationStartedBy: uuid('implementation_started_by'),
    implementationStartedAt: ts('implementation_started_at'),
    implementationEvidenceNote: text('implementation_evidence_note'),
    implementationVerifiedBy: uuid('implementation_verified_by'),
    implementationVerifiedAt: ts('implementation_verified_at'),
    classification: classification('classification').notNull().default('confidential'),
    gateKey: varchar('gate_key', { length: 16 }),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('decision_pid_uq').on(t.projectId, t.id),
    uniqueIndex('decision_code_uq').on(t.projectId, t.code),
    projectFk('decision_committee_fk', t.projectId, t.committeeId, (): FkTarget => committee),
    projectFk('decision_meeting_fk', t.projectId, t.meetingId, (): FkTarget => meeting),
    projectFk('decision_superseded_fk', t.projectId, t.supersededByDecisionId, { projectId: t.projectId, id: t.id }),
    index('decision_status_idx').on(t.projectId, t.status),
  ],
);

export const agendaItem = pgTable(
  'agenda_item',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    committeeId: uuid('committee_id').notNull(),
    meetingId: uuid('meeting_id'),
    number: integer('number'),
    title: text('title').notNull(),
    kind: agendaItemKind('kind').notNull(),
    decisionId: uuid('decision_id'),
    requestedBy: uuid('requested_by'),
    screeningStatus: agendaScreeningStatus('screening_status').notNull().default('requested'),
    screeningNote: text('screening_note'),
    screenedBy: uuid('screened_by'),
    presenterUserId: uuid('presenter_user_id'),
    minutesNote: text('minutes_note'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('agenda_item_pid_uq').on(t.projectId, t.id),
    projectFk('agenda_item_committee_fk', t.projectId, t.committeeId, (): FkTarget => committee),
    projectFk('agenda_item_meeting_fk', t.projectId, t.meetingId, (): FkTarget => meeting),
    projectFk('agenda_item_decision_fk', t.projectId, t.decisionId, (): FkTarget => decision),
  ],
);

export const attendance = pgTable(
  'attendance',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    meetingId: uuid('meeting_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    userId: uuid('user_id'),
    status: attendanceStatus('status').notNull(),
    recordedBy: uuid('recorded_by'),
    recordedAt: createdAt(),
  },
  (t) => [
    projectFk('attendance_meeting_fk', t.projectId, t.meetingId, (): FkTarget => meeting),
    projectFk('attendance_membership_fk', t.projectId, t.membershipId, (): FkTarget => committeeMembership),
    uniqueIndex('attendance_uq').on(t.meetingId, t.membershipId),
  ],
);

export const recusal = pgTable(
  'recusal',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    decisionId: uuid('decision_id').notNull(),
    userId: uuid('user_id').notNull(),
    reason: text('reason').notNull(),
    declaredAt: createdAt(),
    recordedBy: uuid('recorded_by'),
  },
  (t) => [projectFk('recusal_decision_fk', t.projectId, t.decisionId, (): FkTarget => decision), uniqueIndex('recusal_uq').on(t.decisionId, t.userId)],
);

/** Votes are immutable (UPDATE/DELETE blocked by trigger) and keep the authority matrix version in force. */
export const vote = pgTable(
  'vote',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    decisionId: uuid('decision_id').notNull(),
    meetingId: uuid('meeting_id'),
    userId: uuid('user_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    round: integer('round').notNull().default(1),
    memberRoleAtVote: committeeMemberRole('member_role_at_vote').notNull(),
    choice: voteChoice('choice').notNull(),
    comment: text('comment'),
    viaCirculation: boolean('via_circulation').notNull().default(false),
    authorityMatrixVersionId: uuid('authority_matrix_version_id'),
    castAt: createdAt(),
  },
  (t) => [
    projectFk('vote_meeting_fk', t.projectId, t.meetingId, (): FkTarget => meeting),
    projectFk('vote_matrix_fk', t.projectId, t.authorityMatrixVersionId, (): FkTarget => authorityMatrixVersion),
    projectFk('vote_decision_fk', t.projectId, t.decisionId, (): FkTarget => decision),
    projectFk('vote_membership_fk', t.projectId, t.membershipId, (): FkTarget => committeeMembership),
    uniqueIndex('vote_uq').on(t.decisionId, t.userId, t.round),
  ],
);

export const actionItem = pgTable(
  'action_item',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    title: text('title').notNull(),
    decisionId: uuid('decision_id'),
    meetingId: uuid('meeting_id'),
    issueId: uuid('issue_id'),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    dueDate: date('due_date', { mode: 'string' }),
    status: actionItemStatus('status').notNull().default('open'),
    closureEvidenceNote: text('closure_evidence_note'),
    reportedDoneBy: uuid('reported_done_by'),
    reportedDoneAt: ts('reported_done_at'),
    verifiedBy: uuid('verified_by'),
    verifiedAt: ts('verified_at'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('action_item_issue_fk', t.projectId, t.issueId, (): FkTarget => issue),
    unique('action_item_pid_uq').on(t.projectId, t.id),
    uniqueIndex('action_item_code_uq').on(t.projectId, t.code),
    projectFk('action_item_decision_fk', t.projectId, t.decisionId, (): FkTarget => decision),
    projectFk('action_item_meeting_fk', t.projectId, t.meetingId, (): FkTarget => meeting),
  ],
);

export const escalation = pgTable(
  'escalation',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    title: text('title').notNull(),
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    sourceId: uuid('source_id'),
    requestedAction: text('requested_action').notNull(),
    decisionDeadline: date('decision_deadline', { mode: 'string' }),
    options: jsonb('options').$type<{ title: string; impact?: string }[]>().notNull().default([]),
    raisedToCommitteeId: uuid('raised_to_committee_id'),
    /** Escalation target body (e.g. the authority matrix `escalateTo`), free text until bodies are modelled. */
    target: text('target'),
    status: escalationStatus('status').notNull().default('open'),
    resolutionDecisionId: uuid('resolution_decision_id'),
    resolutionNote: text('resolution_note'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: ts('resolved_at'),
    raisedBy: uuid('raised_by'),
    isSystemGenerated: boolean('is_system_generated').notNull().default(false),
    isDemo: isDemo(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('escalation_committee_fk', t.projectId, t.raisedToCommitteeId, (): FkTarget => committee),
    projectFk('escalation_resolution_fk', t.projectId, t.resolutionDecisionId, (): FkTarget => decision),unique('escalation_pid_uq').on(t.projectId, t.id), uniqueIndex('escalation_code_uq').on(t.projectId, t.code)],
);

/**
 * Generic approval request (gate decisions, waivers, baselines, TSA exits, CP verification, closing confirmation,
 * RAG overrides…). Bound to subject version + payload hash so later edits invalidate it.
 */
export const approvalRequest = pgTable(
  'approval_request',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    subjectType: varchar('subject_type', { length: 32 }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    subjectVersion: integer('subject_version'),
    action: varchar('action', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    payloadHash: text('payload_hash').notNull(),
    requiredPermission: varchar('required_permission', { length: 96 }).notNull(),
    requestedBy: uuid('requested_by').notNull(),
    status: approvalRequestStatus('status').notNull().default('pending'),
    expiresAt: ts('expires_at'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [unique('approval_request_pid_uq').on(t.projectId, t.id), index('approval_request_subject_idx').on(t.projectId, t.subjectType, t.subjectId)],
);

export const approvalRecord = pgTable(
  'approval_record',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    approvalRequestId: uuid('approval_request_id').notNull(),
    approverUserId: uuid('approver_user_id').notNull(),
    decision: varchar('decision', { length: 16 }).notNull(), // approve | reject
    comment: text('comment'),
    authorityBasis: text('authority_basis'),
    payloadHash: text('payload_hash').notNull(),
    recordedAt: createdAt(),
  },
  (t) => [projectFk('approval_record_request_fk', t.projectId, t.approvalRequestId, (): FkTarget => approvalRequest)],
);

/**
 * Conflict-of-interest declaration per member and meeting/decision ("no conflict", "interest declared", "recused"),
 * evidencing the conflict check step of the workflow (P0 review D-13).
 */
export const conflictDeclaration = pgTable(
  'conflict_declaration',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    committeeId: uuid('committee_id').notNull(),
    meetingId: uuid('meeting_id'),
    decisionId: uuid('decision_id'),
    userId: uuid('user_id').notNull(),
    declaration: varchar('declaration', { length: 24 }).notNull(), // no_conflict | interest_declared | recused
    description: text('description'),
    declaredAt: createdAt(),
    recordedBy: uuid('recorded_by'),
  },
  (t) => [
    projectFk('conflict_declaration_committee_fk', t.projectId, t.committeeId, (): FkTarget => committee),
    projectFk('conflict_declaration_meeting_fk', t.projectId, t.meetingId, (): FkTarget => meeting),
    projectFk('conflict_declaration_decision_fk', t.projectId, t.decisionId, (): FkTarget => decision),
  ],
);
