import { sql } from 'drizzle-orm';
import {
  pgEnum,
  uuid,
  timestamp,
  integer,
  boolean,
  numeric,
  varchar,
  customType,
  ForeignKeyBuilder,
  type AnyPgColumn,
  type PgColumn,
} from 'drizzle-orm/pg-core';
import * as E from '@hub/domain';

// ---------------------------------------------------------------------------------------------------------
// Column helpers

export const pk = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
export const orgIdCol = () => uuid('org_id').notNull();
export const projectIdCol = () => uuid('project_id').notNull();
export const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
export const updatedAt = () => timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
export const createdBy = () => uuid('created_by');
export const versionCol = () => integer('version').notNull().default(1);
export const isDemo = () => boolean('is_demo').notNull().default(false);
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Money = numeric(20,4) + ISO currency + unit scale. Never floats. */
const amountBuilder = (name: string) => numeric(name, { precision: 20, scale: 4 });
const currencyBuilder = (name: string) => varchar(name, { length: 3 });
const unitScaleBuilder = (name: string) => integer(name);
/** Money column triple with typed keys: `<prefix>Amount`, `<prefix>Currency`, `<prefix>UnitScale`. */
export type MoneyCols<P extends string> = { [K in `${P}Amount`]: ReturnType<typeof amountBuilder> } & {
  [K in `${P}Currency`]: ReturnType<typeof currencyBuilder>;
} & { [K in `${P}UnitScale`]: ReturnType<typeof unitScaleBuilder> };
export const moneyCols = <P extends string>(prefix: P): MoneyCols<P> =>
  ({
    [`${prefix}Amount`]: amountBuilder(`${prefix}_amount`),
    [`${prefix}Currency`]: currencyBuilder(`${prefix}_currency`),
    [`${prefix}UnitScale`]: unitScaleBuilder(`${prefix}_unit_scale`),
  }) as MoneyCols<P>;

export type FkTarget = { projectId: AnyPgColumn; id: AnyPgColumn };

/**
 * Composite FK (project_id, <col>) → target(project_id, id): prevents cross-project linking (spec §14).
 * The target may be a thunk so that mutually referencing tables (e.g. meeting ↔ decision) type-check; the FK is
 * resolved lazily when drizzle builds the table config.
 */
export function projectFk(name: string, projectIdColumn: AnyPgColumn, column: AnyPgColumn, target: FkTarget | (() => FkTarget)): ForeignKeyBuilder {
  return new ForeignKeyBuilder(() => {
    const t = typeof target === 'function' ? target() : target;
    return { name, columns: [projectIdColumn as PgColumn, column as PgColumn], foreignColumns: [t.projectId as PgColumn, t.id as PgColumn] };
  });
}

export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// ---------------------------------------------------------------------------------------------------------
// Enums (single source: packages/domain/src/enums.ts)

export const verificationStatus = pgEnum('verification_status', E.VERIFICATION_STATUSES);
export const classification = pgEnum('classification', E.CLASSIFICATIONS);
export const roleKey = pgEnum('role_key', E.ROLE_KEYS);
export const scopeType = pgEnum('scope_type', E.SCOPE_TYPES);
export const templateKind = pgEnum('template_kind', E.TEMPLATE_KINDS);
export const templateVersionStatus = pgEnum('template_version_status', E.TEMPLATE_VERSION_STATUSES);
export const templateMigrationStatus = pgEnum('template_migration_status', E.TEMPLATE_MIGRATION_STATUSES);
export const projectStatus = pgEnum('project_status', E.PROJECT_STATUSES);
export const entityKind = pgEnum('entity_kind', E.ENTITY_KINDS);
export const incorporationStatus = pgEnum('incorporation_status', E.INCORPORATION_STATUSES);

export const taskStatus = pgEnum('task_status', E.TASK_STATUSES);
export const milestoneStatus = pgEnum('milestone_status', E.MILESTONE_STATUSES);
export const deliverableStatus = pgEnum('deliverable_status', E.DELIVERABLE_STATUSES);
export const dependencyType = pgEnum('dependency_type', E.DEPENDENCY_TYPES);
export const scheduleNodeType = pgEnum('schedule_node_type', E.SCHEDULE_NODE_TYPES);
export const baselineStatus = pgEnum('baseline_status', E.BASELINE_STATUSES);
export const changeRequestStatus = pgEnum('change_request_status', E.CHANGE_REQUEST_STATUSES);
export const raidStatus = pgEnum('raid_status', E.RAID_STATUSES);
export const updateStatus = pgEnum('update_status', E.UPDATE_STATUSES);
export const ragStatus = pgEnum('rag_status', E.RAG_STATUSES);
export const raciValue = pgEnum('raci_value', E.RACI_VALUES);

export const committeeKind = pgEnum('committee_kind', E.COMMITTEE_KINDS);
export const committeeStatus = pgEnum('committee_status', E.COMMITTEE_STATUSES);
export const committeeMemberRole = pgEnum('committee_member_role', E.COMMITTEE_MEMBER_ROLES);
export const authorityMatrixStatus = pgEnum('authority_matrix_status', E.AUTHORITY_MATRIX_STATUSES);
export const meetingStatus = pgEnum('meeting_status', E.MEETING_STATUSES);
export const agendaItemKind = pgEnum('agenda_item_kind', E.AGENDA_ITEM_KINDS);
export const agendaScreeningStatus = pgEnum('agenda_screening_status', E.AGENDA_SCREENING_STATUSES);
export const attendanceStatus = pgEnum('attendance_status', E.ATTENDANCE_STATUSES);
export const decisionStatus = pgEnum('decision_status', E.DECISION_STATUSES);
export const decisionAuthorityOutcome = pgEnum('decision_authority_outcome', E.DECISION_AUTHORITY_OUTCOMES);
export const voteChoice = pgEnum('vote_choice', E.VOTE_CHOICES);
export const actionItemStatus = pgEnum('action_item_status', E.ACTION_ITEM_STATUSES);
export const escalationStatus = pgEnum('escalation_status', E.ESCALATION_STATUSES);
export const approvalRequestStatus = pgEnum('approval_request_status', E.APPROVAL_REQUEST_STATUSES);

export const gateAssessmentStatus = pgEnum('gate_assessment_status', E.GATE_ASSESSMENT_STATUSES);
export const criterionStatus = pgEnum('criterion_status', E.CRITERION_STATUSES);
export const gateReviewOutcome = pgEnum('gate_review_outcome', E.GATE_REVIEW_OUTCOMES);
export const waiverStatus = pgEnum('waiver_status', E.WAIVER_STATUSES);
export const statusDimensionKey = pgEnum('status_dimension_key', E.STATUS_DIMENSION_KEYS);

export const perimeterItemType = pgEnum('perimeter_item_type', E.PERIMETER_ITEM_TYPES);
export const perimeterDisposition = pgEnum('perimeter_disposition', E.PERIMETER_DISPOSITIONS);
export const transferStatus = pgEnum('transfer_status', E.TRANSFER_STATUSES);
export const agreementStage = pgEnum('agreement_stage', E.AGREEMENT_STAGES);
export const contractTransferClass = pgEnum('contract_transfer_class', E.CONTRACT_TRANSFER_CLASSES);
export const consentStatus = pgEnum('consent_status', E.CONSENT_STATUSES);
export const approvalRegisterCategory = pgEnum('approval_register_category', E.APPROVAL_REGISTER_CATEGORIES);
export const applicabilityStatus = pgEnum('applicability_status', E.APPLICABILITY_STATUSES);
export const requirementStatus = pgEnum('requirement_status', E.REQUIREMENT_STATUSES);

export const tsaStatus = pgEnum('tsa_status', E.TSA_STATUSES);
export const readinessArea = pgEnum('readiness_area', E.READINESS_AREAS);
export const readinessStatus = pgEnum('readiness_status', E.READINESS_STATUSES);
export const goNoGo = pgEnum('go_no_go', E.GO_NO_GO);
export const cutoverStatus = pgEnum('cutover_status', E.CUTOVER_STATUSES);

export const financialKind = pgEnum('financial_kind', E.FINANCIAL_KINDS);
export const financialCategory = pgEnum('financial_category', E.FINANCIAL_CATEGORIES);
export const approvalState = pgEnum('approval_state', E.APPROVAL_STATES);
export const modelKind = pgEnum('model_kind', E.MODEL_KINDS);
export const modelCase = pgEnum('model_case', E.MODEL_CASES);
export const valueBasis = pgEnum('value_basis', E.VALUE_BASES);
export const benefitStatus = pgEnum('benefit_status', E.BENEFIT_STATUSES);
export const kpiDirection = pgEnum('kpi_direction', E.KPI_DIRECTIONS);

export const partnerStage = pgEnum('partner_stage', E.PARTNER_STAGES);
export const ndaStatus = pgEnum('nda_status', E.NDA_STATUSES);
export const ddReleaseStatus = pgEnum('dd_release_status', E.DD_RELEASE_STATUSES);
export const materiality = pgEnum('materiality', E.MATERIALITY);
export const findingStatus = pgEnum('finding_status', E.FINDING_STATUSES);
export const negotiationIssueStatus = pgEnum('negotiation_issue_status', E.NEGOTIATION_ISSUE_STATUSES);
export const closingKind = pgEnum('closing_kind', E.CLOSING_KINDS);
export const closingStatus = pgEnum('closing_status', E.CLOSING_STATUSES);
export const conditionKind = pgEnum('condition_kind', E.CONDITION_KINDS);
export const conditionStatus = pgEnum('condition_status', E.CONDITION_STATUSES);
export const closingDeliverableStatus = pgEnum('closing_deliverable_status', E.CLOSING_DELIVERABLE_STATUSES);
export const postCloseKind = pgEnum('post_close_kind', E.POST_CLOSE_KINDS);
export const postCloseStatus = pgEnum('post_close_status', E.POST_CLOSE_STATUSES);
export const fundsFlowStatus = pgEnum('funds_flow_status', E.FUNDS_FLOW_STATUSES);

export const documentKind = pgEnum('document_kind', E.DOCUMENT_KINDS);
export const scanStatus = pgEnum('scan_status', E.SCAN_STATUSES);
export const evidenceLinkStatus = pgEnum('evidence_link_status', E.EVIDENCE_LINK_STATUSES);
export const sourceType = pgEnum('source_type', E.SOURCE_TYPES);
export const extractionStatus = pgEnum('extraction_status', E.EXTRACTION_STATUSES);

export const reportKind = pgEnum('report_kind', E.REPORT_KINDS);
export const exportFormat = pgEnum('export_format', E.EXPORT_FORMATS);
export const importStatus = pgEnum('import_status', E.IMPORT_STATUSES);
export const importRowAction = pgEnum('import_row_action', E.IMPORT_ROW_ACTIONS);
export const integrationKind = pgEnum('integration_kind', E.INTEGRATION_KINDS);
export const integrationDirection = pgEnum('integration_direction', E.INTEGRATION_DIRECTIONS);
export const integrationStatus = pgEnum('integration_status', E.INTEGRATION_STATUSES);
export const notificationChannel = pgEnum('notification_channel', E.NOTIFICATION_CHANNELS);
export const deliveryStatus = pgEnum('delivery_status', E.DELIVERY_STATUSES);

export const aiMode = pgEnum('ai_mode', E.AI_MODES);
export const aiProvider = pgEnum('ai_provider', E.AI_PROVIDERS);
export const aiRunStatus = pgEnum('ai_run_status', E.AI_RUN_STATUSES);
export const aiProposalStatus = pgEnum('ai_proposal_status', E.AI_PROPOSAL_STATUSES);

export const jobStatus = pgEnum('job_status', E.JOB_STATUSES);
export const actorKind = pgEnum('actor_kind', E.ACTOR_KINDS);
