CREATE TYPE "public"."action_item_status" AS ENUM('open', 'in_progress', 'done_pending_verification', 'verified_closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."actor_kind" AS ENUM('user', 'service', 'system');--> statement-breakpoint
CREATE TYPE "public"."agenda_item_kind" AS ENUM('decision', 'information', 'discussion', 'escalation');--> statement-breakpoint
CREATE TYPE "public"."agenda_screening_status" AS ENUM('requested', 'accepted', 'returned', 'deferred', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."agreement_stage" AS ENUM('identified', 'drafting', 'negotiating', 'agreed_in_principle', 'signed', 'effective', 'terminated', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ai_mode" AS ENUM('off', 'advisory', 'assisted', 'autopilot');--> statement-breakpoint
CREATE TYPE "public"."ai_proposal_status" AS ENUM('proposed', 'approved', 'rejected', 'invalidated', 'executing', 'executed', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('off', 'mock', 'openai_compatible', 'anthropic');--> statement-breakpoint
CREATE TYPE "public"."ai_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled', 'budget_exceeded', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."applicability_status" AS ENUM('assessment_pending', 'applicable', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."approval_register_category" AS ENUM('regulatory', 'external_party', 'internal');--> statement-breakpoint
CREATE TYPE "public"."approval_request_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'invalidated', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."approval_state" AS ENUM('proposed', 'under_review', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'remote', 'absent', 'apologies', 'delegated');--> statement-breakpoint
CREATE TYPE "public"."authority_matrix_status" AS ENUM('draft', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."baseline_status" AS ENUM('draft', 'proposed', 'approved', 'superseded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."benefit_status" AS ENUM('proposed', 'approved', 'tracking', 'realized_unverified', 'realized_verified', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."change_request_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'implemented');--> statement-breakpoint
CREATE TYPE "public"."classification" AS ENUM('public', 'internal', 'confidential', 'restricted', 'strictly_confidential');--> statement-breakpoint
CREATE TYPE "public"."closing_deliverable_status" AS ENUM('pending', 'delivered', 'verified', 'not_required');--> statement-breakpoint
CREATE TYPE "public"."closing_kind" AS ENUM('signing', 'closing');--> statement-breakpoint
CREATE TYPE "public"."closing_status" AS ENUM('planned', 'in_preparation', 'ready_for_confirmation', 'confirmed', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."committee_kind" AS ENUM('program_steering', 'newco_board', 'jv_board', 'other');--> statement-breakpoint
CREATE TYPE "public"."committee_member_role" AS ENUM('chair', 'sponsor', 'secretary', 'voting_member', 'advisory_member', 'guest');--> statement-breakpoint
CREATE TYPE "public"."committee_status" AS ENUM('draft', 'charter_approved', 'active', 'dissolved');--> statement-breakpoint
CREATE TYPE "public"."condition_kind" AS ENUM('condition_precedent', 'condition_subsequent');--> statement-breakpoint
CREATE TYPE "public"."condition_status" AS ENUM('open', 'evidence_submitted', 'verified', 'waived', 'failed', 'lapsed');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('not_requested', 'requested', 'granted', 'conditional', 'refused', 'not_required');--> statement-breakpoint
CREATE TYPE "public"."contract_transfer_class" AS ENUM('transferable', 'consent_required', 'novation_required', 'retain', 'interim_arrangement', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."criterion_status" AS ENUM('unmet', 'evidence_submitted', 'met', 'waived', 'not_applicable', 'conflicting');--> statement-breakpoint
CREATE TYPE "public"."cutover_status" AS ENUM('planning', 'rehearsal', 'ready_for_decision', 'approved_go', 'no_go', 'executed', 'accepted', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."dd_release_status" AS ENUM('draft', 'in_review', 'approved_for_release', 'released', 'withheld');--> statement-breakpoint
CREATE TYPE "public"."decision_authority_outcome" AS ENUM('within_mandate', 'pending_external_authority', 'not_assessed');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('draft', 'submitted', 'under_review', 'recommended', 'approved', 'rejected', 'deferred', 'superseded', 'implementation_pending', 'implemented_verified');--> statement-breakpoint
CREATE TYPE "public"."deliverable_status" AS ENUM('planned', 'in_progress', 'submitted', 'accepted', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('queued', 'sending', 'sent', 'uncertain', 'suppressed', 'failed', 'disabled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."dependency_type" AS ENUM('FS', 'SS', 'FF', 'SF');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('charter', 'minutes', 'decision_paper', 'agreement', 'evidence', 'report', 'runbook', 'financial_model', 'regulatory', 'dd_material', 'source_upload', 'other');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('parent', 'newco', 'partner', 'jv_company', 'counterparty', 'advisor', 'other');--> statement-breakpoint
CREATE TYPE "public"."escalation_status" AS ENUM('open', 'decision_requested', 'resolved', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."evidence_link_status" AS ENUM('active', 'superseded', 'conflicting', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."export_format" AS ENUM('pdf', 'xlsx', 'docx', 'pptx', 'csv', 'json');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('not_performed', 'performed', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."financial_category" AS ENUM('one_off_separation', 'recurring_standalone', 'stranded', 'tsa_charge', 'revenue', 'capex', 'opex', 'working_capital', 'opening_balance', 'intercompany', 'other');--> statement-breakpoint
CREATE TYPE "public"."financial_kind" AS ENUM('baseline', 'forecast', 'actual');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'remediation_planned', 'remediated', 'accepted_risk', 'closed');--> statement-breakpoint
CREATE TYPE "public"."funds_flow_status" AS ENUM('planned', 'confirmed_by_finance', 'reported_settled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."gate_assessment_status" AS ENUM('not_started', 'in_assessment', 'ready_for_decision', 'approved', 'approved_with_exceptions', 'rejected', 'reopened', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."gate_review_outcome" AS ENUM('endorse', 'return');--> statement-breakpoint
CREATE TYPE "public"."go_no_go" AS ENUM('pending', 'go', 'no_go');--> statement-breakpoint
CREATE TYPE "public"."import_row_action" AS ENUM('create', 'update', 'skip', 'conflict', 'error');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'mapped', 'validated', 'approved', 'applied', 'rolled_back', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."incorporation_status" AS ENUM('incorporated', 'incorporation_in_progress', 'unconfirmed', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."integration_direction" AS ENUM('read', 'write', 'send');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('oidc', 'saml_gateway', 'smtp', 'teams', 'sharepoint', 'object_storage', 'llm_provider', 'power_bi', 'vdr', 'erp', 'hr', 'itsm', 'dcim', 'siem');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('not_configured', 'configured_unverified', 'verified', 'failed', 'disabled', 'simulated');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."kpi_direction" AS ENUM('higher_is_better', 'lower_is_better');--> statement-breakpoint
CREATE TYPE "public"."materiality" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('planned', 'agenda_published', 'in_session', 'held', 'minutes_draft', 'minutes_approved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('planned', 'at_risk', 'achieved_pending_evidence', 'achieved_verified', 'missed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."model_case" AS ENUM('base', 'downside', 'upside');--> statement-breakpoint
CREATE TYPE "public"."model_kind" AS ENUM('business_plan', 'valuation');--> statement-breakpoint
CREATE TYPE "public"."nda_status" AS ENUM('none', 'drafting', 'executed', 'expired', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."negotiation_issue_status" AS ENUM('open', 'proposed_resolution', 'agreed', 'escalated', 'closed');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'teams', 'sms');--> statement-breakpoint
CREATE TYPE "public"."partner_stage" AS ENUM('identified', 'approved_for_contact', 'nda', 'materials_access', 'dd', 'proposal', 'negotiation', 'signing', 'closing', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."perimeter_disposition" AS ENUM('included', 'excluded', 'shared', 'pending');--> statement-breakpoint
CREATE TYPE "public"."perimeter_item_type" AS ENUM('site', 'asset', 'liability', 'receivable', 'payable', 'contract', 'employee_group', 'data', 'ip', 'license', 'financing', 'guarantee', 'shared_service', 'other');--> statement-breakpoint
CREATE TYPE "public"."post_close_kind" AS ENUM('condition_subsequent', 'obligation', 'appointment', 'governance', 'benefit', 'handover');--> statement-breakpoint
CREATE TYPE "public"."post_close_status" AS ENUM('open', 'in_progress', 'completed_pending_evidence', 'verified', 'overdue', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('setup', 'active', 'on_hold', 'closing', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."raci_value" AS ENUM('R', 'A', 'C', 'I');--> statement-breakpoint
CREATE TYPE "public"."rag_status" AS ENUM('green', 'amber', 'red', 'unknown', 'stale', 'not_updated');--> statement-breakpoint
CREATE TYPE "public"."raid_status" AS ENUM('open', 'monitoring', 'escalated', 'mitigated', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."readiness_area" AS ENUM('power', 'cooling', 'connectivity', 'physical_access', 'operations', 'maintenance', 'spares', 'noc', 'incident_management', 'billing', 'support', 'employees', 'security', 'backup_recovery', 'other');--> statement-breakpoint
CREATE TYPE "public"."readiness_status" AS ENUM('not_started', 'in_progress', 'passed', 'failed', 'waived', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."report_kind" AS ENUM('executive_summary', 'committee_pack', 'workstream_weekly', 'look_ahead', 'day1_readiness', 'tsa_exit', 'jv_closing', 'health_data_quality', 'minutes', 'register_export');--> statement-breakpoint
CREATE TYPE "public"."requirement_status" AS ENUM('not_started', 'in_preparation', 'submitted', 'granted', 'granted_with_conditions', 'refused', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."role_key" AS ENUM('platform_admin', 'portfolio_admin', 'sponsor', 'committee_chair', 'secretary_cpmo', 'project_manager', 'workstream_lead', 'contributor', 'functional_approver', 'finance_restricted', 'legal_restricted', 'clean_team', 'auditor', 'external_partner_limited');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('pending', 'clean', 'quarantined', 'rejected', 'not_scanned');--> statement-breakpoint
CREATE TYPE "public"."schedule_node_type" AS ENUM('task', 'milestone');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('organization', 'portfolio', 'project', 'workstream', 'partner_room');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('image', 'excel', 'csv', 'minutes', 'pdf', 'docx', 'manual_entry', 'system');--> statement-breakpoint
CREATE TYPE "public"."status_dimension_key" AS ENUM('incorporation', 'perimeter_transfer', 'operational_readiness', 'jv_transaction');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('draft', 'not_started', 'in_progress', 'blocked', 'submitted_for_acceptance', 'accepted', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."template_kind" AS ENUM('dc_carveout', 'general_transformation', 'strategy', 'technology', 'transaction_other');--> statement-breakpoint
CREATE TYPE "public"."template_migration_status" AS ENUM('proposed', 'approved', 'applied', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."template_version_status" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('not_started', 'planned', 'in_progress', 'transferred_pending_evidence', 'transferred_verified', 'blocked', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."tsa_status" AS ENUM('proposed', 'negotiating', 'approved', 'active', 'exit_in_progress', 'exit_accepted', 'extended', 'breached', 'expired_unresolved');--> statement-breakpoint
CREATE TYPE "public"."update_status" AS ENUM('draft', 'submitted', 'returned', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."value_basis" AS ENUM('enterprise_value', 'equity_value', 'other');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('confirmed', 'historical_unverified', 'proposed', 'assumed', 'conflicting', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."vote_choice" AS ENUM('approve', 'reject', 'abstain');--> statement-breakpoint
CREATE TYPE "public"."waiver_status" AS ENUM('requested', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"title" text,
	"clearance" "classification" DEFAULT 'internal' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_service_account" boolean DEFAULT false NOT NULL,
	"account_type" varchar(16) DEFAULT 'internal' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"oidc_issuer" text,
	"oidc_subject" text,
	"last_login_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "app_user_account_type_ck" CHECK ("app_user"."account_type" in ('internal', 'external'))
);
--> statement-breakpoint
CREATE TABLE "org_role_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role_key" NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" uuid,
	"granted_by" uuid,
	"reason" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"default_timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "role_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"policy_version" text NOT NULL,
	"matrix" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"auth_method" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"ip" varchar(64),
	"user_agent" text,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "calendar_holiday" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"is_proposed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "legal_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "entity_kind" NOT NULL,
	"registration_ref" text,
	"incorporation_status" "incorporation_status" DEFAULT 'unconfirmed' NOT NULL,
	"incorporation_verification" "verification_status" DEFAULT 'unknown' NOT NULL,
	"incorporation_evidence_note" text,
	"incorporation_recorded_by" uuid,
	"incorporation_recorded_at" timestamp with time zone,
	"incorporation_verified_by" uuid,
	"incorporation_verified_at" timestamp with time zone,
	"incorporation_verification_note" text,
	"jurisdiction" text,
	"owner_project_id" uuid NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"objective" text,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"program_id" uuid,
	"template_version_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"objective" text,
	"status" "project_status" DEFAULT 'setup' NOT NULL,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"working_days" jsonb DEFAULT '[0,1,2,3,4]'::jsonb NOT NULL,
	"planned_start" date,
	"retention_years" integer,
	"setup_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"role" "entity_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_entity_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "project_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role_key" NOT NULL,
	"workstream_id" uuid,
	"granted_by" uuid,
	"reason" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_membership_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "project_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"kind" "template_kind" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "project_template_migration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"from_version_id" uuid NOT NULL,
	"to_version_id" uuid NOT NULL,
	"preview" jsonb NOT NULL,
	"status" "template_migration_status" DEFAULT 'proposed' NOT NULL,
	"proposed_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_template_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"status" "template_version_status" DEFAULT 'draft' NOT NULL,
	"definition" jsonb NOT NULL,
	"definition_hash" text NOT NULL,
	"change_summary" text,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"kind" varchar(32) DEFAULT 'data_center' NOT NULL,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "site_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "workstream" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(16) NOT NULL,
	"template_key" varchar(32),
	"name" text NOT NULL,
	"name_ar" text,
	"objective" text,
	"scope" text,
	"lead_user_id" uuid,
	"proposed_lead_function" text,
	"raci" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"linked_gate_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "workstream_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "assumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workstream_id" uuid,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_user_id" uuid,
	"status" "raid_status" DEFAULT 'open' NOT NULL,
	"escalation_level" smallint DEFAULT 0 NOT NULL,
	"due_date" date,
	"gate_key" varchar(16),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"basis" text,
	"validation_plan" text,
	"verification_status" "verification_status" DEFAULT 'assumed' NOT NULL,
	CONSTRAINT "assumption_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "baseline_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"status" "baseline_status" DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"change_request_id" uuid,
	"decision_id" uuid,
	"proposed_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"note" text,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "baseline_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "change_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"impacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "change_request_status" DEFAULT 'draft' NOT NULL,
	"cost_impact_amount" numeric(20, 4),
	"cost_impact_currency" varchar(3),
	"cost_impact_unit_scale" integer,
	"subject_type" varchar(32),
	"subject_id" uuid,
	"proposed_change" jsonb,
	"requested_by" uuid,
	"reviewed_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"decision_id" uuid,
	"rebaseline" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "change_request_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "change_request_cost_impact_ck" CHECK ((("change_request"."cost_impact_amount" is null) = ("change_request"."cost_impact_currency" is null) and ("change_request"."cost_impact_amount" is null) = ("change_request"."cost_impact_unit_scale" is null) and ("change_request"."cost_impact_unit_scale" is null or "change_request"."cost_impact_unit_scale" in (1, 1000, 1000000))))
);
--> statement-breakpoint
CREATE TABLE "cross_project_dependency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"other_project_id" uuid NOT NULL,
	"local_item_type" "schedule_node_type",
	"local_item_id" uuid,
	"other_item_type" "schedule_node_type" NOT NULL,
	"other_item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"needed_by" date,
	"status" "raid_status" DEFAULT 'open' NOT NULL,
	"closed_reason" text,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cross_project_dependency_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "cross_project_dependency_other_chk" CHECK ("cross_project_dependency"."other_project_id" <> "cross_project_dependency"."project_id"),
	CONSTRAINT "cross_project_dependency_local_chk" CHECK (("cross_project_dependency"."local_item_type" is null) = ("cross_project_dependency"."local_item_id" is null))
);
--> statement-breakpoint
CREATE TABLE "deliverable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workstream_id" uuid,
	"task_id" uuid,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"status" "deliverable_status" DEFAULT 'planned' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"weight_approved" boolean DEFAULT false NOT NULL,
	"acceptance_criteria" text,
	"due_date" date,
	"owner_user_id" uuid,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"weight_set_by" uuid,
	"weight_approved_by" uuid,
	"weight_approved_at" timestamp with time zone,
	"gate_key" varchar(16),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "deliverable_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "deliverable_weight_chk" CHECK ("deliverable"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "dependency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"predecessor_type" "schedule_node_type" NOT NULL,
	"predecessor_id" uuid NOT NULL,
	"successor_type" "schedule_node_type" NOT NULL,
	"successor_id" uuid NOT NULL,
	"type" "dependency_type" DEFAULT 'FS' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "dependency_no_self_chk" CHECK ("dependency"."predecessor_id" <> "dependency"."successor_id")
);
--> statement-breakpoint
CREATE TABLE "issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workstream_id" uuid,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_user_id" uuid,
	"status" "raid_status" DEFAULT 'open' NOT NULL,
	"escalation_level" smallint DEFAULT 0 NOT NULL,
	"due_date" date,
	"gate_key" varchar(16),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"severity" smallint DEFAULT 3 NOT NULL,
	"resolution" text,
	"raised_from_risk_id" uuid,
	CONSTRAINT "issue_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "milestone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workstream_id" uuid,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"status" "milestone_status" DEFAULT 'planned' NOT NULL,
	"planned_date" date,
	"forecast_date" date,
	"actual_date" date,
	"gate_key" varchar(16),
	"is_critical" boolean DEFAULT false NOT NULL,
	"weight" integer DEFAULT 3 NOT NULL,
	"owner_user_id" uuid,
	"verification_status" "verification_status" DEFAULT 'proposed' NOT NULL,
	"reported_by" uuid,
	"reported_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "milestone_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "raci_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" uuid,
	"function_label" text,
	"raci" "raci_value" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "rag_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" uuid NOT NULL,
	"calculated_status" "rag_status" NOT NULL,
	"override_status" "rag_status" NOT NULL,
	"reason" text NOT NULL,
	"expires_on" date NOT NULL,
	"requested_by" uuid NOT NULL,
	"reviewer_user_id" uuid,
	"approved" boolean DEFAULT false NOT NULL,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raid_dependency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workstream_id" uuid,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_user_id" uuid,
	"status" "raid_status" DEFAULT 'open' NOT NULL,
	"escalation_level" smallint DEFAULT 0 NOT NULL,
	"due_date" date,
	"gate_key" varchar(16),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"depends_on" text NOT NULL,
	"needed_by" date,
	CONSTRAINT "raid_dependency_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "record_dependency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"successor_type" "schedule_node_type" NOT NULL,
	"successor_id" uuid NOT NULL,
	"predecessor_type" varchar(32) NOT NULL,
	"predecessor_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "record_dependency_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "record_dependency_type_chk" CHECK ("record_dependency"."predecessor_type" in ('decision', 'gate', 'agreement', 'approval_request', 'evidence_link'))
);
--> statement-breakpoint
CREATE TABLE "risk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workstream_id" uuid,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_user_id" uuid,
	"status" "raid_status" DEFAULT 'open' NOT NULL,
	"escalation_level" smallint DEFAULT 0 NOT NULL,
	"due_date" date,
	"gate_key" varchar(16),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"probability" smallint NOT NULL,
	"impact" smallint NOT NULL,
	"trigger" text,
	"response" text,
	"response_strategy" varchar(16),
	"exposure_amount" numeric(20, 4),
	"exposure_currency" varchar(3),
	"exposure_unit_scale" integer,
	CONSTRAINT "risk_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "risk_prob_chk" CHECK ("risk"."probability" between 1 and 5),
	CONSTRAINT "risk_impact_chk" CHECK ("risk"."impact" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "status_update" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workstream_id" uuid,
	"period_end" date NOT NULL,
	"summary" text NOT NULL,
	"achievements" text,
	"next_steps" text,
	"blockers" text,
	"rag_reported" "rag_status",
	"rag_calculated" "rag_status",
	"status" "update_status" DEFAULT 'draft' NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"frozen_snapshot" jsonb,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "status_update_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workstream_id" uuid,
	"parent_id" uuid,
	"wbs_code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"description" text,
	"status" "task_status" DEFAULT 'draft' NOT NULL,
	"accountable_user_id" uuid,
	"proposed_owner_function" text,
	"output" text,
	"acceptance_criteria" text,
	"approver_role" varchar(32),
	"evidence_type" varchar(32),
	"effort" text,
	"duration_days" integer,
	"duration_basis" varchar(16),
	"planned_start" date,
	"planned_finish" date,
	"forecast_start" date,
	"forecast_finish" date,
	"actual_start" date,
	"actual_finish" date,
	"reported_progress" smallint DEFAULT 0 NOT NULL,
	"requires_acceptance" boolean DEFAULT false NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"blocked_reason" text,
	"gate_key" varchar(16),
	"is_deliverable" boolean DEFAULT false NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"template_activity_id" varchar(32),
	"verification_status" "verification_status" DEFAULT 'proposed' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "task_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "task_progress_chk" CHECK ("task"."reported_progress" between 0 and 100),
	CONSTRAINT "task_duration_chk" CHECK ("task"."duration_days" is null or "task"."duration_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "action_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"decision_id" uuid,
	"meeting_id" uuid,
	"issue_id" uuid,
	"owner_user_id" uuid,
	"due_date" date,
	"status" "action_item_status" DEFAULT 'open' NOT NULL,
	"closure_evidence_note" text,
	"reported_done_by" uuid,
	"reported_done_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "action_item_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "agenda_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"committee_id" uuid NOT NULL,
	"meeting_id" uuid,
	"number" integer,
	"title" text NOT NULL,
	"kind" "agenda_item_kind" NOT NULL,
	"decision_id" uuid,
	"requested_by" uuid,
	"screening_status" "agenda_screening_status" DEFAULT 'requested' NOT NULL,
	"screening_note" text,
	"screened_by" uuid,
	"presenter_user_id" uuid,
	"minutes_note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agenda_item_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "approval_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"decision" varchar(16) NOT NULL,
	"comment" text,
	"authority_basis" text,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"subject_type" varchar(32) NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_version" integer,
	"action" varchar(64) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"required_permission" varchar(96) NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "approval_request_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid,
	"status" "attendance_status" NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authority_matrix_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"committee_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"status" "authority_matrix_status" DEFAULT 'draft' NOT NULL,
	"is_demo_policy" boolean DEFAULT false NOT NULL,
	"policy" jsonb NOT NULL,
	"policy_hash" text NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_reference" text,
	"approval_document_id" uuid,
	"approval_document_version_id" uuid,
	"approval_verified_by" uuid,
	"approval_verified_at" timestamp with time zone,
	"approval_verification_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "authority_matrix_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "committee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"program_id" uuid,
	"kind" "committee_kind" NOT NULL,
	"name" text NOT NULL,
	"status" "committee_status" DEFAULT 'draft' NOT NULL,
	"charter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"charter_document_id" uuid,
	"charter_version_no" integer DEFAULT 1 NOT NULL,
	"charter_approved_version_no" integer,
	"charter_approved_by" uuid,
	"charter_approved_at" timestamp with time zone,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "committee_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "committee_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"committee_id" uuid NOT NULL,
	"user_id" uuid,
	"role_label" text NOT NULL,
	"member_role" "committee_member_role" NOT NULL,
	"voting" boolean DEFAULT false NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"delegate_of_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "committee_membership_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "conflict_declaration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"committee_id" uuid NOT NULL,
	"meeting_id" uuid,
	"decision_id" uuid,
	"user_id" uuid NOT NULL,
	"declaration" varchar(24) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"committee_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"decision_type_key" varchar(64),
	"issue" text,
	"why_now" text,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommendation" text,
	"impacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"amount_amount" numeric(20, 4),
	"amount_currency" varchar(3),
	"amount_unit_scale" integer,
	"risks" text,
	"dependencies" text,
	"latest_safe_date" date,
	"required_authority" text,
	"requester_user_id" uuid,
	"status" "decision_status" DEFAULT 'draft' NOT NULL,
	"vote_round" integer DEFAULT 1 NOT NULL,
	"recommendation_recorded_by" uuid,
	"authority_outcome" "decision_authority_outcome" DEFAULT 'not_assessed' NOT NULL,
	"authority_reason" text,
	"escalated_to" text,
	"external_authority_reference" text,
	"external_evidence_link_id" uuid,
	"meeting_id" uuid,
	"decided_via_circulation" boolean DEFAULT false NOT NULL,
	"outcome_recorded_at" timestamp with time zone,
	"outcome_recorded_by" uuid,
	"tally_snapshot" jsonb,
	"superseded_by_decision_id" uuid,
	"implementation_started_by" uuid,
	"implementation_started_at" timestamp with time zone,
	"implementation_evidence_note" text,
	"implementation_verified_by" uuid,
	"implementation_verified_at" timestamp with time zone,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"gate_key" varchar(16),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "decision_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "escalation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"source_id" uuid,
	"requested_action" text NOT NULL,
	"decision_deadline" date,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raised_to_committee_id" uuid,
	"target" text,
	"status" "escalation_status" DEFAULT 'open' NOT NULL,
	"resolution_decision_id" uuid,
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"raised_by" uuid,
	"is_system_generated" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "escalation_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "meeting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"committee_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"location" text,
	"status" "meeting_status" DEFAULT 'planned' NOT NULL,
	"is_circulation" boolean DEFAULT false NOT NULL,
	"response_deadline" date,
	"quorum_snapshot" jsonb,
	"pack_snapshot_id" uuid,
	"minutes_text" text,
	"minutes_drafted_by" uuid,
	"minutes_approved_by" uuid,
	"minutes_approved_at" timestamp with time zone,
	"authority_matrix_version_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "meeting_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "recusal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "vote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"meeting_id" uuid,
	"user_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"member_role_at_vote" "committee_member_role" NOT NULL,
	"choice" "vote_choice" NOT NULL,
	"comment" text,
	"via_circulation" boolean DEFAULT false NOT NULL,
	"authority_matrix_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "criterion_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"status" "criterion_status" DEFAULT 'unmet' NOT NULL,
	"note" text,
	"assessed_by" uuid,
	"assessed_at" timestamp with time zone,
	"waiver_id" uuid,
	"na_basis" text,
	"na_proposed_by" uuid,
	"na_determined_by" uuid,
	"na_approved" boolean DEFAULT false NOT NULL,
	"na_proposed_at" timestamp with time zone,
	"na_determined_role" "role_key",
	"na_determined_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "criterion_assessment_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "gate_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"gate_id" uuid NOT NULL,
	"cycle" integer DEFAULT 1 NOT NULL,
	"status" "gate_assessment_status" DEFAULT 'not_started' NOT NULL,
	"evaluation" jsonb,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_id" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"started_by" uuid,
	"started_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_outcome" "gate_review_outcome",
	"review_note" text,
	"review_basis" varchar(64),
	"reopened_reason" text,
	"supersedes_assessment_id" uuid,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "gate_assessment_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "gate_assessment_review_ck" CHECK (("gate_assessment"."review_outcome" is null and "gate_assessment"."reviewed_by" is null and "gate_assessment"."reviewed_at" is null and "gate_assessment"."review_basis" is null and "gate_assessment"."review_note" is null)
       or ("gate_assessment"."review_outcome" is not null and "gate_assessment"."reviewed_by" is not null and "gate_assessment"."reviewed_at" is not null and "gate_assessment"."review_basis" is not null and length(trim("gate_assessment"."review_note")) > 0)),
	CONSTRAINT "gate_assessment_started_ck" CHECK (("gate_assessment"."started_by" is null) = ("gate_assessment"."started_at" is null))
);
--> statement-breakpoint
CREATE TABLE "gate_criterion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"gate_id" uuid NOT NULL,
	"key" varchar(32) NOT NULL,
	"description" text NOT NULL,
	"description_ar" text,
	"mandatory" boolean NOT NULL,
	"blocking" boolean NOT NULL,
	"waivable" boolean DEFAULT false NOT NULL,
	"waiver_authority_role" "role_key",
	"waivability_basis" text,
	"evidence_required" boolean DEFAULT true NOT NULL,
	"evidence_type" varchar(32),
	"owner_role" "role_key" NOT NULL,
	"reviewer_role" "role_key" NOT NULL,
	"applicability" varchar(24) DEFAULT 'proposed' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "gate_criterion_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "gate_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" varchar(16) NOT NULL,
	"sort_order" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"purpose" text,
	"prerequisite_gate_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owner_role" "role_key" NOT NULL,
	"reviewer_role" "role_key" NOT NULL,
	"approver_role" "role_key" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "gate_definition_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "status_dimension" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" "status_dimension_key" NOT NULL,
	"state" varchar(48) NOT NULL,
	"explanation" text,
	"explanation_i18n" jsonb,
	"counts" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waiver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"basis" text NOT NULL,
	"impact" text NOT NULL,
	"status" "waiver_status" DEFAULT 'requested' NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"authority_role" "role_key",
	"conditions" text,
	"expires_on" date,
	"approval_request_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "waiver_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "agreement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"kind_label" varchar(64) NOT NULL,
	"kind_expansion" text,
	"kind_expansion_confirmed" boolean DEFAULT false NOT NULL,
	"kind_expansion_confirmed_by" uuid,
	"kind_expansion_confirmed_at" timestamp with time zone,
	"kind_expansion_basis" text,
	"title" text NOT NULL,
	"parties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" text,
	"owner_user_id" uuid,
	"legal_reviewer_user_id" uuid,
	"current_draft_version" varchar(32),
	"stage" "agreement_stage" DEFAULT 'identified' NOT NULL,
	"outstanding_issues" text,
	"signing_date" date,
	"effective_date" date,
	"renewal_date" date,
	"expiry_date" date,
	"obligations" text,
	"executed_document_id" uuid,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agreement_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "agreement_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"version_label" varchar(32) NOT NULL,
	"document_id" uuid,
	"document_version_id" uuid,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"perimeter_item_id" uuid,
	"agreement_id" uuid,
	"kind" varchar(16) DEFAULT 'consent' NOT NULL,
	"counterparty" text NOT NULL,
	"contract_ref" text,
	"owner_user_id" uuid,
	"status" "consent_status" DEFAULT 'not_requested' NOT NULL,
	"requested_on" date,
	"responded_on" date,
	"conditions" text,
	"due_date" date,
	"valid_to" date,
	"response_evidence_note" text,
	"response_document_id" uuid,
	"response_recorded_by" uuid,
	"response_recorded_at" timestamp with time zone,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "consent_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "consent_kind_ck" CHECK ("consent"."kind" in ('consent', 'novation', 'assignment', 'notification', 'other'))
);
--> statement-breakpoint
CREATE TABLE "cutover_decision_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"cutover_plan_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"from_status" "cutover_status",
	"to_status" "cutover_status",
	"actor_user_id" uuid NOT NULL,
	"rationale" text,
	"go_decision_id" uuid,
	"evaluation" jsonb,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cutover_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"site_id" uuid,
	"workstream_id" uuid,
	"runbook_document_id" uuid,
	"runbook_summary" text,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"service_impact" text,
	"accountable_user_id" uuid,
	"communications_approved" boolean DEFAULT false NOT NULL,
	"communications_approval_ref" text,
	"testing_summary" text,
	"rehearsal_done" boolean DEFAULT false NOT NULL,
	"contingency_plan" text,
	"rollback_plan" text,
	"go_no_go" "go_no_go" DEFAULT 'pending' NOT NULL,
	"go_no_go_decided_by" uuid,
	"go_no_go_decided_at" timestamp with time zone,
	"go_no_go_rationale" text,
	"go_decision_id" uuid,
	"status" "cutover_status" DEFAULT 'planning' NOT NULL,
	"submitted_for_decision_by" uuid,
	"submitted_for_decision_at" timestamp with time zone,
	"executed_by" uuid,
	"executed_at" timestamp with time zone,
	"execution_note" text,
	"post_transition_accepted" boolean DEFAULT false NOT NULL,
	"post_transition_accepted_by" uuid,
	"post_transition_accepted_at" timestamp with time zone,
	"post_transition_acceptance_note" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cutover_plan_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "operating_model_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version_label" varchar(32) NOT NULL,
	"definition" text NOT NULL,
	"independence_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permitted_enduring_arrangements" text,
	"status" varchar(16) DEFAULT 'proposed' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"decision_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "operating_model_definition_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "operating_model_definition_status_ck" CHECK ("operating_model_definition"."status" in ('proposed', 'approved', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "perimeter_category_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"category" "perimeter_item_type" NOT NULL,
	"conclusion" text NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "perimeter_category_review_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "perimeter_impact_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"perimeter_item_id" uuid NOT NULL,
	"change_request_id" uuid,
	"trigger" varchar(24) NOT NULL,
	"entries" jsonb NOT NULL,
	"narrative" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assessed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perimeter_impact_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "perimeter_impact_trigger_ck" CHECK ("perimeter_impact_assessment"."trigger" in ('manual', 'change_request'))
);
--> statement-breakpoint
CREATE TABLE "perimeter_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"type" "perimeter_item_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"site_id" uuid,
	"workstream_id" uuid,
	"owner_user_id" uuid,
	"current_entity_id" uuid,
	"target_entity_id" uuid,
	"disposition" "perimeter_disposition" DEFAULT 'pending' NOT NULL,
	"resolution_path" text,
	"target_gate_key" varchar(16),
	"legal_owner" text,
	"operator" text,
	"economic_beneficiary" text,
	"planned_effective_date" date,
	"actual_effective_date" date,
	"economic_planned_effective_date" date,
	"economic_actual_effective_date" date,
	"transfer_mechanism" text,
	"agreement_id" uuid,
	"reference_value_amount" numeric(20, 4),
	"reference_value_currency" varchar(3),
	"reference_value_unit_scale" integer,
	"reference_value_source" text,
	"consent_required" boolean DEFAULT false NOT NULL,
	"dependencies" text,
	"risks" text,
	"transfer_status" "transfer_status" DEFAULT 'not_started' NOT NULL,
	"economic_transfer_status" "transfer_status" DEFAULT 'not_started' NOT NULL,
	"acceptance_evidence_note" text,
	"transfer_class" "contract_transfer_class" DEFAULT 'unknown' NOT NULL,
	"transfer_class_assessed_by" uuid,
	"transfer_class_assessed_at" timestamp with time zone,
	"transfer_class_basis" text,
	"interim_arrangement" text,
	"service_accountable_user_id" uuid,
	"billing_accountable_user_id" uuid,
	"sla_accountable_user_id" uuid,
	"remediation_plan" text,
	"pending_change_request_id" uuid,
	"verification_status" "verification_status" DEFAULT 'proposed' NOT NULL,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "perimeter_item_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "perimeter_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"status" varchar(16) DEFAULT 'proposed' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"item_count" integer NOT NULL,
	"note" text,
	"proposed_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_id" uuid,
	"decision_note" text,
	"superseded_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "perimeter_version_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "perimeter_version_status_ck" CHECK ("perimeter_version"."status" in ('proposed', 'approved', 'rejected', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "readiness_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"area" "readiness_area" NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"site_id" uuid,
	"workstream_id" uuid,
	"cutover_plan_id" uuid,
	"owner_user_id" uuid,
	"template_key" varchar(64),
	"mandatory" boolean DEFAULT true NOT NULL,
	"blocker" boolean DEFAULT false NOT NULL,
	"waivable" boolean DEFAULT false NOT NULL,
	"waiver_authority_role" "role_key",
	"waivability_basis" text,
	"waivability_determined_by" uuid,
	"waivability_determined_at" timestamp with time zone,
	"waiver_id" uuid,
	"status" "readiness_status" DEFAULT 'not_started' NOT NULL,
	"signoff_role" "role_key",
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone,
	"signoff_note" text,
	"test_result" text,
	"failure_contingency" text,
	"due_date" date,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "readiness_check_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "readiness_test_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"readiness_check_id" uuid NOT NULL,
	"result" "readiness_status" NOT NULL,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulatory_requirement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"category" "approval_register_category" NOT NULL,
	"authority" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"origin" varchar(24) DEFAULT 'manual' NOT NULL,
	"source_reference" text,
	"applicability" "applicability_status" DEFAULT 'assessment_pending' NOT NULL,
	"applicability_assessed_by" uuid,
	"applicability_assessed_at" timestamp with time zone,
	"applicability_note" text,
	"status" "requirement_status" DEFAULT 'not_started' NOT NULL,
	"owner_user_id" uuid,
	"submitted_on" date,
	"decision_on" date,
	"conditions" text,
	"valid_from" date,
	"valid_to" date,
	"outcome_recorded_by" uuid,
	"outcome_recorded_at" timestamp with time zone,
	"conditions_satisfied_by" uuid,
	"conditions_satisfied_at" timestamp with time zone,
	"conditions_satisfaction_note" text,
	"legal_entity_id" uuid,
	"gate_key" varchar(16),
	"verification_status" "verification_status" DEFAULT 'proposed' NOT NULL,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "regulatory_requirement_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "regulatory_requirement_origin_ck" CHECK ("regulatory_requirement"."origin" in ('manual', 'source_extraction', 'import'))
);
--> statement-breakpoint
CREATE TABLE "transfer_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"perimeter_item_id" uuid NOT NULL,
	"aspect" varchar(16) NOT NULL,
	"command" varchar(32) NOT NULL,
	"from_status" "transfer_status" NOT NULL,
	"to_status" "transfer_status" NOT NULL,
	"mechanism" text,
	"effective_date" date,
	"note" text,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"reviews_record_id" uuid,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_record_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "transfer_record_aspect_ck" CHECK ("transfer_record"."aspect" in ('legal', 'economic')),
	CONSTRAINT "transfer_record_command_ck" CHECK ("transfer_record"."command" in ('plan', 'start', 'report_transferred', 'verify', 'reject_evidence', 'block', 'unblock', 'mark_not_applicable'))
);
--> statement-breakpoint
CREATE TABLE "tsa_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"agreement_id" uuid,
	"provider_entity_id" uuid,
	"recipient_entity_id" uuid,
	"scope" text,
	"dependent_services" text,
	"sla" text,
	"metric_method" text,
	"charge_basis" text,
	"charge_amount" numeric(20, 4),
	"charge_currency" varchar(3),
	"charge_unit_scale" integer,
	"start_date" date,
	"end_date" date,
	"extension_terms" text,
	"termination_terms" text,
	"owner_user_id" uuid,
	"workstream_id" uuid,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"replacement_service" text,
	"replacement_plan" text,
	"replacement_due_date" date,
	"replacement_accepted" boolean DEFAULT false NOT NULL,
	"replacement_accepted_by" uuid,
	"replacement_accepted_at" timestamp with time zone,
	"replacement_failed_at" timestamp with time zone,
	"replacement_failure_note" text,
	"exit_milestones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acceptance_evidence_note" text,
	"residual_risks" text,
	"is_enduring_arrangement" boolean DEFAULT false NOT NULL,
	"status" "tsa_status" DEFAULT 'proposed' NOT NULL,
	"escalation_id" uuid,
	"approval_decision_id" uuid,
	"extension_decision_id" uuid,
	"proposed_end_date" date,
	"extension_requested_by" uuid,
	"extension_requested_at" timestamp with time zone,
	"continuity_plan" text,
	"exit_approval_request_id" uuid,
	"exit_approved_by" uuid,
	"exit_approved_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tsa_service_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "benefit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"measurement_definition" text NOT NULL,
	"baseline_value" text,
	"target_value" text,
	"actual_value" text,
	"unit" varchar(32),
	"value_amount" numeric(20, 4),
	"value_currency" varchar(3),
	"value_unit_scale" integer,
	"realized_amount" numeric(20, 4),
	"realized_currency" varchar(3),
	"realized_unit_scale" integer,
	"owner_user_id" uuid,
	"workstream_id" uuid,
	"realization_date" date,
	"realized_on" date,
	"verification_source" text,
	"status" "benefit_status" DEFAULT 'proposed' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"realization_recorded_by" uuid,
	"realization_recorded_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verification_note" text,
	"status_note" text,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "benefit_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "benefit_value_chk" CHECK (("benefit"."value_amount" is null) = ("benefit"."value_currency" is null) and ("benefit"."value_amount" is null) = ("benefit"."value_unit_scale" is null) and coalesce("benefit"."value_unit_scale", 1) in (1, 1000, 1000000)),
	CONSTRAINT "benefit_realized_money_chk" CHECK (("benefit"."realized_amount" is null) = ("benefit"."realized_currency" is null) and ("benefit"."realized_amount" is null) = ("benefit"."realized_unit_scale" is null) and coalesce("benefit"."realized_unit_scale", 1) in (1, 1000, 1000000)),
	CONSTRAINT "benefit_realized_chk" CHECK ("benefit"."status" not in ('realized_unverified', 'realized_verified') or (nullif(btrim("benefit"."verification_source"), '') is not null and "benefit"."realization_recorded_by" is not null and "benefit"."realized_on" is not null)),
	CONSTRAINT "benefit_verified_chk" CHECK ("benefit"."status" <> 'realized_verified' or ("benefit"."verified_by" is not null and "benefit"."verified_at" is not null and "benefit"."verified_by" <> "benefit"."realization_recorded_by" and "benefit"."verified_by" is distinct from "benefit"."owner_user_id"))
);
--> statement-breakpoint
CREATE TABLE "budget_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workstream_id" uuid,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"category" "financial_category" NOT NULL,
	"proposed_amount" numeric(20, 4),
	"approved_amount" numeric(20, 4),
	"committed_amount" numeric(20, 4) DEFAULT '0' NOT NULL,
	"spent_amount" numeric(20, 4) DEFAULT '0' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"unit_scale" integer DEFAULT 1 NOT NULL,
	"actuals_as_of" date,
	"actuals_source_ref" text,
	"tsa_service_id" uuid,
	"approval_state" "approval_state" DEFAULT 'proposed' NOT NULL,
	"approval_decision_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"source_ref" text,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_line_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "budget_line_scale_chk" CHECK ("budget_line"."unit_scale" in (1, 1000, 1000000)),
	CONSTRAINT "budget_line_currency_chk" CHECK ("budget_line"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "budget_line_tsa_chk" CHECK (("budget_line"."category" = 'tsa_charge') = ("budget_line"."tsa_service_id" is not null)),
	CONSTRAINT "budget_line_nonneg_chk" CHECK ("budget_line"."committed_amount" >= 0 and "budget_line"."spent_amount" >= 0 and coalesce("budget_line"."approved_amount", 0) >= 0 and coalesce("budget_line"."proposed_amount", 0) >= 0),
	CONSTRAINT "budget_line_approved_chk" CHECK ("budget_line"."approved_amount" is null or "budget_line"."approval_state" = 'approved'),
	CONSTRAINT "budget_line_state_chk" CHECK ("budget_line"."approval_state" <> 'approved' or "budget_line"."approved_amount" is not null)
);
--> statement-breakpoint
CREATE TABLE "financial_model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"kind" "model_kind" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"classification" "classification" DEFAULT 'strictly_confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "financial_model_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "financial_model_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"kind" "model_kind" NOT NULL,
	"version_no" integer NOT NULL,
	"version_label" varchar(32) NOT NULL,
	"model_case" "model_case" NOT NULL,
	"based_on_version_id" uuid,
	"superseded_by_id" uuid,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headline_basis" "value_basis",
	"source_type" "source_type" DEFAULT 'manual_entry' NOT NULL,
	"source_document_id" uuid,
	"source_document_version_id" uuid,
	"source_ref" text,
	"import_batch_id" uuid,
	"change_note" text,
	"approval_state" "approval_state" DEFAULT 'proposed' NOT NULL,
	"prepared_by" uuid,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"human_validation_note" text,
	"validated_hash" text,
	"approval_request_id" uuid,
	"approval_decision_id" uuid,
	"approved_values" jsonb,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"classification" "classification" DEFAULT 'strictly_confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "financial_model_version_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "financial_model_source_chk" CHECK ("financial_model_version"."source_document_id" is not null or nullif(btrim("financial_model_version"."source_ref"), '') is not null),
	CONSTRAINT "financial_model_validator_chk" CHECK ("financial_model_version"."validated_by" is null or ("financial_model_version"."validated_by" is distinct from "financial_model_version"."prepared_by" and "financial_model_version"."validated_hash" is not null and "financial_model_version"."validated_at" is not null)),
	CONSTRAINT "financial_model_approved_values_chk" CHECK ("financial_model_version"."approved_values" is null or ("financial_model_version"."approval_state" = 'approved' and "financial_model_version"."approval_decision_id" is not null and "financial_model_version"."approved_by" is not null and "financial_model_version"."validated_by" is not null and "financial_model_version"."approved_by" <> "financial_model_version"."validated_by")),
	CONSTRAINT "financial_model_approved_chk" CHECK ("financial_model_version"."approval_state" <> 'approved' or "financial_model_version"."approved_values" is not null)
);
--> statement-breakpoint
CREATE TABLE "financial_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "financial_kind" NOT NULL,
	"category" "financial_category" NOT NULL,
	"line_ref" varchar(64) NOT NULL,
	"label" text NOT NULL,
	"period" varchar(16) NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"unit_scale" integer DEFAULT 1 NOT NULL,
	"source_type" "source_type" DEFAULT 'manual_entry' NOT NULL,
	"source_ref" text,
	"source_document_id" uuid,
	"source_document_version_id" uuid,
	"source_sheet" varchar(128),
	"source_cell" varchar(64),
	"import_batch_id" uuid,
	"tsa_service_id" uuid,
	"approval_state" "approval_state" DEFAULT 'proposed' NOT NULL,
	"prepared_by" uuid,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"validation_note" text,
	"validated_hash" text,
	"approval_request_id" uuid,
	"approval_decision_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"workstream_id" uuid,
	"classification" "classification" DEFAULT 'restricted' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "financial_snapshot_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "financial_snapshot_scale_chk" CHECK ("financial_snapshot"."unit_scale" in (1, 1000, 1000000)),
	CONSTRAINT "financial_snapshot_currency_chk" CHECK ("financial_snapshot"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "financial_snapshot_tsa_chk" CHECK (("financial_snapshot"."category" = 'tsa_charge') = ("financial_snapshot"."tsa_service_id" is not null)),
	CONSTRAINT "financial_snapshot_source_chk" CHECK ("financial_snapshot"."source_document_id" is not null or nullif(btrim("financial_snapshot"."source_ref"), '') is not null),
	CONSTRAINT "financial_snapshot_import_ref_chk" CHECK ("financial_snapshot"."source_type" not in ('excel', 'csv') or ("financial_snapshot"."source_document_id" is not null and "financial_snapshot"."source_cell" is not null and ("financial_snapshot"."source_type" = 'csv' or "financial_snapshot"."source_sheet" is not null))),
	CONSTRAINT "financial_snapshot_validator_chk" CHECK ("financial_snapshot"."validated_by" is null or ("financial_snapshot"."validated_by" is distinct from "financial_snapshot"."prepared_by" and "financial_snapshot"."validated_hash" is not null and "financial_snapshot"."validated_at" is not null)),
	CONSTRAINT "financial_snapshot_approved_chk" CHECK ("financial_snapshot"."approval_state" <> 'approved' or ("financial_snapshot"."validated_by" is not null and "financial_snapshot"."approved_by" is not null and "financial_snapshot"."approved_at" is not null and "financial_snapshot"."approved_by" <> "financial_snapshot"."validated_by" and "financial_snapshot"."approved_by" is distinct from "financial_snapshot"."prepared_by")),
	CONSTRAINT "financial_snapshot_opening_chk" CHECK ("financial_snapshot"."approval_state" <> 'approved' or "financial_snapshot"."category" <> 'opening_balance' or "financial_snapshot"."approval_decision_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "intercompany_reconciliation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"financial_snapshot_id" uuid,
	"counterparty_label" text NOT NULL,
	"period" varchar(16) NOT NULL,
	"our_balance" numeric(20, 4) NOT NULL,
	"their_balance" numeric(20, 4),
	"currency" varchar(3) NOT NULL,
	"unit_scale" integer DEFAULT 1 NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"explanation" text,
	"source_ref" text,
	"prepared_by" uuid,
	"reviewer_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"classification" "classification" DEFAULT 'restricted' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "intercompany_reconciliation_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "intercompany_reconciliation_scale_chk" CHECK ("intercompany_reconciliation"."unit_scale" in (1, 1000, 1000000)),
	CONSTRAINT "intercompany_reconciliation_status_chk" CHECK ("intercompany_reconciliation"."status" in ('open', 'reconciled', 'disputed')),
	CONSTRAINT "intercompany_reconciliation_reconciled_chk" CHECK ("intercompany_reconciliation"."status" <> 'reconciled' or ("intercompany_reconciliation"."their_balance" is not null and "intercompany_reconciliation"."reviewer_user_id" is not null and "intercompany_reconciliation"."reviewed_at" is not null and "intercompany_reconciliation"."reviewer_user_id" is distinct from "intercompany_reconciliation"."prepared_by" and ("intercompany_reconciliation"."their_balance" = "intercompany_reconciliation"."our_balance" or nullif(btrim("intercompany_reconciliation"."explanation"), '') is not null)))
);
--> statement-breakpoint
CREATE TABLE "kpi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"definition" text NOT NULL,
	"formula" text NOT NULL,
	"unit" varchar(32) NOT NULL,
	"period" varchar(32) NOT NULL,
	"owner_role" varchar(32),
	"owner_user_id" uuid,
	"benefit_id" uuid,
	"source" text NOT NULL,
	"target" text,
	"thresholds" jsonb NOT NULL,
	"direction" "kpi_direction" NOT NULL,
	"frequency" varchar(32) NOT NULL,
	"computation" varchar(64),
	"verification_status" "verification_status" DEFAULT 'proposed' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "kpi_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "kpi_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kpi_id" uuid NOT NULL,
	"period" varchar(16) NOT NULL,
	"value" numeric(20, 4),
	"numerator" numeric(20, 4),
	"denominator" numeric(20, 4),
	"data_quality" varchar(16) DEFAULT 'ok' NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_ref" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"computed_by" varchar(32) DEFAULT 'system' NOT NULL,
	"recorded_by" uuid,
	CONSTRAINT "kpi_observation_quality_chk" CHECK ("kpi_observation"."data_quality" in ('ok', 'incomplete', 'stale', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "closing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid,
	"kind" "closing_kind" NOT NULL,
	"code" varchar(32),
	"sequence" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"signing_id" uuid,
	"target_date" date,
	"status" "closing_status" DEFAULT 'planned' NOT NULL,
	"confirmation_request_id" uuid,
	"executed_document_id" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"confirmation_authority" text,
	"confirmation_decision_id" uuid,
	"readiness_snapshot" jsonb,
	"status_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "closing_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "closing_signing_kind_ck" CHECK (("closing"."kind" = 'signing' and "closing"."signing_id" is null) or "closing"."kind" = 'closing')
);
--> statement-breakpoint
CREATE TABLE "closing_condition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"closing_id" uuid,
	"kind" "condition_kind" DEFAULT 'condition_precedent' NOT NULL,
	"reference" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_user_id" uuid,
	"parties" text,
	"blocking" boolean DEFAULT true NOT NULL,
	"waivable" boolean DEFAULT false NOT NULL,
	"waiver_authority_role" "role_key",
	"waiver_authority_note" text,
	"waivability_basis" text,
	"waivability_determined_by" uuid,
	"waivability_determined_at" timestamp with time zone,
	"valid_to" date,
	"long_stop_date" date,
	"long_stop_extension_decision_id" uuid,
	"long_stop_extended_by" uuid,
	"long_stop_extended_at" timestamp with time zone,
	"status" "condition_status" DEFAULT 'open' NOT NULL,
	"evidence_submitted_by" uuid,
	"evidence_submitted_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"status_note" text,
	"waiver_id" uuid,
	"gate_key" varchar(16),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "closing_condition_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "closing_deliverable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"closing_id" uuid NOT NULL,
	"code" varchar(32),
	"title" text NOT NULL,
	"responsible_party" text,
	"owner_user_id" uuid,
	"due_date" date,
	"decision_id" uuid,
	"status" "closing_deliverable_status" DEFAULT 'pending' NOT NULL,
	"document_id" uuid,
	"executed_version_id" uuid,
	"delivered_by" uuid,
	"delivered_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"status_note" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "closing_deliverable_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "deal_scenario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid,
	"code" varchar(32),
	"name" text NOT NULL,
	"version_no" integer DEFAULT 1 NOT NULL,
	"version_label" varchar(32) NOT NULL,
	"ownership" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contributions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"governance_terms" text,
	"assumptions" text,
	"approval_state" "approval_state" DEFAULT 'proposed' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"classification" "classification" DEFAULT 'strictly_confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "deal_scenario_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "deal_scenario_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"version_label" varchar(32) NOT NULL,
	"ownership" jsonb NOT NULL,
	"contributions" jsonb NOT NULL,
	"governance_terms" text,
	"assumptions" text,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "diligence_finding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid,
	"room_id" uuid,
	"diligence_request_id" uuid,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"materiality" "materiality" NOT NULL,
	"risk_id" uuid,
	"remediation" text,
	"remediation_owner_user_id" uuid,
	"remediation_due_date" date,
	"valuation_implication" text,
	"document_implication" text,
	"cp_implication" text,
	"condition_id" uuid,
	"status_reason" text,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"classification" "classification" DEFAULT 'strictly_confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "diligence_finding_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "diligence_finding_material_owner_ck" CHECK ("diligence_finding"."materiality" not in ('high', 'critical') or "diligence_finding"."remediation_owner_user_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "diligence_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid,
	"room_id" uuid,
	"number" integer NOT NULL,
	"origin" varchar(16) DEFAULT 'internal' NOT NULL,
	"question" text NOT NULL,
	"domain" varchar(32) NOT NULL,
	"requester_label" text,
	"assignee_user_id" uuid,
	"due_date" date,
	"answer_draft" text,
	"drafted_by" uuid,
	"evidence_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_version_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewer_user_id" uuid,
	"submitted_for_review_by" uuid,
	"submitted_for_review_at" timestamp with time zone,
	"release_status" "dd_release_status" DEFAULT 'draft' NOT NULL,
	"release_approved_by" uuid,
	"release_approved_at" timestamp with time zone,
	"review_note" text,
	"released_by" uuid,
	"released_answer" text,
	"released_version" integer,
	"released_at" timestamp with time zone,
	"classification" "classification" DEFAULT 'strictly_confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "diligence_request_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "diligence_request_origin_ck" CHECK ("diligence_request"."origin" in ('internal', 'partner'))
);
--> statement-breakpoint
CREATE TABLE "funds_flow_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"closing_id" uuid NOT NULL,
	"code" varchar(32),
	"description" text NOT NULL,
	"payer" text NOT NULL,
	"payee" text NOT NULL,
	"amount" numeric(20, 4),
	"currency" varchar(3),
	"unit_scale" integer,
	"value_date" date,
	"status" "funds_flow_status" DEFAULT 'planned' NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"settlement_reference" text,
	"settlement_reported_by" uuid,
	"settlement_reported_at" timestamp with time zone,
	"status_note" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "funds_flow_item_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "funds_flow_scale_ck" CHECK ("funds_flow_item"."unit_scale" is null or "funds_flow_item"."unit_scale" in (1, 1000, 1000000)),
	CONSTRAINT "funds_flow_money_ck" CHECK (("funds_flow_item"."amount" is null) = ("funds_flow_item"."currency" is null) and ("funds_flow_item"."amount" is null) = ("funds_flow_item"."unit_scale" is null))
);
--> statement-breakpoint
CREATE TABLE "negotiation_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid,
	"agreement_id" uuid,
	"code" varchar(32) NOT NULL,
	"issue" text NOT NULL,
	"positions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alternatives" text,
	"required_approval" text,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"decision_id" uuid,
	"document_id" uuid,
	"document_ref" text,
	"resolution" text,
	"status" "negotiation_issue_status" DEFAULT 'open' NOT NULL,
	"classification" "classification" DEFAULT 'strictly_confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "negotiation_issue_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "negotiation_issue_approval_link_ck" CHECK (not "negotiation_issue"."requires_approval" or "negotiation_issue"."decision_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "partner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"legal_entity_id" uuid,
	"stage" "partner_stage" DEFAULT 'identified' NOT NULL,
	"stage_changed_at" timestamp with time zone,
	"shortlisted" boolean DEFAULT false NOT NULL,
	"outreach_request_id" uuid,
	"outreach_approved_by" uuid,
	"outreach_approved_at" timestamp with time zone,
	"nda_status" "nda_status" DEFAULT 'none' NOT NULL,
	"nda_executed_on" date,
	"nda_document_id" uuid,
	"nda_request_id" uuid,
	"nda_recorded_by" uuid,
	"nda_recorded_at" timestamp with time zone,
	"materials_access_approved_by" uuid,
	"materials_access_approved_at" timestamp with time zone,
	"withdrawn_reason" text,
	"classification" "classification" DEFAULT 'strictly_confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "partner_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "partner_assessment_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"proposal_id" uuid,
	"criterion_key" varchar(32),
	"basis" varchar(16) NOT NULL,
	"statement" text NOT NULL,
	"score" numeric(5, 2),
	"source_reference" text,
	"document_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "partner_assessment_basis_ck" CHECK ("partner_assessment_entry"."basis" in ('fact', 'judgement')),
	CONSTRAINT "partner_assessment_score_ck" CHECK ("partner_assessment_entry"."score" is null or ("partner_assessment_entry"."score" >= 0 and "partner_assessment_entry"."score" <= 5)),
	CONSTRAINT "partner_assessment_fact_source_ck" CHECK ("partner_assessment_entry"."basis" <> 'fact' or "partner_assessment_entry"."source_reference" is not null or "partner_assessment_entry"."document_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "partner_conflict" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"declarant_user_id" uuid,
	"description" text NOT NULL,
	"mitigation" text,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "partner_conflict_status_ck" CHECK ("partner_conflict"."status" in ('open', 'mitigated', 'cleared'))
);
--> statement-breakpoint
CREATE TABLE "partner_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "partner_contact_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "partner_criteria_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"criteria" jsonb NOT NULL,
	"note" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"received_on" date,
	"scope" text,
	"terms_summary" text,
	"document_id" uuid,
	"supersedes_proposal_id" uuid,
	"classification" "classification" DEFAULT 'strictly_confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "partner_proposal_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "partner_room" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"is_clean_team" boolean DEFAULT false NOT NULL,
	"classification" "classification" DEFAULT 'strictly_confidential' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"lock_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "partner_room_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "post_close_obligation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"kind" "post_close_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"responsible_party" text,
	"owner_user_id" uuid,
	"due_date" date,
	"status" "post_close_status" DEFAULT 'open' NOT NULL,
	"evidence_note" text,
	"completion_reported_by" uuid,
	"completion_reported_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"overdue_since" date,
	"escalation_id" uuid,
	"status_note" text,
	"closing_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "post_close_obligation_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "program_closure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'requested' NOT NULL,
	"handover_note" text NOT NULL,
	"g7_assessment_id" uuid,
	"approval_request_id" uuid,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"status_note" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "program_closure_status_ck" CHECK ("program_closure"."status" in ('requested', 'confirmed', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "room_access_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"actor_user_id" uuid,
	"subject_user_id" uuid,
	"grant_id" uuid,
	"disclosure_id" uuid,
	"diligence_request_id" uuid,
	"document_version_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_access_event_kind_ck" CHECK ("room_access_event"."kind" in ('grant', 'grant_revoked', 'disclosure_requested', 'disclosure_released', 'disclosure_rejected', 'disclosure_revoked', 'dd_answer_released', 'download', 'room_locked', 'room_unlocked'))
);
--> statement-breakpoint
CREATE TABLE "room_disclosure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"room_id" uuid,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"diligence_request_id" uuid,
	"status" varchar(16) DEFAULT 'requested' NOT NULL,
	"request_note" text,
	"requested_by" uuid NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"rejected_by" uuid,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"status_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "room_disclosure_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "room_disclosure_status_ck" CHECK ("room_disclosure"."status" in ('requested', 'released', 'rejected', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "room_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"access_level" varchar(16) DEFAULT 'read' NOT NULL,
	"role" "role_key",
	"reason" text NOT NULL,
	"attestation_ref" text,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	CONSTRAINT "room_grant_pid_uq" UNIQUE("project_id","id"),
	CONSTRAINT "room_grant_access_level_ck" CHECK ("room_grant"."access_level" in ('read', 'contribute', 'manage')),
	CONSTRAINT "room_grant_role_ck" CHECK ("room_grant"."role" is null or "room_grant"."role" in ('clean_team', 'external_partner_limited'))
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"room_id" uuid,
	"owner_user_id" uuid,
	"current_version_id" uuid,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"legal_hold_reason" text,
	"retention_until" date,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "document_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"room_id" uuid,
	"classification" "classification" NOT NULL,
	"ordinal" integer NOT NULL,
	"page" integer,
	"section" text,
	"text" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(section, '') || ' ' || text)) STORED,
	"suspicious_instructions" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"room_id" uuid,
	"version_no" integer NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"detected_type" varchar(64),
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"scan_status" "scan_status" DEFAULT 'pending' NOT NULL,
	"scan_detail" text,
	"extraction_status" "extraction_status" DEFAULT 'not_performed' NOT NULL,
	"page_count" integer,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "document_version_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "evidence_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"document_id" uuid,
	"document_version_id" uuid,
	"room_id" uuid,
	"note" text,
	"purpose" text,
	"status" "evidence_link_status" DEFAULT 'active' NOT NULL,
	"conflict_with_link_id" uuid,
	"conflict_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "evidence_link_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "source_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"location" text NOT NULL,
	"subject" text NOT NULL,
	"target_type" varchar(32),
	"target_id" uuid,
	"field" varchar(64),
	"extracted_value" text NOT NULL,
	"source_reported_value" text,
	"confirmed_value" text,
	"confidence" numeric(4, 3),
	"verification_status" "verification_status" DEFAULT 'unknown' NOT NULL,
	"origin_status" "verification_status" DEFAULT 'unknown' NOT NULL,
	"reviewer_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"verification_source_id" uuid,
	"conflict_with_claim_id" uuid,
	"applied_to_record" boolean DEFAULT false NOT NULL,
	"applied_by" uuid,
	"applied_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "source_claim_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "source_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"source_type" "source_type" NOT NULL,
	"filename" text,
	"source_version" varchar(32),
	"checksum" varchar(64),
	"owner_label" text,
	"uploaded_at" timestamp with time zone,
	"report_date" date,
	"as_of_date" date,
	"extraction_date" date,
	"extraction_status" "extraction_status" DEFAULT 'not_performed' NOT NULL,
	"extraction_note" text,
	"document_version_id" uuid,
	"supersedes_source_id" uuid,
	"classification" "classification" DEFAULT 'confidential' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "source_record_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"source_id" uuid,
	"document_version_id" uuid,
	"filename" text,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"sheet" text,
	"header_row" integer,
	"mapping" jsonb,
	"summary" jsonb,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "import_batch_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "import_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	"action" "import_row_action" NOT NULL,
	"message" text,
	"target_type" varchar(32),
	"target_id" uuid,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "report_export" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"format" "export_format" NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "report_kind" NOT NULL,
	"title" text NOT NULL,
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"as_of_local_date" date NOT NULL,
	"scope" jsonb NOT NULL,
	"baseline_version_id" uuid,
	"baseline_version_no" integer,
	"classification" "classification" NOT NULL,
	"payload" jsonb NOT NULL,
	"unverified_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"previous_snapshot_id" uuid,
	"includes_demo_data" jsonb DEFAULT 'false'::jsonb NOT NULL,
	"generated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_snapshot_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit_checkpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"chain_pos" bigint NOT NULL,
	"hash" varchar(64) NOT NULL,
	"row_count" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"actor_user_id" uuid,
	"actor_kind" "actor_kind" NOT NULL,
	"action" varchar(96) NOT NULL,
	"entity_type" varchar(48),
	"entity_id" uuid,
	"outcome" varchar(16) DEFAULT 'success' NOT NULL,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"correlation_id" varchar(64),
	"ip" varchar(64),
	"chain_pos" bigint,
	"prev_hash" varchar(64),
	"hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"idempotency_key" varchar(200) NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"recipient_user_id" uuid,
	"recipient_address_hash" varchar(64),
	"payload_hash" varchar(64) NOT NULL,
	"status" "delivery_status" NOT NULL,
	"provider_message_id" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"name" text NOT NULL,
	"direction" "integration_direction" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ref" text,
	"status" "integration_status" DEFAULT 'not_configured' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sending_authorized" boolean DEFAULT false NOT NULL,
	"approved_destinations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_check_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" varchar(64) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_by" varchar(64),
	"locked_until" timestamp with time zone,
	"last_error" text,
	"result" jsonb,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"user_id" uuid NOT NULL,
	"kind" varchar(48) NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"channel" "notification_channel" DEFAULT 'in_app' NOT NULL,
	"delivery_status" "delivery_status" DEFAULT 'queued' NOT NULL,
	"dedupe_key" varchar(200),
	"source_type" varchar(32),
	"source_id" uuid,
	"ai_proposal_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"type" varchar(64) NOT NULL,
	"aggregate_type" varchar(32),
	"aggregate_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "record_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"entity_type" varchar(48) NOT NULL,
	"entity_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"cron" varchar(64) NOT NULL,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_status" varchar(32),
	"last_error" text,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_action_approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"target_version" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'valid' NOT NULL,
	"invalidated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_derived_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"acl_fingerprint" varchar(64) NOT NULL,
	"source_refs" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "ai_project_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"mode" "ai_mode" DEFAULT 'off' NOT NULL,
	"provider" "ai_provider" DEFAULT 'off' NOT NULL,
	"model" varchar(128),
	"kill_switch" boolean DEFAULT false NOT NULL,
	"kill_switch_by" uuid,
	"kill_switch_at" timestamp with time zone,
	"max_classification_to_provider" varchar(32) DEFAULT 'internal' NOT NULL,
	"monthly_token_budget" integer DEFAULT 0 NOT NULL,
	"monthly_cost_budget" numeric(12, 2),
	"cost_currency" varchar(3),
	"per_run_token_limit" integer DEFAULT 20000 NOT NULL,
	"per_run_timeout_ms" integer DEFAULT 60000 NOT NULL,
	"quiet_hours_start" integer,
	"quiet_hours_end" integer,
	"briefing_cron" varchar(64),
	"briefing_timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"autopilot_policy" jsonb,
	"policy_version" varchar(32) DEFAULT 'ai-policy-1' NOT NULL,
	"circuit_open_until" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid,
	"action_type" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" uuid,
	"target_version" integer,
	"payload" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"rationale" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "ai_proposal_status" DEFAULT 'proposed' NOT NULL,
	"policy_version" varchar(32) NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"execution_result" jsonb,
	"executed_at" timestamp with time zone,
	"invalidated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ai_proposal_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"trigger" varchar(32) NOT NULL,
	"trigger_ref" text,
	"requested_by" uuid,
	"service_identity" varchar(64) DEFAULT 'svc-ai-pm' NOT NULL,
	"status" "ai_run_status" DEFAULT 'queued' NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model" varchar(128),
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"question" text,
	"output" jsonb,
	"evidence_snapshot" jsonb,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_estimate" numeric(12, 4),
	"policy_version" varchar(32),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_run_pid_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_role_assignment" ADD CONSTRAINT "org_role_assignment_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_role_assignment" ADD CONSTRAINT "org_role_assignment_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_policy" ADD CONSTRAINT "role_policy_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_holiday" ADD CONSTRAINT "calendar_holiday_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_owner_project_id_project_id_fk" FOREIGN KEY ("owner_project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio" ADD CONSTRAINT "portfolio_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_portfolio_id_portfolio_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_template_version_id_project_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."project_template_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_entity" ADD CONSTRAINT "project_entity_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_entity" ADD CONSTRAINT "project_entity_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_membership" ADD CONSTRAINT "project_membership_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_membership" ADD CONSTRAINT "project_membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_membership" ADD CONSTRAINT "project_membership_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template" ADD CONSTRAINT "project_template_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_migration" ADD CONSTRAINT "project_template_migration_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_migration" ADD CONSTRAINT "project_template_migration_from_version_id_project_template_version_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."project_template_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_migration" ADD CONSTRAINT "project_template_migration_to_version_id_project_template_version_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."project_template_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_version" ADD CONSTRAINT "project_template_version_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_version" ADD CONSTRAINT "project_template_version_template_id_project_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."project_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream" ADD CONSTRAINT "workstream_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream" ADD CONSTRAINT "workstream_lead_user_id_app_user_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assumption" ADD CONSTRAINT "assumption_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assumption" ADD CONSTRAINT "assumption_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assumption" ADD CONSTRAINT "assumption_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_version" ADD CONSTRAINT "baseline_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_version" ADD CONSTRAINT "baseline_change_request_fk" FOREIGN KEY ("project_id","change_request_id") REFERENCES "public"."change_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_version" ADD CONSTRAINT "baseline_decision_fk" FOREIGN KEY ("project_id","decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_decision_fk" FOREIGN KEY ("project_id","decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_project_dependency" ADD CONSTRAINT "cross_project_dependency_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_project_dependency" ADD CONSTRAINT "cross_project_dependency_other_project_id_project_id_fk" FOREIGN KEY ("other_project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable" ADD CONSTRAINT "deliverable_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable" ADD CONSTRAINT "deliverable_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable" ADD CONSTRAINT "deliverable_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable" ADD CONSTRAINT "deliverable_task_fk" FOREIGN KEY ("project_id","task_id") REFERENCES "public"."task"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependency" ADD CONSTRAINT "dependency_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_risk_fk" FOREIGN KEY ("project_id","raised_from_risk_id") REFERENCES "public"."risk"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raci_assignment" ADD CONSTRAINT "raci_assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raci_assignment" ADD CONSTRAINT "raci_assignment_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_override" ADD CONSTRAINT "rag_override_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_dependency" ADD CONSTRAINT "raid_dependency_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_dependency" ADD CONSTRAINT "raid_dependency_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_dependency" ADD CONSTRAINT "raid_dependency_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_dependency" ADD CONSTRAINT "record_dependency_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk" ADD CONSTRAINT "risk_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk" ADD CONSTRAINT "risk_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk" ADD CONSTRAINT "risk_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_update" ADD CONSTRAINT "status_update_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_update" ADD CONSTRAINT "status_update_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_accountable_user_id_app_user_id_fk" FOREIGN KEY ("accountable_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_parent_fk" FOREIGN KEY ("project_id","parent_id") REFERENCES "public"."task"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_issue_fk" FOREIGN KEY ("project_id","issue_id") REFERENCES "public"."issue"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_decision_fk" FOREIGN KEY ("project_id","decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_meeting_fk" FOREIGN KEY ("project_id","meeting_id") REFERENCES "public"."meeting"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_committee_fk" FOREIGN KEY ("project_id","committee_id") REFERENCES "public"."committee"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_meeting_fk" FOREIGN KEY ("project_id","meeting_id") REFERENCES "public"."meeting"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_decision_fk" FOREIGN KEY ("project_id","decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_record" ADD CONSTRAINT "approval_record_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_record" ADD CONSTRAINT "approval_record_request_fk" FOREIGN KEY ("project_id","approval_request_id") REFERENCES "public"."approval_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_meeting_fk" FOREIGN KEY ("project_id","meeting_id") REFERENCES "public"."meeting"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_membership_fk" FOREIGN KEY ("project_id","membership_id") REFERENCES "public"."committee_membership"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_matrix_version" ADD CONSTRAINT "authority_matrix_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_matrix_version" ADD CONSTRAINT "authority_matrix_committee_fk" FOREIGN KEY ("project_id","committee_id") REFERENCES "public"."committee"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_matrix_version" ADD CONSTRAINT "authority_matrix_approval_document_fk" FOREIGN KEY ("project_id","approval_document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_matrix_version" ADD CONSTRAINT "authority_matrix_approval_version_fk" FOREIGN KEY ("project_id","approval_document_version_id") REFERENCES "public"."document_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee" ADD CONSTRAINT "committee_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee" ADD CONSTRAINT "committee_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee" ADD CONSTRAINT "committee_charter_doc_fk" FOREIGN KEY ("project_id","charter_document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_membership" ADD CONSTRAINT "committee_membership_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_membership" ADD CONSTRAINT "committee_membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_membership" ADD CONSTRAINT "committee_membership_delegate_fk" FOREIGN KEY ("project_id","delegate_of_membership_id") REFERENCES "public"."committee_membership"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_membership" ADD CONSTRAINT "committee_membership_committee_fk" FOREIGN KEY ("project_id","committee_id") REFERENCES "public"."committee"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_declaration" ADD CONSTRAINT "conflict_declaration_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_declaration" ADD CONSTRAINT "conflict_declaration_committee_fk" FOREIGN KEY ("project_id","committee_id") REFERENCES "public"."committee"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_declaration" ADD CONSTRAINT "conflict_declaration_meeting_fk" FOREIGN KEY ("project_id","meeting_id") REFERENCES "public"."meeting"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_declaration" ADD CONSTRAINT "conflict_declaration_decision_fk" FOREIGN KEY ("project_id","decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_requester_user_id_app_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_committee_fk" FOREIGN KEY ("project_id","committee_id") REFERENCES "public"."committee"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_meeting_fk" FOREIGN KEY ("project_id","meeting_id") REFERENCES "public"."meeting"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_superseded_fk" FOREIGN KEY ("project_id","superseded_by_decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_external_evidence_fk" FOREIGN KEY ("project_id","external_evidence_link_id") REFERENCES "public"."evidence_link"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation" ADD CONSTRAINT "escalation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation" ADD CONSTRAINT "escalation_committee_fk" FOREIGN KEY ("project_id","raised_to_committee_id") REFERENCES "public"."committee"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation" ADD CONSTRAINT "escalation_resolution_fk" FOREIGN KEY ("project_id","resolution_decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_matrix_fk" FOREIGN KEY ("project_id","authority_matrix_version_id") REFERENCES "public"."authority_matrix_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_pack_fk" FOREIGN KEY ("project_id","pack_snapshot_id") REFERENCES "public"."report_snapshot"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_committee_fk" FOREIGN KEY ("project_id","committee_id") REFERENCES "public"."committee"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recusal" ADD CONSTRAINT "recusal_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recusal" ADD CONSTRAINT "recusal_decision_fk" FOREIGN KEY ("project_id","decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_meeting_fk" FOREIGN KEY ("project_id","meeting_id") REFERENCES "public"."meeting"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_matrix_fk" FOREIGN KEY ("project_id","authority_matrix_version_id") REFERENCES "public"."authority_matrix_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_decision_fk" FOREIGN KEY ("project_id","decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_membership_fk" FOREIGN KEY ("project_id","membership_id") REFERENCES "public"."committee_membership"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_assessment" ADD CONSTRAINT "criterion_assessment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_assessment" ADD CONSTRAINT "criterion_assessment_waiver_fk" FOREIGN KEY ("project_id","waiver_id") REFERENCES "public"."waiver"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_assessment" ADD CONSTRAINT "criterion_assessment_assessment_fk" FOREIGN KEY ("project_id","assessment_id") REFERENCES "public"."gate_assessment"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_assessment" ADD CONSTRAINT "criterion_assessment_criterion_fk" FOREIGN KEY ("project_id","criterion_id") REFERENCES "public"."gate_criterion"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_assessment" ADD CONSTRAINT "gate_assessment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_assessment" ADD CONSTRAINT "gate_assessment_decision_fk" FOREIGN KEY ("project_id","decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_assessment" ADD CONSTRAINT "gate_assessment_supersedes_fk" FOREIGN KEY ("project_id","supersedes_assessment_id") REFERENCES "public"."gate_assessment"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_assessment" ADD CONSTRAINT "gate_assessment_gate_fk" FOREIGN KEY ("project_id","gate_id") REFERENCES "public"."gate_definition"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_criterion" ADD CONSTRAINT "gate_criterion_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_criterion" ADD CONSTRAINT "gate_criterion_gate_fk" FOREIGN KEY ("project_id","gate_id") REFERENCES "public"."gate_definition"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_dimension" ADD CONSTRAINT "status_dimension_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver" ADD CONSTRAINT "waiver_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver" ADD CONSTRAINT "waiver_approval_request_fk" FOREIGN KEY ("project_id","approval_request_id") REFERENCES "public"."approval_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_legal_reviewer_user_id_app_user_id_fk" FOREIGN KEY ("legal_reviewer_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_executed_doc_fk" FOREIGN KEY ("project_id","executed_document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_version" ADD CONSTRAINT "agreement_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_version" ADD CONSTRAINT "agreement_version_agreement_fk" FOREIGN KEY ("project_id","agreement_id") REFERENCES "public"."agreement"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_version" ADD CONSTRAINT "agreement_version_document_fk" FOREIGN KEY ("project_id","document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_version" ADD CONSTRAINT "agreement_version_docver_fk" FOREIGN KEY ("project_id","document_version_id") REFERENCES "public"."document_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_item_fk" FOREIGN KEY ("project_id","perimeter_item_id") REFERENCES "public"."perimeter_item"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_agreement_fk" FOREIGN KEY ("project_id","agreement_id") REFERENCES "public"."agreement"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_response_doc_fk" FOREIGN KEY ("project_id","response_document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutover_decision_record" ADD CONSTRAINT "cutover_decision_record_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutover_decision_record" ADD CONSTRAINT "cutover_decision_record_plan_fk" FOREIGN KEY ("project_id","cutover_plan_id") REFERENCES "public"."cutover_plan"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutover_decision_record" ADD CONSTRAINT "cutover_decision_record_decision_fk" FOREIGN KEY ("project_id","go_decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutover_plan" ADD CONSTRAINT "cutover_plan_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutover_plan" ADD CONSTRAINT "cutover_plan_accountable_user_id_app_user_id_fk" FOREIGN KEY ("accountable_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutover_plan" ADD CONSTRAINT "cutover_plan_runbook_fk" FOREIGN KEY ("project_id","runbook_document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutover_plan" ADD CONSTRAINT "cutover_plan_go_decision_fk" FOREIGN KEY ("project_id","go_decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutover_plan" ADD CONSTRAINT "cutover_plan_site_fk" FOREIGN KEY ("project_id","site_id") REFERENCES "public"."site"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutover_plan" ADD CONSTRAINT "cutover_plan_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_model_definition" ADD CONSTRAINT "operating_model_definition_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_model_definition" ADD CONSTRAINT "operating_model_decision_fk" FOREIGN KEY ("project_id","decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_category_review" ADD CONSTRAINT "perimeter_category_review_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_impact_assessment" ADD CONSTRAINT "perimeter_impact_assessment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_impact_assessment" ADD CONSTRAINT "perimeter_impact_item_fk" FOREIGN KEY ("project_id","perimeter_item_id") REFERENCES "public"."perimeter_item"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_impact_assessment" ADD CONSTRAINT "perimeter_impact_cr_fk" FOREIGN KEY ("project_id","change_request_id") REFERENCES "public"."change_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_item" ADD CONSTRAINT "perimeter_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_item" ADD CONSTRAINT "perimeter_item_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_item" ADD CONSTRAINT "perimeter_item_current_entity_id_legal_entity_id_fk" FOREIGN KEY ("current_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_item" ADD CONSTRAINT "perimeter_item_target_entity_id_legal_entity_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_item" ADD CONSTRAINT "perimeter_item_service_accountable_user_id_app_user_id_fk" FOREIGN KEY ("service_accountable_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_item" ADD CONSTRAINT "perimeter_item_billing_accountable_user_id_app_user_id_fk" FOREIGN KEY ("billing_accountable_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_item" ADD CONSTRAINT "perimeter_item_sla_accountable_user_id_app_user_id_fk" FOREIGN KEY ("sla_accountable_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_item" ADD CONSTRAINT "perimeter_item_site_fk" FOREIGN KEY ("project_id","site_id") REFERENCES "public"."site"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_item" ADD CONSTRAINT "perimeter_item_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_item" ADD CONSTRAINT "perimeter_item_agreement_fk" FOREIGN KEY ("project_id","agreement_id") REFERENCES "public"."agreement"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_item" ADD CONSTRAINT "perimeter_item_pending_cr_fk" FOREIGN KEY ("project_id","pending_change_request_id") REFERENCES "public"."change_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_version" ADD CONSTRAINT "perimeter_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_version" ADD CONSTRAINT "perimeter_version_decision_fk" FOREIGN KEY ("project_id","decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_check" ADD CONSTRAINT "readiness_check_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_check" ADD CONSTRAINT "readiness_check_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_check" ADD CONSTRAINT "readiness_check_waiver_fk" FOREIGN KEY ("project_id","waiver_id") REFERENCES "public"."waiver"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_check" ADD CONSTRAINT "readiness_check_site_fk" FOREIGN KEY ("project_id","site_id") REFERENCES "public"."site"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_check" ADD CONSTRAINT "readiness_check_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_check" ADD CONSTRAINT "readiness_check_cutover_fk" FOREIGN KEY ("project_id","cutover_plan_id") REFERENCES "public"."cutover_plan"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_test_run" ADD CONSTRAINT "readiness_test_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_test_run" ADD CONSTRAINT "readiness_test_run_check_fk" FOREIGN KEY ("project_id","readiness_check_id") REFERENCES "public"."readiness_check"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_requirement" ADD CONSTRAINT "regulatory_requirement_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_requirement" ADD CONSTRAINT "regulatory_requirement_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_requirement" ADD CONSTRAINT "regulatory_requirement_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_record" ADD CONSTRAINT "transfer_record_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_record" ADD CONSTRAINT "transfer_record_item_fk" FOREIGN KEY ("project_id","perimeter_item_id") REFERENCES "public"."perimeter_item"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_record" ADD CONSTRAINT "transfer_record_reviews_fk" FOREIGN KEY ("project_id","reviews_record_id") REFERENCES "public"."transfer_record"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tsa_service" ADD CONSTRAINT "tsa_service_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tsa_service" ADD CONSTRAINT "tsa_service_provider_entity_id_legal_entity_id_fk" FOREIGN KEY ("provider_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tsa_service" ADD CONSTRAINT "tsa_service_recipient_entity_id_legal_entity_id_fk" FOREIGN KEY ("recipient_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tsa_service" ADD CONSTRAINT "tsa_service_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tsa_service" ADD CONSTRAINT "tsa_service_escalation_fk" FOREIGN KEY ("project_id","escalation_id") REFERENCES "public"."escalation"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tsa_service" ADD CONSTRAINT "tsa_service_extension_decision_fk" FOREIGN KEY ("project_id","extension_decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tsa_service" ADD CONSTRAINT "tsa_service_approval_decision_fk" FOREIGN KEY ("project_id","approval_decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tsa_service" ADD CONSTRAINT "tsa_service_exit_approval_fk" FOREIGN KEY ("project_id","exit_approval_request_id") REFERENCES "public"."approval_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tsa_service" ADD CONSTRAINT "tsa_service_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tsa_service" ADD CONSTRAINT "tsa_service_agreement_fk" FOREIGN KEY ("project_id","agreement_id") REFERENCES "public"."agreement"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit" ADD CONSTRAINT "benefit_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit" ADD CONSTRAINT "benefit_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit" ADD CONSTRAINT "benefit_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_tsa_fk" FOREIGN KEY ("project_id","tsa_service_id") REFERENCES "public"."tsa_service"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_decision_fk" FOREIGN KEY ("project_id","approval_decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model" ADD CONSTRAINT "financial_model_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model_version" ADD CONSTRAINT "financial_model_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model_version" ADD CONSTRAINT "financial_model_version_model_fk" FOREIGN KEY ("project_id","model_id") REFERENCES "public"."financial_model"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model_version" ADD CONSTRAINT "financial_model_doc_fk" FOREIGN KEY ("project_id","source_document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model_version" ADD CONSTRAINT "financial_model_docver_fk" FOREIGN KEY ("project_id","source_document_version_id") REFERENCES "public"."document_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model_version" ADD CONSTRAINT "financial_model_import_fk" FOREIGN KEY ("project_id","import_batch_id") REFERENCES "public"."import_batch"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model_version" ADD CONSTRAINT "financial_model_based_on_fk" FOREIGN KEY ("project_id","based_on_version_id") REFERENCES "public"."financial_model_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model_version" ADD CONSTRAINT "financial_model_superseded_fk" FOREIGN KEY ("project_id","superseded_by_id") REFERENCES "public"."financial_model_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model_version" ADD CONSTRAINT "financial_model_request_fk" FOREIGN KEY ("project_id","approval_request_id") REFERENCES "public"."approval_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model_version" ADD CONSTRAINT "financial_model_decision_fk" FOREIGN KEY ("project_id","approval_decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_snapshot" ADD CONSTRAINT "financial_snapshot_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_snapshot" ADD CONSTRAINT "financial_snapshot_doc_fk" FOREIGN KEY ("project_id","source_document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_snapshot" ADD CONSTRAINT "financial_snapshot_docver_fk" FOREIGN KEY ("project_id","source_document_version_id") REFERENCES "public"."document_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_snapshot" ADD CONSTRAINT "financial_snapshot_import_fk" FOREIGN KEY ("project_id","import_batch_id") REFERENCES "public"."import_batch"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_snapshot" ADD CONSTRAINT "financial_snapshot_tsa_fk" FOREIGN KEY ("project_id","tsa_service_id") REFERENCES "public"."tsa_service"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_snapshot" ADD CONSTRAINT "financial_snapshot_request_fk" FOREIGN KEY ("project_id","approval_request_id") REFERENCES "public"."approval_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_snapshot" ADD CONSTRAINT "financial_snapshot_decision_fk" FOREIGN KEY ("project_id","approval_decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_snapshot" ADD CONSTRAINT "financial_snapshot_ws_fk" FOREIGN KEY ("project_id","workstream_id") REFERENCES "public"."workstream"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_reconciliation" ADD CONSTRAINT "intercompany_reconciliation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_reconciliation" ADD CONSTRAINT "intercompany_reconciliation_snapshot_fk" FOREIGN KEY ("project_id","financial_snapshot_id") REFERENCES "public"."financial_snapshot"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_benefit_fk" FOREIGN KEY ("project_id","benefit_id") REFERENCES "public"."benefit"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_observation" ADD CONSTRAINT "kpi_observation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_observation" ADD CONSTRAINT "kpi_observation_kpi_fk" FOREIGN KEY ("project_id","kpi_id") REFERENCES "public"."kpi"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing" ADD CONSTRAINT "closing_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing" ADD CONSTRAINT "closing_decision_fk" FOREIGN KEY ("project_id","confirmation_decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing" ADD CONSTRAINT "closing_partner_fk" FOREIGN KEY ("project_id","partner_id") REFERENCES "public"."partner"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing" ADD CONSTRAINT "closing_signing_fk" FOREIGN KEY ("project_id","signing_id") REFERENCES "public"."closing"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing" ADD CONSTRAINT "closing_confirmation_request_fk" FOREIGN KEY ("project_id","confirmation_request_id") REFERENCES "public"."approval_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing" ADD CONSTRAINT "closing_executed_document_fk" FOREIGN KEY ("project_id","executed_document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_condition" ADD CONSTRAINT "closing_condition_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_condition" ADD CONSTRAINT "closing_condition_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_condition" ADD CONSTRAINT "closing_condition_waiver_fk" FOREIGN KEY ("project_id","waiver_id") REFERENCES "public"."waiver"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_condition" ADD CONSTRAINT "closing_condition_extension_decision_fk" FOREIGN KEY ("project_id","long_stop_extension_decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_condition" ADD CONSTRAINT "closing_condition_closing_fk" FOREIGN KEY ("project_id","closing_id") REFERENCES "public"."closing"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_deliverable" ADD CONSTRAINT "closing_deliverable_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_deliverable" ADD CONSTRAINT "closing_deliverable_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_deliverable" ADD CONSTRAINT "closing_deliverable_doc_fk" FOREIGN KEY ("project_id","document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_deliverable" ADD CONSTRAINT "closing_deliverable_version_fk" FOREIGN KEY ("project_id","executed_version_id") REFERENCES "public"."document_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_deliverable" ADD CONSTRAINT "closing_deliverable_decision_fk" FOREIGN KEY ("project_id","decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_deliverable" ADD CONSTRAINT "closing_deliverable_closing_fk" FOREIGN KEY ("project_id","closing_id") REFERENCES "public"."closing"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_scenario" ADD CONSTRAINT "deal_scenario_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_scenario" ADD CONSTRAINT "deal_scenario_partner_fk" FOREIGN KEY ("project_id","partner_id") REFERENCES "public"."partner"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_scenario_version" ADD CONSTRAINT "deal_scenario_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_scenario_version" ADD CONSTRAINT "deal_scenario_version_scenario_fk" FOREIGN KEY ("project_id","scenario_id") REFERENCES "public"."deal_scenario"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_finding" ADD CONSTRAINT "diligence_finding_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_finding" ADD CONSTRAINT "diligence_finding_risk_fk" FOREIGN KEY ("project_id","risk_id") REFERENCES "public"."risk"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_finding" ADD CONSTRAINT "diligence_finding_partner_fk" FOREIGN KEY ("project_id","partner_id") REFERENCES "public"."partner"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_finding" ADD CONSTRAINT "diligence_finding_room_fk" FOREIGN KEY ("project_id","room_id") REFERENCES "public"."partner_room"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_finding" ADD CONSTRAINT "diligence_finding_request_fk" FOREIGN KEY ("project_id","diligence_request_id") REFERENCES "public"."diligence_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_finding" ADD CONSTRAINT "diligence_finding_condition_fk" FOREIGN KEY ("project_id","condition_id") REFERENCES "public"."closing_condition"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_request" ADD CONSTRAINT "diligence_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_request" ADD CONSTRAINT "diligence_request_assignee_user_id_app_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_request" ADD CONSTRAINT "diligence_request_reviewer_user_id_app_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_request" ADD CONSTRAINT "diligence_request_partner_fk" FOREIGN KEY ("project_id","partner_id") REFERENCES "public"."partner"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_request" ADD CONSTRAINT "diligence_request_room_fk" FOREIGN KEY ("project_id","room_id") REFERENCES "public"."partner_room"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds_flow_item" ADD CONSTRAINT "funds_flow_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds_flow_item" ADD CONSTRAINT "funds_flow_closing_fk" FOREIGN KEY ("project_id","closing_id") REFERENCES "public"."closing"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_issue" ADD CONSTRAINT "negotiation_issue_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_issue" ADD CONSTRAINT "negotiation_issue_partner_fk" FOREIGN KEY ("project_id","partner_id") REFERENCES "public"."partner"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_issue" ADD CONSTRAINT "negotiation_issue_agreement_fk" FOREIGN KEY ("project_id","agreement_id") REFERENCES "public"."agreement"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_issue" ADD CONSTRAINT "negotiation_issue_decision_fk" FOREIGN KEY ("project_id","decision_id") REFERENCES "public"."decision"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_issue" ADD CONSTRAINT "negotiation_issue_document_fk" FOREIGN KEY ("project_id","document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_nda_document_fk" FOREIGN KEY ("project_id","nda_document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_outreach_request_fk" FOREIGN KEY ("project_id","outreach_request_id") REFERENCES "public"."approval_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_nda_request_fk" FOREIGN KEY ("project_id","nda_request_id") REFERENCES "public"."approval_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_assessment_entry" ADD CONSTRAINT "partner_assessment_entry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_assessment_entry" ADD CONSTRAINT "partner_assessment_partner_fk" FOREIGN KEY ("project_id","partner_id") REFERENCES "public"."partner"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_assessment_entry" ADD CONSTRAINT "partner_assessment_proposal_fk" FOREIGN KEY ("project_id","proposal_id") REFERENCES "public"."partner_proposal"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_assessment_entry" ADD CONSTRAINT "partner_assessment_document_fk" FOREIGN KEY ("project_id","document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_conflict" ADD CONSTRAINT "partner_conflict_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_conflict" ADD CONSTRAINT "partner_conflict_partner_fk" FOREIGN KEY ("project_id","partner_id") REFERENCES "public"."partner"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_contact" ADD CONSTRAINT "partner_contact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_contact" ADD CONSTRAINT "partner_contact_partner_fk" FOREIGN KEY ("project_id","partner_id") REFERENCES "public"."partner"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_criteria_set" ADD CONSTRAINT "partner_criteria_set_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_proposal" ADD CONSTRAINT "partner_proposal_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_proposal" ADD CONSTRAINT "partner_proposal_partner_fk" FOREIGN KEY ("project_id","partner_id") REFERENCES "public"."partner"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_proposal" ADD CONSTRAINT "partner_proposal_document_fk" FOREIGN KEY ("project_id","document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_proposal" ADD CONSTRAINT "partner_proposal_supersedes_fk" FOREIGN KEY ("project_id","supersedes_proposal_id") REFERENCES "public"."partner_proposal"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_room" ADD CONSTRAINT "partner_room_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_room" ADD CONSTRAINT "partner_room_partner_fk" FOREIGN KEY ("project_id","partner_id") REFERENCES "public"."partner"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_close_obligation" ADD CONSTRAINT "post_close_obligation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_close_obligation" ADD CONSTRAINT "post_close_obligation_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_close_obligation" ADD CONSTRAINT "post_close_obligation_closing_fk" FOREIGN KEY ("project_id","closing_id") REFERENCES "public"."closing"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_close_obligation" ADD CONSTRAINT "post_close_obligation_escalation_fk" FOREIGN KEY ("project_id","escalation_id") REFERENCES "public"."escalation"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_closure" ADD CONSTRAINT "program_closure_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_closure" ADD CONSTRAINT "program_closure_g7_fk" FOREIGN KEY ("project_id","g7_assessment_id") REFERENCES "public"."gate_assessment"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_closure" ADD CONSTRAINT "program_closure_request_fk" FOREIGN KEY ("project_id","approval_request_id") REFERENCES "public"."approval_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_access_event" ADD CONSTRAINT "room_access_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_access_event" ADD CONSTRAINT "room_access_event_room_fk" FOREIGN KEY ("project_id","room_id") REFERENCES "public"."partner_room"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_access_event" ADD CONSTRAINT "room_access_event_grant_fk" FOREIGN KEY ("project_id","grant_id") REFERENCES "public"."room_grant"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_access_event" ADD CONSTRAINT "room_access_event_disclosure_fk" FOREIGN KEY ("project_id","disclosure_id") REFERENCES "public"."room_disclosure"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_access_event" ADD CONSTRAINT "room_access_event_dd_request_fk" FOREIGN KEY ("project_id","diligence_request_id") REFERENCES "public"."diligence_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_access_event" ADD CONSTRAINT "room_access_event_version_fk" FOREIGN KEY ("project_id","document_version_id") REFERENCES "public"."document_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_disclosure" ADD CONSTRAINT "room_disclosure_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_disclosure" ADD CONSTRAINT "room_disclosure_room_fk" FOREIGN KEY ("project_id","room_id") REFERENCES "public"."partner_room"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_disclosure" ADD CONSTRAINT "room_disclosure_document_fk" FOREIGN KEY ("project_id","document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_disclosure" ADD CONSTRAINT "room_disclosure_version_fk" FOREIGN KEY ("project_id","document_version_id") REFERENCES "public"."document_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_disclosure" ADD CONSTRAINT "room_disclosure_dd_request_fk" FOREIGN KEY ("project_id","diligence_request_id") REFERENCES "public"."diligence_request"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_grant" ADD CONSTRAINT "room_grant_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_grant" ADD CONSTRAINT "room_grant_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_grant" ADD CONSTRAINT "room_grant_room_fk" FOREIGN KEY ("project_id","room_id") REFERENCES "public"."partner_room"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_room_fk" FOREIGN KEY ("project_id","room_id") REFERENCES "public"."partner_room"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_room_fk" FOREIGN KEY ("project_id","room_id") REFERENCES "public"."partner_room"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_document_fk" FOREIGN KEY ("project_id","document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_version_fk" FOREIGN KEY ("project_id","document_version_id") REFERENCES "public"."document_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_document_fk" FOREIGN KEY ("project_id","document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_room_fk" FOREIGN KEY ("project_id","room_id") REFERENCES "public"."partner_room"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_conflict_fk" FOREIGN KEY ("project_id","conflict_with_link_id") REFERENCES "public"."evidence_link"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_document_fk" FOREIGN KEY ("project_id","document_id") REFERENCES "public"."document"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_version_fk" FOREIGN KEY ("project_id","document_version_id") REFERENCES "public"."document_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_room_fk" FOREIGN KEY ("project_id","room_id") REFERENCES "public"."partner_room"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_claim" ADD CONSTRAINT "source_claim_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_claim" ADD CONSTRAINT "source_claim_conflict_fk" FOREIGN KEY ("project_id","conflict_with_claim_id") REFERENCES "public"."source_claim"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_claim" ADD CONSTRAINT "source_claim_source_fk" FOREIGN KEY ("project_id","source_id") REFERENCES "public"."source_record"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_claim" ADD CONSTRAINT "source_claim_verification_source_fk" FOREIGN KEY ("project_id","verification_source_id") REFERENCES "public"."source_record"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_supersedes_fk" FOREIGN KEY ("project_id","supersedes_source_id") REFERENCES "public"."source_record"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_docver_fk" FOREIGN KEY ("project_id","document_version_id") REFERENCES "public"."document_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_source_fk" FOREIGN KEY ("project_id","source_id") REFERENCES "public"."source_record"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_docver_fk" FOREIGN KEY ("project_id","document_version_id") REFERENCES "public"."document_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_batch_fk" FOREIGN KEY ("project_id","batch_id") REFERENCES "public"."import_batch"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_export" ADD CONSTRAINT "report_export_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_export" ADD CONSTRAINT "report_export_snapshot_fk" FOREIGN KEY ("project_id","snapshot_id") REFERENCES "public"."report_snapshot"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshot" ADD CONSTRAINT "report_snapshot_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshot" ADD CONSTRAINT "report_snapshot_baseline_fk" FOREIGN KEY ("project_id","baseline_version_id") REFERENCES "public"."baseline_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshot" ADD CONSTRAINT "report_snapshot_previous_fk" FOREIGN KEY ("project_id","previous_snapshot_id") REFERENCES "public"."report_snapshot"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_ai_proposal_fk" FOREIGN KEY ("project_id","ai_proposal_id") REFERENCES "public"."ai_proposal"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_approval" ADD CONSTRAINT "ai_action_approval_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_approval" ADD CONSTRAINT "ai_action_approval_proposal_fk" FOREIGN KEY ("project_id","proposal_id") REFERENCES "public"."ai_proposal"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_derived_artifact" ADD CONSTRAINT "ai_derived_artifact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_project_settings" ADD CONSTRAINT "ai_project_settings_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposal" ADD CONSTRAINT "ai_proposal_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposal" ADD CONSTRAINT "ai_proposal_run_fk" FOREIGN KEY ("project_id","run_id") REFERENCES "public"."ai_run"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_org_email_uq" ON "app_user" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_oidc_uq" ON "app_user" USING btree ("oidc_issuer","oidc_subject") WHERE "app_user"."oidc_subject" is not null;--> statement-breakpoint
CREATE INDEX "org_role_user_idx" ON "org_role_assignment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_holiday_uq" ON "calendar_holiday" USING btree ("project_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "project_org_code_uq" ON "project" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "project_program_idx" ON "project" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_entity_uq" ON "project_entity" USING btree ("project_id","legal_entity_id","role");--> statement-breakpoint
CREATE INDEX "project_membership_user_idx" ON "project_membership" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_template_org_key_uq" ON "project_template" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "template_version_uq" ON "project_template_version" USING btree ("template_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "site_code_uq" ON "site" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "workstream_code_uq" ON "workstream" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "assumption_code_uq" ON "assumption" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "baseline_version_uq" ON "baseline_version" USING btree ("project_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "baseline_one_proposed_uq" ON "baseline_version" USING btree ("project_id") WHERE status = 'proposed';--> statement-breakpoint
CREATE UNIQUE INDEX "baseline_one_approved_uq" ON "baseline_version" USING btree ("project_id") WHERE status = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "change_request_code_uq" ON "change_request" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "cross_project_dependency_other_idx" ON "cross_project_dependency" USING btree ("other_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliverable_code_uq" ON "deliverable" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "dependency_uq" ON "dependency" USING btree ("project_id","predecessor_id","successor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_code_uq" ON "issue" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_code_uq" ON "milestone" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "raci_entity_idx" ON "raci_assignment" USING btree ("project_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rag_override_pending_uq" ON "rag_override" USING btree ("project_id","entity_type","entity_id") WHERE reviewed_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "raid_dependency_code_uq" ON "raid_dependency" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "record_dependency_uq" ON "record_dependency" USING btree ("project_id","successor_id","predecessor_id");--> statement-breakpoint
CREATE INDEX "record_dependency_successor_idx" ON "record_dependency" USING btree ("project_id","successor_type","successor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_code_uq" ON "risk" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "task_wbs_uq" ON "task" USING btree ("project_id","wbs_code");--> statement-breakpoint
CREATE INDEX "task_ws_idx" ON "task" USING btree ("workstream_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_item_code_uq" ON "action_item" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "approval_request_subject_idx" ON "approval_request" USING btree ("project_id","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_uq" ON "attendance" USING btree ("meeting_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "authority_matrix_version_uq" ON "authority_matrix_version" USING btree ("committee_id","version_no");--> statement-breakpoint
CREATE INDEX "committee_membership_committee_idx" ON "committee_membership" USING btree ("committee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_code_uq" ON "decision" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "decision_status_idx" ON "decision" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_code_uq" ON "escalation" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_number_uq" ON "meeting" USING btree ("committee_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "recusal_uq" ON "recusal" USING btree ("decision_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vote_uq" ON "vote" USING btree ("decision_id","user_id","round");--> statement-breakpoint
CREATE UNIQUE INDEX "criterion_assessment_uq" ON "criterion_assessment" USING btree ("assessment_id","criterion_id");--> statement-breakpoint
CREATE INDEX "gate_assessment_gate_idx" ON "gate_assessment" USING btree ("gate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gate_criterion_key_uq" ON "gate_criterion" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "gate_definition_key_uq" ON "gate_definition" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "status_dimension_uq" ON "status_dimension" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "waiver_target_idx" ON "waiver" USING btree ("project_id","target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_code_uq" ON "agreement" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_version_uq" ON "agreement_version" USING btree ("agreement_id","version_label");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_code_uq" ON "consent" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "cutover_decision_record_plan_idx" ON "cutover_decision_record" USING btree ("cutover_plan_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cutover_plan_code_uq" ON "cutover_plan" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "operating_model_definition_uq" ON "operating_model_definition" USING btree ("project_id","version_label");--> statement-breakpoint
CREATE UNIQUE INDEX "perimeter_category_review_uq" ON "perimeter_category_review" USING btree ("project_id","category");--> statement-breakpoint
CREATE INDEX "perimeter_impact_item_idx" ON "perimeter_impact_assessment" USING btree ("perimeter_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "perimeter_item_code_uq" ON "perimeter_item" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "perimeter_item_status_idx" ON "perimeter_item" USING btree ("project_id","transfer_status");--> statement-breakpoint
CREATE UNIQUE INDEX "perimeter_version_no_uq" ON "perimeter_version" USING btree ("project_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "perimeter_version_one_proposed_uq" ON "perimeter_version" USING btree ("project_id") WHERE status = 'proposed';--> statement-breakpoint
CREATE UNIQUE INDEX "perimeter_version_one_approved_uq" ON "perimeter_version" USING btree ("project_id") WHERE status = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "readiness_check_code_uq" ON "readiness_check" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "readiness_check_status_idx" ON "readiness_check" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "readiness_test_run_seq_uq" ON "readiness_test_run" USING btree ("readiness_check_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "regulatory_requirement_code_uq" ON "regulatory_requirement" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "transfer_record_item_idx" ON "transfer_record" USING btree ("perimeter_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tsa_service_code_uq" ON "tsa_service" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "tsa_service_status_idx" ON "tsa_service" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "benefit_code_uq" ON "benefit" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_line_code_uq" ON "budget_line" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_line_tsa_uq" ON "budget_line" USING btree ("project_id","tsa_service_id") WHERE "budget_line"."tsa_service_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_model_code_uq" ON "financial_model" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_model_version_uq" ON "financial_model_version" USING btree ("project_id","model_id","model_case","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_snapshot_line_uq" ON "financial_snapshot" USING btree ("project_id","kind","line_ref","period");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_snapshot_tsa_uq" ON "financial_snapshot" USING btree ("project_id","kind","tsa_service_id","period") WHERE "financial_snapshot"."tsa_service_id" is not null;--> statement-breakpoint
CREATE INDEX "financial_snapshot_period_idx" ON "financial_snapshot" USING btree ("project_id","kind","period");--> statement-breakpoint
CREATE UNIQUE INDEX "intercompany_reconciliation_code_uq" ON "intercompany_reconciliation" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_key_uq" ON "kpi" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "kpi_observation_idx" ON "kpi_observation" USING btree ("kpi_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "closing_seq_uq" ON "closing" USING btree ("project_id","kind","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "closing_code_uq" ON "closing" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "closing_condition_ref_uq" ON "closing_condition" USING btree ("project_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "closing_deliverable_code_uq" ON "closing_deliverable" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_scenario_code_uq" ON "deal_scenario" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_scenario_version_uq" ON "deal_scenario_version" USING btree ("scenario_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "diligence_finding_code_uq" ON "diligence_finding" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "diligence_request_number_uq" ON "diligence_request" USING btree ("project_id","room_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "funds_flow_item_code_uq" ON "funds_flow_item" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "negotiation_issue_code_uq" ON "negotiation_issue" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_code_uq" ON "partner" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "partner_assessment_partner_idx" ON "partner_assessment_entry" USING btree ("project_id","partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_contact_active_uq" ON "partner_contact" USING btree ("project_id","user_id") WHERE "partner_contact"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_criteria_set_project_uq" ON "partner_criteria_set" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_proposal_code_uq" ON "partner_proposal" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "post_close_obligation_code_uq" ON "post_close_obligation" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "program_closure_project_uq" ON "program_closure" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "room_access_event_room_idx" ON "room_access_event" USING btree ("project_id","room_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "room_disclosure_live_uq" ON "room_disclosure" USING btree ("room_id","document_version_id") WHERE "room_disclosure"."status" in ('requested', 'released');--> statement-breakpoint
CREATE INDEX "room_grant_user_idx" ON "room_grant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_project_idx" ON "document" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "document_chunk_tsv_idx" ON "document_chunk" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "document_chunk_doc_idx" ON "document_chunk" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_version_uq" ON "document_version" USING btree ("document_id","version_no");--> statement-breakpoint
CREATE INDEX "evidence_link_target_idx" ON "evidence_link" USING btree ("project_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "source_claim_target_idx" ON "source_claim" USING btree ("project_id","target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_record_code_uq" ON "source_record" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "import_row_uq" ON "import_row" USING btree ("batch_id","row_no");--> statement-breakpoint
CREATE INDEX "report_snapshot_kind_idx" ON "report_snapshot" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "audit_checkpoint_org_idx" ON "audit_checkpoint" USING btree ("org_id","chain_pos");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_event_id_uq" ON "audit_event" USING btree ("id");--> statement-breakpoint
CREATE INDEX "audit_event_project_idx" ON "audit_event" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_entity_idx" ON "audit_event" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_event_chain_uq" ON "audit_event" USING btree ("org_id","chain_pos");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_record_idem_uq" ON "delivery_record" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "job_idempotency_uq" ON "job" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "job_ready_idx" ON "job" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_uq" ON "notification" USING btree ("user_id","dedupe_key") WHERE "notification"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_event" USING btree ("created_at") WHERE "outbox_event"."dispatched_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_dedupe_uq" ON "outbox_event" USING btree ("dedupe_key") WHERE "outbox_event"."dedupe_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "record_version_uq" ON "record_version" USING btree ("entity_type","entity_id","version_no");--> statement-breakpoint
CREATE INDEX "scheduled_job_due_idx" ON "scheduled_job" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "ai_derived_artifact_idx" ON "ai_derived_artifact" USING btree ("project_id","kind","acl_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_project_settings_uq" ON "ai_project_settings" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_proposal_idem_uq" ON "ai_proposal" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ai_run_project_idx" ON "ai_run" USING btree ("project_id","created_at");