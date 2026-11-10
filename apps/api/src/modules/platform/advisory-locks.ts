// The registry of transaction-scoped advisory-lock CLASSES (ADR-0016 §"Advisory-lock registry"; T-DG3-ARCH-03).
//
// Every two-key lock `pg_advisory_xact_lock(class, hashtext(<resource id>))` the API or a database trigger takes uses
// one class from this table. A class names ONE kind of resource; two kinds of resource must never share a class,
// otherwise unrelated writes would serialize on each other, and a hash collision between their keys could even make
// one write wait for an unrelated one (T-DG3-ARCH-03: prioritization and dependency-type creation both used 730222).
// The owning module re-exports its constant under its historical name (HIERARCHY_LOCK_CLASS, ...), so callers and
// tests keep their imports. Where a trigger shares the lock, the migration declares the same number as a PL/pgSQL
// CONSTANT; `advisory-locks.test.ts` checks every such migration constant against this table.
//
// Out of scope of this registry (a different key space, so no collision is possible with the two-int4 form): the
// single-bigint locks `pg_advisory_xact_lock(hashtextextended(<text>, 0))` (idempotency, North Star, readable codes)
// and the fixed bigint keys of the migration runner and bootstrap (packages/db).

/** One row per advisory-lock class: the integer, the resource it serializes, and the key's second half. */
export const ADVISORY_LOCK_CLASSES = {
  /** Business-unit hierarchy of one organization (organization module + trigger 0009). Key: organization_id. */
  businessUnitHierarchy: 730219,
  /** Outcome tree of one transformation (trigger 0013 only; no API caller). Key: transformation_id. */
  outcomeTree: 730220,
  /** Initiative dependency graph of one transformation (workflows T08 + trigger 0022). Key: transformation_id. */
  dependencyGraph: 730221,
  /** Prioritization writes of one transformation (portfolio: weight sets, snapshots, results). Key: transformation_id. */
  prioritization: 730222,
  /** Creation of one dependency-type code (workflows, API only). Key: the requested code text. */
  dependencyType: 730223,
  // P4 block of T-DG4-ARCH-01 (730224-730227; p4-plan §4, ADR-0026). 730227 is RESERVED for this block: never
  // allocated to another block, and listed here only once a resource uses it.
  /** Delegation graph of one organization (access delegations + trigger 0029 loop guard). Key: organization_id. */
  delegationGraph: 730224,
  /** Accountable cells of one T12 RACI deliverable (governance RACI + deferred trigger 0030). Key: deliverable id. */
  raciDeliverable: 730225,
  /** Approval subject record (workflows approvals + triggers 0031). Key: the subject record id. */
  approvalSubject: 730226,
  // P4 block of T-DG4-ARCH-02 (730228-730231; p4-plan §4, ADR-0027 §12). 730231 is RESERVED for this block: never
  // allocated to another block, and listed here only once a resource uses it.
  /** KPI formula graph of one transformation (kpi formulas + triggers 0033 cycle guard). Key: transformation_id. */
  kpiFormulaGraph: 730228,
  /** KPI actual slot (kpi actuals, overrides + triggers 0034/0035). Key: "<kpiDefinitionId>:<scopeKind>:<scopeId>:<reportingPeriodId>". */
  kpiActualSlot: 730229,
  /** Reporting periods of one organization and frequency (kpi reporting periods + trigger 0033). Key: "<organizationId>:<frequency>". */
  reportingPeriod: 730230,
  // P4 block of T-DG4-ARCH-03 (730232-730235; p4-plan §4, ADR-0029 §10). 730235 is RESERVED for this block: never
  // allocated to another block, and listed here only once a resource uses it.
  /** Allocation set of one benefit (benefits allocations + trigger 0037 benefit_allocation_guard). Key: benefit id. */
  benefitAllocationSet: 730232,
  /** Finance validation queue item of one benefit measurement (benefits submit, the worker's queue handler; API only). Key: measurement id. */
  financeValidationQueue: 730233,
  /** Overlap detection and resolution of one transformation and driver (benefits overlaps; API only). Key: "<transformationId>:<driverKey>". */
  benefitOverlap: 730234,
  // P4 block of T-DG4-ARCH-04 (730236-730237; p4-plan §4, ADR-0031 §5). 730237 is RESERVED for this block: never
  // allocated to another block, and listed here only once a resource uses it.
  /** Corrective-action case of one source (raid corrective cases: the event consumers and the API; one open case is also held by the unique index corrective_case_one_open_key). Key: "<transformationId>:<sourceKind>:<sourceScopeKey>". */
  correctiveCase: 730236,
  // P4 block of T-DG4-ARCH-05 (730238-730241; p4-plan §4, ADR-0032 §10). 730241 is RESERVED for this block: never
  // allocated to another block, and listed here only once a resource uses it.
  /** Generation and regeneration of one meeting series (governance: the generation job and updateMeetingSeries; no duplicate occurrence is also held by the unique index meeting_series_occurrence_key). Key: "<meetingSeriesId>". */
  meetingSeriesGeneration: 730238,
  /** The executive ask of one blocker (governance: the blocker-escalation consumer and scan; one open ask per blocker is also held by the unique index decision_one_open_blocker_ask). Key: "<transformationId>:<blockerRecordType>:<blockerRecordId>". */
  executiveAskBlocker: 730239,
  /** The SLA escalation of one executive decision (governance: the decision-SLA scan; one escalation per due date is also held by the unique constraint decision_escalation_once). Key: "<decisionId>". */
  decisionEscalation: 730240,
  // P4 block of T-DG4-ARCH-06 (730242-730245; p4-plan §4, ADR-0033 §8, ADR-0034 §11). 730245 is RESERVED for this
  // block: never allocated to another block, and listed here only once a resource uses it.
  /** The below-trajectory intervention of one adoption indicator, scope and period (adoption: the indicator consumer; exactly one intervention is also held by the unique index adoption_intervention_trigger_key). Key: "<metricLinkId>:<scopeKind>:<scopeId>:<reportingPeriodId>". */
  adoptionIntervention: 730242,
  /** The BAU handover of one performance area (sustainment: prepare, submit, accept, return and reopen; one open and one accepted handover per cycle are also held by the unique indexes bau_handover_open_key and bau_handover_accepted_key). Key: "<performanceAreaId>". */
  bauHandover: 730243,
  /** The closure of one initiative or transformation (sustainment: closeInitiative, closeTransformation; one closure per subject is also held by the unique indexes closure_record_initiative_key and closure_record_transformation_key). Key: "initiative:<initiativeId>" or "transformation:<transformationId>". */
  closure: 730244,
  // P4 block of T-DG4-ARCH-07 (730246-730248; p4-plan §4, ADR-0035 §9, ADR-0036 §8). 730248 is RESERVED for this
  // block: never allocated to another block, and listed here only once a resource uses it.
  /** The change requests of one subject record (workflows change requests: raise, the automatic material-change hook and apply; one open request per subject is also held by the unique index change_request_one_open_per_subject). Key: "<subjectType>:<subjectId>". */
  changeRequestSubject: 730246,
  /** The exceptions of one gate instance (workflows gate exceptions: request, decide, revoke, and gate submission when it records a covering exception; one pending exception per criterion is also held by the unique index gate_exception_one_pending_key). Key: "<gateInstanceId>". */
  gateException: 730247,
  // P4 block of T-DG4-ARCH-08 (730249; p4-plan §4, ADR-0038 §3). The dashboard read models take no lock (ADR-0037 §9).
  /** The allocation set of one target record of the traceability chain (reporting traceability links and the portfolio contribution allocation; the database trigger trace_allocation_guard (0055) takes the same lock, so the total stays <= 100 %). Key: "<outcomeKpiId>" or "<benefitId>" (the trigger hashes the uuid text). */
  traceAllocationSet: 730249,
  // P5 block of T-DG5-ARCH-01 (730250-730253; p5-plan §4, ADR-0039 §11, ADR-0040 §4). 730253 is RESERVED for this
  // block: never allocated to another block, and listed here only once a resource uses it.
  /** The open Studio draft of one configuration kind and key (methodology drafts, elements, preview, compatibility, review submit/withdraw/decide, discard; one open draft is also held by the unique index methodology_version_one_open_draft_key). Key: "<configKind>:<key>". */
  configDraft: 730250,
  /** Publishing and rollback-creation of one configuration kind and key (methodology publish, rollback). Key: "<configKind>:<key>". */
  configPublish: 730251,
  /** The methodology migrations and configuration pins of one transformation (create, preview, submit, decide, execute, withdraw; one open migration per kind is also held by the unique index methodology_migration_one_open_key). Key: "<transformationId>". */
  methodologyMigration: 730252,
  // P5 block of T-DG5-ARCH-02 (730254-730257; p5-plan §4, ADR-0041 §8, ADR-0042 §7). 730255-730257 are RESERVED for this
  // block: never allocated to another block, and listed here only once a resource uses it (ADR-0041 §8: append-only
  // comments need no lock).
  /** The steps of one procedure instance (procedures: launch creates and activates the first steps, input updates, step complete/skip/assign, cancel and instance completion; exactly-once launch is also held by the unique constraint procedure_instance_launch_key). Key: "<procedureInstanceId>". */
  procedureInstanceStep: 730254,
  // P5 block of T-DG5-ARCH-03 (730258-730262; p5-plan §4, ADR-0043 §7, ADR-0044 §6). 730262 is RESERVED for this block:
  // never allocated to another block, and listed here only once a resource uses it.
  /** One rule version and one trigger occurrence (automation: execution start, action results, retry of the execution; exactly-once execution is also held by the unique constraint automation_execution_once_key). Key: "<ruleVersionId>:<triggerKey>". */
  automationRuleExecution: 730258,
  /** One entry of the failure queue (automation and jobs: retry, dismiss, the retry outcome; one open failure per key is also held by the unique index operational_failure_one_open_key). Key: "<operationalFailureId>". */
  failureRepair: 730259,
  /** The route steps of one approval (workflows: step decision, activation of the next sequential step, completion of the approval). Key: "<approvalId>". */
  approvalRouteStep: 730260,
  /** One user's digest window (tasks: collecting held notifications into one digest; exactly once is also held by the unique constraint notification_digest_window_key). Key: "<userId>:<windowStartIso>". */
  digestWindow: 730261,
  // P5 block of T-DG5-ARCH-04 (730263-730265; p5-plan §4, ADR-0045 §7, ADR-0046 §5). 730265 is RESERVED for this block:
  // never allocated to another block, and listed here only once a resource uses it.
  /** The snapshots of one report definition and subject (reporting: issue, reissue, discard; one current issued snapshot per series is also held by the unique index report_snapshot_one_issued_key). Key: "<definitionCode>:<transformationId>:<subjectId>:<reportingPeriodId or ->". */
  reportSnapshotIssue: 730263,
  /** One export job (reporting/worker: start, progress, completion, failure, cancel; exactly one job per request is also held by the unique constraint export_job_idempotency_key). Key: "<exportJobId>". */
  exportJob: 730264,
  // P5 block of T-DG5-ARCH-05 (730266-730269; p5-plan §4, ADR-0047 §7, ADR-0048 §8). 730269 is RESERVED for this block:
  // never allocated to another block, and listed here only once a resource uses it.
  /** One KPI's restatements (kpi: create, submit, decide, withdraw, apply; at most one open restatement per KPI is also held by the unique index kpi_restatement_one_open_key; taken by the 0085 trigger kpi_restatement_guard). Key: "<kpiDefinitionId>". */
  kpiRestatement: 730266,
  /** One transformation's 90-day launch plan (launch: generate, start-date shift and re-dating, task edits, predecessor links and their cycle check; one plan per transformation is also held by launch_plan_transformation_key; taken by the 0086 triggers launch_plan_guard and launch_task_predecessor_guard). Key: "<transformationId>". */
  launchPlan: 730267,
  /** One health assessment's submission (health: score, band and the three actions checked together; taken by the 0086 trigger health_assessment_guard). Key: "<assessmentId>". */
  healthAssessmentSubmit: 730268,
  // P5 block of T-DG5-ARCH-06 (730270-730272; p5-plan §4, ADR-0049 §8, ADR-0050 §6). 730272 is RESERVED for this block:
  // never allocated to another block, and listed here only once a resource uses it.
  /** One organization's branding (admin: a new branding version and the head row naming it; the version step is also held by branding_version_organization_version_key; taken by the 0089 triggers branding_version_guard and branding_setting_guard). Key: "<organizationId>". */
  brandingPublish: 730270,
  /** The demo seed or reset of a demo deployment (demo CLI and worker; a SESSION lock on the maintenance database "postgres", because the reset drops and re-creates the demo database). One class-wide key: "demo". */
  demoReset: 730271,
  // P6 block of T-DG6-ARCH-01 (730300-730304; p6-plan §4, ADR-0051 §6). 730302-730304 are RESERVED for this block:
  // never allocated to another block, and listed here only once a resource uses it.
  /** One sensitive record's flag and explicit grants (access sensitivity: mark/unmark, grant, revoke; at most one active grant per record and grantee is also held by the unique index sensitive_record_grant_one_active_key; taken by the 0098 triggers record_sensitivity_guard and sensitive_record_grant_guard). Key: "<recordType>:<recordId>". */
  sensitiveRecordGrant: 730300,
  /** Issuing the deep-link token of one inbox notification (tasks deep links: lazy issue for a notification written without one; set-once is also held by the 0098 trigger inbox_notification_deep_link_guard, which takes the same lock, and the unique index inbox_notification_link_token_key). Key: "<notificationId>". */
  deepLinkIssue: 730301,
  // P6 block of T-DG6-ARCH-02 (730305-730309; p6-plan §4, ADR-0053 §8, ADR-0054 §6). 730308-730309 are RESERVED for this
  // block: never allocated to another block, and listed here only once a resource uses it.
  /** Opening or recurring the operational exception of one source and failure class (operations: the worker failure hook, the connector run, the freshness scan and the heartbeat watch; one active row per key is also held by the unique index operational_exception_one_active_key). Key: "<organizationId or 'platform'>:<dedupKey>". */
  operationalExceptionUpsert: 730305,
  /** One channel delivery of one notification (tasks channels: the fan-out handler's claim before a send and the state change after it; once per notification and channel is also held by notification_delivery_once_key). Key: "<notificationId>:<channelKind>". */
  channelDelivery: 730306,
  /** The evidence-storage setting and its connection test (evidence storage: a setting change and a test never interleave). One class-wide key: "storage". */
  storageSetting: 730307,
  // P6 block of T-DG6-ARCH-03 (730310-730317; p6-plan §4, ADR-0055 §8, ADR-0056 §8). 730315-730317 are RESERVED for this
  // block: never allocated to another block, and listed here only once a resource uses it.
  /** One connector's runs (integrations: queueing a run, a retry or a test, and the worker's start and finish of a run; one active run per connector is also held by the unique index integration_run_one_active, and one run per idempotency key by integration_run_idempotency_key). Key: "<connectorId>". */
  connectorRun: 730310,
  /** One import batch's staging end, commit and cancel (integrations imports: the commit through the ImportTargetRegistry never interleaves with a cancel or a second commit; the counts are re-checked by the 0105 trigger import_batch_guard). Key: "<importBatchId>". */
  importCommit: 730311,
  /** One webhook delivery (integrations webhooks: the receipt and its staged batch; one receipt per endpoint and delivery id is also held by webhook_receipt_delivery_key). Key: "<webhookEndpointId>:<deliveryId>". */
  webhookReceipt: 730312,
  /** One outbound write (integrations outbound: create, dispatch result and confirmation re-check never interleave; one write per connector and idempotency key is also held by outbound_write_idempotency_key). Key: "<connectorId>:<idempotencyKey>". */
  outboundWrite: 730313,
  /** One deliverable's external-change flag and confirmation (portfolio: flag, withdraw and confirm by evidence or connector result never interleave; one row per deliverable is also held by deliverable_external_change_deliverable_key). Key: "<deliverableId>". */
  deliverableConfirmation: 730314,
  // P6 block of T-DG6-ARCH-04 (730318-730322; p6-plan §4, ADR-0057 §10). 730320-730322 are RESERVED for this block:
  // never allocated to another block, and listed here only once a resource uses it (730320 "draft upsert" stays
  // unallocated: the P5 unique index form_draft_open_record_key already serializes drafts and P6 adds no draft write).
  /** One indexed record type's full reindex and incremental feed run (search worker handlers: a reindex and a feed batch of the same record type never interleave; the consumed sequence never goes back except to 0 at a reindex start, also held by the 0108 trigger search_index_state_guard). Key: "<recordType>". */
  searchReindex: 730318,
  /** One saved view's share and unshare (search saved views: the share decision re-checks saved_view.share at commit time and never interleaves with the owner's edit or delete; the shared shape is also held by saved_view_shared_shape and the 0108 trigger saved_view_guard). Key: "<savedViewId>". */
  savedViewShare: 730319,
  // P6 block of T-DG6-ARCH-05 (730323-730325; p6-plan §4, ADR-0059 §10). 730324-730325 are RESERVED for this block:
  // never allocated to another block, and listed here only once a resource uses it.
  /** The assistant setting (assistant settings: a put, an enable and a disable never interleave, and the enable re-checks assistant.configure and the completeness of the setting at commit time; one row is also held by assistant_setting_singleton_key and the locked-while-enabled rule by the 0111 trigger assistant_setting_guard). One class-wide key: "assistant". */
  assistantSetting: 730323,
  // P6 block of T-DG6-ARCH-06 (730326-730327; p6-plan §4, ADR-0061 §10). Both are RESERVED for this block and not
  // allocated: the branding contrast report is written by the publish transaction under brandingPublish (730270).
} as const;

export type AdvisoryLockClassName = keyof typeof ADVISORY_LOCK_CLASSES;
