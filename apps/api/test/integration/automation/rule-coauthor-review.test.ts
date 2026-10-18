// F-DG5-100 on the other "review where configured" path (D-170; REQ-S12-002; M0155; ADR-0043 §4, §9; migration 0097;
// T-DG5-BE-V1): automation rule versions. Any `automation.configure` holder of the rule's organization may change a
// draft version that another admin authored (PATCH updateAutomationRuleVersion), so the same co-author gap existed:
// the decision compared the decider with `authored_by` only (lifecycle.ts, 0074 CHECK automation_rule_version_review_sod).
// Now:
//  - a second admin who also holds TO and rewrote the version's content is refused at the decision (403
//    automation_rule_version.self_review), gets no review task, and the version, still in review, cannot be published
//    (422 automation_rule_version.invalid_transition);
//  - a reviewer who wrote nothing approves, and the version publishes;
//  - a reviewer who requested changes did not become an author by deciding, and decides the next round;
//  - the database refuses a contributor's decision through the runtime role (mth_app), under
//    automation_rule_version_reviewer_not_contributor, mapped to the same 403.
// All people and data are synthetic. A rule review is a configuration review, never a business approval (G1-G6), and
// nothing here reads or writes the engineering gates DG0-DG7.
import { sql, type Tx } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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

let api: TestApi;
let w: World;
let author: Session;
let authorId: string;
let coAuthor: Session;
let coAuthorId: string;
let independent: Session;
let independentId: string;
let txA: string;

const R = "/api/v1/admin/automation-rules";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code];

/** ADM_METHOD (configures rules) and TO (reviews), both at organization scope. */
async function adminReviewer(): Promise<{ id: string; subject: string }> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  return u;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const a = await adminReviewer();
  authorId = a.id;
  author = await signIn(api.app, a.subject);
  const c = await adminReviewer();
  coAuthorId = c.id;
  coAuthor = await signIn(api.app, c.subject);
  const t = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, t.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  independentId = t.id;
  independent = await signIn(api.app, t.subject);
  txA = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
}, 60_000);
afterAll(() => api.close());

const notifyTl = { type: "notify", parameters: { recipientRole: "TL", messageKey: "automation.message.update_due" } };
const content = (gateCode = "G3") => ({
  triggerCodes: ["gate.decided"],
  conditions: [{ field: "gateCode", op: "eq", value: gateCode }],
  actions: [notifyTl],
  runAs: "service",
});
const gateDecided = (gateCode: string) => ({
  triggerCode: "gate.decided",
  payload: {
    gateInstanceId: crypto.randomUUID(),
    transformationId: txA,
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
const post = (url: string, session: Session, headers: Record<string, string> = {}, body?: unknown) =>
  call<Body>(api.app, "POST", url, { session, headers, ...(body !== undefined ? { body } : {}) });
const versionRow = (ruleId: string) =>
  api.db
    .selectFrom("automation_rule_version")
    .selectAll()
    .where("automation_rule_id", "=", ruleId)
    .where("version_no", "=", 1)
    .executeTakeFirstOrThrow();
const contributorsOf = async (versionId: string): Promise<string[]> =>
  (
    await api.db
      .selectFrom("automation_rule_version_contributor")
      .select("user_id")
      .where("automation_rule_version_id", "=", versionId)
      .orderBy("user_id")
      .execute()
  ).map((r) => r.user_id);
const approve = { outcome: "approve", note: "Synthetic configuration review." };

/** A rule authored by `author`; its v1 content rewritten by `writer` (G4), dry-run and submitted by `author`. */
async function submitted(writer: Session): Promise<{ id: string; v1: string; versionId: string }> {
  const res = await call<Body>(api.app, "POST", R, {
    session: author,
    body: {
      code: `test.${uniq("co").toLowerCase()}`,
      nameEn: "Synthetic co-author rule",
      nameAr: "قاعدة تجريبية لمؤلف مشارك",
      scopeLevel: "organization",
      organizationId: w.orgA.id,
      ownerUserId: authorId,
      content: content(),
    },
  });
  expect(res.status).toBe(201);
  const id = res.body.id as string;
  const v1 = `${R}/${id}/versions/1`;
  const edited = await call<Body>(api.app, "PATCH", v1, {
    session: writer,
    headers: ifm(1),
    body: { content: content("G4"), changeSummary: "Rewritten by a second admin." },
  });
  expect(edited.status).toBe(200);
  const run = await post(`${v1}/dry-runs`, author, {}, gateDecided("G4"));
  expect([run.status, run.body.outcome]).toEqual([201, "pass"]);
  const sub = await post(`${v1}/submit`, author, ifm(2));
  expect([sub.status, sub.body.status]).toEqual([200, "in_review"]);
  return { id, v1, versionId: (await versionRow(id)).id };
}
const ruleVersion = async (ruleId: string) =>
  (await api.db.selectFrom("automation_rule").select("version").where("id", "=", ruleId).executeTakeFirstOrThrow())
    .version;

describe("F-DG5-100 on rule versions: a co-author never decides the review of the content they wrote", () => {
  it("the co-author's approval is 403 automation_rule_version.self_review; publish stays refused; a non-author approves", async () => {
    const rule = await submitted(coAuthor);
    expect(await contributorsOf(rule.versionId)).toEqual([authorId, coAuthorId].sort());
    const self = await post(`${rule.v1}/review`, coAuthor, ifm(3), approve);
    expect([self.status, self.body.code, self.body.detail]).toEqual([
      403,
      "automation_rule_version.self_review",
      "You cannot review a version you authored.",
    ]);
    const back = await post(`${rule.v1}/review`, coAuthor, ifm(3), {
      outcome: "request_changes",
      note: "Not mine to send back.",
    });
    expect(codeOf(back)).toEqual([403, "automation_rule_version.self_review"]);
    // No review task for either author.
    const items = await api.db
      .selectFrom("work_item")
      .select("assignee_user_id")
      .where("subject_type", "=", "automation_rule_version")
      .where("subject_id", "=", rule.versionId)
      .execute();
    expect(items.map((i) => i.assignee_user_id)).toContain(independentId);
    expect(items.map((i) => i.assignee_user_id)).not.toContain(coAuthorId);
    expect(items.map((i) => i.assignee_user_id)).not.toContain(authorId);
    // The refused decision left the version in review, so publishing it is refused (in_review never publishes).
    const early = await post(`${rule.v1}/publish`, coAuthor, ifm(await ruleVersion(rule.id)));
    expect(codeOf(early)).toEqual([422, "automation_rule_version.invalid_transition"]);
    expect((await versionRow(rule.id)).status).toBe("in_review");
    // A reviewer who wrote nothing approves; the version publishes.
    const ok = await post(`${rule.v1}/review`, independent, ifm(3), approve);
    expect([ok.status, ok.body.status]).toEqual([200, "approved"]);
    const pub = await post(`${rule.v1}/publish`, author, ifm(await ruleVersion(rule.id)));
    expect([pub.status, pub.body.status]).toEqual([200, "published"]);
    expect(await contributorsOf(rule.versionId)).toEqual([authorId, coAuthorId].sort());
  });

  it("deciding a round does not make the reviewer an author: the same reviewer decides the next round", async () => {
    const rule = await submitted(author);
    expect(await contributorsOf(rule.versionId)).toEqual([authorId]);
    const back = await post(`${rule.v1}/review`, coAuthor, ifm(3), { outcome: "request_changes", note: "Explain G4." });
    expect([back.status, back.body.status]).toEqual([200, "draft"]);
    expect(await contributorsOf(rule.versionId)).toEqual([authorId]);
    const edited = await call<Body>(api.app, "PATCH", rule.v1, {
      session: author,
      headers: ifm(4),
      body: { changeSummary: "G4 is the decision gate for this synthetic rule." },
    });
    expect(edited.status).toBe(200);
    expect((await post(`${rule.v1}/submit`, author, ifm(5))).status).toBe(200);
    const ok = await post(`${rule.v1}/review`, coAuthor, ifm(6), approve);
    expect([ok.status, ok.body.status]).toEqual([200, "approved"]);
  });
});

describe("F-DG5-100 on rule versions at the database (0097)", () => {
  const ROLLBACK = new Error("rollback");
  async function inRolledBack(fn: (tx: Tx) => Promise<void>): Promise<string> {
    let outcome = "ok";
    await api.db
      .transaction()
      .execute(async (tx) => {
        try {
          await fn(tx);
        } catch (err) {
          outcome = (err as { constraint?: string }).constraint ?? String(err);
        }
        throw ROLLBACK;
      })
      .catch((e: unknown) => {
        if (e !== ROLLBACK) throw e;
      });
    return outcome;
  }
  const decideDirectly = (versionId: string, by: string) =>
    sql`UPDATE automation_rule_version SET status = 'approved', reviewed_by = ${by}::uuid, reviewed_at = now(),
          version = version + 1, updated_at = now(), updated_by = ${by}::uuid WHERE id = ${versionId}::uuid`;

  it("the runtime role cannot record a co-author's or the author's decision; an independent one passes the guard", async () => {
    const rule = await submitted(coAuthor);
    expect(await inRolledBack(async (tx) => void (await decideDirectly(rule.versionId, coAuthorId).execute(tx)))).toBe(
      "automation_rule_version_reviewer_not_contributor",
    );
    expect(await inRolledBack(async (tx) => void (await decideDirectly(rule.versionId, authorId).execute(tx)))).toBe(
      "automation_rule_version_reviewer_not_contributor",
    );
    expect(
      await inRolledBack(async (tx) => void (await decideDirectly(rule.versionId, independentId).execute(tx))),
    ).toBe("ok");
  });

  it("the contributor record is append-only for the runtime role", async () => {
    const rule = await submitted(author);
    for (const stmt of [
      sql`UPDATE automation_rule_version_contributor SET user_id = ${independentId}::uuid
           WHERE automation_rule_version_id = ${rule.versionId}::uuid`,
      sql`DELETE FROM automation_rule_version_contributor WHERE automation_rule_version_id = ${rule.versionId}::uuid`,
    ])
      expect(await inRolledBack(async (tx) => void (await stmt.execute(tx)))).toMatch(/append-only|permission denied/);
    expect(await contributorsOf(rule.versionId)).toEqual([authorId]);
  });
});
