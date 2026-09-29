# Entity-relationship diagrams

> Generated from the live schema. One diagram per module; relationships shown are real foreign keys
> (composite `(project_id, x)` keys are drawn once). Polymorphic links (evidence_link, approval_request,
> audit_event, record_version, source_claim targets) are enforced in services, not by FKs.

## Identity & access

```mermaid
erDiagram
  organization {
    uuid id
    text name
    varchar slug
    text default_timezone
    jsonb settings
    timestamptz created_at
    timestamptz updated_at
  }
  app_user {
    uuid id
    uuid org_id
    text email
    text display_name
    varchar locale
    text title
    classification clearance
    bool is_active
    bool is_service_account
    bool is_demo
    text oidc_issuer
    text oidc_subject
    timestamptz last_login_at
    timestamptz deactivated_at
    more more_columns
  }
  session {
    uuid id
    text token_hash
    text csrf_hash
    uuid user_id
    uuid org_id
    varchar auth_method
    timestamptz created_at
    timestamptz last_seen_at
    timestamptz idle_expires_at
    timestamptz absolute_expires_at
    timestamptz revoked_at
    text revoked_reason
    varchar ip
    text user_agent
  }
  org_role_assignment {
    uuid id
    uuid org_id
    uuid user_id
    role_key role
    scope_type scope_type
    uuid scope_id
    uuid granted_by
    text reason
    timestamptz valid_from
    timestamptz valid_to
    timestamptz revoked_at
    uuid revoked_by
    timestamptz created_at
  }
  role_policy {
    uuid id
    uuid org_id
    text policy_version
    jsonb matrix
    varchar status
    uuid approved_by
    timestamptz approved_at
    text notes
    timestamptz created_at
    int4 revision
  }
  project_membership {
    uuid id
    uuid org_id
    uuid project_id
    uuid user_id
    role_key role
    uuid workstream_id
    uuid granted_by
    text reason
    timestamptz valid_from
    timestamptz valid_to
    timestamptz revoked_at
    uuid revoked_by
    timestamptz created_at
  }
  app_user ||--o{ session : "user_id"
  app_user ||--o{ org_role_assignment : "user_id"
  app_user ||--o{ project_membership : "user_id"
  workstream ||--o{ project_membership : "workstream_id"
```

## Portfolio & configuration

```mermaid
erDiagram
  portfolio {
    uuid id
    uuid org_id
    text name
    text description
    bool is_demo
    timestamptz created_at
    uuid created_by
    timestamptz updated_at
    int4 version
  }
  program {
    uuid id
    uuid org_id
    uuid portfolio_id
    varchar code
    text name
    text objective
    classification classification
    bool is_demo
    timestamptz created_at
    uuid created_by
    timestamptz updated_at
    int4 version
  }
  project_template {
    uuid id
    uuid org_id
    varchar key
    template_kind kind
    text name
    text description
    timestamptz created_at
    uuid created_by
  }
  project_template_version {
    uuid id
    uuid org_id
    uuid template_id
    int4 version_no
    template_version_status status
    jsonb definition
    text definition_hash
    text change_summary
    timestamptz published_at
    uuid published_by
    timestamptz created_at
    uuid created_by
  }
  project {
    uuid id
    uuid org_id
    uuid program_id
    uuid template_version_id
    varchar code
    text name
    text description
    text objective
    project_status status
    classification classification
    text timezone
    jsonb working_days
    date planned_start
    int4 retention_years
    more more_columns
  }
  project_template_migration {
    uuid id
    uuid org_id
    uuid project_id
    uuid from_version_id
    uuid to_version_id
    jsonb preview
    template_migration_status status
    uuid proposed_by
    uuid decided_by
    timestamptz decided_at
    timestamptz applied_at
    timestamptz created_at
    int4 version
  }
  legal_entity {
    uuid id
    uuid org_id
    text name
    entity_kind kind
    text registration_ref
    incorporation_status incorporation_status
    verification_status incorporation_verification
    text incorporation_evidence_note
    text jurisdiction
    bool is_demo
    timestamptz created_at
    uuid created_by
    timestamptz updated_at
    int4 version
  }
  project_entity {
    uuid id
    uuid org_id
    uuid project_id
    uuid legal_entity_id
    entity_kind role
    timestamptz created_at
  }
  site {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    text name
    text city
    varchar kind
    text notes
    bool is_demo
    timestamptz created_at
    uuid created_by
    timestamptz updated_at
    int4 version
  }
  workstream {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    varchar template_key
    text name
    text name_ar
    text objective
    text scope
    uuid lead_user_id
    text proposed_lead_function
    jsonb raci
    jsonb linked_gate_keys
    int4 sort_order
    more more_columns
  }
  calendar_holiday {
    uuid id
    uuid org_id
    uuid project_id
    date date
    text name
    bool is_proposed
    timestamptz created_at
    uuid created_by
  }
  portfolio ||--o{ program : "portfolio_id"
  project_template ||--o{ project_template_version : "template_id"
  program ||--o{ project : "program_id"
  project_template_version ||--o{ project : "template_version_id"
  project_template_version ||--o{ project_template_migration : "from_version_id"
  project_template_version ||--o{ project_template_migration : "to_version_id"
  legal_entity ||--o{ project_entity : "legal_entity_id"
  app_user ||--o{ workstream : "lead_user_id"
```

## Planning

```mermaid
erDiagram
  task {
    uuid id
    uuid org_id
    uuid project_id
    uuid workstream_id
    uuid parent_id
    varchar wbs_code
    text title
    text title_ar
    text description
    task_status status
    uuid accountable_user_id
    text proposed_owner_function
    text output
    text acceptance_criteria
    more more_columns
  }
  milestone {
    uuid id
    uuid org_id
    uuid project_id
    uuid workstream_id
    varchar code
    text title
    text title_ar
    milestone_status status
    date planned_date
    date forecast_date
    date actual_date
    varchar gate_key
    bool is_critical
    int4 weight
    more more_columns
  }
  deliverable {
    uuid id
    uuid org_id
    uuid project_id
    uuid workstream_id
    uuid task_id
    varchar code
    text title
    text title_ar
    deliverable_status status
    int4 weight
    bool weight_approved
    text acceptance_criteria
    date due_date
    uuid owner_user_id
    more more_columns
  }
  dependency {
    uuid id
    uuid org_id
    uuid project_id
    schedule_node_type predecessor_type
    uuid predecessor_id
    schedule_node_type successor_type
    uuid successor_id
    dependency_type type
    int4 lag_days
    text note
    timestamptz created_at
    uuid created_by
  }
  cross_project_dependency {
    uuid id
    uuid org_id
    uuid project_id
    uuid other_project_id
    text description
    date needed_by
    raid_status status
    timestamptz created_at
    uuid created_by
    int4 version
  }
  raci_assignment {
    uuid id
    uuid org_id
    uuid project_id
    varchar entity_type
    uuid entity_id
    uuid user_id
    text function_label
    raci_value raci
    timestamptz created_at
    uuid created_by
  }
  baseline_version {
    uuid id
    uuid org_id
    uuid project_id
    int4 version_no
    baseline_status status
    jsonb snapshot
    text snapshot_hash
    uuid change_request_id
    uuid proposed_by
    uuid approved_by
    timestamptz approved_at
    text note
    timestamptz created_at
    int4 version
  }
  change_request {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    text title
    text rationale
    jsonb alternatives
    jsonb impacts
    change_request_status status
    varchar subject_type
    uuid subject_id
    jsonb proposed_change
    uuid requested_by
    uuid reviewed_by
    more more_columns
  }
  risk {
    uuid id
    uuid org_id
    uuid project_id
    uuid workstream_id
    varchar code
    text title
    text description
    uuid owner_user_id
    raid_status status
    int2 escalation_level
    date due_date
    varchar gate_key
    bool is_demo
    timestamptz created_at
    more more_columns
  }
  issue {
    uuid id
    uuid org_id
    uuid project_id
    uuid workstream_id
    varchar code
    text title
    text description
    uuid owner_user_id
    raid_status status
    int2 escalation_level
    date due_date
    varchar gate_key
    bool is_demo
    timestamptz created_at
    more more_columns
  }
  assumption {
    uuid id
    uuid org_id
    uuid project_id
    uuid workstream_id
    varchar code
    text title
    text description
    uuid owner_user_id
    raid_status status
    int2 escalation_level
    date due_date
    varchar gate_key
    bool is_demo
    timestamptz created_at
    more more_columns
  }
  raid_dependency {
    uuid id
    uuid org_id
    uuid project_id
    uuid workstream_id
    varchar code
    text title
    text description
    uuid owner_user_id
    raid_status status
    int2 escalation_level
    date due_date
    varchar gate_key
    bool is_demo
    timestamptz created_at
    more more_columns
  }
  status_update {
    uuid id
    uuid org_id
    uuid project_id
    uuid workstream_id
    date period_end
    text summary
    text achievements
    text next_steps
    text blockers
    rag_status rag_reported
    rag_status rag_calculated
    update_status status
    uuid submitted_by
    timestamptz submitted_at
    more more_columns
  }
  rag_override {
    uuid id
    uuid org_id
    uuid project_id
    varchar entity_type
    uuid entity_id
    rag_status calculated_status
    rag_status override_status
    text reason
    date expires_on
    uuid requested_by
    uuid reviewer_user_id
    bool approved
    timestamptz reviewed_at
    timestamptz created_at
    more more_columns
  }
  app_user ||--o{ task : "accountable_user_id"
  task ||--o{ task : "parent_id"
  workstream ||--o{ task : "workstream_id"
  app_user ||--o{ milestone : "owner_user_id"
  workstream ||--o{ milestone : "workstream_id"
  app_user ||--o{ deliverable : "owner_user_id"
  task ||--o{ deliverable : "task_id"
  workstream ||--o{ deliverable : "workstream_id"
  app_user ||--o{ raci_assignment : "user_id"
  app_user ||--o{ risk : "owner_user_id"
  workstream ||--o{ risk : "workstream_id"
  app_user ||--o{ issue : "owner_user_id"
  risk ||--o{ issue : "raised_from_risk_id"
  workstream ||--o{ issue : "workstream_id"
  app_user ||--o{ assumption : "owner_user_id"
  workstream ||--o{ assumption : "workstream_id"
  app_user ||--o{ raid_dependency : "owner_user_id"
  workstream ||--o{ raid_dependency : "workstream_id"
  workstream ||--o{ status_update : "workstream_id"
```

## Governance

```mermaid
erDiagram
  committee {
    uuid id
    uuid org_id
    uuid project_id
    uuid program_id
    committee_kind kind
    text name
    committee_status status
    jsonb charter
    uuid charter_document_id
    uuid charter_approved_by
    timestamptz charter_approved_at
    classification classification
    bool is_demo
    timestamptz created_at
    more more_columns
  }
  committee_membership {
    uuid id
    uuid org_id
    uuid project_id
    uuid committee_id
    uuid user_id
    text role_label
    committee_member_role member_role
    bool voting
    date valid_from
    date valid_to
    uuid delegate_of_membership_id
    timestamptz created_at
    uuid created_by
    int4 version
  }
  authority_matrix_version {
    uuid id
    uuid org_id
    uuid project_id
    uuid committee_id
    int4 version_no
    authority_matrix_status status
    bool is_demo_policy
    jsonb policy
    text policy_hash
    uuid approved_by
    timestamptz approved_at
    text approval_reference
    timestamptz created_at
    uuid created_by
  }
  meeting {
    uuid id
    uuid org_id
    uuid project_id
    uuid committee_id
    int4 number
    text title
    timestamptz scheduled_at
    text location
    meeting_status status
    bool is_circulation
    jsonb quorum_snapshot
    uuid pack_snapshot_id
    text minutes_text
    uuid minutes_approved_by
    more more_columns
  }
  agenda_item {
    uuid id
    uuid org_id
    uuid project_id
    uuid committee_id
    uuid meeting_id
    int4 number
    text title
    agenda_item_kind kind
    uuid decision_id
    uuid requested_by
    agenda_screening_status screening_status
    text screening_note
    uuid screened_by
    uuid presenter_user_id
    more more_columns
  }
  attendance {
    uuid id
    uuid org_id
    uuid project_id
    uuid meeting_id
    uuid membership_id
    uuid user_id
    attendance_status status
    uuid recorded_by
    timestamptz created_at
  }
  recusal {
    uuid id
    uuid org_id
    uuid project_id
    uuid decision_id
    uuid user_id
    text reason
    timestamptz created_at
    uuid recorded_by
  }
  decision {
    uuid id
    uuid org_id
    uuid project_id
    uuid committee_id
    varchar code
    text title
    varchar decision_type_key
    text issue
    text why_now
    jsonb alternatives
    text recommendation
    jsonb impacts
    numeric amount_amount
    varchar amount_currency
    more more_columns
  }
  vote {
    uuid id
    uuid org_id
    uuid project_id
    uuid decision_id
    uuid meeting_id
    uuid user_id
    uuid membership_id
    committee_member_role member_role_at_vote
    vote_choice choice
    text comment
    bool via_circulation
    uuid authority_matrix_version_id
    timestamptz created_at
  }
  action_item {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    text title
    uuid decision_id
    uuid meeting_id
    uuid issue_id
    uuid owner_user_id
    date due_date
    action_item_status status
    text closure_evidence_note
    uuid reported_done_by
    timestamptz reported_done_at
    more more_columns
  }
  escalation {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    text title
    varchar source_type
    uuid source_id
    text requested_action
    date decision_deadline
    jsonb options
    uuid raised_to_committee_id
    escalation_status status
    uuid resolution_decision_id
    uuid raised_by
    more more_columns
  }
  approval_request {
    uuid id
    uuid org_id
    uuid project_id
    varchar subject_type
    uuid subject_id
    int4 subject_version
    varchar action
    jsonb payload
    text payload_hash
    varchar required_permission
    uuid requested_by
    approval_request_status status
    timestamptz expires_at
    text note
    more more_columns
  }
  approval_record {
    uuid id
    uuid org_id
    uuid project_id
    uuid approval_request_id
    uuid approver_user_id
    varchar decision
    text comment
    text authority_basis
    text payload_hash
    timestamptz created_at
  }
  program ||--o{ committee : "program_id"
  committee ||--o{ committee_membership : "committee_id"
  app_user ||--o{ committee_membership : "user_id"
  committee ||--o{ authority_matrix_version : "committee_id"
  committee ||--o{ meeting : "committee_id"
  committee ||--o{ agenda_item : "committee_id"
  decision ||--o{ agenda_item : "decision_id"
  meeting ||--o{ agenda_item : "meeting_id"
  meeting ||--o{ attendance : "meeting_id"
  committee_membership ||--o{ attendance : "membership_id"
  decision ||--o{ recusal : "decision_id"
  committee ||--o{ decision : "committee_id"
  meeting ||--o{ decision : "meeting_id"
  app_user ||--o{ decision : "requester_user_id"
  decision ||--o{ decision : "superseded_by_decision_id"
  decision ||--o{ vote : "decision_id"
  committee_membership ||--o{ vote : "membership_id"
  decision ||--o{ action_item : "decision_id"
  meeting ||--o{ action_item : "meeting_id"
  app_user ||--o{ action_item : "owner_user_id"
  approval_request ||--o{ approval_record : "approval_request_id"
```

## Gates

```mermaid
erDiagram
  gate_definition {
    uuid id
    uuid org_id
    uuid project_id
    varchar key
    int4 sort_order
    text name
    text name_ar
    text purpose
    jsonb prerequisite_gate_keys
    role_key owner_role
    role_key reviewer_role
    role_key approver_role
    timestamptz created_at
    int4 version
  }
  gate_criterion {
    uuid id
    uuid org_id
    uuid project_id
    uuid gate_id
    varchar key
    text description
    text description_ar
    bool mandatory
    bool blocking
    bool waivable
    role_key waiver_authority_role
    text waivability_basis
    bool evidence_required
    varchar evidence_type
    more more_columns
  }
  gate_assessment {
    uuid id
    uuid org_id
    uuid project_id
    uuid gate_id
    int4 cycle
    gate_assessment_status status
    jsonb evaluation
    text decision_note
    uuid decided_by
    timestamptz decided_at
    uuid decision_id
    text reopened_reason
    uuid supersedes_assessment_id
    bool is_current
    more more_columns
  }
  criterion_assessment {
    uuid id
    uuid org_id
    uuid project_id
    uuid assessment_id
    uuid criterion_id
    criterion_status status
    text note
    uuid assessed_by
    timestamptz assessed_at
    uuid waiver_id
    timestamptz updated_at
    int4 version
  }
  waiver {
    uuid id
    uuid org_id
    uuid project_id
    varchar target_type
    uuid target_id
    text basis
    text impact
    waiver_status status
    uuid requested_by
    uuid decided_by
    timestamptz decided_at
    text decision_note
    role_key authority_role
    timestamptz created_at
    more more_columns
  }
  status_dimension {
    uuid id
    uuid org_id
    uuid project_id
    status_dimension_key key
    varchar state
    text explanation
    jsonb counts
    timestamptz computed_at
    int4 version
  }
  gate_definition ||--o{ gate_criterion : "gate_id"
  gate_definition ||--o{ gate_assessment : "gate_id"
  gate_assessment ||--o{ criterion_assessment : "assessment_id"
  gate_criterion ||--o{ criterion_assessment : "criterion_id"
```

## Carve-out, NewCo, readiness & TSA

```mermaid
erDiagram
  perimeter_item {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    perimeter_item_type type
    text name
    text description
    uuid site_id
    uuid workstream_id
    uuid current_entity_id
    uuid target_entity_id
    perimeter_disposition disposition
    text legal_owner
    text operator
    more more_columns
  }
  transfer_record {
    uuid id
    uuid org_id
    uuid project_id
    uuid perimeter_item_id
    transfer_status from_status
    transfer_status to_status
    text mechanism
    date effective_date
    text note
    uuid recorded_by
    timestamptz created_at
  }
  agreement {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    varchar kind_label
    text kind_expansion
    bool kind_expansion_confirmed
    text title
    jsonb parties
    text scope
    uuid owner_user_id
    uuid legal_reviewer_user_id
    varchar current_draft_version
    agreement_stage stage
    more more_columns
  }
  consent {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    uuid perimeter_item_id
    uuid agreement_id
    text counterparty
    text contract_ref
    contract_transfer_class transfer_class
    text class_assessed_by
    consent_status status
    date requested_on
    date granted_on
    text conditions
    more more_columns
  }
  regulatory_requirement {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    approval_register_category category
    text authority
    text title
    text description
    applicability_status applicability
    text applicability_assessed_by
    text applicability_note
    requirement_status status
    uuid owner_user_id
    date submitted_on
    more more_columns
  }
  tsa_service {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    text name
    uuid agreement_id
    uuid provider_entity_id
    uuid recipient_entity_id
    text scope
    text dependent_services
    text sla
    text metric_method
    text charge_basis
    numeric charge_amount
    more more_columns
  }
  readiness_check {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    readiness_area area
    text title
    text title_ar
    uuid site_id
    uuid workstream_id
    uuid cutover_plan_id
    bool mandatory
    bool blocker
    readiness_status status
    role_key signoff_role
    more more_columns
  }
  readiness_test_run {
    uuid id
    uuid org_id
    uuid project_id
    uuid readiness_check_id
    readiness_status result
    text note
    uuid recorded_by
    timestamptz created_at
    int4 seq
  }
  cutover_plan {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    text title
    uuid site_id
    uuid runbook_document_id
    text runbook_summary
    timestamptz window_start
    timestamptz window_end
    text service_impact
    uuid accountable_user_id
    bool communications_approved
    text testing_summary
    more more_columns
  }
  agreement ||--o{ perimeter_item : "agreement_id"
  legal_entity ||--o{ perimeter_item : "current_entity_id"
  site ||--o{ perimeter_item : "site_id"
  legal_entity ||--o{ perimeter_item : "target_entity_id"
  workstream ||--o{ perimeter_item : "workstream_id"
  perimeter_item ||--o{ transfer_record : "perimeter_item_id"
  app_user ||--o{ agreement : "legal_reviewer_user_id"
  app_user ||--o{ agreement : "owner_user_id"
  agreement ||--o{ consent : "agreement_id"
  app_user ||--o{ consent : "billing_accountable_user_id"
  perimeter_item ||--o{ consent : "perimeter_item_id"
  app_user ||--o{ consent : "service_accountable_user_id"
  app_user ||--o{ consent : "sla_accountable_user_id"
  legal_entity ||--o{ regulatory_requirement : "legal_entity_id"
  app_user ||--o{ regulatory_requirement : "owner_user_id"
  agreement ||--o{ tsa_service : "agreement_id"
  app_user ||--o{ tsa_service : "owner_user_id"
  legal_entity ||--o{ tsa_service : "provider_entity_id"
  legal_entity ||--o{ tsa_service : "recipient_entity_id"
  cutover_plan ||--o{ readiness_check : "cutover_plan_id"
  site ||--o{ readiness_check : "site_id"
  workstream ||--o{ readiness_check : "workstream_id"
  readiness_check ||--o{ readiness_test_run : "readiness_check_id"
  app_user ||--o{ cutover_plan : "accountable_user_id"
  site ||--o{ cutover_plan : "site_id"
```

## Finance

```mermaid
erDiagram
  financial_snapshot {
    uuid id
    uuid org_id
    uuid project_id
    financial_kind kind
    financial_category category
    varchar line_ref
    text label
    varchar period
    numeric amount
    varchar currency
    int4 unit_scale
    text source_ref
    uuid source_document_id
    approval_state approval_state
    more more_columns
  }
  budget_line {
    uuid id
    uuid org_id
    uuid project_id
    uuid workstream_id
    varchar code
    text name
    financial_category category
    numeric approved_amount
    numeric committed_amount
    numeric spent_amount
    varchar currency
    int4 unit_scale
    approval_state approval_state
    uuid approved_by
    more more_columns
  }
  financial_model_version {
    uuid id
    uuid org_id
    uuid project_id
    model_kind kind
    varchar version_label
    model_case model_case
    jsonb assumptions
    jsonb outputs
    value_basis headline_basis
    uuid source_document_id
    text source_ref
    approval_state approval_state
    uuid approved_by
    timestamptz approved_at
    more more_columns
  }
  benefit {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    text title
    text measurement_definition
    text baseline_value
    text target_value
    text actual_value
    varchar unit
    numeric value_amount
    varchar value_currency
    int4 value_unit_scale
    uuid owner_user_id
    more more_columns
  }
  kpi {
    uuid id
    uuid org_id
    uuid project_id
    varchar key
    text name
    text name_ar
    text definition
    text formula
    varchar unit
    varchar period
    varchar owner_role
    uuid owner_user_id
    text source
    text target
    more more_columns
  }
  kpi_observation {
    uuid id
    uuid org_id
    uuid project_id
    uuid kpi_id
    varchar period
    numeric value
    numeric numerator
    numeric denominator
    varchar data_quality
    jsonb source_refs
    timestamptz created_at
    varchar computed_by
  }
  workstream ||--o{ financial_snapshot : "workstream_id"
  workstream ||--o{ budget_line : "workstream_id"
  app_user ||--o{ benefit : "owner_user_id"
  app_user ||--o{ kpi : "owner_user_id"
  kpi ||--o{ kpi_observation : "kpi_id"
```

## JV & diligence

```mermaid
erDiagram
  partner {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    text name
    uuid legal_entity_id
    partner_stage stage
    bool shortlisted
    nda_status nda_status
    date nda_executed_on
    uuid outreach_approved_by
    timestamptz outreach_approved_at
    uuid materials_access_approved_by
    timestamptz materials_access_approved_at
    more more_columns
  }
  partner_room {
    uuid id
    uuid org_id
    uuid project_id
    uuid partner_id
    text name
    bool is_clean_team
    classification classification
    timestamptz created_at
    uuid created_by
    int4 version
  }
  room_grant {
    uuid id
    uuid org_id
    uuid project_id
    uuid room_id
    uuid user_id
    varchar access_level
    text reason
    uuid granted_by
    timestamptz created_at
    timestamptz expires_at
    timestamptz revoked_at
    uuid revoked_by
  }
  deal_scenario {
    uuid id
    uuid org_id
    uuid project_id
    uuid partner_id
    text name
    varchar version_label
    jsonb ownership
    jsonb contributions
    text governance_terms
    approval_state approval_state
    uuid approved_by
    timestamptz approved_at
    classification classification
    bool is_demo
    more more_columns
  }
  negotiation_issue {
    uuid id
    uuid org_id
    uuid project_id
    uuid partner_id
    uuid agreement_id
    varchar code
    text issue
    jsonb positions
    text alternatives
    text required_approval
    text document_ref
    negotiation_issue_status status
    classification classification
    bool is_demo
    more more_columns
  }
  diligence_request {
    uuid id
    uuid org_id
    uuid project_id
    uuid partner_id
    uuid room_id
    int4 number
    text question
    varchar domain
    text requester_label
    uuid assignee_user_id
    date due_date
    text answer_draft
    jsonb evidence_document_ids
    uuid reviewer_user_id
    more more_columns
  }
  diligence_finding {
    uuid id
    uuid org_id
    uuid project_id
    uuid partner_id
    varchar code
    text title
    text description
    materiality materiality
    uuid risk_id
    text remediation
    text valuation_implication
    text document_implication
    text cp_implication
    finding_status status
    more more_columns
  }
  closing {
    uuid id
    uuid org_id
    uuid project_id
    uuid partner_id
    closing_kind kind
    int4 sequence
    text name
    date target_date
    closing_status status
    uuid confirmed_by
    timestamptz confirmed_at
    text confirmation_authority
    uuid confirmation_decision_id
    jsonb readiness_snapshot
    more more_columns
  }
  closing_condition {
    uuid id
    uuid org_id
    uuid project_id
    uuid closing_id
    condition_kind kind
    varchar reference
    text title
    text description
    uuid owner_user_id
    text parties
    bool blocking
    bool waivable
    role_key waiver_authority_role
    text waiver_authority_note
    more more_columns
  }
  closing_deliverable {
    uuid id
    uuid org_id
    uuid project_id
    uuid closing_id
    text title
    text responsible_party
    uuid owner_user_id
    closing_deliverable_status status
    uuid document_id
    uuid verified_by
    timestamptz verified_at
    bool is_demo
    timestamptz created_at
    uuid created_by
    more more_columns
  }
  funds_flow_item {
    uuid id
    uuid org_id
    uuid project_id
    uuid closing_id
    text description
    text payer
    text payee
    numeric amount
    varchar currency
    int4 unit_scale
    funds_flow_status status
    uuid confirmed_by
    bool is_demo
    timestamptz created_at
    more more_columns
  }
  post_close_obligation {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    post_close_kind kind
    text title
    uuid owner_user_id
    date due_date
    post_close_status status
    text evidence_note
    uuid verified_by
    timestamptz verified_at
    uuid closing_id
    bool is_demo
    more more_columns
  }
  legal_entity ||--o{ partner : "legal_entity_id"
  partner ||--o{ partner_room : "partner_id"
  partner_room ||--o{ room_grant : "room_id"
  app_user ||--o{ room_grant : "user_id"
  partner ||--o{ deal_scenario : "partner_id"
  agreement ||--o{ negotiation_issue : "agreement_id"
  partner ||--o{ negotiation_issue : "partner_id"
  app_user ||--o{ diligence_request : "assignee_user_id"
  partner ||--o{ diligence_request : "partner_id"
  app_user ||--o{ diligence_request : "reviewer_user_id"
  partner_room ||--o{ diligence_request : "room_id"
  partner ||--o{ diligence_finding : "partner_id"
  partner ||--o{ closing : "partner_id"
  closing ||--o{ closing_condition : "closing_id"
  app_user ||--o{ closing_condition : "owner_user_id"
  closing ||--o{ closing_deliverable : "closing_id"
  app_user ||--o{ closing_deliverable : "owner_user_id"
  closing ||--o{ funds_flow_item : "closing_id"
  closing ||--o{ post_close_obligation : "closing_id"
  app_user ||--o{ post_close_obligation : "owner_user_id"
```

## Documents & sources

```mermaid
erDiagram
  document {
    uuid id
    uuid org_id
    uuid project_id
    text title
    document_kind kind
    classification classification
    uuid room_id
    uuid owner_user_id
    uuid current_version_id
    bool legal_hold
    text legal_hold_reason
    date retention_until
    timestamptz deleted_at
    uuid deleted_by
    more more_columns
  }
  document_version {
    uuid id
    uuid org_id
    uuid project_id
    uuid document_id
    int4 version_no
    text storage_key
    text filename
    varchar mime_type
    varchar detected_type
    int8 size_bytes
    varchar sha256
    scan_status scan_status
    text scan_detail
    extraction_status extraction_status
    more more_columns
  }
  evidence_link {
    uuid id
    uuid org_id
    uuid project_id
    varchar target_type
    uuid target_id
    uuid document_id
    uuid document_version_id
    text note
    text purpose
    evidence_link_status status
    uuid conflict_with_link_id
    text conflict_note
    uuid reviewed_by
    timestamptz reviewed_at
    more more_columns
  }
  source_record {
    uuid id
    uuid org_id
    uuid project_id
    varchar code
    source_type source_type
    text filename
    varchar source_version
    varchar checksum
    text owner_label
    timestamptz uploaded_at
    date report_date
    date as_of_date
    date extraction_date
    extraction_status extraction_status
    more more_columns
  }
  source_claim {
    uuid id
    uuid org_id
    uuid project_id
    uuid source_id
    text location
    text subject
    varchar target_type
    uuid target_id
    varchar field
    text extracted_value
    text source_reported_value
    text confirmed_value
    numeric confidence
    verification_status verification_status
    more more_columns
  }
  document_chunk {
    uuid id
    uuid org_id
    uuid project_id
    uuid document_id
    uuid document_version_id
    uuid room_id
    classification classification
    int4 ordinal
    int4 page
    text section
    text text
    tsvector tsv
    bool suspicious_instructions
    timestamptz created_at
  }
  partner_room ||--o{ document : "room_id"
  document ||--o{ document_version : "document_id"
  document ||--o{ evidence_link : "document_id"
  document_version ||--o{ evidence_link : "document_version_id"
  document_version ||--o{ source_record : "document_version_id"
  source_record ||--o{ source_claim : "source_id"
  document ||--o{ document_chunk : "document_id"
  document_version ||--o{ document_chunk : "document_version_id"
```

## Reporting & imports

```mermaid
erDiagram
  report_snapshot {
    uuid id
    uuid org_id
    uuid project_id
    report_kind kind
    text title
    varchar locale
    timestamptz as_of
    date as_of_local_date
    jsonb scope
    uuid baseline_version_id
    int4 baseline_version_no
    classification classification
    jsonb payload
    jsonb unverified_data
    more more_columns
  }
  report_export {
    uuid id
    uuid org_id
    uuid project_id
    uuid snapshot_id
    export_format format
    text storage_key
    text filename
    int8 size_bytes
    varchar sha256
    uuid created_by
    timestamptz created_at
  }
  import_batch {
    uuid id
    uuid org_id
    uuid project_id
    varchar kind
    uuid source_id
    uuid document_version_id
    text filename
    import_status status
    text sheet
    int4 header_row
    jsonb mapping
    jsonb summary
    jsonb errors
    uuid approved_by
    more more_columns
  }
  import_row {
    uuid id
    uuid org_id
    uuid project_id
    uuid batch_id
    int4 row_no
    jsonb raw
    jsonb normalized
    import_row_action action
    text message
    varchar target_type
    uuid target_id
    jsonb before
    jsonb after
  }
  report_snapshot ||--o{ report_export : "snapshot_id"
  import_batch ||--o{ import_row : "batch_id"
```

## Platform, jobs & audit

```mermaid
erDiagram
  notification {
    uuid id
    uuid org_id
    uuid project_id
    uuid user_id
    varchar kind
    text title
    text body
    text link
    notification_channel channel
    delivery_status delivery_status
    varchar dedupe_key
    varchar source_type
    uuid source_id
    uuid ai_proposal_id
    more more_columns
  }
  integration_connection {
    uuid id
    uuid org_id
    integration_kind kind
    text name
    integration_direction direction
    jsonb config
    text secret_ref
    integration_status status
    bool enabled
    bool sending_authorized
    jsonb approved_destinations
    timestamptz last_checked_at
    text last_check_result
    timestamptz created_at
    more more_columns
  }
  outbox_event {
    uuid id
    uuid org_id
    uuid project_id
    varchar type
    varchar aggregate_type
    uuid aggregate_id
    jsonb payload
    varchar dedupe_key
    timestamptz created_at
    timestamptz dispatched_at
    int4 attempts
    text last_error
  }
  job {
    uuid id
    uuid org_id
    uuid project_id
    varchar kind
    jsonb payload
    varchar idempotency_key
    job_status status
    timestamptz run_at
    int4 attempts
    int4 max_attempts
    varchar locked_by
    timestamptz locked_until
    text last_error
    jsonb result
    more more_columns
  }
  scheduled_job {
    uuid id
    uuid org_id
    uuid project_id
    varchar kind
    text name
    varchar cron
    text timezone
    jsonb payload
    bool enabled
    timestamptz next_run_at
    timestamptz last_run_at
    varchar last_status
    text last_error
    uuid owner_user_id
    more more_columns
  }
  delivery_record {
    uuid id
    uuid org_id
    uuid project_id
    varchar idempotency_key
    notification_channel channel
    uuid recipient_user_id
    varchar recipient_address_hash
    varchar payload_hash
    delivery_status status
    text provider_message_id
    text detail
    timestamptz created_at
    timestamptz updated_at
  }
  audit_event {
    int8 seq
    uuid id
    uuid org_id
    uuid project_id
    uuid actor_user_id
    actor_kind actor_kind
    varchar action
    varchar entity_type
    uuid entity_id
    varchar outcome
    text reason
    jsonb before
    jsonb after
    varchar correlation_id
    more more_columns
  }
  record_version {
    uuid id
    uuid org_id
    uuid project_id
    varchar entity_type
    uuid entity_id
    int4 version_no
    jsonb snapshot
    text reason
    uuid changed_by
    timestamptz created_at
  }
```

## AI runtime

```mermaid
erDiagram
  ai_project_settings {
    uuid id
    uuid org_id
    uuid project_id
    ai_mode mode
    ai_provider provider
    varchar model
    bool kill_switch
    uuid kill_switch_by
    timestamptz kill_switch_at
    varchar max_classification_to_provider
    int4 monthly_token_budget
    numeric monthly_cost_budget
    varchar cost_currency
    int4 per_run_token_limit
    more more_columns
  }
  ai_run {
    uuid id
    uuid org_id
    uuid project_id
    varchar kind
    varchar trigger
    text trigger_ref
    uuid requested_by
    varchar service_identity
    ai_run_status status
    ai_provider provider
    varchar model
    varchar locale
    text question
    jsonb output
    more more_columns
  }
  ai_proposal {
    uuid id
    uuid org_id
    uuid project_id
    uuid run_id
    varchar action_type
    varchar target_type
    uuid target_id
    int4 target_version
    jsonb payload
    varchar payload_hash
    text rationale
    jsonb citations
    ai_proposal_status status
    varchar policy_version
    more more_columns
  }
  ai_action_approval {
    uuid id
    uuid org_id
    uuid project_id
    uuid proposal_id
    uuid approver_user_id
    varchar payload_hash
    int4 target_version
    timestamptz expires_at
    varchar status
    text invalidated_reason
    timestamptz created_at
  }
  ai_derived_artifact {
    uuid id
    uuid org_id
    uuid project_id
    varchar kind
    varchar acl_fingerprint
    jsonb source_refs
    jsonb content
    timestamptz invalidated_at
    text invalidated_reason
    timestamptz created_at
    uuid created_by
  }
  ai_run ||--o{ ai_proposal : "run_id"
  ai_proposal ||--o{ ai_action_approval : "proposal_id"
```
