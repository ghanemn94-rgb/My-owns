// qa-verifier DG6 clean re-gate round 1 (T-DG6-REV-QA-RG-R1): independent probe of the D-226 / D-228 (1) / D-233
// restricted-token sequences, the open question the assignment asks QA to judge (D-238: "a token sequence that loses or
// misplaces a hidden literal after edits, grant changes or concurrent saves"). It runs on the real API with a
// disposable PostgreSQL. To run it, copy it to apps/api/test/integration/access/ in a DISPOSABLE clone of the candidate
// (it is kept here, outside the frozen candidate, by the review protocol). Cases the shipped z13/z14/z15 suites do not
// cover:
//   (1) one token duplicated into two conditions and into a mixed `in` list next to an open literal;
//   (2) a token moved into an ordering condition (gt), then a dry run: nothing in the dry-run response, the dry-run
//       list, the version list or the rule names the hidden id;
//   (3) draft v2 created from the published v1 by a writer without the grant: v2 issues its own tokens, a reorder in
//       v2 keeps the hidden literal in v2, and v1 is unchanged;
//   (4) two concurrent saves with the same If-Match and the same tokens: exactly one wins, the loser changes nothing,
//       the hidden literal sits only where the winner put it;
//   (5) a grant given to the writer between read and save, then revoked: the literal survives both transitions.
// Every value is SYNTHETIC. Marking a record sensitive is an access decision, not a business approval (G1-G6). The
// publish helper is a synthetic configuration review, not a business approval; nothing here touches DG0-DG7.
import { createDb, insertAuditEvent, type Db } from "@mth/db";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
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
import {
  launchedInitiative,
  pendingBenefit,
  seedClosureWorld,
  type ClosureWorld,
} from "../contract/p4-exercises-be-j.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
type Cond = { field: string; op: string; value?: string | string[] };
let api: TestApi;
let owner: Db;
let w: World;
let c: ClosureWorld;
let ini: Awaited<ReturnType<typeof launchedInitiative>>;
let author: { id: string; session: Session };
const R = "/api/v1/admin/automation-rules";
const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };
const TOKEN = /^\[restricted:([0-9a-f]{24}):([1-9][0-9]{0,3})\]$/;
const neq = (v: string): Cond => ({ field: "benefitId", op: "neq", value: v });
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status);
  return res.body as Body;
};
const hiddenIds: string[] = [];
const leaks = (body: unknown) => hiddenIds.filter((x) => JSON.stringify(body).includes(x));
const benefit = async () => (await pendingBenefit(api, c, ini)).id as string;
async function markSensitive(id: string) {
  hiddenIds.push(id);
  ok(
    await send("PUT", `${c.b.base}/records/benefit/${id}/sensitivity`, {
      session: c.s.to.session,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit (QA R1 probe)" },
    }),
  );
}
async function createRule(conditions: Cond[]): Promise<string> {
  const rule = ok(
    await send("POST", R, {
      session: author.session,
      body: {
        code: `test.qar1.${randomUUID().slice(0, 8)}`,
        nameEn: "Synthetic token probe (QA R1)",
        nameAr: "فحص رمز تجريبي",
        scopeLevel: "organization",
        organizationId: c.b.organizationId,
        ownerUserId: author.id,
        content: {
          triggerCodes: ["benefit.variance_evaluated"],
          conditions,
          actions: [
            { type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } },
          ],
          runAs: "service",
        },
      },
    }),
    201,
  );
  return rule.id as string;
}
const url = (ruleId: string, versionNo: number) => `${R}/${ruleId}/versions/${versionNo}`;
const stored = async (ruleId: string, versionNo = 1) =>
  (await api.db
    .selectFrom("automation_rule_version")
    .select(["id", "conditions", "version"])
    .where("automation_rule_id", "=", ruleId)
    .where("version_no", "=", versionNo)
    .executeTakeFirstOrThrow()) as { id: string; conditions: Cond[]; version: number };
const read = async (ruleId: string, versionNo = 1) =>
  ok(await send("GET", url(ruleId, versionNo), { session: author.session }));
const patch = (ruleId: string, version: number, content: Body, versionNo = 1) =>
  send("PATCH", url(ruleId, versionNo), { session: author.session, headers: ifm(version), body: { content } });

async function publish(ruleId: string, versionNo: number) {
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
        run_by: author.id,
      })
      .execute();
    await insertAuditEvent(tx, SYSTEM, {
      action: "test.seed",
      recordType: "automation_dry_run",
      recordId: runId,
      organizationId: c.b.organizationId,
    });
    let version = v.version;
    for (const s of [
      { status: "in_review", submitted_at: new Date() },
      { status: "approved", reviewed_by: w.grantor.id, reviewed_at: new Date() },
      { status: "published", published_by: author.id, published_at: new Date() },
    ] as Record<string, unknown>[]) {
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
        organizationId: c.b.organizationId,
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
      organizationId: c.b.organizationId,
      newVersion: rule.version + 1,
    });
  });
}

/** Every response the writer can see about the rule, scanned for the hidden ids. */
async function everythingShown(ruleId: string): Promise<unknown[]> {
  const out: unknown[] = [];
  out.push(ok(await send("GET", R, { session: author.session })));
  out.push(ok(await send("GET", `${R}/${ruleId}`, { session: author.session })));
  out.push(ok(await send("GET", `${R}/${ruleId}/versions`, { session: author.session })));
  return out;
}

beforeAll(async () => {
  api = await startApi();
  owner = createDb(api.owner);
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  ini = await launchedInitiative(api.db, c.b);
  const u = await createUser(api.db, c.b.organizationId);
  await grant(
    api.db,
    w.grantor.id,
    u.id,
    "ADM_METHOD",
    { type: "organization", id: c.b.organizationId },
    c.b.organizationId,
  );
  author = { id: u.id, session: await signIn(api.app, u.subject) };
}, 240_000);
afterAll(() => api?.close());

describe("qa-verifier R1 probe: restricted-token sequences (D-226, D-228 (1), D-233)", () => {
  it("(1) a duplicated token and a token in a mixed in-list both resolve to the hidden literal", async () => {
    const P = await benefit();
    const S = await benefit();
    const id = await createRule([neq(P), neq(S)]);
    await markSensitive(S);
    const shown = await read(id);
    expect(shown.includesRestrictedRecords).toBe(true);
    const token = shown.content.conditions[1].value as string;
    expect(token).toMatch(TOKEN);
    expect(leaks(shown)).toEqual([]);
    const res = ok(
      await patch(id, shown.version, {
        ...shown.content,
        conditions: [neq(token), { field: "benefitId", op: "in", value: [P, token] }, neq(token)],
      }),
    );
    expect((await stored(id)).conditions).toEqual([
      neq(S),
      { field: "benefitId", op: "in", value: [P, S] },
      neq(S),
    ]);
    expect(leaks(res)).toEqual([]);
    // The open literal P is still shown in clear; the three hidden positions are tokens of positions 1, 3 and 4.
    expect(res.content.conditions[1].value[0]).toBe(P);
    const ks = [res.content.conditions[0].value, res.content.conditions[1].value[1], res.content.conditions[2].value].map(
      (t: string) => Number(TOKEN.exec(t)?.[2]),
    );
    expect(ks).toEqual([1, 3, 4]);
    for (const b of await everythingShown(id)) expect(leaks(b)).toEqual([]);
  });

  it("(2) a token moved into an ordering condition, then a dry run: no response names the hidden id", async () => {
    const P = await benefit();
    const S = await benefit();
    const id = await createRule([neq(P), neq(S)]);
    await markSensitive(S);
    const shown = await read(id);
    const token = shown.content.conditions[1].value as string;
    // An ordering operator on the resolved uuid literal is refused (decimal literals only) and names no hidden id.
    const gt = await patch(id, shown.version, {
      ...shown.content,
      conditions: [{ field: "benefitId", op: "gt", value: token }, neq(P)],
    });
    expect(gt.status).toBe(422);
    expect(gt.body.code).toBe("automation_rule.condition_invalid");
    expect(leaks(gt.body)).toEqual([]);
    expect((await stored(id)).conditions).toEqual([neq(P), neq(S)]);
    const res = ok(
      await patch(id, shown.version, {
        ...shown.content,
        conditions: [{ field: "benefitId", op: "eq", value: token }, neq(P)],
      }),
    );
    expect((await stored(id)).conditions).toEqual([{ field: "benefitId", op: "eq", value: S }, neq(P)]);
    expect(leaks(res)).toEqual([]);
    const cat = ok(await send("GET", "/api/v1/admin/automation-catalogue", { session: author.session }));
    const trigger = (cat.triggers ?? cat.items ?? []).find((t: Body) => t.code === "benefit.variance_evaluated");
    const sample = { ...(trigger?.samplePayload ?? {}), benefitId: P };
    const run = await send("POST", `${url(id, 1)}/dry-runs`, {
      session: author.session,
      body: { triggerCode: "benefit.variance_evaluated", payload: sample },
    });
    // Whatever the outcome (201 evaluated, or 422 for a sample this probe could not shape), it names no hidden id.
    console.log(`QA-R1 probe (2): dry-run status ${run.status} outcome ${run.body?.outcome} conditionsMet ${run.body?.conditionsMet} findings ${JSON.stringify(run.body?.findings)}`);
    expect([200, 201, 422]).toContain(run.status);
    expect(leaks(run.body)).toEqual([]);
    expect(leaks(ok(await send("GET", `${url(id, 1)}/dry-runs`, { session: author.session })))).toEqual([]);
    for (const b of await everythingShown(id)) expect(leaks(b)).toEqual([]);
  });

  it("(3) draft v2 of a published v1, written by a writer without the grant, keeps the hidden literal", async () => {
    const P = await benefit();
    const S = await benefit();
    const id = await createRule([neq(S), neq(P)]);
    await markSensitive(S);
    await publish(id, 1);
    const v1Before = await stored(id, 1);
    const rule = ok(await send("GET", `${R}/${id}`, { session: author.session }));
    ok(await send("POST", `${R}/${id}/versions`, { session: author.session, headers: ifm(rule.version), body: {} }), 201);
    const v2 = await read(id, 2);
    expect(v2.includesRestrictedRecords).toBe(true);
    const t2 = v2.content.conditions[0].value as string;
    const t1 = (await read(id, 1)).content.conditions[0].value as string;
    expect(t2).toMatch(TOKEN);
    expect(t2).not.toBe(t1); // each row issues its own tag
    const res = ok(await patch(id, v2.version, { ...v2.content, conditions: [neq(P), neq(t2)] }, 2));
    expect((await stored(id, 2)).conditions).toEqual([neq(P), neq(S)]);
    expect((await stored(id, 1)).conditions).toEqual(v1Before.conditions);
    expect(leaks(res)).toEqual([]);
    for (const b of await everythingShown(id)) expect(leaks(b)).toEqual([]);
  });

  it("(4) two concurrent saves with the same If-Match: one wins, the other changes nothing", async () => {
    const P = await benefit();
    const S = await benefit();
    const id = await createRule([neq(P), neq(S)]);
    await markSensitive(S);
    const shown = await read(id);
    const token = shown.content.conditions[1].value as string;
    const [a, b] = await Promise.all([
      patch(id, shown.version, { ...shown.content, conditions: [neq(token)] }),
      patch(id, shown.version, { ...shown.content, conditions: [neq(P), { field: "benefitId", op: "in", value: [token] }] }),
    ]);
    const statuses = [a.status, b.status].sort();
    console.log(`QA-R1 probe (4): concurrent statuses ${a.status}/${b.status}; loser code ${(a.status === 200 ? b : a).body?.code}`);
    expect(statuses[0]).toBe(200);
    expect([409, 412, 422]).toContain(statuses[1]);
    const winner = a.status === 200 ? "a" : "b";
    const after = (await stored(id)).conditions;
    expect(after).toEqual(winner === "a" ? [neq(S)] : [neq(P), { field: "benefitId", op: "in", value: [S] }]);
    expect(leaks(a.body)).toEqual([]);
    expect(leaks(b.body)).toEqual([]);
  });

  it("(5) a grant given between read and save, then revoked: the literal survives both transitions", async () => {
    const P = await benefit();
    const S = await benefit();
    const id = await createRule([neq(S), neq(P)]);
    await markSensitive(S);
    const shown = await read(id);
    const token = shown.content.conditions[0].value as string;
    expect(token).toMatch(TOKEN);
    // An explicit grant admits the writer to S between the read and the save (an access decision, not an approval).
    const g = ok(
      await send("POST", "/api/v1/admin/sensitive-grants", {
        session: c.s.to.session,
        body: {
          transformationId: c.b.transformationId,
          recordType: "benefit",
          recordId: S,
          granteeUserId: author.id,
          reason: "Synthetic need to know between read and save (QA R1)",
        },
      }),
      201,
    );
    const res = ok(await patch(id, shown.version, { ...shown.content, conditions: [neq(P), neq(token)] }));
    expect((await stored(id)).conditions).toEqual([neq(P), neq(S)]);
    expect(res.content.conditions[1].value).toBe(S); // admitted now: shown in plain
    // The grant is revoked before the next save; the writer re-sends the plain id it held (D-223) with a reorder.
    ok(
      await send("POST", `/api/v1/admin/sensitive-grants/${g.id}/revoke`, {
        session: c.s.to.session,
        headers: ifm(g.version),
        body: { reason: "Synthetic need to know ended (QA R1)" },
      }),
    );
    const res2 = ok(await patch(id, res.version, { ...res.content, conditions: [neq(S), neq(P)] }));
    expect((await stored(id)).conditions).toEqual([neq(S), neq(P)]);
    expect(res2.content.conditions[0].value).toMatch(TOKEN);
    expect(leaks(res2)).toEqual([]);
    // And the hidden-again token round-trips from the new response.
    const res3 = ok(await patch(id, res2.version, { ...res2.content, conditions: [neq(P), res2.content.conditions[0]] }));
    expect((await stored(id)).conditions).toEqual([neq(P), neq(S)]);
    expect(leaks(res3)).toEqual([]);
  });
});
