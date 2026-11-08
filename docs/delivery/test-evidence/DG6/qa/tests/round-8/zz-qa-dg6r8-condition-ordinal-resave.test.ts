// qa-verifier DG6 round 8 (T-DG6-REV-QA-R8) on candidate 6cda8b33 (source d84d11a6): independent probe, NOT part of the
// frozen candidate. Copied into a disposable clone as apps/api/test/integration/access/zz-qa-dg6r8-condition-ordinal-resave.test.ts
// and run with tests/qa/support/with-pg.sh on a disposable PostgreSQL.
// Question (D-222 re-save rule; D-225 open question "challenge D-222 to D-224"): keepRestrictedLiterals pairs the k-th
// condition of the request that has a given field and operator with the k-th stored condition of the same field and
// operator. When a rule has TWO restricted literals under the same field and operator, the author (not admitted) sees two
// identical markers. If the author deletes the FIRST and saves, which literal does the server keep for the remaining one?
// Also: does the author's view or the response show anything that tells the author what happened?
// The fixture is the in-tree T-DG6-BE-Z12B one (seedClosureWorld, pendingBenefit, an ADM_METHOD author, the TO marks).
// Every value is SYNTHETIC; marking a record sensitive is an access decision, never a G1-G6 business approval; nothing
// here touches DG0-DG7.
import { AUTOMATION_RESTRICTED_LITERAL } from "@mth/shared/schemas";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { launchedInitiative, pendingBenefit, seedClosureWorld, type ClosureWorld } from "../contract/p4-exercises-be-j.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let c: ClosureWorld;
let admin: { id: string; session: Session };
const B = { x: "", y: "" };
let ruleId = "";
const R = "/api/v1/admin/automation-rules";
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status);
  return res.body as Body;
};
const stored = async () =>
  (
    (await api.db
      .selectFrom("automation_rule_version")
      .select(["conditions"])
      .where("automation_rule_id", "=", ruleId)
      .where("version_no", "=", 1)
      .executeTakeFirstOrThrow()) as { conditions: Body }
  ).conditions;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  const ini = await launchedInitiative(api.db, c.b);
  B.x = (await pendingBenefit(api, c, ini)).id;
  B.y = (await pendingBenefit(api, c, ini)).id;
  const u = await createUser(api.db, c.b.organizationId);
  await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: c.b.organizationId }, c.b.organizationId);
  admin = { id: u.id, session: await signIn(api.app, u.subject) };
  const rule = ok(
    await send("POST", R, {
      session: admin.session,
      body: {
        code: `qa.r8.${randomUUID().slice(0, 8)}`,
        nameEn: "QA-R8 synthetic ordinal probe",
        nameAr: "فحص ترتيبي تجريبي",
        scopeLevel: "organization",
        organizationId: c.b.organizationId,
        ownerUserId: admin.id,
        content: {
          triggerCodes: ["benefit.variance_evaluated"],
          conditions: [
            { field: "benefitId", op: "neq", value: B.x },
            { field: "benefitId", op: "neq", value: B.y },
            { field: "severity", op: "eq", value: "high" },
          ],
          actions: [{ type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } }],
          runAs: "service",
        },
      },
    }),
    201,
  );
  ruleId = rule.id;
  for (const id of [B.x, B.y])
    ok(
      await send("PUT", `${c.b.base}/records/benefit/${id}/sensitivity`, {
        session: c.s.to.session,
        headers: ifm(0),
        body: { isSensitive: true, reason: "QA-R8 synthetic sensitive benefit" },
      }),
    );
}, 240_000);
afterAll(() => api?.close());

describe("QA-R8: the re-save rule with two restricted literals under one field and operator", () => {
  it("the author sees two identical markers; deleting the FIRST and saving keeps which literal?", async () => {
    const shown = ok(await send("GET", `${R}/${ruleId}/versions/1`, { session: admin.session }));
    expect(shown.content.conditions.slice(0, 2)).toEqual([
      { field: "benefitId", op: "neq", value: AUTOMATION_RESTRICTED_LITERAL },
      { field: "benefitId", op: "neq", value: AUTOMATION_RESTRICTED_LITERAL },
    ]);
    // The author removes condition 0 (benefitId neq X) and keeps condition 1 (benefitId neq Y).
    const sent = shown.content.conditions.filter((_: Body, i: number) => i !== 0);
    const saved = ok(
      await send("PATCH", `${R}/${ruleId}/versions/1`, {
        session: admin.session,
        headers: ifm(shown.version),
        body: { content: { ...shown.content, conditions: sent }, changeSummary: "QA-R8 remove the first exclusion" },
      }),
    );
    const now = await stored();
    const kept = now[0]?.value;
    console.log(
      `QA-R8 ordinal: X=${B.x} (deleted) Y=${B.y} (kept by the author); stored now ${JSON.stringify(now)}; ` +
        `the remaining condition holds ${kept === B.y ? "Y (intended)" : kept === B.x ? "X (the deleted one)" : String(kept)}; ` +
        `author response conditions ${JSON.stringify(saved.content.conditions)} marker ${saved.includesRestrictedRecords}`,
    );
    expect(kept, "the condition the author kept keeps its own literal (Y)").toBe(B.y);
  });
});
