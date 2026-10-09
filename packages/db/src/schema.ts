// Kysely `Database` interface for the P1, P2, P3 and P4 tables (ADR-0003, ADR-0016, ADR-0021..0028), written from
// docs/architecture/data-dictionary.md (P2 tables: migrations 0010-0018; 0019+ by backend-workflow-engineer; P3: 0020-0024). An integration test (packages/db/test/integration/catalogue.test.ts)
// compares every table, view and column here with information_schema after the migrations run, so a drift fails CI.
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
/** A NOT NULL jsonb column with a database default (e.g. '[]'). */
type JsonDefault = ColumnType<unknown, string | undefined, string>;

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
  /** SHA-256 of the browser-binding cookie set by GET /auth/login (migration 0007, F-DG1-103). */
  browser_binding_hash: Buffer;
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
  /** Source grant of a derived creator assignment (migration 0008, F-DG1-106); null for direct grants. */
  derived_from_assignment_id: Generated<string | null>;
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
  /** P4 (0029, ADR-0026 §3). */
  absence_note: string | null;
  requested_by_user_id: string | null;
  revoked_at: NullableTimestamp;
  revoked_by: string | null;
  revoke_reason: string | null;
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

// ---- P2 (migrations 0010-0018; T-DG2-ARCH-01/01B). `date` columns are "YYYY-MM-DD" strings (pool.ts), numeric is a
// decimal string (never a JS number: ADR-0003/ADR-0019).

export interface MethodologyVersionTable {
  id: string;
  key: string;
  version_no: number;
  status: Generated<string>;
  title_en: string;
  title_ar: string;
  source_document: string;
  source_sha256: string | null;
  definition: Json;
  content_sha256: string;
  published_at: NullableTimestamp;
  published_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface TransformationConfigPinTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kind: string;
  methodology_version_id: string;
  pinned_at: TimestampDefault;
  pinned_by: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface DiagnosticDimensionTable {
  id: string;
  code: string;
  methodology_version_id: string;
  ordinal: number;
  source_label: string;
  label_en: string;
  label_ar: string;
  evidence_hint_en: string;
  evidence_hint_ar: string;
  impact_hint_en: string;
  impact_hint_ar: string;
  is_source_seeded: Generated<boolean>;
  status: Generated<string>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface DiagnosticWorkstreamTable {
  id: string;
  code: string;
  methodology_version_id: string;
  ordinal: number;
  source_name_en: string;
  name_ar: string;
  source_key_questions_en: string;
  key_questions_ar: string;
  source_typical_outputs_en: string;
  typical_outputs_ar: string;
  source_ref: string;
  status: Generated<string>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface TomDimensionTable {
  id: string;
  code: string;
  methodology_version_id: string;
  ordinal: number;
  source_name_en: string;
  source_design_question_en: string;
  source_canvas_box_en: string;
  source_canvas_prompt_en: string;
  label_en: string;
  label_ar: string;
  design_question_ar: string;
  canvas_box_ar: string;
  canvas_prompt_ar: string;
  source_ref: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface GateDefinitionTable {
  id: string;
  code: string;
  methodology_version_id: string;
  ordinal: number;
  phase: string;
  next_phase: string | null;
  source_name_en: string;
  name_ar: string;
  source_decision_question_en: string;
  decision_question_ar: string;
  source_evidence_required_en: string;
  evidence_required_ar: string;
  default_approver_role_code: string;
  allowed_approver_role_codes: string[];
  submission_enabled: Generated<boolean>;
  source_ref: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface GateCriterionDefinitionTable {
  id: string;
  gate_definition_id: string;
  key: string;
  ordinal: number;
  label_en: string;
  label_ar: string;
  description_en: string;
  description_ar: string;
  mandatory: Generated<boolean>;
  requires_verified_evidence: Generated<boolean>;
  source_ref: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface CharterScopeCheckDefinitionTable {
  id: string;
  code: string;
  methodology_version_id: string;
  ordinal: number;
  source_question_en: string;
  question_ar: string;
  source_ref: string;
  system_precheck: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface GoodOutcomeCriterionTable {
  id: string;
  code: string;
  methodology_version_id: string;
  ordinal: number;
  source_label_en: string;
  label_ar: string;
  evaluation: string;
  source_ref: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface EvidenceTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kind: string;
  title: string;
  description: string | null;
  evidence_type: Generated<string>;
  source: string | null;
  owner_user_id: string;
  observation_start: string | null;
  observation_end: string | null;
  note_body: string | null;
  url: string | null;
  file_name: string | null;
  current_content_id: string | null;
  review_status: Generated<string>;
  accessibility_status: Generated<string>;
  reviewed_content_id: string | null;
  reviewed_by: string | null;
  reviewed_at: NullableTimestamp;
  review_note: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
  /** 0019 (F-DG2-140): who supplied the current content; maintained by the evidence_review_separation trigger. */
  content_authored_by: Generated<string | null>;
}

export interface EvidenceContentTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  evidence_id: string;
  revision: number;
  storage_key: string;
  sha256: string;
  size_bytes: string;
  content_type: string;
  file_name: string;
  uploaded_by: string;
  uploaded_at: TimestampDefault;
}

export interface EvidenceLinkTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  evidence_id: string;
  record_type: string;
  record_id: string;
  status: Generated<string>;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  remove_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface NorthStarTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  statement: string;
  status: Generated<string>;
  superseded_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface StrategicGuardrailTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  title: string;
  category: string;
  statement: string;
  owner_user_id: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface OutcomeTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  parent_outcome_id: string | null;
  statement: string;
  description: string | null;
  owner_user_id: string | null;
  is_top_outcome: Generated<boolean>;
  top_rank: number | null;
  specific_confirmed: boolean | null;
  strategically_relevant_confirmed: boolean | null;
  causal_chain: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface CharterTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  transformation_name: string | null;
  executive_sponsor_user_id: string | null;
  transformation_lead_user_id: string | null;
  case_for_change: string | null;
  north_star_id: string | null;
  in_scope: string | null;
  out_of_scope: string | null;
  baseline_date: string | null;
  target_horizon_value: number | null;
  target_horizon_unit: string | null;
  governance_forum: string | null;
  decision_rights: string | null;
  success_definition: string | null;
  thesis_change: string | null;
  thesis_outcomes: string | null;
  thesis_benefits: string | null;
  thesis_because: string | null;
  sc_outcome_linkage: string | null;
  sc_outcome_linkage_evidence: string | null;
  sc_problem_traceability: string | null;
  sc_problem_traceability_evidence: string | null;
  sc_exclusions_documented: string | null;
  sc_exclusions_documented_evidence: string | null;
  sc_baseline_measurable: string | null;
  sc_baseline_measurable_evidence: string | null;
  sc_executive_decisions_visible: string | null;
  sc_executive_decisions_visible_evidence: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface CharterVersionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  charter_id: string;
  version_no: number;
  transformation_name: string | null;
  executive_sponsor_user_id: string | null;
  transformation_lead_user_id: string | null;
  case_for_change: string | null;
  north_star_id: string | null;
  in_scope: string | null;
  out_of_scope: string | null;
  baseline_date: string | null;
  target_horizon_value: number | null;
  target_horizon_unit: string | null;
  governance_forum: string | null;
  decision_rights: string | null;
  success_definition: string | null;
  thesis_change: string | null;
  thesis_outcomes: string | null;
  thesis_benefits: string | null;
  thesis_because: string | null;
  sc_outcome_linkage: string | null;
  sc_outcome_linkage_evidence: string | null;
  sc_problem_traceability: string | null;
  sc_problem_traceability_evidence: string | null;
  sc_exclusions_documented: string | null;
  sc_exclusions_documented_evidence: string | null;
  sc_baseline_measurable: string | null;
  sc_baseline_measurable_evidence: string | null;
  sc_executive_decisions_visible: string | null;
  sc_executive_decisions_visible_evidence: string | null;
  north_star_statement: string | null;
  top_outcomes_snapshot: JsonDefault;
  guardrails_snapshot: JsonDefault;
  change_summary: string | null;
  saved_by: string;
  saved_at: TimestampDefault;
}

export interface KpiDefinitionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  name: string;
  description: string | null;
  business_purpose: string | null;
  unit_kind: string;
  unit_label: string | null;
  currency: string | null;
  polarity: string;
  frequency: Generated<string>;
  is_leading: Generated<boolean>;
  data_source: string | null;
  owner_user_id: string | null;
  steward_user_id: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BaselineTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  metric: string;
  kpi_definition_id: string | null;
  value: string | null;
  unit: string;
  currency: string | null;
  source: string | null;
  baseline_date: string | null;
  scope: string;
  owner_user_id: string | null;
  validation_status: Generated<string>;
  validated_by: string | null;
  validated_at: NullableTimestamp;
  validation_note: string | null;
  validated_record_version: number | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface OutcomeKpiTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  outcome_id: string;
  kpi_definition_id: string;
  baseline_id: string | null;
  baseline_value: string | null;
  target_value: string | null;
  target_date: string;
  owner_user_id: string | null;
  leading_indicator_text: string | null;
  leading_kpi_definition_id: string | null;
  ordinal: Generated<number>;
  trajectory_points: JsonDefault;
  trajectory_status: Generated<string>;
  trajectory_approved_by: string | null;
  trajectory_approved_at: NullableTimestamp;
  trajectory_approved_version: number | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface ValuePoolTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  name: string;
  driver: string | null;
  workstream_code: string | null;
  quantification_status: Generated<string>;
  upside_amount: string | null;
  downside_amount: string | null;
  currency: string;
  unquantified_reason: string | null;
  materiality: Generated<string>;
  confidence: string | null;
  owner_user_id: string | null;
  validation_status: Generated<string>;
  validated_by: string | null;
  validated_at: NullableTimestamp;
  validation_note: string | null;
  validated_record_version: number | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface DiagnosticItemTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  dimension_code: string;
  is_seeded: Generated<boolean>;
  current_state: string | null;
  evidence_baseline: string | null;
  baseline_id: string | null;
  root_cause: string | null;
  impact_text: string | null;
  impact_amount: string | null;
  impact_currency: string | null;
  impact_kpi_definition_id: string | null;
  confidence: string | null;
  owner_user_id: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface DiagnosticFindingTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  workstream_code: string;
  diagnostic_item_id: string | null;
  kind: string;
  statement: string;
  detail: string | null;
  confidence: string | null;
  owner_user_id: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface DiagnosticWorkstreamOutputTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  workstream_code: string;
  title: string;
  output_kind: string | null;
  record_type: string | null;
  record_id: string | null;
  evidence_id: string | null;
  note: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface TomCanvasCellTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  dimension_code: string;
  current_design: string | null;
  target_design: string | null;
  owner_user_id: string | null;
  status: Generated<string>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface TomGapTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  dimension_code: string;
  current_state: string | null;
  target_state: string | null;
  gap: string | null;
  design_decision_id: string | null;
  owner_user_id: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface CapabilityTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  name: string;
  description: string | null;
  dimension_code: string | null;
  current_level: number | null;
  target_level: number | null;
  sourcing_need: string | null;
  owner_user_id: string | null;
  tom_gap_id: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface JourneyTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  name: string;
  kind: string;
  state: string;
  description: string | null;
  dimension_code: string | null;
  steps: JsonDefault;
  cycle_time_value: string | null;
  cycle_time_unit: string | null;
  failure_demand: string | null;
  owner_user_id: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface JourneyPainPointTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  journey_id: string;
  step_key: string | null;
  description: string;
  diagnostic_item_id: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface DecisionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kind: string;
  code: string;
  title: string;
  context: string | null;
  owner_user_id: string | null;
  due_date: string | null;
  status: Generated<string>;
  recommendation_option_id: string | null;
  recommendation_text: string | null;
  chosen_option_id: string | null;
  outcome_text: string | null;
  decided_by: string | null;
  decided_at: NullableTimestamp;
  tom_dimension_code: string | null;
  source_workshop_item_id: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
  // 0045 (slice D, T16; ADR-0032 §5): NULL on every pre-P4 row.
  why_now: string | null;
  impact_of_delay: string | null;
  ask_origin: string | null;
  created_source: string | null;
  source_agenda_item_id: string | null;
  decision_right_id: string | null;
  sla_due_date: string | null;
  sla_unknown_reason: string | null;
  decided_on_behalf_of_user_id: string | null;
  blocker_record_type: string | null;
  blocker_record_id: string | null;
}

export interface DecisionOptionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  decision_id: string;
  label: string;
  title: string;
  description: string | null;
  ordinal: number;
  status: Generated<string>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface RecordCodeCounterTable {
  transformation_id: string;
  prefix: string;
  last_value: number;
}

export interface TomWorkshopTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  title: string;
  workshop_date: string;
  duration_minutes: number;
  agenda: string | null;
  facilitator_user_id: string;
  status: Generated<string>;
  closed_at: NullableTimestamp;
  closed_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface TomWorkshopParticipantTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  workshop_id: string;
  user_id: string;
  is_business_owner: Generated<boolean>;
  status: Generated<string>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface TomWorkshopItemTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  workshop_id: string;
  dimension_code: string | null;
  kind: string;
  body: string;
  owner_user_id: string | null;
  status: string;
  converted_decision_id: string | null;
  converted_action_id: string | null;
  converted_at: NullableTimestamp;
  converted_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface ActionItemTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  title: string;
  description: string | null;
  owner_user_id: string;
  due_date: string | null;
  status: Generated<string>;
  source_workshop_item_id: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
  /** P4 (0041, ADR-0031 §6): at most one source link (with source_workshop_item_id) and a follow-up date. */
  raid_entry_id: string | null;
  dependency_id: string | null;
  corrective_case_id: string | null;
  follow_up_date: string | null;
}

export interface DependencyTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  description: string;
  from_kind: string;
  from_label: string | null;
  to_kind: string;
  to_label: string | null;
  dependency_type: string;
  needed_by: string | null;
  owner_user_id: string | null;
  status: Generated<string>;
  mitigation: string | null;
  tom_dimension_code: string | null;
  decision_id: string | null;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
  /** P3 (0022): initiative endpoints of a T08 dependency. */
  from_initiative_id: string | null;
  to_initiative_id: string | null;
  /** P4 (0041, ADR-0031 §2): the T15 Impact of the RAID Dependency entry (NULL = Unknown). */
  impact: string | null;
}

export interface GateInstanceTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  gate_code: string;
  status: Generated<string>;
  approver_role_code: string;
  approver_user_id: string | null;
  current_submission_id: string | null;
  latest_submission_no: Generated<number>;
  approved_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface GateSubmissionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  gate_instance_id: string;
  gate_code: string;
  submission_no: number;
  status: Generated<string>;
  submitted_by: string;
  submitted_at: TimestampDefault;
  submission_note: string | null;
  approver_role_code: string;
  approver_user_id: string | null;
  due_date: string | null;
  charter_id: string | null;
  charter_version_no: number | null;
  snapshot: Json;
  snapshot_sha256: string;
  superseded_at: NullableTimestamp;
  superseded_by_submission_id: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface GateSubmissionCriterionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  gate_submission_id: string;
  criterion_key: string;
  ordinal: number;
  mandatory: boolean;
  completeness: string;
  detail: JsonDefault;
  evaluated_at: TimestampDefault;
  /** 0051 (D-089 Q2): the accepted gate exception that covers this incomplete mandatory criterion; NULL otherwise. */
  gate_exception_id: string | null;
}

export interface GateDecisionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  gate_submission_id: string;
  decision_id: string;
  decision_kind: Generated<string>;
  gate_code: string;
  submission_no: number;
  outcome: string;
  rationale: string;
  comments: string | null;
  decided_by: string;
  on_behalf_of_user_id: string | null;
  decided_at: TimestampDefault;
  approver_basis: string;
  approver_role_code: string;
}

export interface RoleAccountabilityTable {
  role_id: string;
  accountability_en: string;
  accountability_ar: string;
  is_source_text: boolean;
  source_ref: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// P3 (migrations 0020-0024; ADR-0021..0024; 0025_p3_g1_agreement_guard adds a deferred trigger only - no relation or
// column, T-DG3-BE-A). Generated from the migrated catalogue by solution-architect (T-DG3-ARCH-01)
// and checked by packages/db/test/integration/catalogue.test.ts like every other table.

export interface RoadmapWaveTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  ordinal: number;
  is_source_seeded: Generated<boolean>;
  source_ref: string | null;
  name_en: string;
  name_ar: string;
  purpose_en: string;
  purpose_ar: string;
  horizon_en: string;
  horizon_ar: string;
  entry_criteria_en: string;
  entry_criteria_ar: string;
  exit_evidence_en: string;
  exit_evidence_ar: string;
  horizon_from_weeks: number;
  horizon_to_weeks: number;
  planned_start: string | null;
  planned_end: string | null;
  owner_user_id: string | null;
  notes: string | null;
  status: Generated<string>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface InitiativeTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  name: string;
  executive_owner_user_id: string | null;
  workstream_lead_user_id: string | null;
  problem_statement: string | null;
  objective: string | null;
  scope_in: string | null;
  scope_out: string | null;
  financial_benefit_summary: string | null;
  customer_benefit_summary: string | null;
  risks_summary: string | null;
  wave_id: string | null;
  planned_start: string | null;
  planned_end: string | null;
  status: Generated<string>;
  launched_at: NullableTimestamp;
  launched_by: string | null;
  cancelled_at: NullableTimestamp;
  cancelled_by: string | null;
  cancel_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
  // 0048 (slices F/G; ADR-0034 §1): delivery completion stamps and the business adoption status.
  delivery_completed_at: NullableTimestamp;
  delivery_completed_by: string | null;
  adoption_status: Generated<string>;
  adoption_status_note: string | null;
  adoption_status_set_at: NullableTimestamp;
  adoption_status_set_by: string | null;
}

export interface InitiativeGapLinkTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  target_type: string;
  tom_gap_id: string | null;
  diagnostic_finding_id: string | null;
  note: string | null;
  status: Generated<string>;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  remove_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface InitiativeOutcomeContributionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  outcome_id: string;
  outcome_kpi_id: string | null;
  contribution_statement: string;
  expected_kpi_movement: string | null;
  status: Generated<string>;
  /** 0055 (ADR-0038 §2): share of the KPI movement credited to this contribution (0 < share <= 1); NULL = none. */
  allocation_share: string | null;
  allocation_basis: string | null;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  remove_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface InitiativeDecisionLinkTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  decision_id: string;
  status: Generated<string>;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  remove_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface DeliverableTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  ordinal: Generated<number>;
  title: string;
  description: string | null;
  owner_user_id: string | null;
  due_date: string | null;
  acceptance_status: Generated<string>;
  submitted_by: string | null;
  submitted_at: NullableTimestamp;
  decided_by: string | null;
  decided_at: NullableTimestamp;
  acceptance_note: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface MilestoneTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  wave_id: string | null;
  title: string;
  description: string | null;
  owner_user_id: string | null;
  approved_date: string | null;
  approved_by: string | null;
  approved_at: NullableTimestamp;
  approval_reason: string | null;
  forecast_date: string | null;
  actual_date: string | null;
  status: Generated<string>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface GateDispensationTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kind: string;
  gate_code: string;
  initiative_id: string | null;
  reason: string | null;
  approving_body: string | null;
  approved_on: string | null;
  evidence_id: string | null;
  expires_on: string | null;
  status: Generated<string>;
  recorded_by: string;
  decided_by: string | null;
  decided_at: NullableTimestamp;
  decision_note: string | null;
  revoked_by: string | null;
  revoked_at: NullableTimestamp;
  revoke_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface ScoringWeightSetTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  version_no: number;
  status: Generated<string>;
  approval_basis: string | null;
  rationale: string | null;
  approved_by: string | null;
  approved_at: NullableTimestamp;
  activated_at: NullableTimestamp;
  superseded_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface ScoringWeightTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  weight_set_id: string;
  criterion_code: string;
  weight_percent: string;
  created_at: TimestampDefault;
  created_by: string;
}

export interface InitiativeScoreTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  criterion_code: string;
  score: number | null;
  note: string | null;
  scored_by: string | null;
  scored_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface InitiativeScoreResultTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  weight_set_id: string;
  weight_set_version_no: number;
  weighted_score: string | null;
  completeness: string;
  missing_criteria: Generated<string[]>;
  inputs: Json;
  cause: string;
  computed_at: TimestampDefault;
  computed_by: string;
}

export interface RankingSnapshotTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  snapshot_no: number;
  weight_set_id: string;
  status: Generated<string>;
  note: string | null;
  proposed_by: string;
  proposed_at: TimestampDefault;
  superseded_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface RankingOverrideTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  override_rank: number;
  reason: string;
  status: Generated<string>;
  proposed_by: string;
  decided_by: string | null;
  decided_at: NullableTimestamp;
  decision_note: string | null;
  revoked_by: string | null;
  revoked_at: NullableTimestamp;
  revoke_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface RankingEntryTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  snapshot_id: string;
  initiative_id: string;
  rank: number | null;
  weighted_score: string | null;
  completeness: string;
  score_result_id: string | null;
  previous_rank: number | null;
  causes: Generated<string[]>;
  cause_detail: JsonDefault;
  override_id: string | null;
  created_at: TimestampDefault;
  created_by: string;
}

export interface DependencyTypeTable {
  id: string;
  code: string;
  label_en: string;
  label_ar: string;
  is_system: Generated<boolean>;
  source_ref: string | null;
  ordinal: number;
  status: Generated<string>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface ResourceRoleTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  label_en: string;
  label_ar: string;
  status: Generated<string>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface CapacityTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  resource_role_id: string;
  period_month: string;
  available_fte: string;
  owner_user_id: string | null;
  note: string | null;
  status: Generated<string>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface ResourceDemandTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  resource_role_id: string;
  period_month: string;
  demand_fte: string;
  owner_user_id: string | null;
  note: string | null;
  status: Generated<string>;
  committed_by: string | null;
  committed_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface PortfolioSelectionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  action: string;
  rationale: string;
  ranking_snapshot_id: string | null;
  decided_by: string;
  on_behalf_of_user_id: string | null;
  decided_at: TimestampDefault;
}

export interface FundingDecisionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  decision_id: string;
  decision_kind: Generated<string>;
  outcome: string;
  amount: string | null;
  currency: string;
  funding_source: string | null;
  conditions: string | null;
  rationale: string;
  business_case_id: string | null;
  approver_role_code: string;
  decided_by: string;
  on_behalf_of_user_id: string | null;
  decided_at: TimestampDefault;
}

export interface BenefitFormulaTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  benefit_name: string;
  baseline_driver: string | null;
  change_assumption: string | null;
  ramp: string | null;
  confidence: string | null;
  owner_user_id: string | null;
  current_version_no: number | null;
  is_illustrative: Generated<boolean>;
  example_code: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitFormulaVersionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  formula_id: string;
  version_no: number;
  expression: string;
  expression_sha256: string;
  result_kind: string;
  result_unit: string | null;
  result_currency: string | null;
  result_period: string;
  preview_result: string | null;
  engine_version: string;
  change_note: string | null;
  validation_status: Generated<string>;
  validated_by: string | null;
  validated_at: NullableTimestamp;
  validation_note: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitFormulaVariableTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  formula_version_id: string;
  ordinal: number;
  name: string;
  kind: string;
  unit: string | null;
  currency: string | null;
  period: Generated<string>;
  value: string | null;
  description: string | null;
  source: string | null;
  created_at: TimestampDefault;
  created_by: string;
}

export interface BenefitCalculationTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  formula_version_id: string;
  inputs: Json;
  assumptions: string | null;
  period_start: string | null;
  period_end: string | null;
  outcome: string;
  result: string | null;
  result_kind: string;
  result_unit: string | null;
  result_currency: string | null;
  result_period: string;
  error_code: string | null;
  rounded: Generated<boolean>;
  engine_version: string;
  computed_at: TimestampDefault;
  computed_by: string;
  /** Engine rounding record (ADR-0024 §6 item 11; 0027). NULL only for rows written before migration 0027. */
  rounding: NullableJson;
}

export interface BusinessCaseTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  level: string;
  initiative_id: string | null;
  parent_case_id: string | null;
  title: string;
  currency: string;
  strategic_rationale: string | null;
  baseline_summary: string | null;
  value_pools_summary: string | null;
  interventions_summary: string | null;
  investment_summary: string | null;
  benefits_summary: string | null;
  benefit_ramp: string | null;
  recurrence_summary: string | null;
  implementation_horizon: string | null;
  key_assumptions: string | null;
  downside_case: string | null;
  upside_case: string | null;
  benefit_owner_user_id: string | null;
  initiative_owner_user_id: string | null;
  finance_validator_user_id: string | null;
  decision_ask_types: Generated<string[]>;
  decision_ask_text: string | null;
  baseline_validation_status: Generated<string>;
  baseline_validated_by: string | null;
  baseline_validated_at: NullableTimestamp;
  baseline_validation_note: string | null;
  baseline_validated_sha256: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BusinessCaseLineTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  business_case_id: string;
  line_kind: string;
  investment_class: string | null;
  benefit_class: string | null;
  value_basis: string;
  title: string;
  description: string | null;
  amount: string | null;
  currency: string;
  fte: string | null;
  period_start: string | null;
  period_end: string | null;
  recurrence: string | null;
  benefit_formula_id: string | null;
  owner_user_id: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitFormulaExampleTable {
  id: string;
  code: string;
  methodology_version_id: string;
  ordinal: number;
  source_benefit_en: string;
  source_baseline_driver_en: string;
  source_change_assumption_en: string;
  source_formula_en: string;
  source_ramp_en: string;
  source_confidence: string;
  benefit_ar: string;
  baseline_driver_ar: string;
  change_assumption_ar: string;
  formula_ar: string;
  expression: string;
  result_kind: string;
  result_currency: string | null;
  result_period: string;
  example_result: string;
  is_illustrative: Generated<boolean>;
  source_ref: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface BenefitFormulaExampleVariableTable {
  id: string;
  example_id: string;
  ordinal: number;
  name: string;
  kind: string;
  unit: string | null;
  currency: string | null;
  period: string;
  example_value: string;
  label_en: string;
  label_ar: string;
}

export interface GateDecisionAgreementTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  gate_decision_id: string;
  agreement_code: string;
  confirmed_by: string;
  confirmed_at: TimestampDefault;
}

// -----------------------------------------------------------------------------------------------------------------
// P4, slices I and C (T-DG4-ARCH-01; ADR-0025, ADR-0026): migrations 0028-0031.

export interface BusinessCalendarTable extends Stamps {
  id: string;
  organization_id: string;
  code: string;
  name_en: string;
  name_ar: string;
  timezone: Generated<string>;
  workweek: Generated<number[]>;
  is_default: Generated<boolean>;
  status: Generated<string>;
}

export interface BusinessCalendarHolidayTable extends Stamps {
  id: string;
  organization_id: string;
  calendar_id: string;
  date_from: string;
  date_to: string;
  name_en: string;
  name_ar: string;
  status: Generated<string>;
}

export interface JobScheduleTable extends Stamps {
  id: string;
  code: string;
  queue_name: string;
  cron: string;
  timezone: Generated<string>;
  enabled: Generated<boolean>;
  description_en: string;
  description_ar: string;
  owner_module: string;
}

export interface WorkItemKindTable {
  code: string;
  owner_module: string;
  label_en: string;
  label_ar: string;
  source_ref: string;
}

export interface WorkItemTable extends Stamps {
  id: string;
  organization_id: string;
  transformation_id: string | null;
  kind: string;
  assignee_user_id: string;
  subject_type: string;
  subject_id: string;
  link_path: string;
  message_key: string;
  message_params: JsonDefault;
  due_date: string | null;
  period_label: string | null;
  status: Generated<string>;
  completed_at: NullableTimestamp;
  completed_by: string | null;
  dedupe_key: string;
  created_source: string;
}

export interface InboxNotificationTable extends Stamps {
  id: string;
  organization_id: string;
  transformation_id: string | null;
  recipient_user_id: string;
  work_item_id: string | null;
  link_path: string;
  message_key: string;
  message_params: JsonDefault;
  dedupe_key: string;
  read_at: NullableTimestamp;
}

export interface AccessGroupTable extends Stamps {
  id: string;
  organization_id: string;
  code: string;
  name_en: string;
  name_ar: string;
  description: string | null;
  owner_user_id: string;
  status: Generated<string>;
}

export interface AccessGroupMemberTable extends Stamps {
  id: string;
  organization_id: string;
  group_id: string;
  user_id: string;
  effective_from: TimestampDefault;
  effective_to: NullableTimestamp;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  remove_reason: string | null;
}

export interface GovernancePartyTable {
  code: string;
  ordinal: number;
  kind: string;
  role_code: string | null;
  label_en: string;
  label_ar: string;
  source_ref: string;
}

export interface RoleMappingTable extends Stamps {
  id: string;
  organization_id: string;
  transformation_id: string;
  party_code: string;
  target_kind: string;
  user_id: string | null;
  group_id: string | null;
  status: Generated<string>;
  ended_at: NullableTimestamp;
  ended_by: string | null;
  end_reason: string | null;
}

export interface DecisionRightTemplateTable {
  key: string;
  ordinal: number;
  source_decision_en: string;
  source_recommend_en: string;
  source_approve_en: string;
  source_consult_en: string;
  source_inform_en: string;
  source_sla_en: string;
  decision_ar: string;
  recommend_ar: string;
  approve_ar: string;
  consult_ar: string;
  inform_ar: string;
  sla_ar: string;
  recommend_parties: string[];
  approve_party_code: string;
  consult_parties: string[];
  inform_parties: string[];
  sla_type: string;
  sla_working_days: number | null;
  escalation_chain: string[];
  source_ref: string;
}

export interface GovernanceMatrixTable extends Stamps {
  id: string;
  organization_id: string;
  transformation_id: string;
  kind: string;
  status: Generated<string>;
  approved_version: number | null;
  approved_at: NullableTimestamp;
  approved_by: string | null;
}

export interface TransformationDecisionRightTable extends Stamps {
  id: string;
  organization_id: string;
  transformation_id: string;
  template_key: string | null;
  ordinal: number;
  decision_en: string;
  decision_ar: string;
  recommend_label: string;
  approve_label: string;
  consult_label: string;
  inform_label: string;
  sla_label: string;
  recommend_parties: Generated<string[]>;
  approve_party_code: string;
  consult_parties: Generated<string[]>;
  inform_parties: Generated<string[]>;
  sla_type: string;
  sla_working_days: number | null;
  urgent_working_days: number | null;
  escalation_chain: string[];
  status: Generated<string>;
}

export interface RaciTemplateDeliverableTable {
  key: string;
  ordinal: number;
  source_deliverable_en: string;
  deliverable_ar: string;
  source_ref: string;
}

export interface RaciTemplateCellTable {
  deliverable_key: string;
  party_code: string;
  value: string;
}

export interface TransformationRaciDeliverableTable extends Stamps {
  id: string;
  organization_id: string;
  transformation_id: string;
  template_key: string | null;
  ordinal: number;
  label_en: string;
  label_ar: string;
  accountability_exception: string | null;
  status: Generated<string>;
}

export interface TransformationRaciAssignmentTable extends Stamps {
  id: string;
  organization_id: string;
  transformation_id: string;
  deliverable_id: string;
  party_code: string;
  value: string | null;
}

export interface ApprovalTypeTable {
  code: string;
  subject_table: string;
  default_sod_policy: string;
  requires_decision_right: boolean;
  owner_module: string;
  label_en: string;
  label_ar: string;
  source_ref: string;
}

export interface ApprovalTable extends Stamps {
  id: string;
  organization_id: string;
  transformation_id: string;
  approval_type: string;
  subject_type: string;
  subject_id: string;
  subject_version: number;
  round_no: Generated<number>;
  decision_right_id: string | null;
  title: string;
  request_note: string | null;
  requested_by: string;
  requested_at: TimestampDefault;
  request_business_date: string;
  assignee_party_code: string;
  assignee_user_id: string | null;
  assignee_group_id: string | null;
  sla_type: string | null;
  urgent_reason: string | null;
  due_date: string | null;
  due_unknown_reason: string | null;
  calendar_id: string | null;
  calendar_version: number | null;
  sod_policy: string;
  status: Generated<string>;
  escalation_level: Generated<number>;
  escalated_to_party_code: string | null;
  escalated_to_user_id: string | null;
  escalated_to_group_id: string | null;
  decided_by: string | null;
  decided_on_behalf_of: string | null;
  decided_at: NullableTimestamp;
}

export interface ApprovalDecisionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  approval_id: string;
  round_no: number;
  outcome: string;
  rationale: string;
  comments: string | null;
  subject_version: number;
  decided_by: string;
  on_behalf_of_user_id: string | null;
  decided_at: TimestampDefault;
  business_date: string;
  defer_until: string | null;
}

export interface ApprovalEscalationTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  approval_id: string;
  round_no: number;
  due_date: string;
  level: number;
  from_party_code: string;
  to_party_code: string | null;
  to_user_id: string | null;
  to_group_id: string | null;
  routing_error: string | null;
  escalated_at: TimestampDefault;
}

/** Read-only union of business-approval decisions (0031; D-089 Q10). */
export interface ApprovalDecisionRecordView {
  source: ColumnType<string, never, never>;
  record_id: ColumnType<string, never, never>;
  organization_id: ColumnType<string, never, never>;
  transformation_id: ColumnType<string, never, never>;
  approval_kind: ColumnType<string, never, never>;
  subject_type: ColumnType<string, never, never>;
  subject_id: ColumnType<string, never, never>;
  subject_version: ColumnType<number | null, never, never>;
  outcome: ColumnType<string, never, never>;
  rationale: ColumnType<string, never, never>;
  decided_by: ColumnType<string, never, never>;
  on_behalf_of_user_id: ColumnType<string | null, never, never>;
  decided_at: ColumnType<Date, never, never>;
}

// ---- P4 slice A (migrations 0033-0036; T-DG4-ARCH-02; ADR-0027, ADR-0028). Generated from the migrated catalogue by
// docs/delivery/handbacks/DG4/T-DG4-ARCH-02-evidence/gen-schema.ts. numeric -> string (decimal), date -> "YYYY-MM-DD".
export interface ReportingPeriodTable {
  id: string;
  organization_id: string;
  frequency: string;
  period_label: string;
  period_start: string;
  period_end: string;
  length_days: ColumnType<number, never, never>;
  basis: Generated<string>;
  week_count: number | null;
  update_due_date: string | null;
  status: Generated<string>;
  opened_at: NullableTimestamp;
  closed_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface KpiVersionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kpi_definition_id: string;
  version_no: number;
  status: Generated<string>;
  measure_type: string;
  value_nature: string;
  entry_scope_kind: Generated<string>;
  unit_kind: string;
  unit_label: string | null;
  currency: string | null;
  frequency: string;
  numerator_label: string | null;
  denominator_label: string | null;
  calculation_method: Generated<string>;
  calculation_description: string | null;
  formula_expression: string | null;
  formula_engine_version: string | null;
  aggregation_rule: string | null;
  stock_additive_across_scopes: Generated<boolean>;
  ytd_start_month: Generated<number>;
  baseline_id: string | null;
  baseline_value: string | null;
  baseline_date: string | null;
  target_value: string | null;
  target_date: string | null;
  band_lower: string | null;
  band_upper: string | null;
  milestone_due_date: string | null;
  dq_stale_after_days: Generated<number>;
  dq_valid_min: string | null;
  dq_valid_max: string | null;
  dq_evidence_required: Generated<boolean>;
  submission_route: Generated<string>;
  reviewer_party_code: string | null;
  definition_approval: Generated<string>;
  approval_id: string | null;
  change_reason: string | null;
  activated_at: NullableTimestamp;
  activated_by: string | null;
  superseded_at: NullableTimestamp;
  withdrawn_at: NullableTimestamp;
  withdrawn_by: string | null;
  withdraw_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface KpiFormulaInputTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kpi_version_id: string;
  variable_name: string;
  source_kpi_definition_id: string;
  input_basis: Generated<string>;
  created_at: TimestampDefault;
  created_by: string;
}

export interface KpiRagThresholdTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kpi_definition_id: string;
  version_no: number;
  tolerance_mode: string;
  amber_threshold: string;
  red_threshold: string;
  reason: string;
  status: Generated<string>;
  superseded_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface TargetTrajectoryTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kpi_definition_id: string;
  scope_kind: Generated<string>;
  scope_id: string;
  version_no: number;
  basis: Generated<string>;
  interpolation: Generated<string>;
  source: Generated<string>;
  source_outcome_kpi_id: string | null;
  status: Generated<string>;
  approved_by: string | null;
  approved_at: NullableTimestamp;
  approved_record_version: number | null;
  superseded_at: NullableTimestamp;
  withdrawn_at: NullableTimestamp;
  withdraw_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface TargetTrajectoryPointTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  target_trajectory_id: string;
  point_date: string;
  expected_value: string;
  created_at: TimestampDefault;
  created_by: string;
}

export interface KpiActualTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kpi_definition_id: string;
  scope_kind: string;
  scope_id: string;
  reporting_period_id: string;
  period_start: string;
  period_end: string;
  period_label: string;
  current_value_no: Generated<number>;
  accepted_value_no: number | null;
  status: string;
  route: string;
  submitted_by: string | null;
  submitted_at: NullableTimestamp;
  decided_by: string | null;
  decided_at: NullableTimestamp;
  decision_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface KpiActualValueTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kpi_actual_id: string;
  value_no: number;
  kpi_version_id: string;
  value: string | null;
  numerator: string | null;
  denominator: string | null;
  milestone_achieved: boolean | null;
  achieved_on: string | null;
  currency: string | null;
  missing_reason: string | null;
  data_as_of: string;
  comment: string | null;
  entered_at: TimestampDefault;
  entered_by: string;
  business_date: string;
}

export interface KpiActualReviewTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kpi_actual_id: string;
  value_no: number;
  outcome: string;
  reason: string | null;
  decided_by: string;
  on_behalf_of_user_id: string | null;
  decided_at: TimestampDefault;
  business_date: string;
}

export interface KpiActualEvidenceTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kpi_actual_id: string;
  value_no: number;
  evidence_id: string;
  linked_at: TimestampDefault;
  linked_by: string;
}

export interface CalculationRunTable {
  id: string;
  seq: IdentityBigint;
  organization_id: string;
  transformation_id: string;
  trigger_kind: string;
  trigger_record_type: string;
  trigger_record_id: string;
  trigger_slot: number;
  idempotency_key: string;
  status: string;
  error_code: string | null;
  evaluation_count: Generated<number>;
  finding_count: Generated<number>;
  formula_engine_version: string;
  kpi_rules_version: string;
  started_at: Timestamp;
  completed_at: TimestampDefault;
}

export interface KpiEvaluationTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  calculation_run_id: string;
  kpi_definition_id: string;
  kpi_version_id: string;
  scope_kind: string;
  scope_id: string;
  reporting_period_id: string;
  period_label: string;
  value_basis: string;
  value: string | null;
  value_status: string;
  value_reason: string | null;
  value_source: string;
  currency: string | null;
  inputs: JsonDefault;
  rounding: NullableJson;
  expected_value: string | null;
  final_target: string | null;
  variance: string | null;
  variance_ratio: string | null;
  comparison_flag: string | null;
  trend: string;
  previous_period_id: string | null;
  data_as_of: string | null;
  calculated_rag: string;
  deviation: string;
  threshold_id: string | null;
  threshold_source: string;
  target_trajectory_id: string | null;
  explanation_key: string;
  explanation_params: JsonDefault;
  evaluated_at: TimestampDefault;
}

export interface DataQualityFindingTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kpi_definition_id: string;
  scope_kind: string;
  scope_id: string;
  reporting_period_id: string;
  kpi_actual_id: string | null;
  value_no: number | null;
  rule_code: string;
  severity: string;
  detail_params: JsonDefault;
  detected_by_run_id: string;
  detected_at: TimestampDefault;
  status: Generated<string>;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface RagOverrideTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kpi_definition_id: string;
  scope_kind: string;
  scope_id: string;
  reporting_period_id: string;
  override_rag: string;
  calculated_rag: string;
  kpi_evaluation_id: string | null;
  reason: string;
  evidence_id: string;
  expires_at: Timestamp;
  status: Generated<string>;
  revoked_by: string | null;
  revoked_at: NullableTimestamp;
  revoke_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

// P4 slice B (T-DG4-ARCH-03; ADR-0029, ADR-0030; migrations 0037-0039). Generated from a migrated disposable
// database (docs/delivery/handbacks/DG4/T-DG4-ARCH-03-evidence/gen-schema.ts).
export interface BenefitLifecycleStepDefinitionTable {
  code: string;
  ordinal: number;
  step_en: string;
  question_en: string;
  output_en: string;
  step_ar: string;
  question_ar: string;
  output_ar: string;
  ar_is_provisional: Generated<boolean>;
  source_ref: string;
}

export interface BenefitValuationMethodTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  name: string;
  method: string;
  applies_to_type: string;
  kpi_definition_id: string | null;
  unit_value: string | null;
  currency: string;
  status: Generated<string>;
  decided_by: string | null;
  decided_at: NullableTimestamp;
  decision_note: string | null;
  retired_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitGroupTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  title: string;
  description: string | null;
  counted_benefit_id: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  title: string;
  description: string;
  benefit_type: string;
  value_class: string;
  owner_user_id: string;
  finance_validator_user_id: string | null;
  finance_validation_required: Generated<boolean>;
  financial_statement_line: string | null;
  measurement_kpi_definition_id: string | null;
  measurement_kpi_variable: string | null;
  business_case_line_id: string | null;
  benefit_formula_id: string | null;
  baseline_id: string | null;
  baseline_value: string | null;
  baseline_unit: string | null;
  baseline_date: string | null;
  counterfactual: string | null;
  baseline_validation_status: Generated<string>;
  baseline_validated_by: string | null;
  baseline_validated_at: NullableTimestamp;
  baseline_validation_note: string | null;
  driver_key: string | null;
  driver_units: string | null;
  population_key: string | null;
  target_value: string | null;
  target_date: string | null;
  realization_start: string | null;
  realization_end: string | null;
  recurrence: string | null;
  currency: string;
  planned_value: string | null;
  valuation_method_id: string | null;
  measurement_source: string | null;
  confidence: string | null;
  assumptions: string | null;
  parent_benefit_id: string | null;
  benefit_group_id: string | null;
  allocation_set_no: Generated<number>;
  lifecycle_step: Generated<string>;
  recovery_plan: string | null;
  bau_owner_user_id: string | null;
  control_cadence: string | null;
  status_rag: string | null;
  status_rag_note: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitEnablerTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  benefit_id: string;
  initiative_id: string;
  deliverable_id: string | null;
  capability_id: string | null;
  note: string | null;
  status: Generated<string>;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  remove_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitLifecycleEventTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  benefit_id: string;
  from_step: string | null;
  to_step: string;
  benefit_version: number;
  occurred_at: TimestampDefault;
  actor_user_id: string;
}

export interface BenefitAllocationTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  benefit_id: string;
  set_no: number;
  initiative_id: string;
  share: string;
  basis: string | null;
  created_at: TimestampDefault;
  created_by: string;
}

export interface BenefitScenarioTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  business_case_id: string | null;
  kind: string;
  title: string;
  assumptions: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitScenarioValueTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  scenario_id: string;
  benefit_id: string;
  period_start: string;
  period_end: string;
  amount: string | null;
  kpi_value: string | null;
  currency: string;
  note: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitPlanValueTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  benefit_id: string;
  value_kind: string;
  period_start: string;
  period_end: string;
  amount: string | null;
  kpi_value: string | null;
  currency: string;
  note: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitMeasurementTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  benefit_id: string;
  measurement_no: number;
  kind: Generated<string>;
  corrects_measurement_id: string | null;
  source: string;
  calculation_run_id: string | null;
  benefit_calculation_id: string | null;
  formula_version_id: string | null;
  period_start: string | null;
  period_end: string | null;
  amount: string | null;
  kpi_value: string | null;
  currency: string;
  missing_reason: string | null;
  attribution: string | null;
  assumptions: string | null;
  status: string;
  sustain_phase: Generated<boolean>;
  validated_amount: string | null;
  submitted_by: string | null;
  submitted_at: NullableTimestamp;
  decided_by: string | null;
  decided_at: NullableTimestamp;
  reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitMeasurementInputTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  measurement_id: string;
  variable_name: string;
  kpi_actual_id: string | null;
  kpi_value_no: number | null;
  value: string;
  period_start: string;
  period_end: string;
  created_at: TimestampDefault;
  created_by: string;
}

export interface BenefitEvidenceTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  benefit_id: string;
  measurement_id: string | null;
  evidence_id: string;
  created_at: TimestampDefault;
  created_by: string;
}

export interface FinanceValidationTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  benefit_id: string;
  benefit_measurement_id: string;
  kind: Generated<string>;
  corrects_validation_id: string | null;
  idempotency_key: string;
  assignee_user_id: string | null;
  status: string;
  content: Json;
  measurement_period_start: string | null;
  measurement_period_end: string | null;
  baseline_decision: string | null;
  attribution_decision: string | null;
  calculation_decision: string | null;
  evidence_decision: string | null;
  period_decision: string | null;
  assumptions_decision: string | null;
  baseline_note: string | null;
  attribution_note: string | null;
  calculation_note: string | null;
  evidence_note: string | null;
  period_note: string | null;
  assumptions_note: string | null;
  approved_amount: string | null;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: NullableTimestamp;
  reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitOverlapTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  benefit_a_id: string;
  benefit_b_id: string;
  dimensions: string[];
  driver_key: string | null;
  population_key: string | null;
  overlap_start: string | null;
  overlap_end: string | null;
  detected_by: string;
  status: Generated<string>;
  resolution: string | null;
  excluded_benefit_id: string | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

// ---------------------------------------------------------------------------------------------------- P4 slice E
// 0041-0042 (T-DG4-ARCH-04; ADR-0031): RAID entries, corrective-action rules, cases and signals, budget lines and
// initiative durations; the raid_register view.

export interface RaidEntryTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  entry_type: string;
  code: string;
  description: string;
  impact: string;
  probability: string | null;
  owner_user_id: string;
  due_date: string | null;
  mitigation: string | null;
  initiative_id: string | null;
  status: Generated<string>;
  closed_at: NullableTimestamp;
  closed_by: string | null;
  closure_note: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface RaidRegisterView {
  id: ColumnType<string | null, never, never>;
  organization_id: ColumnType<string | null, never, never>;
  transformation_id: ColumnType<string | null, never, never>;
  entry_type: ColumnType<string | null, never, never>;
  code: ColumnType<string | null, never, never>;
  description: ColumnType<string | null, never, never>;
  impact: ColumnType<string | null, never, never>;
  probability: ColumnType<string | null, never, never>;
  owner_user_id: ColumnType<string | null, never, never>;
  due_date: ColumnType<string | null, never, never>;
  mitigation: ColumnType<string | null, never, never>;
  raid_status: ColumnType<string | null, never, never>;
  record_status: ColumnType<string | null, never, never>;
  record_table: ColumnType<string | null, never, never>;
  initiative_id: ColumnType<string | null, never, never>;
  version: ColumnType<number | null, never, never>;
  created_at: ColumnType<Date | null, never, never>;
  updated_at: ColumnType<Date | null, never, never>;
}

export interface CorrectiveActionRuleTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  source_kind: string;
  min_kpi_rag: string | null;
  persistence_cycles: number;
  follow_up_working_days: number;
  enabled: Generated<boolean>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface CorrectiveCaseTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  source_kind: string;
  source_scope_key: string;
  kpi_definition_id: string | null;
  kpi_scope_kind: string | null;
  kpi_scope_id: string | null;
  benefit_id: string | null;
  source_record_type: string | null;
  source_record_id: string | null;
  title: string;
  recovery_plan: string | null;
  owner_user_id: string | null;
  follow_up_date: string | null;
  follow_up_calendar_id: string | null;
  follow_up_calendar_version: number | null;
  status: Generated<string>;
  consecutive_off_track: number | null;
  signal_count: Generated<number>;
  last_signal_at: NullableTimestamp;
  closed_at: NullableTimestamp;
  closed_by: string | null;
  closure_note: string | null;
  /** 'api' (a person's Value Review case) or 'worker' (event-driven; created_by NULL, audit actor = service). */
  created_source: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface CorrectiveSignalTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  source_kind: string;
  source_scope_key: string;
  source_event_key: string;
  period_key: string;
  period_start: string | null;
  period_end: string | null;
  observed_rag: string | null;
  off_track: boolean | null;
  rule_persistence: number | null;
  consecutive_off_track: number | null;
  outcome: string;
  corrective_case_id: string | null;
  payload: Json;
  received_at: TimestampDefault;
}

export interface BudgetLineTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  label: string;
  period_month: string | null;
  currency: string;
  /** numeric(20,4) as a decimal string; NULL = Unknown, never 0. */
  budget_amount: string | null;
  actual_amount: string | null;
  forecast_amount: string | null;
  owner_user_id: string | null;
  note: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface InitiativeScheduleTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  duration_working_days: number | null;
  note: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BenefitCountingView {
  benefit_id: ColumnType<string | null, never, never>;
  organization_id: ColumnType<string | null, never, never>;
  transformation_id: ColumnType<string | null, never, never>;
  value_class: ColumnType<string | null, never, never>;
  currency: ColumnType<string | null, never, never>;
  counted: ColumnType<boolean | null, never, never>;
  exclusion_reason: ColumnType<string | null, never, never>;
  overlap_open: ColumnType<boolean | null, never, never>;
}

export interface BenefitValueLineView {
  benefit_id: ColumnType<string | null, never, never>;
  transformation_id: ColumnType<string | null, never, never>;
  value_state: ColumnType<string | null, never, never>;
  period_start: ColumnType<string | null, never, never>;
  period_end: ColumnType<string | null, never, never>;
  amount: ColumnType<string | null, never, never>;
  kpi_value: ColumnType<string | null, never, never>;
  currency: ColumnType<string | null, never, never>;
  record_table: ColumnType<string | null, never, never>;
  record_id: ColumnType<string | null, never, never>;
}

// P4 slice D (T-DG4-ARCH-05; ADR-0032; migrations 0044, 0045): forums, meeting series, meetings, agenda items,
// attendance, outputs, action links, minutes, escalation rules, decision escalations, blocker statuses; the T16 view.
export interface ForumTemplateTable {
  key: string;
  ordinal: number;
  source_layer_en: string;
  source_cadence_en: string;
  source_purpose_en: string;
  source_participants_en: string;
  source_outputs_en: string;
  layer_ar: string;
  cadence_ar: string;
  purpose_ar: string;
  participants_ar: string;
  outputs_ar: string;
  ar_provisional: Generated<boolean>;
  chair_party_code: string | null;
  participant_parties: string[];
  output_kinds: string[];
  publish_requires_any_output: Generated<string[]>;
  executive_asks_only: boolean;
  default_frequency: string;
  default_interval: number;
  source_ref: string;
}

export interface ForumTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  template_key: string | null;
  ordinal: number;
  name_en: string;
  name_ar: string;
  cadence_label: string;
  purpose: string;
  participants_label: string;
  outputs_label: string;
  chair_party_code: string | null;
  secretary_user_id: string | null;
  participant_parties: Generated<string[]>;
  output_kinds: string[];
  publish_requires_any_output: Generated<string[]>;
  executive_asks_only: Generated<boolean>;
  quorum_min: number | null;
  cutoff_working_days: Generated<number>;
  agenda_max_items: number | null;
  late_items_rule: Generated<string>;
  status: Generated<string>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface ForumParticipantTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  forum_id: string;
  user_id: string | null;
  group_id: string | null;
  counts_for_quorum: Generated<boolean>;
  status: Generated<string>;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface MeetingSeriesTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  forum_id: string;
  frequency: string;
  interval_count: number;
  weekdays: number[] | null;
  month_day: number | null;
  start_date: string;
  end_date: string | null;
  start_time: string;
  duration_minutes: number;
  timezone: Generated<string>;
  non_working_day_rule: Generated<string>;
  horizon_days: Generated<number>;
  location: string | null;
  rule_version: Generated<number>;
  generated_through: string | null;
  status: Generated<string>;
  ended_at: NullableTimestamp;
  ended_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface MeetingTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  forum_id: string;
  series_id: string | null;
  series_rule_version: number | null;
  occurrence_date: string | null;
  scheduled_date: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  timezone: Generated<string>;
  location: string | null;
  chair_user_id: string | null;
  secretary_user_id: string | null;
  quorum_min: number | null;
  cutoff_date: string | null;
  cutoff_unknown_reason: string | null;
  status: Generated<string>;
  cancel_reason: string | null;
  cancel_note: string | null;
  cancelled_at: NullableTimestamp;
  cancelled_by: string | null;
  started_at: NullableTimestamp;
  held_at: NullableTimestamp;
  created_source: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface AgendaItemTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  meeting_id: string;
  ordinal: number;
  item_kind: string;
  title: string;
  description: string | null;
  presenter_user_id: string | null;
  duration_minutes: number | null;
  materials_evidence_ids: Generated<string[]>;
  decision_id: string | null;
  ask_decision_required: string | null;
  ask_why_now: string | null;
  ask_options: string[] | null;
  ask_recommendation: string | null;
  ask_impact_of_delay: string | null;
  ask_owner_user_id: string | null;
  ask_required_date: string | null;
  late: Generated<boolean>;
  status: Generated<string>;
  published_at: NullableTimestamp;
  published_by: string | null;
  outcome: string | null;
  outcome_quorum_present: number | null;
  outcome_recorded_at: NullableTimestamp;
  outcome_recorded_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface MeetingAttendanceTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  meeting_id: string;
  user_id: string;
  attendance: string;
  counts_for_quorum: Generated<boolean>;
  on_behalf_of_user_id: string | null;
  note: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface MeetingOutputTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  meeting_id: string;
  agenda_item_id: string | null;
  output_kind: string;
  record_type: string | null;
  record_id: string | null;
  note: string | null;
  created_at: TimestampDefault;
  created_by: string;
}

export interface MeetingActionLinkTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  meeting_id: string;
  agenda_item_id: string | null;
  action_item_id: string;
  link_kind: string;
  created_at: TimestampDefault;
  created_by: string;
}

export interface MeetingMinutesTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  meeting_id: string;
  body: string;
  status: Generated<string>;
  approved_at: NullableTimestamp;
  approved_by: string | null;
  published_at: NullableTimestamp;
  published_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface GovernanceEscalationRuleTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  rule_kind: string;
  enabled: Generated<boolean>;
  escalation_chain: string[] | null;
  red_cycles: number | null;
  deadline_working_days: number | null;
  owner_party_code: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface DecisionEscalationTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  decision_id: string;
  sla_due_date: string;
  business_date: string;
  level: number;
  party_code: string | null;
  target_user_id: string | null;
  target_group_id: string | null;
  routing_error: string | null;
  delay_impact: string | null;
  escalated_at: TimestampDefault;
}

export interface BlockerStatusTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  meeting_id: string;
  forum_id: string;
  cycle_date: string;
  source_record_type: string;
  source_record_id: string;
  rag: string;
  note: string | null;
  created_at: TimestampDefault;
  created_by: string;
}

export interface ExecutiveDecisionLogView {
  id: ColumnType<string | null, never, never>;
  organization_id: ColumnType<string | null, never, never>;
  transformation_id: ColumnType<string | null, never, never>;
  t16_id: ColumnType<string | null, never, never>;
  decision: ColumnType<string | null, never, never>;
  why_now: ColumnType<string | null, never, never>;
  options: ColumnType<string | null, never, never>;
  recommendation: ColumnType<string | null, never, never>;
  owner_user_id: ColumnType<string | null, never, never>;
  decision_date: ColumnType<string | null, never, never>;
  impact_of_delay: ColumnType<string | null, never, never>;
  outcome: ColumnType<string | null, never, never>;
  status: ColumnType<string | null, never, never>;
  ask_origin: ColumnType<string | null, never, never>;
  sla_due_date: ColumnType<string | null, never, never>;
  sla_unknown_reason: ColumnType<string | null, never, never>;
  decided_at: ColumnType<Date | null, never, never>;
  decided_by: ColumnType<string | null, never, never>;
  blocker_record_type: ColumnType<string | null, never, never>;
  blocker_record_id: ColumnType<string | null, never, never>;
  version: ColumnType<number | null, never, never>;
  created_at: ColumnType<Date | null, never, never>;
  updated_at: ColumnType<Date | null, never, never>;
}

// P4 slices F and G (T-DG4-ARCH-06; ADR-0033, ADR-0034; migrations 0047, 0048): the indicator templates, the T13
// stakeholder register, champions, metric links, interventions, versioned forms, invitations, training and assessment
// records, involvement, champion constraints; performance areas and cycles, controls and checks, BAU handovers and
// evidence, transition decisions, sustainment reviews, lessons, improvement items and closure records.
export interface AdoptionIndicatorTemplateTable {
  key: string;
  indicator_key: string;
  indicator_ordinal: number;
  measure_ordinal: number;
  source_indicator_en: string;
  indicator_ar: string;
  measure_en: string;
  measure_ar: string;
  ar_provisional: Generated<boolean>;
  unit_kind: string;
  polarity: string;
  value_nature: string;
  aggregation_rule: string;
  value_source: string;
  source_ref: string;
}

export interface StakeholderGroupTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  name: string;
  description: string | null;
  influence: string | null;
  impact: string;
  current_stance: string;
  required_behavior: string;
  intervention_types: string[];
  intervention_plan: string | null;
  owner_user_id: string;
  adoption_kpi_definition_id: string | null;
  headcount: number | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface StakeholderChampionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  stakeholder_group_id: string;
  user_id: string;
  note: string | null;
  status: Generated<string>;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface AdoptionMetricLinkTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  template_key: string;
  kpi_definition_id: string | null;
  target_kind: string;
  outcome_id: string | null;
  initiative_id: string | null;
  stakeholder_group_id: string | null;
  status: Generated<string>;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface AdoptionInterventionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  stakeholder_group_id: string | null;
  intervention_type: string;
  title: string;
  description: string | null;
  owner_user_id: string | null;
  due_date: string | null;
  status: Generated<string>;
  origin: string;
  metric_link_id: string | null;
  kpi_evaluation_id: string | null;
  reporting_period_id: string | null;
  scope_kind: string | null;
  scope_id: string | null;
  trigger_key: string | null;
  outcome_note: string | null;
  completed_at: NullableTimestamp;
  completed_by: string | null;
  created_source: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface AssessmentFormTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kind: string;
  name: string;
  description: string | null;
  stakeholder_group_id: string | null;
  status: Generated<string>;
  current_version_no: Generated<number>;
  published_version_no: number | null;
  published_at: NullableTimestamp;
  published_by: string | null;
  retired_at: NullableTimestamp;
  retired_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface AssessmentFormVersionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  form_id: string;
  version_no: number;
  schema: Json;
  created_at: TimestampDefault;
  created_by: string;
}

export interface AssessmentInvitationTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  form_id: string;
  user_id: string;
  stakeholder_group_id: string;
  subject_user_id: string | null;
  due_date: string | null;
  status: Generated<string>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface TrainingRecordTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  stakeholder_group_id: string;
  intervention_id: string | null;
  participant_user_id: string | null;
  participant_label: string | null;
  training_title: string;
  scheduled_on: string | null;
  status: Generated<string>;
  completed_on: string | null;
  recorded_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface AssessmentRecordTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  form_id: string;
  form_version_id: string;
  invitation_id: string | null;
  stakeholder_group_id: string;
  kind: string;
  respondent_user_id: string;
  subject_user_id: string | null;
  subject_label: string | null;
  observed_on: string;
  answers: Json;
  proficiency_result: string | null;
  status: Generated<string>;
  reviewed_at: NullableTimestamp;
  reviewed_by: string | null;
  review_note: string | null;
  withdrawn_at: NullableTimestamp;
  withdrawn_by: string | null;
  withdraw_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface StakeholderInvolvementTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  stakeholder_group_id: string;
  involvement_kind: string;
  workshop_id: string | null;
  decision_id: string | null;
  note: string | null;
  withdraws_involvement_id: string | null;
  created_at: TimestampDefault;
  created_by: string;
}

export interface ChampionConstraintTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  champion_id: string;
  stakeholder_group_id: string;
  decision_id: string;
  constraint_text: string;
  status: Generated<string>;
  response_text: string | null;
  resolved_at: NullableTimestamp;
  resolved_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface PerformanceAreaTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  name: string;
  description: string | null;
  business_unit_id: string | null;
  sponsor_user_id: string | null;
  bau_owner_user_id: string | null;
  kpi_owner_user_id: string | null;
  review_frequency: Generated<string>;
  review_interval: Generated<number>;
  next_review_date: string | null;
  cycle_no: Generated<number>;
  status: Generated<string>;
  current_handover_id: string | null;
  retired_at: NullableTimestamp;
  retired_by: string | null;
  retire_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface PerformanceAreaCycleTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  performance_area_id: string;
  cycle_no: number;
  opened_at: TimestampDefault;
  opened_by: string;
  reopen_reason: string | null;
  prior_handover_id: string | null;
  prior_handover_accepted_at: NullableTimestamp;
  prior_handover_accepted_by: string | null;
  prior_closure_record_id: string | null;
  prior_closed_at: NullableTimestamp;
  created_at: TimestampDefault;
  created_by: string;
}

export interface PerformanceAreaLinkTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  performance_area_id: string;
  link_kind: string;
  kpi_definition_id: string | null;
  benefit_id: string | null;
  status: Generated<string>;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface ControlTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  performance_area_id: string;
  code: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  frequency: string;
  frequency_interval: Generated<number>;
  next_check_date: string | null;
  status: Generated<string>;
  retired_at: NullableTimestamp;
  retired_by: string | null;
  retire_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface ControlCheckTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  control_id: string;
  performance_area_id: string;
  due_date: string;
  assignee_user_id: string | null;
  status: Generated<string>;
  performed_at: NullableTimestamp;
  performed_by: string | null;
  result_note: string | null;
  created_source: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface BauHandoverTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  performance_area_id: string;
  cycle_no: number;
  code: string;
  receiving_owner_user_id: string;
  kpi_owner_user_id: string | null;
  operating_procedures: string | null;
  capability_readiness: string | null;
  unresolved_accepted_risks: string | null;
  benefit_monitoring_cadence: string | null;
  data_access: string | null;
  improvement_backlog_summary: string | null;
  status: Generated<string>;
  submitted_at: NullableTimestamp;
  submitted_by: string | null;
  accepted_at: NullableTimestamp;
  accepted_by: string | null;
  acceptance_note: string | null;
  returned_at: NullableTimestamp;
  returned_by: string | null;
  return_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface BauHandoverEvidenceTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  handover_id: string;
  evidence_id: string;
  created_at: TimestampDefault;
  created_by: string;
}

export interface TransitionDecisionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  benefit_id: string;
  residual_owner_user_id: string;
  rationale: string;
  expected_realization_end: string;
  monitoring_frequency: string;
  monitoring_interval: Generated<number>;
  first_monitoring_date: string;
  next_monitoring_date: string | null;
  status: Generated<string>;
  approval_id: string | null;
  decided_at: NullableTimestamp;
  decided_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface SustainmentReviewTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  subject_kind: string;
  performance_area_id: string | null;
  cycle_no: number | null;
  transition_decision_id: string | null;
  due_date: string;
  assignee_user_id: string;
  status: Generated<string>;
  completed_at: NullableTimestamp;
  completed_by: string | null;
  outcome_note: string | null;
  performance_signal: string | null;
  created_source: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface LessonTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  performance_area_id: string | null;
  title: string;
  context: string | null;
  lesson_text: string;
  recommendation: string | null;
  tags: Generated<string[]>;
  status: Generated<string>;
  published_at: NullableTimestamp;
  published_by: string | null;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  search_document: ColumnType<string, never, never>;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface ImprovementItemTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  performance_area_id: string | null;
  title: string;
  description: string | null;
  source_kind: string;
  lesson_id: string | null;
  control_check_id: string | null;
  review_id: string | null;
  handover_id: string | null;
  owner_user_id: string | null;
  priority: string | null;
  target_date: string | null;
  status: Generated<string>;
  resolution_note: string | null;
  resolved_at: NullableTimestamp;
  resolved_by: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface ClosureRecordTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  subject_kind: string;
  initiative_id: string | null;
  basis: string;
  snapshot: Json;
  closure_note: string | null;
  closed_at: TimestampDefault;
  closed_by: string;
  created_at: TimestampDefault;
  created_by: string;
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
  methodology_version: MethodologyVersionTable;
  transformation_config_pin: TransformationConfigPinTable;
  diagnostic_dimension: DiagnosticDimensionTable;
  diagnostic_workstream: DiagnosticWorkstreamTable;
  tom_dimension: TomDimensionTable;
  gate_definition: GateDefinitionTable;
  gate_criterion_definition: GateCriterionDefinitionTable;
  charter_scope_check_definition: CharterScopeCheckDefinitionTable;
  good_outcome_criterion: GoodOutcomeCriterionTable;
  evidence: EvidenceTable;
  evidence_content: EvidenceContentTable;
  evidence_link: EvidenceLinkTable;
  north_star: NorthStarTable;
  strategic_guardrail: StrategicGuardrailTable;
  outcome: OutcomeTable;
  charter: CharterTable;
  charter_version: CharterVersionTable;
  kpi_definition: KpiDefinitionTable;
  baseline: BaselineTable;
  outcome_kpi: OutcomeKpiTable;
  value_pool: ValuePoolTable;
  diagnostic_item: DiagnosticItemTable;
  diagnostic_finding: DiagnosticFindingTable;
  diagnostic_workstream_output: DiagnosticWorkstreamOutputTable;
  tom_canvas_cell: TomCanvasCellTable;
  tom_gap: TomGapTable;
  capability: CapabilityTable;
  journey: JourneyTable;
  journey_pain_point: JourneyPainPointTable;
  decision: DecisionTable;
  decision_option: DecisionOptionTable;
  record_code_counter: RecordCodeCounterTable;
  tom_workshop: TomWorkshopTable;
  tom_workshop_participant: TomWorkshopParticipantTable;
  tom_workshop_item: TomWorkshopItemTable;
  action_item: ActionItemTable;
  dependency: DependencyTable;
  gate_instance: GateInstanceTable;
  gate_submission: GateSubmissionTable;
  gate_submission_criterion: GateSubmissionCriterionTable;
  gate_decision: GateDecisionTable;
  role_accountability: RoleAccountabilityTable;
  roadmap_wave: RoadmapWaveTable;
  initiative: InitiativeTable;
  initiative_gap_link: InitiativeGapLinkTable;
  initiative_outcome_contribution: InitiativeOutcomeContributionTable;
  initiative_decision_link: InitiativeDecisionLinkTable;
  deliverable: DeliverableTable;
  milestone: MilestoneTable;
  gate_dispensation: GateDispensationTable;
  scoring_weight_set: ScoringWeightSetTable;
  scoring_weight: ScoringWeightTable;
  initiative_score: InitiativeScoreTable;
  initiative_score_result: InitiativeScoreResultTable;
  ranking_snapshot: RankingSnapshotTable;
  ranking_override: RankingOverrideTable;
  ranking_entry: RankingEntryTable;
  dependency_type: DependencyTypeTable;
  resource_role: ResourceRoleTable;
  capacity: CapacityTable;
  resource_demand: ResourceDemandTable;
  portfolio_selection: PortfolioSelectionTable;
  funding_decision: FundingDecisionTable;
  benefit_formula: BenefitFormulaTable;
  benefit_formula_version: BenefitFormulaVersionTable;
  benefit_formula_variable: BenefitFormulaVariableTable;
  benefit_calculation: BenefitCalculationTable;
  business_case: BusinessCaseTable;
  business_case_line: BusinessCaseLineTable;
  benefit_formula_example: BenefitFormulaExampleTable;
  benefit_formula_example_variable: BenefitFormulaExampleVariableTable;
  gate_decision_agreement: GateDecisionAgreementTable;
  business_calendar: BusinessCalendarTable;
  business_calendar_holiday: BusinessCalendarHolidayTable;
  job_schedule: JobScheduleTable;
  work_item_kind: WorkItemKindTable;
  work_item: WorkItemTable;
  inbox_notification: InboxNotificationTable;
  access_group: AccessGroupTable;
  access_group_member: AccessGroupMemberTable;
  governance_party: GovernancePartyTable;
  role_mapping: RoleMappingTable;
  decision_right_template: DecisionRightTemplateTable;
  governance_matrix: GovernanceMatrixTable;
  transformation_decision_right: TransformationDecisionRightTable;
  raci_template_deliverable: RaciTemplateDeliverableTable;
  raci_template_cell: RaciTemplateCellTable;
  transformation_raci_deliverable: TransformationRaciDeliverableTable;
  transformation_raci_assignment: TransformationRaciAssignmentTable;
  approval_type: ApprovalTypeTable;
  approval: ApprovalTable;
  approval_decision: ApprovalDecisionTable;
  approval_escalation: ApprovalEscalationTable;
  approval_decision_record: ApprovalDecisionRecordView;
  reporting_period: ReportingPeriodTable;
  kpi_version: KpiVersionTable;
  kpi_formula_input: KpiFormulaInputTable;
  kpi_rag_threshold: KpiRagThresholdTable;
  target_trajectory: TargetTrajectoryTable;
  target_trajectory_point: TargetTrajectoryPointTable;
  kpi_actual: KpiActualTable;
  kpi_actual_value: KpiActualValueTable;
  kpi_actual_review: KpiActualReviewTable;
  kpi_actual_evidence: KpiActualEvidenceTable;
  calculation_run: CalculationRunTable;
  kpi_evaluation: KpiEvaluationTable;
  data_quality_finding: DataQualityFindingTable;
  rag_override: RagOverrideTable;
  benefit_lifecycle_step_definition: BenefitLifecycleStepDefinitionTable;
  benefit_valuation_method: BenefitValuationMethodTable;
  benefit_group: BenefitGroupTable;
  benefit: BenefitTable;
  benefit_enabler: BenefitEnablerTable;
  benefit_lifecycle_event: BenefitLifecycleEventTable;
  benefit_allocation: BenefitAllocationTable;
  benefit_scenario: BenefitScenarioTable;
  benefit_scenario_value: BenefitScenarioValueTable;
  benefit_plan_value: BenefitPlanValueTable;
  benefit_measurement: BenefitMeasurementTable;
  benefit_measurement_input: BenefitMeasurementInputTable;
  benefit_evidence: BenefitEvidenceTable;
  finance_validation: FinanceValidationTable;
  benefit_overlap: BenefitOverlapTable;
  benefit_counting: BenefitCountingView;
  benefit_value_line: BenefitValueLineView;
  raid_entry: RaidEntryTable;
  raid_register: RaidRegisterView;
  corrective_action_rule: CorrectiveActionRuleTable;
  corrective_case: CorrectiveCaseTable;
  corrective_signal: CorrectiveSignalTable;
  budget_line: BudgetLineTable;
  initiative_schedule: InitiativeScheduleTable;
  forum_template: ForumTemplateTable;
  forum: ForumTable;
  forum_participant: ForumParticipantTable;
  meeting_series: MeetingSeriesTable;
  meeting: MeetingTable;
  agenda_item: AgendaItemTable;
  meeting_attendance: MeetingAttendanceTable;
  meeting_output: MeetingOutputTable;
  meeting_action_link: MeetingActionLinkTable;
  meeting_minutes: MeetingMinutesTable;
  governance_escalation_rule: GovernanceEscalationRuleTable;
  decision_escalation: DecisionEscalationTable;
  blocker_status: BlockerStatusTable;
  adoption_indicator_template: AdoptionIndicatorTemplateTable;
  stakeholder_group: StakeholderGroupTable;
  stakeholder_champion: StakeholderChampionTable;
  adoption_metric_link: AdoptionMetricLinkTable;
  adoption_intervention: AdoptionInterventionTable;
  assessment_form: AssessmentFormTable;
  assessment_form_version: AssessmentFormVersionTable;
  assessment_invitation: AssessmentInvitationTable;
  training_record: TrainingRecordTable;
  assessment_record: AssessmentRecordTable;
  stakeholder_involvement: StakeholderInvolvementTable;
  champion_constraint: ChampionConstraintTable;
  performance_area: PerformanceAreaTable;
  performance_area_cycle: PerformanceAreaCycleTable;
  performance_area_link: PerformanceAreaLinkTable;
  control: ControlTable;
  control_check: ControlCheckTable;
  bau_handover: BauHandoverTable;
  bau_handover_evidence: BauHandoverEvidenceTable;
  transition_decision: TransitionDecisionTable;
  sustainment_review: SustainmentReviewTable;
  lesson: LessonTable;
  improvement_item: ImprovementItemTable;
  closure_record: ClosureRecordTable;
  executive_decision_log: ExecutiveDecisionLogView;
}

/** Relations that are views (read-only); excluded from the table/column drift test's table list. */
export const VIEW_NAMES = [
  "actor_display",
  "approval_decision_record",
  "benefit_counting",
  "benefit_value_line",
  "business_unit_closure",
  "executive_decision_log",
  "raid_register",
  "my_work_draft",
  "scope_node",
  "traceability_edge",
] as const;

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
export type CharterRow = Selectable<CharterTable>;
export type CharterVersionRow = Selectable<CharterVersionTable>;
export type DecisionRow = Selectable<DecisionTable>;
export type GateInstanceRow = Selectable<GateInstanceTable>;
export type GateSubmissionRow = Selectable<GateSubmissionTable>;
export type GateDecisionRow = Selectable<GateDecisionTable>;
export type EvidenceRow = Selectable<EvidenceTable>;
export type ValuePoolRow = Selectable<ValuePoolTable>;
export type RoadmapWaveRow = Selectable<RoadmapWaveTable>;
export type InitiativeRow = Selectable<InitiativeTable>;
export type InitiativeGapLinkRow = Selectable<InitiativeGapLinkTable>;
export type InitiativeOutcomeContributionRow = Selectable<InitiativeOutcomeContributionTable>;
export type InitiativeDecisionLinkRow = Selectable<InitiativeDecisionLinkTable>;
export type DeliverableRow = Selectable<DeliverableTable>;
export type MilestoneRow = Selectable<MilestoneTable>;
export type GateDispensationRow = Selectable<GateDispensationTable>;
export type ScoringWeightSetRow = Selectable<ScoringWeightSetTable>;
export type ScoringWeightRow = Selectable<ScoringWeightTable>;
export type InitiativeScoreRow = Selectable<InitiativeScoreTable>;
export type InitiativeScoreResultRow = Selectable<InitiativeScoreResultTable>;
export type RankingSnapshotRow = Selectable<RankingSnapshotTable>;
export type RankingOverrideRow = Selectable<RankingOverrideTable>;
export type RankingEntryRow = Selectable<RankingEntryTable>;
export type DependencyTypeRow = Selectable<DependencyTypeTable>;
export type ResourceRoleRow = Selectable<ResourceRoleTable>;
export type CapacityRow = Selectable<CapacityTable>;
export type ResourceDemandRow = Selectable<ResourceDemandTable>;
export type PortfolioSelectionRow = Selectable<PortfolioSelectionTable>;
export type FundingDecisionRow = Selectable<FundingDecisionTable>;
export type BenefitFormulaRow = Selectable<BenefitFormulaTable>;
export type BenefitFormulaVersionRow = Selectable<BenefitFormulaVersionTable>;
export type BenefitFormulaVariableRow = Selectable<BenefitFormulaVariableTable>;
export type BenefitCalculationRow = Selectable<BenefitCalculationTable>;
export type BusinessCaseRow = Selectable<BusinessCaseTable>;
export type BusinessCaseLineRow = Selectable<BusinessCaseLineTable>;
export type BenefitFormulaExampleRow = Selectable<BenefitFormulaExampleTable>;
export type BenefitFormulaExampleVariableRow = Selectable<BenefitFormulaExampleVariableTable>;
export type GateDecisionAgreementRow = Selectable<GateDecisionAgreementTable>;
export type BusinessCalendarRow = Selectable<BusinessCalendarTable>;
export type BusinessCalendarHolidayRow = Selectable<BusinessCalendarHolidayTable>;
export type JobScheduleRow = Selectable<JobScheduleTable>;
export type WorkItemKindRow = Selectable<WorkItemKindTable>;
export type WorkItemRow = Selectable<WorkItemTable>;
export type InboxNotificationRow = Selectable<InboxNotificationTable>;
export type AccessGroupRow = Selectable<AccessGroupTable>;
export type AccessGroupMemberRow = Selectable<AccessGroupMemberTable>;
export type GovernancePartyRow = Selectable<GovernancePartyTable>;
export type RoleMappingRow = Selectable<RoleMappingTable>;
export type DecisionRightTemplateRow = Selectable<DecisionRightTemplateTable>;
export type GovernanceMatrixRow = Selectable<GovernanceMatrixTable>;
export type TransformationDecisionRightRow = Selectable<TransformationDecisionRightTable>;
export type RaciTemplateDeliverableRow = Selectable<RaciTemplateDeliverableTable>;
export type RaciTemplateCellRow = Selectable<RaciTemplateCellTable>;
export type TransformationRaciDeliverableRow = Selectable<TransformationRaciDeliverableTable>;
export type TransformationRaciAssignmentRow = Selectable<TransformationRaciAssignmentTable>;
export type ApprovalTypeRow = Selectable<ApprovalTypeTable>;
export type ApprovalRow = Selectable<ApprovalTable>;
export type ApprovalDecisionRow = Selectable<ApprovalDecisionTable>;
export type ApprovalEscalationRow = Selectable<ApprovalEscalationTable>;
export type ReportingPeriodRow = Selectable<ReportingPeriodTable>;
export type KpiVersionRow = Selectable<KpiVersionTable>;
export type KpiFormulaInputRow = Selectable<KpiFormulaInputTable>;
export type KpiRagThresholdRow = Selectable<KpiRagThresholdTable>;
export type TargetTrajectoryRow = Selectable<TargetTrajectoryTable>;
export type TargetTrajectoryPointRow = Selectable<TargetTrajectoryPointTable>;
export type KpiActualRow = Selectable<KpiActualTable>;
export type KpiActualValueRow = Selectable<KpiActualValueTable>;
export type KpiActualReviewRow = Selectable<KpiActualReviewTable>;
export type KpiActualEvidenceRow = Selectable<KpiActualEvidenceTable>;
export type CalculationRunRow = Selectable<CalculationRunTable>;
export type KpiEvaluationRow = Selectable<KpiEvaluationTable>;
export type DataQualityFindingRow = Selectable<DataQualityFindingTable>;
export type RagOverrideRow = Selectable<RagOverrideTable>;
export type BenefitLifecycleStepDefinitionRow = Selectable<BenefitLifecycleStepDefinitionTable>;
export type BenefitValuationMethodRow = Selectable<BenefitValuationMethodTable>;
export type BenefitGroupRow = Selectable<BenefitGroupTable>;
export type BenefitRow = Selectable<BenefitTable>;
export type BenefitEnablerRow = Selectable<BenefitEnablerTable>;
export type BenefitLifecycleEventRow = Selectable<BenefitLifecycleEventTable>;
export type BenefitAllocationRow = Selectable<BenefitAllocationTable>;
export type BenefitScenarioRow = Selectable<BenefitScenarioTable>;
export type BenefitScenarioValueRow = Selectable<BenefitScenarioValueTable>;
export type BenefitPlanValueRow = Selectable<BenefitPlanValueTable>;
export type BenefitMeasurementRow = Selectable<BenefitMeasurementTable>;
export type BenefitMeasurementInputRow = Selectable<BenefitMeasurementInputTable>;
export type BenefitEvidenceRow = Selectable<BenefitEvidenceTable>;
export type FinanceValidationRow = Selectable<FinanceValidationTable>;
export type BenefitOverlapRow = Selectable<BenefitOverlapTable>;
export type RaidEntryRow = Selectable<RaidEntryTable>;
export type RaidRegisterRow = Selectable<RaidRegisterView>;
export type CorrectiveActionRuleRow = Selectable<CorrectiveActionRuleTable>;
export type CorrectiveCaseRow = Selectable<CorrectiveCaseTable>;
export type CorrectiveSignalRow = Selectable<CorrectiveSignalTable>;
export type BudgetLineRow = Selectable<BudgetLineTable>;
export type InitiativeScheduleRow = Selectable<InitiativeScheduleTable>;
export type ForumTemplateRow = Selectable<ForumTemplateTable>;
export type ForumRow = Selectable<ForumTable>;
export type ForumParticipantRow = Selectable<ForumParticipantTable>;
export type MeetingSeriesRow = Selectable<MeetingSeriesTable>;
export type MeetingRow = Selectable<MeetingTable>;
export type AgendaItemRow = Selectable<AgendaItemTable>;
export type MeetingAttendanceRow = Selectable<MeetingAttendanceTable>;
export type MeetingOutputRow = Selectable<MeetingOutputTable>;
export type MeetingActionLinkRow = Selectable<MeetingActionLinkTable>;
export type MeetingMinutesRow = Selectable<MeetingMinutesTable>;
export type GovernanceEscalationRuleRow = Selectable<GovernanceEscalationRuleTable>;
export type DecisionEscalationRow = Selectable<DecisionEscalationTable>;
export type BlockerStatusRow = Selectable<BlockerStatusTable>;
export type ExecutiveDecisionLogRow = Selectable<ExecutiveDecisionLogView>;
export type AdoptionIndicatorTemplateRow = Selectable<AdoptionIndicatorTemplateTable>;
export type StakeholderGroupRow = Selectable<StakeholderGroupTable>;
export type StakeholderChampionRow = Selectable<StakeholderChampionTable>;
export type AdoptionMetricLinkRow = Selectable<AdoptionMetricLinkTable>;
export type AdoptionInterventionRow = Selectable<AdoptionInterventionTable>;
export type AssessmentFormRow = Selectable<AssessmentFormTable>;
export type AssessmentFormVersionRow = Selectable<AssessmentFormVersionTable>;
export type AssessmentInvitationRow = Selectable<AssessmentInvitationTable>;
export type TrainingRecordRow = Selectable<TrainingRecordTable>;
export type AssessmentRecordRow = Selectable<AssessmentRecordTable>;
export type StakeholderInvolvementRow = Selectable<StakeholderInvolvementTable>;
export type ChampionConstraintRow = Selectable<ChampionConstraintTable>;
export type PerformanceAreaRow = Selectable<PerformanceAreaTable>;
export type PerformanceAreaCycleRow = Selectable<PerformanceAreaCycleTable>;
export type PerformanceAreaLinkRow = Selectable<PerformanceAreaLinkTable>;
export type ControlRow = Selectable<ControlTable>;
export type ControlCheckRow = Selectable<ControlCheckTable>;
export type BauHandoverRow = Selectable<BauHandoverTable>;
export type BauHandoverEvidenceRow = Selectable<BauHandoverEvidenceTable>;
export type TransitionDecisionRow = Selectable<TransitionDecisionTable>;
export type SustainmentReviewRow = Selectable<SustainmentReviewTable>;
export type LessonRow = Selectable<LessonTable>;
export type ImprovementItemRow = Selectable<ImprovementItemTable>;
export type ClosureRecordRow = Selectable<ClosureRecordTable>;

// ---- P4 slice H (migrations 0051-0052; T-DG4-ARCH-07; ADR-0035, ADR-0036). Generated from the DDL by
// docs/delivery/handbacks/DG4/T-DG4-ARCH-07-evidence/gen-schema.py. numeric -> string (decimal), date -> "YYYY-MM-DD".
export interface PhaseDefinitionTable {
  id: string;
  code: string;
  methodology_version_id: string;
  ordinal: number;
  gate_code: string;
  source_name_en: string;
  name_ar: string;
  source_title_en: string;
  title_ar: string;
  source_purpose_en: string;
  purpose_ar: string;
  source_key_outputs_en: string;
  key_outputs_ar: string;
  source_objective_en: string;
  objective_ar: string;
  source_ref: string;
  ar_provisional: Generated<boolean>;
  created_at: TimestampDefault;
}

export interface PhaseStepDefinitionTable {
  id: string;
  key: string;
  phase_code: string;
  ordinal: number;
  source_procedure_en: string;
  procedure_ar: string;
  required_evidence_en: string;
  required_evidence_ar: string;
  default_owner_role_code: string;
  reviewer_role_code: string;
  completion_rule: string;
  source_ref: string;
  ar_provisional: Generated<boolean>;
  created_at: TimestampDefault;
}

export interface PhaseStepTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  step_key: string;
  phase_code: string;
  owner_user_id: string | null;
  status: Generated<string>;
  enabled_by_gate_decision_id: string | null;
  review_requested_by: string | null;
  review_requested_at: NullableTimestamp;
  completion_check: NullableJson;
  reviewed_by: string | null;
  reviewed_at: NullableTimestamp;
  review_outcome: string | null;
  review_note: string | null;
  completed_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string | null;
  updated_at: TimestampDefault;
  updated_by: string | null;
}

export interface PhaseStepEvidenceTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  phase_step_id: string;
  evidence_id: string;
  status: Generated<string>;
  removed_by: string | null;
  removed_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface GateCriterionReviewTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  gate_submission_id: string;
  criterion_key: string;
  review_no: number;
  reviewer_user_id: string;
  finding: string;
  open_condition: string | null;
  risk_note: string | null;
  raid_entry_id: string | null;
  recommendation: string;
  rationale: string;
  reviewed_at: TimestampDefault;
}

export interface GateExceptionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  gate_instance_id: string;
  gate_code: string;
  criterion_key: string;
  reason: string;
  scope: string;
  compensating_action: string;
  compensating_owner_user_id: string;
  expires_on: string;
  status: Generated<string>;
  requested_by: string;
  requested_at: TimestampDefault;
  decided_by: string | null;
  decided_on_behalf_of: string | null;
  decided_at: NullableTimestamp;
  decision_note: string | null;
  revoked_by: string | null;
  revoked_at: NullableTimestamp;
  revoke_reason: string | null;
  expiry_notified_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface GateDecisionScaleScopeTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  gate_decision_id: string;
  initiative_id: string;
  business_unit_id: string;
  note: string | null;
  created_at: TimestampDefault;
  created_by: string;
}

export interface GateDecisionConditionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  gate_decision_id: string;
  ordinal: number;
  condition_text: string;
  owner_user_id: string;
  due_date: string;
  created_at: TimestampDefault;
  created_by: string;
}

export interface ScaleTransitionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  initiative_id: string;
  business_unit_id: string;
  gate_decision_id: string;
  note: string | null;
  transitioned_by: string;
  transitioned_at: TimestampDefault;
}

export interface RiskDispositionTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  raid_entry_id: string;
  disposition: string;
  rationale: string;
  residual_owner_user_id: string;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
}

export interface ChangeControlPolicyTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  material_date_shift_working_days: number | null;
  material_budget_change_ratio: string | null;
  note: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface ChangeRequestTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  change_kind: string;
  subject_type: string;
  subject_id: string;
  subject_version: number;
  proposed_record_type: string | null;
  proposed_record_id: string | null;
  proposed_change: Json;
  reason: string;
  origin: Generated<string>;
  materiality: string | null;
  materiality_basis: NullableJson;
  route_party_code: string | null;
  decision_right_id: string | null;
  status: Generated<string>;
  raised_by: string;
  submitted_by: string | null;
  submitted_at: NullableTimestamp;
  current_impact_assessment_id: string | null;
  decided_at: NullableTimestamp;
  applied_at: NullableTimestamp;
  applied_record_type: string | null;
  applied_record_id: string | null;
  applied_version: number | null;
  withdrawn_at: NullableTimestamp;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface ImpactAssessmentTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  change_request_id: string;
  change_request_version: number;
  item_count: number;
  content_sha256: string;
  assessed_at: TimestampDefault;
  assessed_by: string;
}

export interface ImpactAssessmentItemTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  impact_assessment_id: string;
  ordinal: number;
  item_type: string;
  record_type: string | null;
  record_id: string | null;
  record_code: string | null;
  label: string;
  effect: string;
  gate_submission_id: string | null;
  gate_decision_id: string | null;
  detail: JsonDefault;
}

export interface Database {
  phase_definition: PhaseDefinitionTable;
  phase_step_definition: PhaseStepDefinitionTable;
  phase_step: PhaseStepTable;
  phase_step_evidence: PhaseStepEvidenceTable;
  gate_criterion_review: GateCriterionReviewTable;
  gate_exception: GateExceptionTable;
  gate_decision_scale_scope: GateDecisionScaleScopeTable;
  gate_decision_condition: GateDecisionConditionTable;
  scale_transition: ScaleTransitionTable;
  risk_disposition: RiskDispositionTable;
  change_control_policy: ChangeControlPolicyTable;
  change_request: ChangeRequestTable;
  impact_assessment: ImpactAssessmentTable;
  impact_assessment_item: ImpactAssessmentItemTable;
}

export type PhaseDefinitionRow = Selectable<PhaseDefinitionTable>;
export type PhaseStepDefinitionRow = Selectable<PhaseStepDefinitionTable>;
export type PhaseStepRow = Selectable<PhaseStepTable>;
export type PhaseStepEvidenceRow = Selectable<PhaseStepEvidenceTable>;
export type GateCriterionReviewRow = Selectable<GateCriterionReviewTable>;
export type GateExceptionRow = Selectable<GateExceptionTable>;
export type GateDecisionScaleScopeRow = Selectable<GateDecisionScaleScopeTable>;
export type GateDecisionConditionRow = Selectable<GateDecisionConditionTable>;
export type ScaleTransitionRow = Selectable<ScaleTransitionTable>;
export type RiskDispositionRow = Selectable<RiskDispositionTable>;
export type ChangeControlPolicyRow = Selectable<ChangeControlPolicyTable>;
export type ChangeRequestRow = Selectable<ChangeRequestTable>;
export type ImpactAssessmentRow = Selectable<ImpactAssessmentTable>;
export type ImpactAssessmentItemRow = Selectable<ImpactAssessmentItemTable>;

// ---- P4 slices J and K (migrations 0055-0056; T-DG4-ARCH-08; ADR-0037, ADR-0038). Generated from the DDL by
// docs/delivery/handbacks/DG4/T-DG4-ARCH-08-evidence/gen-schema.py. numeric -> string (decimal), date -> "YYYY-MM-DD".
export interface PortfolioTable {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface PortfolioTransformationTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  portfolio_id: string;
  status: Generated<string>;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  remove_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface WorkstreamTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  name: string;
  description: string | null;
  lead_user_id: string | null;
  status: Generated<string>;
  archived_at: NullableTimestamp;
  archived_by: string | null;
  archive_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface WorkstreamInitiativeTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  workstream_id: string;
  initiative_id: string;
  status: Generated<string>;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  remove_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface TraceLinkTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  link_kind: string;
  diagnostic_finding_id: string | null;
  tom_gap_id: string | null;
  deliverable_id: string | null;
  capability_id: string | null;
  outcome_kpi_id: string | null;
  benefit_id: string | null;
  contribution_statement: string;
  allocation_share: string | null;
  allocation_basis: string | null;
  status: Generated<string>;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  remove_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface InheritedRecordTable {
  id: string;
  organization_id: string;
  transformation_id: string;
  kind: string;
  evidence_id: string | null;
  baseline_id: string | null;
  source_description: string;
  original_owner: string | null;
  original_date: string | null;
  recorded_by: string;
  status: Generated<string>;
  withdrawn_at: NullableTimestamp;
  withdrawn_by: string | null;
  withdraw_reason: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface T10AreaDefinitionTable {
  id: string;
  code: string;
  methodology_version_id: string;
  ordinal: number;
  source_area_en: string;
  area_ar: string;
  source_what_to_show_en: string;
  what_to_show_ar: string;
  source_rag_logic_en: string;
  rag_logic_ar: string;
  source_presentation_en: string;
  presentation_ar: string;
  source_status_basis_en: string;
  status_basis_ar: string;
  source_ref: string;
  ar_provisional: Generated<boolean>;
  created_at: TimestampDefault;
}

export interface DashboardRagPolicyTable {
  id: string;
  organization_id: string;
  value_gap_amber_ratio: string | null;
  value_gap_red_ratio: string | null;
  milestone_slip_amber_working_days: number | null;
  milestone_slip_red_working_days: number | null;
  dependency_due_soon_working_days: number | null;
  decision_due_soon_working_days: number | null;
  top_initiative_count: number | null;
  deadline_horizon_working_days: number | null;
  note: string | null;
  version: Generated<number>;
  created_at: TimestampDefault;
  created_by: string;
  updated_at: TimestampDefault;
  updated_by: string;
}

export interface Database {
  portfolio: PortfolioTable;
  portfolio_transformation: PortfolioTransformationTable;
  workstream: WorkstreamTable;
  workstream_initiative: WorkstreamInitiativeTable;
  trace_link: TraceLinkTable;
  inherited_record: InheritedRecordTable;
  t10_area_definition: T10AreaDefinitionTable;
  dashboard_rag_policy: DashboardRagPolicyTable;
}

export type PortfolioRow = Selectable<PortfolioTable>;
export type PortfolioTransformationRow = Selectable<PortfolioTransformationTable>;
export type WorkstreamRow = Selectable<WorkstreamTable>;
export type WorkstreamInitiativeRow = Selectable<WorkstreamInitiativeTable>;
export type TraceLinkRow = Selectable<TraceLinkTable>;
export type InheritedRecordRow = Selectable<InheritedRecordTable>;
export type T10AreaDefinitionRow = Selectable<T10AreaDefinitionTable>;
export type DashboardRagPolicyRow = Selectable<DashboardRagPolicyTable>;

/** View (0055/0056; read-only). */
export interface TraceabilityEdgeView {
  organization_id: ColumnType<string | null, never, never>;
  transformation_id: ColumnType<string | null, never, never>;
  edge_kind: ColumnType<string | null, never, never>;
  from_type: ColumnType<string | null, never, never>;
  from_id: ColumnType<string | null, never, never>;
  to_type: ColumnType<string | null, never, never>;
  to_id: ColumnType<string | null, never, never>;
  link_table: ColumnType<string | null, never, never>;
  link_id: ColumnType<string | null, never, never>;
  contribution_statement: ColumnType<string | null, never, never>;
  allocation_share: ColumnType<string | null, never, never>;
}

/** View (0055/0056; read-only). */
export interface MyWorkDraftView {
  organization_id: ColumnType<string | null, never, never>;
  transformation_id: ColumnType<string | null, never, never>;
  record_type: ColumnType<string | null, never, never>;
  record_id: ColumnType<string | null, never, never>;
  code: ColumnType<string | null, never, never>;
  label: ColumnType<string | null, never, never>;
  parent_type: ColumnType<string | null, never, never>;
  parent_id: ColumnType<string | null, never, never>;
  created_by: ColumnType<string | null, never, never>;
  updated_at: ColumnType<Date | null, never, never>;
}

export interface Database {
  traceability_edge: TraceabilityEdgeView;
  my_work_draft: MyWorkDraftView;
}

export type TraceabilityEdgeRow = Selectable<TraceabilityEdgeView>;
export type MyWorkDraftRow = Selectable<MyWorkDraftView>;

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
  oidc_login_state: [
    "state_hash",
    "code_verifier",
    "nonce",
    "return_to",
    "created_at",
    "expires_at",
    "browser_binding_hash",
  ],
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
    "derived_from_assignment_id",
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

    "absence_note",
    "requested_by_user_id",
    "revoked_at",
    "revoked_by",
    "revoke_reason",
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
  methodology_version: [
    "id",
    "key",
    "version_no",
    "status",
    "title_en",
    "title_ar",
    "source_document",
    "source_sha256",
    "definition",
    "content_sha256",
    "published_at",
    "published_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  transformation_config_pin: [
    "id",
    "organization_id",
    "transformation_id",
    "kind",
    "methodology_version_id",
    "pinned_at",
    "pinned_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  diagnostic_dimension: [
    "id",
    "code",
    "methodology_version_id",
    "ordinal",
    "source_label",
    "label_en",
    "label_ar",
    "evidence_hint_en",
    "evidence_hint_ar",
    "impact_hint_en",
    "impact_hint_ar",
    "is_source_seeded",
    "status",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  diagnostic_workstream: [
    "id",
    "code",
    "methodology_version_id",
    "ordinal",
    "source_name_en",
    "name_ar",
    "source_key_questions_en",
    "key_questions_ar",
    "source_typical_outputs_en",
    "typical_outputs_ar",
    "source_ref",
    "status",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  tom_dimension: [
    "id",
    "code",
    "methodology_version_id",
    "ordinal",
    "source_name_en",
    "source_design_question_en",
    "source_canvas_box_en",
    "source_canvas_prompt_en",
    "label_en",
    "label_ar",
    "design_question_ar",
    "canvas_box_ar",
    "canvas_prompt_ar",
    "source_ref",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  gate_definition: [
    "id",
    "code",
    "methodology_version_id",
    "ordinal",
    "phase",
    "next_phase",
    "source_name_en",
    "name_ar",
    "source_decision_question_en",
    "decision_question_ar",
    "source_evidence_required_en",
    "evidence_required_ar",
    "default_approver_role_code",
    "allowed_approver_role_codes",
    "submission_enabled",
    "source_ref",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  gate_criterion_definition: [
    "id",
    "gate_definition_id",
    "key",
    "ordinal",
    "label_en",
    "label_ar",
    "description_en",
    "description_ar",
    "mandatory",
    "requires_verified_evidence",
    "source_ref",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  charter_scope_check_definition: [
    "id",
    "code",
    "methodology_version_id",
    "ordinal",
    "source_question_en",
    "question_ar",
    "source_ref",
    "system_precheck",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  good_outcome_criterion: [
    "id",
    "code",
    "methodology_version_id",
    "ordinal",
    "source_label_en",
    "label_ar",
    "evaluation",
    "source_ref",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  evidence: [
    "id",
    "organization_id",
    "transformation_id",
    "kind",
    "title",
    "description",
    "evidence_type",
    "source",
    "owner_user_id",
    "observation_start",
    "observation_end",
    "note_body",
    "url",
    "file_name",
    "current_content_id",
    "review_status",
    "accessibility_status",
    "reviewed_content_id",
    "reviewed_by",
    "reviewed_at",
    "review_note",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
    "content_authored_by",
  ],
  evidence_content: [
    "id",
    "organization_id",
    "transformation_id",
    "evidence_id",
    "revision",
    "storage_key",
    "sha256",
    "size_bytes",
    "content_type",
    "file_name",
    "uploaded_by",
    "uploaded_at",
  ],
  evidence_link: [
    "id",
    "organization_id",
    "transformation_id",
    "evidence_id",
    "record_type",
    "record_id",
    "status",
    "removed_at",
    "removed_by",
    "remove_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  north_star: [
    "id",
    "organization_id",
    "transformation_id",
    "statement",
    "status",
    "superseded_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  strategic_guardrail: [
    "id",
    "organization_id",
    "transformation_id",
    "title",
    "category",
    "statement",
    "owner_user_id",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  outcome: [
    "id",
    "organization_id",
    "transformation_id",
    "parent_outcome_id",
    "statement",
    "description",
    "owner_user_id",
    "is_top_outcome",
    "top_rank",
    "specific_confirmed",
    "strategically_relevant_confirmed",
    "causal_chain",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  charter: [
    "id",
    "organization_id",
    "transformation_id",
    "transformation_name",
    "executive_sponsor_user_id",
    "transformation_lead_user_id",
    "case_for_change",
    "north_star_id",
    "in_scope",
    "out_of_scope",
    "baseline_date",
    "target_horizon_value",
    "target_horizon_unit",
    "governance_forum",
    "decision_rights",
    "success_definition",
    "thesis_change",
    "thesis_outcomes",
    "thesis_benefits",
    "thesis_because",
    "sc_outcome_linkage",
    "sc_outcome_linkage_evidence",
    "sc_problem_traceability",
    "sc_problem_traceability_evidence",
    "sc_exclusions_documented",
    "sc_exclusions_documented_evidence",
    "sc_baseline_measurable",
    "sc_baseline_measurable_evidence",
    "sc_executive_decisions_visible",
    "sc_executive_decisions_visible_evidence",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  charter_version: [
    "id",
    "organization_id",
    "transformation_id",
    "charter_id",
    "version_no",
    "transformation_name",
    "executive_sponsor_user_id",
    "transformation_lead_user_id",
    "case_for_change",
    "north_star_id",
    "in_scope",
    "out_of_scope",
    "baseline_date",
    "target_horizon_value",
    "target_horizon_unit",
    "governance_forum",
    "decision_rights",
    "success_definition",
    "thesis_change",
    "thesis_outcomes",
    "thesis_benefits",
    "thesis_because",
    "sc_outcome_linkage",
    "sc_outcome_linkage_evidence",
    "sc_problem_traceability",
    "sc_problem_traceability_evidence",
    "sc_exclusions_documented",
    "sc_exclusions_documented_evidence",
    "sc_baseline_measurable",
    "sc_baseline_measurable_evidence",
    "sc_executive_decisions_visible",
    "sc_executive_decisions_visible_evidence",
    "north_star_statement",
    "top_outcomes_snapshot",
    "guardrails_snapshot",
    "change_summary",
    "saved_by",
    "saved_at",
  ],
  kpi_definition: [
    "id",
    "organization_id",
    "transformation_id",
    "name",
    "description",
    "business_purpose",
    "unit_kind",
    "unit_label",
    "currency",
    "polarity",
    "frequency",
    "is_leading",
    "data_source",
    "owner_user_id",
    "steward_user_id",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  baseline: [
    "id",
    "organization_id",
    "transformation_id",
    "metric",
    "kpi_definition_id",
    "value",
    "unit",
    "currency",
    "source",
    "baseline_date",
    "scope",
    "owner_user_id",
    "validation_status",
    "validated_by",
    "validated_at",
    "validation_note",
    "validated_record_version",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  outcome_kpi: [
    "id",
    "organization_id",
    "transformation_id",
    "outcome_id",
    "kpi_definition_id",
    "baseline_id",
    "baseline_value",
    "target_value",
    "target_date",
    "owner_user_id",
    "leading_indicator_text",
    "leading_kpi_definition_id",
    "ordinal",
    "trajectory_points",
    "trajectory_status",
    "trajectory_approved_by",
    "trajectory_approved_at",
    "trajectory_approved_version",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  value_pool: [
    "id",
    "organization_id",
    "transformation_id",
    "name",
    "driver",
    "workstream_code",
    "quantification_status",
    "upside_amount",
    "downside_amount",
    "currency",
    "unquantified_reason",
    "materiality",
    "confidence",
    "owner_user_id",
    "validation_status",
    "validated_by",
    "validated_at",
    "validation_note",
    "validated_record_version",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  diagnostic_item: [
    "id",
    "organization_id",
    "transformation_id",
    "dimension_code",
    "is_seeded",
    "current_state",
    "evidence_baseline",
    "baseline_id",
    "root_cause",
    "impact_text",
    "impact_amount",
    "impact_currency",
    "impact_kpi_definition_id",
    "confidence",
    "owner_user_id",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  diagnostic_finding: [
    "id",
    "organization_id",
    "transformation_id",
    "workstream_code",
    "diagnostic_item_id",
    "kind",
    "statement",
    "detail",
    "confidence",
    "owner_user_id",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  diagnostic_workstream_output: [
    "id",
    "organization_id",
    "transformation_id",
    "workstream_code",
    "title",
    "output_kind",
    "record_type",
    "record_id",
    "evidence_id",
    "note",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  tom_canvas_cell: [
    "id",
    "organization_id",
    "transformation_id",
    "dimension_code",
    "current_design",
    "target_design",
    "owner_user_id",
    "status",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  tom_gap: [
    "id",
    "organization_id",
    "transformation_id",
    "dimension_code",
    "current_state",
    "target_state",
    "gap",
    "design_decision_id",
    "owner_user_id",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  capability: [
    "id",
    "organization_id",
    "transformation_id",
    "name",
    "description",
    "dimension_code",
    "current_level",
    "target_level",
    "sourcing_need",
    "owner_user_id",
    "tom_gap_id",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  journey: [
    "id",
    "organization_id",
    "transformation_id",
    "name",
    "kind",
    "state",
    "description",
    "dimension_code",
    "steps",
    "cycle_time_value",
    "cycle_time_unit",
    "failure_demand",
    "owner_user_id",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  journey_pain_point: [
    "id",
    "organization_id",
    "transformation_id",
    "journey_id",
    "step_key",
    "description",
    "diagnostic_item_id",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  decision: [
    "id",
    "organization_id",
    "transformation_id",
    "kind",
    "code",
    "title",
    "context",
    "owner_user_id",
    "due_date",
    "status",
    "recommendation_option_id",
    "recommendation_text",
    "chosen_option_id",
    "outcome_text",
    "decided_by",
    "decided_at",
    "tom_dimension_code",
    "source_workshop_item_id",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
    "why_now",
    "impact_of_delay",
    "ask_origin",
    "created_source",
    "source_agenda_item_id",
    "decision_right_id",
    "sla_due_date",
    "sla_unknown_reason",
    "decided_on_behalf_of_user_id",
    "blocker_record_type",
    "blocker_record_id",
  ],
  decision_option: [
    "id",
    "organization_id",
    "transformation_id",
    "decision_id",
    "label",
    "title",
    "description",
    "ordinal",
    "status",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  record_code_counter: ["transformation_id", "prefix", "last_value"],
  tom_workshop: [
    "id",
    "organization_id",
    "transformation_id",
    "title",
    "workshop_date",
    "duration_minutes",
    "agenda",
    "facilitator_user_id",
    "status",
    "closed_at",
    "closed_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  tom_workshop_participant: [
    "id",
    "organization_id",
    "transformation_id",
    "workshop_id",
    "user_id",
    "is_business_owner",
    "status",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  tom_workshop_item: [
    "id",
    "organization_id",
    "transformation_id",
    "workshop_id",
    "dimension_code",
    "kind",
    "body",
    "owner_user_id",
    "status",
    "converted_decision_id",
    "converted_action_id",
    "converted_at",
    "converted_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  action_item: [
    "id",
    "organization_id",
    "transformation_id",
    "title",
    "description",
    "owner_user_id",
    "due_date",
    "status",
    "source_workshop_item_id",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
    "raid_entry_id",
    "dependency_id",
    "corrective_case_id",
    "follow_up_date",
  ],
  dependency: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "description",
    "from_kind",
    "from_label",
    "to_kind",
    "to_label",
    "dependency_type",
    "needed_by",
    "owner_user_id",
    "status",
    "mitigation",
    "tom_dimension_code",
    "decision_id",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
    "from_initiative_id",
    "to_initiative_id",
    "impact",
  ],
  gate_instance: [
    "id",
    "organization_id",
    "transformation_id",
    "gate_code",
    "status",
    "approver_role_code",
    "approver_user_id",
    "current_submission_id",
    "latest_submission_no",
    "approved_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  gate_submission: [
    "id",
    "organization_id",
    "transformation_id",
    "gate_instance_id",
    "gate_code",
    "submission_no",
    "status",
    "submitted_by",
    "submitted_at",
    "submission_note",
    "approver_role_code",
    "approver_user_id",
    "due_date",
    "charter_id",
    "charter_version_no",
    "snapshot",
    "snapshot_sha256",
    "superseded_at",
    "superseded_by_submission_id",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  gate_submission_criterion: [
    "id",
    "organization_id",
    "transformation_id",
    "gate_submission_id",
    "criterion_key",
    "ordinal",
    "mandatory",
    "completeness",
    "detail",
    "evaluated_at",
    "gate_exception_id",
  ],
  gate_decision: [
    "id",
    "organization_id",
    "transformation_id",
    "gate_submission_id",
    "decision_id",
    "decision_kind",
    "gate_code",
    "submission_no",
    "outcome",
    "rationale",
    "comments",
    "decided_by",
    "on_behalf_of_user_id",
    "decided_at",
    "approver_basis",
    "approver_role_code",
  ],
  role_accountability: [
    "role_id",
    "accountability_en",
    "accountability_ar",
    "is_source_text",
    "source_ref",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  roadmap_wave: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "ordinal",
    "is_source_seeded",
    "source_ref",
    "name_en",
    "name_ar",
    "purpose_en",
    "purpose_ar",
    "horizon_en",
    "horizon_ar",
    "entry_criteria_en",
    "entry_criteria_ar",
    "exit_evidence_en",
    "exit_evidence_ar",
    "horizon_from_weeks",
    "horizon_to_weeks",
    "planned_start",
    "planned_end",
    "owner_user_id",
    "notes",
    "status",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  initiative: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "name",
    "executive_owner_user_id",
    "workstream_lead_user_id",
    "problem_statement",
    "objective",
    "scope_in",
    "scope_out",
    "financial_benefit_summary",
    "customer_benefit_summary",
    "risks_summary",
    "wave_id",
    "planned_start",
    "planned_end",
    "status",
    "launched_at",
    "launched_by",
    "cancelled_at",
    "cancelled_by",
    "cancel_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
    "delivery_completed_at",
    "delivery_completed_by",
    "adoption_status",
    "adoption_status_note",
    "adoption_status_set_at",
    "adoption_status_set_by",
  ],
  initiative_gap_link: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "target_type",
    "tom_gap_id",
    "diagnostic_finding_id",
    "note",
    "status",
    "removed_at",
    "removed_by",
    "remove_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  initiative_outcome_contribution: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "outcome_id",
    "outcome_kpi_id",
    "contribution_statement",
    "expected_kpi_movement",
    "status",
    "removed_at",
    "removed_by",
    "remove_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
    "allocation_share",
    "allocation_basis",
  ],
  initiative_decision_link: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "decision_id",
    "status",
    "removed_at",
    "removed_by",
    "remove_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  deliverable: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "ordinal",
    "title",
    "description",
    "owner_user_id",
    "due_date",
    "acceptance_status",
    "submitted_by",
    "submitted_at",
    "decided_by",
    "decided_at",
    "acceptance_note",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  milestone: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "wave_id",
    "title",
    "description",
    "owner_user_id",
    "approved_date",
    "approved_by",
    "approved_at",
    "approval_reason",
    "forecast_date",
    "actual_date",
    "status",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  gate_dispensation: [
    "id",
    "organization_id",
    "transformation_id",
    "kind",
    "gate_code",
    "initiative_id",
    "reason",
    "approving_body",
    "approved_on",
    "evidence_id",
    "expires_on",
    "status",
    "recorded_by",
    "decided_by",
    "decided_at",
    "decision_note",
    "revoked_by",
    "revoked_at",
    "revoke_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  scoring_weight_set: [
    "id",
    "organization_id",
    "transformation_id",
    "version_no",
    "status",
    "approval_basis",
    "rationale",
    "approved_by",
    "approved_at",
    "activated_at",
    "superseded_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  scoring_weight: [
    "id",
    "organization_id",
    "transformation_id",
    "weight_set_id",
    "criterion_code",
    "weight_percent",
    "created_at",
    "created_by",
  ],
  initiative_score: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "criterion_code",
    "score",
    "note",
    "scored_by",
    "scored_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  initiative_score_result: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "weight_set_id",
    "weight_set_version_no",
    "weighted_score",
    "completeness",
    "missing_criteria",
    "inputs",
    "cause",
    "computed_at",
    "computed_by",
  ],
  ranking_snapshot: [
    "id",
    "organization_id",
    "transformation_id",
    "snapshot_no",
    "weight_set_id",
    "status",
    "note",
    "proposed_by",
    "proposed_at",
    "superseded_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  ranking_override: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "override_rank",
    "reason",
    "status",
    "proposed_by",
    "decided_by",
    "decided_at",
    "decision_note",
    "revoked_by",
    "revoked_at",
    "revoke_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  ranking_entry: [
    "id",
    "organization_id",
    "transformation_id",
    "snapshot_id",
    "initiative_id",
    "rank",
    "weighted_score",
    "completeness",
    "score_result_id",
    "previous_rank",
    "causes",
    "cause_detail",
    "override_id",
    "created_at",
    "created_by",
  ],
  dependency_type: [
    "id",
    "code",
    "label_en",
    "label_ar",
    "is_system",
    "source_ref",
    "ordinal",
    "status",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  resource_role: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "label_en",
    "label_ar",
    "status",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  capacity: [
    "id",
    "organization_id",
    "transformation_id",
    "resource_role_id",
    "period_month",
    "available_fte",
    "owner_user_id",
    "note",
    "status",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  resource_demand: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "resource_role_id",
    "period_month",
    "demand_fte",
    "owner_user_id",
    "note",
    "status",
    "committed_by",
    "committed_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  portfolio_selection: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "action",
    "rationale",
    "ranking_snapshot_id",
    "decided_by",
    "on_behalf_of_user_id",
    "decided_at",
  ],
  funding_decision: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "decision_id",
    "decision_kind",
    "outcome",
    "amount",
    "currency",
    "funding_source",
    "conditions",
    "rationale",
    "business_case_id",
    "approver_role_code",
    "decided_by",
    "on_behalf_of_user_id",
    "decided_at",
  ],
  benefit_formula: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "benefit_name",
    "baseline_driver",
    "change_assumption",
    "ramp",
    "confidence",
    "owner_user_id",
    "current_version_no",
    "is_illustrative",
    "example_code",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_formula_version: [
    "id",
    "organization_id",
    "transformation_id",
    "formula_id",
    "version_no",
    "expression",
    "expression_sha256",
    "result_kind",
    "result_unit",
    "result_currency",
    "result_period",
    "preview_result",
    "engine_version",
    "change_note",
    "validation_status",
    "validated_by",
    "validated_at",
    "validation_note",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_formula_variable: [
    "id",
    "organization_id",
    "transformation_id",
    "formula_version_id",
    "ordinal",
    "name",
    "kind",
    "unit",
    "currency",
    "period",
    "value",
    "description",
    "source",
    "created_at",
    "created_by",
  ],
  benefit_calculation: [
    "id",
    "organization_id",
    "transformation_id",
    "formula_version_id",
    "inputs",
    "assumptions",
    "period_start",
    "period_end",
    "outcome",
    "result",
    "result_kind",
    "result_unit",
    "result_currency",
    "result_period",
    "error_code",
    "rounded",
    "engine_version",
    "computed_at",
    "computed_by",
    "rounding",
  ],
  business_case: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "level",
    "initiative_id",
    "parent_case_id",
    "title",
    "currency",
    "strategic_rationale",
    "baseline_summary",
    "value_pools_summary",
    "interventions_summary",
    "investment_summary",
    "benefits_summary",
    "benefit_ramp",
    "recurrence_summary",
    "implementation_horizon",
    "key_assumptions",
    "downside_case",
    "upside_case",
    "benefit_owner_user_id",
    "initiative_owner_user_id",
    "finance_validator_user_id",
    "decision_ask_types",
    "decision_ask_text",
    "baseline_validation_status",
    "baseline_validated_by",
    "baseline_validated_at",
    "baseline_validation_note",
    "baseline_validated_sha256",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  business_case_line: [
    "id",
    "organization_id",
    "transformation_id",
    "business_case_id",
    "line_kind",
    "investment_class",
    "benefit_class",
    "value_basis",
    "title",
    "description",
    "amount",
    "currency",
    "fte",
    "period_start",
    "period_end",
    "recurrence",
    "benefit_formula_id",
    "owner_user_id",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_formula_example: [
    "id",
    "code",
    "methodology_version_id",
    "ordinal",
    "source_benefit_en",
    "source_baseline_driver_en",
    "source_change_assumption_en",
    "source_formula_en",
    "source_ramp_en",
    "source_confidence",
    "benefit_ar",
    "baseline_driver_ar",
    "change_assumption_ar",
    "formula_ar",
    "expression",
    "result_kind",
    "result_currency",
    "result_period",
    "example_result",
    "is_illustrative",
    "source_ref",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_formula_example_variable: [
    "id",
    "example_id",
    "ordinal",
    "name",
    "kind",
    "unit",
    "currency",
    "period",
    "example_value",
    "label_en",
    "label_ar",
  ],
  gate_decision_agreement: [
    "id",
    "organization_id",
    "transformation_id",
    "gate_decision_id",
    "agreement_code",
    "confirmed_by",
    "confirmed_at",
  ],
  business_calendar: [
    "id",
    "organization_id",
    "code",
    "name_en",
    "name_ar",
    "timezone",
    "workweek",
    "is_default",
    "status",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  business_calendar_holiday: [
    "id",
    "organization_id",
    "calendar_id",
    "date_from",
    "date_to",
    "name_en",
    "name_ar",
    "status",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  job_schedule: [
    "id",
    "code",
    "queue_name",
    "cron",
    "timezone",
    "enabled",
    "description_en",
    "description_ar",
    "owner_module",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  work_item_kind: ["code", "owner_module", "label_en", "label_ar", "source_ref"],
  work_item: [
    "id",
    "organization_id",
    "transformation_id",
    "kind",
    "assignee_user_id",
    "subject_type",
    "subject_id",
    "link_path",
    "message_key",
    "message_params",
    "due_date",
    "period_label",
    "status",
    "completed_at",
    "completed_by",
    "dedupe_key",
    "created_source",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  inbox_notification: [
    "id",
    "organization_id",
    "transformation_id",
    "recipient_user_id",
    "work_item_id",
    "link_path",
    "message_key",
    "message_params",
    "dedupe_key",
    "read_at",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  access_group: [
    "id",
    "organization_id",
    "code",
    "name_en",
    "name_ar",
    "description",
    "owner_user_id",
    "status",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  access_group_member: [
    "id",
    "organization_id",
    "group_id",
    "user_id",
    "effective_from",
    "effective_to",
    "removed_at",
    "removed_by",
    "remove_reason",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  governance_party: ["code", "ordinal", "kind", "role_code", "label_en", "label_ar", "source_ref"],
  role_mapping: [
    "id",
    "organization_id",
    "transformation_id",
    "party_code",
    "target_kind",
    "user_id",
    "group_id",
    "status",
    "ended_at",
    "ended_by",
    "end_reason",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  decision_right_template: [
    "key",
    "ordinal",
    "source_decision_en",
    "source_recommend_en",
    "source_approve_en",
    "source_consult_en",
    "source_inform_en",
    "source_sla_en",
    "decision_ar",
    "recommend_ar",
    "approve_ar",
    "consult_ar",
    "inform_ar",
    "sla_ar",
    "recommend_parties",
    "approve_party_code",
    "consult_parties",
    "inform_parties",
    "sla_type",
    "sla_working_days",
    "escalation_chain",
    "source_ref",
  ],
  governance_matrix: [
    "id",
    "organization_id",
    "transformation_id",
    "kind",
    "status",
    "approved_version",
    "approved_at",
    "approved_by",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  transformation_decision_right: [
    "id",
    "organization_id",
    "transformation_id",
    "template_key",
    "ordinal",
    "decision_en",
    "decision_ar",
    "recommend_label",
    "approve_label",
    "consult_label",
    "inform_label",
    "sla_label",
    "recommend_parties",
    "approve_party_code",
    "consult_parties",
    "inform_parties",
    "sla_type",
    "sla_working_days",
    "urgent_working_days",
    "escalation_chain",
    "status",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  raci_template_deliverable: ["key", "ordinal", "source_deliverable_en", "deliverable_ar", "source_ref"],
  raci_template_cell: ["deliverable_key", "party_code", "value"],
  transformation_raci_deliverable: [
    "id",
    "organization_id",
    "transformation_id",
    "template_key",
    "ordinal",
    "label_en",
    "label_ar",
    "accountability_exception",
    "status",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  transformation_raci_assignment: [
    "id",
    "organization_id",
    "transformation_id",
    "deliverable_id",
    "party_code",
    "value",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  approval_type: [
    "code",
    "subject_table",
    "default_sod_policy",
    "requires_decision_right",
    "owner_module",
    "label_en",
    "label_ar",
    "source_ref",
  ],
  approval: [
    "id",
    "organization_id",
    "transformation_id",
    "approval_type",
    "subject_type",
    "subject_id",
    "subject_version",
    "round_no",
    "decision_right_id",
    "title",
    "request_note",
    "requested_by",
    "requested_at",
    "request_business_date",
    "assignee_party_code",
    "assignee_user_id",
    "assignee_group_id",
    "sla_type",
    "urgent_reason",
    "due_date",
    "due_unknown_reason",
    "calendar_id",
    "calendar_version",
    "sod_policy",
    "status",
    "escalation_level",
    "escalated_to_party_code",
    "escalated_to_user_id",
    "escalated_to_group_id",
    "decided_by",
    "decided_on_behalf_of",
    "decided_at",
    "version",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ],
  approval_decision: [
    "id",
    "organization_id",
    "transformation_id",
    "approval_id",
    "round_no",
    "outcome",
    "rationale",
    "comments",
    "subject_version",
    "decided_by",
    "on_behalf_of_user_id",
    "decided_at",
    "business_date",
    "defer_until",
  ],
  approval_escalation: [
    "id",
    "organization_id",
    "transformation_id",
    "approval_id",
    "round_no",
    "due_date",
    "level",
    "from_party_code",
    "to_party_code",
    "to_user_id",
    "to_group_id",
    "routing_error",
    "escalated_at",
  ],
  approval_decision_record: [
    "source",
    "record_id",
    "organization_id",
    "transformation_id",
    "approval_kind",
    "subject_type",
    "subject_id",
    "subject_version",
    "outcome",
    "rationale",
    "decided_by",
    "on_behalf_of_user_id",
    "decided_at",
  ],
  reporting_period: [
    "id",
    "organization_id",
    "frequency",
    "period_label",
    "period_start",
    "period_end",
    "length_days",
    "basis",
    "week_count",
    "update_due_date",
    "status",
    "opened_at",
    "closed_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  kpi_version: [
    "id",
    "organization_id",
    "transformation_id",
    "kpi_definition_id",
    "version_no",
    "status",
    "measure_type",
    "value_nature",
    "entry_scope_kind",
    "unit_kind",
    "unit_label",
    "currency",
    "frequency",
    "numerator_label",
    "denominator_label",
    "calculation_method",
    "calculation_description",
    "formula_expression",
    "formula_engine_version",
    "aggregation_rule",
    "stock_additive_across_scopes",
    "ytd_start_month",
    "baseline_id",
    "baseline_value",
    "baseline_date",
    "target_value",
    "target_date",
    "band_lower",
    "band_upper",
    "milestone_due_date",
    "dq_stale_after_days",
    "dq_valid_min",
    "dq_valid_max",
    "dq_evidence_required",
    "submission_route",
    "reviewer_party_code",
    "definition_approval",
    "approval_id",
    "change_reason",
    "activated_at",
    "activated_by",
    "superseded_at",
    "withdrawn_at",
    "withdrawn_by",
    "withdraw_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  kpi_formula_input: [
    "id",
    "organization_id",
    "transformation_id",
    "kpi_version_id",
    "variable_name",
    "source_kpi_definition_id",
    "input_basis",
    "created_at",
    "created_by",
  ],
  kpi_rag_threshold: [
    "id",
    "organization_id",
    "transformation_id",
    "kpi_definition_id",
    "version_no",
    "tolerance_mode",
    "amber_threshold",
    "red_threshold",
    "reason",
    "status",
    "superseded_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  target_trajectory: [
    "id",
    "organization_id",
    "transformation_id",
    "kpi_definition_id",
    "scope_kind",
    "scope_id",
    "version_no",
    "basis",
    "interpolation",
    "source",
    "source_outcome_kpi_id",
    "status",
    "approved_by",
    "approved_at",
    "approved_record_version",
    "superseded_at",
    "withdrawn_at",
    "withdraw_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  target_trajectory_point: [
    "id",
    "organization_id",
    "transformation_id",
    "target_trajectory_id",
    "point_date",
    "expected_value",
    "created_at",
    "created_by",
  ],
  kpi_actual: [
    "id",
    "organization_id",
    "transformation_id",
    "kpi_definition_id",
    "scope_kind",
    "scope_id",
    "reporting_period_id",
    "period_start",
    "period_end",
    "period_label",
    "current_value_no",
    "accepted_value_no",
    "status",
    "route",
    "submitted_by",
    "submitted_at",
    "decided_by",
    "decided_at",
    "decision_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  kpi_actual_value: [
    "id",
    "organization_id",
    "transformation_id",
    "kpi_actual_id",
    "value_no",
    "kpi_version_id",
    "value",
    "numerator",
    "denominator",
    "milestone_achieved",
    "achieved_on",
    "currency",
    "missing_reason",
    "data_as_of",
    "comment",
    "entered_at",
    "entered_by",
    "business_date",
  ],
  kpi_actual_review: [
    "id",
    "organization_id",
    "transformation_id",
    "kpi_actual_id",
    "value_no",
    "outcome",
    "reason",
    "decided_by",
    "on_behalf_of_user_id",
    "decided_at",
    "business_date",
  ],
  kpi_actual_evidence: [
    "id",
    "organization_id",
    "transformation_id",
    "kpi_actual_id",
    "value_no",
    "evidence_id",
    "linked_at",
    "linked_by",
  ],
  calculation_run: [
    "id",
    "seq",
    "organization_id",
    "transformation_id",
    "trigger_kind",
    "trigger_record_type",
    "trigger_record_id",
    "trigger_slot",
    "idempotency_key",
    "status",
    "error_code",
    "evaluation_count",
    "finding_count",
    "formula_engine_version",
    "kpi_rules_version",
    "started_at",
    "completed_at",
  ],
  kpi_evaluation: [
    "id",
    "organization_id",
    "transformation_id",
    "calculation_run_id",
    "kpi_definition_id",
    "kpi_version_id",
    "scope_kind",
    "scope_id",
    "reporting_period_id",
    "period_label",
    "value_basis",
    "value",
    "value_status",
    "value_reason",
    "value_source",
    "currency",
    "inputs",
    "rounding",
    "expected_value",
    "final_target",
    "variance",
    "variance_ratio",
    "comparison_flag",
    "trend",
    "previous_period_id",
    "data_as_of",
    "calculated_rag",
    "deviation",
    "threshold_id",
    "threshold_source",
    "target_trajectory_id",
    "explanation_key",
    "explanation_params",
    "evaluated_at",
  ],
  data_quality_finding: [
    "id",
    "organization_id",
    "transformation_id",
    "kpi_definition_id",
    "scope_kind",
    "scope_id",
    "reporting_period_id",
    "kpi_actual_id",
    "value_no",
    "rule_code",
    "severity",
    "detail_params",
    "detected_by_run_id",
    "detected_at",
    "status",
    "resolution_note",
    "resolved_by",
    "resolved_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  rag_override: [
    "id",
    "organization_id",
    "transformation_id",
    "kpi_definition_id",
    "scope_kind",
    "scope_id",
    "reporting_period_id",
    "override_rag",
    "calculated_rag",
    "kpi_evaluation_id",
    "reason",
    "evidence_id",
    "expires_at",
    "status",
    "revoked_by",
    "revoked_at",
    "revoke_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_lifecycle_step_definition: [
    "code",
    "ordinal",
    "step_en",
    "question_en",
    "output_en",
    "step_ar",
    "question_ar",
    "output_ar",
    "ar_is_provisional",
    "source_ref",
  ],
  benefit_valuation_method: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "name",
    "method",
    "applies_to_type",
    "kpi_definition_id",
    "unit_value",
    "currency",
    "status",
    "decided_by",
    "decided_at",
    "decision_note",
    "retired_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_group: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "title",
    "description",
    "counted_benefit_id",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "title",
    "description",
    "benefit_type",
    "value_class",
    "owner_user_id",
    "finance_validator_user_id",
    "finance_validation_required",
    "financial_statement_line",
    "measurement_kpi_definition_id",
    "measurement_kpi_variable",
    "business_case_line_id",
    "benefit_formula_id",
    "baseline_id",
    "baseline_value",
    "baseline_unit",
    "baseline_date",
    "counterfactual",
    "baseline_validation_status",
    "baseline_validated_by",
    "baseline_validated_at",
    "baseline_validation_note",
    "driver_key",
    "driver_units",
    "population_key",
    "target_value",
    "target_date",
    "realization_start",
    "realization_end",
    "recurrence",
    "currency",
    "planned_value",
    "valuation_method_id",
    "measurement_source",
    "confidence",
    "assumptions",
    "parent_benefit_id",
    "benefit_group_id",
    "allocation_set_no",
    "lifecycle_step",
    "recovery_plan",
    "bau_owner_user_id",
    "control_cadence",
    "status_rag",
    "status_rag_note",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_enabler: [
    "id",
    "organization_id",
    "transformation_id",
    "benefit_id",
    "initiative_id",
    "deliverable_id",
    "capability_id",
    "note",
    "status",
    "removed_at",
    "removed_by",
    "remove_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_lifecycle_event: [
    "id",
    "organization_id",
    "transformation_id",
    "benefit_id",
    "from_step",
    "to_step",
    "benefit_version",
    "occurred_at",
    "actor_user_id",
  ],
  benefit_allocation: [
    "id",
    "organization_id",
    "transformation_id",
    "benefit_id",
    "set_no",
    "initiative_id",
    "share",
    "basis",
    "created_at",
    "created_by",
  ],
  benefit_scenario: [
    "id",
    "organization_id",
    "transformation_id",
    "business_case_id",
    "kind",
    "title",
    "assumptions",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_scenario_value: [
    "id",
    "organization_id",
    "transformation_id",
    "scenario_id",
    "benefit_id",
    "period_start",
    "period_end",
    "amount",
    "kpi_value",
    "currency",
    "note",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_plan_value: [
    "id",
    "organization_id",
    "transformation_id",
    "benefit_id",
    "value_kind",
    "period_start",
    "period_end",
    "amount",
    "kpi_value",
    "currency",
    "note",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_measurement: [
    "id",
    "organization_id",
    "transformation_id",
    "benefit_id",
    "measurement_no",
    "kind",
    "corrects_measurement_id",
    "source",
    "calculation_run_id",
    "benefit_calculation_id",
    "formula_version_id",
    "period_start",
    "period_end",
    "amount",
    "kpi_value",
    "currency",
    "missing_reason",
    "attribution",
    "assumptions",
    "status",
    "sustain_phase",
    "validated_amount",
    "submitted_by",
    "submitted_at",
    "decided_by",
    "decided_at",
    "reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_measurement_input: [
    "id",
    "organization_id",
    "transformation_id",
    "measurement_id",
    "variable_name",
    "kpi_actual_id",
    "kpi_value_no",
    "value",
    "period_start",
    "period_end",
    "created_at",
    "created_by",
  ],
  benefit_evidence: [
    "id",
    "organization_id",
    "transformation_id",
    "benefit_id",
    "measurement_id",
    "evidence_id",
    "created_at",
    "created_by",
  ],
  finance_validation: [
    "id",
    "organization_id",
    "transformation_id",
    "benefit_id",
    "benefit_measurement_id",
    "kind",
    "corrects_validation_id",
    "idempotency_key",
    "assignee_user_id",
    "status",
    "content",
    "measurement_period_start",
    "measurement_period_end",
    "baseline_decision",
    "attribution_decision",
    "calculation_decision",
    "evidence_decision",
    "period_decision",
    "assumptions_decision",
    "baseline_note",
    "attribution_note",
    "calculation_note",
    "evidence_note",
    "period_note",
    "assumptions_note",
    "approved_amount",
    "decision_note",
    "decided_by",
    "decided_at",
    "reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_overlap: [
    "id",
    "organization_id",
    "transformation_id",
    "benefit_a_id",
    "benefit_b_id",
    "dimensions",
    "driver_key",
    "population_key",
    "overlap_start",
    "overlap_end",
    "detected_by",
    "status",
    "resolution",
    "excluded_benefit_id",
    "resolution_note",
    "resolved_by",
    "resolved_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  benefit_counting: [
    "benefit_id",
    "organization_id",
    "transformation_id",
    "value_class",
    "currency",
    "counted",
    "exclusion_reason",
    "overlap_open",
  ],
  benefit_value_line: [
    "benefit_id",
    "transformation_id",
    "value_state",
    "period_start",
    "period_end",
    "amount",
    "kpi_value",
    "currency",
    "record_table",
    "record_id",
  ],
  raid_entry: [
    "id",
    "organization_id",
    "transformation_id",
    "entry_type",
    "code",
    "description",
    "impact",
    "probability",
    "owner_user_id",
    "due_date",
    "mitigation",
    "initiative_id",
    "status",
    "closed_at",
    "closed_by",
    "closure_note",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  raid_register: [
    "id",
    "organization_id",
    "transformation_id",
    "entry_type",
    "code",
    "description",
    "impact",
    "probability",
    "owner_user_id",
    "due_date",
    "mitigation",
    "raid_status",
    "record_status",
    "record_table",
    "initiative_id",
    "version",
    "created_at",
    "updated_at",
  ],
  corrective_action_rule: [
    "id",
    "organization_id",
    "transformation_id",
    "source_kind",
    "min_kpi_rag",
    "persistence_cycles",
    "follow_up_working_days",
    "enabled",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  corrective_case: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "source_kind",
    "source_scope_key",
    "kpi_definition_id",
    "kpi_scope_kind",
    "kpi_scope_id",
    "benefit_id",
    "source_record_type",
    "source_record_id",
    "title",
    "recovery_plan",
    "owner_user_id",
    "follow_up_date",
    "follow_up_calendar_id",
    "follow_up_calendar_version",
    "status",
    "consecutive_off_track",
    "signal_count",
    "last_signal_at",
    "closed_at",
    "closed_by",
    "closure_note",
    "created_source",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  corrective_signal: [
    "id",
    "organization_id",
    "transformation_id",
    "source_kind",
    "source_scope_key",
    "source_event_key",
    "period_key",
    "period_start",
    "period_end",
    "observed_rag",
    "off_track",
    "rule_persistence",
    "consecutive_off_track",
    "outcome",
    "corrective_case_id",
    "payload",
    "received_at",
  ],
  budget_line: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "label",
    "period_month",
    "currency",
    "budget_amount",
    "actual_amount",
    "forecast_amount",
    "owner_user_id",
    "note",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  initiative_schedule: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "duration_working_days",
    "note",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  forum_template: [
    "key",
    "ordinal",
    "source_layer_en",
    "source_cadence_en",
    "source_purpose_en",
    "source_participants_en",
    "source_outputs_en",
    "layer_ar",
    "cadence_ar",
    "purpose_ar",
    "participants_ar",
    "outputs_ar",
    "ar_provisional",
    "chair_party_code",
    "participant_parties",
    "output_kinds",
    "publish_requires_any_output",
    "executive_asks_only",
    "default_frequency",
    "default_interval",
    "source_ref",
  ],
  forum: [
    "id",
    "organization_id",
    "transformation_id",
    "template_key",
    "ordinal",
    "name_en",
    "name_ar",
    "cadence_label",
    "purpose",
    "participants_label",
    "outputs_label",
    "chair_party_code",
    "secretary_user_id",
    "participant_parties",
    "output_kinds",
    "publish_requires_any_output",
    "executive_asks_only",
    "quorum_min",
    "cutoff_working_days",
    "agenda_max_items",
    "late_items_rule",
    "status",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  forum_participant: [
    "id",
    "organization_id",
    "transformation_id",
    "forum_id",
    "user_id",
    "group_id",
    "counts_for_quorum",
    "status",
    "removed_at",
    "removed_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  meeting_series: [
    "id",
    "organization_id",
    "transformation_id",
    "forum_id",
    "frequency",
    "interval_count",
    "weekdays",
    "month_day",
    "start_date",
    "end_date",
    "start_time",
    "duration_minutes",
    "timezone",
    "non_working_day_rule",
    "horizon_days",
    "location",
    "rule_version",
    "generated_through",
    "status",
    "ended_at",
    "ended_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  meeting: [
    "id",
    "organization_id",
    "transformation_id",
    "forum_id",
    "series_id",
    "series_rule_version",
    "occurrence_date",
    "scheduled_date",
    "starts_at",
    "ends_at",
    "timezone",
    "location",
    "chair_user_id",
    "secretary_user_id",
    "quorum_min",
    "cutoff_date",
    "cutoff_unknown_reason",
    "status",
    "cancel_reason",
    "cancel_note",
    "cancelled_at",
    "cancelled_by",
    "started_at",
    "held_at",
    "created_source",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  agenda_item: [
    "id",
    "organization_id",
    "transformation_id",
    "meeting_id",
    "ordinal",
    "item_kind",
    "title",
    "description",
    "presenter_user_id",
    "duration_minutes",
    "materials_evidence_ids",
    "decision_id",
    "ask_decision_required",
    "ask_why_now",
    "ask_options",
    "ask_recommendation",
    "ask_impact_of_delay",
    "ask_owner_user_id",
    "ask_required_date",
    "late",
    "status",
    "published_at",
    "published_by",
    "outcome",
    "outcome_quorum_present",
    "outcome_recorded_at",
    "outcome_recorded_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  meeting_attendance: [
    "id",
    "organization_id",
    "transformation_id",
    "meeting_id",
    "user_id",
    "attendance",
    "counts_for_quorum",
    "on_behalf_of_user_id",
    "note",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  meeting_output: [
    "id",
    "organization_id",
    "transformation_id",
    "meeting_id",
    "agenda_item_id",
    "output_kind",
    "record_type",
    "record_id",
    "note",
    "created_at",
    "created_by",
  ],
  meeting_action_link: [
    "id",
    "organization_id",
    "transformation_id",
    "meeting_id",
    "agenda_item_id",
    "action_item_id",
    "link_kind",
    "created_at",
    "created_by",
  ],
  meeting_minutes: [
    "id",
    "organization_id",
    "transformation_id",
    "meeting_id",
    "body",
    "status",
    "approved_at",
    "approved_by",
    "published_at",
    "published_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  governance_escalation_rule: [
    "id",
    "organization_id",
    "transformation_id",
    "rule_kind",
    "enabled",
    "escalation_chain",
    "red_cycles",
    "deadline_working_days",
    "owner_party_code",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  decision_escalation: [
    "id",
    "organization_id",
    "transformation_id",
    "decision_id",
    "sla_due_date",
    "business_date",
    "level",
    "party_code",
    "target_user_id",
    "target_group_id",
    "routing_error",
    "delay_impact",
    "escalated_at",
  ],
  blocker_status: [
    "id",
    "organization_id",
    "transformation_id",
    "meeting_id",
    "forum_id",
    "cycle_date",
    "source_record_type",
    "source_record_id",
    "rag",
    "note",
    "created_at",
    "created_by",
  ],
  adoption_indicator_template: [
    "key",
    "indicator_key",
    "indicator_ordinal",
    "measure_ordinal",
    "source_indicator_en",
    "indicator_ar",
    "measure_en",
    "measure_ar",
    "ar_provisional",
    "unit_kind",
    "polarity",
    "value_nature",
    "aggregation_rule",
    "value_source",
    "source_ref",
  ],
  stakeholder_group: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "name",
    "description",
    "influence",
    "impact",
    "current_stance",
    "required_behavior",
    "intervention_types",
    "intervention_plan",
    "owner_user_id",
    "adoption_kpi_definition_id",
    "headcount",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  stakeholder_champion: [
    "id",
    "organization_id",
    "transformation_id",
    "stakeholder_group_id",
    "user_id",
    "note",
    "status",
    "removed_at",
    "removed_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  adoption_metric_link: [
    "id",
    "organization_id",
    "transformation_id",
    "template_key",
    "kpi_definition_id",
    "target_kind",
    "outcome_id",
    "initiative_id",
    "stakeholder_group_id",
    "status",
    "removed_at",
    "removed_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  adoption_intervention: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "stakeholder_group_id",
    "intervention_type",
    "title",
    "description",
    "owner_user_id",
    "due_date",
    "status",
    "origin",
    "metric_link_id",
    "kpi_evaluation_id",
    "reporting_period_id",
    "scope_kind",
    "scope_id",
    "trigger_key",
    "outcome_note",
    "completed_at",
    "completed_by",
    "created_source",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  assessment_form: [
    "id",
    "organization_id",
    "transformation_id",
    "kind",
    "name",
    "description",
    "stakeholder_group_id",
    "status",
    "current_version_no",
    "published_version_no",
    "published_at",
    "published_by",
    "retired_at",
    "retired_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  assessment_form_version: [
    "id",
    "organization_id",
    "transformation_id",
    "form_id",
    "version_no",
    "schema",
    "created_at",
    "created_by",
  ],
  assessment_invitation: [
    "id",
    "organization_id",
    "transformation_id",
    "form_id",
    "user_id",
    "stakeholder_group_id",
    "subject_user_id",
    "due_date",
    "status",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  training_record: [
    "id",
    "organization_id",
    "transformation_id",
    "stakeholder_group_id",
    "intervention_id",
    "participant_user_id",
    "participant_label",
    "training_title",
    "scheduled_on",
    "status",
    "completed_on",
    "recorded_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  assessment_record: [
    "id",
    "organization_id",
    "transformation_id",
    "form_id",
    "form_version_id",
    "invitation_id",
    "stakeholder_group_id",
    "kind",
    "respondent_user_id",
    "subject_user_id",
    "subject_label",
    "observed_on",
    "answers",
    "proficiency_result",
    "status",
    "reviewed_at",
    "reviewed_by",
    "review_note",
    "withdrawn_at",
    "withdrawn_by",
    "withdraw_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  stakeholder_involvement: [
    "id",
    "organization_id",
    "transformation_id",
    "stakeholder_group_id",
    "involvement_kind",
    "workshop_id",
    "decision_id",
    "note",
    "withdraws_involvement_id",
    "created_at",
    "created_by",
  ],
  champion_constraint: [
    "id",
    "organization_id",
    "transformation_id",
    "champion_id",
    "stakeholder_group_id",
    "decision_id",
    "constraint_text",
    "status",
    "response_text",
    "resolved_at",
    "resolved_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  performance_area: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "name",
    "description",
    "business_unit_id",
    "sponsor_user_id",
    "bau_owner_user_id",
    "kpi_owner_user_id",
    "review_frequency",
    "review_interval",
    "next_review_date",
    "cycle_no",
    "status",
    "current_handover_id",
    "retired_at",
    "retired_by",
    "retire_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  performance_area_cycle: [
    "id",
    "organization_id",
    "transformation_id",
    "performance_area_id",
    "cycle_no",
    "opened_at",
    "opened_by",
    "reopen_reason",
    "prior_handover_id",
    "prior_handover_accepted_at",
    "prior_handover_accepted_by",
    "prior_closure_record_id",
    "prior_closed_at",
    "created_at",
    "created_by",
  ],
  performance_area_link: [
    "id",
    "organization_id",
    "transformation_id",
    "performance_area_id",
    "link_kind",
    "kpi_definition_id",
    "benefit_id",
    "status",
    "removed_at",
    "removed_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  control: [
    "id",
    "organization_id",
    "transformation_id",
    "performance_area_id",
    "code",
    "name",
    "description",
    "owner_user_id",
    "frequency",
    "frequency_interval",
    "next_check_date",
    "status",
    "retired_at",
    "retired_by",
    "retire_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  control_check: [
    "id",
    "organization_id",
    "transformation_id",
    "control_id",
    "performance_area_id",
    "due_date",
    "assignee_user_id",
    "status",
    "performed_at",
    "performed_by",
    "result_note",
    "created_source",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  bau_handover: [
    "id",
    "organization_id",
    "transformation_id",
    "performance_area_id",
    "cycle_no",
    "code",
    "receiving_owner_user_id",
    "kpi_owner_user_id",
    "operating_procedures",
    "capability_readiness",
    "unresolved_accepted_risks",
    "benefit_monitoring_cadence",
    "data_access",
    "improvement_backlog_summary",
    "status",
    "submitted_at",
    "submitted_by",
    "accepted_at",
    "accepted_by",
    "acceptance_note",
    "returned_at",
    "returned_by",
    "return_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  bau_handover_evidence: [
    "id",
    "organization_id",
    "transformation_id",
    "handover_id",
    "evidence_id",
    "created_at",
    "created_by",
  ],
  transition_decision: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "benefit_id",
    "residual_owner_user_id",
    "rationale",
    "expected_realization_end",
    "monitoring_frequency",
    "monitoring_interval",
    "first_monitoring_date",
    "next_monitoring_date",
    "status",
    "approval_id",
    "decided_at",
    "decided_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  sustainment_review: [
    "id",
    "organization_id",
    "transformation_id",
    "subject_kind",
    "performance_area_id",
    "cycle_no",
    "transition_decision_id",
    "due_date",
    "assignee_user_id",
    "status",
    "completed_at",
    "completed_by",
    "outcome_note",
    "performance_signal",
    "created_source",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  lesson: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "performance_area_id",
    "title",
    "context",
    "lesson_text",
    "recommendation",
    "tags",
    "status",
    "published_at",
    "published_by",
    "archived_at",
    "archived_by",
    "search_document",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  improvement_item: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "performance_area_id",
    "title",
    "description",
    "source_kind",
    "lesson_id",
    "control_check_id",
    "review_id",
    "handover_id",
    "owner_user_id",
    "priority",
    "target_date",
    "status",
    "resolution_note",
    "resolved_at",
    "resolved_by",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  closure_record: [
    "id",
    "organization_id",
    "transformation_id",
    "subject_kind",
    "initiative_id",
    "basis",
    "snapshot",
    "closure_note",
    "closed_at",
    "closed_by",
    "created_at",
    "created_by",
  ],
  executive_decision_log: [
    "id",
    "organization_id",
    "transformation_id",
    "t16_id",
    "decision",
    "why_now",
    "options",
    "recommendation",
    "owner_user_id",
    "decision_date",
    "impact_of_delay",
    "outcome",
    "status",
    "ask_origin",
    "sla_due_date",
    "sla_unknown_reason",
    "decided_at",
    "decided_by",
    "blocker_record_type",
    "blocker_record_id",
    "version",
    "created_at",
    "updated_at",
  ],
  phase_definition: [
    "id",
    "code",
    "methodology_version_id",
    "ordinal",
    "gate_code",
    "source_name_en",
    "name_ar",
    "source_title_en",
    "title_ar",
    "source_purpose_en",
    "purpose_ar",
    "source_key_outputs_en",
    "key_outputs_ar",
    "source_objective_en",
    "objective_ar",
    "source_ref",
    "ar_provisional",
    "created_at",
  ],
  phase_step_definition: [
    "id",
    "key",
    "phase_code",
    "ordinal",
    "source_procedure_en",
    "procedure_ar",
    "required_evidence_en",
    "required_evidence_ar",
    "default_owner_role_code",
    "reviewer_role_code",
    "completion_rule",
    "source_ref",
    "ar_provisional",
    "created_at",
  ],
  phase_step: [
    "id",
    "organization_id",
    "transformation_id",
    "step_key",
    "phase_code",
    "owner_user_id",
    "status",
    "enabled_by_gate_decision_id",
    "review_requested_by",
    "review_requested_at",
    "completion_check",
    "reviewed_by",
    "reviewed_at",
    "review_outcome",
    "review_note",
    "completed_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  phase_step_evidence: [
    "id",
    "organization_id",
    "transformation_id",
    "phase_step_id",
    "evidence_id",
    "status",
    "removed_by",
    "removed_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  gate_criterion_review: [
    "id",
    "organization_id",
    "transformation_id",
    "gate_submission_id",
    "criterion_key",
    "review_no",
    "reviewer_user_id",
    "finding",
    "open_condition",
    "risk_note",
    "raid_entry_id",
    "recommendation",
    "rationale",
    "reviewed_at",
  ],
  gate_exception: [
    "id",
    "organization_id",
    "transformation_id",
    "gate_instance_id",
    "gate_code",
    "criterion_key",
    "reason",
    "scope",
    "compensating_action",
    "compensating_owner_user_id",
    "expires_on",
    "status",
    "requested_by",
    "requested_at",
    "decided_by",
    "decided_on_behalf_of",
    "decided_at",
    "decision_note",
    "revoked_by",
    "revoked_at",
    "revoke_reason",
    "expiry_notified_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  gate_decision_scale_scope: [
    "id",
    "organization_id",
    "transformation_id",
    "gate_decision_id",
    "initiative_id",
    "business_unit_id",
    "note",
    "created_at",
    "created_by",
  ],
  gate_decision_condition: [
    "id",
    "organization_id",
    "transformation_id",
    "gate_decision_id",
    "ordinal",
    "condition_text",
    "owner_user_id",
    "due_date",
    "created_at",
    "created_by",
  ],
  scale_transition: [
    "id",
    "organization_id",
    "transformation_id",
    "initiative_id",
    "business_unit_id",
    "gate_decision_id",
    "note",
    "transitioned_by",
    "transitioned_at",
  ],
  risk_disposition: [
    "id",
    "organization_id",
    "transformation_id",
    "raid_entry_id",
    "disposition",
    "rationale",
    "residual_owner_user_id",
    "version",
    "created_at",
    "created_by",
  ],
  change_control_policy: [
    "id",
    "organization_id",
    "transformation_id",
    "material_date_shift_working_days",
    "material_budget_change_ratio",
    "note",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  change_request: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "change_kind",
    "subject_type",
    "subject_id",
    "subject_version",
    "proposed_record_type",
    "proposed_record_id",
    "proposed_change",
    "reason",
    "origin",
    "materiality",
    "materiality_basis",
    "route_party_code",
    "decision_right_id",
    "status",
    "raised_by",
    "submitted_by",
    "submitted_at",
    "current_impact_assessment_id",
    "decided_at",
    "applied_at",
    "applied_record_type",
    "applied_record_id",
    "applied_version",
    "withdrawn_at",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  impact_assessment: [
    "id",
    "organization_id",
    "transformation_id",
    "change_request_id",
    "change_request_version",
    "item_count",
    "content_sha256",
    "assessed_at",
    "assessed_by",
  ],
  impact_assessment_item: [
    "id",
    "organization_id",
    "transformation_id",
    "impact_assessment_id",
    "ordinal",
    "item_type",
    "record_type",
    "record_id",
    "record_code",
    "label",
    "effect",
    "gate_submission_id",
    "gate_decision_id",
    "detail",
  ],
  portfolio: [
    "id",
    "organization_id",
    "code",
    "name",
    "description",
    "owner_user_id",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  portfolio_transformation: [
    "id",
    "organization_id",
    "transformation_id",
    "portfolio_id",
    "status",
    "removed_at",
    "removed_by",
    "remove_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  workstream: [
    "id",
    "organization_id",
    "transformation_id",
    "code",
    "name",
    "description",
    "lead_user_id",
    "status",
    "archived_at",
    "archived_by",
    "archive_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  workstream_initiative: [
    "id",
    "organization_id",
    "transformation_id",
    "workstream_id",
    "initiative_id",
    "status",
    "removed_at",
    "removed_by",
    "remove_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  trace_link: [
    "id",
    "organization_id",
    "transformation_id",
    "link_kind",
    "diagnostic_finding_id",
    "tom_gap_id",
    "deliverable_id",
    "capability_id",
    "outcome_kpi_id",
    "benefit_id",
    "contribution_statement",
    "allocation_share",
    "allocation_basis",
    "status",
    "removed_at",
    "removed_by",
    "remove_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  inherited_record: [
    "id",
    "organization_id",
    "transformation_id",
    "kind",
    "evidence_id",
    "baseline_id",
    "source_description",
    "original_owner",
    "original_date",
    "recorded_by",
    "status",
    "withdrawn_at",
    "withdrawn_by",
    "withdraw_reason",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  t10_area_definition: [
    "id",
    "code",
    "methodology_version_id",
    "ordinal",
    "source_area_en",
    "area_ar",
    "source_what_to_show_en",
    "what_to_show_ar",
    "source_rag_logic_en",
    "rag_logic_ar",
    "source_presentation_en",
    "presentation_ar",
    "source_status_basis_en",
    "status_basis_ar",
    "source_ref",
    "ar_provisional",
    "created_at",
  ],
  dashboard_rag_policy: [
    "id",
    "organization_id",
    "value_gap_amber_ratio",
    "value_gap_red_ratio",
    "milestone_slip_amber_working_days",
    "milestone_slip_red_working_days",
    "dependency_due_soon_working_days",
    "decision_due_soon_working_days",
    "top_initiative_count",
    "deadline_horizon_working_days",
    "note",
    "version",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ],
  traceability_edge: [
    "organization_id",
    "transformation_id",
    "edge_kind",
    "from_type",
    "from_id",
    "to_type",
    "to_id",
    "link_table",
    "link_id",
    "contribution_statement",
    "allocation_share",
  ],
  my_work_draft: [
    "organization_id",
    "transformation_id",
    "record_type",
    "record_id",
    "code",
    "label",
    "parent_type",
    "parent_id",
    "created_by",
    "updated_at",
  ],
} as const satisfies { readonly [T in keyof Database]: readonly (keyof Database[T] & string)[] };

// Compile-time completeness: every interface column is listed (the `satisfies` above covers the other direction).
type Unlisted = {
  [T in keyof Database]: Exclude<keyof Database[T], (typeof SCHEMA_COLUMNS)[T][number]>;
}[keyof Database];
const _everyColumnListed: [Unlisted] extends [never] ? true : Unlisted = true;
void _everyColumnListed;
