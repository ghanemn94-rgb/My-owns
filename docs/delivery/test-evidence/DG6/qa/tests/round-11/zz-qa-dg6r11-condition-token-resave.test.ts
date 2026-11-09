// qa-verifier DG6 round 11 (T-DG6-REV-QA-R11, session fa2fa4eb) on candidate c45d73b8 (source 33db1a46): independent
// probe, NOT part of the frozen candidate. Copied into a disposable clone as
// apps/api/test/integration/access/zz-qa-dg6r11-condition-token-resave.test.ts and run with tests/qa/support/with-pg.sh.
//
// Port of round 10's probe to the issuer-bound token of D-233 (`[restricted:<tag>:<k>]`, tag = HMAC(row key, id, row
// version) truncated to 24 hex): every round-10 behaviour assertion stands (P0-P13, P16, P17). Expected tokens are
// computed from the row key read from the disposable DB (never from the API, which never serves it).
// Rewritten / new in round 11 (F-DG6-640 class, D-233):
//   P14 tokens of the same row at v-1 and v+1, a random 24-hex tag, the retired `[restricted:<v>:<k>]` form at the
//       CURRENT version, an uppercase tag, 23/25-hex tags -> all refused, nothing changes;
//   P15 a token copied from ANOTHER RULE whose row version coincides -> 422 stale (round 10 accepted it: observation);
//   P15b a token copied from the PUBLISHED version 1 into its draft version 2 at the same row version -> 422 stale;
//   P18 the key is never served: no response, audit row, or the version's ETag carries it (hex or base64); tags are
//       24 hex, differ per row and per row version, and contain no fragment of the row id;
//   P19 the key is immutable (direct UPDATE refused by the 0127 trigger) and a new draft draws its own key;
//   P20 eight concurrent saves from the same read: exactly one 200, seven 409; each loser's re-send with the
//       refreshed If-Match is 422 stale; the hidden literal is stored exactly once;
//   P21 a principal admitted to the record (no token shown) edits freely, and a token issued to ANOTHER reader for
//       this very row and version resolves (tags do not depend on the reader; no disclosure: same row's own literal).
// Revision b (run 20 -> 20b): P19's direct UPDATE now also bumps `version` (run 20 was refused by the ADR-0003 version
// trigger before the 0127 key trigger was reached: a probe error, not a product result).
// Every value is SYNTHETIC; marking a record sensitive is an access decision, never a G1-G6 business approval; nothing
// here relates to DG0-DG7.
import { createDb, insertAuditEvent, sql, type Db } from "@mth/db";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, createUser, grant, seedWorld, signIn, startApi, type Res, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { automationRestrictedToken } from "@mth/shared/schemas";
import { restrictedTokenTag } from "../../../src/modules/automation/versions.ts";
import { launchedInitiative, pendingBenefit, seedClosureWorld, type ClosureWorld } from "../contract/p4-exercises-be-j.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let c: ClosureWorld;
let owner: Db;
const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };
let admin: { id: string; session: Session };
let admin2: { id: string; session: Session };
const H = { x: "", y: "", v: "", z: "" };
const R = "/api/v1/admin/automation-rules";
// Round 11 (D-233): the token is `[restricted:<tag>:<k>]`; the tag is opaque to a client, so every expected token is
// computed from the issuing row's key read from the disposable database (the API's own restrictedTokenTag), keyed by
// (rule id, version_no, row version). T(v,k) below means "the token of the rule under test at row version v".
const TAGRE = /^\[restricted:([0-9a-f]{24}):([1-9][0-9]{0,3})\]$/;
const issuers = new Map<string, { id: string; key: Buffer }>();
let current = "";
async function issuer(ruleId: string, versionNo = 1) {
  const k = `${ruleId}/${versionNo}`;
  if (!issuers.has(k)) {
    const row = await api.db.selectFrom("automation_rule_version").select(["id", "restricted_token_key"])
      .where("automation_rule_id", "=", ruleId).where("version_no", "=", versionNo).executeTakeFirstOrThrow();
    issuers.set(k, { id: row.id, key: row.restricted_token_key });
  }
  return issuers.get(k)!;
}
const tokOf = (ruleId: string, version: number, k: number, versionNo = 1) => {
  const i = issuers.get(`${ruleId}/${versionNo}`);
  if (i === undefined) throw new Error(`issuer ${ruleId}/${versionNo} not loaded`);
  return automationRestrictedToken(restrictedTokenTag({ id: i.id, version, restricted_token_key: i.key }), k);
};
const T = (version: number, k: number) => tokOf(current, version, k);
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
  code: `qa.r11.${randomUUID().slice(0, 8)}`,
  nameEn: "QA-R11 synthetic token probe",
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
  const id = ok(await send("POST", R, { session: admin.session, body: ruleBody(conditions) }), 201).id as string;
  await issuer(id);
  current = id;
  return id;
}
const read = async (ruleId: string, s = admin.session) => ok(await send("GET", `${R}/${ruleId}/versions/1`, { session: s }));
const patchV = (ruleId: string, ifMatch: number, base: Body, conditions: Body[], s = admin.session) =>
  send("PATCH", `${R}/${ruleId}/versions/1`, {
    session: s,
    headers: ifm(ifMatch),
    body: { content: { ...base.content, conditions }, changeSummary: "QA-R11 probe" },
  });
const patch = (ruleId: string, shown: Body, conditions: Body[], s = admin.session) =>
  patchV(ruleId, shown.version, shown, conditions, s);

async function edit(ruleId: string, change: (conds: Body[]) => Body[], label: string) {
  const shown = await read(ruleId);
  const sent = change(shown.content.conditions);
  const saved = ok(await patch(ruleId, shown, sent));
  const now = await storedOf(ruleId);
  console.log(
    `QA-R11 ${label}: author saw v${shown.version} ${JSON.stringify(shown.content.conditions)}; sent ${JSON.stringify(sent)}; ` +
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
      body: { isSensitive: on, reason: "QA-R11 synthetic sensitivity" },
    }),
  );
};
const noIds = (b: Body, what: string) => {
  const s = JSON.stringify(b);
  for (const id of [H.x, H.y, H.z]) expect(s.includes(id), `${what} names hidden ${id}`).toBe(false);
};

async function publishViaDb(ruleId: string, versionNo: number) {
  await owner.transaction().execute(async (tx) => {
    const v = await tx.selectFrom("automation_rule_version").selectAll().where("automation_rule_id", "=", ruleId).where("version_no", "=", versionNo).executeTakeFirstOrThrow();
    const runId = uuidv7();
    await tx.insertInto("automation_dry_run").values({ id: runId, automation_rule_version_id: v.id, content_sha256: v.content_sha256, sample_event: JSON.stringify({ fixture: true }), outcome: "pass", run_by: admin.id }).execute();
    await insertAuditEvent(tx, SYSTEM, { action: "test.seed", recordType: "automation_dry_run", recordId: runId, organizationId: c.b.organizationId });
    let version = v.version;
    for (const st of [
      { status: "in_review", submitted_at: new Date() },
      { status: "approved", reviewed_by: w.grantor.id, reviewed_at: new Date() },
      { status: "published", published_by: admin.id, published_at: new Date() },
    ] as Record<string, unknown>[]) {
      version += 1;
      await tx.updateTable("automation_rule_version").set({ ...st, version }).where("id", "=", v.id).execute();
      await insertAuditEvent(tx, SYSTEM, { action: "test.seed", recordType: "automation_rule_version", recordId: v.id, organizationId: c.b.organizationId, newVersion: version });
    }
    const r = await tx.selectFrom("automation_rule").selectAll().where("id", "=", ruleId).executeTakeFirstOrThrow();
    await tx.updateTable("automation_rule").set({ effective_version_id: v.id, version: r.version + 1 }).where("id", "=", ruleId).execute();
    await insertAuditEvent(tx, SYSTEM, { action: "test.seed", recordType: "automation_rule", recordId: ruleId, organizationId: c.b.organizationId, newVersion: r.version + 1 });
  });
}

beforeAll(async () => {
  api = await startApi();
  owner = createDb(api.owner);
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
  console.log(`QA-R11 ids: hidden X=${H.x} hidden Y=${H.y} hidden Z=${H.z} visible V=${H.v}`);
}, 300_000);
afterAll(() => api?.close());

describe("QA-R11 F-DG6-560 re-run (round-8 P0-P3) on the version-bound token model", () => {
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

describe("QA-R11 round-9 adversarial token cases (D-226, D-228 (1)) on the version-bound token", () => {
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
    console.log(`QA-R11 P6 refusals (v=${v}): ${JSON.stringify(results)}`);
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
      console.log(`QA-R11 P7: stored ${JSON.stringify(now)}; response v${res.version} ${JSON.stringify(res.content.conditions)}`);
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
    console.log(`QA-R11 P8: statuses ${ra.status}/${rb.status}; codes ${ra.body?.code}/${rb.body?.code}; stored ${JSON.stringify(now)}`);
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
    console.log(`QA-R11 P8 loser re-sent with If-Match ${cur.version}: ${resent.status} ${resent.body?.code}`);
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
    console.log(`QA-R11 P10: ${res.status} ${res.body?.code}`);
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
    console.log(`QA-R11 P12 summary ${JSON.stringify(v.summary)}`);
    expect(JSON.stringify(v.summary)).toContain("a restricted record");
    expect(v.content.conditions).toEqual([
      { field: "benefitId", op: "neq", value: T(v.version, 1) },
      { field: "benefitId", op: "in", value: [T(v.version, 2), T(v.version, 3)] },
    ]);
  });
});

describe("QA-R11 F-DG6-580 class (D-231): a token reused across a save", () => {
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
    console.log(`QA-R11 P13: shown v${shown.version} ${JSON.stringify(shown.content.conditions.map((x: Body) => x.value))}; save1 -> ${JSON.stringify(after1)}; save2 (If-Match ${s1.version}, same draft) -> ${s2.status} ${s2.body?.code} ${JSON.stringify(s2.body?.errors)}; stored ${JSON.stringify(after2)}`);
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
      console.log(`QA-R11 P16 stale after unmark: ${res.status} ${res.body?.code}; stored ${JSON.stringify(await storedOf(id))}`);
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
    console.log(`QA-R11 P17 after 10 saves: stored ${JSON.stringify(stored)}; shown v${cur.version} ${JSON.stringify(cur.content.conditions)}`);
    const flat = JSON.stringify(stored);
    for (const h of [H.x, H.y, H.z, H.v]) expect(flat.split(h).length - 1, h).toBe(1);
    expect(flat.includes("restricted")).toBe(false);
    noIds(cur, "P17 response");
  });
});

describe("QA-R11 F-DG6-640 class (D-233): a token is bound to its issuing row and revision", () => {
  it("P14 same-row tokens of v-1 / v+1, a random tag, the retired form at the current version, case and length variants: refused; nothing changes", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const first = await read(id);
    ok(await patch(id, first, first.content.conditions));
    const shown = await read(id);
    const before = await storedOf(id);
    const v = shown.version;
    const tag = TAGRE.exec(shown.content.conditions[0].value)![1]!;
    const out: Record<string, unknown> = {};
    const cases: [string, string][] = [
      [T(v - 1, 1), "stale"], [T(v + 1, 1), "stale"], ["[restricted:0123456789abcdef01234567:1]", "stale"],
      [`[restricted:${v}:1]`, "stale"], [`[restricted:${tag.toUpperCase()}:1]`, "unknown"],
      [`[restricted:${tag.slice(1)}:1]`, "either"], [`[restricted:${tag}0:1]`, "either"], [`[restricted:${tag}:3]`, "unknown"],
      [`[restricted:${tag}:0]`, "either"], ["[restricted:1]", "either"],
    ];
    for (const [tok, want] of cases) {
      const res = await patch(id, shown, [{ field: "benefitId", op: "neq", value: tok }, shown.content.conditions[1]]);
      out[tok] = `${res.status} ${res.body?.code}`;
      expect(res.status, tok).toBe(422);
      if (want === "stale") expect(res.body?.code, tok).toBe("automation_rule.restricted_token_stale");
      else if (want === "unknown") expect(res.body?.code, tok).toBe("automation_rule.restricted_marker_unknown");
      else expect(["automation_rule.restricted_token_stale", "automation_rule.restricted_marker_unknown"], tok).toContain(res.body?.code);
      noIds(res.body, tok);
    }
    console.log(`QA-R11 P14 (v=${v}, tag ${tag}): ${JSON.stringify(out)}`);
    expect(await storedOf(id)).toEqual(before);
    expect((await read(id)).version).toBe(v);
  });
  it("P15 a token copied from another rule whose row version coincides is refused stale (F-DG6-640); B unchanged", async () => {
    const a = await rule([{ field: "benefitId", op: "neq", value: H.x }]);
    const b = await rule([{ field: "benefitId", op: "neq", value: H.y }]);
    const ra = await read(a);
    const rb = await read(b);
    expect(ra.version).toBe(rb.version);
    expect(ra.content.conditions[0].value).not.toBe(rb.content.conditions[0].value);
    const before = await storedOf(b);
    const res = await patch(b, rb, [{ field: "benefitId", op: "neq", value: ra.content.conditions[0].value }]);
    console.log(`QA-R11 P15: A token ${ra.content.conditions[0].value} sent to B token ${rb.content.conditions[0].value} (v${rb.version}) -> ${res.status} ${res.body?.code}`);
    expect(res.status).toBe(422);
    expect(res.body?.code).toBe("automation_rule.restricted_token_stale");
    expect(await storedOf(b)).toEqual(before);
    // mixed: B's own token plus A's token in one list -> still refused, nothing stored
    const mixed = await patch(b, rb, [{ field: "benefitId", op: "in", value: [rb.content.conditions[0].value, ra.content.conditions[0].value] }]);
    expect(mixed.status).toBe(422);
    expect(mixed.body?.code).toBe("automation_rule.restricted_token_stale");
    expect(mixed.body?.errors?.[0]?.pointer).toBe("/content/conditions/0/value/1");
    expect(await storedOf(b)).toEqual(before);
  });
  it("P15b a token copied from the published version 1 into its draft version 2 is refused stale; the draft's own token resolves", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    await publishViaDb(id, 1); // synthetic configuration review through the 0074 guard (the z15 suite's method); no business approval
    const ruleRow = ok(await send("GET", `${R}/${id}`, { session: admin.session }));
    const created = ok(await send("POST", `${R}/${id}/versions`, { session: admin.session, headers: ifm(ruleRow.version), body: { changeSummary: "QA-R11 v2" } }), 201);
    await issuer(id, 2);
    const p1 = await read(id);
    const d2 = ok(await send("GET", `${R}/${id}/versions/${created.versionNo ?? 2}`, { session: admin.session }));
    console.log(`QA-R11 P15b v1 (row v${p1.version}) ${JSON.stringify(p1.content.conditions)}; v2 (row v${d2.version}) ${JSON.stringify(d2.content.conditions)}`);
    const before = await storedOf(id, 2);
    // the published token pasted into the draft (any row version, here whatever v1 shows)
    const res = await send("PATCH", `${R}/${id}/versions/2`, {
      session: admin.session, headers: ifm(d2.version),
      body: { content: { ...d2.content, conditions: [{ field: "benefitId", op: "neq", value: p1.content.conditions[1].value }] } },
    });
    // and a token computed for version row 1 at the DRAFT's row version (the exact F-DG6-640 coincidence)
    const forged = tokOf(id, d2.version, 2, 1);
    const res2 = await send("PATCH", `${R}/${id}/versions/2`, {
      session: admin.session, headers: ifm(d2.version),
      body: { content: { ...d2.content, conditions: [{ field: "benefitId", op: "neq", value: forged }] } },
    });
    console.log(`QA-R11 P15b pasted published token -> ${res.status} ${res.body?.code}; v1-row token at v2's row version -> ${res2.status} ${res2.body?.code}`);
    for (const r of [res, res2]) {
      expect(r.status).toBe(422);
      expect(r.body?.code).toBe("automation_rule.restricted_token_stale");
    }
    expect(await storedOf(id, 2)).toEqual(before);
    // the draft's own token for position 2 resolves to Y
    const own = ok(await send("PATCH", `${R}/${id}/versions/2`, {
      session: admin.session, headers: ifm(d2.version),
      body: { content: { ...d2.content, conditions: [d2.content.conditions[1]] } },
    }));
    expect((await storedOf(id, 2)).map((x: Body) => x.value)).toEqual([H.y]);
    expect(own.content.conditions[0].value).toBe(tokOf(id, own.version, 1, 2));
  });
  it("P18 the key is never served or audited; tags are 24 hex, per row and per revision, and carry no fragment of the row id", async () => {
    const a = await rule([{ field: "benefitId", op: "neq", value: H.x }, { field: "benefitId", op: "neq", value: H.y }]);
    const ia = await issuer(a);
    const keyHex = ia.key.toString("hex");
    const keyB64 = ia.key.toString("base64");
    const keyB64u = ia.key.toString("base64url");
    const half = keyHex.slice(0, 16);
    const bodies: string[] = [];
    for (const p of [`${R}/${a}`, `${R}/${a}/versions`, `${R}/${a}/versions/1`, `${R}?limit=100`]) {
      const res = await send("GET", p, { session: admin.session });
      bodies.push(JSON.stringify(res.body) + JSON.stringify(res.headers ?? {}));
    }
    const shown = await read(a);
    const saved = ok(await patch(a, shown, shown.content.conditions));
    bodies.push(JSON.stringify(saved));
    const audits = await api.db.selectFrom("audit_event").selectAll().where("record_id", "=", ia.id).execute();
    bodies.push(JSON.stringify(audits));
    const outbox = await api.db.selectFrom("outbox_event").selectAll().where("aggregate_id", "=", ia.id).execute();
    bodies.push(JSON.stringify(outbox));
    // and the whole audit and outbox tables (every key of every version row, hex)
    const allKeys = (await api.db.selectFrom("automation_rule_version").select(["restricted_token_key"]).execute()).map((k) => (k.restricted_token_key as Buffer).toString("hex"));
    const everything = JSON.stringify(await api.db.selectFrom("audit_event").select(["changes", "reason"]).execute()) + JSON.stringify(await api.db.selectFrom("outbox_event").select(["payload"]).execute());
    for (const kh of allKeys) expect(everything.includes(kh), "a key in audit/outbox").toBe(false);
    const all = bodies.join("\n");
    for (const needle of [keyHex, keyB64, keyB64u, half, "restricted_token_key", "restrictedTokenKey"]) {
      expect(all.includes(needle), `served/audited text contains ${needle.slice(0, 12)}`).toBe(false);
    }
    expect(audits.length).toBeGreaterThanOrEqual(2);
    const t1 = TAGRE.exec(shown.content.conditions[0].value)![1]!;
    const t2 = TAGRE.exec(saved.content.conditions[0].value)![1]!;
    expect(t1).toMatch(/^[0-9a-f]{24}$/);
    expect(t1).not.toBe(t2);
    expect(TAGRE.exec(shown.content.conditions[1].value)![1]).toBe(t1);
    const idHex = ia.id.replace(/-/g, "");
    for (let i = 0; i + 6 <= t1.length; i++) expect(idHex.includes(t1.slice(i, i + 6)), `tag fragment ${t1.slice(i, i + 6)}`).toBe(false);
    const b = await rule([{ field: "benefitId", op: "neq", value: H.x }]);
    const rb = await read(b);
    expect(TAGRE.exec(rb.content.conditions[0].value)![1]).not.toBe(t1);
    console.log(`QA-R11 P18 tags: a@v${shown.version}=${t1} a@v${saved.version}=${t2} b@v${rb.version}=${TAGRE.exec(rb.content.conditions[0].value)![1]}; audits ${audits.length}; key never found`);
  });
  it("P19 the key is immutable (0127 trigger) and every row has its own 32-byte key", async () => {
    const a = await rule([{ field: "benefitId", op: "neq", value: H.x }]);
    const ia = await issuer(a);
    let err = "";
    try {
      await api.db.updateTable("automation_rule_version").set({ restricted_token_key: Buffer.alloc(32, 7), version: sql<number>`version + 1` }).where("id", "=", ia.id).execute();
    } catch (e) {
      err = String((e as Error).message);
    }
    console.log(`QA-R11 P19 direct key UPDATE -> ${err || "ACCEPTED"}`);
    expect(err).toContain("restricted_token_key");
    const keys = await api.db.selectFrom("automation_rule_version").select(["restricted_token_key"]).execute();
    const hex = keys.map((k) => (k.restricted_token_key as Buffer).toString("hex"));
    expect(new Set(hex).size).toBe(hex.length);
    for (const h of hex) expect(h.length).toBe(64);
    console.log(`QA-R11 P19 ${hex.length} rows, ${new Set(hex).size} distinct 32-byte keys`);
  });
  it("P20 eight concurrent saves from one read: one 200, seven 409; each loser re-sent with the refreshed If-Match is 422 stale", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "severity", op: "eq", value: "high" },
    ]);
    const shown = await read(id);
    const drafts = Array.from({ length: 8 }, (_, i) => [shown.content.conditions[0], { field: "severity", op: "eq", value: `s${i}` }]);
    const res = await Promise.all(drafts.map((d, i) => patch(id, shown, d, i % 2 ? admin2.session : admin.session)));
    const st = res.map((r) => r.status);
    console.log(`QA-R11 P20 statuses ${JSON.stringify(st)}`);
    expect(st.filter((s) => s === 200).length).toBe(1);
    expect(st.filter((s) => s === 409).length).toBe(7);
    const now = await storedOf(id);
    expect(now[0].value).toBe(H.x);
    const cur = await read(id);
    for (let i = 0; i < 8; i++) {
      if (st[i] !== 409) continue;
      const r = await patchV(id, cur.version, shown, drafts[i]!, i % 2 ? admin2.session : admin.session);
      expect(r.status).toBe(422);
      expect(r.body?.code).toBe("automation_rule.restricted_token_stale");
    }
    expect(await storedOf(id)).toEqual(now);
    expect(JSON.stringify(now).split(H.x).length - 1).toBe(1);
  });
  it("P21 tags do not depend on the reader: a second restricted reader's token for the same row and version resolves to the row's own literal", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const a = await read(id, admin.session);
    const b = await read(id, admin2.session);
    expect(b.content.conditions).toEqual(a.content.conditions);
    ok(await patch(id, a, [b.content.conditions[1], a.content.conditions[0]]));
    expect((await storedOf(id)).map((x: Body) => x.value)).toEqual([H.y, H.x]);
  });
});
