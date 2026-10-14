// Rule-version dry run, review where configured, publish and discard (ADR-0043 §4, §8, §9; REQ-S12-002; M0155;
// D-143 (5); D-145; p5-work-split §D.2; T-DG5-BE-H2) against a real PostgreSQL:
//  - REQ-S12-002: a dry run creates no work item, notification, execution or business record (counts before/after)
//    and records exactly one automation_dry_run (with its one audit event);
//  - submit without a pass dry run of the CURRENT content -> 422 automation_rule_version.dry_run_required;
//  - the author reviewing -> 403 automation_rule_version.self_review;
//  - publish with review required and none -> 422 automation_rule_version.review_required;
//  - TO switches review off (the config_review_policy row; see the note at that test) and a draft publishes after
//    its dry run;
//  - D-145 (ARCH-03 handback §4 item 3): EVERY publish writes the rule row (effective_version_id, version step, audit
//    event), so the deferred automation_rule_effective_check runs at COMMIT; the previous version is superseded;
//  - every mutation: AUD 403; If-Match 428/409; one audit event per row written; commit-time re-authorization.
// All people and data are synthetic. A rule review is a configuration review, never a business approval (G1-G6),
// and nothing here reads or writes the engineering gates DG0-DG7.
import { createDb, insertAuditEvent, sql, type Db } from "@mth/db";
import { TRANSFORMATION_MODES } from "@mth/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
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
let owner: Db;
let author: Session;
let authorId: string;
let office: Session;
let auditor: Session;
let methodOnly: Session;
let txA: string;
let txB: string;
let leadId: string;

const R = "/api/v1/admin/automation-rules";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const MODE = TRANSFORMATION_MODES[0];
const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };

/** An ADM_METHOD (configures rules) who is also TO (reviews), so the self-review refusal is reachable. */
async function authorUser(): Promise<{ id: string; subject: string }> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  return u;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  owner = createDb(api.owner);
  const a = await authorUser();
  authorId = a.id;
  author = await signIn(api.app, a.subject);
  office = await signIn(api.app, w.office.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  const m = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, m.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  methodOnly = await signIn(api.app, m.subject);
  txA = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  txB = await createTransformationRow(api.db, w.orgB.id, w.b1, w.grantor.id);
  const lead = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, lead.id, "TL", { type: "transformation", id: txA }, w.orgA.id);
  leadId = lead.id;
}, 60_000);
afterAll(() => api.close());

const notifyTl = { type: "notify", parameters: { recipientRole: "TL", messageKey: "automation.message.update_due" } };
const content = (extra: Record<string, unknown> = {}) => ({
  triggerCodes: ["gate.decided"],
  conditions: [{ field: "gateCode", op: "eq", value: "G3" }],
  actions: [notifyTl],
  runAs: "service",
  ...extra,
});
async function newRule(c: Record<string, unknown> = content(), session = author, ownerUserId = authorId) {
  const res = await call<Body>(api.app, "POST", R, {
    session,
    body: {
      code: `test.${uniq("l").toLowerCase()}`,
      nameEn: "Synthetic lifecycle rule",
      nameAr: "قاعدة دورة حياة تجريبية",
      scopeLevel: "organization",
      organizationId: w.orgA.id,
      ownerUserId,
      content: c,
    },
  });
  expect(res.status).toBe(201);
  return {
    id: res.body.id as string,
    url: `${R}/${res.body.id as string}`,
    v1: `${R}/${res.body.id as string}/versions/1`,
  };
}
const gateDecided = (transformationId: string, gateCode = "G3") => ({
  triggerCode: "gate.decided",
  payload: {
    gateInstanceId: crypto.randomUUID(),
    transformationId,
    gateCode,
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
const dryRun = (versionUrl: string, body: unknown, session = author) =>
  call<Body>(api.app, "POST", `${versionUrl}/dry-runs`, { session, body });
const post = (url: string, session: Session, headers: Record<string, string> = {}, body?: unknown) =>
  call<Body>(api.app, "POST", url, { session, headers, ...(body !== undefined ? { body } : {}) });
const versionRow = (ruleId: string, versionNo: number) =>
  api.db
    .selectFrom("automation_rule_version")
    .selectAll()
    .where("automation_rule_id", "=", ruleId)
    .where("version_no", "=", versionNo)
    .executeTakeFirstOrThrow();
const ruleRow = (ruleId: string) =>
  api.db.selectFrom("automation_rule").selectAll().where("id", "=", ruleId).executeTakeFirstOrThrow();
const actions = async (recordId: string) => (await auditOf(api.db, recordId)).map((a) => a.action);

const COUNTED = [
  "work_item",
  "inbox_notification",
  "automation_execution",
  "automation_action_result",
  "transformation",
  "approval",
  "outbox_event",
  "automation_dry_run",
  "audit_event",
] as const;
type Counts = Record<(typeof COUNTED)[number], number>;
/** Row counts of the effect and business tables a dry run must never write. */
async function counts(): Promise<Counts> {
  const out = {} as Counts;
  for (const t of COUNTED) {
    const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(t)}`.execute(api.db);
    out[t] = r.rows[0]!.n;
  }
  return out;
}

/** Sets the automation_rule_set review policy as the owner, audited (see the note in the test that uses it). */
async function setReviewRequired(required: boolean): Promise<void> {
  await owner.transaction().execute(async (tx) => {
    const p = await tx
      .selectFrom("config_review_policy")
      .selectAll()
      .where("config_kind", "=", "automation_rule_set")
      .executeTakeFirstOrThrow();
    if (p.review_required === required) return;
    await tx
      .updateTable("config_review_policy")
      .set({ review_required: required, version: p.version + 1 })
      .where("id", "=", p.id)
      .execute();
    await insertAuditEvent(tx, SYSTEM, {
      action: "test.seed",
      recordType: "config_review_policy",
      recordId: p.id,
      organizationId: null,
      newVersion: p.version + 1,
    });
  });
}

describe("dry run (REQ-S12-002: a dry-run creates no tasks)", () => {
  it("creates no work item, notification, execution or business record, and records exactly one automation_dry_run", async () => {
    const rule = await newRule();
    const before = await counts();
    const res = await dryRun(rule.v1, gateDecided(txA));
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`${rule.v1}/dry-runs/${res.body.id}`);
    const after = await counts();
    expect(after).toEqual({
      ...before,
      automation_dry_run: before.automation_dry_run + 1,
      audit_event: before.audit_event + 1,
    });
    expect(res.body).toMatchObject({ outcome: "pass", conditionsMet: true, findings: [], runBy: authorId });
    // It WOULD notify the TL of the transformation (a synthetic TL granted on it) — and wrote nothing.
    expect(res.body.plannedActions).toEqual([
      expect.objectContaining({
        ordinal: 1,
        actionType: "notify",
        outcome: "would_run",
        messageKey: "automation.message.update_due",
        target: expect.objectContaining({ transformationId: txA, roleCode: "TL", recipientUserIds: [leadId] }),
      }),
    ]);
    expect(await actions(res.body.id)).toEqual(["automation_dry_run.create"]);
    const list = await call<Body>(api.app, "GET", `${rule.v1}/dry-runs`, { session: auditor });
    expect(list.status).toBe(200);
    expect(list.body.items.map((d: Body) => d.id)).toEqual([res.body.id]);
    // The version shows the run and that it covers the current content.
    const v = await call<Body>(api.app, "GET", rule.v1, { session: author });
    expect(v.body).toMatchObject({ dryRunCurrent: true, lastDryRun: { id: res.body.id, outcome: "pass" } });
  });

  it("conditions not met -> pass with conditionsMet false; a target outside the rule's scope -> fail (automation.action_forbidden)", async () => {
    const rule = await newRule();
    const notMet = await dryRun(rule.v1, gateDecided(txA, "G2"));
    expect(notMet.body).toMatchObject({ outcome: "pass", conditionsMet: false, findings: [] });
    const outside = await dryRun(rule.v1, gateDecided(txB));
    expect(outside.status).toBe(201);
    expect(outside.body).toMatchObject({
      outcome: "fail",
      findings: [
        {
          code: "automation.action_forbidden",
          pointer: "/actions/0",
          messageEn:
            "The acting identity lacks the permission for this action, or its target is outside the rule's scope.",
        },
      ],
    });
    expect(outside.body.findings[0].messageAr.length).toBeGreaterThan(0);
    expect(outside.body.plannedActions[0]).toMatchObject({
      outcome: "forbidden",
      target: { reason: "outside_rule_scope" },
    });
  });

  it("a numeric condition with no usable value is not met and recorded as automation.condition_unknown_value (never 0)", async () => {
    const rule = await newRule(
      content({ triggerCodes: ["dependency.slipped"], conditions: [{ field: "slipDays", op: "gt", value: "3" }] }),
    );
    const sample = (payload: Record<string, unknown>) => ({ triggerCode: "dependency.slipped", payload });
    const missing = await dryRun(rule.v1, sample({ transformationId: txA }));
    expect(missing.body).toMatchObject({
      outcome: "fail",
      conditionsMet: null,
      findings: [{ code: "automation.condition_unknown_value", pointer: "/conditions/0" }],
    });
    const float = await dryRun(rule.v1, sample({ transformationId: txA, slipDays: 5.5 }));
    expect(float.body).toMatchObject({ outcome: "fail", findings: [{ code: "automation.condition_unknown_value" }] });
    const zero = await dryRun(rule.v1, sample({ transformationId: txA, slipDays: "0" }));
    expect(zero.body).toMatchObject({ outcome: "pass", conditionsMet: false });
    const met = await dryRun(rule.v1, sample({ transformationId: txA, slipDays: "3.5" }));
    expect(met.body).toMatchObject({ outcome: "pass", conditionsMet: true });
  });

  it("refuses a sample that does not match the trigger (422 automation.dry_run_sample_invalid); nothing written", async () => {
    const rule = await newRule();
    const before = await counts();
    const bad = [
      { ...gateDecided(txA), triggerCode: "gate.submitted" },
      { triggerCode: "gate.decided", payload: { gateCode: "G3" } },
      { triggerCode: "nope.unknown", payload: {} },
    ];
    for (const body of bad) {
      const res = await dryRun(rule.v1, body);
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        422,
        "automation.dry_run_sample_invalid",
        "The sample event does not match the trigger's event fields.",
      ]);
    }
    const dep = await newRule(content({ triggerCodes: ["dependency.slipped"], conditions: [] }));
    const unknownKey = await dryRun(dep.v1, { triggerCode: "dependency.slipped", payload: { secret: "x" } });
    expect(unknownKey.status).toBe(422);
    expect((await counts()).automation_dry_run).toBe(before.automation_dry_run);
  });

  it("initiating_user: a user who cannot read the target makes the action forbidden", async () => {
    const rule = await newRule(
      content({ triggerCodes: ["transformation.created"], conditions: [], runAs: "initiating_user" }),
    );
    const sample = (createdBy: string) => ({
      triggerCode: "transformation.created",
      payload: {
        transformationId: txA,
        organizationId: w.orgA.id,
        businessUnitId: w.a1,
        mode: MODE,
        entryPhase: null,
        standaloneDeliverableType: null,
        createdBy,
        occurredAt: new Date().toISOString(),
      },
    });
    const ok = await dryRun(rule.v1, sample(w.office.id));
    expect([ok.status, ok.body.outcome]).toEqual([201, "pass"]);
    const outsider = await dryRun(rule.v1, sample(w.officeB.id));
    expect(outsider.body).toMatchObject({ outcome: "fail", plannedActions: [{ outcome: "forbidden" }] });
  });

  it("a non-draft version -> 409 not_editable; AUD and TO 403; commit-time re-authorization (nothing written)", async () => {
    const rule = await newRule();
    for (const s of [auditor, office]) expect((await dryRun(rule.v1, gateDecided(txA), s)).status).toBe(403);
    const u = await authorUser();
    const s = await signIn(api.app, u.subject);
    const mine = await newRule(content(), s, u.id);
    const before = (await counts()).automation_dry_run;
    const res = await afterIdentity(
      api,
      u.id,
      () => dryRun(mine.v1, gateDecided(txA), s),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect((await counts()).automation_dry_run).toBe(before);
    expect((await dryRun(rule.v1, gateDecided(txA))).status).toBe(201);
    expect((await post(`${rule.v1}/discard`, author, ifm(1))).status).toBe(200);
    const closed = await dryRun(rule.v1, gateDecided(txA));
    expect([closed.status, closed.body.code]).toEqual([409, "automation_rule_version.not_editable"]);
  });
});

describe("submit, review where configured, publish, discard (REQ-S12-002; M0155)", () => {
  it("submit needs a pass dry run of the current content; it opens one review task per reviewer, never the author's", async () => {
    const rule = await newRule();
    const none = await post(`${rule.v1}/submit`, author, ifm(1));
    expect([none.status, none.body.code, none.body.detail]).toEqual([
      422,
      "automation_rule_version.dry_run_required",
      "Run a dry run of the current content before submitting or publishing.",
    ]);
    expect((await dryRun(rule.v1, gateDecided(txA))).body.outcome).toBe("pass");
    // A failing run does not count; an edit after the pass run makes it stale again.
    const edited = await call<Body>(api.app, "PATCH", rule.v1, {
      session: author,
      headers: ifm(1),
      body: { content: content({ conditions: [{ field: "gateCode", op: "eq", value: "G4" }] }) },
    });
    expect([edited.status, edited.body.dryRunCurrent]).toEqual([200, false]);
    expect((await post(`${rule.v1}/submit`, author, ifm(2))).body.code).toBe(
      "automation_rule_version.dry_run_required",
    );
    expect((await dryRun(rule.v1, gateDecided(txB))).body.outcome).toBe("fail");
    expect((await post(`${rule.v1}/submit`, author, ifm(2))).body.code).toBe(
      "automation_rule_version.dry_run_required",
    );
    expect((await dryRun(rule.v1, gateDecided(txA, "G4"))).body.outcome).toBe("pass");
    // If-Match, AUD, TO (no automation.configure).
    expect((await post(`${rule.v1}/submit`, author)).status).toBe(428);
    expect((await post(`${rule.v1}/submit`, author, ifm(1))).status).toBe(409);
    for (const s of [auditor, office]) expect((await post(`${rule.v1}/submit`, s, ifm(2))).status).toBe(403);
    const ok = await post(`${rule.v1}/submit`, author, ifm(2));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "in_review", version: 3 });
    expect(ok.headers.etag).toBe('"3"');
    const v = await versionRow(rule.id, 1);
    expect(await actions(v.id)).toEqual([
      "automation_rule_version.create",
      "automation_rule_version.update",
      "automation_rule_version.submit",
    ]);
    const items = await api.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "kind", "status", "dedupe_key", "message_key"])
      .where("subject_type", "=", "automation_rule_version")
      .where("subject_id", "=", v.id)
      .execute();
    expect(items.map((i) => i.assignee_user_id)).toContain(w.office.id);
    expect(items.map((i) => i.assignee_user_id)).not.toContain(authorId);
    for (const i of items)
      expect(i).toMatchObject({
        kind: "automation_rule_review",
        status: "open",
        message_key: "automation.task.rule_review",
        dedupe_key: `automation_rule_review:${v.id}:${i.assignee_user_id}`,
      });
    const twice = await post(`${rule.v1}/submit`, author, ifm(3));
    expect([twice.status, twice.body.code]).toEqual([422, "automation_rule_version.invalid_transition"]);
  });

  it("review: the author -> 403 self_review; ADM_METHOD without automation.review -> 403; changes requested need a note", async () => {
    const rule = await newRule();
    await dryRun(rule.v1, gateDecided(txA));
    expect((await post(`${rule.v1}/submit`, author, ifm(1))).status).toBe(200);
    const approve = { outcome: "approve", note: "Synthetic configuration review." };
    const self = await post(`${rule.v1}/review`, author, ifm(2), approve);
    expect([self.status, self.body.code, self.body.detail]).toEqual([
      403,
      "automation_rule_version.self_review",
      "You cannot review a version you authored.",
    ]);
    expect((await post(`${rule.v1}/review`, methodOnly, ifm(2), approve)).status).toBe(403);
    expect((await post(`${rule.v1}/review`, auditor, ifm(2), approve)).status).toBe(403);
    expect((await post(`${rule.v1}/review`, office, {}, approve)).status).toBe(428);
    expect((await post(`${rule.v1}/review`, office, ifm(1), approve)).status).toBe(409);
    expect((await post(`${rule.v1}/review`, office, ifm(2), { outcome: "request_changes" })).status).toBe(400);
    const back = await post(`${rule.v1}/review`, office, ifm(2), {
      outcome: "request_changes",
      note: "Synthetic: narrow the condition.",
    });
    expect(back.body).toMatchObject({
      status: "draft",
      reviewedBy: w.office.id,
      reviewNote: "Synthetic: narrow the condition.",
    });
    const v = await versionRow(rule.id, 1);
    const open = await api.db
      .selectFrom("work_item")
      .select("status")
      .where("subject_id", "=", v.id)
      .where("kind", "=", "automation_rule_review")
      .execute();
    expect(open.every((i) => i.status === "done")).toBe(true);
    expect(await actions(v.id)).toContain("automation_rule_version.review_request_changes");
    // A draft cannot be reviewed.
    const onDraft = await post(`${rule.v1}/review`, office, ifm(3), approve);
    expect([onDraft.status, onDraft.body.code]).toEqual([422, "automation_rule_version.invalid_transition"]);
  });

  it("publish with review required and none -> 422 review_required; after review, publish writes the rule row (D-145)", async () => {
    await setReviewRequired(true);
    const rule = await newRule();
    const noRun = await post(`${rule.v1}/publish`, author, ifm(1));
    expect([noRun.status, noRun.body.code]).toEqual([422, "automation_rule_version.dry_run_required"]);
    await dryRun(rule.v1, gateDecided(txA));
    const unreviewed = await post(`${rule.v1}/publish`, author, ifm(1));
    expect([unreviewed.status, unreviewed.body.code, unreviewed.body.detail]).toEqual([
      422,
      "automation_rule_version.review_required",
      "This version needs its configured review before it is published.",
    ]);
    expect((await post(`${rule.v1}/submit`, author, ifm(1))).status).toBe(200);
    expect(
      (await post(`${rule.v1}/review`, office, ifm(2), { outcome: "approve", note: "Synthetic configuration review." }))
        .body.status,
    ).toBe("approved");
    // If-Match is the RULE's version (still 1); AUD and TO are refused; a revoked grant is refused at commit.
    expect((await post(`${rule.v1}/publish`, author)).status).toBe(428);
    expect((await post(`${rule.v1}/publish`, author, ifm(3))).status).toBe(409);
    for (const s of [auditor, office]) expect((await post(`${rule.v1}/publish`, s, ifm(1))).status).toBe(403);
    const before = await ruleRow(rule.id);
    const ok = await post(`${rule.v1}/publish`, author, ifm(1));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "published", publishedBy: authorId });
    const after = await ruleRow(rule.id);
    const v1 = await versionRow(rule.id, 1);
    // The rule row was written: effective version, version step, audit event at that version.
    expect(after).toMatchObject({ effective_version_id: v1.id, version: before.version + 1, enabled: false });
    const ruleAudit = (await auditOf(api.db, rule.id)).filter((a) => a.action === "automation_rule.effective_version");
    expect(ruleAudit).toHaveLength(1);
    expect(await actions(v1.id)).toEqual([
      "automation_rule_version.create",
      "automation_rule_version.submit",
      "automation_rule_version.review_approve",
      "automation_rule_version.publish",
    ]);
    // Enabling works now (BE-H's operation), and the rule's GET names the effective version.
    expect((await post(`${rule.url}/enable`, author, ifm(after.version))).status).toBe(200);
    // v2: the second publish writes the rule row again and supersedes v1.
    const v2 = await post(`${rule.url}/versions`, author, ifm(after.version + 1), {});
    expect(v2.status).toBe(201);
    const v2url = `${rule.url}/versions/2`;
    await dryRun(v2url, gateDecided(txA));
    expect((await post(`${v2url}/submit`, author, ifm(1))).status).toBe(200);
    expect((await post(`${v2url}/review`, office, ifm(2), { outcome: "approve" })).status).toBe(200);
    const mid = await ruleRow(rule.id);
    expect((await post(`${v2url}/publish`, author, ifm(mid.version))).status).toBe(200);
    const end = await ruleRow(rule.id);
    const v2row = await versionRow(rule.id, 2);
    expect(end).toMatchObject({ effective_version_id: v2row.id, version: mid.version + 1, enabled: true });
    expect(
      (await auditOf(api.db, rule.id)).filter((a) => a.action === "automation_rule.effective_version"),
    ).toHaveLength(2);
    const old = await versionRow(rule.id, 1);
    expect(old.status).toBe("superseded");
    expect(old.superseded_at).not.toBeNull();
    expect((await actions(old.id)).at(-1)).toBe("automation_rule_version.supersede");
    const published = await api.db
      .selectFrom("automation_rule_version")
      .select("version_no")
      .where("automation_rule_id", "=", rule.id)
      .where("status", "=", "published")
      .execute();
    expect(published).toEqual([{ version_no: 2 }]);
    const again = await post(`${v2url}/publish`, author, ifm(end.version));
    expect([again.status, again.body.code]).toEqual([422, "automation_rule_version.invalid_transition"]);
  });

  it("TO switches review off and a draft publishes after its dry run (and still needs that dry run)", async () => {
    // NOTE: the switch is slice A's updateConfigReviewPolicy (BE-B3, running in parallel in W5; not routed in this
    // tree). Until it merges, the test flips the same config_review_policy row as the owner, audited, and restores it.
    await setReviewRequired(false);
    try {
      const rule = await newRule();
      const noRun = await post(`${rule.v1}/publish`, author, ifm(1));
      expect([noRun.status, noRun.body.code]).toEqual([422, "automation_rule_version.dry_run_required"]);
      expect((await dryRun(rule.v1, gateDecided(txA))).body.outcome).toBe("pass");
      const ok = await post(`${rule.v1}/publish`, author, ifm(1));
      expect([ok.status, ok.body.status, ok.body.reviewedBy]).toEqual([200, "published", null]);
      expect((await ruleRow(rule.id)).effective_version_id).toBe(ok.body.id);
      expect((await auditOf(api.db, rule.id)).map((a) => a.action)).toContain("automation_rule.effective_version");
    } finally {
      await setReviewRequired(true);
    }
  });

  it("commit-time re-authorization on publish: the grant revoked mid-request -> 403, nothing published", async () => {
    await setReviewRequired(false);
    try {
      const u = await authorUser();
      const s = await signIn(api.app, u.subject);
      const rule = await newRule(content(), s, u.id);
      await dryRun(rule.v1, gateDecided(txA), s);
      const res = await afterIdentity(
        api,
        u.id,
        () => post(`${rule.v1}/publish`, s, ifm(1)),
        () => revokeAll(api, w.grantor.id, u.id),
      );
      expect(res.status).toBe(403);
      expect((await versionRow(rule.id, 1)).status).toBe("draft");
      expect((await ruleRow(rule.id)).effective_version_id).toBeNull();
    } finally {
      await setReviewRequired(true);
    }
  });

  it("discard: an open version (its review tasks cancelled); If-Match; AUD 403; a published version -> 422", async () => {
    const rule = await newRule();
    await dryRun(rule.v1, gateDecided(txA));
    expect((await post(`${rule.v1}/submit`, author, ifm(1))).status).toBe(200);
    expect((await post(`${rule.v1}/discard`, author)).status).toBe(428);
    expect((await post(`${rule.v1}/discard`, author, ifm(1))).status).toBe(409);
    for (const s of [auditor, office]) expect((await post(`${rule.v1}/discard`, s, ifm(2))).status).toBe(403);
    const ok = await post(`${rule.v1}/discard`, author, ifm(2));
    expect(ok.body).toMatchObject({ status: "discarded" });
    expect(ok.body.discardedAt).not.toBeNull();
    const v = await versionRow(rule.id, 1);
    const items = await api.db.selectFrom("work_item").select("status").where("subject_id", "=", v.id).execute();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.status === "cancelled")).toBe(true);
    expect((await actions(v.id)).at(-1)).toBe("automation_rule_version.discard");
    const again = await post(`${rule.v1}/discard`, author, ifm(3));
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "automation_rule_version.invalid_transition",
      "This version cannot move to that state.",
    ]);
    // A new version can be opened after a discard (the one-open-version rule frees up).
    expect((await post(`${rule.url}/versions`, author, ifm(1), {})).status).toBe(201);
  });
});
