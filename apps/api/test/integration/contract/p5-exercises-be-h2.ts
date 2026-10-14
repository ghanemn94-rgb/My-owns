// P5 contract exercises of BE-H2 (p5-work-split §D.2 and §2 rule 14; T-DG5-BE-H2): the six slice D lifecycle
// operations it routes (dry runs, submit, review, publish, discard), each with a success and every declared refusal it
// can reach, through the validating client. The configured review stays ON here (the shared contract world): the
// review path is exercised; switching it off is covered by apps/api/test/integration/automation/automation-lifecycle
// .test.ts. Every value is synthetic; a rule review is a configuration review, never a business approval.
import { automationDryRun, automationDryRunPage, automationRuleVersion } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import {
  createTransformationRow,
  createUser,
  grant,
  signIn,
  uniq,
  type P5ExerciseContext,
} from "../../support/harness.ts";

export const P5_MIRRORS_BE_H2: Readonly<Record<string, z.ZodType>> = {
  listAutomationDryRuns: automationDryRunPage,
  runAutomationDryRun: automationDryRun,
  submitAutomationRuleVersion: automationRuleVersion,
  decideAutomationRuleReview: automationRuleVersion,
  publishAutomationRuleVersion: automationRuleVersion,
  discardAutomationRuleVersion: automationRuleVersion,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5BeH2Operations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const R = "/api/v1/admin/automation-rules";
  // The author holds both rights (ADM_METHOD configures, TO reviews) so the self-review refusal is reachable.
  const authorUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, authorUser.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  await grant(api.db, w.grantor.id, authorUser.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  const author = await signIn(api.app, authorUser.subject);
  const office = await signIn(api.app, w.office.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const ifm = (v: number) => ({ "if-match": `"${v}"` });
  const txA = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  const txB = await createTransformationRow(api.db, w.orgB.id, w.b1, w.grantor.id);
  const content = {
    triggerCodes: ["gate.decided"],
    conditions: [{ field: "gateCode", op: "eq", value: "G3" }],
    actions: [{ type: "notify", parameters: { recipientRole: "TL", messageKey: "automation.message.update_due" } }],
    runAs: "service",
  };
  const newRule = async () => {
    const res = await mirrored("POST", R, {
      session: author,
      body: {
        code: `contract.${uniq("h").toLowerCase()}`,
        nameEn: "Synthetic lifecycle rule",
        nameAr: "قاعدة دورة حياة تجريبية",
        scopeLevel: "organization",
        organizationId: w.orgA.id,
        ownerUserId: authorUser.id,
        content,
      },
    });
    expect(res.status).toBe(201);
    return `${R}/${(res.body as Body).id as string}`;
  };
  const sample = (transformationId: string) => ({
    triggerCode: "gate.decided",
    payload: {
      gateInstanceId: crypto.randomUUID(),
      transformationId,
      gateCode: "G3",
      submissionId: crypto.randomUUID(),
      submissionNo: 1,
      gateDecisionId: crypto.randomUUID(),
      outcome: "approved",
      decidedBy: crypto.randomUUID(),
      nextPhase: null,
      scaleScopeItemIds: [],
      conditionIds: [],
    },
  });

  const rule1 = await newRule();
  const v1 = `${rule1}/versions/1`;
  const runs = `${v1}/dry-runs`;

  // listAutomationDryRuns: 200; 403 without automation.read; 404 unknown rule.
  expect((await mirrored("GET", runs, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", runs, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${R}/${crypto.randomUUID()}/versions/1/dry-runs`, { session: author })).status).toBe(
    404,
  );

  // runAutomationDryRun: 201 pass; 201 fail (target outside the rule's scope); 422 sample_invalid; 400; 403 (AUD).
  const pass = await mirrored("POST", runs, { session: author, body: sample(txA) });
  expect([pass.status, (pass.body as Body).outcome]).toEqual([201, "pass"]);
  const fail = await mirrored("POST", runs, { session: author, body: sample(txB) });
  expect([fail.status, (fail.body as Body).outcome]).toEqual([201, "fail"]);
  const wrongTrigger = await mirrored("POST", runs, {
    session: author,
    body: { ...sample(txA), triggerCode: "gate.submitted" },
  });
  expect([wrongTrigger.status, (wrongTrigger.body as Body).code]).toEqual([422, "automation.dry_run_sample_invalid"]);
  expect((await mirrored("POST", runs, { session: author, body: { triggerCode: "gate.decided" } })).status).toBe(400);
  expect((await mirrored("POST", runs, { session: auditor, body: sample(txA) })).status).toBe(403);
  expect((await mirrored("GET", runs, { session: author })).status).toBe(200);

  // submitAutomationRuleVersion: 428; 409 stale; 403 (AUD); 422 dry_run_required (a second rule); 200; 422 transition.
  expect((await mirrored("POST", `${v1}/submit`, { session: author })).status).toBe(428);
  expect((await mirrored("POST", `${v1}/submit`, { session: author, headers: ifm(9) })).status).toBe(409);
  expect((await mirrored("POST", `${v1}/submit`, { session: auditor, headers: ifm(1) })).status).toBe(403);
  const rule2 = await newRule();
  const r2v1 = `${rule2}/versions/1`;
  const noRun = await mirrored("POST", `${r2v1}/submit`, { session: author, headers: ifm(1) });
  expect([noRun.status, (noRun.body as Body).code]).toEqual([422, "automation_rule_version.dry_run_required"]);
  const submitted = await mirrored("POST", `${v1}/submit`, { session: author, headers: ifm(1) });
  expect([submitted.status, (submitted.body as Body).status]).toEqual([200, "in_review"]);
  const again = await mirrored("POST", `${v1}/submit`, { session: author, headers: ifm(2) });
  expect([again.status, (again.body as Body).code]).toEqual([422, "automation_rule_version.invalid_transition"]);

  // runAutomationDryRun on a version that is no longer a draft: 409 not_editable.
  const notDraft = await mirrored("POST", runs, { session: author, body: sample(txA) });
  expect([notDraft.status, (notDraft.body as Body).code]).toEqual([409, "automation_rule_version.not_editable"]);

  // decideAutomationRuleReview: 400; 428; 409; 403 (AUD); 403 self_review; 422 transition (a draft); 200 approve.
  const approve = { outcome: "approve", note: "Synthetic configuration review." };
  expect(
    (await mirrored("POST", `${v1}/review`, { session: office, headers: ifm(2), body: { outcome: "x" } })).status,
  ).toBe(400);
  expect((await mirrored("POST", `${v1}/review`, { session: office, body: approve })).status).toBe(428);
  expect((await mirrored("POST", `${v1}/review`, { session: office, headers: ifm(9), body: approve })).status).toBe(
    409,
  );
  expect((await mirrored("POST", `${v1}/review`, { session: auditor, headers: ifm(2), body: approve })).status).toBe(
    403,
  );
  const self = await mirrored("POST", `${v1}/review`, { session: author, headers: ifm(2), body: approve });
  expect([self.status, (self.body as Body).code]).toEqual([403, "automation_rule_version.self_review"]);
  const onDraft = await mirrored("POST", `${r2v1}/review`, { session: office, headers: ifm(1), body: approve });
  expect([onDraft.status, (onDraft.body as Body).code]).toEqual([422, "automation_rule_version.invalid_transition"]);
  const approved = await mirrored("POST", `${v1}/review`, { session: office, headers: ifm(2), body: approve });
  expect([approved.status, (approved.body as Body).status]).toEqual([200, "approved"]);

  // publishAutomationRuleVersion (If-Match = the rule's version): 428; 409; 403 (AUD); 422 dry_run_required and
  // review_required (rule 2); 200; 422 transition.
  expect((await mirrored("POST", `${v1}/publish`, { session: author })).status).toBe(428);
  expect((await mirrored("POST", `${v1}/publish`, { session: author, headers: ifm(9) })).status).toBe(409);
  expect((await mirrored("POST", `${v1}/publish`, { session: auditor, headers: ifm(1) })).status).toBe(403);
  const r2NoRun = await mirrored("POST", `${r2v1}/publish`, { session: author, headers: ifm(1) });
  expect([r2NoRun.status, (r2NoRun.body as Body).code]).toEqual([422, "automation_rule_version.dry_run_required"]);
  expect((await mirrored("POST", `${r2v1}/dry-runs`, { session: author, body: sample(txA) })).status).toBe(201);
  const r2Review = await mirrored("POST", `${r2v1}/publish`, { session: author, headers: ifm(1) });
  expect([r2Review.status, (r2Review.body as Body).code]).toEqual([422, "automation_rule_version.review_required"]);
  const published = await mirrored("POST", `${v1}/publish`, { session: author, headers: ifm(1) });
  expect([published.status, (published.body as Body).status]).toEqual([200, "published"]);
  const twice = await mirrored("POST", `${v1}/publish`, { session: author, headers: ifm(2) });
  expect([twice.status, (twice.body as Body).code]).toEqual([422, "automation_rule_version.invalid_transition"]);

  // discardAutomationRuleVersion: 428; 409; 403 (AUD); 200; 422 transition (already discarded; a published version).
  expect((await mirrored("POST", `${r2v1}/discard`, { session: author })).status).toBe(428);
  expect((await mirrored("POST", `${r2v1}/discard`, { session: author, headers: ifm(9) })).status).toBe(409);
  expect((await mirrored("POST", `${r2v1}/discard`, { session: auditor, headers: ifm(1) })).status).toBe(403);
  const discarded = await mirrored("POST", `${r2v1}/discard`, { session: author, headers: ifm(1) });
  expect([discarded.status, (discarded.body as Body).status]).toEqual([200, "discarded"]);
  const gone = await mirrored("POST", `${r2v1}/discard`, { session: author, headers: ifm(2) });
  expect([gone.status, (gone.body as Body).code]).toEqual([422, "automation_rule_version.invalid_transition"]);
  const publishedDiscard = await mirrored("POST", `${v1}/discard`, { session: author, headers: ifm(4) });
  expect([publishedDiscard.status, (publishedDiscard.body as Body).code]).toEqual([
    422,
    "automation_rule_version.invalid_transition",
  ]);
}
