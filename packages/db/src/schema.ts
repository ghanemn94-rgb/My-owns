// Kysely `Database` interface for the P1 tables (ADR-0003), written by hand from
// docs/architecture/data-dictionary.md. An integration test (packages/db/test/integration/schema.test.ts)
// compares every table and column here with information_schema after the migrations run, so a drift fails CI.
//
// Type mapping (node-postgres defaults): timestamptz -> Date, bigint -> string, numeric -> string,
// bytea -> Buffer, jsonb -> parsed JSON, text[] -> string[].
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

/** A timestamptz column with a database default. */
type TimestampDefault = ColumnType<Date, Date | string | undefined, Date | string>;
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
/** GENERATED ALWAYS AS IDENTITY bigint: never inserted or updated by the application. */
type IdentityBigint = ColumnType<string, never, never>;
type Json = ColumnType<unknown, string, string>;
type NullableJson = ColumnType<unknown | null, string | null | undefined, string | null>;

interface Stamps {
  version: Generated<number>;
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
  created_by: string | null;
  updated_by: string | null;
}

export interface SchemaMigrationTable {
  id: number;
  name: string;
  sha256: string;
  applied_at: TimestampDefault;
  applied_by: Generated<string>;
}

export interface OrganizationTable extends Stamps {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  default_timezone: Generated<string>;
  default_currency: Generated<string>;
  default_locale: Generated<string>;
  status: Generated<string>;
}

export interface BusinessUnitTable extends Stamps {
  id: string;
  organization_id: string;
  parent_business_unit_id: string | null;
  code: string;
  name_en: string;
  name_ar: string;
  status: Generated<string>;
}

export interface BusinessUnitClosureView {
  ancestor_id: ColumnType<string, never, never>;
  descendant_id: ColumnType<string, never, never>;
  organization_id: ColumnType<string, never, never>;
  depth: ColumnType<number, never, never>;
}

export interface AppUserTable extends Stamps {
  id: string;
  organization_id: string;
  display_name: string;
  email: string | null;
  preferred_locale: Generated<string>;
  timezone: string | null;
  status: Generated<string>;
  last_login_at: NullableTimestamp;
}

export interface ActorDisplayView {
  user_id: ColumnType<string, never, never>;
  display_name: ColumnType<string, never, never>;
}

export interface UserIdentityTable {
  id: string;
  user_id: string;
  issuer: string;
  subject: string;
  email_at_binding: string | null;
  created_at: TimestampDefault;
  last_login_at: NullableTimestamp;
}

export interface SessionTable {
  id: string;
  token_hash: Buffer;
  user_id: string;
  auth_mode: string;
  idp_issuer: string | null;
  idp_session_id: string | null;
  csrf_token_hash: Buffer;
  created_at: TimestampDefault;
  last_seen_at: TimestampDefault;
  idle_expires_at: Timestamp;
  absolute_expires_at: Timestamp;
  revoked_at: NullableTimestamp;
  user_agent: string | null;
}

export interface OidcLoginStateTable {
  state_hash: Buffer;
  code_verifier: string;
  nonce: string;
  return_to: Generated<string>;
  created_at: TimestampDefault;
  expires_at: Timestamp;
}

export interface RoleTable extends Stamps {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  kind: string;
  inherits_downward: Generated<boolean>;
  is_system: Generated<boolean>;
}

export interface PermissionTable {
  code: string;
  category: string;
  description_en: string;
  description_ar: string;
}

export interface RolePermissionTable {
  role_id: string;
  permission_code: string;
  created_at: TimestampDefault;
}

export interface ScopedAssignmentTable extends Stamps {
  id: string;
  organization_id: string;
  user_id: string;
  role_id: string;
  scope_type: string;
  scope_id: string;
  effective_from: TimestampDefault;
  effective_to: NullableTimestamp;
  reason: string;
  granted_by: string;
  revoked_at: NullableTimestamp;
  revoked_by: string | null;
  revoke_reason: string | null;
}

export interface DelegationTable extends Stamps {
  id: string;
  organization_id: string;
  delegator_user_id: string;
  delegate_user_id: string;
  scope_type: string | null;
  scope_id: string | null;
  record_types: string[] | null;
  reason_code: string;
  reason_text: string | null;
  effective_from: Timestamp;
  effective_to: Timestamp;
  status: Generated<string>;
}

export interface TransformationTable {
  id: string;
  organization_id: string;
  business_unit_id: string;
  code: string;
  name: string;
  description: string | null;
  mode: string;
  entry_phase: string | null;
  standalone_deliverable_type: string | null;
  status: Generated<string>;
  current_phase: string;
  sponsor_user_id: string | null;
  lead_user_id: string | null;
  timezone: string;
  currency: string;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface ScopeNodeView {
  scope_type: ColumnType<string, never, never>;
  scope_id: ColumnType<string, never, never>;
  organization_id: ColumnType<string, never, never>;
  business_unit_id: ColumnType<string | null, never, never>;
  transformation_id: ColumnType<string | null, never, never>;
}

export interface AuditEventTable {
  id: string;
  seq: IdentityBigint;
  occurred_at: TimestampDefault;
  organization_id: string | null;
  transformation_id: string | null;
  actor_type: string;
  actor_user_id: string | null;
  on_behalf_of_user_id: string | null;
  action: string;
  record_type: string;
  record_id: string;
  prior_version: number | null;
  new_version: number | null;
  reason: string | null;
  request_id: string | null;
  source: string;
  changes: NullableJson;
}

export interface OutboxEventTable {
  id: string;
  seq: IdentityBigint;
  organization_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  schema_version: number;
  payload: Json;
  idempotency_key: string;
  created_at: TimestampDefault;
  published_at: NullableTimestamp;
  publish_attempts: Generated<number>;
  last_error: string | null;
}

export interface ProcessedMessageTable {
  consumer: string;
  idempotency_key: string;
  processed_at: TimestampDefault;
  outcome: string;
}

export interface IdempotencyRecordTable {
  user_id: string;
  key: string;
  request_hash: string;
  response_status: number;
  response_body: Json;
  created_at: TimestampDefault;
  expires_at: Timestamp;
}

export interface Database {
  schema_migration: SchemaMigrationTable;
  organization: OrganizationTable;
  business_unit: BusinessUnitTable;
  business_unit_closure: BusinessUnitClosureView;
  app_user: AppUserTable;
  actor_display: ActorDisplayView;
  user_identity: UserIdentityTable;
  session: SessionTable;
  oidc_login_state: OidcLoginStateTable;
  role: RoleTable;
  permission: PermissionTable;
  role_permission: RolePermissionTable;
  scoped_assignment: ScopedAssignmentTable;
  delegation: DelegationTable;
  transformation: TransformationTable;
  scope_node: ScopeNodeView;
  audit_event: AuditEventTable;
  outbox_event: OutboxEventTable;
  processed_message: ProcessedMessageTable;
  idempotency_record: IdempotencyRecordTable;
}

/** Relations that are views (read-only); excluded from the table/column drift test's table list. */
export const VIEW_NAMES = ["actor_display", "business_unit_closure", "scope_node"] as const;

export type OrganizationRow = Selectable<OrganizationTable>;
export type BusinessUnitRow = Selectable<BusinessUnitTable>;
export type AppUserRow = Selectable<AppUserTable>;
export type UserIdentityRow = Selectable<UserIdentityTable>;
export type SessionRow = Selectable<SessionTable>;
export type RoleRow = Selectable<RoleTable>;
export type ScopedAssignmentRow = Selectable<ScopedAssignmentTable>;
export type TransformationRow = Selectable<TransformationTable>;
export type NewTransformation = Insertable<TransformationTable>;
export type TransformationUpdate = Updateable<TransformationTable>;
export type AuditEventRow = Selectable<AuditEventTable>;
export type OutboxEventRow = Selectable<OutboxEventTable>;

/**
 * Runtime column catalogue of `Database`. The compiler forces it to list exactly the interface's columns (both
 * directions, see the assertions below), and the integration test compares it with information_schema, so the
 * hand-written types cannot drift from the migrations unnoticed.
 */
export const SCHEMA_COLUMNS = {
  schema_migration: ["id", "name", "sha256", "applied_at", "applied_by"],
  organization: [
    "id",
    "code",
    "name_en",
    "name_ar",
    "default_timezone",
    "default_currency",
    "default_locale",
    "status",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  business_unit: [
    "id",
    "organization_id",
    "parent_business_unit_id",
    "code",
    "name_en",
    "name_ar",
    "status",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  business_unit_closure: ["ancestor_id", "descendant_id", "organization_id", "depth"],
  app_user: [
    "id",
    "organization_id",
    "display_name",
    "email",
    "preferred_locale",
    "timezone",
    "status",
    "last_login_at",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  actor_display: ["user_id", "display_name"],
  user_identity: ["id", "user_id", "issuer", "subject", "email_at_binding", "created_at", "last_login_at"],
  session: [
    "id",
    "token_hash",
    "user_id",
    "auth_mode",
    "idp_issuer",
    "idp_session_id",
    "csrf_token_hash",
    "created_at",
    "last_seen_at",
    "idle_expires_at",
    "absolute_expires_at",
    "revoked_at",
    "user_agent",
  ],
  oidc_login_state: ["state_hash", "code_verifier", "nonce", "return_to", "created_at", "expires_at"],
  role: [
    "id",
    "code",
    "name_en",
    "name_ar",
    "kind",
    "inherits_downward",
    "is_system",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  permission: ["code", "category", "description_en", "description_ar"],
  role_permission: ["role_id", "permission_code", "created_at"],
  scoped_assignment: [
    "id",
    "organization_id",
    "user_id",
    "role_id",
    "scope_type",
    "scope_id",
    "effective_from",
    "effective_to",
    "reason",
    "granted_by",
    "revoked_at",
    "revoked_by",
    "revoke_reason",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  delegation: [
    "id",
    "organization_id",
    "delegator_user_id",
    "delegate_user_id",
    "scope_type",
    "scope_id",
    "record_types",
    "reason_code",
    "reason_text",
    "effective_from",
    "effective_to",
    "status",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  transformation: [
    "id",
    "organization_id",
    "business_unit_id",
    "code",
    "name",
    "description",
    "mode",
    "entry_phase",
    "standalone_deliverable_type",
    "status",
    "current_phase",
    "sponsor_user_id",
    "lead_user_id",
    "timezone",
    "currency",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  scope_node: ["scope_type", "scope_id", "organization_id", "business_unit_id", "transformation_id"],
  audit_event: [
    "id",
    "seq",
    "occurred_at",
    "organization_id",
    "transformation_id",
    "actor_type",
    "actor_user_id",
    "on_behalf_of_user_id",
    "action",
    "record_type",
    "record_id",
    "prior_version",
    "new_version",
    "reason",
    "request_id",
    "source",
    "changes",
  ],
  outbox_event: [
    "id",
    "seq",
    "organization_id",
    "aggregate_type",
    "aggregate_id",
    "event_type",
    "schema_version",
    "payload",
    "idempotency_key",
    "created_at",
    "published_at",
    "publish_attempts",
    "last_error",
  ],
  processed_message: ["consumer", "idempotency_key", "processed_at", "outcome"],
  idempotency_record: [
    "user_id",
    "key",
    "request_hash",
    "response_status",
    "response_body",
    "created_at",
    "expires_at",
  ],
} as const satisfies { readonly [T in keyof Database]: readonly (keyof Database[T] & string)[] };

// Compile-time completeness: every interface column is listed (the `satisfies` above covers the other direction).
type Unlisted = {
  [T in keyof Database]: Exclude<keyof Database[T], (typeof SCHEMA_COLUMNS)[T][number]>;
}[keyof Database];
const _everyColumnListed: [Unlisted] extends [never] ? true : Unlisted = true;
void _everyColumnListed;
