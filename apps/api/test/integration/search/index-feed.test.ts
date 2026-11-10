// The search index feed and reindex (ADR-0057 §1, §2; REQ-S15-010; T-DG6-BE-P; p6-work-split §H/G.1), against a
// scratch database of this run's disposable cluster, migrated and seeded with the REAL synthetic demo dataset
// (`seedDemo`, ADR-0050), so every one of the 12 indexed record types has rows written through their own audited
// write paths. Proves:
//  1. after one feed run every row of each of the 12 types has exactly one document, whose content is exactly the
//     ADR-0057 §1 columns of the current row (so no money, rate, FTE, KPI or score value can appear in any document);
//     a further write to one row of each type appears after the next feed run;
//  2. an archive sets `is_archived`; a removed record's document is deleted;
//  3. replaying every batch changes nothing (the row hashes are identical);
//  4. two concurrent feed runs of one type serialize on lock 730318 (one waits for the other);
//  5. a reindex rebuilds exactly the current rows (a stray document is removed, a damaged one restored) and leaves
//     last_audit_seq at its start sequence;
//  6. a failure sets `failed` with its code (and a reindex failure restores the consumed sequence); the next run
//     recovers;
//  7. the job identity reads nothing outside its declared scope (ADR-0053 Q13): a principal without
//     transformation.read is refused before any read and indexes nothing; a principal of organization B admits no row
//     of organization A; a sensitive benefit is read only under the declared search exception;
//  8. the A13 hook (QA-C): a run killed mid-batch re-runs the batch with no duplicate and no gap; a write whose
//     transaction is still open with a LOWER audit sequence is never skipped.
// Everything is SYNTHETIC (an illustrative dataset, not Mobily data); indexing approves nothing and nothing here touches
// the engineering gates DG0-DG7.
import { insertAuditEvent, migrate, seedDemo, sql, type Db } from "@mth/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import {
  loadServiceIdentity,
  principalOfIdentity,
  ServiceScopeViolation,
  type JobRunContext,
  type LoadedServiceIdentity,
} from "../../../../worker/src/kit.ts";
import { serviceReadScopeFor } from "../../../../worker/src/service-scope.ts";
import {
  buildDocument,
  readIndexRows,
  SEARCH_DOCUMENT_SPECS,
  SEARCH_RECORD_TYPES,
  sourceColumnsOf,
  type SearchRecordType,
  type SourceRow,
} from "../../../../worker/src/search/documents.ts";
import {
  runIndexFeed,
  runReindex,
  SEARCH_HANDLERS,
  SEARCH_INDEX_FAILED_CODE,
  SEARCH_REINDEX_LOCK,
} from "../../../../worker/src/handlers/search.ts";
import { createOrg, createUser, startApi, type TestApi } from "../../support/harness.ts";

let api: TestApi;
let scratch: string | null = null;
let db: Db;
let feedRun: JobRunContext;
let reindexRun: JobRunContext;
let ownerUrl: string;
let actorId: string;

const ORG = DEMO_ANCHORS.organizationId;

const contextOf = (identity: LoadedServiceIdentity): JobRunContext => ({
  identity,
  principal: (organizationId) => principalOfIdentity(identity, organizationId),
});

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_be_p_search");
  ownerUrl = roleUrl(adminUrl, scratch, "mth_owner");
  await migrate(ownerUrl);
  await seedDemo(ownerUrl, { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  db = api.db;
  feedRun = contextOf(await loadServiceIdentity(db, "job:search.index_feed"));
  reindexRun = contextOf(await loadServiceIdentity(db, "job:search.reindex"));
  actorId = (await createUser(db, ORG)).id;
  // The demo dataset has no lessons: two synthetic draft lessons, each created as the API does (one audit event).
  for (const code of ["LL-9001", "LL-9002"]) await createLesson(code);
  // ... and no change requests: two synthetic drafts (business scope of a demo initiative), created the same way.
  for (const [i, code] of ["CR-9001", "CR-9002"].entries()) await createChangeRequest(code, i);
}, 300_000);

async function createChangeRequest(code: string, nth: number): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const id = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
    const subject = await tx
      .selectFrom("initiative")
      .select(["id", "version"])
      .where("transformation_id", "=", DEMO_ANCHORS.transformationId)
      .orderBy("id")
      .offset(nth)
      .limit(1)
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("change_request")
      .values({
        id,
        organization_id: ORG,
        transformation_id: DEMO_ANCHORS.transformationId,
        code,
        change_kind: "business_scope",
        subject_type: "initiative",
        subject_id: subject.id,
        subject_version: subject.version,
        proposed_change: JSON.stringify({ scope: "Synthetic scope change" }),
        reason: `Synthetic change request ${code}: extend the roll-out to two more regions`,
        raised_by: actorId,
        created_by: actorId,
        updated_by: actorId,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: actorId, source: "api", requestId: `be-p-${code}` },
      {
        action: "change_request.create",
        recordType: "change_request",
        recordId: id,
        organizationId: ORG,
        transformationId: DEMO_ANCHORS.transformationId,
        newVersion: 1,
      },
    );
  });
}

async function createLesson(code: string): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const id = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
    await tx
      .insertInto("lesson")
      .values({
        id,
        organization_id: ORG,
        transformation_id: DEMO_ANCHORS.transformationId,
        code,
        title: `Synthetic lesson ${code}: roll-out sequencing`,
        context: "Synthetic context for the search index test",
        lesson_text: "Synthetic lesson text (illustrative, not Mobily data).",
        created_by: actorId,
        updated_by: actorId,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: actorId, source: "api", requestId: `be-p-${code}` },
      {
        action: "lesson.create",
        recordType: "lesson",
        recordId: id,
        organizationId: ORG,
        transformationId: DEMO_ANCHORS.transformationId,
        newVersion: 1,
      },
    );
  });
}

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

// ------------------------------------------------------------------------------------------------ helpers

const table = (t: SearchRecordType) => sql.table(SEARCH_DOCUMENT_SPECS[t].table);

/** The current rows of a type, read with the builder's own column aliases (no scope: the test's oracle). */
async function currentRows(t: SearchRecordType): Promise<SourceRow[]> {
  const s = SEARCH_DOCUMENT_SPECS[t];
  const col = (name: string | null) => (name === null ? sql`NULL::text` : sql.ref(`r.${name}`));
  const r = await sql<SourceRow>`
    SELECT r.id, r.organization_id,
           ${t === "transformation" ? sql.ref("r.id") : sql.ref("r.transformation_id")} AS transformation_id,
           r.version, r.status::text AS status, ${col(s.code)}::text AS code, ${col(s.title)}::text AS title,
           ${col(s.summary)}::text AS summary,
           ${s.archived.kind === "archived_at" ? sql.ref("r.archived_at") : sql`NULL::timestamptz`} AS archived_at
      FROM ${table(t)} r ORDER BY r.id`.execute(db);
  return r.rows;
}

interface DocRow {
  record_id: string;
  organization_id: string;
  transformation_id: string;
  record_version: number;
  code: string | null;
  title: string;
  summary: string | null;
  record_status: string | null;
  is_archived: boolean;
  source_audit_seq: string;
  version: number;
}

async function documents(t: SearchRecordType): Promise<DocRow[]> {
  return (
    await sql<DocRow>`
    SELECT record_id, organization_id, transformation_id, record_version, code, title, summary, record_status,
           is_archived, source_audit_seq::text AS source_audit_seq, version
      FROM search_document WHERE record_type = ${t} ORDER BY record_id`.execute(db)
  ).rows;
}

/** md5 of every document row, all columns (the "row hashes identical" oracle). */
async function rowHashes(): Promise<Map<string, string>> {
  const r = await sql<{ id: string; h: string }>`
    SELECT id, md5(row(d.*)::text) AS h FROM search_document d ORDER BY id`.execute(db);
  return new Map(r.rows.map((x) => [x.id, x.h]));
}

async function state(t: SearchRecordType) {
  return db.selectFrom("search_index_state").selectAll().where("record_type", "=", t).executeTakeFirstOrThrow();
}

const expectedDoc = (t: SearchRecordType, row: SourceRow) => {
  const d = buildDocument(t, row);
  return {
    record_id: d.recordId,
    organization_id: d.organizationId,
    transformation_id: d.transformationId,
    record_version: d.recordVersion,
    code: d.code,
    title: d.title,
    summary: d.summary,
    record_status: d.recordStatus,
    is_archived: d.isArchived,
  };
};
const contentOf = (d: DocRow) => ({
  record_id: d.record_id,
  organization_id: d.organization_id,
  transformation_id: d.transformation_id,
  record_version: d.record_version,
  code: d.code,
  title: d.title,
  summary: d.summary,
  record_status: d.record_status,
  is_archived: d.is_archived,
});

/** A write as the API makes one: the title column changes, the version steps, one audit event, one transaction. */
async function touch(t: SearchRecordType, id: string, suffix: string, extra: Record<string, unknown> = {}) {
  const s = SEARCH_DOCUMENT_SPECS[t];
  await db.transaction().execute(async (tx) => {
    const before = await sql<{ version: number; organization_id: string; transformation_id: string | null }>`
      SELECT version, organization_id,
             ${t === "transformation" ? sql.ref("id") : sql.ref("transformation_id")} AS transformation_id
        FROM ${table(t)} WHERE id = ${id}::uuid FOR UPDATE`.execute(tx);
    const b = before.rows[0]!;
    const sets = [sql`${sql.ref(s.title)} = left(${sql.ref(s.title)}, 400) || ${suffix}`];
    for (const [k, v] of Object.entries(extra)) sets.push(sql`${sql.ref(k)} = ${v}`);
    await sql`UPDATE ${table(t)} SET ${sql.join(sets)}, version = version + 1, updated_at = now(),
                updated_by = ${actorId}::uuid WHERE id = ${id}::uuid`.execute(tx);
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: actorId, source: "api", requestId: `be-p-${suffix}` },
      {
        action: `${t}.update`,
        recordType: t,
        recordId: id,
        organizationId: b.organization_id,
        transformationId: b.transformation_id,
        priorVersion: b.version,
        newVersion: b.version + 1,
        changes: { [s.title]: { from: "(before)", to: "(after)" } },
      },
    );
  });
}

const maxSeq = async () =>
  (await sql<{ m: string }>`SELECT coalesce(max(seq), 0)::text AS m FROM audit_event`.execute(db)).rows[0]!.m;

/** Every type caught up: run the feed until no type consumed an event. */
async function feedAll(run: JobRunContext = feedRun) {
  for (let i = 0; i < 50; i += 1) {
    const r = await runIndexFeed(db, run);
    if (r.types.every((x) => x.events === 0)) return;
  }
  throw new Error("the feed did not catch up");
}

// ------------------------------------------------------------------------------------------------ 1. documents

describe("the feed indexes the 12 record types with the ADR-0057 §1 columns only", () => {
  it("one feed run per batch window: every row of each of the 12 types has exactly its document", async () => {
    // The demo seed wrote rows of every type through audited paths. The real job (defineJob, its own identity row).
    const handler = SEARCH_HANDLERS.find((h) => h.queue === "search.index_feed")!;
    await handler.handle(db, {}, "be-p-feed-1");
    await feedAll();
    for (const t of SEARCH_RECORD_TYPES) {
      const rows = await currentRows(t);
      expect(rows.length, `${t}: the demo dataset has rows`).toBeGreaterThan(0);
      const docs = await documents(t);
      expect(docs.map(contentOf), t).toEqual(rows.map((r) => expectedDoc(t, r)));
      const st = await state(t);
      expect(st.status, t).toBe("idle");
      expect(st.last_incremental_at, t).not.toBeNull();
      expect(BigInt(st.last_audit_seq), t).toBeGreaterThan(0n);
    }
  });

  it("a further write to one row of each type appears after the next feed run", async () => {
    const marker = " BEPWRITE";
    const touched = new Map<SearchRecordType, string>();
    for (const t of SEARCH_RECORD_TYPES) {
      const rows = await currentRows(t);
      // a row whose guards accept a plain title edit (some statuses are final); the first that does
      for (const r of rows) {
        try {
          await touch(t, r.id, marker);
          touched.set(t, r.id);
          break;
        } catch {
          // a final status refuses the edit: try the next row
        }
      }
      expect(touched.has(t), `${t}: one row accepted a write`).toBe(true);
    }
    await runIndexFeed(db, feedRun);
    for (const [t, id] of touched) {
      const doc = (await documents(t)).find((d) => d.record_id === id)!;
      expect(doc.title.endsWith(marker), t).toBe(true);
      const row = (await currentRows(t)).find((r) => r.id === id)!;
      expect(contentOf(doc), t).toEqual(expectedDoc(t, row));
      const seq = await sql<{ s: string }>`
        SELECT max(seq)::text AS s FROM audit_event WHERE record_type = ${t} AND record_id = ${id}::uuid`.execute(db);
      expect(doc.source_audit_seq, t).toBe(seq.rows[0]!.s);
    }
  });

  it("no value column is ever read: the builders read no numeric column of any of the 12 tables", async () => {
    const numeric = await sql<{ table_name: string; column_name: string }>`
      SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY(${[...SEARCH_RECORD_TYPES]}::text[])
         AND data_type IN ('numeric', 'integer', 'bigint', 'double precision', 'real', 'smallint', 'money')
         AND column_name <> 'version'`.execute(db);
    expect(numeric.rows.length).toBeGreaterThan(0);
    for (const t of SEARCH_RECORD_TYPES) {
      const read = new Set(sourceColumnsOf(t));
      for (const c of numeric.rows.filter((n) => n.table_name === t))
        expect(read.has(c.column_name), `${t}.${c.column_name}`).toBe(false);
    }
    // and the document itself has no value column: only its version counters are numbers
    const docCols = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'search_document'
         AND data_type IN ('numeric', 'integer', 'bigint', 'double precision', 'real', 'smallint', 'money')
       ORDER BY column_name`.execute(db);
    expect(docCols.rows.map((r) => r.column_name)).toEqual(["record_version", "source_audit_seq", "version"]);
  });
});

// ------------------------------------------------------------------------------------------------ 2. archive, removal

describe("archive and removal", () => {
  it("an archive sets is_archived; the status is recorded", async () => {
    await feedAll();
    const t: SearchRecordType = "lesson";
    const target = (await currentRows(t)).find((r) => r.status !== "archived");
    expect(target, "a lesson that is not archived").toBeDefined();
    const now = new Date().toISOString();
    await touch(t, target!.id, " PUB", { status: "published", published_at: now, published_by: actorId });
    await runIndexFeed(db, feedRun, { recordTypes: [t] });
    expect((await documents(t)).find((d) => d.record_id === target!.id)!.is_archived).toBe(false);
    await touch(t, target!.id, " ARCH", { status: "archived", archived_at: now, archived_by: actorId });
    await runIndexFeed(db, feedRun, { recordTypes: [t] });
    const doc = (await documents(t)).find((d) => d.record_id === target!.id)!;
    expect(doc.is_archived).toBe(true);
    expect(doc.record_status).toBe("archived");
  });

  it("a withdrawn change request is archived in the index (ADR-0057 §1: change_request archives at withdrawn)", async () => {
    await feedAll();
    const t: SearchRecordType = "change_request";
    const target = (await currentRows(t)).find((r) => r.status === "draft")!;
    expect((await documents(t)).find((d) => d.record_id === target.id)!.is_archived).toBe(false);
    await touch(t, target.id, " WD", { status: "withdrawn", withdrawn_at: new Date().toISOString() });
    await runIndexFeed(db, feedRun, { recordTypes: [t] });
    const doc = (await documents(t)).find((d) => d.record_id === target.id)!;
    expect(doc.is_archived).toBe(true);
    expect(doc.record_status).toBe("withdrawn");
  });

  it("a removed record's document is deleted on the next feed run", async () => {
    const t: SearchRecordType = "decision";
    const removedId = "01920006-0115-7000-8000-0000000000aa";
    const transformation = (await currentRows("transformation"))[0]!;
    await db.transaction().execute(async (tx) => {
      await sql`
        INSERT INTO search_document (id, organization_id, transformation_id, record_type, record_id, record_version,
                                     title, source_audit_seq)
        VALUES (mth_uuid_v7(), ${transformation.organization_id}::uuid, ${transformation.id}::uuid, ${t},
                ${removedId}::uuid, 1, 'Synthetic decision that no longer exists', 1)`.execute(tx);
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: actorId, source: "api", requestId: "be-p-removed" },
        {
          action: "decision.delete",
          recordType: t,
          recordId: removedId,
          organizationId: transformation.organization_id,
          transformationId: transformation.id,
          priorVersion: 1,
        },
      );
    });
    const r = await runIndexFeed(db, feedRun, { recordTypes: [t] });
    expect(r.types[0]!.deleted).toBe(1);
    expect((await documents(t)).some((d) => d.record_id === removedId)).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ 3. replay

describe("exactly once", () => {
  it("replaying every batch from sequence 0 changes nothing (row hashes identical)", async () => {
    await feedAll();
    const before = await rowHashes();
    expect(before.size).toBeGreaterThan(0);
    // Rewind every type's consumed sequence to 0 (the one backward move the guard allows, through `reindexing`),
    // then back to idle: the next feed runs re-read every audit event of every type.
    await db.transaction().execute(async (tx) => {
      await tx
        .updateTable("search_index_state")
        .set({
          status: "reindexing",
          last_audit_seq: "0",
          reindex_started_at: sql<Date>`now()`,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
        })
        .execute();
      await tx
        .updateTable("search_index_state")
        .set({ status: "idle", version: sql<number>`version + 1`, updated_at: sql<Date>`now()` })
        .execute();
    });
    await feedAll();
    expect(await rowHashes()).toEqual(before);
  });
});

// ------------------------------------------------------------------------------------------------ 4. the lock

describe("two concurrent feed runs of one type serialize (lock 730318)", () => {
  it("a run waits while another holds the type's lock, then both finish and the document steps once", async () => {
    await feedAll();
    const t: SearchRecordType = "initiative";
    const id = (await currentRows(t))[0]!.id;
    await touch(t, id, " LOCK");
    const holder = new pg.Client({ connectionString: roleUrl(inject("mthDb").adminUrl, scratch!, "mth_app") });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock($1::integer, hashtext($2::text))", [SEARCH_REINDEX_LOCK, t]);
      const before = (await documents(t)).find((d) => d.record_id === id)!;
      const first = runIndexFeed(db, feedRun, { recordTypes: [t] });
      const second = runIndexFeed(db, feedRun, { recordTypes: [t] });
      // both feed transactions wait on the advisory lock (observed, not timed)
      for (let i = 0; i < 200; i += 1) {
        const waiting = await sql<{ n: string }>`
          SELECT count(*)::text AS n FROM pg_locks
           WHERE locktype = 'advisory' AND classid = ${SEARCH_REINDEX_LOCK} AND NOT granted`.execute(db);
        if (Number(waiting.rows[0]!.n) >= 2) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      const waiting = await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM pg_locks
         WHERE locktype = 'advisory' AND classid = ${SEARCH_REINDEX_LOCK} AND NOT granted`.execute(db);
      expect(Number(waiting.rows[0]!.n)).toBe(2);
      expect((await documents(t)).find((d) => d.record_id === id)!.version).toBe(before.version);
      await holder.query("COMMIT");
      const [a, b] = await Promise.all([first, second]);
      // exactly one of the two consumed the write; the other found nothing new
      expect([a.types[0]!.upserted, b.types[0]!.upserted].sort()).toEqual([0, 1]);
      expect((await documents(t)).find((d) => d.record_id === id)!.version).toBe(before.version + 1);
    } finally {
      await holder.end();
    }
  });
});

// ------------------------------------------------------------------------------------------------ 5. reindex

describe("the reindex", () => {
  it("rebuilds exactly the current rows and leaves last_audit_seq at its start sequence", async () => {
    await feedAll();
    const t: SearchRecordType = "benefit";
    const [victim, damaged] = (await documents(t)).slice(0, 2);
    const transformation = (await currentRows("transformation"))[0]!;
    // a lost document, a damaged one (same sequence, wrong title) and a stray one for a record that does not exist
    await sql`DELETE FROM search_document WHERE record_type = ${t} AND record_id = ${victim!.record_id}::uuid`.execute(
      db,
    );
    await sql`UPDATE search_document SET title = 'damaged', version = version + 1
               WHERE record_type = ${t} AND record_id = ${damaged!.record_id}::uuid`.execute(db);
    await sql`
      INSERT INTO search_document (id, organization_id, transformation_id, record_type, record_id, record_version, title,
                                   source_audit_seq)
      VALUES (mth_uuid_v7(), ${transformation.organization_id}::uuid, ${transformation.id}::uuid, ${t},
              '01920006-0115-7000-8000-0000000000bb', 1, 'stray', 1)`.execute(db);
    const s0 = await maxSeq();
    const r = await runReindex(db, reindexRun, { recordTypes: [t], batchSize: 7 });
    expect(r.types[0]!.outcome).toBe("indexed");
    const rows = await currentRows(t);
    expect((await documents(t)).map(contentOf)).toEqual(rows.map((x) => expectedDoc(t, x)));
    const st = await state(t);
    expect(st.status).toBe("idle");
    expect(st.last_audit_seq).toBe(s0);
    expect(st.documents_count).toBe(rows.length);
    expect(st.reindex_started_at).not.toBeNull();
    expect(st.reindex_finished_at).not.toBeNull();
    // a second reindex rewrites nothing (exactly once)
    const before = await rowHashes();
    await runReindex(db, reindexRun, { recordTypes: [t], batchSize: 7 });
    expect(await rowHashes()).toEqual(before);
  });

  it("the reindex job runs as its own identity through defineJob", async () => {
    const handler = SEARCH_HANDLERS.find((h) => h.queue === "search.reindex")!;
    const out = (await handler.handle(db, {}, "be-p-reindex-1")) as { types: { outcome: string }[] };
    expect(out.types).toHaveLength(12);
    expect(out.types.every((x) => x.outcome === "indexed")).toBe(true);
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------ 6. failure

describe("a failure sets failed with its code and the next run recovers", () => {
  it("the feed: failed with search.index_failed, nothing consumed; the next run indexes and sets idle", async () => {
    await feedAll();
    const t: SearchRecordType = "raid_entry";
    const id = (await currentRows(t))[0]!.id;
    await touch(t, id, " FAIL");
    const before = await state(t);
    await expect(
      runIndexFeed(db, feedRun, {
        recordTypes: [t],
        hooks: {
          beforeCommit: () => {
            throw new Error("synthetic failure");
          },
        },
      }),
    ).rejects.toThrow("synthetic failure");
    const failed = await state(t);
    expect(failed.status).toBe("failed");
    expect(failed.last_error_code).toBe(SEARCH_INDEX_FAILED_CODE);
    expect(failed.last_error_at).not.toBeNull();
    expect(failed.last_audit_seq).toBe(before.last_audit_seq);
    expect((await documents(t)).find((d) => d.record_id === id)!.title.endsWith(" FAIL")).toBe(false);
    await runIndexFeed(db, feedRun, { recordTypes: [t] });
    const ok = await state(t);
    expect(ok.status).toBe("idle");
    expect(ok.last_error_code).toBeNull();
    expect(ok.last_error_at).toBeNull();
    expect((await documents(t)).find((d) => d.record_id === id)!.title.endsWith(" FAIL")).toBe(true);
  });

  it("the reindex: failed, the consumed sequence restored so the feed resumes; the next reindex completes", async () => {
    await feedAll();
    const t: SearchRecordType = "dependency";
    const before = await state(t);
    await expect(
      runReindex(db, reindexRun, {
        recordTypes: [t],
        hooks: {
          beforeCommit: () => {
            throw new Error("synthetic reindex failure");
          },
        },
      }),
    ).rejects.toThrow("synthetic reindex failure");
    const failed = await state(t);
    expect(failed.status).toBe("failed");
    expect(failed.last_error_code).toBe(SEARCH_INDEX_FAILED_CODE);
    expect(failed.last_audit_seq).toBe(before.last_audit_seq);
    await runReindex(db, reindexRun, { recordTypes: [t] });
    const ok = await state(t);
    expect(ok.status).toBe("idle");
    expect(ok.last_error_code).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ 7. scope (Q13)

describe("the job identity reads nothing outside its declared scope (ADR-0053 Q13)", () => {
  it("without transformation.read the run is refused before any read: service_identity.out_of_scope, nothing indexed", async () => {
    await feedAll();
    const t: SearchRecordType = "deliverable";
    const id = (await currentRows(t))[0]!.id;
    await touch(t, id, " SCOPE");
    const narrowed = contextOf({ ...feedRun.identity, grantedPermissionCodes: [] });
    await expect(runIndexFeed(db, narrowed, { recordTypes: [t] })).rejects.toBeInstanceOf(ServiceScopeViolation);
    const st = await state(t);
    expect(st.status).toBe("failed");
    expect(st.last_error_code).toBe("service_identity.out_of_scope");
    expect((await documents(t)).find((d) => d.record_id === id)!.title.endsWith(" SCOPE")).toBe(false);
    await runIndexFeed(db, feedRun, { recordTypes: [t] });
    expect((await state(t)).status).toBe("idle");
  });

  it("a principal of another organization admits no row of this one (SQL predicate and the read itself)", async () => {
    const other = await createOrg(db);
    const principal = feedRun.principal(other.id);
    const scope = await serviceReadScopeFor(db, principal, "transformation.read");
    for (const t of SEARCH_RECORD_TYPES) {
      const ids = (await currentRows(t)).slice(0, 3).map((r) => r.id);
      const admitted = await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM ${table(t)} r WHERE r.id = ANY(${ids}::uuid[]) AND ${scope.predicate({
          recordType: null,
          recordId: sql.ref("r.id"),
          organizationId: sql.ref("r.organization_id"),
        })}`.execute(db);
      expect(admitted.rows[0]!.n, t).toBe("0");
      await expect(readIndexRows(db, t, scope, ids), t).rejects.toBeInstanceOf(ServiceScopeViolation);
    }
  });

  it("a sensitive benefit is read only under the declared search exception, never by another job identity", async () => {
    const benefit = (await currentRows("benefit"))[0]!;
    await db.transaction().execute(async (tx) => {
      const id = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
      await tx
        .insertInto("record_sensitivity")
        .values({
          id,
          organization_id: benefit.organization_id,
          transformation_id: benefit.transformation_id,
          record_type: "benefit",
          record_id: benefit.id,
          is_sensitive: true,
          reason: "Synthetic sensitivity mark for the search exception test",
          created_by: actorId,
          updated_by: actorId,
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: actorId, source: "api", requestId: "be-p-sensitive" },
        {
          action: "record_sensitivity.mark",
          recordType: "record_sensitivity",
          recordId: id,
          organizationId: benefit.organization_id,
          transformationId: benefit.transformation_id,
          newVersion: 1,
        },
      );
    });
    const searchScope = await serviceReadScopeFor(
      db,
      feedRun.principal(benefit.organization_id),
      "transformation.read",
    );
    expect((await readIndexRows(db, "benefit", searchScope, [benefit.id])).map((r) => r.id)).toEqual([benefit.id]);
    const other = contextOf(await loadServiceIdentity(db, "job:kpi.recalculate"));
    const otherScope = await serviceReadScopeFor(db, other.principal(benefit.organization_id), "transformation.read");
    await expect(readIndexRows(db, "benefit", otherScope, [benefit.id])).rejects.toBeInstanceOf(ServiceScopeViolation);
    // the sensitive benefit stays indexed (its readers are filtered at query time, ADR-0057 §3)
    await touch("benefit", benefit.id, " SENS");
    await runIndexFeed(db, feedRun, { recordTypes: ["benefit"] });
    expect((await documents("benefit")).find((d) => d.record_id === benefit.id)!.title.endsWith(" SENS")).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ 8. A13 hook

describe("A13 hook (QA-C): no duplicate and no gap", () => {
  it("a run killed mid-batch re-runs the batch: every record reflects its last event, once", async () => {
    await feedAll();
    const t: SearchRecordType = "initiative";
    const ids = (await currentRows(t)).slice(0, 6).map((r) => r.id);
    for (const id of ids) await touch(t, id, " A13");
    const before = await state(t);
    await expect(
      runIndexFeed(db, feedRun, {
        recordTypes: [t],
        batchSize: 4,
        hooks: {
          beforeCommit: (_type, batch) => {
            if (batch.upserted > 0) throw new Error("worker killed mid-batch (synthetic)");
          },
        },
      }),
    ).rejects.toThrow("worker killed");
    expect((await state(t)).last_audit_seq).toBe(before.last_audit_seq);
    await feedAll();
    const docs = await documents(t);
    expect(new Set(docs.map((d) => d.record_id)).size).toBe(docs.length);
    const last = await sql<{ record_id: string; s: string }>`
      SELECT record_id, max(seq)::text AS s FROM audit_event WHERE record_type = ${t} GROUP BY record_id`.execute(db);
    const byId = new Map(docs.map((d) => [d.record_id, d]));
    for (const e of last.rows) {
      const d = byId.get(e.record_id);
      if (d === undefined) continue; // an event of a row that no longer exists
      expect(d.source_audit_seq, e.record_id).toBe(e.s);
    }
    for (const id of ids) expect(byId.get(id)!.title.endsWith(" A13")).toBe(true);
  });

  it("a write whose transaction is still open with a lower audit sequence is never skipped", async () => {
    await feedAll();
    const t: SearchRecordType = "kpi_definition";
    const [slowRow, fastRow] = (await currentRows(t)).slice(0, 2);
    const slow = new pg.Client({ connectionString: roleUrl(inject("mthDb").adminUrl, scratch!, "mth_app") });
    await slow.connect();
    try {
      // the slow writer takes its audit sequence first and keeps its transaction open
      await slow.query("BEGIN");
      await slow.query(
        `UPDATE kpi_definition SET name = left(name, 400) || ' SLOW', version = version + 1, updated_at = now(),
                updated_by = $2 WHERE id = $1`,
        [slowRow!.id, actorId],
      );
      await slow.query(
        `INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type,
                                  record_id, prior_version, new_version, source)
         VALUES (mth_uuid_v7(), $1, $2, 'user', $3, 'kpi_definition.update', 'kpi_definition', $4, $5, $6, 'api')`,
        [
          slowRow!.organization_id,
          slowRow!.transformation_id,
          actorId,
          slowRow!.id,
          slowRow!.version,
          slowRow!.version + 1,
        ],
      );
      // a later write commits first, with a higher sequence
      await touch(t, fastRow!.id, " FAST");
      await runIndexFeed(db, feedRun, { recordTypes: [t] });
      const slowSeq = (
        await slow.query<{ s: string }>("SELECT max(seq)::text AS s FROM audit_event WHERE record_id = $1", [
          slowRow!.id,
        ])
      ).rows[0]!.s;
      // the feed stopped before the open write: nothing at or above its sequence was consumed
      expect(BigInt((await state(t)).last_audit_seq)).toBeLessThan(BigInt(slowSeq));
      await slow.query("COMMIT");
      await feedAll();
      const docs = await documents(t);
      expect(docs.find((d) => d.record_id === slowRow!.id)!.title.endsWith(" SLOW")).toBe(true);
      expect(docs.find((d) => d.record_id === fastRow!.id)!.title.endsWith(" FAST")).toBe(true);
    } finally {
      await slow.query("ROLLBACK").catch(() => undefined);
      await slow.end();
    }
  });
});
