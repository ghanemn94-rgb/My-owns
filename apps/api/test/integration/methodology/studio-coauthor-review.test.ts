// F-DG5-100 regression (D-170; REQ-S06-007 "Review where configured"; ADR-0039 §5, §9; migration 0097; T-DG5-BE-V1):
// a person who wrote any part of a configuration draft is one of its authors, and an author never decides its review.
//
// The first test is the code-security reviewer's DG5 round-1 reproduction
// (docs/delivery/test-evidence/DG5/code-security/round-1/repro/studio-coauthor-review.test.ts), kept with its final
// assertion: a second methodology admin who also holds the configured reviewer role (TO) rewrites another admin's
// draft, the creator submits it, and the co-author's decision must be 403 config_review.self_review. The other tests:
//  - publishing that draft is then impossible (the review was refused, so no approved review exists for the content);
//  - the creator and requester refusals still hold;
//  - a TO who wrote nothing approves and publishes; a TO who only decided an earlier round (request changes) did not
//    become an author by deciding and decides the next round;
//  - the contributor record is append-only and is written in the writer's transaction (PATCH, element PUT);
//  - the database refuses a decision by a contributor through the runtime role (mth_app), under the named constraint
//    config_review_request_reviewer_not_contributor, which db-errors.ts maps to the same 403.
//  - the 0097 backfill, re-applied to the pre-0097 schema of this file's scratch database, records the creator and
//    every audited writer of an open draft, with one migration audit event.
// Synthetic data only; a configuration review approves nothing in the business and never touches DG0-DG7.
import { readFileSync } from "node:fs";
import { insertAuditEvent, migrate, sql, type Tx } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
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

let scratchDb: string;
let api: TestApi;
let w: World;
let creator: Session;
let creatorId: string;
let coAuthor: Session;
let coAuthorId: string;
let requester: Session;
let requesterId: string;
let independent: Session;
let independentId: string;
beforeAll(async () => {
  // A scratch database of the run's cluster: the backfill test below re-applies 0097 (DDL) and must not lock the
  // shared per-run database that other integration files use at the same time.
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_coauthor");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  const a = await methodologyAdmin(api.db, w);
  creatorId = a.id;
  creator = await signIn(api.app, a.subject);
  const org = { type: "organization" as const, id: w.orgA.id };
  // The co-author: ADM_METHOD and TO, both at organization scope (no rule forbids holding both).
  const c = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, c.id, "ADM_METHOD", org, w.orgA.id);
  await grant(api.db, w.grantor.id, c.id, "TO", org, w.orgA.id);
  coAuthorId = c.id;
  coAuthor = await signIn(api.app, c.subject);
  // A requester who writes nothing: ADM_METHOD (submits) and TO.
  const r = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, r.id, "ADM_METHOD", org, w.orgA.id);
  await grant(api.db, w.grantor.id, r.id, "TO", org, w.orgA.id);
  requesterId = r.id;
  requester = await signIn(api.app, r.subject);
  // An independent reviewer: TO only.
  const t = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, t.id, "TO", org, w.orgA.id);
  independentId = t.id;
  independent = await signIn(api.app, t.subject);
  // The creator also holds TO, so the creator refusal is about authorship, not the missing role.
  await grant(api.db, w.grantor.id, creatorId, "TO", org, w.orgA.id);
  creator = await signIn(api.app, a.subject);
}, 60_000);
afterAll(async () => {
  await api.close();
  await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

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

const WEIGHTS = [
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
    WEIGHTS.map(([k, p]) => ({ elementType: "scoring_weight", stableKey: k!, attributes: { weightPercent: p } })),
  );
  const created = await call<Body>(api.app, "POST", V, { session: creator, body: { basedOnVersionId: base.id } });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

/** Two weights moved (still 100 %) by `who`, and the title by `who` when `patch`. */
async function rewrite(id: string, who: Session, patch = true): Promise<void> {
  const w1 = await call<Body>(api.app, "PUT", `${V}/${id}/elements/scoring_weight/feasibility`, {
    session: who,
    headers: ifm(await versionOf(id)),
    body: { attributes: { weightPercent: "30" } },
  });
  const w2 = await call<Body>(api.app, "PUT", `${V}/${id}/elements/scoring_weight/strategic_fit`, {
    session: who,
    headers: ifm(await versionOf(id)),
    body: { attributes: { weightPercent: "15" } },
  });
  expect([w1.status, w2.status]).toEqual([200, 200]);
  if (patch) {
    const edit = await call<Body>(api.app, "PATCH", `${V}/${id}`, {
      session: who,
      headers: ifm(await versionOf(id)),
      body: { titleEn: "Rewritten defaults", changeSummary: "content written by a second admin" },
    });
    expect(edit.status).toBe(200);
  }
}

async function submit(id: string, who: Session = creator): Promise<string> {
  const pv = await call<Body>(api.app, "POST", `${V}/${id}/preview`, {
    session: who,
    headers: ifm(await versionOf(id)),
    body: { samples: [] },
  });
  expect([pv.status, pv.body?.result]).toEqual([201, "pass"]);
  const cc = await call<Body>(api.app, "POST", `${V}/${id}/compatibility-checks`, {
    session: who,
    headers: ifm(await versionOf(id)),
  });
  expect(cc.status).toBe(201);
  const sub = await call<Body>(api.app, "POST", `${V}/${id}/submit-review`, {
    session: who,
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
const publish = async (id: string, who: Session) =>
  call<Body>(api.app, "POST", `${V}/${id}/publish`, { session: who, headers: ifm(await versionOf(id)) });

describe("F-DG5-100: a co-author never decides the configured review of the content they wrote", () => {
  it("the co-author's approval of their own content should be 403 config_review.self_review", async () => {
    // The reviewer's reproduction, unchanged in substance (round-1 repro, steps 1-5).
    const id = await scoringDraft();
    await rewrite(id, coAuthor);
    const reviewId = await submit(id);
    const d = await decide(id, reviewId, coAuthor);
    const pub = await publish(id, coAuthor);
    console.log(
      "co-author review decision",
      d.status,
      d.body?.code ?? d.body?.status,
      "publish",
      pub.status,
      pub.body?.code,
    );
    // The SoD rule ("never the author") expects 403 config_review.self_review at the decision.
    expect([d.status, d.body?.code]).toEqual([403, "config_review.self_review"]);
    expect(d.body.detail).toBe("You cannot review a configuration change you authored or requested.");
    // Publish is impossible by construction: the review was refused, so no approved review exists for the content.
    expect(codeOf(pub)).toEqual([422, "config_version.review_required"]);
    const after = await call<Body>(api.app, "GET", `${V}/${id}`, { session: creator });
    expect([after.body.status, after.body.draftStage]).toEqual(["draft", "review"]);
    // The co-author got no review task for it.
    const tasks = await api.db
      .selectFrom("work_item")
      .select("assignee_user_id")
      .where("subject_id", "=", reviewId)
      .execute();
    expect(tasks.map((t) => t.assignee_user_id)).not.toContain(coAuthorId);
    expect(tasks.map((t) => t.assignee_user_id)).not.toContain(creatorId);
    // ...and an independent TO approves and publishes the same content.
    const ok = await decide(id, reviewId, independent);
    expect([ok.status, ok.body.status, ok.body.decidedBy]).toEqual([200, "approved", independentId]);
    const pub2 = await publish(id, creator);
    expect([pub2.status, pub2.body.status]).toEqual([200, "published"]);
  });

  it("an element PUT alone (no PATCH) makes its writer an author; the record is written with the write", async () => {
    const id = await scoringDraft();
    expect(await contributorsOf(id)).toEqual([creatorId]);
    await rewrite(id, coAuthor, false);
    expect(await contributorsOf(id)).toEqual([creatorId, coAuthorId].sort());
    const reviewId = await submit(id);
    expect(codeOf(await decide(id, reviewId, coAuthor))).toEqual([403, "config_review.self_review"]);
    expect(codeOf(await decide(id, reviewId, coAuthor, "request_changes", "A co-author cannot send it back."))).toEqual(
      [403, "config_review.self_review"],
    );
  });

  it("the creator and the requester are still refused; a TO who wrote nothing approves and publishes", async () => {
    const id = await scoringDraft();
    await rewrite(id, creator);
    // The requester submits a draft they never wrote.
    const reviewId = await submit(id, requester);
    const request = await api.db
      .selectFrom("config_review_request")
      .select("requested_by")
      .where("id", "=", reviewId)
      .executeTakeFirstOrThrow();
    expect(request.requested_by).toBe(requesterId);
    // Previewing, checking and submitting are not content writes: the requester is not a contributor.
    expect(await contributorsOf(id)).toEqual([creatorId]);
    expect(codeOf(await decide(id, reviewId, creator))).toEqual([403, "config_review.self_review"]);
    expect(codeOf(await decide(id, reviewId, requester))).toEqual([403, "config_review.self_review"]);
    const ok = await decide(id, reviewId, coAuthor);
    expect([ok.status, ok.body.status, ok.body.decidedBy]).toEqual([200, "approved", coAuthorId]);
    const pub = await publish(id, creator);
    expect([pub.status, pub.body.status]).toEqual([200, "published"]);
    // A published version records no new contributor (publishing is not a content write).
    expect(await contributorsOf(id)).toEqual([creatorId]);
  });

  it("deciding a round does not make the reviewer an author: the same TO decides the next round", async () => {
    const id = await scoringDraft();
    await rewrite(id, creator);
    const first = await submit(id);
    const back = await decide(id, first, independent, "request_changes", "Please explain the weight change.");
    expect([back.status, back.body.status]).toEqual([200, "changes_requested"]);
    expect(await contributorsOf(id)).toEqual([creatorId]);
    const edit = await call<Body>(api.app, "PATCH", `${V}/${id}`, {
      session: creator,
      headers: ifm(await versionOf(id)),
      body: { changeSummary: "feasibility weighted higher for the roll-out year" },
    });
    expect(edit.status).toBe(200);
    const second = await submit(id);
    const ok = await decide(id, second, independent);
    expect([ok.status, ok.body.status]).toEqual([200, "approved"]);
  });
});

describe("F-DG5-100: every content table of a draft records its writer (0097 triggers)", () => {
  it("a procedure definition written by a second admin makes them an author of the procedure draft", async () => {
    const base = await seedProceduresVersion(api);
    const res = await call<Body>(api.app, "POST", V, { session: creator, body: { basedOnVersionId: base.id } });
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    expect(await contributorsOf(id)).toEqual([creatorId]);
    const put = await call<Body>(api.app, "PUT", `/api/v1/admin/procedure-definitions/${id}/vendor_onboarding`, {
      session: coAuthor,
      headers: ifm(await versionOf(id)),
      body: syntheticDefinitionBody(),
    });
    expect(put.status).toBe(200);
    expect(await contributorsOf(id)).toEqual([creatorId, coAuthorId].sort());
  });

  it("a write that leaves updated_by stale is still recorded under the actor of its audit event (at COMMIT)", async () => {
    const id = await scoringDraft();
    const el = await api.db
      .selectFrom("methodology_element")
      .select(["id", "version", "updated_by"])
      .where("methodology_version_id", "=", id)
      .where("stable_key", "=", "feasibility")
      .executeTakeFirstOrThrow();
    expect(el.updated_by).toBe(creatorId);
    // The runtime role writes the element without stamping updated_by; its audit event names the independent user.
    await api.db.transaction().execute(async (tx) => {
      await sql`UPDATE methodology_element SET attributes = '{"weightPercent": "20.5"}'::jsonb, version = version + 1
                 WHERE id = ${el.id}::uuid`.execute(tx);
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: independentId, source: "api" },
        {
          action: "methodology_element.put",
          recordType: "methodology_element",
          recordId: el.id,
          organizationId: w.orgA.id,
          priorVersion: el.version,
          newVersion: el.version + 1,
        },
      );
    });
    expect(await contributorsOf(id)).toEqual([creatorId, independentId].sort());
  });
});

describe("F-DG5-100 at the database (0097): the runtime role cannot record a contributor's decision", () => {
  const ROLLBACK = new Error("rollback");

  /** Runs `fn` in a transaction of the runtime role (mth_app) that is always rolled back; the constraint or "ok". */
  async function inRolledBack(fn: (tx: Tx) => Promise<void>): Promise<string> {
    let outcome = "ok";
    await api.db
      .transaction()
      .execute(async (tx) => {
        try {
          await fn(tx);
        } catch (err) {
          outcome = (err as { constraint?: string }).constraint ?? String(err);
        }
        throw ROLLBACK;
      })
      .catch((e: unknown) => {
        if (e !== ROLLBACK) throw e;
      });
    return outcome;
  }

  const decideDirectly = (reviewId: string, by: string) =>
    sql`UPDATE config_review_request SET status = 'approved', decided_by = ${by}::uuid, decided_at = now(),
          version = version + 1, updated_at = now(), updated_by = ${by}::uuid WHERE id = ${reviewId}::uuid`;

  it("refuses a direct UPDATE that records a co-author's decision, and allows an independent one", async () => {
    const id = await scoringDraft();
    await rewrite(id, coAuthor);
    const reviewId = await submit(id);
    expect(await inRolledBack(async (tx) => void (await decideDirectly(reviewId, coAuthorId).execute(tx)))).toBe(
      "config_review_request_reviewer_not_contributor",
    );
    // The creator's direct decision keeps its 0062 constraint name; the requester's its CHECK.
    expect(await inRolledBack(async (tx) => void (await decideDirectly(reviewId, creatorId).execute(tx)))).toBe(
      "config_review_request_reviewer_not_author",
    );
    // A non-contributor's direct decision passes the SoD triggers (rolled back: no audit event is written here).
    const independentOutcome = await inRolledBack(async (tx) => {
      await decideDirectly(reviewId, independentId).execute(tx);
    });
    expect(independentOutcome).toBe("ok");
  });

  it("the contributor record is append-only for the runtime role", async () => {
    const id = await scoringDraft();
    expect(
      await inRolledBack(async (tx) => {
        await sql`UPDATE methodology_version_contributor SET user_id = ${independentId}::uuid
                   WHERE methodology_version_id = ${id}::uuid`.execute(tx);
      }),
    ).toMatch(/append-only|permission denied/);
    expect(
      await inRolledBack(async (tx) => {
        await sql`DELETE FROM methodology_version_contributor WHERE methodology_version_id = ${id}::uuid`.execute(tx);
      }),
    ).toMatch(/append-only|permission denied/);
    expect(await contributorsOf(id)).toEqual([creatorId]);
  });
});

const MIGRATION_0097 = new URL(
  "../../../../../packages/db/migrations/0097_p5_config_review_contributors.sql",
  import.meta.url,
);

describe("0097: the backfill records the contributors of the drafts open at migration time", () => {
  it("re-applied to the pre-0097 schema (rolled back): creator, updated_by and every audited writer; one audit event", async () => {
    // A co-author writes two weights, then the creator writes both again: no row's updated_by names the co-author any
    // more, only the audit trail does.
    const id = await scoringDraft();
    await rewrite(id, coAuthor, false);
    await rewrite(id, creator);
    const elements = await api.db
      .selectFrom("methodology_element")
      .select("updated_by")
      .where("methodology_version_id", "=", id)
      .execute();
    expect(elements.map((e) => e.updated_by)).not.toContain(coAuthorId);
    const client = await api.owner.connect();
    try {
      await client.query("BEGIN");
      // The pre-0097 schema, then the migration file exactly as shipped.
      await client.query(`DROP FUNCTION p5_config_contributor_from_row() CASCADE;
        DROP FUNCTION p5_config_contributor_from_audit() CASCADE;
        DROP FUNCTION config_review_request_contributor_guard() CASCADE;
        DROP FUNCTION automation_rule_version_contributor_guard() CASCADE;
        DROP FUNCTION p5_add_config_contributor(uuid, uuid);
        DROP FUNCTION p5_add_rule_contributor(uuid, uuid);
        DROP FUNCTION p5_config_content_version(text, jsonb);
        DROP TABLE methodology_version_contributor;
        DROP TABLE automation_rule_version_contributor;`);
      await client.query(readFileSync(MIGRATION_0097, "utf8"));
      const rows = (
        await client.query<{ user_id: string }>(
          "SELECT user_id FROM methodology_version_contributor WHERE methodology_version_id = $1 ORDER BY user_id",
          [id],
        )
      ).rows;
      expect(rows.map((r) => r.user_id)).toEqual([creatorId, coAuthorId].sort());
      const events = (
        await client.query<{ actor_type: string; source: string; changes: Body }>(
          `SELECT actor_type, source, changes FROM audit_event
            WHERE record_id = $1 AND action = 'methodology_version.contributors_backfill'`,
          [id],
        )
      ).rows;
      expect(events).toEqual([
        {
          actor_type: "system",
          source: "migration",
          changes: { contributors: { from: null, to: [creatorId, coAuthorId].sort() } },
        },
      ]);
      // A published version is not backfilled.
      const published = (
        await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM methodology_version_contributor c
             JOIN methodology_version m ON m.id = c.methodology_version_id WHERE m.status <> 'draft'`,
        )
      ).rows;
      expect(published).toEqual([{ n: "0" }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    // Rolled back: the live record is the one the triggers wrote.
    expect(await contributorsOf(id)).toEqual([creatorId, coAuthorId].sort());
  }, 120_000);
});
