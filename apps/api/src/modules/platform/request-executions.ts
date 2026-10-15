// The request starters' executions (ADR-0044 §1 "Execution recording"; REQ-S12-001 "each execution is recorded with
// rule version, trigger event and outcome"; p5-work-split §E.1; T-DG5-BE-J). It lives in `platform`, the leaf every
// module may import, because its three callers (workflows, sustainment, methodology) are DG2-DG4 modules that may not
// import the P5 module `automation` (ADR-0002; architecture.test.ts "No P1-P4 module imports a P5 module"). It reads
// and writes only the 0074 rows through @mth/db, with no domain import. Starters 5 (`gate.submission_requested`,
// the DG4 gate-submission check), 14 (`bau_handover.accept_requested`, the DG4 accept path) and 15
// (`methodology.revision_proposed`, the slice A revision impact) run INSIDE a request, so their execution is recorded in
// the request's own transaction when it commits: one `automation_execution` of the starter's effective version
// (trigger key = the request's record id), one `automation_action_result` (`starter_handler`, ordinal 1, `done`) and
// the execution finished `succeeded`, each with its audit event, under the rule-execution advisory lock on
// `<versionId>:<triggerKey>` (class `automationRuleExecution`). A REFUSED request (for example a gate submission with missing mandatory evidence, 422)
// rolls back and records no execution: its record is the DG4 failed-mutation audit (ADR-0004) - the one enumerated
// exception to "one execution row per evaluation". A second call with the same key records nothing more (UNIQUE
// automation_execution_once_key). Run as the constrained service identity; nothing here decides anything.
import { insertAuditEvent, sql, type AuditEventInput, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { ADVISORY_LOCK_CLASSES } from "./advisory-locks.ts";

/** The request's audit context (structurally the audit module's AuditContext: its user and request id). */
export interface RequestAuditContext {
  readonly actorUserId: string | null;
  readonly requestId: string;
}

export const REQUEST_STARTERS = {
  gateEvidenceMissing: { ruleCode: "starter.gate_evidence_missing", triggerCode: "gate.submission_requested" },
  bauHandoverAccepted: { ruleCode: "starter.bau_handover_accepted", triggerCode: "bau_handover.accept_requested" },
  revisionProposed: { ruleCode: "starter.revision_proposed", triggerCode: "methodology.revision_proposed" },
} as const;
export type RequestStarter = (typeof REQUEST_STARTERS)[keyof typeof REQUEST_STARTERS];

export interface RequestExecutionScope {
  readonly organizationId: string | null;
  readonly transformationId: string | null;
  /** The request's audit context (its request id); the rows are written as the service on behalf of the user. */
  readonly audit: RequestAuditContext;
}

export type RequestExecutionOutcome = "recorded" | "existing" | "no_effective_version";

/** Record one committed request as an execution of its starter (in the caller's transaction). */
export async function recordRequestExecution(
  tx: Tx,
  starter: RequestStarter,
  triggerKey: string,
  scope: RequestExecutionScope,
): Promise<RequestExecutionOutcome> {
  const v = await tx
    .selectFrom("automation_rule as r")
    .innerJoin("automation_rule_version as v", "v.id", "r.effective_version_id")
    .select(["r.id as ruleId", "v.id as versionId", "v.trigger_codes as triggerCodes"])
    .where("r.code", "=", starter.ruleCode)
    .where("r.origin", "=", "starter")
    .where("v.status", "=", "published")
    .executeTakeFirst();
  if (v === undefined || !v.triggerCodes.includes(starter.triggerCode)) return "no_effective_version";
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.automationRuleExecution}::integer, hashtext(${`${v.versionId}:${triggerKey}`}::text))`.execute(
    tx,
  );
  const organizationId = scope.organizationId;
  const transformationId = organizationId === null ? null : scope.transformationId;
  // Written as the constrained service identity on behalf of the requesting user, in the request's transaction.
  const write = (event: AuditEventInput) =>
    insertAuditEvent(
      tx,
      {
        actorType: "service",
        actorUserId: null,
        onBehalfOfUserId: scope.audit.actorUserId,
        requestId: scope.audit.requestId,
        source: "api",
      },
      event,
    );
  const executionId = uuidv7();
  const inserted = await tx
    .insertInto("automation_execution")
    .values({
      id: executionId,
      automation_rule_id: v.ruleId,
      automation_rule_version_id: v.versionId,
      trigger_code: starter.triggerCode,
      trigger_key: triggerKey,
      trigger_payload: JSON.stringify({}),
      organization_id: organizationId,
      transformation_id: transformationId,
      run_as: "service",
      initiating_user_id: null,
    })
    .onConflict((oc) => oc.constraint("automation_execution_once_key").doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!inserted) return "existing";
  await write({
    action: "automation_execution.start",
    recordType: "automation_execution",
    recordId: executionId,
    organizationId,
    transformationId,
    newVersion: 1,
    changes: {
      automation_rule_version_id: { from: null, to: v.versionId },
      trigger_code: { from: null, to: starter.triggerCode },
      trigger_key: { from: null, to: triggerKey },
    },
  });
  const key = `automation:${starter.ruleCode}:${triggerKey}:1`;
  const resultId = uuidv7();
  await tx
    .insertInto("automation_action_result")
    .values({
      id: resultId,
      automation_execution_id: executionId,
      attempt_no: 1,
      ordinal: 1,
      action_type: "starter_handler",
      idempotency_key: key,
      outcome: "done",
      result_record_type: null,
      result_record_id: null,
      error_code: null,
    })
    .execute();
  await write({
    action: "automation_action_result.create",
    recordType: "automation_action_result",
    recordId: resultId,
    organizationId,
    transformationId,
    changes: {
      automation_execution_id: { from: null, to: executionId },
      ordinal: { from: null, to: 1 },
      idempotency_key: { from: null, to: key },
      outcome: { from: null, to: "done" },
    },
  });
  await tx
    .updateTable("automation_execution")
    .set({ status: "succeeded", conditions_met: true, finished_at: sql<Date>`now()`, version: 2 })
    .where("id", "=", executionId)
    .where("version", "=", 1)
    .executeTakeFirstOrThrow();
  await write({
    action: "automation_execution.succeed",
    recordType: "automation_execution",
    recordId: executionId,
    organizationId,
    transformationId,
    priorVersion: 1,
    newVersion: 2,
    changes: { status: { from: "running", to: "succeeded" }, conditions_met: { from: null, to: true } },
  });
  return "recorded";
}
