// T-DG6-BE-Z13 (F-DG6-520, F-DG6-541, F-DG6-560; D-226, superseding the ordinal pairing of D-222 (2); ADR-0051 §2;
// REQ-S10-002 "a sensitive benefit is hidden from a workstream member without the grant"): a rule author who is not
// admitted to a sensitive benefit sees each hidden condition literal as the opaque per-version token `[restricted:k]`.
// A save maps every token back to its literal wherever the condition now sits: after removing an earlier condition,
// after reordering, after removing the restricted condition itself, after removing or reordering `in` list elements,
// and with two hidden literals. An unknown token, or the bare marker text, is refused with 422
// `automation_rule.restricted_marker_unknown`, so marker text is never stored. After an explicit grant the author
// (now admitted) reads the real values. Every value is SYNTHETIC; marking a record sensitive or granting access is an
// access decision, never a business approval (G1-G6), and nothing here touches DG0-DG7.
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
/** S1, S2: sensitive benefits the author is not admitted to; P: a plain benefit. */
const id = { S1: "", S2: "", P: "" };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status);
  return res.body as Body;
};
const R = "/api/v1/admin/automation-rules";
const T1 = "[restricted:1]";
const T2 = "[restricted:2]";
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
async function resave(name: string, edit: (shown: Cond[]) => Cond[], session = author.session) {
  const ruleId = rules.get(name)!;
  const shown = ok(await send("GET", V(ruleId), { session }));
  const res = await send("PATCH", V(ruleId), {
    session,
    headers: ifm(shown.version),
    body: { content: { ...shown.content, conditions: edit(shown.content.conditions) } },
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
  }
  for (const b of [id.S1, id.S2]) {
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
    const one = ok(await send("GET", V(rules.get("listReorder")!), { session: author.session }));
    expect(one.content.conditions).toEqual([{ field: "benefitId", op: "in", value: [T1, id.P, T2] }, sev]);
    expect(one.includesRestrictedRecords).toBe(true);
    expect(one.summary.en).toContain("a restricted record");
    expect(one.summary.ar).toContain("سجل مقيد");
    expect(one.summary.en).not.toContain("[restricted");
    expect(leaks(one)).toEqual([]);
    const two = ok(await send("GET", V(rules.get("reorder")!), { session: author.session }));
    expect(two.content.conditions.map((x: Cond) => x.value)).toEqual([T1, T2, "high"]);
    const list = ok(await send("GET", R, { session: author.session }));
    expect(leaks(list), "listAutomationRules").toEqual([]);
  });

  it("removing an earlier condition keeps the hidden literal of the condition kept (F-DG6-541, F-DG6-520 (c))", async () => {
    const { res, ruleId } = await resave("removeEarlier", (s) => s.slice(1));
    const body = ok(res);
    expect(body.includesRestrictedRecords).toBe(true);
    expect(body.content.conditions).toEqual([{ field: "benefitId", op: "neq", value: T1 }, sev]);
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
    const { shown, res, ruleId } = await resave("listReorder", (s) => [{ ...s[0]!, value: [T2, T1] }, s[1]!]);
    expect(shown.content.conditions[0].value).toEqual([T1, id.P, T2]);
    ok(res);
    expect((await stored(ruleId)).conditions).toEqual([{ field: "benefitId", op: "in", value: [id.S2, id.S1] }, sev]);
  });

  it("in-list: removing a hidden element removes exactly that literal", async () => {
    const { res, ruleId } = await resave("listRemove", (s) => [{ ...s[0]!, value: [id.P, T2] }, s[1]!]);
    ok(res);
    expect((await stored(ruleId)).conditions).toEqual([{ field: "benefitId", op: "in", value: [id.P, id.S2] }, sev]);
  });

  it("negative: an unknown token, the bare marker or other marker text is refused 422 and nothing is stored", async () => {
    const ruleId = rules.get("refusals")!;
    const before = await stored(ruleId);
    for (const bad of [
      "[restricted:9]",
      AUTOMATION_RESTRICTED_LITERAL,
      "[Restricted:1]",
      " [restricted:1] ",
      "[restricted:x]",
    ]) {
      const { res } = await resave("refusals", (s) => [{ ...s[0]!, value: bad }, s[1]!]);
      expect(res.status, bad).toBe(422);
      expect(res.body.code).toBe("automation_rule.restricted_marker_unknown");
      expect(res.body.detail).toContain("Reload the version");
      expect(res.body.errors[0].pointer).toBe("/content/conditions/0/value");
      // In an `in` list too.
      const inList = await resave("refusals", (s) => [{ field: "benefitId", op: "in", value: [id.P, bad] }, s[1]!]);
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
          conditions: [{ field: "benefitId", op: "neq", value: T1 }],
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

  it("positive: after an explicit grant the author reads the real values; a token is then unknown (never shown)", async () => {
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
    const { res } = await resave("refusals", (s) => [{ ...s[0]!, value: T1 }, s[1]!]);
    expect(res.status).toBe(422);
  });
});
