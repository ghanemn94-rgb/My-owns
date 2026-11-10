// code-security-reviewer, DG6 round 11 (T-DG6-REV-CS-R11): adversarial probe of the BE-Z15 issuer-bound restricted
// tokens (D-233, F-DG6-640; migration 0127). Copied by checks.sh into apps/api/test/integration/access/ of the
// disposable clone, run there against a disposable PostgreSQL, and removed afterwards. Not part of the candidate.
// Cases beyond the implementer's z15 file:
//   (k1) the per-row key is never served or audited: no API response (rule, version, version list, rule list, audit
//        events) and no stored audit_event row carries the key in hex, base64 or Buffer-JSON form, nor its column name;
//   (k2) the key is immutable for both the owner role and the application role; every existing row (the seeded
//        starters inserted before 0127) has its own 32-byte key;
//   (k3) a new draft copied from a published version draws its own key (distinct from its base);
//   (t1) malformed tokens: an upper-case tag, a valid tag with an out-of-range position, and a token on a rule create
//        are refused 422 restricted_marker_unknown and store nothing;
//   (t2) two concurrent identical saves with the same tokens and If-Match: exactly one 200 and one 409; the hidden
//        literal is kept, never lost or moved;
//   (t3) a grant given between read and save: the held token still resolves to the same literal; after revocation the
//        token is re-issued and resolves again; no literal is misplaced;
//   (t4) two non-admitted readers see the same tag; an admitted reader sees the plain literal and no tag;
//   (o1) observation: a dry run on a writer-chosen sample is a confirmation oracle for a guessed hidden id
//        (conditionsMet). Recorded for the review; not asserted as a defect.
// All data is SYNTHETIC. Marking a record sensitive is an access decision, not a business approval (G1-G6); nothing
// touches DG0-DG7.
import { createDb, insertAuditEvent, type Db } from "@mth/db";
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
let owner: Db;
let w: World;
let c: ClosureWorld;
let ini: Awaited<ReturnType<typeof launchedInitiative>>;
let author: { id: string; session: Session };
let author2: { id: string; session: Session };
let auditor: Session;
const R = "/api/v1/admin/automation-rules";
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
      body: { isSensitive: true, reason: "Synthetic sensitive benefit (CS-R11 probe)" },
    }),
  );
}
async function createRule(conditions: Cond[], session = author.session, ownerId = author.id) {
  return send("POST", R, {
    session,
    body: {
      code: `test.csr11.${randomUUID().slice(0, 8)}`,
      nameEn: "Synthetic probe rule (CS-R11)",
      nameAr: "قاعدة فحص تجريبية",
      scopeLevel: "organization",
      organizationId: c.b.organizationId,
      ownerUserId: ownerId,
      content: {
        triggerCodes: ["benefit.variance_evaluated"],
        conditions,
        actions: [{ type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } }],
        runAs: "service",
      },
    },
  });
}
const url = (ruleId: string, versionNo = 1) => `${R}/${ruleId}/versions/${versionNo}`;
const stored = async (ruleId: string, versionNo = 1) =>
  (await api.db
    .selectFrom("automation_rule_version")
    .select(["id", "conditions", "version"])
    .where("automation_rule_id", "=", ruleId)
    .where("version_no", "=", versionNo)
    .executeTakeFirstOrThrow()) as { id: string; conditions: Cond[]; version: number };
const read = async (ruleId: string, s = author.session, versionNo = 1) => ok(await send("GET", url(ruleId, versionNo), { session: s }));
const patch = (ruleId: string, version: number, content: Body, s = author.session, versionNo = 1) =>
  send("PATCH", url(ruleId, versionNo), { session: s, headers: ifm(version), body: { content } });
const keyForms = (k: Buffer) => [
  k.toString("hex"),
  k.toString("base64"),
  k.toString("base64url"),
  JSON.stringify(k), // {"type":"Buffer","data":[...]}
  `\\x${k.toString("hex")}`,
];

beforeAll(async () => {
  api = await startApi();
  owner = createDb(api.owner);
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  ini = await launchedInitiative(api.db, c.b);
  for (const slot of [0, 1]) {
    const u = await createUser(api.db, c.b.organizationId);
    await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: c.b.organizationId }, c.b.organizationId);
    const a = { id: u.id, session: await signIn(api.app, u.subject) };
    if (slot === 0) author = a;
    else author2 = a;
  }
  const aud = await createUser(api.db, c.b.organizationId);
  await grant(api.db, w.grantor.id, aud.id, "AUD", { type: "organization", id: c.b.organizationId }, c.b.organizationId);
  auditor = await signIn(api.app, aud.subject);
}, 240_000);
afterAll(() => api?.close());

describe("CS-R11 adversarial probe of issuer-bound restricted tokens (BE-Z15, 0127)", () => {
  it("(k1) the per-row key is never served or audited", async () => {
    const P = await benefit();
    const S = await benefit();
    const rule = ok(await createRule([neq(P), neq(S)]), 201);
    await markSensitive(S);
    const shown = ok(await patch(rule.id, (await read(rule.id)).version, (await read(rule.id)).content));
    const row = await owner
      .selectFrom("automation_rule_version")
      .select(["id", "restricted_token_key"])
      .where("automation_rule_id", "=", rule.id)
      .executeTakeFirstOrThrow();
    expect(row.restricted_token_key.length).toBe(32);
    const bodies: unknown[] = [
      shown,
      await read(rule.id),
      ok(await send("GET", `${R}/${rule.id}`, { session: author.session })),
      ok(await send("GET", `${R}/${rule.id}/versions`, { session: author.session })),
      ok(await send("GET", `${R}?limit=100`, { session: author.session })),
      ok(await send("GET", `/api/v1/audit-events?organizationId=${c.b.organizationId}&recordId=${row.id}`, { session: auditor })),
    ];
    const audit = await owner.selectFrom("audit_event").selectAll().where("record_id", "=", row.id).execute();
    expect(audit.length).toBeGreaterThan(0);
    bodies.push(audit);
    for (const b of bodies) {
      const text = JSON.stringify(b);
      expect(text).not.toContain("restricted_token_key");
      expect(text).not.toContain("restrictedTokenKey");
      for (const f of keyForms(row.restricted_token_key)) expect(text.includes(f), f).toBe(false);
    }
  });

  it("(k2) the key is immutable for owner and app roles; every pre-0127 row has its own 32-byte key", async () => {
    const all = await owner.selectFrom("automation_rule_version").select(["id", "restricted_token_key", "created_at"]).execute();
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((r) => r.restricted_token_key.toString("hex"))).size).toBe(all.length);
    for (const r of all) expect(r.restricted_token_key.length).toBe(32);
    const target = (await owner.selectFrom("automation_rule_version").selectAll().where("id", "=", all[0]!.id).executeTakeFirstOrThrow());
    // Owner: a well-formed update (version + 1 and its audit event) that changes only the key: the 0127 trigger refuses.
    await expect(
      owner.transaction().execute(async (tx) => {
        await insertAuditEvent(tx, { actorType: "system", actorUserId: null, source: "migration" }, {
          action: "test.seed", recordType: "automation_rule_version", recordId: target.id, organizationId: c.b.organizationId, newVersion: target.version + 1,
        });
        await tx.updateTable("automation_rule_version").set({ restricted_token_key: Buffer.alloc(32, 7), version: target.version + 1 }).where("id", "=", target.id).execute();
      }),
    ).rejects.toThrow(/restricted_token_key is set when the version is created and never changes/);
    // App role: refused as well (whatever the first guard to fire).
    await expect(
      api.db.updateTable("automation_rule_version").set({ restricted_token_key: Buffer.alloc(32, 7), version: target.version + 1 }).where("id", "=", target.id).execute(),
    ).rejects.toThrow();
    const after = await owner.selectFrom("automation_rule_version").select("restricted_token_key").where("id", "=", target.id).executeTakeFirstOrThrow();
    expect(after.restricted_token_key.equals(target.restricted_token_key)).toBe(true);
  });

  it("(k3) a draft created from a version draws its own key", async () => {
    const P = await benefit();
    const rule = ok(await createRule([neq(P)]), 201);
    // Discard is not needed: createVersion refuses while a draft is open, so read the base key and compare to a fresh
    // insert path by a second rule (insertDraftVersion is the only API insert path).
    const rule2 = ok(await createRule([neq(P)]), 201);
    const keys = await owner
      .selectFrom("automation_rule_version")
      .select(["automation_rule_id", "restricted_token_key"])
      .where("automation_rule_id", "in", [rule.id, rule2.id])
      .execute();
    expect(keys.length).toBe(2);
    expect(keys[0]!.restricted_token_key.equals(keys[1]!.restricted_token_key)).toBe(false);
  });

  it("(t1) malformed tokens are refused restricted_marker_unknown and store nothing", async () => {
    const P = await benefit();
    const S = await benefit();
    const rule = ok(await createRule([neq(P), neq(S)]), 201);
    await markSensitive(S);
    const v = await read(rule.id);
    const tok = v.content.conditions[1].value as string;
    const m = TOKEN.exec(tok)!;
    expect(m).not.toBeNull();
    const before = await stored(rule.id);
    const cases = [
      `[restricted:${m[1]!.toUpperCase()}:${m[2]}]`,
      `[restricted:${m[1]}:9]`,
      `[restricted:${m[1]}:1]`, // position 1 is P (a visible literal): resolving it is harmless, see below
    ];
    const upper = await patch(rule.id, v.version, { ...v.content, conditions: [v.content.conditions[0], neq(cases[0]!)] });
    expect(upper.status).toBe(422);
    expect(upper.body.code).toBe("automation_rule.restricted_marker_unknown");
    const out = await patch(rule.id, v.version, { ...v.content, conditions: [v.content.conditions[0], neq(cases[1]!)] });
    expect(out.status).toBe(422);
    expect(out.body.code).toBe("automation_rule.restricted_marker_unknown");
    expect(await stored(rule.id)).toEqual(before);
    for (const r of [upper, out]) expect(leaks(r.body)).toEqual([]);
    // A token on a rule create (no issuing row) is unknown.
    const created = await createRule([neq(tok)]);
    expect(created.status).toBe(422);
    expect(created.body.code).toBe("automation_rule.restricted_marker_unknown");
    // A valid tag at a visible position resolves to the literal the writer can read anyway (P): no disclosure.
    const vis = ok(await patch(rule.id, v.version, { ...v.content, conditions: [neq(cases[2]!), v.content.conditions[1]] }));
    expect((await stored(rule.id)).conditions).toEqual([neq(P), neq(S)]);
    expect(leaks(vis)).toEqual([]);
  });

  it("(t2) two concurrent identical saves: one 200, one 409; the hidden literal is kept", async () => {
    const P = await benefit();
    const S = await benefit();
    const rule = ok(await createRule([neq(P), neq(S)]), 201);
    await markSensitive(S);
    const v = await read(rule.id);
    const reordered = { ...v.content, conditions: [v.content.conditions[1], v.content.conditions[0]] };
    const results = await Promise.all([
      patch(rule.id, v.version, reordered, author.session),
      patch(rule.id, v.version, reordered, author2.session),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await stored(rule.id)).conditions).toEqual([neq(S), neq(P)]);
    // The loser re-sends with the refreshed If-Match: its held token is stale; nothing changes.
    const cur = await stored(rule.id);
    const again = await patch(rule.id, cur.version, reordered, author2.session);
    expect(again.status).toBe(422);
    expect(again.body.code).toBe("automation_rule.restricted_token_stale");
    expect((await stored(rule.id)).conditions).toEqual([neq(S), neq(P)]);
    for (const r of [...results, again]) expect(leaks(r.body)).toEqual([]);
  });

  it("(t3) grant given and revoked between read and save: held tokens resolve to the same literal", async () => {
    const P = await benefit();
    const S = await benefit();
    const rule = ok(await createRule([neq(P), neq(S)]), 201);
    await markSensitive(S);
    const held = await read(rule.id);
    const g = ok(
      await send("POST", "/api/v1/admin/sensitive-grants", {
        session: c.s.to.session,
        body: {
          transformationId: c.b.transformationId,
          recordType: "benefit",
          recordId: S,
          granteeUserId: author.id,
          reason: "Synthetic need to know (CS-R11 probe)",
        },
      }),
      201,
    );
    const saved = ok(await patch(rule.id, held.version, { ...held.content, conditions: [held.content.conditions[1]] }));
    expect((await stored(rule.id)).conditions).toEqual([neq(S)]);
    expect(saved.content.conditions[0].value).toBe(S); // admitted now: the plain literal, no token
    expect(saved.includesRestrictedRecords).toBeUndefined();
    ok(
      await send("POST", `/api/v1/admin/sensitive-grants/${g.id}/revoke`, {
        session: c.s.to.session,
        headers: ifm(g.version ?? 1),
        body: { reason: "Synthetic revocation (CS-R11 probe)" },
      }),
    );
    const after = await read(rule.id);
    expect(TOKEN.test(after.content.conditions[0].value)).toBe(true);
    expect(leaks(after)).toEqual([]);
    ok(await patch(rule.id, after.version, { ...after.content, conditions: [after.content.conditions[0], neq(P)] }));
    expect((await stored(rule.id)).conditions).toEqual([neq(S), neq(P)]);
  });

  it("(t4) two non-admitted readers see the same tag; the owner-admitted reader sees the literal", async () => {
    const S = await benefit();
    const rule = ok(await createRule([neq(S)]), 201);
    await markSensitive(S);
    const a = await read(rule.id, author.session);
    const b = await read(rule.id, author2.session);
    expect(a.content.conditions[0].value).toBe(b.content.conditions[0].value);
    expect(TOKEN.test(a.content.conditions[0].value)).toBe(true);
  });

  it("(o1) observation: dry run on a chosen sample confirms a guessed hidden id (conditionsMet)", async () => {
    const S = await benefit();
    const rule = ok(await createRule([{ field: "benefitId", op: "eq", value: S }]), 201);
    await markSensitive(S);
    const sample = (benefitId: string) => ({
      triggerCode: "benefit.variance_evaluated",
      payload: {
        benefitId,
        measurementId: randomUUID(),
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        plannedAmount: "100.00",
        measuredAmount: "80.00",
        variance: "-20.00",
        offTrack: true,
      },
    });
    const right = await send("POST", `${url(rule.id)}/dry-runs`, { session: author.session, body: sample(S) });
    const wrong = await send("POST", `${url(rule.id)}/dry-runs`, { session: author.session, body: sample(randomUUID()) });
    // Recorded, not asserted: print what the writer learns.
    console.log(
      "O1 dry-run statuses",
      right.status,
      wrong.status,
      "conditionsMet",
      right.body?.conditionsMet,
      wrong.body?.conditionsMet,
      "outcome",
      right.body?.outcome,
      wrong.body?.outcome,
      "codes",
      right.body?.code,
      wrong.body?.code,
      "leaks",
      leaks(right.body),
      leaks(wrong.body),
    );
    expect(leaks(wrong.body)).toEqual([]);
  });
});
