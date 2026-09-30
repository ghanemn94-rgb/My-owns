import { pgTable, uuid, text, integer, jsonb, varchar, date, boolean, unique, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
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
  moneyCols,
  classification,
  perimeterItemType,
  perimeterDisposition,
  transferStatus,
  agreementStage,
  contractTransferClass,
  consentStatus,
  approvalRegisterCategory,
  applicabilityStatus,
  requirementStatus,
  tsaStatus,
  readinessArea,
  readinessStatus,
  goNoGo,
  cutoverStatus,
  verificationStatus,
  roleKey,
} from './_common';
import { project, site, workstream, legalEntity } from './portfolio';
import { appUser } from './identity';
import { document, documentVersion } from './documents';
import { decision, escalation, approvalRequest } from './governance';
import { waiver } from './gates';
import { changeRequest } from './planning';

/**
 * Agreement register (spec §7.2, REQ-AGR-001/002/003). The type label is stored exactly as it appears in the source
 * ("ATA", "TSA", "MSA"…); an expansion is only a proposal until an authorized owner confirms it (REQ-AGR-002).
 * Stage changes are explicit commands (carveout agreements service); PATCH never touches `stage`.
 */
export const agreement = pgTable(
  'agreement',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    /** Agreement type label as it appears in the source (e.g. "ATA", "TSA", "MSA"); never auto-expanded. */
    kindLabel: varchar('kind_label', { length: 64 }).notNull(),
    kindExpansion: text('kind_expansion'), // proposed expansion, labelled as such until confirmed
    kindExpansionConfirmed: boolean('kind_expansion_confirmed').notNull().default(false),
    kindExpansionConfirmedBy: uuid('kind_expansion_confirmed_by'),
    kindExpansionConfirmedAt: ts('kind_expansion_confirmed_at'),
    kindExpansionBasis: text('kind_expansion_basis'),
    title: text('title').notNull(),
    /** Parties by name/role; a `legalEntityId` must be an entity linked to this project (checked by the service). */
    parties: jsonb('parties').$type<{ legalEntityId?: string; name: string; role?: string }[]>().notNull().default([]),
    scope: text('scope'),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    legalReviewerUserId: uuid('legal_reviewer_user_id').references(() => appUser.id),
    currentDraftVersion: varchar('current_draft_version', { length: 32 }),
    stage: agreementStage('stage').notNull().default('identified'),
    outstandingIssues: text('outstanding_issues'),
    signingDate: date('signing_date', { mode: 'string' }),
    effectiveDate: date('effective_date', { mode: 'string' }),
    renewalDate: date('renewal_date', { mode: 'string' }),
    expiryDate: date('expiry_date', { mode: 'string' }),
    obligations: text('obligations'),
    executedDocumentId: uuid('executed_document_id'),
    classification: classification('classification').notNull().default('confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('agreement_executed_doc_fk', t.projectId, t.executedDocumentId, (): FkTarget => document),
    unique('agreement_pid_uq').on(t.projectId, t.id),
    uniqueIndex('agreement_code_uq').on(t.projectId, t.code),
  ],
);

/** Negotiated draft versions of an agreement (REQ-AGR-003). Append-only history; the agreement keeps the label of the latest. */
export const agreementVersion = pgTable(
  'agreement_version',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    agreementId: uuid('agreement_id').notNull(),
    versionLabel: varchar('version_label', { length: 32 }).notNull(),
    documentId: uuid('document_id'),
    documentVersionId: uuid('document_version_id'),
    note: text('note'),
    recordedBy: uuid('recorded_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    projectFk('agreement_version_agreement_fk', t.projectId, t.agreementId, (): FkTarget => agreement),
    projectFk('agreement_version_document_fk', t.projectId, t.documentId, (): FkTarget => document),
    projectFk('agreement_version_docver_fk', t.projectId, t.documentVersionId, (): FkTarget => documentVersion),
    uniqueIndex('agreement_version_uq').on(t.agreementId, t.versionLabel),
  ],
);

/**
 * Transaction perimeter register (spec §7.1). Legal and economic transfer are tracked SEPARATELY, each with its own
 * planned/actual effective dates (P0 review D-05); `plannedEffectiveDate`/`actualEffectiveDate` are the LEGAL dates.
 * Scope attributes (disposition, site, current/target entity) change only through the classify command; after baseline
 * approval that command raises a change request instead (AT-07). Contract-like items carry their specialist
 * transferability class and Day-1 position (AT-08).
 */
export const perimeterItem = pgTable(
  'perimeter_item',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    type: perimeterItemType('type').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    siteId: uuid('site_id'),
    workstreamId: uuid('workstream_id'),
    /** Accountable person for the item (access-matrix `own_workstream` owner). */
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    currentEntityId: uuid('current_entity_id').references(() => legalEntity.id),
    targetEntityId: uuid('target_entity_id').references(() => legalEntity.id),
    disposition: perimeterDisposition('disposition').notNull().default('pending'),
    /** Pending items: how and by which gate the disposition will be resolved (business-gates G1-C03). */
    resolutionPath: text('resolution_path'),
    targetGateKey: varchar('target_gate_key', { length: 16 }),
    legalOwner: text('legal_owner'),
    operator: text('operator'),
    economicBeneficiary: text('economic_beneficiary'),
    /** Legal transfer dates. */
    plannedEffectiveDate: date('planned_effective_date', { mode: 'string' }),
    actualEffectiveDate: date('actual_effective_date', { mode: 'string' }),
    /** Economic transfer dates (separate from legal — D-05). */
    economicPlannedEffectiveDate: date('economic_planned_effective_date', { mode: 'string' }),
    economicActualEffectiveDate: date('economic_actual_effective_date', { mode: 'string' }),
    transferMechanism: text('transfer_mechanism'), // proposed
    agreementId: uuid('agreement_id'),
    ...moneyCols('reference_value'),
    referenceValueSource: text('reference_value_source'),
    consentRequired: boolean('consent_required').notNull().default(false),
    dependencies: text('dependencies'),
    risks: text('risks'),
    /** Legal transfer status. */
    transferStatus: transferStatus('transfer_status').notNull().default('not_started'),
    /** Economic transfer (beneficial ownership / economics) tracked separately (P0 review D-05). */
    economicTransferStatus: transferStatus('economic_transfer_status').notNull().default('not_started'),
    acceptanceEvidenceNote: text('acceptance_evidence_note'),
    /** Specialist transferability classification (REQ-AGR-006); `unknown` until a specialist assesses it (D-17). */
    transferClass: contractTransferClass('transfer_class').notNull().default('unknown'),
    transferClassAssessedBy: uuid('transfer_class_assessed_by'),
    transferClassAssessedAt: ts('transfer_class_assessed_at'),
    transferClassBasis: text('transfer_class_basis'),
    /** Day-1 position when the contract cannot transfer on Day 1 (AT-08, REQ-AGR-008). */
    interimArrangement: text('interim_arrangement'),
    serviceAccountableUserId: uuid('service_accountable_user_id').references(() => appUser.id),
    billingAccountableUserId: uuid('billing_accountable_user_id').references(() => appUser.id),
    slaAccountableUserId: uuid('sla_accountable_user_id').references(() => appUser.id),
    remediationPlan: text('remediation_plan'),
    /** Open change request raised for a post-baseline scope change of this item (AT-07); cleared when resolved. */
    pendingChangeRequestId: uuid('pending_change_request_id'),
    verificationStatus: verificationStatus('verification_status').notNull().default('proposed'),
    classification: classification('classification').notNull().default('confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('perimeter_item_pid_uq').on(t.projectId, t.id),
    uniqueIndex('perimeter_item_code_uq').on(t.projectId, t.code),
    projectFk('perimeter_item_site_fk', t.projectId, t.siteId, (): FkTarget => site),
    projectFk('perimeter_item_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    projectFk('perimeter_item_agreement_fk', t.projectId, t.agreementId, (): FkTarget => agreement),
    projectFk('perimeter_item_pending_cr_fk', t.projectId, t.pendingChangeRequestId, (): FkTarget => changeRequest),
    index('perimeter_item_status_idx').on(t.projectId, t.transferStatus),
  ],
);

/**
 * Append-only transfer history (REQ-PER-007). One row per transfer command on ONE aspect (legal | economic) of a
 * perimeter item, with that aspect's effective date (D-05 residual). A verification row points at the reported row it
 * verifies; the verifier is never the reporter (not_self).
 */
export const transferRecord = pgTable(
  'transfer_record',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    perimeterItemId: uuid('perimeter_item_id').notNull(),
    aspect: varchar('aspect', { length: 16 }).notNull(),
    command: varchar('command', { length: 32 }).notNull(),
    fromStatus: transferStatus('from_status').notNull(),
    toStatus: transferStatus('to_status').notNull(),
    mechanism: text('mechanism'),
    /** Effective date of THIS aspect (legal or economic) — planned for `plan`, actual for `report_transferred`. */
    effectiveDate: date('effective_date', { mode: 'string' }),
    note: text('note'),
    /** Active acceptance evidence (target `transfer`) when the row was written. */
    evidenceCount: integer('evidence_count').notNull().default(0),
    /** For verify / reject_evidence: the `report_transferred` row being reviewed. */
    reviewsRecordId: uuid('reviews_record_id'),
    recordedBy: uuid('recorded_by').notNull(),
    recordedAt: createdAt(),
  },
  (t) => [
    unique('transfer_record_pid_uq').on(t.projectId, t.id),
    projectFk('transfer_record_item_fk', t.projectId, t.perimeterItemId, (): FkTarget => perimeterItem),
    projectFk('transfer_record_reviews_fk', t.projectId, t.reviewsRecordId, { projectId: t.projectId, id: t.id }),
    index('transfer_record_item_idx').on(t.perimeterItemId),
    check('transfer_record_aspect_ck', sql`${t.aspect} in ('legal', 'economic')`),
    check(
      'transfer_record_command_ck',
      sql`${t.command} in ('plan', 'start', 'report_transferred', 'verify', 'reject_evidence', 'block', 'unblock', 'mark_not_applicable')`,
    ),
  ],
);

/**
 * Consent / novation / assignment requests to counterparties (REQ-AGR-008). The contract's specialist transferability
 * class and its Day-1 fallback live on the perimeter item; this table tracks each request, response and evidence.
 */
export const consent = pgTable(
  'consent',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    perimeterItemId: uuid('perimeter_item_id'),
    agreementId: uuid('agreement_id'),
    kind: varchar('kind', { length: 16 }).notNull().default('consent'),
    counterparty: text('counterparty').notNull(),
    contractRef: text('contract_ref'),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    status: consentStatus('status').notNull().default('not_requested'),
    requestedOn: date('requested_on', { mode: 'string' }),
    respondedOn: date('responded_on', { mode: 'string' }),
    conditions: text('conditions'),
    dueDate: date('due_date', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
    /** Evidence of the response (the counterparty letter / record) — required for granted/conditional/refused. */
    responseEvidenceNote: text('response_evidence_note'),
    responseDocumentId: uuid('response_document_id'),
    responseRecordedBy: uuid('response_recorded_by'),
    responseRecordedAt: ts('response_recorded_at'),
    classification: classification('classification').notNull().default('confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('consent_pid_uq').on(t.projectId, t.id),
    uniqueIndex('consent_code_uq').on(t.projectId, t.code),
    projectFk('consent_item_fk', t.projectId, t.perimeterItemId, (): FkTarget => perimeterItem),
    projectFk('consent_agreement_fk', t.projectId, t.agreementId, (): FkTarget => agreement),
    projectFk('consent_response_doc_fk', t.projectId, t.responseDocumentId, (): FkTarget => document),
    check('consent_kind_ck', sql`${t.kind} in ('consent', 'novation', 'assignment', 'notification', 'other')`),
  ],
);

/**
 * Regulatory / external-party / internal approval register (spec §7.2; REQ-AGR-004/005/007). Applicability is
 * `assessment_pending` until a specialist records an assessment; the platform never asserts that an approval is
 * mandatory or obtained because it appears in a source. A grant is recorded by a verifier with evidence and validity.
 */
export const regulatoryRequirement = pgTable(
  'regulatory_requirement',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    category: approvalRegisterCategory('category').notNull(),
    authority: text('authority').notNull(), // as named in source, e.g. "CST" — not expanded without confirmation
    title: text('title').notNull(),
    description: text('description'),
    /** Where the entry came from: manual entry or a source extraction (image/workbook — never a determination). */
    origin: varchar('origin', { length: 24 }).notNull().default('manual'),
    sourceReference: text('source_reference'),
    applicability: applicabilityStatus('applicability').notNull().default('assessment_pending'),
    applicabilityAssessedBy: uuid('applicability_assessed_by'),
    applicabilityAssessedAt: ts('applicability_assessed_at'),
    applicabilityNote: text('applicability_note'),
    status: requirementStatus('status').notNull().default('not_started'),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    submittedOn: date('submitted_on', { mode: 'string' }),
    decisionOn: date('decision_on', { mode: 'string' }),
    conditions: text('conditions'),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
    outcomeRecordedBy: uuid('outcome_recorded_by'),
    outcomeRecordedAt: ts('outcome_recorded_at'),
    conditionsSatisfiedBy: uuid('conditions_satisfied_by'),
    conditionsSatisfiedAt: ts('conditions_satisfied_at'),
    conditionsSatisfactionNote: text('conditions_satisfaction_note'),
    legalEntityId: uuid('legal_entity_id').references(() => legalEntity.id),
    gateKey: varchar('gate_key', { length: 16 }),
    verificationStatus: verificationStatus('verification_status').notNull().default('proposed'),
    classification: classification('classification').notNull().default('confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('regulatory_requirement_pid_uq').on(t.projectId, t.id),
    uniqueIndex('regulatory_requirement_code_uq').on(t.projectId, t.code),
    check('regulatory_requirement_origin_ck', sql`${t.origin} in ('manual', 'source_extraction', 'import')`),
  ],
);

/**
 * Perimeter version (REQ-SET-012, setup wizard step 4): a frozen snapshot of the register (items, dispositions,
 * workstreams, owners) proposed by the PM and approved by the sponsor with a final governance decision. At most one
 * proposed and one approved version per project; an approval supersedes the previous one. Snapshots never change.
 */
export const perimeterVersion = pgTable(
  'perimeter_version',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    versionNo: integer('version_no').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('proposed'),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    itemCount: integer('item_count').notNull(),
    note: text('note'),
    proposedBy: uuid('proposed_by').notNull(),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionId: uuid('decision_id'),
    decisionNote: text('decision_note'),
    supersededAt: ts('superseded_at'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    version: versionCol(),
  },
  (t) => [
    unique('perimeter_version_pid_uq').on(t.projectId, t.id),
    uniqueIndex('perimeter_version_no_uq').on(t.projectId, t.versionNo),
    uniqueIndex('perimeter_version_one_proposed_uq').on(t.projectId).where(sql`status = 'proposed'`),
    uniqueIndex('perimeter_version_one_approved_uq').on(t.projectId).where(sql`status = 'approved'`),
    // DOM-P2R-05 / QA-P2-01 backstop: one governance decision backs one perimeter version.
    uniqueIndex('perimeter_version_decision_uq').on(t.decisionId).where(sql`decision_id is not null and status in ('approved', 'superseded')`),
    projectFk('perimeter_version_decision_fk', t.projectId, t.decisionId, (): FkTarget => decision),
    check('perimeter_version_status_ck', sql`${t.status} in ('proposed', 'approved', 'rejected', 'superseded')`),
  ],
);

/**
 * Impact assessment of a perimeter change across modules (REQ-PER-004): financial statements, valuation, agreements,
 * TSAs, readiness, schedule and budget. Append-only snapshot (references are frozen codes, not live links).
 */
export const perimeterImpactAssessment = pgTable(
  'perimeter_impact_assessment',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    perimeterItemId: uuid('perimeter_item_id').notNull(),
    changeRequestId: uuid('change_request_id'),
    trigger: varchar('trigger', { length: 24 }).notNull(),
    entries: jsonb('entries').$type<Record<string, unknown>[]>().notNull(),
    narrative: jsonb('narrative').$type<Record<string, string>>().notNull().default({}),
    assessedBy: uuid('assessed_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('perimeter_impact_pid_uq').on(t.projectId, t.id),
    projectFk('perimeter_impact_item_fk', t.projectId, t.perimeterItemId, (): FkTarget => perimeterItem),
    projectFk('perimeter_impact_cr_fk', t.projectId, t.changeRequestId, (): FkTarget => changeRequest),
    index('perimeter_impact_item_idx').on(t.perimeterItemId),
    check('perimeter_impact_trigger_ck', sql`${t.trigger} in ('manual', 'change_request')`),
  ],
);

/**
 * Category coverage review (REQ-PER-003): a specialist records that a perimeter category (e.g. financing, guarantees)
 * was assessed and no item is in the perimeter. Without items or a review, reconciliation flags the category.
 */
export const perimeterCategoryReview = pgTable(
  'perimeter_category_review',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    category: perimeterItemType('category').notNull(),
    conclusion: text('conclusion').notNull(),
    reviewedBy: uuid('reviewed_by').notNull(),
    reviewedAt: ts('reviewed_at').notNull().defaultNow(),
    isDemo: isDemo(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [unique('perimeter_category_review_pid_uq').on(t.projectId, t.id), uniqueIndex('perimeter_category_review_uq').on(t.projectId, t.category)],
);

export const tsaService = pgTable(
  'tsa_service',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    name: text('name').notNull(),
    agreementId: uuid('agreement_id'),
    providerEntityId: uuid('provider_entity_id').references(() => legalEntity.id),
    recipientEntityId: uuid('recipient_entity_id').references(() => legalEntity.id),
    scope: text('scope'),
    dependentServices: text('dependent_services'),
    sla: text('sla'),
    metricMethod: text('metric_method'),
    chargeBasis: text('charge_basis'),
    ...moneyCols('charge'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    extensionTerms: text('extension_terms'),
    terminationTerms: text('termination_terms'),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    /** Workstream accountable for the service (own_workstream / workstream reach of readiness.tsa.manage). */
    workstreamId: uuid('workstream_id'),
    /** TSA records carry commercial terms (charge basis): confidential by default (access-matrix §2.3). */
    classification: classification('classification').notNull().default('confidential'),
    replacementService: text('replacement_service'),
    /** How and by when the replacement is delivered (the replacement plan). */
    replacementPlan: text('replacement_plan'),
    replacementDueDate: date('replacement_due_date', { mode: 'string' }),
    replacementAccepted: boolean('replacement_accepted').notNull().default(false),
    replacementAcceptedBy: uuid('replacement_accepted_by'),
    replacementAcceptedAt: ts('replacement_accepted_at'),
    /** Last reported replacement-service failure (REQ-TSA-004); history in record_version + audit. */
    replacementFailedAt: ts('replacement_failed_at'),
    replacementFailureNote: text('replacement_failure_note'),
    exitMilestones: jsonb('exit_milestones').$type<{ title: string; dueDate?: string; done?: boolean }[]>().notNull().default([]),
    acceptanceEvidenceNote: text('acceptance_evidence_note'),
    residualRisks: text('residual_risks'),
    isEnduringArrangement: boolean('is_enduring_arrangement').notNull().default(false),
    status: tsaStatus('status').notNull().default('proposed'),
    escalationId: uuid('escalation_id'),
    /** Governance decision that approved the TSA terms (type tsa_approval_or_extension). */
    approvalDecisionId: uuid('approval_decision_id'),
    /** Approved decision authorizing an extension (never automatic — P0 review D-06). */
    extensionDecisionId: uuid('extension_decision_id'),
    /** Requested new end date awaiting the extension decision (applied only by record-extension). */
    proposedEndDate: date('proposed_end_date', { mode: 'string' }),
    extensionRequestedBy: uuid('extension_requested_by'),
    extensionRequestedAt: ts('extension_requested_at'),
    continuityPlan: text('continuity_plan'),
    /** approveTSAExit: approval request bound to the TSA version + payload hash (REQ-TSA-006). */
    exitApprovalRequestId: uuid('exit_approval_request_id'),
    exitApprovedBy: uuid('exit_approved_by'),
    exitApprovedAt: ts('exit_approved_at'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('tsa_service_escalation_fk', t.projectId, t.escalationId, (): FkTarget => escalation),
    projectFk('tsa_service_extension_decision_fk', t.projectId, t.extensionDecisionId, (): FkTarget => decision),
    projectFk('tsa_service_approval_decision_fk', t.projectId, t.approvalDecisionId, (): FkTarget => decision),
    projectFk('tsa_service_exit_approval_fk', t.projectId, t.exitApprovalRequestId, (): FkTarget => approvalRequest),
    projectFk('tsa_service_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    unique('tsa_service_pid_uq').on(t.projectId, t.id),
    uniqueIndex('tsa_service_code_uq').on(t.projectId, t.code),
    projectFk('tsa_service_agreement_fk', t.projectId, t.agreementId, (): FkTarget => agreement),
    index('tsa_service_status_idx').on(t.projectId, t.status),
  ],
);

export const cutoverPlan = pgTable(
  'cutover_plan',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    title: text('title').notNull(),
    siteId: uuid('site_id'),
    /** Workstream accountable for the transition (own_workstream / workstream reach of readiness.cutover.manage). */
    workstreamId: uuid('workstream_id'),
    runbookDocumentId: uuid('runbook_document_id'),
    runbookSummary: text('runbook_summary'),
    windowStart: ts('window_start'),
    windowEnd: ts('window_end'),
    serviceImpact: text('service_impact'),
    accountableUserId: uuid('accountable_user_id').references(() => appUser.id),
    communicationsApproved: boolean('communications_approved').notNull().default(false),
    /** Reference of the communications approval (who/what approved them outside the platform). */
    communicationsApprovalRef: text('communications_approval_ref'),
    testingSummary: text('testing_summary'),
    rehearsalDone: boolean('rehearsal_done').notNull().default(false),
    contingencyPlan: text('contingency_plan'),
    rollbackPlan: text('rollback_plan'),
    goNoGo: goNoGo('go_no_go').notNull().default('pending'),
    goNoGoDecidedBy: uuid('go_no_go_decided_by'),
    goNoGoDecidedAt: ts('go_no_go_decided_at'),
    goNoGoRationale: text('go_no_go_rationale'),
    goDecisionId: uuid('go_decision_id'),
    status: cutoverStatus('status').notNull().default('planning'),
    /** Requester of the go/no-go (the decider must be another person — access-matrix §2.4). */
    submittedForDecisionBy: uuid('submitted_for_decision_by'),
    submittedForDecisionAt: ts('submitted_for_decision_at'),
    /** Execution recorded here; the change itself happens in the approved operational systems (REQ-RDY-006). */
    executedBy: uuid('executed_by'),
    executedAt: ts('executed_at'),
    executionNote: text('execution_note'),
    postTransitionAccepted: boolean('post_transition_accepted').notNull().default(false),
    postTransitionAcceptedBy: uuid('post_transition_accepted_by'),
    postTransitionAcceptedAt: ts('post_transition_accepted_at'),
    postTransitionAcceptanceNote: text('post_transition_acceptance_note'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('cutover_plan_runbook_fk', t.projectId, t.runbookDocumentId, (): FkTarget => document),
    projectFk('cutover_plan_go_decision_fk', t.projectId, t.goDecisionId, (): FkTarget => decision),
    unique('cutover_plan_pid_uq').on(t.projectId, t.id),
    uniqueIndex('cutover_plan_code_uq').on(t.projectId, t.code),
    projectFk('cutover_plan_site_fk', t.projectId, t.siteId, (): FkTarget => site),
    projectFk('cutover_plan_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
  ],
);

/**
 * Go/no-go decision history of a cutover plan (AT-09 "decision history"): submissions, GO / NO-GO decisions, GO attempts
 * refused by the server (with the blockers at that moment), execution, rollback and acceptance. Append-only by design —
 * the service never updates or deletes rows (lead request: add to the post-migrate append-only list).
 */
export const cutoverDecisionRecord = pgTable(
  'cutover_decision_record',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    cutoverPlanId: uuid('cutover_plan_id').notNull(),
    /** submitted | returned_to_planning | rehearsal | go | no_go | go_blocked | executed | rolled_back | accepted */
    kind: varchar('kind', { length: 32 }).notNull(),
    fromStatus: cutoverStatus('from_status'),
    toStatus: cutoverStatus('to_status'),
    actorUserId: uuid('actor_user_id').notNull(),
    rationale: text('rationale'),
    goDecisionId: uuid('go_decision_id'),
    /** Server evaluation at that moment: open blockers and missing prerequisites. */
    evaluation: jsonb('evaluation').$type<{ blockers: { id: string; title: string; status: string; blocker: boolean }[]; missing: string[] }>(),
    isDemo: isDemo(),
    createdAt: createdAt(),
  },
  (t) => [
    projectFk('cutover_decision_record_plan_fk', t.projectId, t.cutoverPlanId, (): FkTarget => cutoverPlan),
    projectFk('cutover_decision_record_decision_fk', t.projectId, t.goDecisionId, (): FkTarget => decision),
    index('cutover_decision_record_plan_idx').on(t.cutoverPlanId, t.createdAt),
  ],
);

/** Day-1 readiness check (site/workstream checklist item with blocker flag and specialist sign-off). */
export const readinessCheck = pgTable(
  'readiness_check',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    area: readinessArea('area').notNull(),
    title: text('title').notNull(),
    titleAr: text('title_ar'),
    siteId: uuid('site_id'),
    workstreamId: uuid('workstream_id'),
    cutoverPlanId: uuid('cutover_plan_id'),
    /** Accountable owner of the check (own_workstream; excluded from signing it off — access-matrix §2.4). */
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    /** Key of the template default check it was instantiated from (DC template readinessAreas), if any. */
    templateKey: varchar('template_key', { length: 64 }),
    mandatory: boolean('mandatory').notNull().default(true),
    blocker: boolean('blocker').notNull().default(false),
    /** Waivability set by a specialist; a waiver needs an approved `waiver` row (P0 review D-02). */
    waivable: boolean('waivable').notNull().default(false),
    waiverAuthorityRole: roleKey('waiver_authority_role'),
    waivabilityBasis: text('waivability_basis'),
    waivabilityDeterminedBy: uuid('waivability_determined_by'),
    waivabilityDeterminedAt: ts('waivability_determined_at'),
    waiverId: uuid('waiver_id'),
    status: readinessStatus('status').notNull().default('not_started'),
    signoffRole: roleKey('signoff_role'),
    signedOffBy: uuid('signed_off_by'),
    signedOffAt: ts('signed_off_at'),
    signoffNote: text('signoff_note'),
    testResult: text('test_result'),
    /** Contingency runbook applied when the check fails (AT-09 shows it next to the blocker). */
    failureContingency: text('failure_contingency'),
    dueDate: date('due_date', { mode: 'string' }),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('readiness_check_waiver_fk', t.projectId, t.waiverId, (): FkTarget => waiver),
    unique('readiness_check_pid_uq').on(t.projectId, t.id),
    uniqueIndex('readiness_check_code_uq').on(t.projectId, t.code),
    projectFk('readiness_check_site_fk', t.projectId, t.siteId, (): FkTarget => site),
    projectFk('readiness_check_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    projectFk('readiness_check_cutover_fk', t.projectId, t.cutoverPlanId, (): FkTarget => cutoverPlan),
    index('readiness_check_status_idx').on(t.projectId, t.status),
  ],
);

/** History of readiness test runs (a failed test stays visible even after a later pass). */
export const readinessTestRun = pgTable(
  'readiness_test_run',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    readinessCheckId: uuid('readiness_check_id').notNull(),
    result: readinessStatus('result').notNull(),
    note: text('note'),
    recordedBy: uuid('recorded_by').notNull(),
    recordedAt: createdAt(),
    seq: integer('seq').notNull().default(1),
  },
  (t) => [
    projectFk('readiness_test_run_check_fk', t.projectId, t.readinessCheckId, (): FkTarget => readinessCheck),
    // One run per sequence number (the check's version lock serializes writers).
    uniqueIndex('readiness_test_run_seq_uq').on(t.readinessCheckId, t.seq),
  ],
);

/**
 * Approved definition of operational independence / target operating model (spec §3: "effect on the approved
 * definition of independence"). Versioned; approval is a human decision.
 */
export const operatingModelDefinition = pgTable(
  'operating_model_definition',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    versionLabel: varchar('version_label', { length: 32 }).notNull(),
    definition: text('definition').notNull(),
    independenceCriteria: jsonb('independence_criteria').$type<{ key: string; description: string }[]>().notNull().default([]),
    permittedEnduringArrangements: text('permitted_enduring_arrangements'),
    status: varchar('status', { length: 16 }).notNull().default('proposed'), // proposed | approved | superseded
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    decisionId: uuid('decision_id'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('operating_model_decision_fk', t.projectId, t.decisionId, (): FkTarget => decision),
    unique('operating_model_definition_pid_uq').on(t.projectId, t.id),
    uniqueIndex('operating_model_definition_uq').on(t.projectId, t.versionLabel),
    // P0 review N-04: the status vocabulary is constrained in the database.
    check('operating_model_definition_status_ck', sql`${t.status} in ('proposed', 'approved', 'superseded')`),
  ],
);
