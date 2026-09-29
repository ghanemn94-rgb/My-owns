/**
 * Canonical state vocabularies shared by the database (pgEnum), contracts (zod), API and web.
 * Changing a list here requires a migration (lead owns migrations) — see CLAUDE.md.
 */

export const VERIFICATION_STATUSES = [
  'confirmed',
  'historical_unverified',
  'proposed',
  'assumed',
  'conflicting',
  'unknown',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted', 'strictly_confidential'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const ROLE_KEYS = [
  'platform_admin',
  'portfolio_admin',
  'sponsor',
  'committee_chair',
  'secretary_cpmo',
  'project_manager',
  'workstream_lead',
  'contributor',
  'functional_approver',
  'finance_restricted',
  'legal_restricted',
  'clean_team',
  'auditor',
  'external_partner_limited',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const SCOPE_TYPES = ['organization', 'portfolio', 'project', 'workstream', 'partner_room'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const TEMPLATE_KINDS = [
  'dc_carveout',
  'general_transformation',
  'strategy',
  'technology',
  'transaction_other',
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_VERSION_STATUSES = ['draft', 'published', 'retired'] as const;
export const TEMPLATE_MIGRATION_STATUSES = ['proposed', 'approved', 'applied', 'rejected'] as const;

export const PROJECT_STATUSES = ['setup', 'active', 'on_hold', 'closing', 'closed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ENTITY_KINDS = ['parent', 'newco', 'partner', 'jv_company', 'counterparty', 'advisor', 'other'] as const;
export const INCORPORATION_STATUSES = ['incorporated', 'incorporation_in_progress', 'unconfirmed', 'not_applicable'] as const;
export type IncorporationStatus = (typeof INCORPORATION_STATUSES)[number];

// ---------------------------------------------------------------------------------------------------------
// Planning
export const TASK_STATUSES = [
  'draft', // template-generated / proposed, not yet confirmed by the PM (spec §6 "Initial status is Draft/Unverified")
  'not_started',
  'in_progress',
  'blocked',
  'submitted_for_acceptance',
  'accepted',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const MILESTONE_STATUSES = ['planned', 'at_risk', 'achieved_pending_evidence', 'achieved_verified', 'missed', 'cancelled'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const DELIVERABLE_STATUSES = ['planned', 'in_progress', 'submitted', 'accepted', 'rejected', 'cancelled'] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

export const DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
/** Only FS is exposed until SS/FF/SF are individually tested (spec §9). */
export const SUPPORTED_DEPENDENCY_TYPES = ['FS'] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export const SCHEDULE_NODE_TYPES = ['task', 'milestone'] as const;
export type ScheduleNodeType = (typeof SCHEDULE_NODE_TYPES)[number];

export const BASELINE_STATUSES = ['draft', 'proposed', 'approved', 'superseded', 'rejected'] as const;
export type BaselineStatus = (typeof BASELINE_STATUSES)[number];

export const CHANGE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'withdrawn',
  'implemented',
] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const RAID_STATUSES = ['open', 'monitoring', 'escalated', 'mitigated', 'closed', 'cancelled'] as const;
export type RaidStatus = (typeof RAID_STATUSES)[number];
export const RAID_KINDS = ['risk', 'issue', 'assumption', 'dependency'] as const;
export type RaidKind = (typeof RAID_KINDS)[number];

export const UPDATE_STATUSES = ['draft', 'submitted', 'returned', 'accepted'] as const;
export type UpdateStatus = (typeof UPDATE_STATUSES)[number];

export const RAG_STATUSES = ['green', 'amber', 'red', 'unknown', 'stale', 'not_updated'] as const;
export type RagStatus = (typeof RAG_STATUSES)[number];

export const RACI_VALUES = ['R', 'A', 'C', 'I'] as const;

// ---------------------------------------------------------------------------------------------------------
// Governance
export const COMMITTEE_KINDS = ['program_steering', 'newco_board', 'jv_board', 'other'] as const;
export const COMMITTEE_STATUSES = ['draft', 'charter_approved', 'active', 'dissolved'] as const;
export const COMMITTEE_MEMBER_ROLES = ['chair', 'sponsor', 'secretary', 'voting_member', 'advisory_member', 'guest'] as const;
export type CommitteeMemberRole = (typeof COMMITTEE_MEMBER_ROLES)[number];

export const AUTHORITY_MATRIX_STATUSES = ['draft', 'approved', 'superseded'] as const;

export const MEETING_STATUSES = [
  'planned',
  'agenda_published',
  'in_session',
  'held',
  'minutes_draft',
  'minutes_approved',
  'cancelled',
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const AGENDA_ITEM_KINDS = ['decision', 'information', 'discussion', 'escalation'] as const;
export const AGENDA_SCREENING_STATUSES = ['requested', 'accepted', 'returned', 'deferred', 'withdrawn'] as const;

export const ATTENDANCE_STATUSES = ['present', 'remote', 'absent', 'apologies', 'delegated'] as const;

export const DECISION_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'recommended',
  'approved',
  'rejected',
  'deferred',
  'superseded',
  'implementation_pending',
  'implemented_verified',
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** Whether an outcome is final within the committee mandate or needs a higher authority (spec §4.2). */
export const DECISION_AUTHORITY_OUTCOMES = ['within_mandate', 'pending_external_authority', 'not_assessed'] as const;
export type DecisionAuthorityOutcome = (typeof DECISION_AUTHORITY_OUTCOMES)[number];

export const VOTE_CHOICES = ['approve', 'reject', 'abstain'] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

export const ACTION_ITEM_STATUSES = ['open', 'in_progress', 'done_pending_verification', 'verified_closed', 'cancelled'] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];

export const ESCALATION_STATUSES = ['open', 'decision_requested', 'resolved', 'withdrawn'] as const;

export const APPROVAL_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'invalidated', 'withdrawn'] as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number];

// ---------------------------------------------------------------------------------------------------------
// Gates
export const GATE_ASSESSMENT_STATUSES = [
  'not_started',
  'in_assessment',
  'ready_for_decision',
  'approved',
  'approved_with_exceptions',
  'rejected',
  'reopened',
  'superseded',
] as const;
export type GateAssessmentStatus = (typeof GATE_ASSESSMENT_STATUSES)[number];

export const CRITERION_STATUSES = ['unmet', 'evidence_submitted', 'met', 'waived', 'not_applicable', 'conflicting'] as const;
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export const WAIVER_STATUSES = ['requested', 'approved', 'rejected', 'withdrawn'] as const;

export const STATUS_DIMENSION_KEYS = ['incorporation', 'perimeter_transfer', 'operational_readiness', 'jv_transaction'] as const;
export type StatusDimensionKey = (typeof STATUS_DIMENSION_KEYS)[number];

// ---------------------------------------------------------------------------------------------------------
// Carve-out
export const PERIMETER_ITEM_TYPES = [
  'site',
  'asset',
  'liability',
  'receivable',
  'payable',
  'contract',
  'employee_group',
  'data',
  'ip',
  'license',
  'financing',
  'guarantee',
  'shared_service',
  'other',
] as const;
export type PerimeterItemType = (typeof PERIMETER_ITEM_TYPES)[number];

export const PERIMETER_DISPOSITIONS = ['included', 'excluded', 'shared', 'pending'] as const;
export type PerimeterDisposition = (typeof PERIMETER_DISPOSITIONS)[number];

export const TRANSFER_STATUSES = [
  'not_started',
  'planned',
  'in_progress',
  'transferred_pending_evidence',
  'transferred_verified',
  'blocked',
  'not_applicable',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const AGREEMENT_STAGES = [
  'identified',
  'drafting',
  'negotiating',
  'agreed_in_principle',
  'signed',
  'effective',
  'terminated',
  'expired',
] as const;
export type AgreementStage = (typeof AGREEMENT_STAGES)[number];

export const CONTRACT_TRANSFER_CLASSES = [
  'transferable',
  'consent_required',
  'novation_required',
  'retain',
  'interim_arrangement',
  'unknown',
] as const;
export type ContractTransferClass = (typeof CONTRACT_TRANSFER_CLASSES)[number];

export const CONSENT_STATUSES = ['not_requested', 'requested', 'granted', 'conditional', 'refused', 'not_required'] as const;

export const APPROVAL_REGISTER_CATEGORIES = ['regulatory', 'external_party', 'internal'] as const;
export const APPLICABILITY_STATUSES = ['assessment_pending', 'applicable', 'not_applicable'] as const;
export const REQUIREMENT_STATUSES = [
  'not_started',
  'in_preparation',
  'submitted',
  'granted',
  'granted_with_conditions',
  'refused',
  'expired',
  'withdrawn',
] as const;

// ---------------------------------------------------------------------------------------------------------
// Readiness / TSA
export const TSA_STATUSES = [
  'proposed',
  'negotiating',
  'approved',
  'active',
  'exit_in_progress',
  'exit_accepted',
  'extended',
  'breached',
  'expired_unresolved',
] as const;
export type TsaStatus = (typeof TSA_STATUSES)[number];

export const READINESS_AREAS = [
  'power',
  'cooling',
  'connectivity',
  'physical_access',
  'operations',
  'maintenance',
  'spares',
  'noc',
  'incident_management',
  'billing',
  'support',
  'employees',
  'security',
  'backup_recovery',
  'other',
] as const;
export type ReadinessArea = (typeof READINESS_AREAS)[number];

export const READINESS_STATUSES = ['not_started', 'in_progress', 'passed', 'failed', 'waived', 'not_applicable'] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

export const GO_NO_GO = ['pending', 'go', 'no_go'] as const;
export type GoNoGo = (typeof GO_NO_GO)[number];

export const CUTOVER_STATUSES = ['planning', 'rehearsal', 'ready_for_decision', 'approved_go', 'no_go', 'executed', 'accepted', 'rolled_back'] as const;

// ---------------------------------------------------------------------------------------------------------
// Finance
export const FINANCIAL_KINDS = ['baseline', 'forecast', 'actual'] as const;
export const FINANCIAL_CATEGORIES = [
  'one_off_separation',
  'recurring_standalone',
  'stranded',
  'tsa_charge',
  'revenue',
  'capex',
  'opex',
  'working_capital',
  'opening_balance',
  'intercompany',
  'other',
] as const;
export type FinancialCategory = (typeof FINANCIAL_CATEGORIES)[number];
export const APPROVAL_STATES = ['proposed', 'under_review', 'approved', 'rejected', 'superseded'] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];
export const MODEL_KINDS = ['business_plan', 'valuation'] as const;
export const MODEL_CASES = ['base', 'downside', 'upside'] as const;
export const VALUE_BASES = ['enterprise_value', 'equity_value', 'other'] as const;
export const BENEFIT_STATUSES = ['proposed', 'approved', 'tracking', 'realized_unverified', 'realized_verified', 'cancelled'] as const;
export const KPI_DIRECTIONS = ['higher_is_better', 'lower_is_better'] as const;

// ---------------------------------------------------------------------------------------------------------
// JV / DD
export const PARTNER_STAGES = [
  'identified',
  'approved_for_contact',
  'nda',
  'materials_access',
  'dd',
  'proposal',
  'negotiation',
  'signing',
  'closing',
  'withdrawn',
] as const;
export type PartnerStage = (typeof PARTNER_STAGES)[number];

export const NDA_STATUSES = ['none', 'drafting', 'executed', 'expired', 'terminated'] as const;
export const DD_RELEASE_STATUSES = ['draft', 'in_review', 'approved_for_release', 'released', 'withheld'] as const;
export type DdReleaseStatus = (typeof DD_RELEASE_STATUSES)[number];
export const MATERIALITY = ['low', 'medium', 'high', 'critical'] as const;
export const FINDING_STATUSES = ['open', 'remediation_planned', 'remediated', 'accepted_risk', 'closed'] as const;
export const NEGOTIATION_ISSUE_STATUSES = ['open', 'proposed_resolution', 'agreed', 'escalated', 'closed'] as const;

export const CLOSING_KINDS = ['signing', 'closing'] as const;
export type ClosingKind = (typeof CLOSING_KINDS)[number];
export const CLOSING_STATUSES = ['planned', 'in_preparation', 'ready_for_confirmation', 'confirmed', 'aborted'] as const;
export type ClosingStatus = (typeof CLOSING_STATUSES)[number];

export const CONDITION_KINDS = ['condition_precedent', 'condition_subsequent'] as const;
export const CONDITION_STATUSES = ['open', 'evidence_submitted', 'verified', 'waived', 'failed', 'lapsed'] as const;
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];

export const CLOSING_DELIVERABLE_STATUSES = ['pending', 'delivered', 'verified', 'not_required'] as const;
export const POST_CLOSE_KINDS = ['condition_subsequent', 'obligation', 'appointment', 'governance', 'benefit', 'handover'] as const;
export const POST_CLOSE_STATUSES = ['open', 'in_progress', 'completed_pending_evidence', 'verified', 'overdue', 'cancelled'] as const;
export const FUNDS_FLOW_STATUSES = ['planned', 'confirmed_by_finance', 'reported_settled', 'cancelled'] as const;

// ---------------------------------------------------------------------------------------------------------
// Documents / sources
export const DOCUMENT_KINDS = [
  'charter',
  'minutes',
  'decision_paper',
  'agreement',
  'evidence',
  'report',
  'runbook',
  'financial_model',
  'regulatory',
  'dd_material',
  'source_upload',
  'other',
] as const;
export const SCAN_STATUSES = ['pending', 'clean', 'quarantined', 'rejected', 'not_scanned'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];
export const EVIDENCE_LINK_STATUSES = ['active', 'superseded', 'conflicting', 'rejected'] as const;
export const SOURCE_TYPES = ['image', 'excel', 'csv', 'minutes', 'pdf', 'docx', 'manual_entry', 'system'] as const;
export const EXTRACTION_STATUSES = ['not_performed', 'performed', 'partial', 'failed'] as const;

// ---------------------------------------------------------------------------------------------------------
// Reporting / imports / integrations / notifications
export const REPORT_KINDS = [
  'executive_summary',
  'committee_pack',
  'workstream_weekly',
  'look_ahead',
  'day1_readiness',
  'tsa_exit',
  'jv_closing',
  'health_data_quality',
  'minutes',
  'register_export',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const EXPORT_FORMATS = ['pdf', 'xlsx', 'docx', 'pptx', 'csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const IMPORT_STATUSES = [
  'uploaded',
  'mapped',
  'validated',
  'approved',
  'applied',
  'rolled_back',
  'rejected',
  'failed',
] as const;
export const IMPORT_ROW_ACTIONS = ['create', 'update', 'skip', 'conflict', 'error'] as const;

export const INTEGRATION_KINDS = [
  'oidc',
  'saml_gateway',
  'smtp',
  'teams',
  'sharepoint',
  'object_storage',
  'llm_provider',
  'power_bi',
  'vdr',
  'erp',
  'hr',
  'itsm',
  'dcim',
  'siem',
] as const;
export const INTEGRATION_DIRECTIONS = ['read', 'write', 'send'] as const;
/** Honest connection states — `verified` only after a real connectivity check (spec §17). */
export const INTEGRATION_STATUSES = ['not_configured', 'configured_unverified', 'verified', 'failed', 'disabled', 'simulated'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'teams', 'sms'] as const;
export const DELIVERY_STATUSES = ['queued', 'sending', 'sent', 'uncertain', 'suppressed', 'failed', 'disabled', 'cancelled'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

// ---------------------------------------------------------------------------------------------------------
// AI runtime
export const AI_MODES = ['off', 'advisory', 'assisted', 'autopilot'] as const;
export type AiMode = (typeof AI_MODES)[number];
export const AI_PROVIDERS = ['off', 'mock', 'openai_compatible', 'anthropic'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const AI_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'budget_exceeded', 'skipped'] as const;
export const AI_PROPOSAL_STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'invalidated',
  'executing',
  'executed',
  'failed',
  'expired',
  'cancelled',
] as const;
export type AiProposalStatus = (typeof AI_PROPOSAL_STATUSES)[number];

// ---------------------------------------------------------------------------------------------------------
// Jobs / outbox / audit
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const ACTOR_KINDS = ['user', 'service', 'system'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const OUTBOX_EVENT_TYPES = [
  'task.overdue',
  'source.updated',
  'approval.pending',
  'cp.changed',
  'tsa.expiring',
  'gate.blocked',
  'decision.status_changed',
  'evidence.changed',
  'perimeter.changed',
  'permission.changed',
  'document.changed',
  'report.generated',
  'baseline.approved',
  'change_request.decided',
  'readiness.changed',
] as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];
