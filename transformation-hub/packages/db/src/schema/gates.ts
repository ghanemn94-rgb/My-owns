import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, varchar, boolean, date, unique, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import {
  pk,
  orgIdCol,
  projectIdCol,
  createdAt,
  updatedAt,
  createdBy,
  versionCol,
  ts,
  projectFk,
  type FkTarget,
  roleKey,
  gateAssessmentStatus,
  criterionStatus,
  gateReviewOutcome,
  waiverStatus,
  statusDimensionKey,
  isDemo,
} from './_common';
import { project } from './portfolio';
import { decision, approvalRequest } from './governance';

/** Business gate (G0–G7 for the DC template) instantiated per project from its template version. */
export const gateDefinition = pgTable(
  'gate_definition',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    key: varchar('key', { length: 16 }).notNull(),
    sortOrder: integer('sort_order').notNull(),
    name: text('name').notNull(),
    nameAr: text('name_ar'),
    purpose: text('purpose'),
    prerequisiteGateKeys: jsonb('prerequisite_gate_keys').$type<string[]>().notNull().default([]),
    ownerRole: roleKey('owner_role').notNull(),
    reviewerRole: roleKey('reviewer_role').notNull(),
    approverRole: roleKey('approver_role').notNull(),
    createdAt: createdAt(),
    version: versionCol(),
  },
  (t) => [unique('gate_definition_pid_uq').on(t.projectId, t.id), uniqueIndex('gate_definition_key_uq').on(t.projectId, t.key)],
);

export const gateCriterion = pgTable(
  'gate_criterion',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    gateId: uuid('gate_id').notNull(),
    key: varchar('key', { length: 32 }).notNull(),
    description: text('description').notNull(),
    descriptionAr: text('description_ar'),
    mandatory: boolean('mandatory').notNull(),
    blocking: boolean('blocking').notNull(),
    /** Waivability is set by authorized specialists; defaults to false. */
    waivable: boolean('waivable').notNull().default(false),
    waiverAuthorityRole: roleKey('waiver_authority_role'),
    waivabilityBasis: text('waivability_basis'),
    evidenceRequired: boolean('evidence_required').notNull().default(true),
    evidenceType: varchar('evidence_type', { length: 32 }),
    ownerRole: roleKey('owner_role').notNull(),
    reviewerRole: roleKey('reviewer_role').notNull(),
    applicability: varchar('applicability', { length: 24 }).notNull().default('proposed'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('gate_criterion_pid_uq').on(t.projectId, t.id),
    projectFk('gate_criterion_gate_fk', t.projectId, t.gateId, (): FkTarget => gateDefinition),
    uniqueIndex('gate_criterion_key_uq').on(t.projectId, t.key),
  ],
);

/**
 * One assessment cycle for a gate. Reopening creates a NEW assessment linked via `supersedesAssessmentId`;
 * the prior assessment and its decision are preserved (spec §3).
 */
export const gateAssessment = pgTable(
  'gate_assessment',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    gateId: uuid('gate_id').notNull(),
    cycle: integer('cycle').notNull().default(1),
    status: gateAssessmentStatus('status').notNull().default('not_started'),
    evaluation: jsonb('evaluation').$type<Record<string, unknown>>(),
    decisionNote: text('decision_note'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionId: uuid('decision_id'), // committee decision backing the gate approval
    /** Who submitted the cycle for decision (mark_ready) — the decider must be someone else (not_self). */
    submittedBy: uuid('submitted_by'),
    submittedAt: ts('submitted_at'),
    /** Who started the cycle (gate owner role or project manager) — the gate reviewer must be someone else (DOM-P2-16). */
    startedBy: uuid('started_by'),
    startedAt: ts('started_at'),
    /**
     * Gate-level review of the cycle by the gate's reviewer role (DOM-P2-16, REQ-LCY-010): endorse or return, with a note.
     * `review_basis` = SHA-256 of the criterion state reviewed (domain gateReviewBasis); mark-ready needs an endorsement
     * whose basis equals the current one (no criterion change since). Earlier reviews of the cycle are in the audit trail.
     */
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    reviewOutcome: gateReviewOutcome('review_outcome'),
    reviewNote: text('review_note'),
    reviewBasis: varchar('review_basis', { length: 64 }),
    reopenedReason: text('reopened_reason'),
    supersedesAssessmentId: uuid('supersedes_assessment_id'),
    isCurrent: boolean('is_current').notNull().default(true),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    check(
      'gate_assessment_review_ck',
      sql`(${t.reviewOutcome} is null and ${t.reviewedBy} is null and ${t.reviewedAt} is null and ${t.reviewBasis} is null and ${t.reviewNote} is null)
       or (${t.reviewOutcome} is not null and ${t.reviewedBy} is not null and ${t.reviewedAt} is not null and ${t.reviewBasis} is not null and length(trim(${t.reviewNote})) > 0)`,
    ),
    check('gate_assessment_started_ck', sql`(${t.startedBy} is null) = (${t.startedAt} is null)`),
    projectFk('gate_assessment_decision_fk', t.projectId, t.decisionId, (): FkTarget => decision),
    projectFk('gate_assessment_supersedes_fk', t.projectId, t.supersedesAssessmentId, { projectId: t.projectId, id: t.id }),
    unique('gate_assessment_pid_uq').on(t.projectId, t.id),
    projectFk('gate_assessment_gate_fk', t.projectId, t.gateId, (): FkTarget => gateDefinition),
    index('gate_assessment_gate_idx').on(t.gateId),
  ],
);

export const criterionAssessment = pgTable(
  'criterion_assessment',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    assessmentId: uuid('assessment_id').notNull(),
    criterionId: uuid('criterion_id').notNull(),
    status: criterionStatus('status').notNull().default('unmet'),
    note: text('note'),
    assessedBy: uuid('assessed_by'),
    assessedAt: ts('assessed_at'),
    waiverId: uuid('waiver_id'),
    /** "Not applicable" determination by the specialist reviewer role (P0 review D-01). */
    naBasis: text('na_basis'),
    naProposedBy: uuid('na_proposed_by'),
    naDeterminedBy: uuid('na_determined_by'),
    naApproved: boolean('na_approved').notNull().default(false),
    naProposedAt: ts('na_proposed_at'),
    /** Role under which the determination was made (the criterion reviewer role) and when (P0 review D-01). */
    naDeterminedRole: roleKey('na_determined_role'),
    naDeterminedAt: ts('na_determined_at'),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('criterion_assessment_waiver_fk', t.projectId, t.waiverId, (): FkTarget => waiver),
    unique('criterion_assessment_pid_uq').on(t.projectId, t.id),
    projectFk('criterion_assessment_assessment_fk', t.projectId, t.assessmentId, (): FkTarget => gateAssessment),
    projectFk('criterion_assessment_criterion_fk', t.projectId, t.criterionId, (): FkTarget => gateCriterion),
    uniqueIndex('criterion_assessment_uq').on(t.assessmentId, t.criterionId),
  ],
);

/**
 * Waiver for a gate criterion or closing condition. Non-waivable targets are rejected server-side (AT-13).
 */
export const waiver = pgTable(
  'waiver',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    targetType: varchar('target_type', { length: 32 }).notNull(), // gate_criterion | closing_condition | readiness_check
    targetId: uuid('target_id').notNull(),
    basis: text('basis').notNull(),
    impact: text('impact').notNull(),
    status: waiverStatus('status').notNull().default('requested'),
    requestedBy: uuid('requested_by').notNull(),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    authorityRole: roleKey('authority_role'),
    /** Conditions attached to the waiver and its expiry (business date); an expired waiver no longer counts. */
    conditions: text('conditions'),
    expiresOn: date('expires_on', { mode: 'string' }),
    /** Generic approval request binding the waiver payload + target version (module guide: approvals). */
    approvalRequestId: uuid('approval_request_id'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('waiver_approval_request_fk', t.projectId, t.approvalRequestId, (): FkTarget => approvalRequest),
    unique('waiver_pid_uq').on(t.projectId, t.id), index('waiver_target_idx').on(t.projectId, t.targetType, t.targetId)],
);

/** Latest computed state of each independent status dimension, with history via record_version. */
export const statusDimension = pgTable(
  'status_dimension',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    key: statusDimensionKey('key').notNull(),
    state: varchar('state', { length: 48 }).notNull(),
    /** English explanation (audit, record history, AI context). */
    explanation: text('explanation'),
    /** The same explanation as translatable codes + parameters (QA-P1-14); null for rows computed before it. */
    explanationI18n: jsonb('explanation_i18n').$type<{ code: string; params: Record<string, string | number> }[]>(),
    counts: jsonb('counts').$type<Record<string, number>>(),
    computedAt: ts('computed_at').notNull().defaultNow(),
    version: versionCol(),
  },
  (t) => [uniqueIndex('status_dimension_uq').on(t.projectId, t.key)],
);
