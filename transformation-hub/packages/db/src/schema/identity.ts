import { pgTable, uuid, text, boolean, jsonb, varchar, index, uniqueIndex, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pk, orgIdCol, createdAt, updatedAt, ts, isDemo, classification, roleKey, scopeType, versionCol } from './_common';

/** Organization (tenant). Most deployments have one; the model supports several. */
export const organization = pgTable('organization', {
  id: pk(),
  name: text('name').notNull(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  defaultTimezone: text('default_timezone').notNull().default('Asia/Riyadh'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Application user. Authentication happens at the IdP (OIDC) — no passwords are stored here. */
export const appUser = pgTable(
  'app_user',
  {
    id: pk(),
    orgId: orgIdCol().references(() => organization.id),
    email: text('email').notNull(), // stored lower-case
    displayName: text('display_name').notNull(),
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    title: text('title'), // functional title, e.g. "Finance — To be confirmed"
    clearance: classification('clearance').notNull().default('internal'),
    isActive: boolean('is_active').notNull().default(true),
    isServiceAccount: boolean('is_service_account').notNull().default(false),
    isDemo: isDemo(),
    oidcIssuer: text('oidc_issuer'),
    oidcSubject: text('oidc_subject'),
    lastLoginAt: ts('last_login_at'),
    deactivatedAt: ts('deactivated_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    uniqueIndex('app_user_org_email_uq').on(t.orgId, t.email),
    uniqueIndex('app_user_oidc_uq').on(t.oidcIssuer, t.oidcSubject).where(sql`${t.oidcSubject} is not null`),
  ],
);

/** Server-side session. The cookie carries a random token; only its SHA-256 is stored. */
export const session = pgTable(
  'session',
  {
    id: pk(),
    tokenHash: text('token_hash').notNull().unique(),
    csrfHash: text('csrf_hash').notNull(),
    userId: uuid('user_id').notNull().references(() => appUser.id),
    orgId: orgIdCol().references(() => organization.id),
    authMethod: varchar('auth_method', { length: 16 }).notNull(), // 'oidc' | 'dev'
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    idleExpiresAt: ts('idle_expires_at').notNull(),
    absoluteExpiresAt: ts('absolute_expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
    ip: varchar('ip', { length: 64 }),
    userAgent: text('user_agent'),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

/**
 * Role assignment at organization / portfolio / (program) scope. Project, workstream and partner-room scoped
 * roles live in project_membership / room_grant so they are covered by project RLS.
 */
export const orgRoleAssignment = pgTable(
  'org_role_assignment',
  {
    id: pk(),
    orgId: orgIdCol().references(() => organization.id),
    userId: uuid('user_id').notNull().references(() => appUser.id),
    role: roleKey('role').notNull(),
    scopeType: scopeType('scope_type').notNull(), // organization | portfolio
    scopeId: uuid('scope_id'), // portfolio id when scope_type = portfolio
    grantedBy: uuid('granted_by'),
    reason: text('reason'),
    validFrom: ts('valid_from').notNull().defaultNow(),
    validTo: ts('valid_to'),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by'),
    createdAt: createdAt(),
  },
  (t) => [index('org_role_user_idx').on(t.userId)],
);

/** Versioned record of the role→permission policy in force (the matrix itself is code-defined). */
export const rolePolicy = pgTable('role_policy', {
  id: pk(),
  orgId: orgIdCol().references(() => organization.id),
  policyVersion: text('policy_version').notNull(),
  matrix: jsonb('matrix').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 16 }).notNull().default('active'),
  approvedBy: uuid('approved_by'),
  approvedAt: ts('approved_at'),
  notes: text('notes'),
  createdAt: createdAt(),
  revision: integer('revision').notNull().default(1),
});
