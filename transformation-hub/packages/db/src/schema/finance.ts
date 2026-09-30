import { pgTable, uuid, text, integer, jsonb, varchar, date, numeric, unique, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
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
  financialKind,
  financialCategory,
  approvalState,
  modelKind,
  modelCase,
  valueBasis,
  benefitStatus,
  kpiDirection,
  verificationStatus,
  classification,
  sourceType,
} from './_common';
import { project, workstream } from './portfolio';
import { appUser } from './identity';
import { document, documentVersion } from './documents';
import { decision, approvalRequest } from './governance';
import { tsaService } from './carveout';
import { importBatch } from './reporting';

/**
 * Baseline / forecast / actual financial figure with currency, unit, period, source and approval (spec §7.5,
 * REQ-FIN-001/004/008/010). Human financial validation (a person other than the preparer) precedes approval by a third
 * person; the database refuses an approved row without a distinct validator and approver.
 */
export const financialSnapshot = pgTable(
  'financial_snapshot',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    kind: financialKind('kind').notNull(),
    category: financialCategory('category').notNull(),
    lineRef: varchar('line_ref', { length: 64 }).notNull(), // groups the same line across kinds, prevents double counting
    label: text('label').notNull(),
    period: varchar('period', { length: 16 }).notNull(), // e.g. 2026-Q4, 2027-01, FY2027
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    unitScale: integer('unit_scale').notNull().default(1),
    /** manual_entry (source reference required) or an import (excel/csv: source document + sheet/cell kept — REQ-FIN-008). */
    sourceType: sourceType('source_type').notNull().default('manual_entry'),
    sourceRef: text('source_ref'),
    sourceDocumentId: uuid('source_document_id'),
    sourceDocumentVersionId: uuid('source_document_version_id'),
    sourceSheet: varchar('source_sheet', { length: 128 }),
    sourceCell: varchar('source_cell', { length: 64 }),
    importBatchId: uuid('import_batch_id'),
    /** TSA charges only: the TSA service charged (counted once across the TSA and cost views — REQ-FIN-002). */
    tsaServiceId: uuid('tsa_service_id'),
    approvalState: approvalState('approval_state').notNull().default('proposed'),
    /** Last person who changed the content (the "preparer" for separation of duties). */
    preparedBy: uuid('prepared_by'),
    validatedBy: uuid('validated_by'),
    validatedAt: ts('validated_at'),
    validationNote: text('validation_note'),
    /** Hash of the content that was validated; approval requires the current content to match (REQ-FIN-010). */
    validatedHash: text('validated_hash'),
    approvalRequestId: uuid('approval_request_id'),
    /** Governance decision behind the approval (mandatory for opening balances: opening_balance_sheet). */
    approvalDecisionId: uuid('approval_decision_id'),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    workstreamId: uuid('workstream_id'),
    classification: classification('classification').notNull().default('restricted'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('financial_snapshot_doc_fk', t.projectId, t.sourceDocumentId, (): FkTarget => document),
    projectFk('financial_snapshot_docver_fk', t.projectId, t.sourceDocumentVersionId, (): FkTarget => documentVersion),
    projectFk('financial_snapshot_import_fk', t.projectId, t.importBatchId, (): FkTarget => importBatch),
    projectFk('financial_snapshot_tsa_fk', t.projectId, t.tsaServiceId, (): FkTarget => tsaService),
    projectFk('financial_snapshot_request_fk', t.projectId, t.approvalRequestId, (): FkTarget => approvalRequest),
    projectFk('financial_snapshot_decision_fk', t.projectId, t.approvalDecisionId, (): FkTarget => decision),
    unique('financial_snapshot_pid_uq').on(t.projectId, t.id),
    uniqueIndex('financial_snapshot_line_uq').on(t.projectId, t.kind, t.lineRef, t.period),
    /** A TSA's charge appears once per kind and period (REQ-FIN-002). */
    uniqueIndex('financial_snapshot_tsa_uq').on(t.projectId, t.kind, t.tsaServiceId, t.period).where(sql`${t.tsaServiceId} is not null`),
    projectFk('financial_snapshot_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    check('financial_snapshot_scale_chk', sql`${t.unitScale} in (1, 1000, 1000000)`),
    check('financial_snapshot_currency_chk', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('financial_snapshot_tsa_chk', sql`(${t.category} = 'tsa_charge') = (${t.tsaServiceId} is not null)`),
    check('financial_snapshot_source_chk', sql`${t.sourceDocumentId} is not null or nullif(btrim(${t.sourceRef}), '') is not null`),
    check(
      'financial_snapshot_import_ref_chk',
      sql`${t.sourceType} not in ('excel', 'csv') or (${t.sourceDocumentId} is not null and ${t.sourceCell} is not null and (${t.sourceType} = 'csv' or ${t.sourceSheet} is not null))`,
    ),
    check('financial_snapshot_validator_chk', sql`${t.validatedBy} is null or (${t.validatedBy} is distinct from ${t.preparedBy} and ${t.validatedHash} is not null and ${t.validatedAt} is not null)`),
    check(
      'financial_snapshot_approved_chk',
      sql`${t.approvalState} <> 'approved' or (${t.validatedBy} is not null and ${t.approvedBy} is not null and ${t.approvedAt} is not null and ${t.approvedBy} <> ${t.validatedBy} and ${t.approvedBy} is distinct from ${t.preparedBy})`,
    ),
    check('financial_snapshot_opening_chk', sql`${t.approvalState} <> 'approved' or ${t.category} <> 'opening_balance' or ${t.approvalDecisionId} is not null`),
    index('financial_snapshot_period_idx').on(t.projectId, t.kind, t.period),
  ],
);

/**
 * Budget line: approved vs committed vs spent kept separate (spec §7.5, REQ-FIN-003). The approved amount is set only from
 * a final governance decision (change control); commitments and spend are recorded with their source.
 */
export const budgetLine = pgTable(
  'budget_line',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    workstreamId: uuid('workstream_id'),
    code: varchar('code', { length: 32 }).notNull(),
    name: text('name').notNull(),
    category: financialCategory('category').notNull(),
    /** Requested budget (proposal); NOT approved until a final governance decision is recorded. */
    proposedAmount: numeric('proposed_amount', { precision: 20, scale: 4 }),
    approvedAmount: numeric('approved_amount', { precision: 20, scale: 4 }),
    committedAmount: numeric('committed_amount', { precision: 20, scale: 4 }).notNull().default('0'),
    spentAmount: numeric('spent_amount', { precision: 20, scale: 4 }).notNull().default('0'),
    currency: varchar('currency', { length: 3 }).notNull(),
    unitScale: integer('unit_scale').notNull().default(1),
    /** Business date (project timezone) of the latest commitment / spend figures, and their source. */
    actualsAsOf: date('actuals_as_of', { mode: 'string' }),
    actualsSourceRef: text('actuals_source_ref'),
    /** TSA charges only: the TSA service whose charge this line carries (one line per TSA — REQ-FIN-002). */
    tsaServiceId: uuid('tsa_service_id'),
    approvalState: approvalState('approval_state').notNull().default('proposed'),
    approvalDecisionId: uuid('approval_decision_id'),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    sourceRef: text('source_ref'),
    /** Budget and costs: confidential by default (access-matrix §2.3). */
    classification: classification('classification').notNull().default('confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('budget_line_pid_uq').on(t.projectId, t.id),
    uniqueIndex('budget_line_code_uq').on(t.projectId, t.code),
    uniqueIndex('budget_line_tsa_uq').on(t.projectId, t.tsaServiceId).where(sql`${t.tsaServiceId} is not null`),
    projectFk('budget_line_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    projectFk('budget_line_tsa_fk', t.projectId, t.tsaServiceId, (): FkTarget => tsaService),
    projectFk('budget_line_decision_fk', t.projectId, t.approvalDecisionId, (): FkTarget => decision),
    check('budget_line_scale_chk', sql`${t.unitScale} in (1, 1000, 1000000)`),
    check('budget_line_currency_chk', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('budget_line_tsa_chk', sql`(${t.category} = 'tsa_charge') = (${t.tsaServiceId} is not null)`),
    check('budget_line_nonneg_chk', sql`${t.committedAmount} >= 0 and ${t.spentAmount} >= 0 and coalesce(${t.approvedAmount}, 0) >= 0 and coalesce(${t.proposedAmount}, 0) >= 0`),
    // The API records an approved amount only from a final governance decision (BudgetService.recordApproval); the database
    // keeps amount and state consistent. (A stricter check — decision + approver mandatory — is proposed to the lead: an
    // existing planning fixture inserts an approved line without a decision.)
    check('budget_line_approved_chk', sql`${t.approvedAmount} is null or ${t.approvalState} = 'approved'`),
    check('budget_line_state_chk', sql`${t.approvalState} <> 'approved' or ${t.approvedAmount} is not null`),
  ],
);

/**
 * A business plan or valuation model (spec §7.5, REQ-FIN-005). Its versions reference outputs imported from the
 * original models; this platform is not a valuation engine.
 */
export const financialModel = pgTable(
  'financial_model',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    kind: modelKind('kind').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Business plan outputs: restricted; valuation models: strictly_confidential (access-matrix §2.3). */
    classification: classification('classification').notNull().default('strictly_confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [unique('financial_model_pid_uq').on(t.projectId, t.id), uniqueIndex('financial_model_code_uq').on(t.projectId, t.code)],
);

export type ModelOutputJson = {
  key: string;
  label: string;
  measure: 'money' | 'percent';
  amount: string;
  currency: string | null;
  unitScale: number | null;
  basis: 'enterprise_value' | 'equity_value' | 'other';
  sheet: string | null;
  cell: string | null;
};

/**
 * One version of one case (base / downside / upside) of a model. The content (assumptions, outputs, source) is frozen at
 * insert (post-migrate §21): a change is a NEW version, so prior assumptions are preserved (REQ-FIN-005). Proposed values
 * are the outputs; approved values stay EMPTY until an approval is recorded from a final governance decision (REQ-FIN-006).
 */
export const financialModelVersion = pgTable(
  'financial_model_version',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    modelId: uuid('model_id').notNull(),
    kind: modelKind('kind').notNull(),
    versionNo: integer('version_no').notNull(),
    versionLabel: varchar('version_label', { length: 32 }).notNull(),
    modelCase: modelCase('model_case').notNull(),
    /** Version this one was derived from (same model and case); its assumptions are the starting point. */
    basedOnVersionId: uuid('based_on_version_id'),
    /** Set when a newer version of the same case is created (record reference, not a user). */
    supersededById: uuid('superseded_by_id'),
    assumptions: jsonb('assumptions').$type<{ key: string; value: string; unit?: string | null; source?: string | null }[]>().notNull().default([]),
    outputs: jsonb('outputs').$type<ModelOutputJson[]>().notNull().default([]),
    headlineBasis: valueBasis('headline_basis'),
    sourceType: sourceType('source_type').notNull().default('manual_entry'),
    sourceDocumentId: uuid('source_document_id'),
    sourceDocumentVersionId: uuid('source_document_version_id'),
    sourceRef: text('source_ref'),
    importBatchId: uuid('import_batch_id'),
    changeNote: text('change_note'),
    approvalState: approvalState('approval_state').notNull().default('proposed'),
    preparedBy: uuid('prepared_by'),
    validatedBy: uuid('validated_by'),
    validatedAt: ts('validated_at'),
    humanValidationNote: text('human_validation_note'),
    validatedHash: text('validated_hash'),
    approvalRequestId: uuid('approval_request_id'),
    approvalDecisionId: uuid('approval_decision_id'),
    /** Approved values: NULL until an approval is recorded (copy of the validated outputs at approval). */
    approvedValues: jsonb('approved_values').$type<ModelOutputJson[]>(),
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
    projectFk('financial_model_version_model_fk', t.projectId, t.modelId, (): FkTarget => financialModel),
    projectFk('financial_model_doc_fk', t.projectId, t.sourceDocumentId, (): FkTarget => document),
    projectFk('financial_model_docver_fk', t.projectId, t.sourceDocumentVersionId, (): FkTarget => documentVersion),
    projectFk('financial_model_import_fk', t.projectId, t.importBatchId, (): FkTarget => importBatch),
    projectFk('financial_model_based_on_fk', t.projectId, t.basedOnVersionId, (): FkTarget => financialModelVersion),
    projectFk('financial_model_superseded_fk', t.projectId, t.supersededById, (): FkTarget => financialModelVersion),
    projectFk('financial_model_request_fk', t.projectId, t.approvalRequestId, (): FkTarget => approvalRequest),
    projectFk('financial_model_decision_fk', t.projectId, t.approvalDecisionId, (): FkTarget => decision),
    unique('financial_model_version_pid_uq').on(t.projectId, t.id),
    uniqueIndex('financial_model_version_uq').on(t.projectId, t.modelId, t.modelCase, t.versionNo),
    check('financial_model_source_chk', sql`${t.sourceDocumentId} is not null or nullif(btrim(${t.sourceRef}), '') is not null`),
    check('financial_model_validator_chk', sql`${t.validatedBy} is null or (${t.validatedBy} is distinct from ${t.preparedBy} and ${t.validatedHash} is not null and ${t.validatedAt} is not null)`),
    check(
      'financial_model_approved_values_chk',
      sql`${t.approvedValues} is null or (${t.approvalState} = 'approved' and ${t.approvalDecisionId} is not null and ${t.approvedBy} is not null and ${t.validatedBy} is not null and ${t.approvedBy} <> ${t.validatedBy})`,
    ),
    check('financial_model_approved_chk', sql`${t.approvalState} <> 'approved' or ${t.approvedValues} is not null`),
  ],
);

export const benefit = pgTable(
  'benefit',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    title: text('title').notNull(),
    measurementDefinition: text('measurement_definition').notNull(),
    baselineValue: text('baseline_value'),
    targetValue: text('target_value'),
    actualValue: text('actual_value'),
    unit: varchar('unit', { length: 32 }),
    /** Estimated monetary value of the benefit (optional). */
    ...moneyCols('value'),
    /** Monetary value reported at realization (optional; same currency/unit as the estimate when both exist). */
    ...moneyCols('realized'),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    workstreamId: uuid('workstream_id'),
    /** Planned realization date (business date, project timezone). */
    realizationDate: date('realization_date', { mode: 'string' }),
    /** Actual realization date reported with the realization. */
    realizedOn: date('realized_on', { mode: 'string' }),
    verificationSource: text('verification_source'),
    status: benefitStatus('status').notNull().default('proposed'),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    realizationRecordedBy: uuid('realization_recorded_by'),
    realizationRecordedAt: ts('realization_recorded_at'),
    verifiedBy: uuid('verified_by'),
    verifiedAt: ts('verified_at'),
    verificationNote: text('verification_note'),
    statusNote: text('status_note'),
    /** Benefits: confidential by default (access-matrix §2.3). */
    classification: classification('classification').notNull().default('confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('benefit_pid_uq').on(t.projectId, t.id),
    uniqueIndex('benefit_code_uq').on(t.projectId, t.code),
    projectFk('benefit_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    check('benefit_value_chk', sql`(${t.valueAmount} is null) = (${t.valueCurrency} is null) and (${t.valueAmount} is null) = (${t.valueUnitScale} is null) and coalesce(${t.valueUnitScale}, 1) in (1, 1000, 1000000)`),
    check(
      'benefit_realized_money_chk',
      sql`(${t.realizedAmount} is null) = (${t.realizedCurrency} is null) and (${t.realizedAmount} is null) = (${t.realizedUnitScale} is null) and coalesce(${t.realizedUnitScale}, 1) in (1, 1000, 1000000)`,
    ),
    check(
      'benefit_realized_chk',
      sql`${t.status} not in ('realized_unverified', 'realized_verified') or (nullif(btrim(${t.verificationSource}), '') is not null and ${t.realizationRecordedBy} is not null and ${t.realizedOn} is not null)`,
    ),
    check(
      'benefit_verified_chk',
      sql`${t.status} <> 'realized_verified' or (${t.verifiedBy} is not null and ${t.verifiedAt} is not null and ${t.verifiedBy} <> ${t.realizationRecordedBy} and ${t.verifiedBy} is distinct from ${t.ownerUserId})`,
    ),
  ],
);

export const kpi = pgTable(
  'kpi',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    key: varchar('key', { length: 64 }).notNull(),
    name: text('name').notNull(),
    nameAr: text('name_ar'),
    definition: text('definition').notNull(),
    formula: text('formula').notNull(),
    unit: varchar('unit', { length: 32 }).notNull(),
    period: varchar('period', { length: 32 }).notNull(),
    ownerRole: varchar('owner_role', { length: 32 }),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    /** Benefit this KPI measures (optional). */
    benefitId: uuid('benefit_id'),
    source: text('source').notNull(),
    target: text('target'),
    thresholds: jsonb('thresholds').$type<{ green: string; amber: string; red: string }>().notNull(),
    direction: kpiDirection('direction').notNull(),
    frequency: varchar('frequency', { length: 32 }).notNull(),
    computation: varchar('computation', { length: 64 }), // key of a deterministic calculator, null = manual
    verificationStatus: verificationStatus('verification_status').notNull().default('proposed'),
    lastVerifiedAt: ts('last_verified_at'),
    /** KPIs: confidential by default (access-matrix §2.3). */
    classification: classification('classification').notNull().default('confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('kpi_pid_uq').on(t.projectId, t.id),
    uniqueIndex('kpi_key_uq').on(t.projectId, t.key),
    projectFk('kpi_benefit_fk', t.projectId, t.benefitId, (): FkTarget => benefit),
  ],
);

/** KPI observation (append-only: a correction is a new observation — post-migrate §21). */
export const kpiObservation = pgTable(
  'kpi_observation',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    kpiId: uuid('kpi_id').notNull(),
    period: varchar('period', { length: 16 }).notNull(),
    value: numeric('value', { precision: 20, scale: 4 }),
    numerator: numeric('numerator', { precision: 20, scale: 4 }),
    denominator: numeric('denominator', { precision: 20, scale: 4 }),
    dataQuality: varchar('data_quality', { length: 16 }).notNull().default('ok'), // ok | incomplete | stale | unknown
    sourceRefs: jsonb('source_refs').$type<{ type: string; id: string }[]>().notNull().default([]),
    sourceRef: text('source_ref'),
    note: text('note'),
    computedAt: createdAt(),
    computedBy: varchar('computed_by', { length: 32 }).notNull().default('system'),
    /** Person who recorded a manual observation (null for computed observations). */
    recordedBy: uuid('recorded_by'),
  },
  (t) => [
    projectFk('kpi_observation_kpi_fk', t.projectId, t.kpiId, (): FkTarget => kpi),
    index('kpi_observation_idx').on(t.kpiId, t.period),
    check('kpi_observation_quality_chk', sql`${t.dataQuality} in ('ok', 'incomplete', 'stale', 'unknown')`),
  ],
);

/** Intercompany reconciliation between the parent and NewCo (spec §7.5; P0 review D-16; REQ-FIN-004). */
export const intercompanyReconciliation = pgTable(
  'intercompany_reconciliation',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    /** The intercompany / opening balance figure this reconciliation supports (optional). */
    financialSnapshotId: uuid('financial_snapshot_id'),
    counterpartyLabel: text('counterparty_label').notNull(),
    period: varchar('period', { length: 16 }).notNull(),
    ourBalance: numeric('our_balance', { precision: 20, scale: 4 }).notNull(),
    theirBalance: numeric('their_balance', { precision: 20, scale: 4 }),
    currency: varchar('currency', { length: 3 }).notNull(),
    unitScale: integer('unit_scale').notNull().default(1),
    status: varchar('status', { length: 16 }).notNull().default('open'), // open | reconciled | disputed
    explanation: text('explanation'),
    sourceRef: text('source_ref'),
    preparedBy: uuid('prepared_by'),
    reviewerUserId: uuid('reviewer_user_id'),
    reviewedAt: ts('reviewed_at'),
    classification: classification('classification').notNull().default('restricted'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('intercompany_reconciliation_pid_uq').on(t.projectId, t.id),
    uniqueIndex('intercompany_reconciliation_code_uq').on(t.projectId, t.code),
    projectFk('intercompany_reconciliation_snapshot_fk', t.projectId, t.financialSnapshotId, (): FkTarget => financialSnapshot),
    check('intercompany_reconciliation_scale_chk', sql`${t.unitScale} in (1, 1000, 1000000)`),
    check('intercompany_reconciliation_status_chk', sql`${t.status} in ('open', 'reconciled', 'disputed')`),
    check(
      'intercompany_reconciliation_reconciled_chk',
      sql`${t.status} <> 'reconciled' or (${t.theirBalance} is not null and ${t.reviewerUserId} is not null and ${t.reviewedAt} is not null and ${t.reviewerUserId} is distinct from ${t.preparedBy} and (${t.theirBalance} = ${t.ourBalance} or nullif(btrim(${t.explanation}), '') is not null))`,
    ),
  ],
);
