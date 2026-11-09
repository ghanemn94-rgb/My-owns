// T-DG6-BE-Z13 (F-DG6-520, F-DG6-541, F-DG6-560; D-226, superseding the ordinal pairing of D-222 (2); ADR-0051 §2;
// REQ-S10-002 "a sensitive benefit is hidden from a workstream member without the grant"): a rule author who is not
// admitted to a sensitive benefit sees each hidden condition literal as the opaque per-version token
// `[restricted:<tag>:<k>]` (T-DG6-BE-Z14, D-231; T-DG6-BE-Z15, D-233: the tag binds it to the rule-version row and the
// row version it was issued from; the expected token is computed with support/restricted-tokens.ts).
// A save maps every token back to its literal wherever the condition now sits: after removing an earlier condition,
// after reordering, after removing the restricted condition itself, after removing or reordering `in` list elements,
// and with two hidden literals. An unknown token, or the bare marker text, is refused with 422
// `automation_rule.restricted_marker_unknown`, so marker text is never stored. After an explicit grant the author
// (now admitted) reads the real values.
// T-DG6-BE-Z13C (D-228 (1)): k is the literal's position among ALL literals of the stored version, so a record that
// becomes hidden, or one that becomes visible, between the author's read and save cannot shift a token: the right
// literal is kept in both. Every value is SYNTHETIC; marking a record sensitive or granting access is an
// access decision, never a business approval (G1-G6), and nothing here touches DG0-DG7.
import { AUTOMATION_RESTRICTED_LITERAL, AUTOMATION_RESTRICTED_TOKEN_PATTERN } from "@mth/shared/schemas";
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
let author: { id: string; session: Session };
/**
 * S1, S2: sensitive benefits the author is not admitted to; P: a plain benefit. H: plain at the author's read, marked
 * sensitive before the save. V: sensitive at the read, granted to the author before the save (T-DG6-BE-Z13C).
 */
const id = { S1: "", S2: "", P: "", H: "", V: "" };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status);
  return res.body as Body;
};
const R = "/api/v1/admin/automation-rules";
/** D-231: a token names the row version it was issued from and the literal's position k (D-228 (1)). */
const tokens = restrictedTokens(() => api.db);
const tok = tokens.tok;
/** The issuer tag of rule `ruleId`'s version 1 at row version `version` (the middle part of its tokens). */
const tagOf = (ruleId: string, version: number) =>
  AUTOMATION_RESTRICTED_TOKEN_PATTERN.exec(tok(ruleId, version, 1))![1]!;
const sev: Cond = { field: "severity", op: "eq", value: "high" };

/** The rules by case, created before the benefits are marked sensitive (their conditions name S1/S2 by id). */
const rules = new Map<string, string>();
const caseConditions = (): Record<string, Cond[]> => ({
  removeEarlier: [{ field: "benefitId", op: "neq", value: id.P }, { field: "benefitId", op: "neq", value: id.S1 }, sev],
  reorder: [{ field: "benefitId", op: "neq", value: id.S1 }, { field: "benefitId", op: "neq", value: id.S2 }, sev],
  removeRestricted: [
    { field: "benefitId", op: "neq", value: id.S1 },
    { field: "benefitId", op: "neq", value: id.P },
    sev,
  ],
  listReorder: [{ field: "benefitId", op: "in", value: [id.S1, id.P, id.S2] }, sev],
  listRemove: [{ field: "benefitId", op: "in", value: [id.S1, id.P, id.S2] }, sev],
  refusals: [{ field: "benefitId", op: "neq", value: id.S1 }, sev],
  raceHidden: [
    { field: "benefitId", op: "neq", value: id.S1 },
    { field: "benefitId", op: "neq", value: id.H },
    { field: "benefitId", op: "neq", value: id.S2 },
    sev,
  ],
  raceVisible: [
    { field: "benefitId", op: "neq", value: id.S1 },
    { field: "benefitId", op: "neq", value: id.V },
    { field: "benefitId", op: "neq", value: id.S2 },
    sev,
  ],
});

const V = (ruleId: string) => `${R}/${ruleId}/versions/1`;
const stored = async (ruleId: string) =>
  (await api.db
    .selectFrom("automation_rule_version")
    .select(["conditions", "version"])
    .where("automation_rule_id", "=", ruleId)
    .where("version_no", "=", 1)
    .executeTakeFirstOrThrow()) as { conditions: Cond[]; version: number };
const leaks = (body: unknown) => [id.S1, id.S2].filter((x) => JSON.stringify(body).includes(x));
/** GET as the author, then PATCH `edit(shown conditions)` back with If-Match. */
async function resave(
  name: string,
  edit: (shown: Cond[], version: number, ruleId: string) => Cond[],
  session = author.session,
) {
  const ruleId = rules.get(name)!;
  const shown = ok(await send("GET", V(ruleId), { session }));
  const res = await send("PATCH", V(ruleId), {
    session,
    headers: ifm(shown.version),
    body: { content: { ...shown.content, conditions: edit(shown.content.conditions, shown.version, ruleId) } },
  });
  return { shown, res, ruleId };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  const ini = await launchedInitiative(api.db, c.b);
  id.S1 = (await pendingBenefit(api, c, ini)).id;
  id.S2 = (await pendingBenefit(api, c, ini)).id;
  id.P = (await pendingBenefit(api, c, ini)).id;
  id.H = (await pendingBenefit(api, c, ini)).id;
  id.V = (await pendingBenefit(api, c, ini)).id;
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
  for (const [name, conditions] of Object.entries(caseConditions())) {
    const rule = ok(
      await send("POST", R, {
        session: author.session,
        body: {
          code: `test.z13.${name.toLowerCase()}.${randomUUID().slice(0, 8)}`,
          nameEn: `Synthetic variance follow-up (${name})`,
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
    rules.set(name, rule.id);
    await tokens.register(rule.id);
  }
  for (const b of [id.S1, id.S2, id.V]) {
    ok(
      await send("PUT", `${c.b.base}/records/benefit/${b}/sensitivity`, {
        session: c.s.to.session,
        headers: ifm(0),
        body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit (BE-Z13)" },
      }),
    );
  }
}, 240_000);
afterAll(() => api?.close());

describe("T-DG6-BE-Z13: restricted condition tokens (D-226)", () => {
  it("read: each hidden literal is an opaque token in reading order, marked; the summary names no record", async () => {
    const L = rules.get("listReorder")!;
    const one = ok(await send("GET", V(L), { session: author.session }));
    // D-228 (1): k is the position among all literals (S1 = 1, P = 2, S2 = 3), not among the hidden ones.
    expect(one.content.conditions).toEqual([
      { field: "benefitId", op: "in", value: [tok(L, one.version, 1), id.P, tok(L, one.version, 3)] },
      sev,
    ]);
    expect(one.includesRestrictedRecords).toBe(true);
    expect(one.summary.en).toContain("a restricted record");
    expect(one.summary.ar).toContain("سجل مقيد");
    expect(one.summary.en).not.toContain("[restricted");
    expect(leaks(one)).toEqual([]);
    const two = ok(await send("GET", V(rules.get("reorder")!), { session: author.session }));
    expect(two.content.conditions.map((x: Cond) => x.value)).toEqual([
      tok(rules.get("reorder")!, two.version, 1),
      tok(rules.get("reorder")!, two.version, 2),
      "high",
    ]);
    const list = ok(await send("GET", R, { session: author.session }));
    expect(leaks(list), "listAutomationRules").toEqual([]);
  });

  it("removing an earlier condition keeps the hidden literal of the condition kept (F-DG6-541, F-DG6-520 (c))", async () => {
    const { res, ruleId } = await resave("removeEarlier", (s) => s.slice(1));
    const body = ok(res);
    expect(body.includesRestrictedRecords).toBe(true);
    expect(body.content.conditions).toEqual([
      { field: "benefitId", op: "neq", value: tok(ruleId, body.version, 1) },
      sev,
    ]);
    expect(leaks(body)).toEqual([]);
    expect((await stored(ruleId)).conditions).toEqual([{ field: "benefitId", op: "neq", value: id.S1 }, sev]);
  });

  it("reordering two hidden literals keeps each with its own condition (F-DG6-560 P1)", async () => {
    const { res, ruleId } = await resave("reorder", (s) => [s[2]!, s[1]!, s[0]!]);
    ok(res);
    expect((await stored(ruleId)).conditions).toEqual([
      sev,
      { field: "benefitId", op: "neq", value: id.S2 },
      { field: "benefitId", op: "neq", value: id.S1 },
    ]);
  });

  it("removing the restricted condition itself removes its literal and keeps the rest", async () => {
    const { res, ruleId } = await resave("removeRestricted", (s) => s.slice(1));
    const body = ok(res);
    expect(body.includesRestrictedRecords).toBeUndefined();
    expect((await stored(ruleId)).conditions).toEqual([{ field: "benefitId", op: "neq", value: id.P }, sev]);
  });

  it("in-list: removing the open element and reordering the hidden ones keeps both (F-DG6-520 (b), F-DG6-560 P3)", async () => {
    const { shown, res, ruleId } = await resave("listReorder", (s, v, r) => [
      { ...s[0]!, value: [tok(r, v, 3), tok(r, v, 1)] },
      s[1]!,
    ]);
    expect(shown.content.conditions[0].value).toEqual([
      tok(ruleId, shown.version, 1),
      id.P,
      tok(ruleId, shown.version, 3),
    ]);
    ok(res);
    expect((await stored(ruleId)).conditions).toEqual([{ field: "benefitId", op: "in", value: [id.S2, id.S1] }, sev]);
  });

  it("in-list: removing a hidden element removes exactly that literal", async () => {
    const { res, ruleId } = await resave("listRemove", (s, v, r) => [{ ...s[0]!, value: [id.P, tok(r, v, 3)] }, s[1]!]);
    ok(res);
    expect((await stored(ruleId)).conditions).toEqual([{ field: "benefitId", op: "in", value: [id.P, id.S2] }, sev]);
  });

  it("negative: an unknown token, the bare marker or other marker text is refused 422 and nothing is stored", async () => {
    const ruleId = rules.get("refusals")!;
    const before = await stored(ruleId);
    // `@v` is replaced by the issuer tag of the row being replaced (D-233), so "[restricted:@v:9]" is a token of the
    // right row and version with no string literal at position 9. "[restricted:1]" is the retired, unbound D-226
    // format (D-231).
    for (const bad of [
      "[restricted:@v:9]",
      AUTOMATION_RESTRICTED_LITERAL,
      "[restricted:1]",
      "[Restricted:@v:1]",
      " [restricted:@v:1] ",
      "[restricted:@v:x]",
      "[restricted:@v:1",
    ]) {
      const { res } = await resave("refusals", (s, v, r) => [
        { ...s[0]!, value: bad.replace("@v", tagOf(r, v)) },
        s[1]!,
      ]);
      expect(res.status, bad).toBe(422);
      expect(res.body.code).toBe("automation_rule.restricted_marker_unknown");
      expect(res.body.detail).toContain("Reload the version");
      expect(res.body.errors[0].pointer).toBe("/content/conditions/0/value");
      // In an `in` list too.
      const inList = await resave("refusals", (s, v, r) => [
        { field: "benefitId", op: "in", value: [id.P, bad.replace("@v", tagOf(r, v))] },
        s[1]!,
      ]);
      expect(inList.res.status, `in ${bad}`).toBe(422);
      expect(inList.res.body.errors[0].pointer).toBe("/content/conditions/0/value/1");
    }
    expect(await stored(ruleId)).toEqual(before);
    // On a rule create no token exists: marker text is refused there too.
    const created = await send("POST", R, {
      session: author.session,
      body: {
        code: `test.z13.create.${randomUUID().slice(0, 8)}`,
        nameEn: "Synthetic",
        nameAr: "تجريبي",
        scopeLevel: "organization",
        organizationId: c.b.organizationId,
        ownerUserId: author.id,
        content: {
          triggerCodes: ["benefit.variance_evaluated"],
          conditions: [{ field: "benefitId", op: "neq", value: tok(ruleId, 1, 1) }],
          actions: [
            { type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } },
          ],
          runAs: "service",
        },
      },
    });
    expect(created.status).toBe(422);
    expect(created.body.code).toBe("automation_rule.restricted_marker_unknown");
  });

  it("negative: a writer without automation.configure is refused before any token is resolved", async () => {
    const ruleId = rules.get("refusals")!;
    const before = await stored(ruleId);
    const res = await send("PATCH", V(ruleId), {
      session: c.b.s.tl,
      headers: ifm(before.version),
      body: {
        content: { triggerCodes: ["benefit.variance_evaluated"], conditions: [], actions: [], runAs: "service" },
      },
    });
    expect(res.status).toBe(403);
    expect(await stored(ruleId)).toEqual(before);
  });

  it("race (D-228 (1)): a record that becomes hidden between the read and the save shifts no token", async () => {
    const ruleId = rules.get("raceHidden")!;
    // The author reads while H is still plain: S1 and S2 are tokens at their positions among all literals.
    const shown = ok(await send("GET", V(ruleId), { session: author.session }));
    // Soft, so the save below is still exercised (and its stored literals checked) when the read assertion fails.
    expect
      .soft(shown.content.conditions.map((x: Cond) => x.value))
      .toEqual([tok(ruleId, shown.version, 1), id.H, tok(ruleId, shown.version, 3), "high"]);
    // A Transformation Office lead marks H sensitive before the author saves (an access decision, not an approval).
    ok(
      await send("PUT", `${c.b.base}/records/benefit/${id.H}/sensitivity`, {
        session: c.s.to.session,
        headers: ifm(0),
        body: { isSensitive: true, reason: "Synthetic sensitivity change between read and save (BE-Z13C)" },
      }),
    );
    // The author saves what was read, with an unrelated edit; H comes back as the plain id the author holds (D-223).
    const res = await send("PATCH", V(ruleId), {
      session: author.session,
      headers: ifm(shown.version),
      body: {
        content: {
          ...shown.content,
          conditions: shown.content.conditions.map((x: Cond) => (x.field === "severity" ? { ...x, value: "low" } : x)),
        },
      },
    });
    const body = ok(res);
    expect((await stored(ruleId)).conditions).toEqual([
      { field: "benefitId", op: "neq", value: id.S1 },
      { field: "benefitId", op: "neq", value: id.H },
      { field: "benefitId", op: "neq", value: id.S2 },
      { field: "severity", op: "eq", value: "low" },
    ]);
    // The response now hides H too, at its own position; nothing hidden leaks.
    const nv = body.version as number;
    expect(body.content.conditions.map((x: Cond) => x.value)).toEqual([
      tok(ruleId, nv, 1),
      tok(ruleId, nv, 2),
      tok(ruleId, nv, 3),
      "low",
    ]);
    expect(leaks(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(id.H);
  });

  it("race (D-228 (1)): a record that becomes visible between the read and the save keeps its literal", async () => {
    const ruleId = rules.get("raceVisible")!;
    // The author reads while V is still hidden: three tokens at positions 1, 2 and 3.
    const shown = ok(await send("GET", V(ruleId), { session: author.session }));
    const sv = shown.version as number;
    expect(shown.content.conditions.map((x: Cond) => x.value)).toEqual([
      tok(ruleId, sv, 1),
      tok(ruleId, sv, 2),
      tok(ruleId, sv, 3),
      "high",
    ]);
    // An explicit grant admits the author to V before the save (an access decision, not an approval).
    ok(
      await send("POST", "/api/v1/admin/sensitive-grants", {
        session: c.s.to.session,
        body: {
          transformationId: c.b.transformationId,
          recordType: "benefit",
          recordId: id.V,
          granteeUserId: author.id,
          reason: "Synthetic need to know between read and save (BE-Z13C)",
        },
      }),
      201,
    );
    const res = await send("PATCH", V(ruleId), {
      session: author.session,
      headers: ifm(shown.version),
      body: {
        content: {
          ...shown.content,
          conditions: shown.content.conditions.map((x: Cond) => (x.field === "severity" ? { ...x, value: "low" } : x)),
        },
      },
    });
    const body = ok(res);
    expect((await stored(ruleId)).conditions).toEqual([
      { field: "benefitId", op: "neq", value: id.S1 },
      { field: "benefitId", op: "neq", value: id.V },
      { field: "benefitId", op: "neq", value: id.S2 },
      { field: "severity", op: "eq", value: "low" },
    ]);
    // The author now reads V in plain; S1 and S2 stay tokens at their positions.
    expect(body.content.conditions.map((x: Cond) => x.value)).toEqual([
      tok(ruleId, body.version, 1),
      id.V,
      tok(ruleId, body.version, 3),
      "low",
    ]);
    expect(leaks(body)).toEqual([]);
  });

  it("positive: after an explicit grant the author reads the real values; a token still names its position", async () => {
    for (const b of [id.S1, id.S2]) {
      ok(
        await send("POST", "/api/v1/admin/sensitive-grants", {
          session: c.s.to.session,
          body: {
            transformationId: c.b.transformationId,
            recordType: "benefit",
            recordId: b,
            granteeUserId: author.id,
            reason: "Synthetic need to know (rule author)",
          },
        }),
        201,
      );
    }
    const one = ok(await send("GET", V(rules.get("listReorder")!), { session: author.session }));
    expect(one.content.conditions[0].value).toEqual([id.S2, id.S1]);
    expect(one.includesRestrictedRecords).toBeUndefined();
    const earlier = ok(await send("GET", V(rules.get("removeEarlier")!), { session: author.session }));
    expect(earlier.content.conditions[0].value).toBe(id.S1);
    // D-228 (1): a token names a position of the stored version, so one the author still holds from an earlier read
    // keeps the stored literal there (the author can read it now); a position with no string literal stays unknown.
    const { res, ruleId } = await resave("refusals", (s, v, r) => [{ ...s[0]!, value: tok(r, v, 1) }, s[1]!]);
    ok(res);
    expect((await stored(ruleId)).conditions).toEqual([{ field: "benefitId", op: "neq", value: id.S1 }, sev]);
    const unknown = await resave("refusals", (s, v, r) => [{ ...s[0]!, value: tok(r, v, 3) }, s[1]!]);
    expect(unknown.res.status).toBe(422);
    expect(unknown.res.body.code).toBe("automation_rule.restricted_marker_unknown");
  });
});
