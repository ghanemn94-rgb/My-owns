// P5 contract exercises of BE-H (p5-work-split §D.1 and §2 rule 14; T-DG5-BE-H): the eleven slice D operations it
// routes (the builder catalogue, rules, enable/disable, rule versions), each with a success and every declared refusal
// it can reach, through the validating client. Enabling needs a published version, which BE-H2's lifecycle routes
// will produce; until then this seam publishes version 1 as the migration owner through the 0074 state machine (dry
// run, review by a second synthetic person, publish), audited. Every value is synthetic; nothing approves anything.
import { createDb, insertAuditEvent } from "@mth/db";
import {
  automationCatalogue,
  automationRule,
  automationRulePage,
  automationRuleVersion,
  automationRuleVersionPage,
} from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import { createUser, grant, signIn, uniq, type P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_BE_H: Readonly<Record<string, z.ZodType>> = {
  getAutomationCatalogue: automationCatalogue,
  listAutomationRules: automationRulePage,
  createAutomationRule: automationRule,
  getAutomationRule: automationRule,
  updateAutomationRule: automationRule,
  enableAutomationRule: automationRule,
  disableAutomationRule: automationRule,
  listAutomationRuleVersions: automationRuleVersionPage,
  createAutomationRuleVersion: automationRuleVersion,
  getAutomationRuleVersion: automationRuleVersion,
  updateAutomationRuleVersion: automationRuleVersion,
};

const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5BeHOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const R = "/api/v1/admin/automation-rules";
  const adminUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, adminUser.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  const reviewer = await createUser(api.db, w.orgA.id);
  const admin = await signIn(api.app, adminUser.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const officeB = await signIn(api.app, w.officeB.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const ifm = (v: number) => ({ "if-match": `"${v}"` });
  const content = {
    triggerCodes: ["gate.decided"],
    conditions: [{ field: "gateCode", op: "eq", value: "G3" }],
    actions: [{ type: "notify", parameters: { recipientRole: "TL", messageKey: "automation.message.update_due" } }],
    runAs: "service",
  };
  const code = `contract.${uniq("r").toLowerCase()}`;
  const body = {
    code,
    nameEn: "Synthetic contract rule",
    nameAr: "قاعدة عقد تجريبية",
    scopeLevel: "organization",
    organizationId: w.orgA.id,
    ownerUserId: adminUser.id,
    content,
  };

  // getAutomationCatalogue: 200; 403 without automation.read.
  expect((await mirrored("GET", "/api/v1/admin/automation-catalogue", { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", "/api/v1/admin/automation-catalogue", { session: nobody })).status).toBe(403);

  // createAutomationRule: 201; 409 code_taken; 422 human_only_action; 403 (AUD); 400.
  const created = await mirrored("POST", R, { session: admin, body });
  expect(created.status).toBe(201);
  const ruleId = (created.body as Body).id as string;
  const dup = await mirrored("POST", R, { session: admin, body });
  expect([dup.status, (dup.body as Body).code]).toEqual([409, "automation_rule.code_taken"]);
  const human = await mirrored("POST", R, {
    session: admin,
    body: { ...body, code: `${code}.x`, content: { ...content, actions: [{ type: "approve_gate" }] } },
  });
  expect([human.status, (human.body as Body).code]).toEqual([422, "automation_rule.human_only_action"]);
  expect((await mirrored("POST", R, { session: auditor, body: { ...body, code: `${code}.y` } })).status).toBe(403);
  expect((await mirrored("POST", R, { session: admin, body: { ...body, code: "X" } })).status).toBe(400);

  // listAutomationRules: 200 (filters); 403.
  expect((await mirrored("GET", `${R}?origin=starter&enabled=true&limit=5`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", R, { session: nobody })).status).toBe(403);

  // getAutomationRule: 200; 404 (unknown, or another organization's rule); 403.
  expect((await mirrored("GET", `${R}/${ruleId}`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${R}/${crypto.randomUUID()}`, { session: auditor })).status).toBe(404);
  expect((await mirrored("GET", `${R}/${ruleId}`, { session: officeB })).status).toBe(404);
  expect((await mirrored("GET", `${R}/${ruleId}`, { session: nobody })).status).toBe(403);

  // updateAutomationRule: 200; 428; 409; 403; 404; 400; 422 (a starter's description is fixed).
  const url = `${R}/${ruleId}`;
  expect(
    (await mirrored("PATCH", url, { session: admin, headers: ifm(1), body: { nameEn: "Synthetic contract rule 2" } }))
      .status,
  ).toBe(200);
  expect((await mirrored("PATCH", url, { session: admin, body: { nameEn: "x" } })).status).toBe(428);
  expect((await mirrored("PATCH", url, { session: admin, headers: ifm(1), body: { nameEn: "x" } })).status).toBe(409);
  expect((await mirrored("PATCH", url, { session: auditor, headers: ifm(2), body: { nameEn: "x" } })).status).toBe(403);
  expect(
    (await mirrored("PATCH", `${R}/${crypto.randomUUID()}`, { session: admin, headers: ifm(1), body: { nameEn: "x" } }))
      .status,
  ).toBe(404);
  expect((await mirrored("PATCH", url, { session: admin, headers: ifm(2), body: { nameEn: "" } })).status).toBe(400);
  const starters = (await mirrored("GET", `${R}?origin=starter&limit=50`, { session: admin })).body as Body;
  const starter = starters.items.find((r: Body) => r.code === "starter.benefit_evidence");
  const fixed = await mirrored("PATCH", `${R}/${starter.id}`, {
    session: admin,
    headers: ifm(starter.version),
    body: { descriptionEn: "Synthetic" },
  });
  expect([fixed.status, (fixed.body as Body).code]).toEqual([422, "automation_rule.starter_fixed"]);

  // listAutomationRuleVersions / getAutomationRuleVersion: 200; 404; 403.
  expect((await mirrored("GET", `${url}/versions?limit=5`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${url}/versions`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${R}/${crypto.randomUUID()}/versions`, { session: auditor })).status).toBe(404);
  expect((await mirrored("GET", `${url}/versions/1`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${url}/versions/7`, { session: auditor })).status).toBe(404);
  expect((await mirrored("GET", `${url}/versions/1`, { session: nobody })).status).toBe(403);

  // updateAutomationRuleVersion: 200; 428; 409 stale; 403; 404; 400; 422.
  const v1 = `${url}/versions/1`;
  expect(
    (await mirrored("PATCH", v1, { session: admin, headers: ifm(1), body: { changeSummary: "Synthetic change" } }))
      .status,
  ).toBe(200);
  expect((await mirrored("PATCH", v1, { session: admin, body: { changeSummary: "Synthetic" } })).status).toBe(428);
  expect(
    (await mirrored("PATCH", v1, { session: admin, headers: ifm(1), body: { changeSummary: "Synthetic" } })).status,
  ).toBe(409);
  expect(
    (await mirrored("PATCH", v1, { session: auditor, headers: ifm(2), body: { changeSummary: "Synthetic" } })).status,
  ).toBe(403);
  expect(
    (await mirrored("PATCH", `${url}/versions/7`, { session: admin, headers: ifm(1), body: { changeSummary: "abc" } }))
      .status,
  ).toBe(404);
  expect((await mirrored("PATCH", v1, { session: admin, headers: ifm(2), body: { content: {} } })).status).toBe(400);
  const humanEdit = await mirrored("PATCH", v1, {
    session: admin,
    headers: ifm(2),
    body: { content: { ...content, actions: [{ type: "decide_investment" }] } },
  });
  expect([humanEdit.status, (humanEdit.body as Body).code]).toEqual([422, "automation_rule.human_only_action"]);

  // enableAutomationRule: 422 no_effective_version; then (version 1 published) 200; 428; 409; 403; 404.
  const enable = `${url}/enable`;
  const none = await mirrored("POST", enable, { session: admin, headers: ifm(2) });
  expect([none.status, (none.body as Body).code]).toEqual([422, "automation_rule.no_effective_version"]);
  await publishAsOwner(ctx, ruleId, adminUser.id, reviewer.id, w.orgA.id);
  expect((await mirrored("POST", enable, { session: admin })).status).toBe(428);
  expect((await mirrored("POST", enable, { session: admin, headers: ifm(2) })).status).toBe(409);
  expect((await mirrored("POST", enable, { session: auditor, headers: ifm(3) })).status).toBe(403);
  expect(
    (await mirrored("POST", `${R}/${crypto.randomUUID()}/enable`, { session: admin, headers: ifm(1) })).status,
  ).toBe(404);
  expect((await mirrored("POST", enable, { session: admin, headers: ifm(3) })).status).toBe(200);

  // disableAutomationRule: 200 with a reason; 400 without; 422 guarantee_protected (a starter); 428; 409; 403; 404.
  const disable = `${url}/disable`;
  const reason = { reason: "Synthetic contract pause" };
  expect((await mirrored("POST", disable, { session: admin, headers: ifm(4), body: {} })).status).toBe(400);
  expect((await mirrored("POST", disable, { session: admin, body: reason })).status).toBe(428);
  expect((await mirrored("POST", disable, { session: admin, headers: ifm(3), body: reason })).status).toBe(409);
  expect((await mirrored("POST", disable, { session: auditor, headers: ifm(4), body: reason })).status).toBe(403);
  expect(
    (await mirrored("POST", `${R}/${crypto.randomUUID()}/disable`, { session: admin, headers: ifm(1), body: reason }))
      .status,
  ).toBe(404);
  const guarantee = await mirrored("POST", `${R}/${starter.id}/disable`, {
    session: admin,
    headers: ifm(starter.version),
    body: reason,
  });
  expect([guarantee.status, (guarantee.body as Body).code]).toEqual([422, "automation_rule.guarantee_protected"]);
  expect((await mirrored("POST", disable, { session: admin, headers: ifm(4), body: reason })).status).toBe(200);

  // createAutomationRuleVersion: 201; 409 draft_exists; 428; 409 stale; 403; 404; 400.
  const versions = `${url}/versions`;
  expect((await mirrored("POST", versions, { session: admin, body: {} })).status).toBe(428);
  expect((await mirrored("POST", versions, { session: admin, headers: ifm(4), body: {} })).status).toBe(409);
  expect((await mirrored("POST", versions, { session: auditor, headers: ifm(5), body: {} })).status).toBe(403);
  expect(
    (await mirrored("POST", `${R}/${crypto.randomUUID()}/versions`, { session: admin, headers: ifm(1), body: {} }))
      .status,
  ).toBe(404);
  expect(
    (await mirrored("POST", versions, { session: admin, headers: ifm(5), body: { changeSummary: "x" } })).status,
  ).toBe(400);
  expect(
    (await mirrored("POST", versions, { session: admin, headers: ifm(5), body: { changeSummary: "Synthetic v2" } }))
      .status,
  ).toBe(201);
  const open = await mirrored("POST", versions, { session: admin, headers: ifm(5), body: {} });
  expect([open.status, (open.body as Body).code]).toEqual([409, "automation_rule_version.draft_exists"]);
  // A published version never changes: 409 not_editable.
  const frozen = await mirrored("PATCH", v1, { session: admin, headers: ifm(5), body: { changeSummary: "Synthetic" } });
  expect([frozen.status, (frozen.body as Body).code]).toEqual([409, "automation_rule_version.not_editable"]);
}

/** Publishes version 1 as the owner through the 0074 state machine, each step audited (synthetic reviewer). */
async function publishAsOwner(
  ctx: P5ExerciseContext,
  ruleId: string,
  authorId: string,
  reviewerId: string,
  organizationId: string,
): Promise<void> {
  const owner = createDb(ctx.api.owner);
  await owner.transaction().execute(async (tx) => {
    const v = await tx
      .selectFrom("automation_rule_version")
      .selectAll()
      .where("automation_rule_id", "=", ruleId)
      .where("version_no", "=", 1)
      .executeTakeFirstOrThrow();
    const runId = uuidv7();
    await tx
      .insertInto("automation_dry_run")
      .values({
        id: runId,
        automation_rule_version_id: v.id,
        content_sha256: v.content_sha256,
        sample_event: JSON.stringify({ fixture: true }),
        outcome: "pass",
        run_by: authorId,
      })
      .execute();
    await insertAuditEvent(tx, SYSTEM, {
      action: "test.seed",
      recordType: "automation_dry_run",
      recordId: runId,
      organizationId,
    });
    let version = v.version;
    for (const step of [
      { status: "in_review", submitted_at: new Date() },
      { status: "approved", reviewed_by: reviewerId, reviewed_at: new Date() },
      { status: "published", published_by: authorId, published_at: new Date() },
    ]) {
      version += 1;
      await tx
        .updateTable("automation_rule_version")
        .set({ ...step, version })
        .where("id", "=", v.id)
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "automation_rule_version",
        recordId: v.id,
        organizationId,
        newVersion: version,
      });
    }
    const rule = await tx.selectFrom("automation_rule").selectAll().where("id", "=", ruleId).executeTakeFirstOrThrow();
    await tx
      .updateTable("automation_rule")
      .set({ effective_version_id: v.id, version: rule.version + 1 })
      .where("id", "=", ruleId)
      .execute();
    await insertAuditEvent(tx, SYSTEM, {
      action: "test.seed",
      recordType: "automation_rule",
      recordId: ruleId,
      organizationId,
      newVersion: rule.version + 1,
    });
  });
}
