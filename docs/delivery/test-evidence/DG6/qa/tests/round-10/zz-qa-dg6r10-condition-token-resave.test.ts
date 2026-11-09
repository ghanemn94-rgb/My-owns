// qa-verifier DG6 round 10 (T-DG6-REV-QA-R10, session 094e31f2) on candidate 56415aee (source cde60365): independent
// probe, NOT part of the frozen candidate. Copied into a disposable clone as
// apps/api/test/integration/access/zz-qa-dg6r10-condition-token-resave.test.ts and run with tests/qa/support/with-pg.sh.
//
// Port of round 9's probe (zz-qa-dg6r9-condition-token-resave.test.ts) to the version-bound token of D-231
// (`[restricted:<row version>:<k>]`): the literals move to the new form; every behaviour assertion stands.
//   P0-P3  F-DG6-560's round-8 reproduction (remove / reorder a restricted condition; an `in` element);
//   P4-P12 round 9's adversarial cases (reorder, move, duplicate, refusals, grant changes between read and save,
//          concurrent saves, forged tokens, served ids);
// new in round 10 (F-DG6-580 class, D-231):
//   P13 the double save: save 1 removes condition 1, save 2 re-sends the SAME draft with the refreshed If-Match ->
//       must be 422 restricted_token_stale and change nothing (round 9's dom-r9 case (g) stored [Q, Q]);
//   P14 tokens naming v-1, v+1, 0, a 10-digit version, and the retired `[restricted:k]` form;
//   P15 a token copied from ANOTHER RULE (or another version number of the same rule) whose row version coincides:
//       resolves only against the target draft's own literals (no disclosure, no cross-rule literal);
//   P16 a grant given between read and save plus a stale token: refused, nothing stored;
//   P17 after N successive saves through the served response (the editor's new path), every hidden literal stays put.
// Every value is SYNTHETIC; marking a record sensitive is an access decision, never a G1-G6 business approval; nothing
// here relates to DG0-DG7.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, createUser, grant, seedWorld, signIn, startApi, type Res, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { launchedInitiative, pendingBenefit, seedClosureWorld, type ClosureWorld } from "../contract/p4-exercises-be-j.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let c: ClosureWorld;
let admin: { id: string; session: Session };
let admin2: { id: string; session: Session };
const H = { x: "", y: "", v: "", z: "" };
const R = "/api/v1/admin/automation-rules";
const T = (version: number, k: number) => `[restricted:${version}:${k}]`;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status);
  return res.body as Body;
};
const storedOf = async (ruleId: string, versionNo = 1) =>
  (
    (await api.db
      .selectFrom("automation_rule_version")
      .select(["conditions"])
      .where("automation_rule_id", "=", ruleId)
      .where("version_no", "=", versionNo)
      .executeTakeFirstOrThrow()) as { conditions: Body }
  ).conditions;

const ruleBody = (conditions: Body[]) => ({
  code: `qa.r10.${randomUUID().slice(0, 8)}`,
  nameEn: "QA-R10 synthetic token probe",
  nameAr: "فحص رموز تجريبي",
  scopeLevel: "organization",
  organizationId: c.b.organizationId,
  ownerUserId: admin.id,
  content: {
    triggerCodes: ["benefit.variance_evaluated"],
    conditions,
    actions: [{ type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } }],
    runAs: "service",
  },
});
async function rule(conditions: Body[]): Promise<string> {
  return ok(await send("POST", R, { session: admin.session, body: ruleBody(conditions) }), 201).id as string;
}
const read = async (ruleId: string, s = admin.session) => ok(await send("GET", `${R}/${ruleId}/versions/1`, { session: s }));
const patchV = (ruleId: string, ifMatch: number, base: Body, conditions: Body[], s = admin.session) =>
  send("PATCH", `${R}/${ruleId}/versions/1`, {
    session: s,
    headers: ifm(ifMatch),
    body: { content: { ...base.content, conditions }, changeSummary: "QA-R10 probe" },
  });
const patch = (ruleId: string, shown: Body, conditions: Body[], s = admin.session) =>
  patchV(ruleId, shown.version, shown, conditions, s);

async function edit(ruleId: string, change: (conds: Body[]) => Body[], label: string) {
  const shown = await read(ruleId);
  const sent = change(shown.content.conditions);
  const saved = ok(await patch(ruleId, shown, sent));
  const now = await storedOf(ruleId);
  console.log(
    `QA-R10 ${label}: author saw v${shown.version} ${JSON.stringify(shown.content.conditions)}; sent ${JSON.stringify(sent)}; ` +
      `stored now ${JSON.stringify(now)}; author response v${saved.version} ${JSON.stringify(saved.content.conditions)} marker ${String(saved.includesRestrictedRecords)}`,
  );
  return { shown, now, saved };
}
const mark = async (id: string, on: boolean) => {
  const p = `${c.b.base}/records/benefit/${id}/sensitivity`;
  const cur = ok(await send("GET", p, { session: c.s.to.session }));
  ok(
    await send("PUT", p, {
      session: c.s.to.session,
      headers: ifm(cur.version),
      body: { isSensitive: on, reason: "QA-R10 synthetic sensitivity" },
    }),
  );
};
const noIds = (b: Body, what: string) => {
  const s = JSON.stringify(b);
  for (const id of [H.x, H.y, H.z]) expect(s.includes(id), `${what} names hidden ${id}`).toBe(false);
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  const ini = await launchedInitiative(api.db, c.b);
  H.x = (await pendingBenefit(api, c, ini)).id;
  H.y = (await pendingBenefit(api, c, ini)).id;
  H.v = (await pendingBenefit(api, c, ini)).id; // stays visible (except in P7)
  H.z = (await pendingBenefit(api, c, ini)).id;
  for (const who of ["a", "b"]) {
    const u = await createUser(api.db, c.b.organizationId);
    await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: c.b.organizationId }, c.b.organizationId);
    const s = { id: u.id, session: await signIn(api.app, u.subject) };
    if (who === "a") admin = s;
    else admin2 = s;
  }
  for (const id of [H.x, H.y, H.z]) await mark(id, true);
  console.log(`QA-R10 ids: hidden X=${H.x} hidden Y=${H.y} hidden Z=${H.z} visible V=${H.v}`);
}, 300_000);
afterAll(() => api?.close());

describe("QA-R10 F-DG6-560 re-run (round-8 P0-P3) on the version-bound token model", () => {
  it("P0 control: changing only an unrelated condition keeps both hidden literals", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
      { field: "severity", op: "eq", value: "high" },
    ]);
    const { shown, now, saved } = await edit(id, (cs) => cs.map((x) => (x.field === "severity" ? { ...x, value: "critical" } : x)), "P0");
    const v = shown.version;
    expect(shown.content.conditions.map((x: Body) => x.value)).toEqual([T(v, 1), T(v, 2), "high"]);
    expect(now.map((x: Body) => x.value)).toEqual([H.x, H.y, "critical"]);
    expect(saved.includesRestrictedRecords).toBe(true);
    expect(saved.content.conditions.map((x: Body) => x.value)).toEqual([T(saved.version, 1), T(saved.version, 2), "critical"]);
    noIds(saved, "P0 response");
  });
  it("P1: two restricted literals under one (field, op); delete the FIRST -> [Y]", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const { now, saved } = await edit(id, (cs) => cs.filter((_, i) => i !== 0), "P1 delete first restricted");
    expect(now.map((x: Body) => x.value)).toEqual([H.y]);
    expect(saved.content.conditions.map((x: Body) => x.value), "P11 renumbered token of the new version").toEqual([T(saved.version, 1)]);
  });
  it("P2: a visible literal then a restricted one; delete the visible one -> [Y]", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.v },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const { shown, now } = await edit(id, (cs) => cs.filter((_, i) => i !== 0), "P2 delete visible first");
    expect(shown.content.conditions.map((x: Body) => x.value)).toEqual([H.v, T(shown.version, 2)]);
    expect(now.map((x: Body) => x.value)).toEqual([H.y]);
  });
  it("P3: an `in` list of two restricted literals; drop the first element -> [Y]", async () => {
    const id = await rule([{ field: "benefitId", op: "in", value: [H.x, H.y] }]);
    const { shown, now } = await edit(id, (cs) => cs.map((x) => ({ ...x, value: (x.value as string[]).slice(1) })), "P3 in-list drop first");
    expect(shown.content.conditions[0].value).toEqual([T(shown.version, 1), T(shown.version, 2)]);
    expect(now[0].value).toEqual([H.y]);
  });
});

describe("QA-R10 round-9 adversarial token cases (D-226, D-228 (1)) on the version-bound token", () => {
  it("P4 reorder: swap two restricted conditions and a visible one", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "severity", op: "eq", value: "high" },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const { now } = await edit(id, (cs) => [cs[2], cs[1], cs[0]], "P4 reorder");
    expect(now.map((x: Body) => x.value)).toEqual([H.y, "high", H.x]);
  });
  it("P5 move: a scalar token into an `in` list of another condition, and a list token to a scalar with another field/op", async () => {
    const id = await rule([
      { field: "benefitId", op: "eq", value: H.x },
      { field: "benefitId", op: "in", value: [H.v, H.y] },
    ]);
    const { shown, now } = await edit(
      id,
      (cs) => [
        { field: "benefitId", op: "in", value: [cs[0].value, H.v] },
        { field: "severity", op: "neq", value: cs[1].value[1] },
      ],
      "P5 move tokens",
    );
    const v = shown.version;
    expect(shown.content.conditions).toEqual([
      { field: "benefitId", op: "eq", value: T(v, 1) },
      { field: "benefitId", op: "in", value: [H.v, T(v, 3)] },
    ]);
    expect(now).toEqual([
      { field: "benefitId", op: "in", value: [H.x, H.v] },
      { field: "severity", op: "neq", value: H.y },
    ]);
  });
  it("P5b duplicate: the same token sent twice stores the same literal twice (no other literal is touched)", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const { now } = await edit(id, (cs) => [cs[0], { ...cs[0], op: "eq" }], "P5b duplicate token 1, drop token 2");
    expect(now).toEqual([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "eq", value: H.x },
    ]);
  });
  it("P6 refusals: bare marker, unknown token, marker-like variants, a token on create; nothing stored changes", async () => {
    const id = await rule([{ field: "benefitId", op: "neq", value: H.x }, { field: "severity", op: "eq", value: "high" }]);
    const before = await storedOf(id);
    const shown = await read(id);
    const v = shown.version;
    const results: Record<string, unknown> = {};
    const bads = [
      "[restricted]", T(v, 3), T(v, 9), `[restricted:${v}:0]`, `[restricted:${v}:01]`, `[Restricted:${v}:1]`,
      ` [restricted:${v}:1]`, `[restricted:${v}:1] `, "[ restricted ]", `[restricted:${v}:1]x`, `[restricted:${v}:10000]`,
      `[restricted:${v}:1`, `[restricted: ${v}:1]`, `[restricted:${v} :1]`, `[restricted:0${v}:1]`,
    ];
    for (const bad of bads) {
      const res = await patch(id, shown, [shown.content.conditions[0], { field: "severity", op: "eq", value: bad }]);
      results[JSON.stringify(bad)] = { status: res.status, code: res.body?.code, pointer: res.body?.errors?.[0]?.pointer };
    }
    const list = await patch(id, shown, [{ field: "benefitId", op: "in", value: [T(v, 1), "[restricted]"] }]);
    results["in [T1, bare]"] = { status: list.status, code: list.body?.code, pointer: list.body?.errors?.[0]?.pointer };
    const created = await send("POST", R, { session: admin.session, body: ruleBody([{ field: "benefitId", op: "eq", value: T(1, 1) }]) });
    results["create with [restricted:1:1]"] = { status: created.status, code: created.body?.code };
    const createdBare = await send("POST", R, { session: admin.session, body: ruleBody([{ field: "benefitId", op: "eq", value: "[restricted]" }]) });
    results["create with [restricted]"] = { status: createdBare.status, code: createdBare.body?.code };
    console.log(`QA-R10 P6 refusals (v=${v}): ${JSON.stringify(results)}`);
    for (const [k, r] of Object.entries(results)) {
      // surrounding blanks: the schema may trim; either refused or resolved to X is safe, record it.
      if (k === JSON.stringify(` [restricted:${v}:1]`) || k === JSON.stringify(`[restricted:${v}:1] `)) continue;
      expect((r as Body).status, k).toBe(422);
      expect(["automation_rule.restricted_marker_unknown", "automation_rule.restricted_token_stale"], k).toContain((r as Body).code);
    }
    expect(await storedOf(id)).toEqual(before);
    const after = await read(id);
    expect(after.version).toBe(shown.version);
  });
  it("P7 sensitivity changes between read and save: tokens resolved by position, nothing shifts or leaks", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.v },
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const shown = await read(id);
    const v = shown.version;
    expect(shown.content.conditions.map((x: Body) => x.value)).toEqual([H.v, T(v, 2), T(v, 3)]);
    await mark(H.v, true); // V becomes hidden after the read: the author sends its plain id back (D-223)
    await mark(H.x, false); // X becomes visible after the read: the author still holds token 2
    try {
      const res = ok(await patch(id, shown, [shown.content.conditions[0], shown.content.conditions[1]]));
      const now = await storedOf(id);
      console.log(`QA-R10 P7: stored ${JSON.stringify(now)}; response v${res.version} ${JSON.stringify(res.content.conditions)}`);
      expect(now.map((x: Body) => x.value)).toEqual([H.v, H.x]);
      expect(res.content.conditions.map((x: Body) => x.value)).toEqual([T(res.version, 1), H.x]);
      expect(JSON.stringify(res).includes(H.v)).toBe(false);
    } finally {
      await mark(H.v, false);
      await mark(H.x, true);
    }
  });
  it("P8 concurrent saves from the same read: the second is refused 409 (If-Match), never applies stale tokens", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const a = await read(id, admin.session);
    const b = await read(id, admin2.session);
    const [ra, rb] = await Promise.all([
      patch(id, a, [a.content.conditions[1]], admin.session),
      patch(id, b, [b.content.conditions[0], { field: "severity", op: "eq", value: "high" }], admin2.session),
    ]);
    const now = await storedOf(id);
    console.log(`QA-R10 P8: statuses ${ra.status}/${rb.status}; codes ${ra.body?.code}/${rb.body?.code}; stored ${JSON.stringify(now)}`);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    if (ra.status === 200) expect(now.map((x: Body) => x.value)).toEqual([H.y]);
    else expect(now.map((x: Body) => x.value)).toEqual([H.x, "high"]);
    const stale = await patch(id, a, [{ field: "benefitId", op: "neq", value: T(a.version, 2) }]);
    expect(stale.status).toBe(409);
    // the loser re-sends its stale draft with the REFRESHED If-Match (what an editor without reload would do)
    const cur = await read(id);
    const loser = ra.status === 409 ? a : b;
    const loserBody = ra.status === 409 ? [a.content.conditions[1]] : [b.content.conditions[0], { field: "severity", op: "eq", value: "high" }];
    const resent = await patchV(id, cur.version, loser, loserBody, ra.status === 409 ? admin.session : admin2.session);
    console.log(`QA-R10 P8 loser re-sent with If-Match ${cur.version}: ${resent.status} ${resent.body?.code}`);
    expect(resent.status).toBe(422);
    expect(resent.body?.code).toBe("automation_rule.restricted_token_stale");
    expect(await storedOf(id)).toEqual(now);
  });
  it("P9 a forged token for a position the author can read resolves to that visible literal (no disclosure)", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.v },
      { field: "benefitId", op: "neq", value: H.x },
    ]);
    const shown = await read(id);
    const res = ok(await patch(id, shown, [{ ...shown.content.conditions[0], value: T(shown.version, 1) }, shown.content.conditions[1]]));
    const stored = await storedOf(id);
    expect(stored.map((x: Body) => x.value)).toEqual([H.v, H.x]);
    expect(res.content.conditions.map((x: Body) => x.value)).toEqual([H.v, T(res.version, 2)]);
  });
  it("P10 a token pointing at a boolean position is refused", async () => {
    const id = await rule([
      { field: "severity", op: "eq", value: true },
      { field: "benefitId", op: "neq", value: H.x },
    ]);
    const shown = await read(id);
    expect(shown.content.conditions[1].value).toBe(T(shown.version, 2));
    const res = await patch(id, shown, [{ field: "severity", op: "eq", value: T(shown.version, 1) }, shown.content.conditions[1]]);
    console.log(`QA-R10 P10: ${res.status} ${res.body?.code}`);
    expect(res.status).toBe(422);
  });
  it("P12 after edits the rule list, rule, version list and readable summary name no hidden id", async () => {
    const id = await rule([
      { field: "benefitId", op: "in", value: [H.x, H.z] },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    await edit(id, (cs) => [cs[1], cs[0]], "P12 reorder");
    for (const p of [`${R}/${id}`, `${R}/${id}/versions`, `${R}/${id}/versions/1`, `${R}?limit=100`]) {
      const b = ok(await send("GET", p, { session: admin.session }));
      noIds(b, p);
    }
    const v = await read(id);
    console.log(`QA-R10 P12 summary ${JSON.stringify(v.summary)}`);
    expect(JSON.stringify(v.summary)).toContain("a restricted record");
    expect(v.content.conditions).toEqual([
      { field: "benefitId", op: "neq", value: T(v.version, 1) },
      { field: "benefitId", op: "in", value: [T(v.version, 2), T(v.version, 3)] },
    ]);
  });
});

describe("QA-R10 F-DG6-580 class (D-231): a token reused across a save", () => {
  it("P13 double save: save 1 removes condition 1; save 2 re-sends the same draft with the refreshed If-Match -> 422 stale, nothing changes", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.v },
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.z },
    ]);
    const shown = await read(id);
    const draft = [shown.content.conditions[1], shown.content.conditions[2]];
    const s1 = ok(await patch(id, shown, draft));
    const after1 = await storedOf(id);
    expect(after1.map((x: Body) => x.value)).toEqual([H.x, H.z]);
    const s2 = await patchV(id, s1.version, shown, draft);
    const after2 = await storedOf(id);
    console.log(`QA-R10 P13: shown v${shown.version} ${JSON.stringify(shown.content.conditions.map((x: Body) => x.value))}; save1 -> ${JSON.stringify(after1)}; save2 (If-Match ${s1.version}, same draft) -> ${s2.status} ${s2.body?.code} ${JSON.stringify(s2.body?.errors)}; stored ${JSON.stringify(after2)}`);
    expect(s2.status).toBe(422);
    expect(s2.body?.code).toBe("automation_rule.restricted_token_stale");
    expect(s2.body?.errors?.[0]?.pointer).toBe("/content/conditions/0/value");
    expect(after2).toEqual(after1);
    noIds(s2.body, "P13 refusal");
    // the reloaded draft (the editor's new path) re-saves cleanly and keeps X and Z
    const cur = await read(id);
    const s3 = ok(await patch(id, cur, cur.content.conditions));
    expect((await storedOf(id)).map((x: Body) => x.value)).toEqual([H.x, H.z]);
    expect(s3.content.conditions.map((x: Body) => x.value)).toEqual([T(s3.version, 1), T(s3.version, 2)]);
  });
  it("P14 other-version tokens (v-1, v+1, 0, 10 digits, 11 digits, the retired [restricted:k]) are refused; nothing changes", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    // move the row version past 1 so that v-1 is a real earlier version
    const first = await read(id);
    ok(await patch(id, first, first.content.conditions));
    const shown = await read(id);
    const before = await storedOf(id);
    const v = shown.version;
    const out: Record<string, unknown> = {};
    for (const tok of [T(v - 1, 1), T(v + 1, 1), `[restricted:0:1]`, `[restricted:9999999999:1]`, `[restricted:99999999999:1]`, `[restricted:1]`, `[restricted:${v}]`]) {
      const res = await patch(id, shown, [{ field: "benefitId", op: "neq", value: tok }, shown.content.conditions[1]]);
      out[tok] = `${res.status} ${res.body?.code}`;
      expect(res.status, tok).toBe(422);
      expect(["automation_rule.restricted_token_stale", "automation_rule.restricted_marker_unknown"], tok).toContain(res.body?.code);
    }
    console.log(`QA-R10 P14 (v=${v}): ${JSON.stringify(out)}`);
    expect(out[T(v - 1, 1)]).toContain("restricted_token_stale");
    expect(out[T(v + 1, 1)]).toContain("restricted_token_stale");
    expect(await storedOf(id)).toEqual(before);
  });
  it("P15 a token copied from another rule whose row version coincides resolves only against the target draft's own literals", async () => {
    const a = await rule([{ field: "benefitId", op: "neq", value: H.x }]);
    const b = await rule([{ field: "benefitId", op: "neq", value: H.y }]);
    const ra = await read(a);
    const rb = await read(b);
    expect(ra.version).toBe(rb.version);
    // send rule A's token (names X in A) to rule B
    const res = await patch(b, rb, [{ field: "benefitId", op: "neq", value: ra.content.conditions[0].value }]);
    const stored = await storedOf(b);
    console.log(`QA-R10 P15: A token ${ra.content.conditions[0].value} sent to B (v${rb.version}) -> ${res.status} ${res.body?.code}; B stored ${JSON.stringify(stored)}`);
    // Observation, not an assertion of a defect: the token's identity is (row version, position) of the version it
    // replaces; a cross-rule copy can only resolve to B's own literal Y (never A's X) -- no disclosure, no X in B.
    expect(JSON.stringify(stored).includes(H.x)).toBe(false);
    expect(stored.map((x: Body) => x.value)).toEqual([H.y]);
  });
  it("P16 a grant given between read and save, plus a stale token: refused; after the grant the reader sees the literals and no token", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const shown = await read(id);
    ok(await patch(id, shown, [shown.content.conditions[1]])); // stores [Y]
    await mark(H.y, false); // Y visible now
    try {
      const res = await patchV(id, shown.version + 1, shown, [shown.content.conditions[1]]);
      console.log(`QA-R10 P16 stale after unmark: ${res.status} ${res.body?.code}; stored ${JSON.stringify(await storedOf(id))}`);
      expect(res.status).toBe(422);
      expect(res.body?.code).toBe("automation_rule.restricted_token_stale");
      expect((await storedOf(id)).map((x: Body) => x.value)).toEqual([H.y]);
      const now = await read(id);
      expect(now.content.conditions.map((x: Body) => x.value)).toEqual([H.y]);
      expect(now.includesRestrictedRecords ?? false).toBe(false);
    } finally {
      await mark(H.y, true);
    }
  });
  it("P17 ten successive saves, each built from the previous served response (the editor's path), keep every hidden literal", async () => {
    const id = await rule([
      { field: "benefitId", op: "in", value: [H.x, H.v, H.y] },
      { field: "severity", op: "eq", value: "high" },
      { field: "benefitId", op: "neq", value: H.z },
    ]);
    let cur = await read(id);
    for (let i = 0; i < 10; i++) {
      const cs = cur.content.conditions as Body[];
      // rotate the conditions and flip severity: tokens move around every time
      const next = [cs[2], { ...cs[1], value: cs[1].value === "high" ? "critical" : "high" }, cs[0]].map((x: Body) =>
        Array.isArray(x.value) ? { ...x, value: [...x.value].reverse() } : x,
      );
      cur = ok(await patch(id, cur, next));
    }
    const stored = await storedOf(id);
    console.log(`QA-R10 P17 after 10 saves: stored ${JSON.stringify(stored)}; shown v${cur.version} ${JSON.stringify(cur.content.conditions)}`);
    const flat = JSON.stringify(stored);
    for (const h of [H.x, H.y, H.z, H.v]) expect(flat.split(h).length - 1, h).toBe(1);
    expect(flat.includes("restricted")).toBe(false);
    noIds(cur, "P17 response");
  });
});
