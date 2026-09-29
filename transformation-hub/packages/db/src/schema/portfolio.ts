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
  classification,
  templateKind,
  templateVersionStatus,
  templateMigrationStatus,
  projectStatus,
  entityKind,
  incorporationStatus,
  roleKey,
  verificationStatus,
} from './_common';
import { organization, appUser } from './identity';

export const portfolio = pgTable('portfolio', {
  id: pk(),
  orgId: orgIdCol().references(() => organization.id),
  name: text('name').notNull(),
  description: text('description'),
  isDemo: isDemo(),
  createdAt: createdAt(),
  createdBy: createdBy(),
  updatedAt: updatedAt(),
  version: versionCol(),
});

export const program = pgTable('program', {
  id: pk(),
  orgId: orgIdCol().references(() => organization.id),
  portfolioId: uuid('portfolio_id').notNull().references(() => portfolio.id),
  code: varchar('code', { length: 32 }).notNull(),
  name: text('name').notNull(),
  objective: text('objective'),
  classification: classification('classification').notNull().default('confidential'),
  isDemo: isDemo(),
  createdAt: createdAt(),
  createdBy: createdBy(),
  updatedAt: updatedAt(),
  version: versionCol(),
});

export const projectTemplate = pgTable(
  'project_template',
  {
    id: pk(),
    orgId: orgIdCol().references(() => organization.id),
    key: varchar('key', { length: 64 }).notNull(),
    kind: templateKind('kind').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: createdAt(),
    createdBy: createdBy(),
  },
  (t) => [uniqueIndex('project_template_org_key_uq').on(t.orgId, t.key)],
);

/** Immutable once published. Projects pin a version (spec §5, AT-26). */
export const projectTemplateVersion = pgTable(
  'project_template_version',
  {
    id: pk(),
    orgId: orgIdCol().references(() => organization.id),
    templateId: uuid('template_id').notNull().references(() => projectTemplate.id),
    versionNo: integer('version_no').notNull(),
    status: templateVersionStatus('status').notNull().default('draft'),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    definitionHash: text('definition_hash').notNull(),
    changeSummary: text('change_summary'),
    publishedAt: ts('published_at'),
    publishedBy: uuid('published_by'),
    createdAt: createdAt(),
    createdBy: createdBy(),
  },
  (t) => [uniqueIndex('template_version_uq').on(t.templateId, t.versionNo)],
);

export const project = pgTable(
  'project',
  {
    id: pk(),
    orgId: orgIdCol().references(() => organization.id),
    programId: uuid('program_id').references(() => program.id),
    templateVersionId: uuid('template_version_id').notNull().references(() => projectTemplateVersion.id),
    code: varchar('code', { length: 32 }).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    objective: text('objective'),
    status: projectStatus('status').notNull().default('setup'),
    classification: classification('classification').notNull().default('confidential'),
    timezone: text('timezone').notNull().default('Asia/Riyadh'),
    workingDays: jsonb('working_days').$type<number[]>().notNull().default([0, 1, 2, 3, 4]),
    plannedStart: date('planned_start', { mode: 'string' }),
    retentionYears: integer('retention_years'),
    setupState: jsonb('setup_state').$type<Record<string, unknown>>().notNull().default({}),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [uniqueIndex('project_org_code_uq').on(t.orgId, t.code), index('project_program_idx').on(t.programId)],
);

/** Explicit template upgrade proposals (AT-26): preview → approval → apply. Never silent. */
export const projectTemplateMigration = pgTable('project_template_migration', {
  id: pk(),
  orgId: orgIdCol(),
  projectId: projectIdCol().references(() => project.id),
  fromVersionId: uuid('from_version_id').notNull().references(() => projectTemplateVersion.id),
  toVersionId: uuid('to_version_id').notNull().references(() => projectTemplateVersion.id),
  preview: jsonb('preview').$type<Record<string, unknown>>().notNull(),
  status: templateMigrationStatus('status').notNull().default('proposed'),
  proposedBy: uuid('proposed_by'),
  decidedBy: uuid('decided_by'),
  decidedAt: ts('decided_at'),
  appliedAt: ts('applied_at'),
  createdAt: createdAt(),
  version: versionCol(),
});

/** Legal entity is separate from project: one entity may participate in many projects (spec §5). */
export const legalEntity = pgTable('legal_entity', {
  id: pk(),
  orgId: orgIdCol().references(() => organization.id),
  name: text('name').notNull(),
  kind: entityKind('kind').notNull(),
  registrationRef: text('registration_ref'),
  incorporationStatus: incorporationStatus('incorporation_status').notNull().default('unconfirmed'),
  incorporationVerification: verificationStatus('incorporation_verification').notNull().default('unknown'),
  incorporationEvidenceNote: text('incorporation_evidence_note'),
  jurisdiction: text('jurisdiction'),
  isDemo: isDemo(),
  createdAt: createdAt(),
  createdBy: createdBy(),
  updatedAt: updatedAt(),
  version: versionCol(),
});

export const projectEntity = pgTable(
  'project_entity',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntity.id),
    role: entityKind('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('project_entity_pid_uq').on(t.projectId, t.id), uniqueIndex('project_entity_uq').on(t.projectId, t.legalEntityId, t.role)],
);

export const site = pgTable(
  'site',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    name: text('name').notNull(),
    city: text('city'),
    kind: varchar('kind', { length: 32 }).notNull().default('data_center'),
    notes: text('notes'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [unique('site_pid_uq').on(t.projectId, t.id), uniqueIndex('site_code_uq').on(t.projectId, t.code)],
);

export const workstream = pgTable(
  'workstream',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 16 }).notNull(),
    templateKey: varchar('template_key', { length: 32 }),
    name: text('name').notNull(),
    nameAr: text('name_ar'),
    objective: text('objective'),
    scope: text('scope'),
    leadUserId: uuid('lead_user_id').references(() => appUser.id),
    proposedLeadFunction: text('proposed_lead_function'),
    raci: jsonb('raci').$type<{ function: string; raci: string }[]>().notNull().default([]),
    linkedGateKeys: jsonb('linked_gate_keys').$type<string[]>().notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(0),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [unique('workstream_pid_uq').on(t.projectId, t.id), uniqueIndex('workstream_code_uq').on(t.projectId, t.code)],
);

/** Project-, workstream- (and via room_grant, partner-room-) scoped role assignment. */
export const projectMembership = pgTable(
  'project_membership',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    userId: uuid('user_id').notNull().references(() => appUser.id),
    role: roleKey('role').notNull(),
    workstreamId: uuid('workstream_id'),
    grantedBy: uuid('granted_by'),
    reason: text('reason'),
    validFrom: ts('valid_from').notNull().defaultNow(),
    validTo: ts('valid_to'),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('project_membership_pid_uq').on(t.projectId, t.id),
    projectFk('project_membership_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    index('project_membership_user_idx').on(t.userId),
  ],
);

export const calendarHoliday = pgTable(
  'calendar_holiday',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    date: date('date', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
    isProposed: boolean('is_proposed').notNull().default(true),
    createdAt: createdAt(),
    createdBy: createdBy(),
  },
  (t) => [uniqueIndex('calendar_holiday_uq').on(t.projectId, t.date)],
);
