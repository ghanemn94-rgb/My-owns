# Data dictionary

> Generated from the live PostgreSQL schema by `packages/db/src/cli/data-dictionary.ts` — do not edit by hand.
> Tables: 121. RLS enabled: 116.

## Spec §14 entity coverage

| Spec entity | Table | Present |
|---|---|---|
| Organization | `organization` | yes |
| Portfolio | `portfolio` | yes |
| Program | `program` | yes |
| Project | `project` | yes |
| ProjectTemplateVersion | `project_template_version` | yes |
| ProjectMembership | `project_membership` | yes |
| RolePolicy | `role_policy` | yes |
| LegalEntity | `legal_entity` | yes |
| Site | `site` | yes |
| Workstream | `workstream` | yes |
| Task | `task` | yes |
| Milestone | `milestone` | yes |
| Dependency | `dependency` | yes |
| Deliverable | `deliverable` | yes |
| EvidenceLink | `evidence_link` | yes |
| BaselineVersion | `baseline_version` | yes |
| ChangeRequest | `change_request` | yes |
| Risk | `risk` | yes |
| Issue | `issue` | yes |
| Assumption | `assumption` | yes |
| Committee | `committee` | yes |
| CommitteeMembership | `committee_membership` | yes |
| AuthorityMatrixVersion | `authority_matrix_version` | yes |
| Meeting | `meeting` | yes |
| AgendaItem | `agenda_item` | yes |
| Attendance | `attendance` | yes |
| Vote | `vote` | yes |
| Decision | `decision` | yes |
| ActionItem | `action_item` | yes |
| GateDefinition | `gate_definition` | yes |
| GateAssessment | `gate_assessment` | yes |
| ApprovalRequest | `approval_request` | yes |
| ApprovalRecord | `approval_record` | yes |
| PerimeterItem | `perimeter_item` | yes |
| TransferRecord | `transfer_record` | yes |
| Agreement | `agreement` | yes |
| Consent | `consent` | yes |
| RegulatoryRequirement | `regulatory_requirement` | yes |
| TSAService | `tsa_service` | yes |
| ReadinessCheck | `readiness_check` | yes |
| CutoverPlan | `cutover_plan` | yes |
| FinancialSnapshot | `financial_snapshot` | yes |
| BudgetLine | `budget_line` | yes |
| Benefit | `benefit` | yes |
| KPI | `kpi` | yes |
| KPIObservation | `kpi_observation` | yes |
| Partner | `partner` | yes |
| DealScenario | `deal_scenario` | yes |
| DiligenceRequest | `diligence_request` | yes |
| DiligenceFinding | `diligence_finding` | yes |
| ClosingCondition | `closing_condition` | yes |
| ClosingDeliverable | `closing_deliverable` | yes |
| PostCloseObligation | `post_close_obligation` | yes |
| Document | `document` | yes |
| DocumentVersion | `document_version` | yes |
| SourceClaim | `source_claim` | yes |
| ReportSnapshot | `report_snapshot` | yes |
| Notification | `notification` | yes |
| IntegrationConnection | `integration_connection` | yes |
| AIRun | `ai_run` | yes |
| AIProposal | `ai_proposal` | yes |
| AIActionApproval | `ai_action_approval` | yes |
| ScheduledJob | `scheduled_job` | yes |
| AuditEvent | `audit_event` | yes |

## Enumerations

| Enum | Values |
|---|---|
| `action_item_status` | open, in_progress, done_pending_verification, verified_closed, cancelled |
| `actor_kind` | user, service, system |
| `agenda_item_kind` | decision, information, discussion, escalation |
| `agenda_screening_status` | requested, accepted, returned, deferred, withdrawn, merged, rejected |
| `agreement_stage` | identified, drafting, negotiating, agreed_in_principle, signed, effective, terminated, expired |
| `ai_mode` | off, advisory, assisted, autopilot |
| `ai_proposal_status` | proposed, approved, rejected, invalidated, executing, executed, failed, expired, cancelled |
| `ai_provider` | off, mock, openai_compatible, anthropic |
| `ai_run_status` | queued, running, succeeded, failed, cancelled, budget_exceeded, skipped |
| `applicability_status` | assessment_pending, applicable, not_applicable |
| `approval_register_category` | regulatory, external_party, internal |
| `approval_request_status` | pending, approved, rejected, expired, invalidated, withdrawn |
| `approval_state` | proposed, under_review, approved, rejected, superseded |
| `attendance_status` | present, remote, absent, apologies, delegated |
| `authority_matrix_status` | draft, approved, superseded |
| `baseline_status` | draft, proposed, approved, superseded, rejected |
| `benefit_status` | proposed, approved, tracking, realized_unverified, realized_verified, cancelled |
| `change_request_status` | draft, submitted, under_review, approved, rejected, withdrawn, implemented |
| `classification` | public, internal, confidential, restricted, strictly_confidential |
| `closing_deliverable_status` | pending, delivered, verified, not_required |
| `closing_kind` | signing, closing |
| `closing_status` | planned, in_preparation, ready_for_confirmation, confirmed, aborted |
| `committee_kind` | program_steering, newco_board, jv_board, other |
| `committee_member_role` | chair, sponsor, secretary, voting_member, advisory_member, guest |
| `committee_status` | draft, charter_approved, active, dissolved |
| `condition_kind` | condition_precedent, condition_subsequent |
| `condition_status` | open, evidence_submitted, verified, waived, failed, lapsed |
| `consent_status` | not_requested, requested, granted, conditional, refused, not_required |
| `contract_transfer_class` | transferable, consent_required, novation_required, retain, interim_arrangement, unknown |
| `criterion_status` | unmet, evidence_submitted, met, waived, not_applicable, conflicting |
| `cutover_status` | planning, rehearsal, ready_for_decision, approved_go, no_go, executed, accepted, rolled_back |
| `dd_release_status` | draft, in_review, approved_for_release, released, withheld |
| `decision_authority_outcome` | within_mandate, pending_external_authority, not_assessed |
| `decision_status` | draft, submitted, under_review, recommended, approved, rejected, deferred, superseded, implementation_pending, implemented_verified |
| `deliverable_status` | planned, in_progress, submitted, accepted, rejected, cancelled |
| `delivery_status` | queued, sending, sent, uncertain, suppressed, failed, disabled, cancelled |
| `dependency_type` | FS, SS, FF, SF |
| `document_kind` | charter, minutes, decision_paper, agreement, evidence, report, runbook, financial_model, regulatory, dd_material, source_upload, other |
| `entity_kind` | parent, newco, partner, jv_company, counterparty, advisor, other |
| `escalation_status` | open, decision_requested, resolved, withdrawn |
| `evidence_link_status` | active, superseded, conflicting, rejected |
| `export_format` | pdf, xlsx, docx, pptx, csv, json |
| `extraction_status` | not_performed, performed, partial, failed |
| `financial_category` | one_off_separation, recurring_standalone, stranded, tsa_charge, revenue, capex, opex, working_capital, opening_balance, intercompany, other |
| `financial_kind` | baseline, forecast, actual |
| `finding_status` | open, remediation_planned, remediated, accepted_risk, closed |
| `funds_flow_status` | planned, confirmed_by_finance, reported_settled, cancelled |
| `gate_assessment_status` | not_started, in_assessment, ready_for_decision, approved, approved_with_exceptions, rejected, reopened, superseded |
| `gate_review_outcome` | endorse, return |
| `go_no_go` | pending, go, no_go |
| `import_row_action` | create, update, skip, conflict, error |
| `import_status` | uploaded, mapped, validated, approved, applied, rolled_back, rejected, failed |
| `incorporation_status` | incorporated, incorporation_in_progress, unconfirmed, not_applicable |
| `integration_direction` | read, write, send |
| `integration_kind` | oidc, saml_gateway, smtp, teams, sharepoint, object_storage, llm_provider, power_bi, vdr, erp, hr, itsm, dcim, siem |
| `integration_status` | not_configured, configured_unverified, verified, failed, disabled, simulated |
| `job_status` | queued, running, succeeded, failed, dead, cancelled |
| `kpi_direction` | higher_is_better, lower_is_better |
| `materiality` | low, medium, high, critical |
| `meeting_status` | proposed, planned, agenda_published, in_session, held, minutes_draft, minutes_approved, cancelled |
| `milestone_status` | planned, at_risk, achieved_pending_evidence, achieved_verified, missed, cancelled |
| `model_case` | base, downside, upside |
| `model_kind` | business_plan, valuation |
| `nda_status` | none, drafting, executed, expired, terminated |
| `negotiation_issue_status` | open, proposed_resolution, agreed, escalated, closed |
| `notification_channel` | in_app, email, teams, sms |
| `partner_stage` | identified, approved_for_contact, nda, materials_access, dd, proposal, negotiation, signing, closing, withdrawn |
| `perimeter_disposition` | included, excluded, shared, pending |
| `perimeter_item_type` | site, asset, liability, receivable, payable, contract, employee_group, data, ip, license, financing, guarantee, shared_service, other |
| `post_close_kind` | condition_subsequent, obligation, appointment, governance, benefit, handover |
| `post_close_status` | open, in_progress, completed_pending_evidence, verified, overdue, cancelled |
| `project_status` | setup, active, on_hold, closing, closed, cancelled |
| `raci_value` | R, A, C, I |
| `rag_status` | green, amber, red, unknown, stale, not_updated |
| `raid_status` | open, monitoring, escalated, mitigated, closed, cancelled |
| `readiness_area` | power, cooling, connectivity, physical_access, operations, maintenance, spares, noc, incident_management, billing, support, employees, security, backup_recovery, other |
| `readiness_status` | not_started, in_progress, passed, failed, waived, not_applicable |
| `report_kind` | executive_summary, committee_pack, workstream_weekly, look_ahead, day1_readiness, tsa_exit, jv_closing, health_data_quality, minutes, register_export |
| `requirement_status` | not_started, in_preparation, submitted, granted, granted_with_conditions, refused, expired, withdrawn |
| `role_key` | platform_admin, portfolio_admin, sponsor, committee_chair, secretary_cpmo, project_manager, workstream_lead, contributor, functional_approver, finance_restricted, legal_restricted, clean_team, auditor, external_partner_limited |
| `scan_status` | pending, clean, quarantined, rejected, not_scanned |
| `schedule_node_type` | task, milestone |
| `scope_type` | organization, portfolio, project, workstream, partner_room |
| `source_type` | image, excel, csv, minutes, pdf, docx, manual_entry, system |
| `status_dimension_key` | incorporation, perimeter_transfer, operational_readiness, jv_transaction |
| `task_status` | draft, not_started, in_progress, blocked, submitted_for_acceptance, accepted, done, cancelled |
| `template_kind` | dc_carveout, general_transformation, strategy, technology, transaction_other |
| `template_migration_status` | proposed, approved, applied, rejected |
| `template_version_status` | draft, published, retired |
| `transfer_status` | not_started, planned, in_progress, transferred_pending_evidence, transferred_verified, blocked, not_applicable |
| `tsa_status` | proposed, negotiating, approved, active, exit_in_progress, exit_accepted, extended, breached, expired_unresolved |
| `update_status` | draft, submitted, returned, accepted |
| `value_basis` | enterprise_value, equity_value, other |
| `verification_status` | confirmed, historical_unverified, proposed, assumed, conflicting, unknown |
| `vote_choice` | approve, reject, abstain |
| `waiver_status` | requested, approved, rejected, withdrawn |

## Identity & access

### `organization`

RLS: enabled (hub_org_self)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `name` | text | no |  |
| `slug` | character varying | no |  |
| `default_timezone` | text | no | `'Asia/Riyadh'::text` |
| `settings` | jsonb | no | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `app_user`

RLS: enabled (hub_org_isolation) · Triggers: hub_account_type_flip_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `email` | text | no |  |
| `display_name` | text | no |  |
| `locale` | character varying | no | `'en'::character varying` |
| `title` | text | yes |  |
| `clearance` | enum classification | no | `'internal'::classification` |
| `is_active` | boolean | no | `true` |
| `is_service_account` | boolean | no | `false` |
| `account_type` | character varying | no | `'internal'::character varying` |
| `is_demo` | boolean | no | `false` |
| `oidc_issuer` | text | yes |  |
| `oidc_subject` | text | yes |  |
| `last_login_at` | timestamp with time zone | yes |  |
| `deactivated_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `app_user_org_id_organization_id_fk`: (org_id) → `organization`(id)

### `session`

RLS: **not enabled** (infrastructure table — see ADR-0004) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `token_hash` | text | no |  |
| `csrf_hash` | text | no |  |
| `user_id` | uuid | no |  |
| `org_id` | uuid | no |  |
| `auth_method` | character varying | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `last_seen_at` | timestamp with time zone | no | `now()` |
| `idle_expires_at` | timestamp with time zone | no |  |
| `absolute_expires_at` | timestamp with time zone | no |  |
| `revoked_at` | timestamp with time zone | yes |  |
| `revoked_reason` | text | yes |  |
| `ip` | character varying | yes |  |
| `user_agent` | text | yes |  |

Foreign keys:

- `hub_ufk_session_user_id`: (org_id,user_id) → `app_user`(org_id,id)
- `session_org_id_organization_id_fk`: (org_id) → `organization`(id)
- `session_user_id_app_user_id_fk`: (user_id) → `app_user`(id)

### `org_role_assignment`

RLS: enabled (hub_org_isolation) · Triggers: hub_account_type_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `user_id` | uuid | no |  |
| `role` | enum role_key | no |  |
| `scope_type` | enum scope_type | no |  |
| `scope_id` | uuid | yes |  |
| `granted_by` | uuid | yes |  |
| `reason` | text | yes |  |
| `valid_from` | timestamp with time zone | no | `now()` |
| `valid_to` | timestamp with time zone | yes |  |
| `revoked_at` | timestamp with time zone | yes |  |
| `revoked_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_ufk_org_role_assignment_granted_by`: (org_id,granted_by) → `app_user`(org_id,id)
- `hub_ufk_org_role_assignment_revoked_by`: (org_id,revoked_by) → `app_user`(org_id,id)
- `hub_ufk_org_role_assignment_user_id`: (org_id,user_id) → `app_user`(org_id,id)
- `org_role_assignment_org_id_organization_id_fk`: (org_id) → `organization`(id)
- `org_role_assignment_user_id_app_user_id_fk`: (user_id) → `app_user`(id)

### `role_policy`

RLS: enabled (hub_org_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `policy_version` | text | no |  |
| `matrix` | jsonb | no |  |
| `status` | character varying | no | `'active'::character varying` |
| `approved_by` | uuid | yes |  |
| `approved_at` | timestamp with time zone | yes |  |
| `notes` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `revision` | integer | no | `1` |

Foreign keys:

- `hub_ufk_role_policy_approved_by`: (org_id,approved_by) → `app_user`(org_id,id)
- `role_policy_org_id_organization_id_fk`: (org_id) → `organization`(id)

### `project_membership`

RLS: enabled (hub_membership_access) · Triggers: hub_account_type_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `user_id` | uuid | no |  |
| `role` | enum role_key | no |  |
| `workstream_id` | uuid | yes |  |
| `granted_by` | uuid | yes |  |
| `reason` | text | yes |  |
| `valid_from` | timestamp with time zone | no | `now()` |
| `valid_to` | timestamp with time zone | yes |  |
| `revoked_at` | timestamp with time zone | yes |  |
| `revoked_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_opfk_project_membership`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_project_membership_granted_by`: (org_id,granted_by) → `app_user`(org_id,id)
- `hub_ufk_project_membership_revoked_by`: (org_id,revoked_by) → `app_user`(org_id,id)
- `hub_ufk_project_membership_user_id`: (org_id,user_id) → `app_user`(org_id,id)
- `project_membership_project_id_project_id_fk`: (project_id) → `project`(id)
- `project_membership_user_id_app_user_id_fk`: (user_id) → `app_user`(id)
- `project_membership_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK

## Portfolio & configuration

### `portfolio`

RLS: enabled (hub_org_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `name` | text | no |  |
| `description` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_ufk_portfolio_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `portfolio_org_id_organization_id_fk`: (org_id) → `organization`(id)

### `program`

RLS: enabled (hub_org_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `portfolio_id` | uuid | no |  |
| `code` | character varying | no |  |
| `name` | text | no |  |
| `objective` | text | yes |  |
| `classification` | enum classification | no | `'confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_hfk_program_portfolio_id`: (org_id,portfolio_id) → `portfolio`(org_id,id)
- `hub_ufk_program_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `program_org_id_organization_id_fk`: (org_id) → `organization`(id)
- `program_portfolio_id_portfolio_id_fk`: (portfolio_id) → `portfolio`(id)

### `project_template`

RLS: enabled (hub_org_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `key` | character varying | no |  |
| `kind` | enum template_kind | no |  |
| `name` | text | no |  |
| `description` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |

Foreign keys:

- `hub_ufk_project_template_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `project_template_org_id_organization_id_fk`: (org_id) → `organization`(id)

### `project_template_version`

RLS: enabled (hub_org_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `template_id` | uuid | no |  |
| `version_no` | integer | no |  |
| `status` | enum template_version_status | no | `'draft'::template_version_status` |
| `definition` | jsonb | no |  |
| `definition_hash` | text | no |  |
| `change_summary` | text | yes |  |
| `published_at` | timestamp with time zone | yes |  |
| `published_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |

Foreign keys:

- `hub_ufk_project_template_version_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_project_template_version_published_by`: (org_id,published_by) → `app_user`(org_id,id)
- `project_template_version_org_id_organization_id_fk`: (org_id) → `organization`(id)
- `project_template_version_template_id_project_template_id_fk`: (template_id) → `project_template`(id)

### `project`

RLS: enabled (hub_project_self) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `program_id` | uuid | yes |  |
| `template_version_id` | uuid | no |  |
| `code` | character varying | no |  |
| `name` | text | no |  |
| `description` | text | yes |  |
| `objective` | text | yes |  |
| `status` | enum project_status | no | `'setup'::project_status` |
| `classification` | enum classification | no | `'confidential'::classification` |
| `timezone` | text | no | `'Asia/Riyadh'::text` |
| `working_days` | jsonb | no | `'[0, 1, 2, 3, 4]'::jsonb` |
| `planned_start` | date | yes |  |
| `retention_years` | integer | yes |  |
| `setup_state` | jsonb | no | `'{}'::jsonb` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_hfk_project_program_id`: (org_id,program_id) → `program`(org_id,id)
- `hub_ufk_project_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `project_org_id_organization_id_fk`: (org_id) → `organization`(id)
- `project_program_id_program_id_fk`: (program_id) → `program`(id)
- `project_template_version_id_project_template_version_id_fk`: (template_version_id) → `project_template_version`(id)

### `project_template_migration`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `from_version_id` | uuid | no |  |
| `to_version_id` | uuid | no |  |
| `preview` | jsonb | no |  |
| `status` | enum template_migration_status | no | `'proposed'::template_migration_status` |
| `proposed_by` | uuid | yes |  |
| `decided_by` | uuid | yes |  |
| `decided_at` | timestamp with time zone | yes |  |
| `applied_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_project_template_migration`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_project_template_migration_decided_by`: (org_id,decided_by) → `app_user`(org_id,id)
- `hub_ufk_project_template_migration_proposed_by`: (org_id,proposed_by) → `app_user`(org_id,id)
- `project_template_migration_from_version_id_project_template_ver`: (from_version_id) → `project_template_version`(id)
- `project_template_migration_project_id_project_id_fk`: (project_id) → `project`(id)
- `project_template_migration_to_version_id_project_template_versi`: (to_version_id) → `project_template_version`(id)

### `legal_entity`

RLS: enabled (hub_legal_entity_owner_update, hub_legal_entity_owner_insert, hub_org_isolation) · Triggers: hub_legal_entity_owner_immutable, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `name` | text | no |  |
| `kind` | enum entity_kind | no |  |
| `registration_ref` | text | yes |  |
| `incorporation_status` | enum incorporation_status | no | `'unconfirmed'::incorporation_status` |
| `incorporation_verification` | enum verification_status | no | `'unknown'::verification_status` |
| `incorporation_evidence_note` | text | yes |  |
| `incorporation_recorded_by` | uuid | yes |  |
| `incorporation_recorded_at` | timestamp with time zone | yes |  |
| `incorporation_verified_by` | uuid | yes |  |
| `incorporation_verified_at` | timestamp with time zone | yes |  |
| `incorporation_verification_note` | text | yes |  |
| `jurisdiction` | text | yes |  |
| `owner_project_id` | uuid | no |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_ufk_legal_entity_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_legal_entity_incorporation_recorded_by`: (org_id,incorporation_recorded_by) → `app_user`(org_id,id)
- `hub_ufk_legal_entity_incorporation_verified_by`: (org_id,incorporation_verified_by) → `app_user`(org_id,id)
- `legal_entity_org_id_organization_id_fk`: (org_id) → `organization`(id)
- `legal_entity_owner_project_id_project_id_fk`: (owner_project_id) → `project`(id)
- `legal_entity_owner_project_org_fk`: (org_id,owner_project_id) → `project`(org_id,id)

### `project_entity`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `legal_entity_id` | uuid | no |  |
| `role` | enum entity_kind | no |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_opfk_project_entity`: (org_id,project_id) → `project`(org_id,id)
- `project_entity_legal_entity_id_legal_entity_id_fk`: (legal_entity_id) → `legal_entity`(id)
- `project_entity_project_id_project_id_fk`: (project_id) → `project`(id)

### `site`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `name` | text | no |  |
| `city` | text | yes |  |
| `kind` | character varying | no | `'data_center'::character varying` |
| `notes` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_site`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_site_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `site_project_id_project_id_fk`: (project_id) → `project`(id)

### `workstream`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `template_key` | character varying | yes |  |
| `name` | text | no |  |
| `name_ar` | text | yes |  |
| `objective` | text | yes |  |
| `scope` | text | yes |  |
| `lead_user_id` | uuid | yes |  |
| `proposed_lead_function` | text | yes |  |
| `raci` | jsonb | no | `'[]'::jsonb` |
| `linked_gate_keys` | jsonb | no | `'[]'::jsonb` |
| `sort_order` | integer | no | `0` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_workstream`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_workstream_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_workstream_lead_user_id`: (org_id,lead_user_id) → `app_user`(org_id,id)
- `workstream_lead_user_id_app_user_id_fk`: (lead_user_id) → `app_user`(id)
- `workstream_project_id_project_id_fk`: (project_id) → `project`(id)

### `calendar_holiday`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `date` | date | no |  |
| `name` | text | no |  |
| `is_proposed` | boolean | no | `true` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |

Foreign keys:

- `calendar_holiday_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_calendar_holiday`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_calendar_holiday_created_by`: (org_id,created_by) → `app_user`(org_id,id)

### `program_closure`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `status` | character varying | no | `'requested'::character varying` |
| `handover_note` | text | no |  |
| `g7_assessment_id` | uuid | yes |  |
| `approval_request_id` | uuid | yes |  |
| `requested_by` | uuid | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `confirmed_by` | uuid | yes |  |
| `confirmed_at` | timestamp with time zone | yes |  |
| `status_note` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_program_closure`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_program_closure_confirmed_by`: (org_id,confirmed_by) → `app_user`(org_id,id)
- `hub_ufk_program_closure_requested_by`: (org_id,requested_by) → `app_user`(org_id,id)
- `program_closure_g7_fk`: (project_id,g7_assessment_id) → `gate_assessment`(project_id,id) — composite project-scoped FK
- `program_closure_project_id_project_id_fk`: (project_id) → `project`(id)
- `program_closure_request_fk`: (project_id,approval_request_id) → `approval_request`(project_id,id) — composite project-scoped FK

## Planning

### `task`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `workstream_id` | uuid | yes |  |
| `parent_id` | uuid | yes |  |
| `wbs_code` | character varying | no |  |
| `title` | text | no |  |
| `title_ar` | text | yes |  |
| `description` | text | yes |  |
| `description_ar` | text | yes |  |
| `status` | enum task_status | no | `'draft'::task_status` |
| `accountable_user_id` | uuid | yes |  |
| `proposed_owner_function` | text | yes |  |
| `output` | text | yes |  |
| `output_ar` | text | yes |  |
| `acceptance_criteria` | text | yes |  |
| `acceptance_criteria_ar` | text | yes |  |
| `approver_role` | character varying | yes |  |
| `evidence_type` | character varying | yes |  |
| `effort` | text | yes |  |
| `duration_days` | integer | yes |  |
| `duration_basis` | character varying | yes |  |
| `planned_start` | date | yes |  |
| `planned_finish` | date | yes |  |
| `forecast_start` | date | yes |  |
| `forecast_finish` | date | yes |  |
| `actual_start` | date | yes |  |
| `actual_finish` | date | yes |  |
| `reported_progress` | smallint | no | `0` |
| `requires_acceptance` | boolean | no | `false` |
| `accepted_by` | uuid | yes |  |
| `accepted_at` | timestamp with time zone | yes |  |
| `submitted_by` | uuid | yes |  |
| `submitted_at` | timestamp with time zone | yes |  |
| `blocked_reason` | text | yes |  |
| `gate_key` | character varying | yes |  |
| `is_deliverable` | boolean | no | `false` |
| `weight` | integer | no | `1` |
| `template_activity_id` | character varying | yes |  |
| `verification_status` | enum verification_status | no | `'proposed'::verification_status` |
| `sort_order` | integer | no | `0` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_task`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_task_accepted_by`: (org_id,accepted_by) → `app_user`(org_id,id)
- `hub_ufk_task_accountable_user_id`: (org_id,accountable_user_id) → `app_user`(org_id,id)
- `hub_ufk_task_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_task_submitted_by`: (org_id,submitted_by) → `app_user`(org_id,id)
- `task_accountable_user_id_app_user_id_fk`: (accountable_user_id) → `app_user`(id)
- `task_parent_fk`: (project_id,parent_id) → `task`(project_id,id) — composite project-scoped FK
- `task_project_id_project_id_fk`: (project_id) → `project`(id)
- `task_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK

### `milestone`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `workstream_id` | uuid | yes |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `title_ar` | text | yes |  |
| `status` | enum milestone_status | no | `'planned'::milestone_status` |
| `planned_date` | date | yes |  |
| `forecast_date` | date | yes |  |
| `actual_date` | date | yes |  |
| `gate_key` | character varying | yes |  |
| `is_critical` | boolean | no | `false` |
| `weight` | integer | no | `3` |
| `owner_user_id` | uuid | yes |  |
| `verification_status` | enum verification_status | no | `'proposed'::verification_status` |
| `reported_by` | uuid | yes |  |
| `reported_at` | timestamp with time zone | yes |  |
| `verified_by` | uuid | yes |  |
| `verified_at` | timestamp with time zone | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_milestone`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_milestone_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_milestone_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `hub_ufk_milestone_reported_by`: (org_id,reported_by) → `app_user`(org_id,id)
- `hub_ufk_milestone_verified_by`: (org_id,verified_by) → `app_user`(org_id,id)
- `milestone_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `milestone_project_id_project_id_fk`: (project_id) → `project`(id)
- `milestone_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK

### `deliverable`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `workstream_id` | uuid | yes |  |
| `task_id` | uuid | yes |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `title_ar` | text | yes |  |
| `status` | enum deliverable_status | no | `'planned'::deliverable_status` |
| `weight` | integer | no | `1` |
| `weight_approved` | boolean | no | `false` |
| `acceptance_criteria` | text | yes |  |
| `due_date` | date | yes |  |
| `owner_user_id` | uuid | yes |  |
| `accepted_by` | uuid | yes |  |
| `accepted_at` | timestamp with time zone | yes |  |
| `submitted_by` | uuid | yes |  |
| `submitted_at` | timestamp with time zone | yes |  |
| `weight_set_by` | uuid | yes |  |
| `weight_approved_by` | uuid | yes |  |
| `weight_approved_at` | timestamp with time zone | yes |  |
| `gate_key` | character varying | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `deliverable_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `deliverable_project_id_project_id_fk`: (project_id) → `project`(id)
- `deliverable_task_fk`: (project_id,task_id) → `task`(project_id,id) — composite project-scoped FK
- `deliverable_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK
- `hub_opfk_deliverable`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_deliverable_accepted_by`: (org_id,accepted_by) → `app_user`(org_id,id)
- `hub_ufk_deliverable_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_deliverable_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `hub_ufk_deliverable_submitted_by`: (org_id,submitted_by) → `app_user`(org_id,id)
- `hub_ufk_deliverable_weight_approved_by`: (org_id,weight_approved_by) → `app_user`(org_id,id)
- `hub_ufk_deliverable_weight_set_by`: (org_id,weight_set_by) → `app_user`(org_id,id)

### `dependency`

RLS: enabled (hub_project_isolation) · Triggers: hub_same_project_predecessor, hub_same_project_successor, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `predecessor_type` | enum schedule_node_type | no |  |
| `predecessor_id` | uuid | no |  |
| `successor_type` | enum schedule_node_type | no |  |
| `successor_id` | uuid | no |  |
| `type` | enum dependency_type | no | `'FS'::dependency_type` |
| `lag_days` | integer | no | `0` |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |

Foreign keys:

- `dependency_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_dependency`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_dependency_created_by`: (org_id,created_by) → `app_user`(org_id,id)

### `cross_project_dependency`

RLS: enabled (hub_project_isolation) · Triggers: hub_other_project_item, hub_same_project_local_item, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `other_project_id` | uuid | no |  |
| `local_item_type` | enum schedule_node_type | yes |  |
| `local_item_id` | uuid | yes |  |
| `other_item_type` | enum schedule_node_type | no |  |
| `other_item_id` | uuid | no |  |
| `description` | text | no |  |
| `needed_by` | date | yes |  |
| `status` | enum raid_status | no | `'open'::raid_status` |
| `closed_reason` | text | yes |  |
| `closed_by` | uuid | yes |  |
| `closed_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `cross_project_dependency_other_project_id_project_id_fk`: (other_project_id) → `project`(id)
- `cross_project_dependency_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_cross_project_dependency`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_cross_project_dependency_closed_by`: (org_id,closed_by) → `app_user`(org_id,id)
- `hub_ufk_cross_project_dependency_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_xpfk_cross_project_dependency_other`: (org_id,other_project_id) → `project`(org_id,id)

### `raci_assignment`

RLS: enabled (hub_project_isolation) · Triggers: hub_same_project_entity, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `entity_type` | character varying | no |  |
| `entity_id` | uuid | no |  |
| `user_id` | uuid | yes |  |
| `function_label` | text | yes |  |
| `raci` | enum raci_value | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |

Foreign keys:

- `hub_opfk_raci_assignment`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_raci_assignment_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_raci_assignment_user_id`: (org_id,user_id) → `app_user`(org_id,id)
- `raci_assignment_project_id_project_id_fk`: (project_id) → `project`(id)
- `raci_assignment_user_id_app_user_id_fk`: (user_id) → `app_user`(id)

### `baseline_version`

RLS: enabled (hub_project_isolation) · Triggers: hub_frozen_snapshot_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `version_no` | integer | no |  |
| `status` | enum baseline_status | no | `'draft'::baseline_status` |
| `snapshot` | jsonb | no |  |
| `snapshot_hash` | text | no |  |
| `change_request_id` | uuid | yes |  |
| `decision_id` | uuid | yes |  |
| `proposed_by` | uuid | yes |  |
| `approved_by` | uuid | yes |  |
| `approved_at` | timestamp with time zone | yes |  |
| `rejected_by` | uuid | yes |  |
| `rejected_at` | timestamp with time zone | yes |  |
| `superseded_at` | timestamp with time zone | yes |  |
| `note` | text | yes |  |
| `decision_note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `baseline_change_request_fk`: (project_id,change_request_id) → `change_request`(project_id,id) — composite project-scoped FK
- `baseline_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `baseline_version_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_baseline_version`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_baseline_version_approved_by`: (org_id,approved_by) → `app_user`(org_id,id)
- `hub_ufk_baseline_version_proposed_by`: (org_id,proposed_by) → `app_user`(org_id,id)
- `hub_ufk_baseline_version_rejected_by`: (org_id,rejected_by) → `app_user`(org_id,id)

### `change_request`

RLS: enabled (hub_project_isolation) · Triggers: hub_same_project_subject, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `rationale` | text | no |  |
| `alternatives` | jsonb | no | `'[]'::jsonb` |
| `impacts` | jsonb | no | `'{}'::jsonb` |
| `status` | enum change_request_status | no | `'draft'::change_request_status` |
| `cost_impact_amount` | numeric | yes |  |
| `cost_impact_currency` | character varying | yes |  |
| `cost_impact_unit_scale` | integer | yes |  |
| `cost_impact_recorded_by` | uuid | yes |  |
| `subject_type` | character varying | yes |  |
| `subject_id` | uuid | yes |  |
| `proposed_change` | jsonb | yes |  |
| `requested_by` | uuid | yes |  |
| `reviewed_by` | uuid | yes |  |
| `decided_by` | uuid | yes |  |
| `decided_at` | timestamp with time zone | yes |  |
| `decision_note` | text | yes |  |
| `decision_id` | uuid | yes |  |
| `rebaseline` | boolean | no | `false` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `change_request_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `change_request_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_change_request`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_change_request_cost_impact_recorded_by`: (org_id,cost_impact_recorded_by) → `app_user`(org_id,id)
- `hub_ufk_change_request_decided_by`: (org_id,decided_by) → `app_user`(org_id,id)
- `hub_ufk_change_request_requested_by`: (org_id,requested_by) → `app_user`(org_id,id)
- `hub_ufk_change_request_reviewed_by`: (org_id,reviewed_by) → `app_user`(org_id,id)

### `risk`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `workstream_id` | uuid | yes |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `owner_user_id` | uuid | yes |  |
| `status` | enum raid_status | no | `'open'::raid_status` |
| `escalation_level` | smallint | no | `0` |
| `due_date` | date | yes |  |
| `gate_key` | character varying | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |
| `probability` | smallint | no |  |
| `impact` | smallint | no |  |
| `trigger` | text | yes |  |
| `response` | text | yes |  |
| `response_strategy` | character varying | yes |  |
| `exposure_amount` | numeric | yes |  |
| `exposure_currency` | character varying | yes |  |
| `exposure_unit_scale` | integer | yes |  |

Foreign keys:

- `hub_opfk_risk`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_risk_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_risk_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `risk_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `risk_project_id_project_id_fk`: (project_id) → `project`(id)
- `risk_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK

### `issue`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `workstream_id` | uuid | yes |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `owner_user_id` | uuid | yes |  |
| `status` | enum raid_status | no | `'open'::raid_status` |
| `escalation_level` | smallint | no | `0` |
| `due_date` | date | yes |  |
| `gate_key` | character varying | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |
| `severity` | smallint | no | `3` |
| `resolution` | text | yes |  |
| `raised_from_risk_id` | uuid | yes |  |

Foreign keys:

- `hub_opfk_issue`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_issue_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_issue_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `issue_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `issue_project_id_project_id_fk`: (project_id) → `project`(id)
- `issue_risk_fk`: (project_id,raised_from_risk_id) → `risk`(project_id,id) — composite project-scoped FK
- `issue_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK

### `assumption`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `workstream_id` | uuid | yes |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `owner_user_id` | uuid | yes |  |
| `status` | enum raid_status | no | `'open'::raid_status` |
| `escalation_level` | smallint | no | `0` |
| `due_date` | date | yes |  |
| `gate_key` | character varying | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |
| `basis` | text | yes |  |
| `validation_plan` | text | yes |  |
| `verification_status` | enum verification_status | no | `'assumed'::verification_status` |

Foreign keys:

- `assumption_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `assumption_project_id_project_id_fk`: (project_id) → `project`(id)
- `assumption_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK
- `hub_opfk_assumption`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_assumption_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_assumption_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)

### `raid_dependency`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `workstream_id` | uuid | yes |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `owner_user_id` | uuid | yes |  |
| `status` | enum raid_status | no | `'open'::raid_status` |
| `escalation_level` | smallint | no | `0` |
| `due_date` | date | yes |  |
| `gate_key` | character varying | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |
| `depends_on` | text | no |  |
| `needed_by` | date | yes |  |

Foreign keys:

- `hub_opfk_raid_dependency`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_raid_dependency_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_raid_dependency_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `raid_dependency_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `raid_dependency_project_id_project_id_fk`: (project_id) → `project`(id)
- `raid_dependency_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK

### `status_update`

RLS: enabled (hub_project_isolation) · Triggers: hub_frozen_snapshot_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `workstream_id` | uuid | yes |  |
| `period_end` | date | no |  |
| `summary` | text | no |  |
| `achievements` | text | yes |  |
| `next_steps` | text | yes |  |
| `blockers` | text | yes |  |
| `rag_reported` | enum rag_status | yes |  |
| `rag_calculated` | enum rag_status | yes |  |
| `status` | enum update_status | no | `'draft'::update_status` |
| `submitted_by` | uuid | yes |  |
| `submitted_at` | timestamp with time zone | yes |  |
| `reviewed_by` | uuid | yes |  |
| `reviewed_at` | timestamp with time zone | yes |  |
| `review_note` | text | yes |  |
| `frozen_snapshot` | jsonb | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_status_update`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_status_update_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_status_update_reviewed_by`: (org_id,reviewed_by) → `app_user`(org_id,id)
- `hub_ufk_status_update_submitted_by`: (org_id,submitted_by) → `app_user`(org_id,id)
- `status_update_project_id_project_id_fk`: (project_id) → `project`(id)
- `status_update_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK

### `rag_override`

RLS: enabled (hub_project_isolation) · Triggers: hub_same_project_entity, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `entity_type` | character varying | no |  |
| `entity_id` | uuid | no |  |
| `calculated_status` | enum rag_status | no |  |
| `override_status` | enum rag_status | no |  |
| `reason` | text | no |  |
| `expires_on` | date | no |  |
| `requested_by` | uuid | no |  |
| `reviewer_user_id` | uuid | yes |  |
| `approved` | boolean | no | `false` |
| `reviewed_at` | timestamp with time zone | yes |  |
| `review_note` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_rag_override`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_rag_override_requested_by`: (org_id,requested_by) → `app_user`(org_id,id)
- `hub_ufk_rag_override_reviewer_user_id`: (org_id,reviewer_user_id) → `app_user`(org_id,id)
- `rag_override_project_id_project_id_fk`: (project_id) → `project`(id)

### `record_dependency`

RLS: enabled (hub_project_isolation) · Triggers: hub_same_project_predecessor, hub_same_project_successor, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `successor_type` | enum schedule_node_type | no |  |
| `successor_id` | uuid | no |  |
| `predecessor_type` | character varying | no |  |
| `predecessor_id` | uuid | no |  |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |

Foreign keys:

- `hub_opfk_record_dependency`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_record_dependency_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `record_dependency_project_id_project_id_fk`: (project_id) → `project`(id)

## Governance

### `committee`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `program_id` | uuid | yes |  |
| `kind` | enum committee_kind | no |  |
| `name` | text | no |  |
| `status` | enum committee_status | no | `'draft'::committee_status` |
| `charter` | jsonb | no | `'{}'::jsonb` |
| `charter_document_id` | uuid | yes |  |
| `charter_version_no` | integer | no | `1` |
| `charter_approved_version_no` | integer | yes |  |
| `charter_approved_by` | uuid | yes |  |
| `charter_approved_at` | timestamp with time zone | yes |  |
| `classification` | enum classification | no | `'confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `committee_charter_doc_fk`: (project_id,charter_document_id) → `document`(project_id,id) — composite project-scoped FK
- `committee_program_id_program_id_fk`: (program_id) → `program`(id)
- `committee_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_hfk_committee_program_id`: (org_id,program_id) → `program`(org_id,id)
- `hub_opfk_committee`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_committee_charter_approved_by`: (org_id,charter_approved_by) → `app_user`(org_id,id)
- `hub_ufk_committee_created_by`: (org_id,created_by) → `app_user`(org_id,id)

### `committee_membership`

RLS: enabled (hub_project_isolation) · Triggers: hub_account_type_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `committee_id` | uuid | no |  |
| `user_id` | uuid | yes |  |
| `role_label` | text | no |  |
| `member_role` | enum committee_member_role | no |  |
| `voting` | boolean | no | `false` |
| `valid_from` | date | no |  |
| `valid_to` | date | yes |  |
| `delegate_of_membership_id` | uuid | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `version` | integer | no | `1` |

Foreign keys:

- `committee_membership_committee_fk`: (project_id,committee_id) → `committee`(project_id,id) — composite project-scoped FK
- `committee_membership_delegate_fk`: (project_id,delegate_of_membership_id) → `committee_membership`(project_id,id) — composite project-scoped FK
- `committee_membership_project_id_project_id_fk`: (project_id) → `project`(id)
- `committee_membership_user_id_app_user_id_fk`: (user_id) → `app_user`(id)
- `hub_opfk_committee_membership`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_committee_membership_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_committee_membership_user_id`: (org_id,user_id) → `app_user`(org_id,id)

### `authority_matrix_version`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `committee_id` | uuid | no |  |
| `version_no` | integer | no |  |
| `status` | enum authority_matrix_status | no | `'draft'::authority_matrix_status` |
| `is_demo_policy` | boolean | no | `false` |
| `policy` | jsonb | no |  |
| `policy_hash` | text | no |  |
| `effective_from` | date | yes |  |
| `effective_to` | date | yes |  |
| `approved_by` | uuid | yes |  |
| `approved_at` | timestamp with time zone | yes |  |
| `approval_reference` | text | yes |  |
| `approval_document_id` | uuid | yes |  |
| `approval_document_version_id` | uuid | yes |  |
| `approval_verified_by` | uuid | yes |  |
| `approval_verified_at` | timestamp with time zone | yes |  |
| `approval_verification_note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |

Foreign keys:

- `authority_matrix_approval_document_fk`: (project_id,approval_document_id) → `document`(project_id,id) — composite project-scoped FK
- `authority_matrix_approval_version_fk`: (project_id,approval_document_version_id) → `document_version`(project_id,id) — composite project-scoped FK
- `authority_matrix_committee_fk`: (project_id,committee_id) → `committee`(project_id,id) — composite project-scoped FK
- `authority_matrix_version_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_authority_matrix_version`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_authority_matrix_version_approval_verified_by`: (org_id,approval_verified_by) → `app_user`(org_id,id)
- `hub_ufk_authority_matrix_version_approved_by`: (org_id,approved_by) → `app_user`(org_id,id)
- `hub_ufk_authority_matrix_version_created_by`: (org_id,created_by) → `app_user`(org_id,id)

### `meeting`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `committee_id` | uuid | no |  |
| `number` | integer | no |  |
| `title` | text | no |  |
| `scheduled_at` | timestamp with time zone | no |  |
| `location` | text | yes |  |
| `status` | enum meeting_status | no | `'planned'::meeting_status` |
| `is_circulation` | boolean | no | `false` |
| `response_deadline` | date | yes |  |
| `quorum_snapshot` | jsonb | yes |  |
| `pack_snapshot_id` | uuid | yes |  |
| `minutes_text` | text | yes |  |
| `minutes_drafted_by` | uuid | yes |  |
| `minutes_approved_by` | uuid | yes |  |
| `minutes_approved_at` | timestamp with time zone | yes |  |
| `authority_matrix_version_id` | uuid | yes |  |
| `cadence_charter_version_no` | integer | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_meeting`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_meeting_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_meeting_minutes_approved_by`: (org_id,minutes_approved_by) → `app_user`(org_id,id)
- `hub_ufk_meeting_minutes_drafted_by`: (org_id,minutes_drafted_by) → `app_user`(org_id,id)
- `meeting_committee_fk`: (project_id,committee_id) → `committee`(project_id,id) — composite project-scoped FK
- `meeting_matrix_fk`: (project_id,authority_matrix_version_id) → `authority_matrix_version`(project_id,id) — composite project-scoped FK
- `meeting_pack_fk`: (project_id,pack_snapshot_id) → `report_snapshot`(project_id,id) — composite project-scoped FK
- `meeting_project_id_project_id_fk`: (project_id) → `project`(id)

### `agenda_item`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `committee_id` | uuid | no |  |
| `meeting_id` | uuid | yes |  |
| `number` | integer | yes |  |
| `title` | text | no |  |
| `kind` | enum agenda_item_kind | no |  |
| `decision_id` | uuid | yes |  |
| `requested_by` | uuid | yes |  |
| `screening_status` | enum agenda_screening_status | no | `'requested'::agenda_screening_status` |
| `screening_note` | text | yes |  |
| `screened_by` | uuid | yes |  |
| `merged_into_agenda_item_id` | uuid | yes |  |
| `presenter_user_id` | uuid | yes |  |
| `minutes_note` | text | yes |  |
| `sort_order` | integer | no | `0` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `agenda_item_committee_fk`: (project_id,committee_id) → `committee`(project_id,id) — composite project-scoped FK
- `agenda_item_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `agenda_item_meeting_fk`: (project_id,meeting_id) → `meeting`(project_id,id) — composite project-scoped FK
- `agenda_item_merged_into_fk`: (project_id,merged_into_agenda_item_id) → `agenda_item`(project_id,id) — composite project-scoped FK
- `agenda_item_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_agenda_item`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_agenda_item_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_agenda_item_presenter_user_id`: (org_id,presenter_user_id) → `app_user`(org_id,id)
- `hub_ufk_agenda_item_requested_by`: (org_id,requested_by) → `app_user`(org_id,id)
- `hub_ufk_agenda_item_screened_by`: (org_id,screened_by) → `app_user`(org_id,id)

### `attendance`

RLS: enabled (hub_project_isolation) · Triggers: hub_attendance_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `meeting_id` | uuid | no |  |
| `membership_id` | uuid | no |  |
| `user_id` | uuid | yes |  |
| `status` | enum attendance_status | no |  |
| `recorded_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `attendance_meeting_fk`: (project_id,meeting_id) → `meeting`(project_id,id) — composite project-scoped FK
- `attendance_membership_fk`: (project_id,membership_id) → `committee_membership`(project_id,id) — composite project-scoped FK
- `attendance_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_attendance`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_attendance_recorded_by`: (org_id,recorded_by) → `app_user`(org_id,id)
- `hub_ufk_attendance_user_id`: (org_id,user_id) → `app_user`(org_id,id)

### `recusal`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `decision_id` | uuid | no |  |
| `user_id` | uuid | no |  |
| `reason` | text | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `recorded_by` | uuid | yes |  |

Foreign keys:

- `hub_opfk_recusal`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_recusal_recorded_by`: (org_id,recorded_by) → `app_user`(org_id,id)
- `hub_ufk_recusal_user_id`: (org_id,user_id) → `app_user`(org_id,id)
- `recusal_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `recusal_project_id_project_id_fk`: (project_id) → `project`(id)

### `decision`

RLS: enabled (hub_project_isolation) · Triggers: hub_same_project_subject, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `committee_id` | uuid | no |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `decision_type_key` | character varying | yes |  |
| `issue` | text | yes |  |
| `why_now` | text | yes |  |
| `alternatives` | jsonb | no | `'[]'::jsonb` |
| `recommendation` | text | yes |  |
| `impacts` | jsonb | no | `'{}'::jsonb` |
| `amount_amount` | numeric | yes |  |
| `amount_currency` | character varying | yes |  |
| `amount_unit_scale` | integer | yes |  |
| `risks` | text | yes |  |
| `dependencies` | text | yes |  |
| `latest_safe_date` | date | yes |  |
| `required_authority` | text | yes |  |
| `requester_user_id` | uuid | yes |  |
| `status` | enum decision_status | no | `'draft'::decision_status` |
| `vote_round` | integer | no | `1` |
| `recommendation_recorded_by` | uuid | yes |  |
| `authority_outcome` | enum decision_authority_outcome | no | `'not_assessed'::decision_authority_outcome` |
| `authority_reason` | text | yes |  |
| `escalated_to` | text | yes |  |
| `external_authority_reference` | text | yes |  |
| `external_evidence_link_id` | uuid | yes |  |
| `meeting_id` | uuid | yes |  |
| `decided_via_circulation` | boolean | no | `false` |
| `outcome_recorded_at` | timestamp with time zone | yes |  |
| `outcome_recorded_by` | uuid | yes |  |
| `tally_snapshot` | jsonb | yes |  |
| `superseded_by_decision_id` | uuid | yes |  |
| `implementation_started_by` | uuid | yes |  |
| `implementation_started_at` | timestamp with time zone | yes |  |
| `implementation_evidence_note` | text | yes |  |
| `implementation_verified_by` | uuid | yes |  |
| `implementation_verified_at` | timestamp with time zone | yes |  |
| `classification` | enum classification | no | `'confidential'::classification` |
| `gate_key` | character varying | yes |  |
| `subject_type` | character varying | yes |  |
| `subject_id` | uuid | yes |  |
| `first_submitted_at` | timestamp with time zone | yes |  |
| `evidence_none_reason` | text | yes |  |
| `voting_closed_round` | integer | yes |  |
| `voting_closed_by` | uuid | yes |  |
| `voting_closed_at` | timestamp with time zone | yes |  |
| `voting_close_reason` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `decision_committee_fk`: (project_id,committee_id) → `committee`(project_id,id) — composite project-scoped FK
- `decision_external_evidence_fk`: (project_id,external_evidence_link_id) → `evidence_link`(project_id,id) — composite project-scoped FK
- `decision_meeting_fk`: (project_id,meeting_id) → `meeting`(project_id,id) — composite project-scoped FK
- `decision_project_id_project_id_fk`: (project_id) → `project`(id)
- `decision_requester_user_id_app_user_id_fk`: (requester_user_id) → `app_user`(id)
- `decision_superseded_fk`: (project_id,superseded_by_decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `hub_opfk_decision`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_decision_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_decision_implementation_started_by`: (org_id,implementation_started_by) → `app_user`(org_id,id)
- `hub_ufk_decision_implementation_verified_by`: (org_id,implementation_verified_by) → `app_user`(org_id,id)
- `hub_ufk_decision_outcome_recorded_by`: (org_id,outcome_recorded_by) → `app_user`(org_id,id)
- `hub_ufk_decision_recommendation_recorded_by`: (org_id,recommendation_recorded_by) → `app_user`(org_id,id)
- `hub_ufk_decision_requester_user_id`: (org_id,requester_user_id) → `app_user`(org_id,id)
- `hub_ufk_decision_voting_closed_by`: (org_id,voting_closed_by) → `app_user`(org_id,id)

### `vote`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable, hub_vote_binding

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `decision_id` | uuid | no |  |
| `meeting_id` | uuid | yes |  |
| `user_id` | uuid | no |  |
| `membership_id` | uuid | no |  |
| `round` | integer | no | `1` |
| `member_role_at_vote` | enum committee_member_role | no |  |
| `choice` | enum vote_choice | no |  |
| `comment` | text | yes |  |
| `via_circulation` | boolean | no | `false` |
| `authority_matrix_version_id` | uuid | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_opfk_vote`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_vote_user_id`: (org_id,user_id) → `app_user`(org_id,id)
- `vote_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `vote_matrix_fk`: (project_id,authority_matrix_version_id) → `authority_matrix_version`(project_id,id) — composite project-scoped FK
- `vote_meeting_fk`: (project_id,meeting_id) → `meeting`(project_id,id) — composite project-scoped FK
- `vote_membership_fk`: (project_id,membership_id) → `committee_membership`(project_id,id) — composite project-scoped FK
- `vote_project_id_project_id_fk`: (project_id) → `project`(id)

### `action_item`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `decision_id` | uuid | yes |  |
| `meeting_id` | uuid | yes |  |
| `issue_id` | uuid | yes |  |
| `owner_user_id` | uuid | yes |  |
| `due_date` | date | yes |  |
| `status` | enum action_item_status | no | `'open'::action_item_status` |
| `closure_evidence_note` | text | yes |  |
| `reported_done_by` | uuid | yes |  |
| `reported_done_at` | timestamp with time zone | yes |  |
| `verified_by` | uuid | yes |  |
| `verified_at` | timestamp with time zone | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `action_item_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `action_item_issue_fk`: (project_id,issue_id) → `issue`(project_id,id) — composite project-scoped FK
- `action_item_meeting_fk`: (project_id,meeting_id) → `meeting`(project_id,id) — composite project-scoped FK
- `action_item_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `action_item_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_action_item`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_action_item_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_action_item_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `hub_ufk_action_item_reported_done_by`: (org_id,reported_done_by) → `app_user`(org_id,id)
- `hub_ufk_action_item_verified_by`: (org_id,verified_by) → `app_user`(org_id,id)

### `escalation`

RLS: enabled (hub_project_isolation) · Triggers: hub_same_project_source, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `source_type` | character varying | no |  |
| `source_id` | uuid | yes |  |
| `requested_action` | text | no |  |
| `decision_deadline` | date | yes |  |
| `options` | jsonb | no | `'[]'::jsonb` |
| `raised_to_committee_id` | uuid | yes |  |
| `target` | text | yes |  |
| `status` | enum escalation_status | no | `'open'::escalation_status` |
| `resolution_decision_id` | uuid | yes |  |
| `resolution_note` | text | yes |  |
| `resolved_by` | uuid | yes |  |
| `resolved_at` | timestamp with time zone | yes |  |
| `raised_by` | uuid | yes |  |
| `is_system_generated` | boolean | no | `false` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `escalation_committee_fk`: (project_id,raised_to_committee_id) → `committee`(project_id,id) — composite project-scoped FK
- `escalation_project_id_project_id_fk`: (project_id) → `project`(id)
- `escalation_resolution_fk`: (project_id,resolution_decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `hub_opfk_escalation`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_escalation_raised_by`: (org_id,raised_by) → `app_user`(org_id,id)
- `hub_ufk_escalation_resolved_by`: (org_id,resolved_by) → `app_user`(org_id,id)

### `approval_request`

RLS: enabled (hub_project_isolation) · Triggers: hub_same_project_subject, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `subject_type` | character varying | no |  |
| `subject_id` | uuid | no |  |
| `subject_version` | integer | yes |  |
| `action` | character varying | no |  |
| `payload` | jsonb | no | `'{}'::jsonb` |
| `payload_hash` | text | no |  |
| `required_permission` | character varying | no |  |
| `requested_by` | uuid | no |  |
| `status` | enum approval_request_status | no | `'pending'::approval_request_status` |
| `expires_at` | timestamp with time zone | yes |  |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `approval_request_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_approval_request`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_approval_request_requested_by`: (org_id,requested_by) → `app_user`(org_id,id)

### `approval_record`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `approval_request_id` | uuid | no |  |
| `approver_user_id` | uuid | no |  |
| `decision` | character varying | no |  |
| `comment` | text | yes |  |
| `authority_basis` | text | yes |  |
| `payload_hash` | text | no |  |
| `method` | character varying | no | `'internal_electronic'::character varying` |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `approval_record_project_id_project_id_fk`: (project_id) → `project`(id)
- `approval_record_request_fk`: (project_id,approval_request_id) → `approval_request`(project_id,id) — composite project-scoped FK
- `hub_opfk_approval_record`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_approval_record_approver_user_id`: (org_id,approver_user_id) → `app_user`(org_id,id)

### `conflict_declaration`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `committee_id` | uuid | no |  |
| `meeting_id` | uuid | yes |  |
| `decision_id` | uuid | yes |  |
| `user_id` | uuid | no |  |
| `declaration` | character varying | no |  |
| `description` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `recorded_by` | uuid | yes |  |

Foreign keys:

- `conflict_declaration_committee_fk`: (project_id,committee_id) → `committee`(project_id,id) — composite project-scoped FK
- `conflict_declaration_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `conflict_declaration_meeting_fk`: (project_id,meeting_id) → `meeting`(project_id,id) — composite project-scoped FK
- `conflict_declaration_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_conflict_declaration`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_conflict_declaration_recorded_by`: (org_id,recorded_by) → `app_user`(org_id,id)
- `hub_ufk_conflict_declaration_user_id`: (org_id,user_id) → `app_user`(org_id,id)

### `decision_use`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_same_project_subject, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `decision_id` | uuid | no |  |
| `use_kind` | character varying | no |  |
| `subject_type` | character varying | no |  |
| `subject_id` | uuid | no |  |
| `used_at` | timestamp with time zone | no | `now()` |
| `used_by` | uuid | yes |  |

Foreign keys:

- `decision_use_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `decision_use_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_decision_use`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_decision_use_used_by`: (org_id,used_by) → `app_user`(org_id,id)

## Gates

### `gate_definition`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `key` | character varying | no |  |
| `sort_order` | integer | no |  |
| `name` | text | no |  |
| `name_ar` | text | yes |  |
| `purpose` | text | yes |  |
| `prerequisite_gate_keys` | jsonb | no | `'[]'::jsonb` |
| `owner_role` | enum role_key | no |  |
| `reviewer_role` | enum role_key | no |  |
| `approver_role` | enum role_key | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `gate_definition_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_gate_definition`: (org_id,project_id) → `project`(org_id,id)

### `gate_criterion`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `gate_id` | uuid | no |  |
| `key` | character varying | no |  |
| `description` | text | no |  |
| `description_ar` | text | yes |  |
| `mandatory` | boolean | no |  |
| `blocking` | boolean | no |  |
| `waivable` | boolean | no | `false` |
| `waiver_authority_role` | enum role_key | yes |  |
| `waivability_basis` | text | yes |  |
| `evidence_required` | boolean | no | `true` |
| `evidence_type` | character varying | yes |  |
| `owner_role` | enum role_key | no |  |
| `reviewer_role` | enum role_key | no |  |
| `applicability` | character varying | no | `'proposed'::character varying` |
| `sort_order` | integer | no | `0` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `gate_criterion_gate_fk`: (project_id,gate_id) → `gate_definition`(project_id,id) — composite project-scoped FK
- `gate_criterion_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_gate_criterion`: (org_id,project_id) → `project`(org_id,id)

### `gate_assessment`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `gate_id` | uuid | no |  |
| `cycle` | integer | no | `1` |
| `status` | enum gate_assessment_status | no | `'not_started'::gate_assessment_status` |
| `evaluation` | jsonb | yes |  |
| `decision_note` | text | yes |  |
| `decided_by` | uuid | yes |  |
| `decided_at` | timestamp with time zone | yes |  |
| `decision_id` | uuid | yes |  |
| `submitted_by` | uuid | yes |  |
| `submitted_at` | timestamp with time zone | yes |  |
| `started_by` | uuid | yes |  |
| `started_at` | timestamp with time zone | yes |  |
| `reviewed_by` | uuid | yes |  |
| `reviewed_at` | timestamp with time zone | yes |  |
| `review_outcome` | enum gate_review_outcome | yes |  |
| `review_note` | text | yes |  |
| `review_basis` | character varying | yes |  |
| `reopened_reason` | text | yes |  |
| `supersedes_assessment_id` | uuid | yes |  |
| `is_current` | boolean | no | `true` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `gate_assessment_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `gate_assessment_gate_fk`: (project_id,gate_id) → `gate_definition`(project_id,id) — composite project-scoped FK
- `gate_assessment_project_id_project_id_fk`: (project_id) → `project`(id)
- `gate_assessment_supersedes_fk`: (project_id,supersedes_assessment_id) → `gate_assessment`(project_id,id) — composite project-scoped FK
- `hub_opfk_gate_assessment`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_gate_assessment_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_gate_assessment_decided_by`: (org_id,decided_by) → `app_user`(org_id,id)
- `hub_ufk_gate_assessment_reviewed_by`: (org_id,reviewed_by) → `app_user`(org_id,id)
- `hub_ufk_gate_assessment_started_by`: (org_id,started_by) → `app_user`(org_id,id)
- `hub_ufk_gate_assessment_submitted_by`: (org_id,submitted_by) → `app_user`(org_id,id)

### `criterion_assessment`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `assessment_id` | uuid | no |  |
| `criterion_id` | uuid | no |  |
| `status` | enum criterion_status | no | `'unmet'::criterion_status` |
| `note` | text | yes |  |
| `assessed_by` | uuid | yes |  |
| `assessed_at` | timestamp with time zone | yes |  |
| `waiver_id` | uuid | yes |  |
| `na_basis` | text | yes |  |
| `na_proposed_by` | uuid | yes |  |
| `na_determined_by` | uuid | yes |  |
| `na_approved` | boolean | no | `false` |
| `na_proposed_at` | timestamp with time zone | yes |  |
| `na_determined_role` | enum role_key | yes |  |
| `na_determined_at` | timestamp with time zone | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `criterion_assessment_assessment_fk`: (project_id,assessment_id) → `gate_assessment`(project_id,id) — composite project-scoped FK
- `criterion_assessment_criterion_fk`: (project_id,criterion_id) → `gate_criterion`(project_id,id) — composite project-scoped FK
- `criterion_assessment_project_id_project_id_fk`: (project_id) → `project`(id)
- `criterion_assessment_waiver_fk`: (project_id,waiver_id) → `waiver`(project_id,id) — composite project-scoped FK
- `hub_opfk_criterion_assessment`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_criterion_assessment_assessed_by`: (org_id,assessed_by) → `app_user`(org_id,id)
- `hub_ufk_criterion_assessment_na_determined_by`: (org_id,na_determined_by) → `app_user`(org_id,id)
- `hub_ufk_criterion_assessment_na_proposed_by`: (org_id,na_proposed_by) → `app_user`(org_id,id)

### `waiver`

RLS: enabled (hub_project_isolation) · Triggers: hub_same_project_target, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `target_type` | character varying | no |  |
| `target_id` | uuid | no |  |
| `basis` | text | no |  |
| `impact` | text | no |  |
| `status` | enum waiver_status | no | `'requested'::waiver_status` |
| `requested_by` | uuid | no |  |
| `decided_by` | uuid | yes |  |
| `decided_at` | timestamp with time zone | yes |  |
| `decision_note` | text | yes |  |
| `authority_role` | enum role_key | yes |  |
| `conditions` | text | yes |  |
| `expires_on` | date | yes |  |
| `approval_request_id` | uuid | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_waiver`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_waiver_decided_by`: (org_id,decided_by) → `app_user`(org_id,id)
- `hub_ufk_waiver_requested_by`: (org_id,requested_by) → `app_user`(org_id,id)
- `waiver_approval_request_fk`: (project_id,approval_request_id) → `approval_request`(project_id,id) — composite project-scoped FK
- `waiver_project_id_project_id_fk`: (project_id) → `project`(id)

### `status_dimension`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `key` | enum status_dimension_key | no |  |
| `state` | character varying | no |  |
| `explanation` | text | yes |  |
| `explanation_i18n` | jsonb | yes |  |
| `counts` | jsonb | yes |  |
| `computed_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_status_dimension`: (org_id,project_id) → `project`(org_id,id)
- `status_dimension_project_id_project_id_fk`: (project_id) → `project`(id)

## Carve-out, NewCo, readiness & TSA

### `perimeter_item`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `type` | enum perimeter_item_type | no |  |
| `name` | text | no |  |
| `description` | text | yes |  |
| `site_id` | uuid | yes |  |
| `workstream_id` | uuid | yes |  |
| `owner_user_id` | uuid | yes |  |
| `current_entity_id` | uuid | yes |  |
| `target_entity_id` | uuid | yes |  |
| `disposition` | enum perimeter_disposition | no | `'pending'::perimeter_disposition` |
| `resolution_path` | text | yes |  |
| `target_gate_key` | character varying | yes |  |
| `legal_owner` | text | yes |  |
| `operator` | text | yes |  |
| `economic_beneficiary` | text | yes |  |
| `planned_effective_date` | date | yes |  |
| `actual_effective_date` | date | yes |  |
| `economic_planned_effective_date` | date | yes |  |
| `economic_actual_effective_date` | date | yes |  |
| `transfer_mechanism` | text | yes |  |
| `agreement_id` | uuid | yes |  |
| `reference_value_amount` | numeric | yes |  |
| `reference_value_currency` | character varying | yes |  |
| `reference_value_unit_scale` | integer | yes |  |
| `reference_value_source` | text | yes |  |
| `consent_required` | boolean | no | `false` |
| `dependencies` | text | yes |  |
| `risks` | text | yes |  |
| `transfer_status` | enum transfer_status | no | `'not_started'::transfer_status` |
| `economic_transfer_status` | enum transfer_status | no | `'not_started'::transfer_status` |
| `acceptance_evidence_note` | text | yes |  |
| `transfer_class` | enum contract_transfer_class | no | `'unknown'::contract_transfer_class` |
| `transfer_class_assessed_by` | uuid | yes |  |
| `transfer_class_assessed_at` | timestamp with time zone | yes |  |
| `transfer_class_basis` | text | yes |  |
| `interim_arrangement` | text | yes |  |
| `service_accountable_user_id` | uuid | yes |  |
| `billing_accountable_user_id` | uuid | yes |  |
| `sla_accountable_user_id` | uuid | yes |  |
| `remediation_plan` | text | yes |  |
| `pending_change_request_id` | uuid | yes |  |
| `verification_status` | enum verification_status | no | `'proposed'::verification_status` |
| `classification` | enum classification | no | `'confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_perimeter_item`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_perimeter_item_billing_accountable_user_id`: (org_id,billing_accountable_user_id) → `app_user`(org_id,id)
- `hub_ufk_perimeter_item_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_perimeter_item_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `hub_ufk_perimeter_item_service_accountable_user_id`: (org_id,service_accountable_user_id) → `app_user`(org_id,id)
- `hub_ufk_perimeter_item_sla_accountable_user_id`: (org_id,sla_accountable_user_id) → `app_user`(org_id,id)
- `hub_ufk_perimeter_item_transfer_class_assessed_by`: (org_id,transfer_class_assessed_by) → `app_user`(org_id,id)
- `perimeter_item_agreement_fk`: (project_id,agreement_id) → `agreement`(project_id,id) — composite project-scoped FK
- `perimeter_item_billing_accountable_user_id_app_user_id_fk`: (billing_accountable_user_id) → `app_user`(id)
- `perimeter_item_current_entity_id_legal_entity_id_fk`: (current_entity_id) → `legal_entity`(id)
- `perimeter_item_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `perimeter_item_pending_cr_fk`: (project_id,pending_change_request_id) → `change_request`(project_id,id) — composite project-scoped FK
- `perimeter_item_project_id_project_id_fk`: (project_id) → `project`(id)
- `perimeter_item_service_accountable_user_id_app_user_id_fk`: (service_accountable_user_id) → `app_user`(id)
- `perimeter_item_site_fk`: (project_id,site_id) → `site`(project_id,id) — composite project-scoped FK
- `perimeter_item_sla_accountable_user_id_app_user_id_fk`: (sla_accountable_user_id) → `app_user`(id)
- `perimeter_item_target_entity_id_legal_entity_id_fk`: (target_entity_id) → `legal_entity`(id)
- `perimeter_item_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK

### `transfer_record`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `perimeter_item_id` | uuid | no |  |
| `aspect` | character varying | no |  |
| `command` | character varying | no |  |
| `from_status` | enum transfer_status | no |  |
| `to_status` | enum transfer_status | no |  |
| `mechanism` | text | yes |  |
| `effective_date` | date | yes |  |
| `note` | text | yes |  |
| `evidence_count` | integer | no | `0` |
| `reviews_record_id` | uuid | yes |  |
| `recorded_by` | uuid | no |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_opfk_transfer_record`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_transfer_record_recorded_by`: (org_id,recorded_by) → `app_user`(org_id,id)
- `transfer_record_item_fk`: (project_id,perimeter_item_id) → `perimeter_item`(project_id,id) — composite project-scoped FK
- `transfer_record_project_id_project_id_fk`: (project_id) → `project`(id)
- `transfer_record_reviews_fk`: (project_id,reviews_record_id) → `transfer_record`(project_id,id) — composite project-scoped FK

### `agreement`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `kind_label` | character varying | no |  |
| `kind_expansion` | text | yes |  |
| `kind_expansion_confirmed` | boolean | no | `false` |
| `kind_expansion_confirmed_by` | uuid | yes |  |
| `kind_expansion_confirmed_at` | timestamp with time zone | yes |  |
| `kind_expansion_basis` | text | yes |  |
| `title` | text | no |  |
| `parties` | jsonb | no | `'[]'::jsonb` |
| `scope` | text | yes |  |
| `owner_user_id` | uuid | yes |  |
| `legal_reviewer_user_id` | uuid | yes |  |
| `current_draft_version` | character varying | yes |  |
| `stage` | enum agreement_stage | no | `'identified'::agreement_stage` |
| `outstanding_issues` | text | yes |  |
| `signing_date` | date | yes |  |
| `effective_date` | date | yes |  |
| `renewal_date` | date | yes |  |
| `expiry_date` | date | yes |  |
| `obligations` | text | yes |  |
| `executed_document_id` | uuid | yes |  |
| `classification` | enum classification | no | `'confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `agreement_executed_doc_fk`: (project_id,executed_document_id) → `document`(project_id,id) — composite project-scoped FK
- `agreement_legal_reviewer_user_id_app_user_id_fk`: (legal_reviewer_user_id) → `app_user`(id)
- `agreement_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `agreement_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_agreement`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_agreement_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_agreement_kind_expansion_confirmed_by`: (org_id,kind_expansion_confirmed_by) → `app_user`(org_id,id)
- `hub_ufk_agreement_legal_reviewer_user_id`: (org_id,legal_reviewer_user_id) → `app_user`(org_id,id)
- `hub_ufk_agreement_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)

### `consent`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `perimeter_item_id` | uuid | yes |  |
| `agreement_id` | uuid | yes |  |
| `kind` | character varying | no | `'consent'::character varying` |
| `counterparty` | text | no |  |
| `contract_ref` | text | yes |  |
| `owner_user_id` | uuid | yes |  |
| `status` | enum consent_status | no | `'not_requested'::consent_status` |
| `requested_on` | date | yes |  |
| `responded_on` | date | yes |  |
| `conditions` | text | yes |  |
| `due_date` | date | yes |  |
| `valid_to` | date | yes |  |
| `response_evidence_note` | text | yes |  |
| `response_document_id` | uuid | yes |  |
| `response_recorded_by` | uuid | yes |  |
| `response_recorded_at` | timestamp with time zone | yes |  |
| `classification` | enum classification | no | `'confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `consent_agreement_fk`: (project_id,agreement_id) → `agreement`(project_id,id) — composite project-scoped FK
- `consent_item_fk`: (project_id,perimeter_item_id) → `perimeter_item`(project_id,id) — composite project-scoped FK
- `consent_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `consent_project_id_project_id_fk`: (project_id) → `project`(id)
- `consent_response_doc_fk`: (project_id,response_document_id) → `document`(project_id,id) — composite project-scoped FK
- `hub_opfk_consent`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_consent_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_consent_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `hub_ufk_consent_response_recorded_by`: (org_id,response_recorded_by) → `app_user`(org_id,id)

### `regulatory_requirement`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `category` | enum approval_register_category | no |  |
| `authority` | text | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `origin` | character varying | no | `'manual'::character varying` |
| `source_reference` | text | yes |  |
| `applicability` | enum applicability_status | no | `'assessment_pending'::applicability_status` |
| `applicability_assessed_by` | uuid | yes |  |
| `applicability_assessed_at` | timestamp with time zone | yes |  |
| `applicability_note` | text | yes |  |
| `status` | enum requirement_status | no | `'not_started'::requirement_status` |
| `owner_user_id` | uuid | yes |  |
| `submitted_on` | date | yes |  |
| `decision_on` | date | yes |  |
| `conditions` | text | yes |  |
| `valid_from` | date | yes |  |
| `valid_to` | date | yes |  |
| `outcome_recorded_by` | uuid | yes |  |
| `outcome_recorded_at` | timestamp with time zone | yes |  |
| `conditions_satisfied_by` | uuid | yes |  |
| `conditions_satisfied_at` | timestamp with time zone | yes |  |
| `conditions_satisfaction_note` | text | yes |  |
| `legal_entity_id` | uuid | yes |  |
| `gate_key` | character varying | yes |  |
| `verification_status` | enum verification_status | no | `'proposed'::verification_status` |
| `classification` | enum classification | no | `'confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_regulatory_requirement`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_regulatory_requirement_applicability_assessed_by`: (org_id,applicability_assessed_by) → `app_user`(org_id,id)
- `hub_ufk_regulatory_requirement_conditions_satisfied_by`: (org_id,conditions_satisfied_by) → `app_user`(org_id,id)
- `hub_ufk_regulatory_requirement_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_regulatory_requirement_outcome_recorded_by`: (org_id,outcome_recorded_by) → `app_user`(org_id,id)
- `hub_ufk_regulatory_requirement_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `regulatory_requirement_legal_entity_id_legal_entity_id_fk`: (legal_entity_id) → `legal_entity`(id)
- `regulatory_requirement_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `regulatory_requirement_project_id_project_id_fk`: (project_id) → `project`(id)

### `tsa_service`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `name` | text | no |  |
| `agreement_id` | uuid | yes |  |
| `provider_entity_id` | uuid | yes |  |
| `recipient_entity_id` | uuid | yes |  |
| `scope` | text | yes |  |
| `dependent_services` | text | yes |  |
| `sla` | text | yes |  |
| `metric_method` | text | yes |  |
| `charge_basis` | text | yes |  |
| `charge_amount` | numeric | yes |  |
| `charge_currency` | character varying | yes |  |
| `charge_unit_scale` | integer | yes |  |
| `start_date` | date | yes |  |
| `end_date` | date | yes |  |
| `extension_terms` | text | yes |  |
| `termination_terms` | text | yes |  |
| `owner_user_id` | uuid | yes |  |
| `workstream_id` | uuid | yes |  |
| `classification` | enum classification | no | `'confidential'::classification` |
| `replacement_service` | text | yes |  |
| `replacement_plan` | text | yes |  |
| `replacement_due_date` | date | yes |  |
| `replacement_accepted` | boolean | no | `false` |
| `replacement_accepted_by` | uuid | yes |  |
| `replacement_accepted_at` | timestamp with time zone | yes |  |
| `replacement_failed_at` | timestamp with time zone | yes |  |
| `replacement_failure_note` | text | yes |  |
| `exit_milestones` | jsonb | no | `'[]'::jsonb` |
| `acceptance_evidence_note` | text | yes |  |
| `residual_risks` | text | yes |  |
| `is_enduring_arrangement` | boolean | no | `false` |
| `status` | enum tsa_status | no | `'proposed'::tsa_status` |
| `pre_breach_status` | enum tsa_status | yes |  |
| `escalation_id` | uuid | yes |  |
| `approval_decision_id` | uuid | yes |  |
| `extension_decision_id` | uuid | yes |  |
| `proposed_end_date` | date | yes |  |
| `extension_requested_by` | uuid | yes |  |
| `extension_requested_at` | timestamp with time zone | yes |  |
| `continuity_plan` | text | yes |  |
| `exit_approval_request_id` | uuid | yes |  |
| `exit_approved_by` | uuid | yes |  |
| `exit_approved_at` | timestamp with time zone | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_tsa_service`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_tsa_service_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_tsa_service_exit_approved_by`: (org_id,exit_approved_by) → `app_user`(org_id,id)
- `hub_ufk_tsa_service_extension_requested_by`: (org_id,extension_requested_by) → `app_user`(org_id,id)
- `hub_ufk_tsa_service_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `hub_ufk_tsa_service_replacement_accepted_by`: (org_id,replacement_accepted_by) → `app_user`(org_id,id)
- `tsa_service_agreement_fk`: (project_id,agreement_id) → `agreement`(project_id,id) — composite project-scoped FK
- `tsa_service_approval_decision_fk`: (project_id,approval_decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `tsa_service_escalation_fk`: (project_id,escalation_id) → `escalation`(project_id,id) — composite project-scoped FK
- `tsa_service_exit_approval_fk`: (project_id,exit_approval_request_id) → `approval_request`(project_id,id) — composite project-scoped FK
- `tsa_service_extension_decision_fk`: (project_id,extension_decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `tsa_service_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `tsa_service_project_id_project_id_fk`: (project_id) → `project`(id)
- `tsa_service_provider_entity_id_legal_entity_id_fk`: (provider_entity_id) → `legal_entity`(id)
- `tsa_service_recipient_entity_id_legal_entity_id_fk`: (recipient_entity_id) → `legal_entity`(id)
- `tsa_service_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK

### `readiness_check`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `area` | enum readiness_area | no |  |
| `title` | text | no |  |
| `title_ar` | text | yes |  |
| `site_id` | uuid | yes |  |
| `workstream_id` | uuid | yes |  |
| `cutover_plan_id` | uuid | yes |  |
| `owner_user_id` | uuid | yes |  |
| `template_key` | character varying | yes |  |
| `mandatory` | boolean | no | `true` |
| `blocker` | boolean | no | `false` |
| `waivable` | boolean | no | `false` |
| `waiver_authority_role` | enum role_key | yes |  |
| `waivability_basis` | text | yes |  |
| `waivability_determined_by` | uuid | yes |  |
| `waivability_determined_at` | timestamp with time zone | yes |  |
| `waiver_id` | uuid | yes |  |
| `status` | enum readiness_status | no | `'not_started'::readiness_status` |
| `signoff_role` | enum role_key | yes |  |
| `signed_off_by` | uuid | yes |  |
| `signed_off_at` | timestamp with time zone | yes |  |
| `signoff_note` | text | yes |  |
| `test_result` | text | yes |  |
| `failure_contingency` | text | yes |  |
| `due_date` | date | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_readiness_check`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_readiness_check_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_readiness_check_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `hub_ufk_readiness_check_signed_off_by`: (org_id,signed_off_by) → `app_user`(org_id,id)
- `hub_ufk_readiness_check_waivability_determined_by`: (org_id,waivability_determined_by) → `app_user`(org_id,id)
- `readiness_check_cutover_fk`: (project_id,cutover_plan_id) → `cutover_plan`(project_id,id) — composite project-scoped FK
- `readiness_check_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `readiness_check_project_id_project_id_fk`: (project_id) → `project`(id)
- `readiness_check_site_fk`: (project_id,site_id) → `site`(project_id,id) — composite project-scoped FK
- `readiness_check_waiver_fk`: (project_id,waiver_id) → `waiver`(project_id,id) — composite project-scoped FK
- `readiness_check_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK

### `readiness_test_run`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `readiness_check_id` | uuid | no |  |
| `result` | enum readiness_status | no |  |
| `note` | text | yes |  |
| `recorded_by` | uuid | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `seq` | integer | no | `1` |

Foreign keys:

- `hub_opfk_readiness_test_run`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_readiness_test_run_recorded_by`: (org_id,recorded_by) → `app_user`(org_id,id)
- `readiness_test_run_check_fk`: (project_id,readiness_check_id) → `readiness_check`(project_id,id) — composite project-scoped FK
- `readiness_test_run_project_id_project_id_fk`: (project_id) → `project`(id)

### `cutover_plan`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `site_id` | uuid | yes |  |
| `workstream_id` | uuid | yes |  |
| `runbook_document_id` | uuid | yes |  |
| `runbook_summary` | text | yes |  |
| `window_start` | timestamp with time zone | yes |  |
| `window_end` | timestamp with time zone | yes |  |
| `service_impact` | text | yes |  |
| `accountable_user_id` | uuid | yes |  |
| `communications_approved` | boolean | no | `false` |
| `communications_approval_ref` | text | yes |  |
| `testing_summary` | text | yes |  |
| `rehearsal_done` | boolean | no | `false` |
| `contingency_plan` | text | yes |  |
| `rollback_plan` | text | yes |  |
| `go_no_go` | enum go_no_go | no | `'pending'::go_no_go` |
| `go_no_go_decided_by` | uuid | yes |  |
| `go_no_go_decided_at` | timestamp with time zone | yes |  |
| `go_no_go_rationale` | text | yes |  |
| `go_decision_id` | uuid | yes |  |
| `status` | enum cutover_status | no | `'planning'::cutover_status` |
| `submitted_for_decision_by` | uuid | yes |  |
| `submitted_for_decision_at` | timestamp with time zone | yes |  |
| `executed_by` | uuid | yes |  |
| `executed_at` | timestamp with time zone | yes |  |
| `execution_note` | text | yes |  |
| `post_transition_accepted` | boolean | no | `false` |
| `post_transition_accepted_by` | uuid | yes |  |
| `post_transition_accepted_at` | timestamp with time zone | yes |  |
| `post_transition_acceptance_note` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `cutover_plan_accountable_user_id_app_user_id_fk`: (accountable_user_id) → `app_user`(id)
- `cutover_plan_go_decision_fk`: (project_id,go_decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `cutover_plan_project_id_project_id_fk`: (project_id) → `project`(id)
- `cutover_plan_runbook_fk`: (project_id,runbook_document_id) → `document`(project_id,id) — composite project-scoped FK
- `cutover_plan_site_fk`: (project_id,site_id) → `site`(project_id,id) — composite project-scoped FK
- `cutover_plan_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK
- `hub_opfk_cutover_plan`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_cutover_plan_accountable_user_id`: (org_id,accountable_user_id) → `app_user`(org_id,id)
- `hub_ufk_cutover_plan_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_cutover_plan_executed_by`: (org_id,executed_by) → `app_user`(org_id,id)
- `hub_ufk_cutover_plan_go_no_go_decided_by`: (org_id,go_no_go_decided_by) → `app_user`(org_id,id)
- `hub_ufk_cutover_plan_post_transition_accepted_by`: (org_id,post_transition_accepted_by) → `app_user`(org_id,id)
- `hub_ufk_cutover_plan_submitted_for_decision_by`: (org_id,submitted_for_decision_by) → `app_user`(org_id,id)

### `agreement_version`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `agreement_id` | uuid | no |  |
| `version_label` | character varying | no |  |
| `document_id` | uuid | yes |  |
| `document_version_id` | uuid | yes |  |
| `note` | text | yes |  |
| `recorded_by` | uuid | no |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `agreement_version_agreement_fk`: (project_id,agreement_id) → `agreement`(project_id,id) — composite project-scoped FK
- `agreement_version_document_fk`: (project_id,document_id) → `document`(project_id,id) — composite project-scoped FK
- `agreement_version_docver_fk`: (project_id,document_version_id) → `document_version`(project_id,id) — composite project-scoped FK
- `agreement_version_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_agreement_version`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_agreement_version_recorded_by`: (org_id,recorded_by) → `app_user`(org_id,id)

### `perimeter_version`

RLS: enabled (hub_project_isolation) · Triggers: hub_frozen_snapshot_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `version_no` | integer | no |  |
| `status` | character varying | no | `'proposed'::character varying` |
| `snapshot` | jsonb | no |  |
| `snapshot_hash` | text | no |  |
| `item_count` | integer | no |  |
| `note` | text | yes |  |
| `proposed_by` | uuid | no |  |
| `decided_by` | uuid | yes |  |
| `decided_at` | timestamp with time zone | yes |  |
| `decision_id` | uuid | yes |  |
| `decision_note` | text | yes |  |
| `superseded_at` | timestamp with time zone | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_perimeter_version`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_perimeter_version_decided_by`: (org_id,decided_by) → `app_user`(org_id,id)
- `hub_ufk_perimeter_version_proposed_by`: (org_id,proposed_by) → `app_user`(org_id,id)
- `perimeter_version_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `perimeter_version_project_id_project_id_fk`: (project_id) → `project`(id)

### `perimeter_category_review`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `category` | enum perimeter_item_type | no |  |
| `conclusion` | text | no |  |
| `reviewed_by` | uuid | no |  |
| `reviewed_at` | timestamp with time zone | no | `now()` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_perimeter_category_review`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_perimeter_category_review_reviewed_by`: (org_id,reviewed_by) → `app_user`(org_id,id)
- `perimeter_category_review_project_id_project_id_fk`: (project_id) → `project`(id)

### `perimeter_impact_assessment`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `perimeter_item_id` | uuid | no |  |
| `change_request_id` | uuid | yes |  |
| `trigger` | character varying | no |  |
| `entries` | jsonb | no |  |
| `narrative` | jsonb | no | `'{}'::jsonb` |
| `assessed_by` | uuid | no |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_opfk_perimeter_impact_assessment`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_perimeter_impact_assessment_assessed_by`: (org_id,assessed_by) → `app_user`(org_id,id)
- `perimeter_impact_assessment_project_id_project_id_fk`: (project_id) → `project`(id)
- `perimeter_impact_cr_fk`: (project_id,change_request_id) → `change_request`(project_id,id) — composite project-scoped FK
- `perimeter_impact_item_fk`: (project_id,perimeter_item_id) → `perimeter_item`(project_id,id) — composite project-scoped FK

### `cutover_decision_record`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `cutover_plan_id` | uuid | no |  |
| `kind` | character varying | no |  |
| `from_status` | enum cutover_status | yes |  |
| `to_status` | enum cutover_status | yes |  |
| `actor_user_id` | uuid | yes |  |
| `rationale` | text | yes |  |
| `go_decision_id` | uuid | yes |  |
| `evaluation` | jsonb | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `cutover_decision_record_decision_fk`: (project_id,go_decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `cutover_decision_record_plan_fk`: (project_id,cutover_plan_id) → `cutover_plan`(project_id,id) — composite project-scoped FK
- `cutover_decision_record_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_cutover_decision_record`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_cutover_decision_record_actor_user_id`: (org_id,actor_user_id) → `app_user`(org_id,id)

### `operating_model_definition`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `version_label` | character varying | no |  |
| `definition` | text | no |  |
| `independence_criteria` | jsonb | no | `'[]'::jsonb` |
| `permitted_enduring_arrangements` | text | yes |  |
| `status` | character varying | no | `'proposed'::character varying` |
| `approved_by` | uuid | yes |  |
| `approved_at` | timestamp with time zone | yes |  |
| `decision_id` | uuid | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_operating_model_definition`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_operating_model_definition_approved_by`: (org_id,approved_by) → `app_user`(org_id,id)
- `hub_ufk_operating_model_definition_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `operating_model_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `operating_model_definition_project_id_project_id_fk`: (project_id) → `project`(id)

## Finance

### `financial_snapshot`

RLS: enabled (hub_project_isolation) · Triggers: hub_finance_approved_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `kind` | enum financial_kind | no |  |
| `category` | enum financial_category | no |  |
| `line_ref` | character varying | no |  |
| `label` | text | no |  |
| `period` | character varying | no |  |
| `amount` | numeric | no |  |
| `currency` | character varying | no |  |
| `unit_scale` | integer | no | `1` |
| `source_type` | enum source_type | no | `'manual_entry'::source_type` |
| `source_ref` | text | yes |  |
| `source_document_id` | uuid | yes |  |
| `source_document_version_id` | uuid | yes |  |
| `source_sheet` | character varying | yes |  |
| `source_cell` | character varying | yes |  |
| `import_batch_id` | uuid | yes |  |
| `tsa_service_id` | uuid | yes |  |
| `approval_state` | enum approval_state | no | `'proposed'::approval_state` |
| `prepared_by` | uuid | yes |  |
| `validated_by` | uuid | yes |  |
| `validated_at` | timestamp with time zone | yes |  |
| `validation_note` | text | yes |  |
| `validated_hash` | text | yes |  |
| `approval_request_id` | uuid | yes |  |
| `approval_decision_id` | uuid | yes |  |
| `approved_by` | uuid | yes |  |
| `approved_at` | timestamp with time zone | yes |  |
| `workstream_id` | uuid | yes |  |
| `classification` | enum classification | no | `'restricted'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `financial_snapshot_decision_fk`: (project_id,approval_decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `financial_snapshot_doc_fk`: (project_id,source_document_id) → `document`(project_id,id) — composite project-scoped FK
- `financial_snapshot_docver_fk`: (project_id,source_document_version_id) → `document_version`(project_id,id) — composite project-scoped FK
- `financial_snapshot_import_fk`: (project_id,import_batch_id) → `import_batch`(project_id,id) — composite project-scoped FK
- `financial_snapshot_project_id_project_id_fk`: (project_id) → `project`(id)
- `financial_snapshot_request_fk`: (project_id,approval_request_id) → `approval_request`(project_id,id) — composite project-scoped FK
- `financial_snapshot_tsa_fk`: (project_id,tsa_service_id) → `tsa_service`(project_id,id) — composite project-scoped FK
- `financial_snapshot_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK
- `hub_opfk_financial_snapshot`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_financial_snapshot_approved_by`: (org_id,approved_by) → `app_user`(org_id,id)
- `hub_ufk_financial_snapshot_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_financial_snapshot_prepared_by`: (org_id,prepared_by) → `app_user`(org_id,id)
- `hub_ufk_financial_snapshot_validated_by`: (org_id,validated_by) → `app_user`(org_id,id)

### `budget_line`

RLS: enabled (hub_project_isolation) · Triggers: hub_finance_approved_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `workstream_id` | uuid | yes |  |
| `code` | character varying | no |  |
| `name` | text | no |  |
| `category` | enum financial_category | no |  |
| `proposed_amount` | numeric | yes |  |
| `approved_amount` | numeric | yes |  |
| `committed_amount` | numeric | no | `'0'::numeric` |
| `spent_amount` | numeric | no | `'0'::numeric` |
| `currency` | character varying | no |  |
| `unit_scale` | integer | no | `1` |
| `actuals_as_of` | date | yes |  |
| `actuals_source_ref` | text | yes |  |
| `tsa_service_id` | uuid | yes |  |
| `approval_state` | enum approval_state | no | `'proposed'::approval_state` |
| `approval_decision_id` | uuid | yes |  |
| `approved_by` | uuid | yes |  |
| `approved_at` | timestamp with time zone | yes |  |
| `source_ref` | text | yes |  |
| `classification` | enum classification | no | `'confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `budget_line_decision_fk`: (project_id,approval_decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `budget_line_project_id_project_id_fk`: (project_id) → `project`(id)
- `budget_line_tsa_fk`: (project_id,tsa_service_id) → `tsa_service`(project_id,id) — composite project-scoped FK
- `budget_line_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK
- `hub_opfk_budget_line`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_budget_line_approved_by`: (org_id,approved_by) → `app_user`(org_id,id)
- `hub_ufk_budget_line_created_by`: (org_id,created_by) → `app_user`(org_id,id)

### `financial_model`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `kind` | enum model_kind | no |  |
| `name` | text | no |  |
| `description` | text | yes |  |
| `classification` | enum classification | no | `'strictly_confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `financial_model_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_financial_model`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_financial_model_created_by`: (org_id,created_by) → `app_user`(org_id,id)

### `financial_model_version`

RLS: enabled (hub_project_isolation) · Triggers: hub_finance_model_version_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `model_id` | uuid | no |  |
| `kind` | enum model_kind | no |  |
| `version_no` | integer | no |  |
| `version_label` | character varying | no |  |
| `model_case` | enum model_case | no |  |
| `based_on_version_id` | uuid | yes |  |
| `superseded_by_id` | uuid | yes |  |
| `assumptions` | jsonb | no | `'[]'::jsonb` |
| `outputs` | jsonb | no | `'[]'::jsonb` |
| `headline_basis` | enum value_basis | yes |  |
| `source_type` | enum source_type | no | `'manual_entry'::source_type` |
| `source_document_id` | uuid | yes |  |
| `source_document_version_id` | uuid | yes |  |
| `source_ref` | text | yes |  |
| `import_batch_id` | uuid | yes |  |
| `change_note` | text | yes |  |
| `approval_state` | enum approval_state | no | `'proposed'::approval_state` |
| `prepared_by` | uuid | yes |  |
| `validated_by` | uuid | yes |  |
| `validated_at` | timestamp with time zone | yes |  |
| `human_validation_note` | text | yes |  |
| `validated_hash` | text | yes |  |
| `approval_request_id` | uuid | yes |  |
| `approval_decision_id` | uuid | yes |  |
| `approved_values` | jsonb | yes |  |
| `approved_by` | uuid | yes |  |
| `approved_at` | timestamp with time zone | yes |  |
| `classification` | enum classification | no | `'strictly_confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `financial_model_based_on_fk`: (project_id,based_on_version_id) → `financial_model_version`(project_id,id) — composite project-scoped FK
- `financial_model_decision_fk`: (project_id,approval_decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `financial_model_doc_fk`: (project_id,source_document_id) → `document`(project_id,id) — composite project-scoped FK
- `financial_model_docver_fk`: (project_id,source_document_version_id) → `document_version`(project_id,id) — composite project-scoped FK
- `financial_model_import_fk`: (project_id,import_batch_id) → `import_batch`(project_id,id) — composite project-scoped FK
- `financial_model_request_fk`: (project_id,approval_request_id) → `approval_request`(project_id,id) — composite project-scoped FK
- `financial_model_superseded_fk`: (project_id,superseded_by_id) → `financial_model_version`(project_id,id) — composite project-scoped FK
- `financial_model_version_model_fk`: (project_id,model_id) → `financial_model`(project_id,id) — composite project-scoped FK
- `financial_model_version_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_financial_model_version`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_financial_model_version_approved_by`: (org_id,approved_by) → `app_user`(org_id,id)
- `hub_ufk_financial_model_version_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_financial_model_version_prepared_by`: (org_id,prepared_by) → `app_user`(org_id,id)
- `hub_ufk_financial_model_version_validated_by`: (org_id,validated_by) → `app_user`(org_id,id)

### `benefit`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `measurement_definition` | text | no |  |
| `baseline_value` | text | yes |  |
| `target_value` | text | yes |  |
| `actual_value` | text | yes |  |
| `unit` | character varying | yes |  |
| `value_amount` | numeric | yes |  |
| `value_currency` | character varying | yes |  |
| `value_unit_scale` | integer | yes |  |
| `realized_amount` | numeric | yes |  |
| `realized_currency` | character varying | yes |  |
| `realized_unit_scale` | integer | yes |  |
| `owner_user_id` | uuid | yes |  |
| `workstream_id` | uuid | yes |  |
| `realization_date` | date | yes |  |
| `realized_on` | date | yes |  |
| `verification_source` | text | yes |  |
| `status` | enum benefit_status | no | `'proposed'::benefit_status` |
| `approved_by` | uuid | yes |  |
| `approved_at` | timestamp with time zone | yes |  |
| `realization_recorded_by` | uuid | yes |  |
| `realization_recorded_at` | timestamp with time zone | yes |  |
| `verified_by` | uuid | yes |  |
| `verified_at` | timestamp with time zone | yes |  |
| `verification_note` | text | yes |  |
| `status_note` | text | yes |  |
| `classification` | enum classification | no | `'confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `benefit_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `benefit_project_id_project_id_fk`: (project_id) → `project`(id)
- `benefit_ws_fk`: (project_id,workstream_id) → `workstream`(project_id,id) — composite project-scoped FK
- `hub_opfk_benefit`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_benefit_approved_by`: (org_id,approved_by) → `app_user`(org_id,id)
- `hub_ufk_benefit_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_benefit_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `hub_ufk_benefit_realization_recorded_by`: (org_id,realization_recorded_by) → `app_user`(org_id,id)
- `hub_ufk_benefit_verified_by`: (org_id,verified_by) → `app_user`(org_id,id)

### `kpi`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `key` | character varying | no |  |
| `name` | text | no |  |
| `name_ar` | text | yes |  |
| `definition` | text | no |  |
| `formula` | text | no |  |
| `unit` | character varying | no |  |
| `period` | character varying | no |  |
| `owner_role` | character varying | yes |  |
| `owner_user_id` | uuid | yes |  |
| `benefit_id` | uuid | yes |  |
| `source` | text | no |  |
| `target` | text | yes |  |
| `thresholds` | jsonb | no |  |
| `direction` | enum kpi_direction | no |  |
| `frequency` | character varying | no |  |
| `computation` | character varying | yes |  |
| `verification_status` | enum verification_status | no | `'proposed'::verification_status` |
| `last_verified_at` | timestamp with time zone | yes |  |
| `classification` | enum classification | no | `'confidential'::classification` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_kpi`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_kpi_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_kpi_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `kpi_benefit_fk`: (project_id,benefit_id) → `benefit`(project_id,id) — composite project-scoped FK
- `kpi_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `kpi_project_id_project_id_fk`: (project_id) → `project`(id)

### `kpi_observation`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `kpi_id` | uuid | no |  |
| `period` | character varying | no |  |
| `value` | numeric | yes |  |
| `numerator` | numeric | yes |  |
| `denominator` | numeric | yes |  |
| `data_quality` | character varying | no | `'ok'::character varying` |
| `source_refs` | jsonb | no | `'[]'::jsonb` |
| `source_ref` | text | yes |  |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `computed_by` | character varying | no | `'system'::character varying` |
| `recorded_by` | uuid | yes |  |

Foreign keys:

- `hub_opfk_kpi_observation`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_kpi_observation_recorded_by`: (org_id,recorded_by) → `app_user`(org_id,id)
- `kpi_observation_kpi_fk`: (project_id,kpi_id) → `kpi`(project_id,id) — composite project-scoped FK
- `kpi_observation_project_id_project_id_fk`: (project_id) → `project`(id)

### `intercompany_reconciliation`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `financial_snapshot_id` | uuid | yes |  |
| `counterparty_label` | text | no |  |
| `period` | character varying | no |  |
| `our_balance` | numeric | no |  |
| `their_balance` | numeric | yes |  |
| `currency` | character varying | no |  |
| `unit_scale` | integer | no | `1` |
| `status` | character varying | no | `'open'::character varying` |
| `explanation` | text | yes |  |
| `source_ref` | text | yes |  |
| `prepared_by` | uuid | yes |  |
| `reviewer_user_id` | uuid | yes |  |
| `reviewed_at` | timestamp with time zone | yes |  |
| `classification` | enum classification | no | `'restricted'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_intercompany_reconciliation`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_intercompany_reconciliation_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_intercompany_reconciliation_prepared_by`: (org_id,prepared_by) → `app_user`(org_id,id)
- `hub_ufk_intercompany_reconciliation_reviewer_user_id`: (org_id,reviewer_user_id) → `app_user`(org_id,id)
- `intercompany_reconciliation_project_id_project_id_fk`: (project_id) → `project`(id)
- `intercompany_reconciliation_snapshot_fk`: (project_id,financial_snapshot_id) → `financial_snapshot`(project_id,id) — composite project-scoped FK

## JV & diligence

### `partner`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `name` | text | no |  |
| `description` | text | yes |  |
| `legal_entity_id` | uuid | yes |  |
| `stage` | enum partner_stage | no | `'identified'::partner_stage` |
| `stage_changed_at` | timestamp with time zone | yes |  |
| `shortlisted` | boolean | no | `false` |
| `outreach_request_id` | uuid | yes |  |
| `outreach_approved_by` | uuid | yes |  |
| `outreach_approved_at` | timestamp with time zone | yes |  |
| `nda_status` | enum nda_status | no | `'none'::nda_status` |
| `nda_executed_on` | date | yes |  |
| `nda_document_id` | uuid | yes |  |
| `nda_request_id` | uuid | yes |  |
| `nda_recorded_by` | uuid | yes |  |
| `nda_recorded_at` | timestamp with time zone | yes |  |
| `materials_access_approved_by` | uuid | yes |  |
| `materials_access_approved_at` | timestamp with time zone | yes |  |
| `withdrawn_reason` | text | yes |  |
| `classification` | enum classification | no | `'strictly_confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_partner`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_partner_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_partner_materials_access_approved_by`: (org_id,materials_access_approved_by) → `app_user`(org_id,id)
- `hub_ufk_partner_nda_recorded_by`: (org_id,nda_recorded_by) → `app_user`(org_id,id)
- `hub_ufk_partner_outreach_approved_by`: (org_id,outreach_approved_by) → `app_user`(org_id,id)
- `partner_legal_entity_id_legal_entity_id_fk`: (legal_entity_id) → `legal_entity`(id)
- `partner_nda_document_fk`: (project_id,nda_document_id) → `document`(project_id,id) — composite project-scoped FK
- `partner_nda_request_fk`: (project_id,nda_request_id) → `approval_request`(project_id,id) — composite project-scoped FK
- `partner_outreach_request_fk`: (project_id,outreach_request_id) → `approval_request`(project_id,id) — composite project-scoped FK
- `partner_project_id_project_id_fk`: (project_id) → `project`(id)

### `partner_room`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `partner_id` | uuid | yes |  |
| `name` | text | no |  |
| `description` | text | yes |  |
| `is_clean_team` | boolean | no | `false` |
| `classification` | enum classification | no | `'strictly_confidential'::classification` |
| `locked_at` | timestamp with time zone | yes |  |
| `locked_by` | uuid | yes |  |
| `lock_reason` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_partner_room`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_partner_room_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_partner_room_locked_by`: (org_id,locked_by) → `app_user`(org_id,id)
- `partner_room_partner_fk`: (project_id,partner_id) → `partner`(project_id,id) — composite project-scoped FK
- `partner_room_project_id_project_id_fk`: (project_id) → `project`(id)

### `room_grant`

RLS: enabled (hub_project_isolation) · Triggers: hub_account_type_guard, hub_room_grant_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `room_id` | uuid | no |  |
| `user_id` | uuid | no |  |
| `access_level` | character varying | no | `'read'::character varying` |
| `role` | enum role_key | yes |  |
| `reason` | text | no |  |
| `attestation_ref` | text | yes |  |
| `granted_by` | uuid | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `expires_at` | timestamp with time zone | yes |  |
| `revoked_at` | timestamp with time zone | yes |  |
| `revoked_by` | uuid | yes |  |
| `revoke_reason` | text | yes |  |

Foreign keys:

- `hub_opfk_room_grant`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_room_grant_granted_by`: (org_id,granted_by) → `app_user`(org_id,id)
- `hub_ufk_room_grant_revoked_by`: (org_id,revoked_by) → `app_user`(org_id,id)
- `hub_ufk_room_grant_user_id`: (org_id,user_id) → `app_user`(org_id,id)
- `room_grant_project_id_project_id_fk`: (project_id) → `project`(id)
- `room_grant_room_fk`: (project_id,room_id) → `partner_room`(project_id,id) — composite project-scoped FK
- `room_grant_user_id_app_user_id_fk`: (user_id) → `app_user`(id)

### `deal_scenario`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `partner_id` | uuid | yes |  |
| `code` | character varying | yes |  |
| `name` | text | no |  |
| `version_no` | integer | no | `1` |
| `version_label` | character varying | no |  |
| `ownership` | jsonb | no | `'[]'::jsonb` |
| `contributions` | jsonb | no | `'[]'::jsonb` |
| `governance_terms` | text | yes |  |
| `assumptions` | text | yes |  |
| `approval_state` | enum approval_state | no | `'proposed'::approval_state` |
| `approved_by` | uuid | yes |  |
| `approved_at` | timestamp with time zone | yes |  |
| `classification` | enum classification | no | `'strictly_confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `deal_scenario_partner_fk`: (project_id,partner_id) → `partner`(project_id,id) — composite project-scoped FK
- `deal_scenario_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_deal_scenario`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_deal_scenario_approved_by`: (org_id,approved_by) → `app_user`(org_id,id)
- `hub_ufk_deal_scenario_created_by`: (org_id,created_by) → `app_user`(org_id,id)

### `negotiation_issue`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `partner_id` | uuid | yes |  |
| `agreement_id` | uuid | yes |  |
| `code` | character varying | no |  |
| `issue` | text | no |  |
| `positions` | jsonb | no | `'[]'::jsonb` |
| `alternatives` | text | yes |  |
| `required_approval` | text | yes |  |
| `requires_approval` | boolean | no | `false` |
| `decision_id` | uuid | yes |  |
| `document_id` | uuid | yes |  |
| `document_ref` | text | yes |  |
| `resolution` | text | yes |  |
| `status` | enum negotiation_issue_status | no | `'open'::negotiation_issue_status` |
| `classification` | enum classification | no | `'strictly_confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_negotiation_issue`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_negotiation_issue_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `negotiation_issue_agreement_fk`: (project_id,agreement_id) → `agreement`(project_id,id) — composite project-scoped FK
- `negotiation_issue_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `negotiation_issue_document_fk`: (project_id,document_id) → `document`(project_id,id) — composite project-scoped FK
- `negotiation_issue_partner_fk`: (project_id,partner_id) → `partner`(project_id,id) — composite project-scoped FK
- `negotiation_issue_project_id_project_id_fk`: (project_id) → `project`(id)

### `diligence_request`

RLS: enabled (hub_project_isolation) · Triggers: hub_dd_request_room_cascade, hub_same_project_evidence_document_ids, hub_same_project_evidence_version_ids, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `partner_id` | uuid | yes |  |
| `room_id` | uuid | yes |  |
| `number` | integer | no |  |
| `origin` | character varying | no | `'internal'::character varying` |
| `question` | text | no |  |
| `domain` | character varying | no |  |
| `requester_label` | text | yes |  |
| `assignee_user_id` | uuid | yes |  |
| `due_date` | date | yes |  |
| `answer_draft` | text | yes |  |
| `drafted_by` | uuid | yes |  |
| `evidence_document_ids` | jsonb | no | `'[]'::jsonb` |
| `evidence_version_ids` | jsonb | no | `'[]'::jsonb` |
| `reviewer_user_id` | uuid | yes |  |
| `submitted_for_review_by` | uuid | yes |  |
| `submitted_for_review_at` | timestamp with time zone | yes |  |
| `release_status` | enum dd_release_status | no | `'draft'::dd_release_status` |
| `release_approved_by` | uuid | yes |  |
| `release_approved_at` | timestamp with time zone | yes |  |
| `review_note` | text | yes |  |
| `released_by` | uuid | yes |  |
| `released_answer` | text | yes |  |
| `released_version` | integer | yes |  |
| `released_at` | timestamp with time zone | yes |  |
| `classification` | enum classification | no | `'strictly_confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `diligence_request_assignee_user_id_app_user_id_fk`: (assignee_user_id) → `app_user`(id)
- `diligence_request_partner_fk`: (project_id,partner_id) → `partner`(project_id,id) — composite project-scoped FK
- `diligence_request_project_id_project_id_fk`: (project_id) → `project`(id)
- `diligence_request_reviewer_user_id_app_user_id_fk`: (reviewer_user_id) → `app_user`(id)
- `diligence_request_room_fk`: (project_id,room_id) → `partner_room`(project_id,id) — composite project-scoped FK
- `hub_opfk_diligence_request`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_diligence_request_assignee_user_id`: (org_id,assignee_user_id) → `app_user`(org_id,id)
- `hub_ufk_diligence_request_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_diligence_request_drafted_by`: (org_id,drafted_by) → `app_user`(org_id,id)
- `hub_ufk_diligence_request_release_approved_by`: (org_id,release_approved_by) → `app_user`(org_id,id)
- `hub_ufk_diligence_request_released_by`: (org_id,released_by) → `app_user`(org_id,id)
- `hub_ufk_diligence_request_reviewer_user_id`: (org_id,reviewer_user_id) → `app_user`(org_id,id)
- `hub_ufk_diligence_request_submitted_for_review_by`: (org_id,submitted_for_review_by) → `app_user`(org_id,id)

### `diligence_finding`

RLS: enabled (hub_project_isolation) · Triggers: hub_finding_room_sync, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `partner_id` | uuid | yes |  |
| `room_id` | uuid | yes |  |
| `diligence_request_id` | uuid | yes |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `materiality` | enum materiality | no |  |
| `risk_id` | uuid | yes |  |
| `remediation` | text | yes |  |
| `remediation_owner_user_id` | uuid | yes |  |
| `remediation_due_date` | date | yes |  |
| `valuation_implication` | text | yes |  |
| `document_implication` | text | yes |  |
| `cp_implication` | text | yes |  |
| `condition_id` | uuid | yes |  |
| `status_reason` | text | yes |  |
| `status` | enum finding_status | no | `'open'::finding_status` |
| `classification` | enum classification | no | `'strictly_confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `diligence_finding_condition_fk`: (project_id,condition_id) → `closing_condition`(project_id,id) — composite project-scoped FK
- `diligence_finding_partner_fk`: (project_id,partner_id) → `partner`(project_id,id) — composite project-scoped FK
- `diligence_finding_project_id_project_id_fk`: (project_id) → `project`(id)
- `diligence_finding_request_fk`: (project_id,diligence_request_id) → `diligence_request`(project_id,id) — composite project-scoped FK
- `diligence_finding_risk_fk`: (project_id,risk_id) → `risk`(project_id,id) — composite project-scoped FK
- `diligence_finding_room_fk`: (project_id,room_id) → `partner_room`(project_id,id) — composite project-scoped FK
- `hub_opfk_diligence_finding`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_diligence_finding_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_diligence_finding_remediation_owner_user_id`: (org_id,remediation_owner_user_id) → `app_user`(org_id,id)

### `closing`

RLS: enabled (hub_project_isolation) · Triggers: hub_closing_signing_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `partner_id` | uuid | yes |  |
| `kind` | enum closing_kind | no |  |
| `code` | character varying | yes |  |
| `sequence` | integer | no | `1` |
| `name` | text | no |  |
| `description` | text | yes |  |
| `signing_id` | uuid | yes |  |
| `target_date` | date | yes |  |
| `status` | enum closing_status | no | `'planned'::closing_status` |
| `confirmation_request_id` | uuid | yes |  |
| `executed_document_id` | uuid | yes |  |
| `confirmed_by` | uuid | yes |  |
| `confirmed_at` | timestamp with time zone | yes |  |
| `confirmation_authority` | text | yes |  |
| `confirmation_decision_id` | uuid | yes |  |
| `readiness_snapshot` | jsonb | yes |  |
| `status_reason` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `closing_confirmation_request_fk`: (project_id,confirmation_request_id) → `approval_request`(project_id,id) — composite project-scoped FK
- `closing_decision_fk`: (project_id,confirmation_decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `closing_executed_document_fk`: (project_id,executed_document_id) → `document`(project_id,id) — composite project-scoped FK
- `closing_partner_fk`: (project_id,partner_id) → `partner`(project_id,id) — composite project-scoped FK
- `closing_project_id_project_id_fk`: (project_id) → `project`(id)
- `closing_signing_fk`: (project_id,signing_id) → `closing`(project_id,id) — composite project-scoped FK
- `hub_opfk_closing`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_closing_confirmed_by`: (org_id,confirmed_by) → `app_user`(org_id,id)
- `hub_ufk_closing_created_by`: (org_id,created_by) → `app_user`(org_id,id)

### `closing_condition`

RLS: enabled (hub_project_isolation) · Triggers: hub_jv_event_link_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `closing_id` | uuid | yes |  |
| `kind` | enum condition_kind | no | `'condition_precedent'::condition_kind` |
| `reference` | character varying | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `owner_user_id` | uuid | yes |  |
| `parties` | text | yes |  |
| `blocking` | boolean | no | `true` |
| `waivable` | boolean | no | `false` |
| `waiver_authority_role` | enum role_key | yes |  |
| `waiver_authority_note` | text | yes |  |
| `waivability_basis` | text | yes |  |
| `waivability_determined_by` | uuid | yes |  |
| `waivability_determined_at` | timestamp with time zone | yes |  |
| `valid_to` | date | yes |  |
| `long_stop_date` | date | yes |  |
| `long_stop_extension_decision_id` | uuid | yes |  |
| `long_stop_extended_by` | uuid | yes |  |
| `long_stop_extended_at` | timestamp with time zone | yes |  |
| `status` | enum condition_status | no | `'open'::condition_status` |
| `evidence_submitted_by` | uuid | yes |  |
| `evidence_submitted_at` | timestamp with time zone | yes |  |
| `verified_by` | uuid | yes |  |
| `verified_at` | timestamp with time zone | yes |  |
| `status_note` | text | yes |  |
| `waiver_id` | uuid | yes |  |
| `gate_key` | character varying | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `closing_condition_closing_fk`: (project_id,closing_id) → `closing`(project_id,id) — composite project-scoped FK
- `closing_condition_extension_decision_fk`: (project_id,long_stop_extension_decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `closing_condition_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `closing_condition_project_id_project_id_fk`: (project_id) → `project`(id)
- `closing_condition_waiver_fk`: (project_id,waiver_id) → `waiver`(project_id,id) — composite project-scoped FK
- `hub_opfk_closing_condition`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_closing_condition_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_closing_condition_evidence_submitted_by`: (org_id,evidence_submitted_by) → `app_user`(org_id,id)
- `hub_ufk_closing_condition_long_stop_extended_by`: (org_id,long_stop_extended_by) → `app_user`(org_id,id)
- `hub_ufk_closing_condition_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `hub_ufk_closing_condition_verified_by`: (org_id,verified_by) → `app_user`(org_id,id)
- `hub_ufk_closing_condition_waivability_determined_by`: (org_id,waivability_determined_by) → `app_user`(org_id,id)

### `closing_deliverable`

RLS: enabled (hub_project_isolation) · Triggers: hub_jv_event_link_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `closing_id` | uuid | no |  |
| `code` | character varying | yes |  |
| `title` | text | no |  |
| `responsible_party` | text | yes |  |
| `owner_user_id` | uuid | yes |  |
| `due_date` | date | yes |  |
| `decision_id` | uuid | yes |  |
| `status` | enum closing_deliverable_status | no | `'pending'::closing_deliverable_status` |
| `document_id` | uuid | yes |  |
| `executed_version_id` | uuid | yes |  |
| `delivered_by` | uuid | yes |  |
| `delivered_at` | timestamp with time zone | yes |  |
| `verified_by` | uuid | yes |  |
| `verified_at` | timestamp with time zone | yes |  |
| `status_note` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `closing_deliverable_closing_fk`: (project_id,closing_id) → `closing`(project_id,id) — composite project-scoped FK
- `closing_deliverable_decision_fk`: (project_id,decision_id) → `decision`(project_id,id) — composite project-scoped FK
- `closing_deliverable_doc_fk`: (project_id,document_id) → `document`(project_id,id) — composite project-scoped FK
- `closing_deliverable_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `closing_deliverable_project_id_project_id_fk`: (project_id) → `project`(id)
- `closing_deliverable_version_fk`: (project_id,executed_version_id) → `document_version`(project_id,id) — composite project-scoped FK
- `hub_opfk_closing_deliverable`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_closing_deliverable_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_closing_deliverable_delivered_by`: (org_id,delivered_by) → `app_user`(org_id,id)
- `hub_ufk_closing_deliverable_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `hub_ufk_closing_deliverable_verified_by`: (org_id,verified_by) → `app_user`(org_id,id)

### `funds_flow_item`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `closing_id` | uuid | no |  |
| `code` | character varying | yes |  |
| `description` | text | no |  |
| `payer` | text | no |  |
| `payee` | text | no |  |
| `amount` | numeric | yes |  |
| `currency` | character varying | yes |  |
| `unit_scale` | integer | yes |  |
| `value_date` | date | yes |  |
| `status` | enum funds_flow_status | no | `'planned'::funds_flow_status` |
| `confirmed_by` | uuid | yes |  |
| `confirmed_at` | timestamp with time zone | yes |  |
| `settlement_reference` | text | yes |  |
| `settlement_reported_by` | uuid | yes |  |
| `settlement_reported_at` | timestamp with time zone | yes |  |
| `status_note` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `funds_flow_closing_fk`: (project_id,closing_id) → `closing`(project_id,id) — composite project-scoped FK
- `funds_flow_item_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_funds_flow_item`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_funds_flow_item_confirmed_by`: (org_id,confirmed_by) → `app_user`(org_id,id)
- `hub_ufk_funds_flow_item_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_funds_flow_item_settlement_reported_by`: (org_id,settlement_reported_by) → `app_user`(org_id,id)

### `post_close_obligation`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `kind` | enum post_close_kind | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `responsible_party` | text | yes |  |
| `owner_user_id` | uuid | yes |  |
| `due_date` | date | yes |  |
| `status` | enum post_close_status | no | `'open'::post_close_status` |
| `evidence_note` | text | yes |  |
| `completion_reported_by` | uuid | yes |  |
| `completion_reported_at` | timestamp with time zone | yes |  |
| `verified_by` | uuid | yes |  |
| `verified_at` | timestamp with time zone | yes |  |
| `overdue_since` | date | yes |  |
| `escalation_id` | uuid | yes |  |
| `status_note` | text | yes |  |
| `closing_id` | uuid | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_post_close_obligation`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_post_close_obligation_completion_reported_by`: (org_id,completion_reported_by) → `app_user`(org_id,id)
- `hub_ufk_post_close_obligation_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_post_close_obligation_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)
- `hub_ufk_post_close_obligation_verified_by`: (org_id,verified_by) → `app_user`(org_id,id)
- `post_close_obligation_closing_fk`: (project_id,closing_id) → `closing`(project_id,id) — composite project-scoped FK
- `post_close_obligation_escalation_fk`: (project_id,escalation_id) → `escalation`(project_id,id) — composite project-scoped FK
- `post_close_obligation_owner_user_id_app_user_id_fk`: (owner_user_id) → `app_user`(id)
- `post_close_obligation_project_id_project_id_fk`: (project_id) → `project`(id)

### `partner_criteria_set`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `criteria` | jsonb | no |  |
| `note` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `updated_by` | uuid | yes |  |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_partner_criteria_set`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_partner_criteria_set_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_partner_criteria_set_updated_by`: (org_id,updated_by) → `app_user`(org_id,id)
- `partner_criteria_set_project_id_project_id_fk`: (project_id) → `project`(id)

### `partner_assessment_entry`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `partner_id` | uuid | no |  |
| `proposal_id` | uuid | yes |  |
| `criterion_key` | character varying | yes |  |
| `basis` | character varying | no |  |
| `statement` | text | no |  |
| `score` | numeric | yes |  |
| `source_reference` | text | yes |  |
| `document_id` | uuid | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |

Foreign keys:

- `hub_opfk_partner_assessment_entry`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_partner_assessment_entry_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `partner_assessment_document_fk`: (project_id,document_id) → `document`(project_id,id) — composite project-scoped FK
- `partner_assessment_entry_project_id_project_id_fk`: (project_id) → `project`(id)
- `partner_assessment_partner_fk`: (project_id,partner_id) → `partner`(project_id,id) — composite project-scoped FK
- `partner_assessment_proposal_fk`: (project_id,proposal_id) → `partner_proposal`(project_id,id) — composite project-scoped FK

### `partner_conflict`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `partner_id` | uuid | no |  |
| `declarant_user_id` | uuid | yes |  |
| `description` | text | no |  |
| `mitigation` | text | yes |  |
| `status` | character varying | no | `'open'::character varying` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_partner_conflict`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_partner_conflict_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_partner_conflict_declarant_user_id`: (org_id,declarant_user_id) → `app_user`(org_id,id)
- `partner_conflict_partner_fk`: (project_id,partner_id) → `partner`(project_id,id) — composite project-scoped FK
- `partner_conflict_project_id_project_id_fk`: (project_id) → `project`(id)

### `partner_contact`

RLS: enabled (hub_project_isolation) · Triggers: hub_partner_contact_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `partner_id` | uuid | no |  |
| `user_id` | uuid | no |  |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `revoked_at` | timestamp with time zone | yes |  |
| `revoked_by` | uuid | yes |  |

Foreign keys:

- `hub_opfk_partner_contact`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_partner_contact_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_partner_contact_revoked_by`: (org_id,revoked_by) → `app_user`(org_id,id)
- `hub_ufk_partner_contact_user_id`: (org_id,user_id) → `app_user`(org_id,id)
- `partner_contact_partner_fk`: (project_id,partner_id) → `partner`(project_id,id) — composite project-scoped FK
- `partner_contact_project_id_project_id_fk`: (project_id) → `project`(id)

### `partner_proposal`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `partner_id` | uuid | no |  |
| `code` | character varying | no |  |
| `title` | text | no |  |
| `received_on` | date | yes |  |
| `scope` | text | yes |  |
| `terms_summary` | text | yes |  |
| `document_id` | uuid | yes |  |
| `supersedes_proposal_id` | uuid | yes |  |
| `classification` | enum classification | no | `'strictly_confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_partner_proposal`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_partner_proposal_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `partner_proposal_document_fk`: (project_id,document_id) → `document`(project_id,id) — composite project-scoped FK
- `partner_proposal_partner_fk`: (project_id,partner_id) → `partner`(project_id,id) — composite project-scoped FK
- `partner_proposal_project_id_project_id_fk`: (project_id) → `project`(id)
- `partner_proposal_supersedes_fk`: (project_id,supersedes_proposal_id) → `partner_proposal`(project_id,id) — composite project-scoped FK

### `deal_scenario_version`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `scenario_id` | uuid | no |  |
| `version_no` | integer | no |  |
| `version_label` | character varying | no |  |
| `ownership` | jsonb | no |  |
| `contributions` | jsonb | no |  |
| `governance_terms` | text | yes |  |
| `assumptions` | text | yes |  |
| `change_note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |

Foreign keys:

- `deal_scenario_version_project_id_project_id_fk`: (project_id) → `project`(id)
- `deal_scenario_version_scenario_fk`: (project_id,scenario_id) → `deal_scenario`(project_id,id) — composite project-scoped FK
- `hub_opfk_deal_scenario_version`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_deal_scenario_version_created_by`: (org_id,created_by) → `app_user`(org_id,id)

### `room_disclosure`

RLS: enabled (hub_project_isolation) · Triggers: hub_room_disclosure_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `room_id` | uuid | yes |  |
| `document_id` | uuid | no |  |
| `document_version_id` | uuid | no |  |
| `diligence_request_id` | uuid | yes |  |
| `status` | character varying | no | `'requested'::character varying` |
| `request_note` | text | yes |  |
| `requested_by` | uuid | no |  |
| `released_by` | uuid | yes |  |
| `released_at` | timestamp with time zone | yes |  |
| `rejected_by` | uuid | yes |  |
| `revoked_by` | uuid | yes |  |
| `revoked_at` | timestamp with time zone | yes |  |
| `status_reason` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_room_disclosure`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_room_disclosure_rejected_by`: (org_id,rejected_by) → `app_user`(org_id,id)
- `hub_ufk_room_disclosure_released_by`: (org_id,released_by) → `app_user`(org_id,id)
- `hub_ufk_room_disclosure_requested_by`: (org_id,requested_by) → `app_user`(org_id,id)
- `hub_ufk_room_disclosure_revoked_by`: (org_id,revoked_by) → `app_user`(org_id,id)
- `room_disclosure_dd_request_fk`: (project_id,diligence_request_id) → `diligence_request`(project_id,id) — composite project-scoped FK
- `room_disclosure_document_fk`: (project_id,document_id) → `document`(project_id,id) — composite project-scoped FK
- `room_disclosure_project_id_project_id_fk`: (project_id) → `project`(id)
- `room_disclosure_room_fk`: (project_id,room_id) → `partner_room`(project_id,id) — composite project-scoped FK
- `room_disclosure_version_fk`: (project_id,document_version_id) → `document_version`(project_id,id) — composite project-scoped FK

### `room_access_event`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `room_id` | uuid | no |  |
| `kind` | character varying | no |  |
| `actor_user_id` | uuid | yes |  |
| `subject_user_id` | uuid | yes |  |
| `grant_id` | uuid | yes |  |
| `disclosure_id` | uuid | yes |  |
| `diligence_request_id` | uuid | yes |  |
| `document_version_id` | uuid | yes |  |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_opfk_room_access_event`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_room_access_event_actor_user_id`: (org_id,actor_user_id) → `app_user`(org_id,id)
- `hub_ufk_room_access_event_subject_user_id`: (org_id,subject_user_id) → `app_user`(org_id,id)
- `room_access_event_dd_request_fk`: (project_id,diligence_request_id) → `diligence_request`(project_id,id) — composite project-scoped FK
- `room_access_event_disclosure_fk`: (project_id,disclosure_id) → `room_disclosure`(project_id,id) — composite project-scoped FK
- `room_access_event_grant_fk`: (project_id,grant_id) → `room_grant`(project_id,id) — composite project-scoped FK
- `room_access_event_project_id_project_id_fk`: (project_id) → `project`(id)
- `room_access_event_room_fk`: (project_id,room_id) → `partner_room`(project_id,id) — composite project-scoped FK
- `room_access_event_version_fk`: (project_id,document_version_id) → `document_version`(project_id,id) — composite project-scoped FK

## Documents & sources

### `document`

RLS: enabled (hub_project_isolation) · Triggers: hub_document_acl_cascade, hub_document_current_version, hub_document_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `title` | text | no |  |
| `kind` | enum document_kind | no |  |
| `classification` | enum classification | no | `'confidential'::classification` |
| `room_id` | uuid | yes |  |
| `owner_user_id` | uuid | yes |  |
| `current_version_id` | uuid | yes |  |
| `legal_hold` | boolean | no | `false` |
| `legal_hold_reason` | text | yes |  |
| `retention_until` | date | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |
| `deleted_by` | uuid | yes |  |
| `deletion_reason` | text | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `document_project_id_project_id_fk`: (project_id) → `project`(id)
- `document_room_fk`: (project_id,room_id) → `partner_room`(project_id,id) — composite project-scoped FK
- `hub_opfk_document`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_document_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_document_deleted_by`: (org_id,deleted_by) → `app_user`(org_id,id)
- `hub_ufk_document_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)

### `document_version`

RLS: enabled (hub_project_isolation) · Triggers: hub_document_child_room_sync, hub_document_version_guard, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `document_id` | uuid | no |  |
| `room_id` | uuid | yes |  |
| `version_no` | integer | no |  |
| `storage_key` | text | no |  |
| `filename` | text | no |  |
| `mime_type` | character varying | no |  |
| `detected_type` | character varying | yes |  |
| `size_bytes` | bigint | no |  |
| `sha256` | character varying | no |  |
| `scan_status` | enum scan_status | no | `'pending'::scan_status` |
| `scan_detail` | text | yes |  |
| `extraction_status` | enum extraction_status | no | `'not_performed'::extraction_status` |
| `page_count` | integer | yes |  |
| `uploaded_by` | uuid | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `note` | text | yes |  |

Foreign keys:

- `document_version_document_fk`: (project_id,document_id) → `document`(project_id,id) — composite project-scoped FK
- `document_version_project_id_project_id_fk`: (project_id) → `project`(id)
- `document_version_room_fk`: (project_id,room_id) → `partner_room`(project_id,id) — composite project-scoped FK
- `hub_opfk_document_version`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_document_version_uploaded_by`: (org_id,uploaded_by) → `app_user`(org_id,id)

### `evidence_link`

RLS: enabled (hub_project_isolation) · Triggers: hub_document_child_room_sync, hub_same_project_target, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `target_type` | character varying | no |  |
| `target_id` | uuid | no |  |
| `document_id` | uuid | yes |  |
| `document_version_id` | uuid | yes |  |
| `room_id` | uuid | yes |  |
| `note` | text | yes |  |
| `purpose` | text | yes |  |
| `status` | enum evidence_link_status | no | `'active'::evidence_link_status` |
| `conflict_with_link_id` | uuid | yes |  |
| `conflict_note` | text | yes |  |
| `reviewed_by` | uuid | yes |  |
| `reviewed_at` | timestamp with time zone | yes |  |
| `added_by` | uuid | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `evidence_link_conflict_fk`: (project_id,conflict_with_link_id) → `evidence_link`(project_id,id) — composite project-scoped FK
- `evidence_link_document_fk`: (project_id,document_id) → `document`(project_id,id) — composite project-scoped FK
- `evidence_link_project_id_project_id_fk`: (project_id) → `project`(id)
- `evidence_link_room_fk`: (project_id,room_id) → `partner_room`(project_id,id) — composite project-scoped FK
- `evidence_link_version_fk`: (project_id,document_version_id) → `document_version`(project_id,id) — composite project-scoped FK
- `hub_opfk_evidence_link`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_evidence_link_added_by`: (org_id,added_by) → `app_user`(org_id,id)
- `hub_ufk_evidence_link_reviewed_by`: (org_id,reviewed_by) → `app_user`(org_id,id)

### `source_record`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `code` | character varying | no |  |
| `source_type` | enum source_type | no |  |
| `filename` | text | yes |  |
| `source_version` | character varying | yes |  |
| `checksum` | character varying | yes |  |
| `owner_label` | text | yes |  |
| `uploaded_at` | timestamp with time zone | yes |  |
| `report_date` | date | yes |  |
| `as_of_date` | date | yes |  |
| `extraction_date` | date | yes |  |
| `extraction_status` | enum extraction_status | no | `'not_performed'::extraction_status` |
| `extraction_note` | text | yes |  |
| `document_version_id` | uuid | yes |  |
| `supersedes_source_id` | uuid | yes |  |
| `classification` | enum classification | no | `'confidential'::classification` |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_source_record`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_source_record_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `source_record_docver_fk`: (project_id,document_version_id) → `document_version`(project_id,id) — composite project-scoped FK
- `source_record_project_id_project_id_fk`: (project_id) → `project`(id)
- `source_record_supersedes_fk`: (project_id,supersedes_source_id) → `source_record`(project_id,id) — composite project-scoped FK

### `source_claim`

RLS: enabled (hub_project_isolation) · Triggers: hub_same_project_target, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `source_id` | uuid | no |  |
| `location` | text | no |  |
| `subject` | text | no |  |
| `target_type` | character varying | yes |  |
| `target_id` | uuid | yes |  |
| `field` | character varying | yes |  |
| `extracted_value` | text | no |  |
| `source_reported_value` | text | yes |  |
| `confirmed_value` | text | yes |  |
| `confidence` | numeric | yes |  |
| `verification_status` | enum verification_status | no | `'unknown'::verification_status` |
| `origin_status` | enum verification_status | no | `'unknown'::verification_status` |
| `reviewer_user_id` | uuid | yes |  |
| `reviewed_at` | timestamp with time zone | yes |  |
| `verification_source_id` | uuid | yes |  |
| `conflict_with_claim_id` | uuid | yes |  |
| `applied_to_record` | boolean | no | `false` |
| `applied_by` | uuid | yes |  |
| `applied_at` | timestamp with time zone | yes |  |
| `is_demo` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_source_claim`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_source_claim_applied_by`: (org_id,applied_by) → `app_user`(org_id,id)
- `hub_ufk_source_claim_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_source_claim_reviewer_user_id`: (org_id,reviewer_user_id) → `app_user`(org_id,id)
- `source_claim_conflict_fk`: (project_id,conflict_with_claim_id) → `source_claim`(project_id,id) — composite project-scoped FK
- `source_claim_project_id_project_id_fk`: (project_id) → `project`(id)
- `source_claim_source_fk`: (project_id,source_id) → `source_record`(project_id,id) — composite project-scoped FK
- `source_claim_verification_source_fk`: (project_id,verification_source_id) → `source_record`(project_id,id) — composite project-scoped FK

### `document_chunk`

RLS: enabled (hub_project_isolation) · Triggers: hub_chunk_acl_sync, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `document_id` | uuid | no |  |
| `document_version_id` | uuid | no |  |
| `room_id` | uuid | yes |  |
| `classification` | enum classification | no |  |
| `ordinal` | integer | no |  |
| `page` | integer | yes |  |
| `section` | text | yes |  |
| `text` | text | no |  |
| `tsv` | tsvector | yes |  |
| `suspicious_instructions` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `document_chunk_document_fk`: (project_id,document_id) → `document`(project_id,id) — composite project-scoped FK
- `document_chunk_project_id_project_id_fk`: (project_id) → `project`(id)
- `document_chunk_room_fk`: (project_id,room_id) → `partner_room`(project_id,id) — composite project-scoped FK
- `document_chunk_version_fk`: (project_id,document_version_id) → `document_version`(project_id,id) — composite project-scoped FK
- `hub_opfk_document_chunk`: (org_id,project_id) → `project`(org_id,id)

## Reporting & imports

### `report_snapshot`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `kind` | enum report_kind | no |  |
| `title` | text | no |  |
| `locale` | character varying | no | `'en'::character varying` |
| `as_of` | timestamp with time zone | no |  |
| `as_of_local_date` | date | no |  |
| `scope` | jsonb | no |  |
| `baseline_version_id` | uuid | yes |  |
| `baseline_version_no` | integer | yes |  |
| `classification` | enum classification | no |  |
| `payload` | jsonb | no |  |
| `unverified_data` | jsonb | no | `'[]'::jsonb` |
| `source_refs` | jsonb | no | `'[]'::jsonb` |
| `content_hash` | character varying | no |  |
| `previous_snapshot_id` | uuid | yes |  |
| `includes_demo_data` | jsonb | no | `'false'::jsonb` |
| `generated_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_opfk_report_snapshot`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_report_snapshot_generated_by`: (org_id,generated_by) → `app_user`(org_id,id)
- `report_snapshot_baseline_fk`: (project_id,baseline_version_id) → `baseline_version`(project_id,id) — composite project-scoped FK
- `report_snapshot_previous_fk`: (project_id,previous_snapshot_id) → `report_snapshot`(project_id,id) — composite project-scoped FK
- `report_snapshot_project_id_project_id_fk`: (project_id) → `project`(id)

### `report_export`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `snapshot_id` | uuid | no |  |
| `format` | enum export_format | no |  |
| `storage_key` | text | no |  |
| `filename` | text | no |  |
| `size_bytes` | bigint | no |  |
| `sha256` | character varying | no |  |
| `created_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_opfk_report_export`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_report_export_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `report_export_project_id_project_id_fk`: (project_id) → `project`(id)
- `report_export_snapshot_fk`: (project_id,snapshot_id) → `report_snapshot`(project_id,id) — composite project-scoped FK

### `import_batch`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `kind` | character varying | no |  |
| `source_id` | uuid | yes |  |
| `document_version_id` | uuid | yes |  |
| `filename` | text | yes |  |
| `status` | enum import_status | no | `'uploaded'::import_status` |
| `sheet` | text | yes |  |
| `header_row` | integer | yes |  |
| `mapping` | jsonb | yes |  |
| `summary` | jsonb | yes |  |
| `errors` | jsonb | no | `'[]'::jsonb` |
| `approved_by` | uuid | yes |  |
| `approved_at` | timestamp with time zone | yes |  |
| `applied_at` | timestamp with time zone | yes |  |
| `rolled_back_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_import_batch`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_import_batch_approved_by`: (org_id,approved_by) → `app_user`(org_id,id)
- `hub_ufk_import_batch_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `import_batch_docver_fk`: (project_id,document_version_id) → `document_version`(project_id,id) — composite project-scoped FK
- `import_batch_project_id_project_id_fk`: (project_id) → `project`(id)
- `import_batch_source_fk`: (project_id,source_id) → `source_record`(project_id,id) — composite project-scoped FK

### `import_row`

RLS: enabled (hub_project_isolation) · Triggers: hub_same_project_target, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `batch_id` | uuid | no |  |
| `row_no` | integer | no |  |
| `raw` | jsonb | no |  |
| `normalized` | jsonb | yes |  |
| `action` | enum import_row_action | no |  |
| `message` | text | yes |  |
| `target_type` | character varying | yes |  |
| `target_id` | uuid | yes |  |
| `before` | jsonb | yes |  |
| `after` | jsonb | yes |  |

Foreign keys:

- `hub_opfk_import_row`: (org_id,project_id) → `project`(org_id,id)
- `import_row_batch_fk`: (project_id,batch_id) → `import_batch`(project_id,id) — composite project-scoped FK
- `import_row_project_id_project_id_fk`: (project_id) → `project`(id)

## Platform, jobs & audit

### `notification`

RLS: enabled (hub_notification_update, hub_notification_write, hub_notification_read) · Triggers: hub_same_project_source, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | yes |  |
| `user_id` | uuid | no |  |
| `kind` | character varying | no |  |
| `title` | text | no |  |
| `body` | text | yes |  |
| `link` | text | yes |  |
| `channel` | enum notification_channel | no | `'in_app'::notification_channel` |
| `delivery_status` | enum delivery_status | no | `'queued'::delivery_status` |
| `dedupe_key` | character varying | yes |  |
| `source_type` | character varying | yes |  |
| `source_id` | uuid | yes |  |
| `ai_proposal_id` | uuid | yes |  |
| `read_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_opfk_notification`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_notification_user_id`: (org_id,user_id) → `app_user`(org_id,id)
- `notification_ai_proposal_fk`: (project_id,ai_proposal_id) → `ai_proposal`(project_id,id) — composite project-scoped FK

### `integration_connection`

RLS: enabled (hub_org_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `kind` | enum integration_kind | no |  |
| `name` | text | no |  |
| `direction` | enum integration_direction | no |  |
| `config` | jsonb | no | `'{}'::jsonb` |
| `secret_ref` | text | yes |  |
| `status` | enum integration_status | no | `'not_configured'::integration_status` |
| `enabled` | boolean | no | `false` |
| `sending_authorized` | boolean | no | `false` |
| `approved_destinations` | jsonb | no | `'[]'::jsonb` |
| `last_checked_at` | timestamp with time zone | yes |  |
| `last_check_result` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_ufk_integration_connection_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `integration_connection_org_id_organization_id_fk`: (org_id) → `organization`(id)

### `outbox_event`

RLS: **not enabled** (infrastructure table — see ADR-0004) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | yes |  |
| `type` | character varying | no |  |
| `aggregate_type` | character varying | yes |  |
| `aggregate_id` | uuid | yes |  |
| `payload` | jsonb | no | `'{}'::jsonb` |
| `dedupe_key` | character varying | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `dispatched_at` | timestamp with time zone | yes |  |
| `attempts` | integer | no | `0` |
| `last_error` | text | yes |  |

Foreign keys:

- `hub_opfk_outbox_event`: (org_id,project_id) → `project`(org_id,id)

### `job`

RLS: **not enabled** (infrastructure table — see ADR-0004) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | yes |  |
| `kind` | character varying | no |  |
| `payload` | jsonb | no | `'{}'::jsonb` |
| `idempotency_key` | character varying | no |  |
| `status` | enum job_status | no | `'queued'::job_status` |
| `run_at` | timestamp with time zone | no | `now()` |
| `attempts` | integer | no | `0` |
| `max_attempts` | integer | no | `5` |
| `locked_by` | character varying | yes |  |
| `locked_until` | timestamp with time zone | yes |  |
| `last_error` | text | yes |  |
| `result` | jsonb | yes |  |
| `requested_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `finished_at` | timestamp with time zone | yes |  |

Foreign keys:

- `hub_opfk_job`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_job_requested_by`: (org_id,requested_by) → `app_user`(org_id,id)

### `scheduled_job`

RLS: **not enabled** (infrastructure table — see ADR-0004) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | yes |  |
| `kind` | character varying | no |  |
| `name` | text | no |  |
| `cron` | character varying | no |  |
| `timezone` | text | no | `'Asia/Riyadh'::text` |
| `payload` | jsonb | no | `'{}'::jsonb` |
| `enabled` | boolean | no | `true` |
| `next_run_at` | timestamp with time zone | yes |  |
| `last_run_at` | timestamp with time zone | yes |  |
| `last_status` | character varying | yes |  |
| `last_error` | text | yes |  |
| `owner_user_id` | uuid | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `hub_opfk_scheduled_job`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_scheduled_job_created_by`: (org_id,created_by) → `app_user`(org_id,id)
- `hub_ufk_scheduled_job_owner_user_id`: (org_id,owner_user_id) → `app_user`(org_id,id)

### `delivery_record`

RLS: **not enabled** (infrastructure table — see ADR-0004) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | yes |  |
| `idempotency_key` | character varying | no |  |
| `channel` | enum notification_channel | no |  |
| `recipient_user_id` | uuid | yes |  |
| `recipient_address_hash` | character varying | yes |  |
| `payload_hash` | character varying | no |  |
| `status` | enum delivery_status | no |  |
| `provider_message_id` | text | yes |  |
| `detail` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_opfk_delivery_record`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_delivery_record_recipient_user_id`: (org_id,recipient_user_id) → `app_user`(org_id,id)

### `audit_event`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_audit_chain, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `seq` | bigint | no | `nextval('audit_event_seq_seq'::regclass)` |
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | yes |  |
| `actor_user_id` | uuid | yes |  |
| `actor_kind` | enum actor_kind | no |  |
| `action` | character varying | no |  |
| `entity_type` | character varying | yes |  |
| `entity_id` | uuid | yes |  |
| `outcome` | character varying | no | `'success'::character varying` |
| `reason` | text | yes |  |
| `before` | jsonb | yes |  |
| `after` | jsonb | yes |  |
| `correlation_id` | character varying | yes |  |
| `ip` | character varying | yes |  |
| `chain_pos` | bigint | yes |  |
| `prev_hash` | character varying | yes |  |
| `hash` | character varying | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_opfk_audit_event`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_audit_event_actor_user_id`: (org_id,actor_user_id) → `app_user`(org_id,id)

### `record_version`

RLS: enabled (hub_project_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | yes |  |
| `entity_type` | character varying | no |  |
| `entity_id` | uuid | no |  |
| `version_no` | integer | no |  |
| `snapshot` | jsonb | no |  |
| `reason` | text | yes |  |
| `changed_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `hub_opfk_record_version`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_record_version_changed_by`: (org_id,changed_by) → `app_user`(org_id,id)

### `audit_checkpoint`

RLS: enabled (hub_org_isolation) · Triggers: hub_append_only, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `chain_pos` | bigint | no |  |
| `hash` | character varying | no |  |
| `row_count` | bigint | no |  |
| `created_at` | timestamp with time zone | no | `now()` |

## AI runtime

### `ai_project_settings`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `mode` | enum ai_mode | no | `'off'::ai_mode` |
| `provider` | enum ai_provider | no | `'off'::ai_provider` |
| `model` | character varying | yes |  |
| `kill_switch` | boolean | no | `false` |
| `kill_switch_by` | uuid | yes |  |
| `kill_switch_at` | timestamp with time zone | yes |  |
| `max_classification_to_provider` | character varying | no | `'internal'::character varying` |
| `monthly_token_budget` | integer | no | `0` |
| `monthly_cost_budget` | numeric | yes |  |
| `cost_currency` | character varying | yes |  |
| `per_run_token_limit` | integer | no | `20000` |
| `per_run_timeout_ms` | integer | no | `60000` |
| `quiet_hours_start` | integer | yes |  |
| `quiet_hours_end` | integer | yes |  |
| `briefing_cron` | character varying | yes |  |
| `briefing_timezone` | text | no | `'Asia/Riyadh'::text` |
| `autopilot_policy` | jsonb | yes |  |
| `policy_version` | character varying | no | `'ai-policy-1'::character varying` |
| `circuit_open_until` | timestamp with time zone | yes |  |
| `consecutive_failures` | integer | no | `0` |
| `updated_by` | uuid | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `ai_project_settings_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_ai_project_settings`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_ai_project_settings_kill_switch_by`: (org_id,kill_switch_by) → `app_user`(org_id,id)
- `hub_ufk_ai_project_settings_updated_by`: (org_id,updated_by) → `app_user`(org_id,id)

### `ai_run`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `kind` | character varying | no |  |
| `trigger` | character varying | no |  |
| `trigger_ref` | text | yes |  |
| `requested_by` | uuid | yes |  |
| `service_identity` | character varying | no | `'svc-ai-pm'::character varying` |
| `status` | enum ai_run_status | no | `'queued'::ai_run_status` |
| `provider` | enum ai_provider | no |  |
| `model` | character varying | yes |  |
| `locale` | character varying | no | `'en'::character varying` |
| `question` | text | yes |  |
| `output` | jsonb | yes |  |
| `evidence_snapshot` | jsonb | yes |  |
| `input_tokens` | integer | no | `0` |
| `output_tokens` | integer | no | `0` |
| `cost_estimate` | numeric | yes |  |
| `policy_version` | character varying | yes |  |
| `started_at` | timestamp with time zone | yes |  |
| `finished_at` | timestamp with time zone | yes |  |
| `error` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `ai_run_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_ai_run`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_ai_run_requested_by`: (org_id,requested_by) → `app_user`(org_id,id)

### `ai_proposal`

RLS: enabled (hub_project_isolation) · Triggers: hub_same_project_target, hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `run_id` | uuid | yes |  |
| `action_type` | character varying | no |  |
| `target_type` | character varying | yes |  |
| `target_id` | uuid | yes |  |
| `target_version` | integer | yes |  |
| `payload` | jsonb | no |  |
| `payload_hash` | character varying | no |  |
| `rationale` | text | yes |  |
| `citations` | jsonb | no | `'[]'::jsonb` |
| `status` | enum ai_proposal_status | no | `'proposed'::ai_proposal_status` |
| `policy_version` | character varying | no |  |
| `idempotency_key` | character varying | no |  |
| `execution_result` | jsonb | yes |  |
| `executed_at` | timestamp with time zone | yes |  |
| `invalidated_reason` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `version` | integer | no | `1` |

Foreign keys:

- `ai_proposal_project_id_project_id_fk`: (project_id) → `project`(id)
- `ai_proposal_run_fk`: (project_id,run_id) → `ai_run`(project_id,id) — composite project-scoped FK
- `hub_opfk_ai_proposal`: (org_id,project_id) → `project`(org_id,id)

### `ai_action_approval`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `proposal_id` | uuid | no |  |
| `approver_user_id` | uuid | no |  |
| `payload_hash` | character varying | no |  |
| `target_version` | integer | yes |  |
| `expires_at` | timestamp with time zone | no |  |
| `status` | character varying | no | `'valid'::character varying` |
| `invalidated_reason` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

Foreign keys:

- `ai_action_approval_project_id_project_id_fk`: (project_id) → `project`(id)
- `ai_action_approval_proposal_fk`: (project_id,proposal_id) → `ai_proposal`(project_id,id) — composite project-scoped FK
- `hub_opfk_ai_action_approval`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_ai_action_approval_approver_user_id`: (org_id,approver_user_id) → `app_user`(org_id,id)

### `ai_derived_artifact`

RLS: enabled (hub_project_isolation) · Triggers: hub_scope_immutable

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `kind` | character varying | no |  |
| `acl_fingerprint` | character varying | no |  |
| `source_refs` | jsonb | no |  |
| `content` | jsonb | no |  |
| `invalidated_at` | timestamp with time zone | yes |  |
| `invalidated_reason` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | uuid | yes |  |

Foreign keys:

- `ai_derived_artifact_project_id_project_id_fk`: (project_id) → `project`(id)
- `hub_opfk_ai_derived_artifact`: (org_id,project_id) → `project`(org_id,id)
- `hub_ufk_ai_derived_artifact_created_by`: (org_id,created_by) → `app_user`(org_id,id)
