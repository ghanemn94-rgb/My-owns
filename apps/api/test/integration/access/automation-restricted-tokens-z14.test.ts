// T-DG6-BE-Z14 (F-DG6-580, code-security observation 601; D-231, extending D-226 and D-228 (1); ADR-0051 §2;
// REQ-S10-002 "a sensitive benefit is hidden from a workstream member without the grant"): a restricted condition token
// names the row version it was issued from (T-DG6-BE-Z15, D-233: `[restricted:<tag>:<k>]`, the tag a keyed hash of the
// issuing row's id and row version; the expected token is computed with support/restricted-tokens.ts). On a save, a
// token not issued by the version being replaced (If-Match) is refused 422 `automation_rule.restricted_token_stale`
// with a pointer, and is never
// resolved against another version's positions. So no hidden literal is ever replaced by another literal or by marker
// text. Cases, on the real API with a disposable PostgreSQL:
//   (a) a second save of the same draft after a save that removed an earlier condition (one hidden literal);
//   (b) the same with two hidden literals;
//   (c) a re-save of the same draft after a 409 (a concurrent edit from a second tab);
//   (d) a token naming another version (earlier, later, or forged) even where the positions coincide.
// Each refusal leaves the stored version unchanged; a reload and re-apply then saves with the current tokens.
// Every value is SYNTHETIC; marking a record sensitive is an access decision, never a business approval (G1-G6), and
// nothing here touches DG0-DG7. Before-fix reproduction: code-security round-9 probe zz-cs-r9-token-stale.test.ts.
import { AUTOMATION_RESTRICTED_TOKEN_PATTERN } from "@mth/shared/schemas";
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
import { restrictedTokens } from "../../support/restricted-tokens.ts";
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
let w: World;
let c: ClosureWorld;
let ini: Awaited<ReturnType<typeof launchedInitiative>>;
let author: { id: string; session: Session };
const R = "/api/v1/admin/automation-rules";
const V = (ruleId: string) => `${R}/${ruleId}/versions/1`;
const sev: Cond = { field: "severity", op: "eq", value: "high" };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status);
  return res.body as Body;
};
const tokens = restrictedTokens(() => api.db);
const tok = tokens.tok;
const hiddenIds: string[] = [];
const leaks = (body: unknown) => hiddenIds.filter((x) => JSON.stringify(body).includes(x));

const benefit = async () => (await pendingBenefit(api, c, ini)).id as string;
async function markSensitive(id: string) {
  hiddenIds.push(id);
  ok(
    await send("PUT", `${c.b.base}/records/benefit/${id}/sensitivity`, {
      session: c.s.to.session,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit (BE-Z14)" },
    }),
  );
}
async function createRule(conditions: Cond[]): Promise<string> {
  const rule = ok(
    await send("POST", R, {
      session: author.session,
      body: {
        code: `test.z14.${randomUUID().slice(0, 8)}`,
        nameEn: "Synthetic variance follow-up (BE-Z14)",
        nameAr: "متابعة انحراف تجريبية",
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
  await tokens.register(rule.id as string);
  return rule.id as string;
}
const stored = async (ruleId: string) =>
  (await api.db
    .selectFrom("automation_rule_version")
    .select(["conditions", "version"])
    .where("automation_rule_id", "=", ruleId)
    .where("version_no", "=", 1)
    .executeTakeFirstOrThrow()) as { conditions: Cond[]; version: number };
const getV = async (ruleId: string) => ok(await send("GET", V(ruleId), { session: author.session }));
const patch = (ruleId: string, content: Body, version: number) =>
  send("PATCH", V(ruleId), { session: author.session, headers: ifm(version), body: { content } });
function expectStale(res: Res<Body>, pointer: string) {
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(422);
  expect(res.body.code).toBe("automation_rule.restricted_token_stale");
  expect(res.body.detail).toContain("reload the version and re-apply your change");
  expect(res.body.errors[0].pointer).toBe(pointer);
  expect(res.body.errors[0].code).toBe("automation_rule.restricted_token_stale");
  expect(leaks(res.body)).toEqual([]);
}

beforeAll(async () => {
  api = await startApi();
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

describe("T-DG6-BE-Z14: restricted tokens are bound to their version (D-231, F-DG6-580)", () => {
  it("read: a token names the row version it was issued from and the literal's position", async () => {
    const P = await benefit();
    const S = await benefit();
    const ruleId = await createRule([
      { field: "benefitId", op: "neq", value: P },
      { field: "benefitId", op: "neq", value: S },
      sev,
    ]);
    await markSensitive(S);
    const shown = await getV(ruleId);
    expect(shown.content.conditions).toEqual([
      { field: "benefitId", op: "neq", value: P },
      { field: "benefitId", op: "neq", value: tok(ruleId, shown.version, 2) },
      sev,
    ]);
    expect(AUTOMATION_RESTRICTED_TOKEN_PATTERN.test(shown.content.conditions[1].value)).toBe(true);
    expect(shown.includesRestrictedRecords).toBe(true);
    expect(leaks(shown)).toEqual([]);
    // The rule list and the rule read carry the same binding for the effective version, if any; nothing leaks.
    expect(leaks(ok(await send("GET", R, { session: author.session })))).toEqual([]);
  });

  it("(a) a second save of the same draft after removing an earlier condition is refused; S is never swapped", async () => {
    const P = await benefit();
    const S = await benefit();
    const Q = await benefit();
    const ruleId = await createRule([
      { field: "benefitId", op: "neq", value: P },
      { field: "benefitId", op: "neq", value: S },
      { field: "benefitId", op: "neq", value: Q },
    ]);
    await markSensitive(S);
    const shown = await getV(ruleId);
    expect(shown.content.conditions[1].value).toBe(tok(ruleId, shown.version, 2));
    // The editor's draft after "remove condition 1".
    const draft = { ...shown.content, conditions: shown.content.conditions.slice(1) };
    const s1 = ok(await patch(ruleId, draft, shown.version));
    expect((await stored(ruleId)).conditions).toEqual([
      { field: "benefitId", op: "neq", value: S },
      { field: "benefitId", op: "neq", value: Q },
    ]);
    // The new version shows S at position 1, bound to the new row version.
    expect(s1.content.conditions[0].value).toBe(tok(ruleId, s1.version, 1));
    expect(s1.includesRestrictedRecords).toBe(true);
    // The F-DG6-580 sequence: the same draft (token of the earlier version) with the refreshed If-Match.
    const before = await stored(ruleId);
    const s2 = await patch(ruleId, draft, s1.version);
    expectStale(s2, "/content/conditions/0/value");
    const after = await stored(ruleId);
    expect(after).toEqual(before);
    expect(after.conditions).not.toContainEqual({ field: "benefitId", op: "neq", value: "[restricted]" });
    // Reload and re-apply: the current tokens save, and S stays where the author meant it.
    const fresh = await getV(ruleId);
    const s3 = ok(await patch(ruleId, fresh.content, fresh.version));
    expect(s3.content.conditions[0].value).toBe(tok(ruleId, s3.version, 1));
    expect((await stored(ruleId)).conditions).toEqual([
      { field: "benefitId", op: "neq", value: S },
      { field: "benefitId", op: "neq", value: Q },
    ]);
    expect(leaks(s3)).toEqual([]);
  });

  it("(b) two hidden literals: the stale second save is refused and S1, S2 stay in place", async () => {
    const P = await benefit();
    const S1 = await benefit();
    const S2 = await benefit();
    const ruleId = await createRule([
      { field: "benefitId", op: "neq", value: P },
      { field: "benefitId", op: "neq", value: S1 },
      { field: "benefitId", op: "neq", value: S2 },
      sev,
    ]);
    await markSensitive(S1);
    await markSensitive(S2);
    const shown = await getV(ruleId);
    expect(shown.content.conditions.map((x: Cond) => x.value)).toEqual([
      P,
      tok(ruleId, shown.version, 2),
      tok(ruleId, shown.version, 3),
      "high",
    ]);
    const draft = { ...shown.content, conditions: shown.content.conditions.slice(1) };
    const s1 = ok(await patch(ruleId, draft, shown.version));
    const kept = [{ field: "benefitId", op: "neq", value: S1 }, { field: "benefitId", op: "neq", value: S2 }, sev];
    expect((await stored(ruleId)).conditions).toEqual(kept);
    expect(s1.content.conditions.map((x: Cond) => x.value)).toEqual([
      tok(ruleId, s1.version, 1),
      tok(ruleId, s1.version, 2),
      "high",
    ]);
    const s2 = await patch(ruleId, draft, s1.version);
    expectStale(s2, "/content/conditions/0/value");
    expect((await stored(ruleId)).conditions).toEqual(kept);
    // A mix of a current token and a stale one is refused at the stale one; nothing is stored.
    const mixed = await patch(
      ruleId,
      {
        ...s1.content,
        conditions: [
          s1.content.conditions[0],
          { ...s1.content.conditions[1], value: tok(ruleId, shown.version, 3) },
          sev,
        ],
      },
      s1.version,
    );
    expectStale(mixed, "/content/conditions/1/value");
    expect((await stored(ruleId)).conditions).toEqual(kept);
    // In an `in` list too.
    const inList = await patch(
      ruleId,
      { ...s1.content, conditions: [{ field: "benefitId", op: "in", value: [P, tok(ruleId, shown.version, 2)] }, sev] },
      s1.version,
    );
    expectStale(inList, "/content/conditions/0/value/1");
    expect((await stored(ruleId)).conditions).toEqual(kept);
    // Swapping the two current tokens (a reorder on the current version) is applied exactly.
    const swapped = ok(
      await patch(
        ruleId,
        { ...s1.content, conditions: [s1.content.conditions[1], s1.content.conditions[0], sev] },
        s1.version,
      ),
    );
    expect(leaks(swapped)).toEqual([]);
    expect((await stored(ruleId)).conditions).toEqual([kept[1], kept[0], sev]);
  });

  it("(c) a re-save of the same draft after a 409 is refused; after a reload the change re-applies and S stays", async () => {
    const P = await benefit();
    const S = await benefit();
    const ruleId = await createRule([
      { field: "benefitId", op: "neq", value: P },
      { field: "benefitId", op: "neq", value: S },
      sev,
    ]);
    await markSensitive(S);
    const shown = await getV(ruleId);
    // A second tab removes condition 1 (positions shift: S moves from 2 to 1).
    ok(await patch(ruleId, { ...shown.content, conditions: shown.content.conditions.slice(1) }, shown.version));
    // The first tab edits severity in its stale draft and saves with the stale If-Match: 409.
    const draft = {
      ...shown.content,
      conditions: shown.content.conditions.map((x: Cond) => (x.field === "severity" ? { ...x, value: "medium" } : x)),
    };
    const a1 = await patch(ruleId, draft, shown.version);
    expect(a1.status).toBe(409);
    const before = await stored(ruleId);
    expect(before.conditions).toEqual([{ field: "benefitId", op: "neq", value: S }, sev]);
    // The same draft re-sent with the refreshed If-Match: the token names the earlier version, refused 422.
    const a2 = await patch(ruleId, draft, before.version);
    expectStale(a2, "/content/conditions/1/value");
    expect(await stored(ruleId)).toEqual(before);
    // Reload and re-apply the severity change on the current version: S stays, severity changes.
    const fresh = await getV(ruleId);
    expect(fresh.content.conditions[0].value).toBe(tok(ruleId, fresh.version, 1));
    const a3 = ok(
      await patch(
        ruleId,
        {
          ...fresh.content,
          conditions: fresh.content.conditions.map((x: Cond) =>
            x.field === "severity" ? { ...x, value: "medium" } : x,
          ),
        },
        fresh.version,
      ),
    );
    expect(leaks(a3)).toEqual([]);
    expect((await stored(ruleId)).conditions).toEqual([
      { field: "benefitId", op: "neq", value: S },
      { field: "severity", op: "eq", value: "medium" },
    ]);
  });

  it("(d) a token naming another version is refused even where the positions coincide; unknown text stays unknown", async () => {
    const S = await benefit();
    const ruleId = await createRule([{ field: "benefitId", op: "neq", value: S }, sev]);
    await markSensitive(S);
    const v1 = await getV(ruleId);
    // An unrelated edit bumps the version; S stays at position 1.
    const v2 = ok(
      await patch(
        ruleId,
        { ...v1.content, conditions: [v1.content.conditions[0], { ...sev, value: "low" }] },
        v1.version,
      ),
    );
    expect(v2.content.conditions[0].value).toBe(tok(ruleId, v2.version, 1));
    const before = await stored(ruleId);
    for (const version of [v1.version, v2.version + 1, 999_999]) {
      const res = await patch(
        ruleId,
        {
          ...v2.content,
          conditions: [{ field: "benefitId", op: "neq", value: tok(ruleId, version, 1) }, v2.content.conditions[1]],
        },
        v2.version,
      );
      expectStale(res, "/content/conditions/0/value");
    }
    expect(await stored(ruleId)).toEqual(before);
    // A token of the current version at a position with no string literal stays unknown (D-226).
    const unknown = await patch(
      ruleId,
      { ...v2.content, conditions: [{ field: "benefitId", op: "neq", value: tok(ruleId, v2.version, 7) }] },
      v2.version,
    );
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe("automation_rule.restricted_marker_unknown");
    expect(await stored(ruleId)).toEqual(before);
  });
});
