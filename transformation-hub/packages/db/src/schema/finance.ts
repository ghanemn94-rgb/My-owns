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
} from './_common';
import { project, workstream } from './portfolio';
import { appUser } from './identity';
import { document } from './documents';

/** Baseline / forecast / actual financial figure with currency, unit, period, source and approval (spec §7.5). */
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
    sourceRef: text('source_ref'),
    sourceDocumentId: uuid('source_document_id'),
    approvalState: approvalState('approval_state').notNull().default('proposed'),
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
    unique('financial_snapshot_pid_uq').on(t.projectId, t.id),
    uniqueIndex('financial_snapshot_line_uq').on(t.projectId, t.kind, t.lineRef, t.period),
    projectFk('financial_snapshot_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    check('financial_snapshot_scale_chk', sql`${t.unitScale} in (1, 1000, 1000000)`),
  ],
);

/** Budget line: approved vs committed vs spent kept separate (spec §7.5). */
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
    approvedAmount: numeric('approved_amount', { precision: 20, scale: 4 }),
    committedAmount: numeric('committed_amount', { precision: 20, scale: 4 }).notNull().default('0'),
    spentAmount: numeric('spent_amount', { precision: 20, scale: 4 }).notNull().default('0'),
    currency: varchar('currency', { length: 3 }).notNull(),
    unitScale: integer('unit_scale').notNull().default(1),
    approvalState: approvalState('approval_state').notNull().default('proposed'),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    sourceRef: text('source_ref'),
    classification: classification('classification').notNull().default('restricted'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('budget_line_pid_uq').on(t.projectId, t.id),
    uniqueIndex('budget_line_code_uq').on(t.projectId, t.code),
    projectFk('budget_line_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    check('budget_line_scale_chk', sql`${t.unitScale} in (1, 1000, 1000000)`),
  ],
);

/**
 * Business plan / valuation model version — references outputs imported from the original models; this platform
 * is not a valuation engine. Proposed vs approved kept separate; value basis explicit (EV vs equity).
 */
export const financialModelVersion = pgTable(
  'financial_model_version',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    kind: modelKind('kind').notNull(),
    versionLabel: varchar('version_label', { length: 32 }).notNull(),
    modelCase: modelCase('model_case').notNull(),
    assumptions: jsonb('assumptions').$type<{ key: string; value: string; unit?: string; source?: string }[]>().notNull().default([]),
    outputs: jsonb('outputs')
      .$type<{ key: string; label: string; amount: string; currency: string; unitScale: number; basis: 'enterprise_value' | 'equity_value' | 'other' }[]>()
      .notNull()
      .default([]),
    headlineBasis: valueBasis('headline_basis'),
    sourceDocumentId: uuid('source_document_id'),
    sourceRef: text('source_ref'),
    approvalState: approvalState('approval_state').notNull().default('proposed'),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    humanValidationNote: text('human_validation_note'),
    classification: classification('classification').notNull().default('strictly_confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('financial_model_doc_fk', t.projectId, t.sourceDocumentId, (): FkTarget => document),unique('financial_model_pid_uq').on(t.projectId, t.id), uniqueIndex('financial_model_uq').on(t.projectId, t.kind, t.versionLabel, t.modelCase)],
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
    ...moneyCols('value'),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    realizationDate: date('realization_date', { mode: 'string' }),
    verificationSource: text('verification_source'),
    status: benefitStatus('status').notNull().default('proposed'),
    verifiedBy: uuid('verified_by'),
    verifiedAt: ts('verified_at'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [unique('benefit_pid_uq').on(t.projectId, t.id), uniqueIndex('benefit_code_uq').on(t.projectId, t.code)],
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
    source: text('source').notNull(),
    target: text('target'),
    thresholds: jsonb('thresholds').$type<{ green: string; amber: string; red: string }>().notNull(),
    direction: kpiDirection('direction').notNull(),
    frequency: varchar('frequency', { length: 32 }).notNull(),
    computation: varchar('computation', { length: 64 }), // key of a deterministic calculator, null = manual
    verificationStatus: verificationStatus('verification_status').notNull().default('proposed'),
    lastVerifiedAt: ts('last_verified_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [unique('kpi_pid_uq').on(t.projectId, t.id), uniqueIndex('kpi_key_uq').on(t.projectId, t.key)],
);

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
    computedAt: createdAt(),
    computedBy: varchar('computed_by', { length: 32 }).notNull().default('system'),
  },
  (t) => [projectFk('kpi_observation_kpi_fk', t.projectId, t.kpiId, (): FkTarget => kpi), index('kpi_observation_idx').on(t.kpiId, t.period)],
);

/** Intercompany reconciliation between the parent and NewCo (spec §7.5; P0 review D-16). */
export const intercompanyReconciliation = pgTable(
  'intercompany_reconciliation',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    counterpartyLabel: text('counterparty_label').notNull(),
    period: varchar('period', { length: 16 }).notNull(),
    ourBalance: numeric('our_balance', { precision: 20, scale: 4 }).notNull(),
    theirBalance: numeric('their_balance', { precision: 20, scale: 4 }),
    currency: varchar('currency', { length: 3 }).notNull(),
    unitScale: integer('unit_scale').notNull().default(1),
    status: varchar('status', { length: 16 }).notNull().default('open'), // open | reconciled | disputed
    explanation: text('explanation'),
    sourceRef: text('source_ref'),
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
    check('intercompany_reconciliation_scale_chk', sql`${t.unitScale} in (1, 1000, 1000000)`),
  ],
);
