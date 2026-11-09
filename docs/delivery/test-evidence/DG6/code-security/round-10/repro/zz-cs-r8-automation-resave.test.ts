// code-security-reviewer, DG6 round 8 (T-DG6-REV-CS-R8). NOT part of the candidate: copied into a disposable clone's
// tests/qa/integration by checks.sh repro and removed afterwards. All data SYNTHETIC. Marking a record sensitive is an
// access decision, never a business approval (G1-G6); nothing here touches DG0-DG7.
//
// Question (D-222 (2) re-save rule, BE-Z12B keepRestrictedLiterals; matching by field, operator, k-th occurrence and
// list position): what happens to a hidden condition literal when a not-admitted rule author REMOVES an earlier
// condition with the same field and operator through the editor (ContentEditor "remove condition"), and sends the
// remaining marker back unchanged? Rule: [benefitId neq P, benefitId neq S(hidden), severity eq high] ("not these two
// benefits"). The author removes the first condition and saves. Logged, then asserted: the stored conditions must
// still exclude S (the hidden literal is kept), or the write must be refused; it must NOT silently store the marker
// text "[restricted]" as an ordinary literal (which drops the exclusion of S).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AUTOMATION_RESTRICTED_LITERAL } from "../../../packages/shared/src/schemas/automation.ts";
import { call, createUser, grant, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../../apps/api/test/support/harness.ts";
import { ifm } from "../../../apps/api/test/support/p2-fixtures.ts";
import { launchedInitiative, pendingBenefit, seedClosureWorld, type ClosureWorld } from "../../../apps/api/test/integration/contract/p4-exercises-be-j.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let c: ClosureWorld;
let admin: { id: string; session: Session };
const S = { hidden: "", plain: "", ruleId: "" };
const R = "/api/v1/admin/automation-rules";
const log = (...a: unknown[]) => console.log("[CS-R8-AUTO]", ...a);
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, { contract: false, ...o });

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  const ini = await launchedInitiative(api.db, c.b);
  S.hidden = (await pendingBenefit(api, c, ini)).id;
  S.plain = (await pendingBenefit(api, c, ini)).id;
  const u = await createUser(api.db, c.b.organizationId);
  await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: c.b.organizationId }, c.b.organizationId);
  admin = { id: u.id, session: await signIn(api.app, u.subject) };
  const rule = await send("POST", R, {
    session: admin.session,
    body: {
      code: `test.csr8.${randomUUID().slice(0, 8)}`,
      nameEn: "Synthetic variance follow-up (CS-R8)",
      nameAr: "متابعة انحراف تجريبية",
      scopeLevel: "organization",
      organizationId: c.b.organizationId,
      ownerUserId: admin.id,
      content: {
        triggerCodes: ["benefit.variance_evaluated"],
        conditions: [
          { field: "benefitId", op: "neq", value: S.plain },
          { field: "benefitId", op: "neq", value: S.hidden },
          { field: "severity", op: "eq", value: "high" },
        ],
        actions: [{ type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } }],
        runAs: "service",
      },
    },
  });
  log(`ADM_METHOD POST rule -> ${rule.status} ${rule.status === 201 ? "" : JSON.stringify(rule.body).slice(0, 400)}`);
  expect(rule.status).toBe(201);
  S.ruleId = rule.body.id;
  const mk = await send("PUT", `${c.b.base}/records/benefit/${S.hidden}/sensitivity`, {
    session: c.s.to.session,
    headers: ifm(0),
    body: { isSensitive: true, reason: "Synthetic sensitive benefit (CS-R8-AUTO)" },
  });
  log(`TO marks the benefit sensitive -> ${mk.status}`);
  expect(mk.status).toBe(200);
}, 240_000);
afterAll(() => api?.close());

const stored = async () =>
  (
    await api.db
      .selectFrom("automation_rule_version")
      .select(["conditions", "version", "status"])
      .where("automation_rule_id", "=", S.ruleId)
      .where("version_no", "=", 1)
      .executeTakeFirstOrThrow()
  ) as { conditions: Body; version: number; status: string };

describe("CS-R8-AUTO: removing an earlier same-(field, op) condition", () => {
  it("keeps the hidden literal or refuses; never stores the marker text in its place", async () => {
    const before = await stored();
    log(`stored before (status ${before.status}): ${JSON.stringify(before.conditions).replaceAll(S.hidden, "<HIDDEN>").replaceAll(S.plain, "<PLAIN>")}`);
    const shown = await send("GET", `${R}/${S.ruleId}/versions/1`, { session: admin.session });
    log(`author GET version 1 -> ${shown.status}: conditions=${JSON.stringify(shown.body.content?.conditions).replaceAll(S.plain, "<PLAIN>")} marker=${shown.body.includesRestrictedRecords} summary.en=${shown.body.summary?.en}`);
    expect(JSON.stringify(shown.body)).not.toContain(S.hidden);
    // The editor's "remove condition 1": the remaining conditions are sent back unchanged, the marker included.
    const content = { ...shown.body.content, conditions: shown.body.content.conditions.slice(1) };
    log(`author PATCH conditions=${JSON.stringify(content.conditions)}`);
    const saved = await send("PATCH", `${R}/${S.ruleId}/versions/1`, {
      session: admin.session,
      headers: ifm(shown.body.version),
      body: { content, changeSummary: "Synthetic: remove the first exclusion" },
    });
    log(`-> ${saved.status} ${saved.status === 200 ? `marker=${saved.body.includesRestrictedRecords} conditions=${JSON.stringify(saved.body.content.conditions)}` : JSON.stringify(saved.body).slice(0, 400)}`);
    const after = await stored();
    const text = JSON.stringify(after.conditions).replaceAll(S.hidden, "<HIDDEN>").replaceAll(S.plain, "<PLAIN>");
    log(`stored after: ${text}`);
    log(`hidden exclusion kept: ${JSON.stringify(after.conditions).includes(S.hidden)}; marker text stored as a literal: ${JSON.stringify(after.conditions).includes(AUTOMATION_RESTRICTED_LITERAL)}`);
    const toView = await send("GET", `${R}/${S.ruleId}/versions/1`, { session: c.s.to.session });
    log(`TO (admitted) GET version 1 -> ${toView.status} conditions=${JSON.stringify(toView.body.content?.conditions ?? toView.body).replaceAll(S.hidden, "<HIDDEN>").slice(0, 300)}`);
    if (saved.status === 200) {
      expect(JSON.stringify(after.conditions)).not.toContain(AUTOMATION_RESTRICTED_LITERAL);
      expect(JSON.stringify(after.conditions)).toContain(S.hidden);
    } else expect(saved.status).toBeGreaterThanOrEqual(400);
  });
});
