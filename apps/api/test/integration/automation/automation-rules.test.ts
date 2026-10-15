// Automation rules, versions, the builder catalogue and enable/disable (ADR-0043 §1-§4, §8, §9; REQ-S12-001,
// REQ-S12-002, REQ-S12-026; D-142 Q3; p5-work-split §D.1; T-DG5-BE-H) against a real PostgreSQL:
//  - REQ-S12-026: saving a rule whose action is `approve_gate` (and each of the other five human-only codes) -> 422
//    automation_rule.human_only_action, nothing written (create and version update);
//  - REQ-S12-002: disabling a starter -> 422 automation_rule.guarantee_protected; disabling an admin rule needs a
//    reason; enabling without an effective version -> 422 automation_rule.no_effective_version; a starter version with
//    a condition -> 422 automation_rule.starter_fixed; `initiating_user` on a schedule trigger -> 422; a service
//    permission `approval.decide` -> 422;
//  - REQ-S12-001: a rule is stored with trigger, conditions, actions, scope, owner and versions (effective version);
//  - every mutation: ADM_METHOD positive; AUD and TO 403; If-Match 428/409; one audit event per row written;
//    authorization re-checked at commit time (403, nothing written); readers see only their organizations' rules.
// The starters are shared seeded rows: a test that opens a starter draft discards it again (as the owner, audited),
// so no other suite ever meets an open starter version. All data is synthetic; nothing here approves anything, and
// nothing reads or writes the engineering gates DG0-DG7.
import { createDb, insertAuditEvent, type Db } from "@mth/db";
import { HUMAN_ONLY_ACTION_CODES } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  auditOfRequest,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let admin: Session;
let adminId: string;
let reviewerId: string;
let auditor: Session;
let office: Session;
let officeB: Session;
let txA: string;
let txB: string;
let owner: Db;

const R = "/api/v1/admin/automation-rules";
const CAT = "/api/v1/admin/automation-catalogue";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };

async function methodAdmin(): Promise<{ id: string; subject: string }> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  return u;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  owner = createDb(api.owner);
  const a = await methodAdmin();
  adminId = a.id;
  admin = await signIn(api.app, a.subject);
  reviewerId = (await createUser(api.db, w.orgA.id)).id;
  auditor = await signIn(api.app, w.auditor.subject);
  office = await signIn(api.app, w.office.subject);
  officeB = await signIn(api.app, w.officeB.subject);
  txA = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  txB = await createTransformationRow(api.db, w.orgB.id, w.b1, w.grantor.id);
}, 60_000);
afterAll(() => api.close());

const task = { type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } };
const content = (extra: Record<string, unknown> = {}) => ({
  triggerCodes: ["gate.decided"],
  conditions: [{ field: "gateCode", op: "eq", value: "G2" }],
  actions: [task],
  runAs: "service",
  ...extra,
});
const ruleBody = (extra: Record<string, unknown> = {}) => ({
  code: `test.${uniq("r").toLowerCase()}`,
  nameEn: "Synthetic follow-up rule",
  nameAr: "قاعدة متابعة تجريبية",
  scopeLevel: "organization",
  organizationId: w.orgA.id,
  ownerUserId: adminId,
  content: content(),
  ...extra,
});
const createRule = (body: Record<string, unknown> = ruleBody(), session = admin) =>
  call<Body>(api.app, "POST", R, { session, body });
const actions = async (recordId: string) => (await auditOf(api.db, recordId)).map((a) => a.action);
const ruleRows = (code: string) => api.db.selectFrom("automation_rule").select("id").where("code", "=", code).execute();

/** Publishes `versionNo` of `ruleId` as the owner through the 0074 state machine (dry run, review, publish), audited. */
async function publishAsOwner(ruleId: string, versionNo: number): Promise<void> {
  await owner.transaction().execute(async (tx) => {
    const v = await tx
      .selectFrom("automation_rule_version")
      .selectAll()
      .where("automation_rule_id", "=", ruleId)
      .where("version_no", "=", versionNo)
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
        run_by: adminId,
      })
      .execute();
    await insertAuditEvent(tx, SYSTEM, {
      action: "test.seed",
      recordType: "automation_dry_run",
      recordId: runId,
      organizationId: w.orgA.id,
    });
    const steps: Record<string, unknown>[] = [
      { status: "in_review", submitted_at: new Date() },
      { status: "approved", reviewed_by: reviewerId, reviewed_at: new Date() },
      { status: "published", published_by: adminId, published_at: new Date() },
    ];
    let version = v.version;
    for (const s of steps) {
      version += 1;
      await tx
        .updateTable("automation_rule_version")
        .set({ ...s, version })
        .where("id", "=", v.id)
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "automation_rule_version",
        recordId: v.id,
        organizationId: w.orgA.id,
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
      organizationId: w.orgA.id,
      newVersion: rule.version + 1,
    });
  });
}

/** Discards every open version of a (starter) rule as the owner, audited, so no other suite meets it. */
async function discardOpenAsOwner(ruleId: string): Promise<void> {
  await owner.transaction().execute(async (tx) => {
    const open = await tx
      .selectFrom("automation_rule_version")
      .selectAll()
      .where("automation_rule_id", "=", ruleId)
      .where("status", "in", ["draft", "in_review", "approved"])
      .execute();
    for (const v of open) {
      await tx
        .updateTable("automation_rule_version")
        .set({ status: "discarded", discarded_at: new Date(), version: v.version + 1 })
        .where("id", "=", v.id)
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "automation_rule_version",
        recordId: v.id,
        organizationId: null,
        newVersion: v.version + 1,
      });
    }
  });
}

async function starter(code: string): Promise<Body> {
  const list = await call<Body>(api.app, "GET", `${R}?origin=starter&limit=50`, { session: admin });
  return list.body.items.find((r: Body) => r.code === code);
}

describe("getAutomationCatalogue (ADR-0043 §2)", () => {
  it("lists the triggers and action types; human-only types are named and never selectable; readers only", async () => {
    const res = await call<Body>(api.app, "GET", CAT, { session: auditor });
    expect(res.status).toBe(200);
    expect(res.body.triggers.length).toBeGreaterThanOrEqual(31);
    const decided = res.body.triggers.find((t: Body) => t.code === "gate.decided");
    expect(decided).toMatchObject({
      triggerKind: "event",
      conditionFields: ["gateCode", "outcome"],
      adminSelectable: true,
    });
    expect(res.body.triggers.find((t: Body) => t.code === "transformation.created").hasInitiatingUser).toBe(true);
    const types = new Map(res.body.actionTypes.map((a: Body) => [a.code, a]));
    for (const code of HUMAN_ONLY_ACTION_CODES)
      expect(types.get(code), code).toMatchObject({ actionClass: "human_only", adminSelectable: false });
    expect(types.get("create_task")).toMatchObject({ actionClass: "automatic", adminSelectable: true });
    expect((types.get("create_task") as Body).parametersSchema.required).toEqual(["assigneeRole", "messageKey"]);
    expect(types.get("starter_handler")).toMatchObject({ adminSelectable: false });
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await call(api.app, "GET", CAT, { session: nobody })).status).toBe(403);
  });
});

describe("createAutomationRule (REQ-S12-001; ADR-0043 §1, §4)", () => {
  it("creates a disabled admin rule with draft version 1; one audit event per row; the code is unique", async () => {
    const body = ruleBody();
    const res = await createRule(body);
    expect(res.status).toBe(201);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.headers["location"]).toBe(`${R}/${res.body.id}`);
    expect(res.body).toMatchObject({
      code: body.code,
      origin: "admin",
      sourceRef: null,
      scopeLevel: "organization",
      organizationId: w.orgA.id,
      transformationId: null,
      ownerUserId: adminId,
      ownerRoleCode: null,
      enabled: false,
      disableAllowed: true,
      effectiveVersionId: null,
      effectiveVersionNo: null,
      openVersionNo: 1,
      summary: null,
      version: 1,
    });
    const v1 = await call<Body>(api.app, "GET", `${R}/${res.body.id}/versions/1`, { session: auditor });
    expect(v1.status).toBe(200);
    expect(v1.body).toMatchObject({
      versionNo: 1,
      status: "draft",
      authoredBy: adminId,
      lastDryRun: null,
      dryRunCurrent: false,
      content: { triggerCodes: ["gate.decided"], runAs: "service", servicePermissionCodes: [], parameters: {} },
    });
    expect(v1.body.summary.en).toBe(
      "When Gate decided, if gateCode is G2: Create a task with an in-app reminder (TL). Runs as the service identity.",
    );
    expect(v1.body.summary.ar).toContain("البت في البوابة");
    expect(await actions(res.body.id)).toEqual(["automation_rule.create"]);
    expect(await actions(v1.body.id)).toEqual(["automation_rule_version.create"]);
    const dup = await createRule({ ...ruleBody(), code: body.code });
    expect([dup.status, dup.body.code]).toEqual([409, "automation_rule.code_taken"]);
  });

  it("a transformation-scoped rule names a transformation of its organization in the caller's scope", async () => {
    const ok = await createRule(ruleBody({ scopeLevel: "transformation", transformationId: txA }));
    expect([ok.status, ok.body.scopeLevel, ok.body.transformationId]).toEqual([201, "transformation", txA]);
    for (const bad of [
      ruleBody({ scopeLevel: "transformation" }),
      ruleBody({ scopeLevel: "organization", transformationId: txA }),
      ruleBody({ scopeLevel: "transformation", transformationId: txB }),
      ruleBody({ organizationId: w.orgB.id }),
    ]) {
      const res = await createRule(bad);
      expect([res.status, res.body.code], JSON.stringify(bad)).toEqual([422, "automation_rule.scope_invalid"]);
      expect(await ruleRows(bad.code)).toEqual([]);
    }
    const owner2 = await createRule(ruleBody({ ownerUserId: w.officeB.id }));
    expect([owner2.status, owner2.body.code]).toEqual([422, "validation.user_invalid"]);
  });

  it("REQ-S12-026: approve_gate and each other human-only action -> 422 human_only_action; nothing written", async () => {
    for (const code of HUMAN_ONLY_ACTION_CODES) {
      const body = ruleBody({ content: content({ actions: [task, { type: code }] }) });
      const res = await createRule(body);
      expect([res.status, res.body.code, res.body.detail], code).toEqual([
        422,
        "automation_rule.human_only_action",
        "Approvals, investment decisions and Finance attestations are human decisions and cannot be automated.",
      ]);
      expect(await ruleRows(body.code)).toEqual([]);
      expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([]);
    }
  });

  it("refuses initiating_user on a schedule trigger, an approval right for the service identity, unknown parts", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [
        content({ triggerCodes: ["automation.tick_daily"], conditions: [], runAs: "initiating_user" }),
        "automation_rule.initiating_user_unavailable",
      ],
      [content({ servicePermissionCodes: ["approval.decide"] }), "automation_rule.service_permission_forbidden"],
      [content({ triggerCodes: ["gate.submission_requested"], conditions: [] }), "automation_rule.trigger_unknown"],
      [content({ actions: [{ type: "starter_handler" }] }), "automation_rule.action_unknown"],
      [content({ conditions: [{ field: "slipDays", op: "gt", value: "2" }] }), "automation_rule.condition_invalid"],
      [
        content({ actions: [{ type: "notify", parameters: { recipientRole: "TL" } }] }),
        "automation_rule.action_parameters_invalid",
      ],
    ];
    for (const [c, code] of cases) {
      const body = ruleBody({ content: c });
      const res = await createRule(body);
      expect([res.status, res.body.code], code).toEqual([422, code]);
      expect(await ruleRows(body.code)).toEqual([]);
    }
    // A float in a condition value is not a decimal string: refused (never coerced).
    const flt = await createRule(
      ruleBody({ content: content({ conditions: [{ field: "gateCode", op: "gt", value: 1.5 }] }) }),
    );
    expect(flt.status).toBe(400);
    // initiating_user is allowed when every trigger names one.
    const ok = await createRule(
      ruleBody({
        content: content({ triggerCodes: ["transformation.created"], conditions: [], runAs: "initiating_user" }),
      }),
    );
    expect(ok.status).toBe(201);
  });

  it("AUD and TO get 403; commit-time re-authorization refuses a grant revoked mid-request (nothing written)", async () => {
    for (const s of [auditor, office]) {
      const body = ruleBody();
      expect((await createRule(body, s)).status).toBe(403);
      expect(await ruleRows(body.code)).toEqual([]);
    }
    const u = await methodAdmin();
    const s = await signIn(api.app, u.subject);
    const body = ruleBody({ ownerUserId: u.id });
    const res = await afterIdentity(
      api,
      u.id,
      () => createRule(body, s),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await ruleRows(body.code)).toEqual([]);
  });
});

describe("list/get/update rules (ADR-0043 §8)", () => {
  it("lists the sixteen starters (guarantees, enabled, never disableable) and the reader's organizations' rules", async () => {
    const mine = await createRule();
    const starters = await call<Body>(api.app, "GET", `${R}?origin=starter&limit=50`, { session: auditor });
    expect(starters.status).toBe(200);
    expect(starters.body.items).toHaveLength(16);
    for (const s of starters.body.items) {
      expect(s).toMatchObject({
        origin: "starter",
        scopeLevel: "platform",
        enabled: true,
        disableAllowed: false,
        ownerRoleCode: "ADM_METHOD",
      });
      expect(s.effectiveVersionNo).toBeGreaterThanOrEqual(1);
      expect(s.summary.en).toMatch(/^When /);
    }
    // Readers of another organization never see org A's admin rules (404 on get; absent from lists).
    const b = await call<Body>(api.app, "GET", `${R}?origin=admin&limit=100`, { session: officeB });
    expect(b.status).toBe(200);
    expect(b.body.items.some((r: Body) => r.organizationId === w.orgA.id)).toBe(false);
    expect((await call(api.app, "GET", `${R}/${mine.body.id}`, { session: officeB })).status).toBe(404);
    expect((await call(api.app, "GET", `${R}/${mine.body.id}/versions`, { session: officeB })).status).toBe(404);
    const a = await call<Body>(api.app, "GET", `${R}/${mine.body.id}`, { session: office });
    expect([a.status, a.headers["etag"]]).toEqual([200, '"1"']);
    const paged = await call<Body>(api.app, "GET", `${R}?origin=starter&limit=10`, { session: auditor });
    const next = await call<Body>(api.app, "GET", `${R}?origin=starter&limit=10&cursor=${paged.body.nextCursor}`, {
      session: auditor,
    });
    expect(paged.body.items.length + next.body.items.length).toBe(16);
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await call(api.app, "GET", R, { session: nobody })).status).toBe(403);
  });

  it("updates an admin rule's names and owner with If-Match (428/409), audited; AUD 403; a starter's description is fixed", async () => {
    const r = await createRule();
    const url = `${R}/${r.body.id}`;
    expect((await call(api.app, "PATCH", url, { session: admin, body: { nameEn: "Renamed" } })).status).toBe(428);
    const stale = await call<Body>(api.app, "PATCH", url, {
      session: admin,
      headers: ifm(9),
      body: { nameEn: "Renamed" },
    });
    expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    expect(
      (await call(api.app, "PATCH", url, { session: auditor, headers: ifm(1), body: { nameEn: "x" } })).status,
    ).toBe(403);
    const ok = await call<Body>(api.app, "PATCH", url, {
      session: admin,
      headers: ifm(1),
      body: { nameEn: "Synthetic renamed rule", descriptionEn: "Synthetic description", ownerUserId: reviewerId },
    });
    expect([ok.status, ok.body.version, ok.body.nameEn, ok.body.ownerUserId]).toEqual([
      200,
      2,
      "Synthetic renamed rule",
      reviewerId,
    ]);
    expect(await actions(r.body.id)).toEqual(["automation_rule.create", "automation_rule.update"]);
    const s = await starter("starter.job_failed");
    const fixed = await call<Body>(api.app, "PATCH", `${R}/${s.id}`, {
      session: admin,
      headers: ifm(s.version),
      body: { descriptionEn: "Synthetic" },
    });
    expect([fixed.status, fixed.body.code]).toEqual([422, "automation_rule.starter_fixed"]);
  });
});

describe("enable/disable (REQ-S12-002; D-142 Q3)", () => {
  it("disabling a starter -> 422 guarantee_protected; nothing written", async () => {
    const s = await starter("starter.gate_approved");
    const res = await call<Body>(api.app, "POST", `${R}/${s.id}/disable`, {
      session: admin,
      headers: ifm(s.version),
      body: { reason: "Synthetic attempt to disable a guarantee" },
    });
    expect([res.status, res.body.code]).toEqual([422, "automation_rule.guarantee_protected"]);
    expect(res.body.detail).toBe(
      "This starter automation implements a guarantee approved in an earlier stage and cannot be disabled. You can change its settings in a new version.",
    );
    const after = await starter("starter.gate_approved");
    expect([after.enabled, after.version]).toEqual([true, s.version]);
  });

  it("enable needs an effective version; then enable and disable (with a reason) are audited and If-Match-guarded", async () => {
    const r = await createRule();
    const id = r.body.id as string;
    const none = await call<Body>(api.app, "POST", `${R}/${id}/enable`, { session: admin, headers: ifm(1) });
    expect([none.status, none.body.code, none.body.detail]).toEqual([
      422,
      "automation_rule.no_effective_version",
      "Publish a version before enabling the rule.",
    ]);
    await publishAsOwner(id, 1);
    expect((await call(api.app, "POST", `${R}/${id}/enable`, { session: admin })).status).toBe(428);
    expect((await call(api.app, "POST", `${R}/${id}/enable`, { session: admin, headers: ifm(1) })).status).toBe(409);
    expect((await call(api.app, "POST", `${R}/${id}/enable`, { session: auditor, headers: ifm(2) })).status).toBe(403);
    const on = await call<Body>(api.app, "POST", `${R}/${id}/enable`, { session: admin, headers: ifm(2) });
    expect([on.status, on.body.enabled, on.body.version, on.body.effectiveVersionNo]).toEqual([200, true, 3, 1]);
    expect(on.body.summary.en).toMatch(/^When Gate decided/);
    // Disabling an admin rule needs a reason.
    const noReason = await call<Body>(api.app, "POST", `${R}/${id}/disable`, {
      session: admin,
      headers: ifm(3),
      body: {},
    });
    expect(noReason.status).toBe(400);
    const blank = await call<Body>(api.app, "POST", `${R}/${id}/disable`, {
      session: admin,
      headers: ifm(3),
      body: { reason: "   " },
    });
    expect(blank.status).toBe(400);
    expect(
      (
        await call(api.app, "POST", `${R}/${id}/disable`, {
          session: office,
          headers: ifm(3),
          body: { reason: "Synthetic" },
        })
      ).status,
    ).toBe(403);
    const off = await call<Body>(api.app, "POST", `${R}/${id}/disable`, {
      session: admin,
      headers: ifm(3),
      body: { reason: "Synthetic pause for the test" },
    });
    expect([off.status, off.body.enabled, off.body.disabledReason, off.body.version]).toEqual([
      200,
      false,
      "Synthetic pause for the test",
      4,
    ]);
    const trail = (await auditOf(api.db, id)).map((a) => [a.action, a.new_version]);
    expect(trail.filter(([a]) => a !== "test.seed")).toEqual([
      ["automation_rule.create", 1],
      ["automation_rule.enable", 3],
      ["automation_rule.disable", 4],
    ]);
  });
});

describe("rule versions (ADR-0043 §1, §4)", () => {
  it("one open version per rule; a new draft copies the effective version; content edits rehash; published never changes", async () => {
    const r = await createRule();
    const id = r.body.id as string;
    const dup = await call<Body>(api.app, "POST", `${R}/${id}/versions`, { session: admin, headers: ifm(1), body: {} });
    expect([dup.status, dup.body.code]).toEqual([409, "automation_rule_version.draft_exists"]);
    await publishAsOwner(id, 1);
    expect((await call(api.app, "POST", `${R}/${id}/versions`, { session: admin, body: {} })).status).toBe(428);
    expect(
      (await call(api.app, "POST", `${R}/${id}/versions`, { session: admin, headers: ifm(1), body: {} })).status,
    ).toBe(409);
    expect(
      (await call(api.app, "POST", `${R}/${id}/versions`, { session: auditor, headers: ifm(2), body: {} })).status,
    ).toBe(403);
    const v2 = await call<Body>(api.app, "POST", `${R}/${id}/versions`, {
      session: admin,
      headers: ifm(2),
      body: { changeSummary: "Synthetic second version" },
    });
    expect(v2.status).toBe(201);
    expect(v2.headers["location"]).toBe(`${R}/${id}/versions/2`);
    const v1 = await call<Body>(api.app, "GET", `${R}/${id}/versions/1`, { session: admin });
    expect(v2.body).toMatchObject({
      versionNo: 2,
      status: "draft",
      changeSummary: "Synthetic second version",
      version: 1,
    });
    expect(v2.body.contentSha256).toBe(v1.body.contentSha256);
    expect(v2.body.content).toEqual(v1.body.content);
    // Content edit: If-Match on the version; the hash changes; audited once.
    const url = `${R}/${id}/versions/2`;
    const next = content({ conditions: [{ field: "outcome", op: "in", value: ["approved", "conditional"] }] });
    expect((await call(api.app, "PATCH", url, { session: admin, body: { content: next } })).status).toBe(428);
    expect(
      (await call(api.app, "PATCH", url, { session: admin, headers: ifm(5), body: { content: next } })).status,
    ).toBe(409);
    expect(
      (await call(api.app, "PATCH", url, { session: auditor, headers: ifm(1), body: { content: next } })).status,
    ).toBe(403);
    const edited = await call<Body>(api.app, "PATCH", url, {
      session: admin,
      headers: ifm(1),
      body: { content: next },
    });
    expect([edited.status, edited.body.version]).toEqual([200, 2]);
    expect(edited.body.contentSha256).not.toBe(v1.body.contentSha256);
    expect(edited.body.content.conditions).toEqual(next.conditions);
    expect(await actions(v2.body.id)).toEqual(["automation_rule_version.create", "automation_rule_version.update"]);
    // REQ-S12-026 on a draft edit: refused before any write; the draft is unchanged.
    for (const code of HUMAN_ONLY_ACTION_CODES) {
      const bad = await call<Body>(api.app, "PATCH", url, {
        session: admin,
        headers: ifm(2),
        body: { content: content({ actions: [{ type: code }] }) },
      });
      expect([bad.status, bad.body.code], code).toEqual([422, "automation_rule.human_only_action"]);
    }
    expect((await call<Body>(api.app, "GET", url, { session: admin })).body.version).toBe(2);
    expect(await actions(v2.body.id)).toEqual(["automation_rule_version.create", "automation_rule_version.update"]);
    // A published version never changes.
    const frozen = await call<Body>(api.app, "PATCH", `${R}/${id}/versions/1`, {
      session: admin,
      headers: ifm(v1.body.version),
      body: { content: next },
    });
    expect([frozen.status, frozen.body.code]).toEqual([409, "automation_rule_version.not_editable"]);
    const list = await call<Body>(api.app, "GET", `${R}/${id}/versions`, { session: auditor });
    expect(list.body.items.map((v: Body) => [v.versionNo, v.status])).toEqual([
      [2, "draft"],
      [1, "published"],
    ]);
    expect(list.body.items[1].lastDryRun).toMatchObject({ outcome: "pass" });
    expect((await call(api.app, "GET", `${R}/${id}/versions/9`, { session: auditor })).status).toBe(404);
  });

  it("commit-time re-authorization on a version edit: the grant revoked mid-request -> 403, the draft unchanged", async () => {
    const u = await methodAdmin();
    const s = await signIn(api.app, u.subject);
    const r = await createRule(ruleBody({ ownerUserId: u.id }), s);
    const url = `${R}/${r.body.id}/versions/1`;
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "PATCH", url, { session: s, headers: ifm(1), body: { changeSummary: "Synthetic change" } }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect((await call<Body>(api.app, "GET", url, { session: admin })).body).toMatchObject({
      version: 1,
      changeSummary: null,
    });
  });

  it("REQ-S12-002: a starter version takes settings only; a condition -> 422 starter_fixed (the draft is discarded after)", async () => {
    const s = await starter("starter.dependency_slip");
    try {
      const v = await call<Body>(api.app, "POST", `${R}/${s.id}/versions`, {
        session: admin,
        headers: ifm(s.version),
        body: {},
      });
      expect([v.status, v.body.status]).toEqual([201, "draft"]);
      // The draft copies the starter's effective version. Read it rather than assume the seeded value: starters are
      // shared seeded rows, and another suite (starters-be-j.test.ts) may already have published a later version in
      // the same database (D-153).
      const effective = await call<Body>(api.app, "GET", `${R}/${s.id}/versions/${s.effectiveVersionNo}`, {
        session: admin,
      });
      expect(effective.status).toBe(200);
      expect(effective.body.content.parameters.minimumSlipDays).toBeGreaterThanOrEqual(1);
      expect(v.body.content).toMatchObject({
        triggerCodes: ["dependency.slipped"],
        conditions: [],
        parameters: effective.body.content.parameters,
      });
      const url = `${R}/${s.id}/versions/${v.body.versionNo}`;
      const withCondition = await call<Body>(api.app, "PATCH", url, {
        session: admin,
        headers: ifm(1),
        body: { content: { ...v.body.content, conditions: [{ field: "slipDays", op: "gt", value: "5" }] } },
      });
      expect([withCondition.status, withCondition.body.code, withCondition.body.detail]).toEqual([
        422,
        "automation_rule.starter_fixed",
        "A starter automation keeps its trigger and handler and takes no conditions; only its settings can change.",
      ]);
      const badSetting = await call<Body>(api.app, "PATCH", url, {
        session: admin,
        headers: ifm(1),
        body: { content: { ...v.body.content, parameters: { minimumSlipDays: 0 } } },
      });
      expect([badSetting.status, badSetting.body.code]).toEqual([422, "automation_rule.action_parameters_invalid"]);
      const setting = await call<Body>(api.app, "PATCH", url, {
        session: admin,
        headers: ifm(1),
        body: { content: { ...v.body.content, parameters: { minimumSlipDays: 3 } } },
      });
      expect([setting.status, setting.body.content.parameters]).toEqual([200, { minimumSlipDays: 3 }]);
      // The starter itself is unchanged: still enabled, same effective version.
      const after = await starter("starter.dependency_slip");
      expect([after.enabled, after.effectiveVersionNo, after.openVersionNo]).toEqual([
        true,
        s.effectiveVersionNo,
        v.body.versionNo,
      ]);
    } finally {
      await discardOpenAsOwner(s.id);
    }
  });
});
