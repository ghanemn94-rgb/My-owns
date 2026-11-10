// P6 contract exercises of BE-P (p6-plan §5.1, p6-work-split §2 rule 16). Stub created by T-DG6-BE-A and already
// called by contract.test.ts. BE-P routes no operation; T-DG6-BE-P2 (p6-work-split §H/G.2) routes searchRecords and
// getSearchIndexStatus and exercises them here through `ctx.mirrored`: success and every declared refusal it can reach
// on the shared run database. Not reached here, on purpose: searchRecords' 503 search.index_unavailable needs every
// requested type's index state set to `failed`, which is global state shared by the concurrent suites; it is proven on
// a scratch database in test/integration/search/search.test.ts (and the 429 by the contract's live rate-limit sweep).
// No shared zod mirror exists for these bodies in packages/shared (outside BE-P2's files); the mirrors below restate
// the contract schemas. The two search documents are synthetic derived rows written directly (the worker's index jobs
// are their only writers in production, T-DG6-BE-P); nothing here grants a business approval or touches DG0-DG7.
import { sql } from "@mth/db";
import { expect } from "vitest";
import { z } from "zod";
import { createTransformationRow, signIn, type P6ExerciseContext } from "../../support/harness.ts";

const ts = z.iso.datetime({ offset: true });
const recordType = z.enum([
  "transformation",
  "initiative",
  "kpi_definition",
  "benefit",
  "raid_entry",
  "dependency",
  "decision",
  "deliverable",
  "evidence",
  "business_case",
  "lesson",
  "change_request",
]);
const searchHit = z.strictObject({
  recordType,
  recordId: z.uuid(),
  recordVersion: z.number().int().min(1),
  transformationId: z.uuid(),
  transformationCode: z.string(),
  transformationName: z.string(),
  code: z.string().max(40).nullable(),
  title: z.string().min(1).max(500),
  summary: z.string().max(1000).nullable(),
  recordStatus: z.string().nullable(),
  isArchived: z.boolean(),
});
const searchResultPage = z.strictObject({
  items: z.array(searchHit),
  nextCursor: z.string().nullable(),
  indexedThrough: ts.nullable(),
  stale: z.boolean(),
});
const searchIndexStatus = z.strictObject({
  types: z.array(
    z.strictObject({
      recordType,
      status: z.enum(["idle", "reindexing", "failed"]),
      lastAuditSeq: z.string().regex(/^[0-9]{1,19}$/),
      lastIncrementalAt: ts.nullable(),
      reindexStartedAt: ts.nullable(),
      reindexFinishedAt: ts.nullable(),
      documentsCount: z.number().int().min(0).nullable(),
      lastErrorCode: z.string().nullable(),
      lastErrorAt: ts.nullable(),
      version: z.number().int().min(1),
    }),
  ),
});

export const P6_MIRRORS_BE_P: Readonly<Record<string, z.ZodType>> = {
  searchRecords: searchResultPage,
  getSearchIndexStatus: searchIndexStatus,
};

export async function exerciseP6BePOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const office = await signIn(api.app, w.office.subject); // TO @ A: transformation.read
  const admin = await signIn(api.app, w.admin.subject); // ADM_TECH @ A: operations.read
  const nobody = await signIn(api.app, w.nobody.subject);
  // A word unique to this run, so no other suite's document matches.
  const word = `pangolin${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  for (const n of [1, 2]) {
    const id = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    await sql`
      INSERT INTO search_document (id, organization_id, transformation_id, record_type, record_id, record_version,
                                   code, title, summary, source_audit_seq)
      VALUES (mth_uuid_v7(), ${w.orgA.id}::uuid, ${id}::uuid, 'transformation', ${id}::uuid, 1, NULL,
              ${`Synthetic contract ${word} ${n}`}, 'Synthetic summary', 1)`.execute(api.db);
  }

  // searchRecords: 200 (a page with a cursor, then the next page); 400 (too short; a foreign cursor); 401; 403.
  const S = `/api/v1/search?q=${word}`;
  const first = await mirrored("GET", `${S}&recordType=transformation&limit=1`, { session: office });
  expect(first.status).toBe(200);
  expect(first.body.items).toHaveLength(1);
  expect(typeof first.body.nextCursor).toBe("string");
  const second = await mirrored(
    "GET",
    `${S}&recordType=transformation&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    { session: office },
  );
  expect(second.status).toBe(200);
  expect(second.body.items).toHaveLength(1);
  expect(second.body.items[0].recordId).not.toBe(first.body.items[0].recordId);
  expect(second.body.nextCursor).toBeNull();
  const short = await mirrored("GET", "/api/v1/search?q=a", { session: office });
  expect([short.status, short.body.code]).toEqual([400, "search.query_too_short"]);
  const foreign = await mirrored("GET", `${S}&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`, {
    session: office,
  });
  expect(foreign.status).toBe(400);
  expect((await mirrored("GET", S)).status).toBe(401);
  expect((await mirrored("GET", S, { session: nobody })).status).toBe(403);

  // getSearchIndexStatus: 200 (the 12 states); 400; 401; 403.
  const I = "/api/v1/admin/search/index";
  const status = await mirrored("GET", I, { session: admin });
  expect(status.status).toBe(200);
  expect(status.body.types).toHaveLength(12);
  expect((await mirrored("GET", `${I}?recordType=lesson`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", I)).status).toBe(401);
  expect((await mirrored("GET", I, { session: nobody })).status).toBe(403);
}
