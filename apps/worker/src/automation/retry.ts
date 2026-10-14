// Retry of a failed rule execution from the failure queue, worker side (ADR-0043 §5; REQ-S12-002 "a failed execution
// appears in the queue and succeeds on retry without duplicating actions"; p5-work-split §D.3; T-DG5-BE-I).
//
// The API's retry moved the execution `failed -> running` with attempt_no + 1 and the failure `open -> retrying`, and
// wrote the `automation_failure.retry_requested` event in that same transaction. The dispatcher (worker.ts) calls
// `resumeExecution` for it: the execution is rebuilt from ITS OWN rule version (even if a newer version has been
// published since, or the rule was disabled: the repair finishes the work that was asked for), with its stored trigger
// code, key and payload, and run through the engine's executeRule. The engine finds the existing `running` row (UNIQUE
// (rule version, trigger key)), skips every action whose key already has a `done` result, runs the others under lock
// 730258 and finishes the execution; finishExecution then resolves (or reopens) the failure in the same transaction.
import type { Db } from "@mth/db";
import type { AutomationCondition } from "@mth/shared/schemas";
import type { JobAttempt } from "../handlers/spec.ts";
import { executeRule, type Candidate, type ExecutionReport } from "./engine.ts";

export type ResumeResult = ExecutionReport | { readonly outcome: "stale"; readonly executionId: string };

export async function resumeExecution(
  db: Db,
  executionId: string,
  jobId: string,
  attempt?: JobAttempt,
): Promise<ResumeResult> {
  const row = await db
    .selectFrom("automation_execution as e")
    .innerJoin("automation_rule as r", "r.id", "e.automation_rule_id")
    .innerJoin("automation_rule_version as v", "v.id", "e.automation_rule_version_id")
    .select([
      "e.status",
      "e.trigger_code as triggerCode",
      "e.trigger_key as triggerKey",
      "e.trigger_payload as payload",
      "e.organization_id as executionOrganizationId",
      "e.transformation_id as executionTransformationId",
      "r.id as ruleId",
      "r.code as ruleCode",
      "r.name_en as ruleName",
      "r.scope_level as scopeLevel",
      "r.organization_id as organizationId",
      "r.transformation_id as transformationId",
      "v.id as versionId",
      "v.conditions",
      "v.actions",
      "v.run_as as runAs",
      "v.service_permission_codes as servicePermissionCodes",
    ])
    .where("e.id", "=", executionId)
    .executeTakeFirst();
  if (row === undefined || row.status !== "running") return { outcome: "stale", executionId };
  const organizationId = row.organizationId ?? row.executionOrganizationId;
  if (organizationId === null) return { outcome: "stale", executionId };
  const candidate: Candidate = {
    ruleId: row.ruleId,
    ruleCode: row.ruleCode,
    ruleName: row.ruleName,
    scopeLevel: row.scopeLevel as Candidate["scopeLevel"],
    organizationId,
    transformationId: row.transformationId,
    versionId: row.versionId,
    conditions: row.conditions as AutomationCondition[],
    actions: row.actions as Candidate["actions"],
    runAs: row.runAs as Candidate["runAs"],
    servicePermissionCodes: row.servicePermissionCodes,
  };
  return executeRule(
    db,
    candidate,
    {
      triggerCode: row.triggerCode,
      triggerKey: row.triggerKey,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      transformationId: row.executionTransformationId,
    },
    jobId,
    attempt,
  );
}
