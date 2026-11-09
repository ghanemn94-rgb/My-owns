// T-DG6-BE-Z15 (F-DG6-640; D-233, extending D-226, D-228 (1) and D-231; ADR-0051 §2 amendment D-231 part A;
// REQ-S10-002 "a sensitive benefit is hidden from a workstream member without the grant"): a restricted condition token
// is bound to the rule-version ROW it was issued from, not only to a row-version number. Its middle part is an opaque
// issuer tag, a truncated keyed hash (HMAC-SHA256) of the issuing row's id and row version, `[restricted:<tag>:<k>]`.
// A save resolves a token only when its tag is the tag of the row being replaced at the If-Match version; a token
// issued by another version row, another rule, or another row version is refused 422
// `automation_rule.restricted_token_stale`, and nothing is stored. Cases, on the real API with a disposable PostgreSQL:
//   (a) the token is opaque: it names neither the row version, nor the row id, nor the hidden literal, and two version
//       rows at the same row-version number issue different tags;
//   (b) F-DG6-640: a token copied from the PUBLISHED version 1 into its draft version 2 at the same row version;
//   (c) F-DG6-640: a token copied from another rule's draft at the same row version;
//   (d) F-DG6-580: the same draft saved twice (the second save carries the first save's tokens);
//   (e) F-DG6-580: the same draft re-sent with the refreshed If-Match after a 409 from a concurrent edit;
//   (f) the normal round trip (the token moved to another condition) keeps the hidden literal;
//   (g) a token in the retired D-231 form `[restricted:<version>:<k>]` is refused stale, even at the current version.
// Every token is taken from a server response, never built here, so this file runs unchanged before and after the fix
// (the before-fix log fails (a), (b), (c) and (g); (d), (e) and (f) are F-DG6-580 regression guards and pass on both).
// Every value is SYNTHETIC; marking a record sensitive is an access decision, never a business approval (G1-G6). The
// configuration review in `publish` below is a synthetic rule review, not a business approval; nothing touches DG0-DG7.
// Before-fix reproduction: domain round-10 probe dom-r10-token-binding.test.ts.txt cases (i) and (j).
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
/** The D-233 token form, written out here (not imported) so the before-fix run checks the same text. */
const ISSUER_BOUND = /^\[restricted:([0-9a-f]{24}):([1-9][0-9]{0,3})\]$/;
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
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit (BE-Z15)" },
    }),
  );
}
async function createRule(conditions: Cond[]): Promise<string> {
  const rule = ok(
    await send("POST", R, {
      session: author.session,
      body: {
        code: `test.z15.${randomUUID().slice(0, 8)}`,
        nameEn: "Synthetic variance exclusion (BE-Z15)",
        nameAr: "استثناء انحراف تجريبي",
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
/** Re-saves the shown content (its own current tokens) until the row version reaches `target`. */
async function bumpTo(ruleId: string, target: number, versionNo = 1) {
  for (;;) {
    const v = await read(ruleId, versionNo);
    if (v.version >= target) return v;
    ok(await patch(ruleId, v.version, v.content, versionNo));
  }
}
function expectStale(res: Res<Body>, pointer: string) {
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(422);
  expect(res.body.code).toBe("automation_rule.restricted_token_stale");
  expect(res.body.errors[0].pointer).toBe(pointer);
  expect(leaks(res.body)).toEqual([]);
}
/**
 * Publishes `versionNo` through the 0074 guard (a pass dry run for the content, in_review, approved by another user,
 * published), with one audit event per row written, as the domain round-10 probe does. A synthetic configuration review;
 * no business approval.
 */
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
afterAll(() => api?.close()); // api.close() also ends the owner pool

describe("T-DG6-BE-Z15: restricted tokens are bound to their issuing rule-version row (D-233, F-DG6-640)", () => {
  it("(a) the token is an opaque issuer tag: no row version, no row id, no hidden value; other rows issue other tags", async () => {
    const P = await benefit();
    const S = await benefit();
    const A = await createRule([neq(P), neq(S)]);
    const B = await createRule([neq(P), neq(S)]);
    await markSensitive(S);
    const a = await read(A);
    const b = await read(B);
    expect(a.version).toBe(b.version);
    const ta = a.content.conditions[1].value as string;
    const tb = b.content.conditions[1].value as string;
    const ma = ISSUER_BOUND.exec(ta);
    expect(ma, ta).not.toBeNull();
    expect(ma![2]).toBe("2");
    const tag = ma![1]!;
    expect(tag).not.toBe(String(a.version));
    // Neither the issuing row's id, nor the rule id, nor the hidden literal (in any 8+ hex run) appears in the tag.
    const row = await stored(A);
    for (const id of [row.id, A, S]) {
      const hex = id.replaceAll("-", "");
      for (let i = 0; i + 8 <= hex.length; i += 1) expect(tag).not.toContain(hex.slice(i, i + 8));
    }
    expect(leaks(a)).toEqual([]);
    // Same row-version number, same position, another rule-version row: another tag.
    expect(ISSUER_BOUND.exec(tb)?.[1]).not.toBe(tag);
    // The same row at another row version: another tag. Another reader at the same row version: the same tag.
    const saved = ok(await patch(A, a.version, a.content));
    expect(ISSUER_BOUND.exec(saved.content.conditions[1].value)?.[1]).not.toBe(tag);
    expect((await stored(A)).conditions).toEqual([neq(P), neq(S)]);
  });

  it("(b) F-DG6-640: a token copied from the published version 1 into its draft version 2 at the same row version is refused stale", async () => {
    const P = await benefit();
    const S = await benefit();
    const H = await benefit();
    const id = await createRule([neq(P), neq(S), neq(H)]);
    await markSensitive(S);
    await markSensitive(H);
    await publish(id, 1);
    const v1 = await read(id, 1);
    expect(v1.status).toBe("published");
    const rule = ok(await send("GET", `${R}/${id}`, { session: author.session }));
    ok(
      await send("POST", `${R}/${id}/versions`, {
        session: author.session,
        headers: ifm(rule.version),
        body: { changeSummary: "Synthetic draft v2 (BE-Z15)" },
      }),
      201,
    );
    let d = await read(id, 2);
    // The author removes the S condition from the draft (H moves to position 2), then re-saves until the draft's row
    // version is the published row's row version.
    ok(await patch(id, d.version, { ...d.content, conditions: [d.content.conditions[0], d.content.conditions[2]] }, 2));
    d = await bumpTo(id, v1.version, 2);
    expect(d.version).toBe(v1.version);
    const before = await stored(id, 2);
    expect(before.conditions).toEqual([neq(P), neq(H)]);
    // Restoring "exclude S" by pasting the token shown on the published version's page.
    const tokenOfS = v1.content.conditions[1].value as string;
    const res = await patch(id, d.version, { ...d.content, conditions: [...d.content.conditions, neq(tokenOfS)] }, 2);
    expectStale(res, "/content/conditions/2/value");
    expect(await stored(id, 2)).toEqual(before);
    // The published version is untouched.
    expect((await stored(id, 1)).conditions).toEqual([neq(P), neq(S), neq(H)]);
  });

  it("(c) F-DG6-640: a token copied from another rule's version at the same row version is refused stale", async () => {
    const P = await benefit();
    const S = await benefit();
    const Q = await benefit();
    const H2 = await benefit();
    const A = await createRule([neq(P), neq(S)]);
    const B = await createRule([neq(Q), neq(H2)]);
    await markSensitive(S);
    await markSensitive(H2);
    const target = Math.max((await read(A)).version, (await read(B)).version) + 1;
    const a = await bumpTo(A, target);
    const b = await bumpTo(B, target);
    expect(a.version).toBe(b.version);
    const before = await stored(B);
    const res = await patch(B, b.version, {
      ...b.content,
      conditions: [...b.content.conditions, neq(a.content.conditions[1].value)],
    });
    expectStale(res, "/content/conditions/2/value");
    expect(await stored(B)).toEqual(before);
    expect(before.conditions).toEqual([neq(Q), neq(H2)]);
    // Rule B's own token at the same position, in the same body, still resolves (nothing else is refused).
    const own = ok(await patch(B, b.version, { ...b.content, conditions: [b.content.conditions[1]] }));
    expect(own.version).toBe(b.version + 1);
    expect((await stored(B)).conditions).toEqual([neq(H2)]);
  });

  it("(d) F-DG6-580: the same draft saved twice; the second save carries the first save's tokens and is refused", async () => {
    const P = await benefit();
    const S = await benefit();
    const Q = await benefit();
    const id = await createRule([neq(P), neq(S), neq(Q)]);
    await markSensitive(S);
    const shown = await read(id);
    const form = { ...shown.content, conditions: shown.content.conditions.slice(1) };
    const first = ok(await patch(id, shown.version, form));
    expect((await stored(id)).conditions).toEqual([neq(S), neq(Q)]);
    const second = await patch(id, first.version, form);
    expectStale(second, "/content/conditions/0/value");
    expect((await stored(id)).conditions).toEqual([neq(S), neq(Q)]);
  });

  it("(e) F-DG6-580: after a 409, the same draft re-sent with the refreshed If-Match is refused; S stays", async () => {
    const P = await benefit();
    const S = await benefit();
    const Q = await benefit();
    const id = await createRule([neq(P), neq(S), neq(Q)]);
    await markSensitive(S);
    const tab1 = await read(id);
    const tab2 = await read(id);
    ok(await patch(id, tab2.version, { ...tab2.content, conditions: tab2.content.conditions.slice(1) }));
    const draft1 = { ...tab1.content, conditions: [tab1.content.conditions[1], tab1.content.conditions[2]] };
    const conflict = await patch(id, tab1.version, draft1);
    expect(conflict.status).toBe(409);
    const cur = await stored(id);
    expectStale(await patch(id, cur.version, draft1), "/content/conditions/0/value");
    expect((await stored(id)).conditions).toEqual([neq(S), neq(Q)]);
    // Reload and re-apply: the current token saves.
    const fresh = await read(id);
    ok(await patch(id, fresh.version, fresh.content));
    expect((await stored(id)).conditions).toEqual([neq(S), neq(Q)]);
  });

  it("(f) the normal round trip keeps the hidden literal wherever the token now sits, and re-issues a fresh tag", async () => {
    const P = await benefit();
    const S = await benefit();
    const id = await createRule([neq(P), neq(S)]);
    await markSensitive(S);
    const shown = await read(id);
    const token = shown.content.conditions[1].value as string;
    // The token moves into an `in` list in first position, and P is dropped.
    const res = ok(
      await patch(id, shown.version, {
        ...shown.content,
        conditions: [{ field: "benefitId", op: "in", value: [token] }],
      }),
    );
    expect((await stored(id)).conditions).toEqual([{ field: "benefitId", op: "in", value: [S] }]);
    expect(res.includesRestrictedRecords).toBe(true);
    const next = res.content.conditions[0].value[0] as string;
    expect(next).not.toBe(token);
    expect(leaks(res)).toEqual([]);
    // The response's own token saves again (the editor's reload-then-save path).
    const again = ok(await patch(id, res.version, res.content));
    expect((await stored(id)).conditions).toEqual([{ field: "benefitId", op: "in", value: [S] }]);
    expect(again.version).toBe(res.version + 1);
  });

  it("(g) the retired D-231 form [restricted:<version>:<k>] is refused stale even at the current version", async () => {
    const P = await benefit();
    const S = await benefit();
    const id = await createRule([neq(P), neq(S)]);
    await markSensitive(S);
    const shown = await read(id);
    const before = await stored(id);
    const res = await patch(id, shown.version, {
      ...shown.content,
      conditions: [shown.content.conditions[0], neq(`[restricted:${shown.version}:2]`)],
    });
    expectStale(res, "/content/conditions/1/value");
    expect(await stored(id)).toEqual(before);
  });
});
