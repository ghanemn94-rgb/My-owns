// Kysely `Database` interface for the P1, P2 and P3 tables (ADR-0003, ADR-0016, ADR-0021..0024), written from
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
} as const satisfies { readonly [T in keyof Database]: readonly (keyof Database[T] & string)[] };

// Compile-time completeness: every interface column is listed (the `satisfies` above covers the other direction).
type Unlisted = {
  [T in keyof Database]: Exclude<keyof Database[T], (typeof SCHEMA_COLUMNS)[T][number]>;
}[keyof Database];
const _everyColumnListed: [Unlisted] extends [never] ? true : Unlisted = true;
void _everyColumnListed;
