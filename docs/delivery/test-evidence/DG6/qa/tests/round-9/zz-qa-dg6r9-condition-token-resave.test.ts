// qa-verifier DG6 round 9 (T-DG6-REV-QA-R9, run 7e2124db) on candidate fe824c05 (source d974011f): independent probe,
// NOT part of the frozen candidate. Copied into a disposable clone as
// apps/api/test/integration/access/zz-qa-dg6r9-condition-token-resave.test.ts and run with tests/qa/support/with-pg.sh.
// Re-runs round 8's F-DG6-560 reproduction (zz-qa-dg6r8b-condition-resave-pairing.test.ts, P0-P3) on the D-226 token
// model (the author is shown `[restricted:k]`, k = position among ALL literals of the stored version, D-228 (1)) and
// adds adversarial cases:
//   P4 reorder; P5 move a token to another condition / field / into an `in` list; P6 refusals (bare marker, unknown
//   token, marker-like variants, a token on create); P7 a grant/sensitivity change between read and save; P8 two
//   concurrent saves with the same read (If-Match); P9 a forged token for a position the author can read; P10 a forged
//   token at a boolean position; P11 the response after a save carries renumbered tokens and no id; P12 the rule list,
//   version list and summary name no hidden id after an edit.
// Revision b: P5 uses the trigger's other field (severity) instead of initiativeId, P10 a boolean on severity, P12
// limit=100 (revision a's three failures were probe errors: the trigger benefit.variance_evaluated has fields
// {benefitId, severity} only, and the list limit is at most 100; see 20-probe-token-resave.log).
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
const T = (k: number) => `[restricted:${k}]`;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status);
  return res.body as Body;
};
const storedOf = async (ruleId: string) =>
  (
    (await api.db
      .selectFrom("automation_rule_version")
      .select(["conditions"])
      .where("automation_rule_id", "=", ruleId)
      .where("version_no", "=", 1)
      .executeTakeFirstOrThrow()) as { conditions: Body }
  ).conditions;

const ruleBody = (conditions: Body[]) => ({
  code: `qa.r9.${randomUUID().slice(0, 8)}`,
  nameEn: "QA-R9 synthetic token probe",
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
const patch = (ruleId: string, shown: Body, conditions: Body[], s = admin.session) =>
  send("PATCH", `${R}/${ruleId}/versions/1`, {
    session: s,
    headers: ifm(shown.version),
    body: { content: { ...shown.content, conditions }, changeSummary: "QA-R9 probe" },
  });

async function edit(ruleId: string, change: (conds: Body[]) => Body[], label: string) {
  const shown = await read(ruleId);
  const sent = change(shown.content.conditions);
  const saved = ok(await patch(ruleId, shown, sent));
  const now = await storedOf(ruleId);
  console.log(
    `QA-R9 ${label}: author saw ${JSON.stringify(shown.content.conditions)}; sent ${JSON.stringify(sent)}; ` +
      `stored now ${JSON.stringify(now)}; author response ${JSON.stringify(saved.content.conditions)} marker ${String(saved.includesRestrictedRecords)}`,
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
      body: { isSensitive: on, reason: "QA-R9 synthetic sensitivity" },
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
  console.log(`QA-R9 ids: hidden X=${H.x} hidden Y=${H.y} hidden Z=${H.z} visible V=${H.v}`);
}, 300_000);
afterAll(() => api?.close());

describe("QA-R9 F-DG6-560 re-run (round-8 P0-P3) on the token model", () => {
  it("P0 control: changing only an unrelated condition keeps both hidden literals", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
      { field: "severity", op: "eq", value: "high" },
    ]);
    const { shown, now, saved } = await edit(id, (cs) => cs.map((x) => (x.field === "severity" ? { ...x, value: "critical" } : x)), "P0");
    expect(shown.content.conditions.map((x: Body) => x.value)).toEqual([T(1), T(2), "high"]);
    expect(now.map((x: Body) => x.value)).toEqual([H.x, H.y, "critical"]);
    expect(saved.includesRestrictedRecords).toBe(true);
    noIds(saved, "P0 response");
  });
  it("P1: two restricted literals under one (field, op); delete the FIRST -> [Y]", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const { now, saved } = await edit(id, (cs) => cs.filter((_, i) => i !== 0), "P1 delete first restricted");
    expect(now.map((x: Body) => x.value)).toEqual([H.y]);
    expect(saved.content.conditions.map((x: Body) => x.value), "P11 renumbered token").toEqual([T(1)]);
  });
  it("P2: a visible literal then a restricted one; delete the visible one -> [Y]", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.v },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const { shown, now } = await edit(id, (cs) => cs.filter((_, i) => i !== 0), "P2 delete visible first");
    expect(shown.content.conditions.map((x: Body) => x.value)).toEqual([H.v, T(2)]);
    expect(now.map((x: Body) => x.value)).toEqual([H.y]);
  });
  it("P3: an `in` list of two restricted literals; drop the first element -> [Y]", async () => {
    const id = await rule([{ field: "benefitId", op: "in", value: [H.x, H.y] }]);
    const { shown, now } = await edit(id, (cs) => cs.map((x) => ({ ...x, value: (x.value as string[]).slice(1) })), "P3 in-list drop first");
    expect(shown.content.conditions[0].value).toEqual([T(1), T(2)]);
    expect(now[0].value).toEqual([H.y]);
  });
});

describe("QA-R9 adversarial token cases (D-226, D-228 (1))", () => {
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
    expect(shown.content.conditions).toEqual([
      { field: "benefitId", op: "eq", value: T(1) },
      { field: "benefitId", op: "in", value: [H.v, T(3)] },
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
    const results: Record<string, unknown> = {};
    for (const bad of ["[restricted]", T(3), T(9), "[restricted:0]", "[restricted:01]", "[Restricted:1]", " [restricted:1]", "[restricted:1] ", "[ restricted ]", "[restricted:1]x", "[restricted:10000]"]) {
      const res = await patch(id, shown, [shown.content.conditions[0], { field: "severity", op: "eq", value: bad }]);
      results[JSON.stringify(bad)] = { status: res.status, code: res.body?.code, pointer: res.body?.errors?.[0]?.pointer };
    }
    const list = await patch(id, shown, [{ field: "benefitId", op: "in", value: [T(1), "[restricted]"] }]);
    results["in [T1, bare]"] = { status: list.status, code: list.body?.code, pointer: list.body?.errors?.[0]?.pointer };
    const created = await send("POST", R, { session: admin.session, body: ruleBody([{ field: "benefitId", op: "eq", value: T(1) }]) });
    results["create with [restricted:1]"] = { status: created.status, code: created.body?.code };
    const createdBare = await send("POST", R, { session: admin.session, body: ruleBody([{ field: "benefitId", op: "eq", value: "[restricted]" }]) });
    results["create with [restricted]"] = { status: createdBare.status, code: createdBare.body?.code };
    console.log(`QA-R9 P6 refusals: ${JSON.stringify(results)}`);
    for (const [k, r] of Object.entries(results)) {
      // " [restricted:1]" with surrounding blanks: the schema may trim; either refused or resolved to X is safe, record it.
      if (k === JSON.stringify(" [restricted:1]") || k === JSON.stringify("[restricted:1] ")) continue;
      expect((r as Body).status, k).toBe(422);
      expect((r as Body).code, k).toBe("automation_rule.restricted_marker_unknown");
    }
    expect(await storedOf(id)).toEqual(before);
    const v = await read(id);
    expect(v.version).toBe(shown.version);
  });
  it("P7 sensitivity changes between read and save: tokens resolved by position, nothing shifts or leaks", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.v },
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const shown = await read(id);
    expect(shown.content.conditions.map((x: Body) => x.value)).toEqual([H.v, T(2), T(3)]);
    await mark(H.v, true); // V becomes hidden after the read: the author sends its plain id back (D-223)
    await mark(H.x, false); // X becomes visible after the read: the author still holds token 2
    try {
      // the author deletes condition 3 (Y) and keeps the others as shown
      const res = ok(await patch(id, shown, [shown.content.conditions[0], shown.content.conditions[1]]));
      const now = await storedOf(id);
      console.log(`QA-R9 P7: sent ${JSON.stringify([shown.content.conditions[0], shown.content.conditions[1]])}; stored ${JSON.stringify(now)}; response ${JSON.stringify(res.content.conditions)}`);
      expect(now.map((x: Body) => x.value)).toEqual([H.v, H.x]);
      // the response now shows V as token 1 (hidden now) and X in clear (visible now)
      expect(res.content.conditions.map((x: Body) => x.value)).toEqual([T(1), H.x]);
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
    console.log(`QA-R9 P8: statuses ${ra.status}/${rb.status}; codes ${ra.body?.code}/${rb.body?.code}; stored ${JSON.stringify(now)}`);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    if (ra.status === 200) expect(now.map((x: Body) => x.value)).toEqual([H.y]);
    else expect(now.map((x: Body) => x.value)).toEqual([H.x, "high"]);
    // and a stale token after a successful save is refused or conflicts, never misplaced
    const stale = await patch(id, a, [{ field: "benefitId", op: "neq", value: T(2) }]);
    expect(stale.status).toBe(409);
  });
  it("P9 a forged token for a position the author can read resolves to that visible literal (no disclosure)", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.v },
      { field: "benefitId", op: "neq", value: H.x },
    ]);
    const { now, saved } = await edit(id, (cs) => [{ ...cs[0], value: T(1) }, cs[1]], "P9 forged visible token");
    expect(now.map((x: Body) => x.value)).toEqual([H.v, H.x]);
    expect(saved.content.conditions.map((x: Body) => x.value)).toEqual([H.v, T(2)]);
  });
  it("P10 a token pointing at a boolean position is refused", async () => {
    const id = await rule([
      { field: "severity", op: "eq", value: true },
      { field: "benefitId", op: "neq", value: H.x },
    ]);
    const shown = await read(id);
    console.log(`QA-R9 P10 shown ${JSON.stringify(shown.content.conditions)}`);
    expect(shown.content.conditions[1].value).toBe(T(2));
    const res = await patch(id, shown, [{ field: "severity", op: "eq", value: T(1) }, shown.content.conditions[1]]);
    console.log(`QA-R9 P10: ${res.status} ${res.body?.code}`);
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
    console.log(`QA-R9 P12 summary ${JSON.stringify(v.summary)}`);
    expect(JSON.stringify(v.summary)).toContain("a restricted record");
    expect(v.content.conditions).toEqual([
      { field: "benefitId", op: "neq", value: T(1) },
      { field: "benefitId", op: "in", value: [T(2), T(3)] },
    ]);
  });
});
