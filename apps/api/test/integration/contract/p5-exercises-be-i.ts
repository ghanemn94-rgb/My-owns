// P5 contract exercises of BE-I (p5-work-split §D.3 and §2 rule 14; T-DG5-BE-I): the six execution-history and
// failure-queue operations, each with a success and every declared refusal it can reach, through the validating
// client. The failures come from the real worker code: a rule whose action targets a transformation outside its scope
// (REQ-S12-003; planted after its dry run, see test/support/automation-failures.ts) and a job's last failed attempt.
// Every value is synthetic; retry and dismiss are operational repairs, never a business approval.
import {
  automationExecution,
  automationExecutionPage,
  operationalFailure,
  operationalFailurePage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { resumeExecution } from "../../../../worker/src/automation/retry.ts";
import { AUTOMATION_HANDLERS } from "../../../../worker/src/handlers/automation.ts";
import { captureJobFailure, failureRetryJobId } from "../../../../worker/src/kit.ts";
import { gateDecidedEnvelope, gateDecidedPayload, liveRule, ruleAuthor } from "../../support/automation-failures.ts";
import { createTransformationRow, signIn, type P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_BE_I: Readonly<Record<string, z.ZodType>> = {
  listAutomationExecutions: automationExecutionPage,
  getAutomationExecution: automationExecution,
  listAutomationFailures: operationalFailurePage,
  getAutomationFailure: operationalFailure,
  retryAutomationFailure: operationalFailure,
  dismissAutomationFailure: operationalFailure,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5BeIOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const E = "/api/v1/admin/automation-executions";
  const F = "/api/v1/admin/automation-failures";
  const ifm = (v: number) => ({ "if-match": `"${v}"` });
  const author = await ruleAuthor(api, w);
  const tech = await signIn(api.app, w.admin.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const txA = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  const txA2 = await createTransformationRow(api.db, w.orgA.id, w.a2, w.grantor.id);
  const task = (targetTransformationId: string) => ({
    type: "create_task",
    parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up", targetTransformationId },
  });
  const rule = await liveRule(api, w, author, {
    content: { triggerCodes: ["gate.decided"], actions: [task(txA)], runAs: "service" },
    sampleTransformationId: txA,
    scopeLevel: "transformation",
    transformationId: txA,
    plant: [task(txA2)],
  });
  const evaluate = AUTOMATION_HANDLERS.find((h) => h.queue === "automation.evaluate")!;
  await evaluate.handle(api.db, gateDecidedEnvelope(w.orgA.id, gateDecidedPayload(txA)), "contract-be-i", {
    retryCount: 0,
    retryLimit: 5,
  });

  // listAutomationExecutions: 200 (filters); 400; 403 (no automation.read).
  const execs = await mirrored("GET", `${E}?ruleId=${rule.id}&status=failed&transformationId=${txA}`, {
    session: auditor,
  });
  expect(execs.status).toBe(200);
  const executionId = (execs.body as Body).items[0].id as string;
  expect((await mirrored("GET", `${E}?status=bogus`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", E, { session: nobody })).status).toBe(403);

  // getAutomationExecution: 200; 400; 403; 404.
  const exec = await mirrored("GET", `${E}/${executionId}`, { session: auditor });
  expect([exec.status, (exec.body as Body).errorCode]).toEqual([200, "automation.action_forbidden"]);
  expect((await mirrored("GET", `${E}/not-a-uuid`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", `${E}/${executionId}`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${E}/${crypto.randomUUID()}`, { session: auditor })).status).toBe(404);

  // listAutomationFailures: 200 (filters); 400; 403.
  const list = await mirrored("GET", `${F}?source=rule_execution&status=open&limit=100`, { session: tech });
  expect(list.status).toBe(200);
  const entry = (list.body as Body).items.find((i: Body) => i.executionId === executionId);
  expect(entry.errorCode).toBe("automation.action_forbidden");
  const failureId = entry.id as string;
  expect((await mirrored("GET", `${F}?source=bogus`, { session: tech })).status).toBe(400);
  expect((await mirrored("GET", F, { session: nobody })).status).toBe(403);

  // getAutomationFailure: 200; 400; 403; 404.
  expect((await mirrored("GET", `${F}/${failureId}`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${F}/not-a-uuid`, { session: tech })).status).toBe(400);
  expect((await mirrored("GET", `${F}/${failureId}`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${F}/${crypto.randomUUID()}`, { session: tech })).status).toBe(404);

  // retryAutomationFailure: 428; 409; 403 (AUD); 404; 200; 422 not_open (retrying).
  const retry = `${F}/${failureId}/retry`;
  expect((await mirrored("POST", retry, { session: tech })).status).toBe(428);
  expect((await mirrored("POST", retry, { session: tech, headers: ifm(9) })).status).toBe(409);
  expect((await mirrored("POST", retry, { session: auditor, headers: ifm(1) })).status).toBe(403);
  expect((await mirrored("POST", `${F}/${crypto.randomUUID()}/retry`, { session: tech, headers: ifm(1) })).status).toBe(
    404,
  );
  const retried = await mirrored("POST", retry, { session: tech, headers: ifm(1) });
  expect([retried.status, (retried.body as Body).status]).toEqual([200, "retrying"]);
  const busy = await mirrored("POST", retry, { session: tech, headers: ifm(2) });
  expect([busy.status, (busy.body as Body).code]).toEqual([422, "automation_failure.not_open"]);
  // The worker resumes it; the target is still outside the scope, so the entry is open again (never a task).
  expect((await resumeExecution(api.db, executionId, "contract-be-i-retry")).outcome).toBe("failed");

  // dismissAutomationFailure: 400; 428; 409; 403 (AUD); 404; 200; 422 not_open.
  const dismiss = `${F}/${failureId}/dismiss`;
  const reason = { reason: "Synthetic: the rule's target is outside its scope." };
  expect((await mirrored("POST", dismiss, { session: tech, headers: ifm(3), body: {} })).status).toBe(400);
  expect((await mirrored("POST", dismiss, { session: tech, body: reason })).status).toBe(428);
  expect((await mirrored("POST", dismiss, { session: tech, headers: ifm(9), body: reason })).status).toBe(409);
  expect((await mirrored("POST", dismiss, { session: auditor, headers: ifm(3), body: reason })).status).toBe(403);
  expect(
    (await mirrored("POST", `${F}/${crypto.randomUUID()}/dismiss`, { session: tech, headers: ifm(1), body: reason }))
      .status,
  ).toBe(404);
  const dismissed = await mirrored("POST", dismiss, { session: tech, headers: ifm(3), body: reason });
  expect([dismissed.status, (dismissed.body as Body).status]).toEqual([200, "dismissed"]);
  const gone = await mirrored("POST", dismiss, { session: tech, headers: ifm(4), body: reason });
  expect([gone.status, (gone.body as Body).code]).toEqual([422, "automation_failure.not_open"]);

  // retryAutomationFailure: 422 retry_limit, on a job failure retried 20 times (each re-sent job failing again).
  const envelope = gateDecidedEnvelope(w.orgA.id, { synthetic: true });
  const job = await captureJobFailure(api.db, {
    queue: "gates.decided",
    jobId: crypto.randomUUID(),
    data: envelope,
    attempts: 6,
    error: new Error("synthetic job fault"),
  });
  let version = 1;
  for (let n = 1; n <= 20; n += 1) {
    expect(
      (await mirrored("POST", `${F}/${job.failureId}/retry`, { session: tech, headers: ifm(version) })).status,
    ).toBe(200);
    await captureJobFailure(api.db, {
      queue: "gates.decided",
      jobId: failureRetryJobId(job.failureId, n),
      data: envelope,
      attempts: 6,
      error: new Error("synthetic job fault"),
    });
    version += 2;
  }
  const limit = await mirrored("POST", `${F}/${job.failureId}/retry`, { session: tech, headers: ifm(version) });
  expect([limit.status, (limit.body as Body).code]).toEqual([422, "automation_failure.retry_limit"]);
}
