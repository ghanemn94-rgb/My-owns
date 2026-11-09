// code-security-reviewer, DG6 round 9 (T-DG6-REV-CS-R9); re-run in round 10 (T-DG6-REV-CS-R10) with the token
// literals moved to the version-bound form `[restricted:<version>:<k>]` (D-231); every behaviour assertion is unchanged. NOT part of the candidate: copied into a disposable clone's
// tests/qa/integration by checks.sh repro and removed afterwards. All data SYNTHETIC. Marking a record sensitive is an
// access decision, never a business approval (G1-G6); nothing here touches DG0-DG7.
//
// Question (D-226, D-228 (1); versions.ts resolveRestrictedTokens): a token (round 9: `[restricted:k]`) names position k of the
// stored version, but it carries no version identity. What happens when a client re-sends a token it was shown for an
// EARLIER revision of the same draft (with the current If-Match)? That is what the shipped editor does:
// RulePage.tsx EditContent keeps its local `draft` state (useState initializer, never re-initialized; QueryState keeps
// children mounted on refetch) while `ifMatch: v.version` follows the refreshed version, so a second save after a first
// save that shifted positions, or a re-save after a 409, sends the stale tokens.
//
// Cases (each on its own rule; the author is ADM_METHOD at organization scope, never admitted to the sensitive benefit):
//   T1  editor flow, two saves: [benefitId neq P, benefitId neq S, severity eq high]; save 1 removes condition 1 (as
//       F-DG6-541); save 2 re-sends the editor's unchanged local draft with the version returned by save 1.
//   T2  invisible misplacement among hidden literals: [neq P, neq S1, neq S2, severity eq high], same two saves.
//   T3  409 path: the author reads; the admitted TO removes condition 1 (version bump); the author's save is 409; the
//       author re-saves the same draft with the refreshed version (as the editor does after the 409 refresh).
//   T4  controls (expected safe): bare marker 422; unknown token 422; token moved into another condition and into an
//       `in` list keeps S; S marked visible again between read and save keeps S; P marked sensitive between read and
//       save (author re-sends P's plain id) keeps both; a token for a plain position resolves to that plain literal.
// Each case logs what is stored (ids replaced by <P>/<S>/<S1>/<S2>), then asserts the D-226 contract: the hidden
// literal(s) are kept where the author meant them, or the save is refused. T1-T3 are EXPECTED TO FAIL on a defect.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { call, createUser, grant, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../../apps/api/test/support/harness.ts";
import { ifm } from "../../../apps/api/test/support/p2-fixtures.ts";
import { launchedInitiative, pendingBenefit, seedClosureWorld, type ClosureWorld } from "../../../apps/api/test/integration/contract/p4-exercises-be-j.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let c: ClosureWorld;
let admin: { id: string; session: Session };
let ini: Awaited<ReturnType<typeof launchedInitiative>>;
const R = "/api/v1/admin/automation-rules";
const log = (...a: unknown[]) => console.log("[CS-R9-TOKEN]", ...a);
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, { contract: false, ...o });
const names = new Map<string, string>();
const anon = (x: unknown) => {
  let s = JSON.stringify(x);
  for (const [id, n] of names) s = s.replaceAll(id, n);
  return s;
};
const benefit = async (name: string) => {
  const id = (await pendingBenefit(api, c, ini)).id as string;
  names.set(id, name);
  return id;
};
const markSensitive = async (id: string, isSensitive: boolean) => {
  const cur = await send("GET", `${c.b.base}/records/benefit/${id}/sensitivity`, { session: c.s.to.session });
  const r = await send("PUT", `${c.b.base}/records/benefit/${id}/sensitivity`, {
    session: c.s.to.session,
    headers: ifm(cur.status === 200 ? (cur.body?.version ?? 0) : 0),
    body: { isSensitive, reason: "Synthetic sensitivity change (CS-R9-TOKEN)" },
  });
  log(`TO marks ${names.get(id)} isSensitive=${isSensitive} -> ${r.status}`);
  expect(r.status).toBe(200);
};
const createRule = async (conditions: Body[]) => {
  const r = await send("POST", R, {
    session: admin.session,
    body: {
      code: `test.csr9.${randomUUID().slice(0, 8)}`,
      nameEn: "Synthetic variance follow-up (CS-R9)",
      nameAr: "متابعة انحراف تجريبية",
      scopeLevel: "organization",
      organizationId: c.b.organizationId,
      ownerUserId: admin.id,
      content: {
        triggerCodes: ["benefit.variance_evaluated"],
        conditions,
        actions: [{ type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } }],
        runAs: "service",
      },
    },
  });
  expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(201);
  return r.body.id as string;
};
const stored = async (ruleId: string) =>
  (
    await api.db
      .selectFrom("automation_rule_version")
      .select(["conditions", "version"])
      .where("automation_rule_id", "=", ruleId)
      .where("version_no", "=", 1)
      .executeTakeFirstOrThrow()
  ) as { conditions: Body[]; version: number };
const getV = (ruleId: string, s: Session = admin.session) => send("GET", `${R}/${ruleId}/versions/1`, { session: s });
const patch = (ruleId: string, content: Body, version: number, s: Session = admin.session) =>
  send("PATCH", `${R}/${ruleId}/versions/1`, { session: s, headers: ifm(version), body: { content } });

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  ini = await launchedInitiative(api.db, c.b);
  const u = await createUser(api.db, c.b.organizationId);
  await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: c.b.organizationId }, c.b.organizationId);
  admin = { id: u.id, session: await signIn(api.app, u.subject) };
}, 240_000);
afterAll(() => api?.close());

describe("CS-R9-TOKEN: stale tokens", () => {
  it("T1 editor flow: a second save of the same local draft keeps S (or is refused)", async () => {
    const P = await benefit("<P>");
    const S = await benefit("<S>");
    const ruleId = await createRule([
      { field: "benefitId", op: "neq", value: P },
      { field: "benefitId", op: "neq", value: S },
      { field: "severity", op: "eq", value: "high" },
    ]);
    await markSensitive(S, true);
    const shown = await getV(ruleId);
    log(`T1 author GET -> ${shown.status} v${shown.body.version} conditions=${anon(shown.body.content.conditions)}`);
    expect(JSON.stringify(shown.body)).not.toContain(S);
    // The editor's local draft after "remove condition 1".
    const draft = { ...shown.body.content, conditions: shown.body.content.conditions.slice(1) };
    const s1 = await patch(ruleId, draft, shown.body.version);
    log(`T1 save 1 (remove condition 1) -> ${s1.status} v${s1.body.version} shown=${anon(s1.body.content?.conditions)} stored=${anon((await stored(ruleId)).conditions)}`);
    expect(s1.status).toBe(200);
    // The editor keeps `draft` and sends it again with the refreshed version (RulePage.tsx EditContent ifMatch: v.version).
    const s2 = await patch(ruleId, draft, s1.body.version);
    const after = await stored(ruleId);
    log(`T1 save 2 (same local draft, If-Match ${s1.body.version}) -> ${s2.status} ${s2.status === 200 ? `shown=${anon(s2.body.content.conditions)} marker=${s2.body.includesRestrictedRecords}` : anon(s2.body).slice(0, 300)}`);
    log(`T1 stored after save 2: ${anon(after.conditions)}; S kept: ${JSON.stringify(after.conditions).includes(S)}`);
    if (s2.status === 200) expect(after.conditions).toEqual([{ field: "benefitId", op: "neq", value: S }, { field: "severity", op: "eq", value: "high" }]);
    else expect(s2.status).toBeGreaterThanOrEqual(400);
  });

  it("T2 two hidden literals: the second save keeps S1 and S2 where they were (or is refused)", async () => {
    const P = await benefit("<P2>");
    const S1 = await benefit("<S1>");
    const S2 = await benefit("<S2>");
    const ruleId = await createRule([
      { field: "benefitId", op: "neq", value: P },
      { field: "benefitId", op: "neq", value: S1 },
      { field: "benefitId", op: "neq", value: S2 },
      { field: "severity", op: "eq", value: "high" },
    ]);
    await markSensitive(S1, true);
    await markSensitive(S2, true);
    const shown = await getV(ruleId);
    log(`T2 author GET -> v${shown.body.version} conditions=${anon(shown.body.content.conditions)}`);
    const draft = { ...shown.body.content, conditions: shown.body.content.conditions.slice(1) };
    const s1 = await patch(ruleId, draft, shown.body.version);
    log(`T2 save 1 -> ${s1.status} shown=${anon(s1.body.content?.conditions)} stored=${anon((await stored(ruleId)).conditions)}`);
    expect(s1.status).toBe(200);
    const s2 = await patch(ruleId, draft, s1.body.version);
    const after = await stored(ruleId);
    log(`T2 save 2 -> ${s2.status} ${s2.status === 200 ? `shown=${anon(s2.body.content.conditions)} marker=${s2.body.includesRestrictedRecords}` : anon(s2.body).slice(0, 300)}`);
    log(`T2 stored after save 2: ${anon(after.conditions)}`);
    if (s2.status === 200)
      expect(after.conditions).toEqual([
        { field: "benefitId", op: "neq", value: S1 },
        { field: "benefitId", op: "neq", value: S2 },
        { field: "severity", op: "eq", value: "high" },
      ]);
    else expect(s2.status).toBeGreaterThanOrEqual(400);
  });

  it("T3 409 path: re-saving the same draft after a concurrent edit keeps S (or is refused)", async () => {
    const P = await benefit("<P3>");
    const S = await benefit("<S3>");
    const ruleId = await createRule([
      { field: "benefitId", op: "neq", value: P },
      { field: "benefitId", op: "neq", value: S },
      { field: "severity", op: "eq", value: "high" },
    ]);
    await markSensitive(S, true);
    const shown = await getV(ruleId);
    log(`T3 author GET -> v${shown.body.version} conditions=${anon(shown.body.content.conditions)}`);
    // The admitted TO (sees S plain) removes condition 1 concurrently.
    const toV = await getV(ruleId, c.s.to.session);
    log(`T3 TO GET -> ${toV.status} conditions=${anon(toV.body.content?.conditions)}`);
    let current = shown.body.version as number;
    if (toV.status === 200) {
      const te = await patch(ruleId, { ...toV.body.content, conditions: toV.body.content.conditions.slice(1) }, toV.body.version, c.s.to.session);
      log(`T3 TO save (remove condition 1) -> ${te.status} ${te.status === 200 ? "" : anon(te.body).slice(0, 300)}`);
      if (te.status !== 200) {
        // TO may not configure this rule: the author does the concurrent edit from a second tab instead.
        const tab2 = await patch(ruleId, { ...shown.body.content, conditions: shown.body.content.conditions.slice(1) }, shown.body.version);
        log(`T3 second tab save (remove condition 1) -> ${tab2.status}`);
        expect(tab2.status).toBe(200);
      }
    } else {
      const tab2 = await patch(ruleId, { ...shown.body.content, conditions: shown.body.content.conditions.slice(1) }, shown.body.version);
      log(`T3 second tab save (remove condition 1) -> ${tab2.status}`);
      expect(tab2.status).toBe(200);
    }
    log(`T3 stored after the concurrent edit: ${anon((await stored(ruleId)).conditions)}`);
    // The author's tab: edits severity in its local draft (still the original three conditions) and saves.
    const draft = {
      ...shown.body.content,
      conditions: shown.body.content.conditions.map((x: Body, i: number) => (i === 2 ? { ...x, value: "medium" } : x)),
    };
    const a1 = await patch(ruleId, draft, current);
    log(`T3 author save with stale If-Match ${current} -> ${a1.status} ${anon(a1.body).slice(0, 200)}`);
    expect(a1.status).toBe(409);
    current = (await getV(ruleId)).body.version;
    const a2 = await patch(ruleId, draft, current);
    const after = await stored(ruleId);
    log(`T3 author re-save of the same draft (If-Match ${current}) -> ${a2.status} ${a2.status === 200 ? `shown=${anon(a2.body.content.conditions)}` : anon(a2.body).slice(0, 300)}`);
    log(`T3 stored after: ${anon(after.conditions)}; S kept: ${JSON.stringify(after.conditions).includes(S)}`);
    if (a2.status === 200) expect(JSON.stringify(after.conditions)).toContain(S);
    else expect(a2.status).toBeGreaterThanOrEqual(400);
  });

  it("T4 controls: refusals, moves, grant and sensitivity changes", async () => {
    const P = await benefit("<P4>");
    const S = await benefit("<S4>");
    const Q = await benefit("<Q4>");
    const ruleId = await createRule([
      { field: "benefitId", op: "neq", value: P },
      { field: "benefitId", op: "neq", value: S },
      { field: "severity", op: "eq", value: "high" },
    ]);
    await markSensitive(S, true);
    let v = await getV(ruleId);
    const tok = v.body.content.conditions[1].value as string;
    log(`T4 author GET -> conditions=${anon(v.body.content.conditions)} token=${tok}`);
    expect(tok).toBe(`[restricted:${v.body.version}:2]`);
    const base = v.body.content;
    const res: Record<string, string> = {};
    const tryC = async (label: string, conds: Body[] | ((ver: number) => Body[])) => {
      v = await getV(ruleId);
      const conditions = typeof conds === "function" ? conds(v.body.version) : conds;
      const r = await patch(ruleId, { ...base, conditions }, v.body.version);
      const s = await stored(ruleId);
      res[label] = `${r.status} ${r.status === 200 ? anon(s.conditions) : (r.body?.code ?? anon(r.body).slice(0, 120))}`;
      log(`T4 ${label} -> ${res[label]}`);
      return { r, s };
    };
    const bare = await tryC("bare marker", [{ field: "benefitId", op: "neq", value: "[restricted]" }]);
    expect(bare.r.status).toBe(422);
    const unk = await tryC("unknown token", (ver) => [{ field: "benefitId", op: "neq", value: `[restricted:${ver}:99]` }]);
    expect(unk.r.status).toBe(422);
    const spaced = await tryC("marker-like text", [{ field: "benefitId", op: "neq", value: " [ Restricted:2]" }]);
    expect(spaced.r.status).toBe(422);
    // The token moved into an `in` list after a new plain element, and to the last condition (reorder).
    const moved = await tryC("token moved into an in list", [
      { field: "severity", op: "eq", value: "high" },
      { field: "benefitId", op: "in", value: [Q, tok] },
    ]);
    expect(moved.r.status).toBe(200);
    expect(moved.s.conditions).toEqual([
      { field: "severity", op: "eq", value: "high" },
      { field: "benefitId", op: "in", value: [Q, S] },
    ]);
    // Re-read (positions changed): severity=1, Q=2, S=3; the new token must be [restricted:3].
    v = await getV(ruleId);
    log(`T4 after move, author GET -> ${anon(v.body.content.conditions)}`);
    expect(v.body.content.conditions[1].value).toEqual([Q, `[restricted:${v.body.version}:3]`]);
    // P marked sensitive between read and save: the author holds P's plain id? (P is no longer in the rule; use Q.)
    const held = v.body;
    await markSensitive(Q, true);
    const r2 = await patch(ruleId, held.content, held.version);
    const s2 = await stored(ruleId);
    log(`T4 Q marked sensitive between read and save; author re-sends [Q plain, [restricted:3]] -> ${r2.status} stored=${anon(s2.conditions)}`);
    expect(r2.status).toBe(200);
    expect(s2.conditions[1].value).toEqual([Q, S]);
    // S made visible between read and save: the token the author holds still reaches S.
    v = await getV(ruleId);
    log(`T4 author GET -> ${anon(v.body.content.conditions)}`);
    const held2 = v.body;
    await markSensitive(S, false);
    const r3 = await patch(ruleId, held2.content, held2.version);
    const s3 = await stored(ruleId);
    log(`T4 S unmarked between read and save; author re-sends its tokens -> ${r3.status} stored=${anon(s3.conditions)}`);
    expect(r3.status).toBe(200);
    expect(s3.conditions[1].value).toEqual([Q, S]);
    // A token for a plain position resolves to that plain literal (discloses nothing the author does not see).
    const plain = await tryC("token for a plain position", (ver) => [{ field: "severity", op: "eq", value: `[restricted:${ver}:1]` }]);
    expect(plain.r.status).toBe(200);
    expect(plain.s.conditions).toEqual([{ field: "severity", op: "eq", value: "high" }]);
    log(`T4 summary ${JSON.stringify(res)}`);
  });
});
