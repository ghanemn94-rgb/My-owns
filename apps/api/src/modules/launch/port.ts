// The S12-004 LaunchPlanPort implementation, API side (ADR-0044 §1-§2, ADR-0048 §1; p5-work-split §H.1; T-DG5-BE-P).
// Starter 1 (`starter.transformation_created`) asks for the optional 90-day plan with
// `generate(tx, { transformationId, startDate, idempotencyKey: "launch_plan:<transformationId>" })`. This generator runs
// inside the caller's transaction and reuses the request's generation core (plan.ts `generateLaunchPlanInTx`): under
// the launchPlan lock it returns the existing plan untouched when there is one (a replay writes nothing; the
// UNIQUE `launch_plan_idempotency_key` is the backstop), else it creates the plan, the 33 template tasks and the Day-90
// test dated from the start date (day d = start date + d calendar days, D-142 Q6), with `generated_via = 'automation'`.
// The rows carry the transformation's creator in created_by, and the audit actor is the service acting on behalf of
// that creator (the starter-1 actor). It grants and approves nothing.
import type { AuditActor, Tx } from "@mth/db";
import { generateLaunchPlanInTx, type GenerateLaunchPlanResult } from "./plan.ts";

/**
 * The request of automation's `LaunchPlanPort.generate` (apps/api/src/modules/automation/ports/launch-plan.ts). launch
 * may not import automation (ADR-0002 module map), so the port's shape is restated here and server.ts, the composition
 * root, registers this generator into automation's port; the compiler checks the two shapes agree there.
 */
export interface LaunchPlanGenerateRequest {
  readonly transformationId: string;
  readonly startDate: string;
  readonly idempotencyKey: string;
}

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const launchPlanGenerator = {
  async generate(tx: Tx, request: LaunchPlanGenerateRequest): Promise<GenerateLaunchPlanResult> {
    if (request.idempotencyKey !== `launch_plan:${request.transformationId}`)
      throw new Error(`launch plan port: idempotency key must be launch_plan:${request.transformationId}`);
    if (!BUSINESS_DATE.test(request.startDate))
      throw new Error(`launch plan port: start date ${request.startDate} is not a business date`);
    const t = await tx
      .selectFrom("transformation")
      .select(["organization_id", "created_by"])
      .where("id", "=", request.transformationId)
      .executeTakeFirst();
    if (!t) throw new Error(`launch plan port: transformation ${request.transformationId} does not exist`);
    const actor: AuditActor = {
      actorType: "service",
      actorUserId: null,
      onBehalfOfUserId: t.created_by,
      requestId: request.idempotencyKey,
      source: "api",
    };
    return generateLaunchPlanInTx(tx, actor, {
      organizationId: t.organization_id,
      transformationId: request.transformationId,
      startDate: request.startDate,
      generatedVia: "automation",
      userId: t.created_by,
    });
  },
};
