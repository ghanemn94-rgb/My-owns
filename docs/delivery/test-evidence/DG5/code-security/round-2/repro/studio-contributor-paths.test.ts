// code-security-reviewer DG5 round 2 probe (NOT product code; run only in a disposable clone, copied to
// apps/api/test/integration/methodology/zz-sec-r2-contributor-paths.test.ts). Synthetic data only.
//
// F-DG5-100 re-verification, adversarially, beyond the product's own regression tests: every write path to a Studio
// draft must record its writer as a contributor (0097), and a contributor's review decision must be 403
// config_review.self_review even when (a) their only write was an element REMOVE, (b) their write was later fully
// overwritten by the creator, (c) their only write was a change-summary-only PATCH, (d) their write went through the
// scoring-defaults kind writer (PUT /scoring-defaults), (e) their write was a procedure definition REMOVE.
// At the database, under the runtime role mth_app: the contributor guard cannot be switched off (DISABLE TRIGGER,
// session_replication_role), and a contributor decision INSERTed (not UPDATEd) is refused too.
import { sql, type Tx } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { seedProceduresVersion, syntheticDefinitionBody } from "../../support/procedures-fixtures.ts";
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";

let api: TestApi;
let w: World;
let creator: Session;
let creatorId: string;
let coAuthor: Session;
let coAuthorId: string;
let independent: Session;
let independentId: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const a = await methodologyAdmin(api.db, w);
  creatorId = a.id;
  creator = await signIn(api.app, a.subject);
  const org = { type: "organization" as const, id: w.orgA.id };
  const c = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, c.id, "ADM_METHOD", org, w.orgA.id);
  await grant(api.db, w.grantor.id, c.id, "TO", org, w.orgA.id);
  coAuthorId = c.id;
  coAuthor = await signIn(api.app, c.subject);
  const t = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, t.id, "TO", org, w.orgA.id);
  independentId = t.id;
  independent = await signIn(api.app, t.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const versionOf = async (id: string): Promise<number> =>
  (await call<Body>(api.app, "GET", `${V}/${id}`, { session: creator })).body.version;
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code];
const contributorsOf = async (id: string): Promise<string[]> =>
  (
    await api.db
      .selectFrom("methodology_version_contributor")
      .select("user_id")
      .where("methodology_version_id", "=", id)
      .orderBy("user_id")
      .execute()
  ).map((r) => r.user_id);
const WEIGHTS: [string, string][] = [
  ["strategic_fit", "25"],
  ["financial_value", "25"],
  ["feasibility", "20"],
  ["customer_impact", "15"],
  ["time_to_value", "15"],
];
async function scoringDraft(): Promise<string> {
  const base = await seedStudioBase(
    api,
    "scoring_defaults",
    WEIGHTS.map(([k, p]) => ({ elementType: "scoring_weight", stableKey: k, attributes: { weightPercent: p } })),
  );
  const created = await call<Body>(api.app, "POST", V, { session: creator, body: { basedOnVersionId: base.id } });
  expect(created.status).toBe(201);
  return created.body.id as string;
}
const put = async (id: string, who: Session, key: string, pct: string) =>
  call<Body>(api.app, "PUT", `${V}/${id}/elements/scoring_weight/${key}`, {
    session: who,
    headers: ifm(await versionOf(id)),
    body: { attributes: { weightPercent: pct } },
  });
async function submit(id: string): Promise<string> {
  const pv = await call<Body>(api.app, "POST", `${V}/${id}/preview`, {
    session: creator,
    headers: ifm(await versionOf(id)),
    body: { samples: [] },
  });
  expect([pv.status, pv.body?.result]).toEqual([201, "pass"]);
  const cc = await call<Body>(api.app, "POST", `${V}/${id}/compatibility-checks`, {
    session: creator,
    headers: ifm(await versionOf(id)),
  });
  expect(cc.status).toBe(201);
  const sub = await call<Body>(api.app, "POST", `${V}/${id}/submit-review`, {
    session: creator,
    headers: ifm(await versionOf(id)),
    body: {},
  });
  expect(sub.status).toBe(201);
  return sub.body.id as string;
}
const decide = (id: string, reviewId: string, who: Session, outcome = "approve", note?: string) =>
  call<Body>(api.app, "POST", `${V}/${id}/reviews/${reviewId}/decision`, {
    session: who,
    headers: ifm(1),
    body: note === undefined ? { outcome } : { outcome, note },
  });

describe("SEC-R2 probe: every write path records its writer; a contributor never decides", () => {
  it("(a)+(b) an element REMOVE, later fully undone by the creator, still makes the remover an author", async () => {
    const id = await scoringDraft();
    const rm = await call<Body>(api.app, "POST", `${V}/${id}/elements/scoring_weight/time_to_value/remove`, {
      session: coAuthor,
      headers: ifm(await versionOf(id)),
      body: {},
    });
    console.log("co-author element remove", rm.status, rm.body?.code ?? "");
    expect(rm.status).toBe(200);
    expect(await contributorsOf(id)).toEqual([creatorId, coAuthorId].sort());
    // The creator restores exactly the original content: nothing of the co-author's write survives in any row.
    expect((await put(id, creator, "time_to_value", "15")).status).toBe(200);
    const row = await api.db
      .selectFrom("methodology_element")
      .select(["updated_by", "removed"])
      .where("methodology_version_id", "=", id)
      .where("stable_key", "=", "time_to_value")
      .executeTakeFirstOrThrow();
    const ver = await api.db
      .selectFrom("methodology_version")
      .select("updated_by")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    console.log("after restore: element updated_by=creator", row.updated_by === creatorId, "removed", row.removed,
      "version updated_by=creator", ver.updated_by === creatorId);
    const reviewId = await submit(id);
    const d = await decide(id, reviewId, coAuthor);
    console.log("remover decision", d.status, d.body?.code);
    expect(codeOf(d)).toEqual([403, "config_review.self_review"]);
    // A non-contributor TO approves and the creator publishes.
    const ok = await decide(id, reviewId, independent);
    expect([ok.status, ok.body?.status]).toEqual([200, "approved"]);
    const pub = await call<Body>(api.app, "POST", `${V}/${id}/publish`, {
      session: creator,
      headers: ifm(await versionOf(id)),
    });
    console.log("independent approve", ok.status, "publish", pub.status, pub.body?.status);
    expect([pub.status, pub.body?.status]).toEqual([200, "published"]);
  });

  it("(c) a change-summary-only PATCH makes its writer an author", async () => {
    const id = await scoringDraft();
    const p = await call<Body>(api.app, "PATCH", `${V}/${id}`, {
      session: coAuthor,
      headers: ifm(await versionOf(id)),
      body: { changeSummary: "only the summary, written by the co-author" },
    });
    expect(p.status).toBe(200);
    expect(await contributorsOf(id)).toEqual([creatorId, coAuthorId].sort());
    const reviewId = await submit(id);
    const d = await decide(id, reviewId, coAuthor, "request_changes", "A co-author cannot send it back.");
    console.log("summary-only PATCH writer decision", d.status, d.body?.code);
    expect(codeOf(d)).toEqual([403, "config_review.self_review"]);
  });

  it("(d) the scoring-defaults kind writer (PUT /scoring-defaults) records its writer", async () => {
    const id = await scoringDraft();
    const res = await call<Body>(api.app, "PUT", `${V}/${id}/scoring-defaults`, {
      session: coAuthor,
      headers: ifm(await versionOf(id)),
      body: {
        weights: [
          { criterionCode: "strategic_fit", weightPercent: "20" },
          { criterionCode: "financial_value", weightPercent: "30" },
          { criterionCode: "feasibility", weightPercent: "20" },
          { criterionCode: "customer_impact", weightPercent: "15" },
          { criterionCode: "time_to_value", weightPercent: "15" },
        ],
        rubrics: [],
      },
    });
    console.log("co-author PUT scoring-defaults", res.status, res.body?.code ?? "");
    expect(res.status).toBe(200);
    expect(await contributorsOf(id)).toEqual([creatorId, coAuthorId].sort());
    const reviewId = await submit(id);
    const d = await decide(id, reviewId, coAuthor);
    console.log("scoring-defaults writer decision", d.status, d.body?.code);
    expect(codeOf(d)).toEqual([403, "config_review.self_review"]);
  });

  it("(e) a procedure definition REMOVE by a second admin records them", async () => {
    const base = await seedProceduresVersion(api);
    const res = await call<Body>(api.app, "POST", V, { session: creator, body: { basedOnVersionId: base.id } });
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const p = await call<Body>(api.app, "PUT", `/api/v1/admin/procedure-definitions/${id}/vendor_onboarding`, {
      session: creator,
      headers: ifm(await versionOf(id)),
      body: syntheticDefinitionBody(),
    });
    expect(p.status).toBe(200);
    expect(await contributorsOf(id)).toEqual([creatorId]);
    const rm = await call<Body>(api.app, "POST", `/api/v1/admin/procedure-definitions/${id}/vendor_onboarding/remove`, {
      session: coAuthor,
      headers: ifm(await versionOf(id)),
      body: {},
    });
    console.log("co-author procedure remove", rm.status, rm.body?.code ?? "");
    expect(rm.status).toBe(200);
    expect(await contributorsOf(id)).toEqual([creatorId, coAuthorId].sort());
  });
});

describe("SEC-R2 probe: the database backstop cannot be bypassed by the runtime role", () => {
  const ROLLBACK = new Error("rollback");
  async function inRolledBack(fn: (tx: Tx) => Promise<void>): Promise<string> {
    let outcome = "ok";
    await api.db
      .transaction()
      .execute(async (tx) => {
        try {
          await fn(tx);
        } catch (err) {
          const e = err as { constraint?: string; message?: string };
          outcome = e.constraint ?? e.message ?? String(err);
        }
        throw ROLLBACK;
      })
      .catch((e: unknown) => {
        if (e !== ROLLBACK) throw e;
      });
    return outcome;
  }

  it("runs as mth_app; DISABLE TRIGGER and session_replication_role are refused; a contributor decision is refused", async () => {
    const who = await sql<{ u: string }>`SELECT current_user AS u`.execute(api.db);
    console.log("runtime role", who.rows[0]!.u);
    expect(who.rows[0]!.u).toBe("mth_app");
    const id = await scoringDraft();
    expect((await put(id, coAuthor, "feasibility", "30")).status).toBe(200);
    expect((await put(id, coAuthor, "strategic_fit", "15")).status).toBe(200);
    const reviewId = await submit(id);
    const dis = await inRolledBack(async (tx) => {
      await sql`ALTER TABLE config_review_request DISABLE TRIGGER config_review_request_sod_contributor`.execute(tx);
    });
    const rep = await inRolledBack(async (tx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(tx);
    });
    const del = await inRolledBack(async (tx) => {
      await sql`DELETE FROM methodology_version_contributor WHERE user_id = ${coAuthorId}::uuid`.execute(tx);
    });
    const direct = await inRolledBack(async (tx) => {
      await sql`UPDATE config_review_request SET status = 'approved', decided_by = ${coAuthorId}::uuid,
                decided_at = now(), version = version + 1, updated_at = now(), updated_by = ${coAuthorId}::uuid
                WHERE id = ${reviewId}::uuid`.execute(tx);
    });
    console.log("DISABLE TRIGGER:", dis);
    console.log("session_replication_role:", rep);
    console.log("DELETE contributor:", del);
    console.log("direct decision by contributor:", direct);
    expect(dis).toMatch(/must be owner|permission denied/);
    expect(rep).toMatch(/permission denied/);
    expect(del).toMatch(/append-only|permission denied/);
    expect(direct).toBe("config_review_request_reviewer_not_contributor");
    // The API decision is refused and nothing moved.
    expect(codeOf(await decide(id, reviewId, coAuthor))).toEqual([403, "config_review.self_review"]);
    const rr = await api.db
      .selectFrom("config_review_request")
      .select(["status", "decided_by"])
      .where("id", "=", reviewId)
      .executeTakeFirstOrThrow();
    expect([rr.status, rr.decided_by]).toEqual(["pending", null]);
  });
});
