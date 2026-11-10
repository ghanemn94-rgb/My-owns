// The global search query (ADR-0057 §3; REQ-S15-010 "Search returns only records the user may read"; T-DG6-BE-P2;
// p6-work-split §H/G.2). It reads `search_document` (written only by the worker's index jobs, T-DG6-BE-P) and
// `search_index_state`, and never writes.
//
//   Match     search_en @@ websearch_to_tsquery('english', q) OR search_ar @@ websearch_to_tsquery('arabic', q)
//             OR search_simple @@ websearch_to_tsquery('simple', q).
//   Order     relevance as an INTEGER, floor(greatest(ts_rank_cd of the three vectors) x 1,000,000), so the cursor
//             carries no float; then record_type, then record_id. The cursor is the keyset of these three and is bound
//             to q and the filters (filterHash, ADR-0007): a cursor of another query is a 400.
//   Permission, at QUERY time, never at index time (p6-plan R2; work split §H/G.14 item 1): every hit passes
//             ReadScope.predicate for `transformation.read` - the read permission every one of the 12 record views
//             checks (the parity test proves it, search-parity.test.ts) - with recordType set for the three ADR-0051 §2
//             sensitive types and their named parties taken from a LEFT JOIN of the LIVE source row. Nothing about
//             permissions is copied into a document, so a revoked grant or a removed scope applies to the next request.
//   Freshness indexedThrough = the oldest last_incremental_at of the requested types (null if any is null);
//             stale = a requested type is reindexing or failed, or indexedThrough is null (Unknown) or older than
//             120 s (ADR-0057 §2). Results are never hidden because the index is behind; every requested type failed
//             is 503 search.index_unavailable.
// No money, rate, FTE, KPI or score value is in a document (ADR-0057 §1), so a hit discloses no individual value.
// Searching approves nothing (G1-G6) and never touches DG0-DG7.
import { hasText } from "@mth/shared/schemas";
import { PROBLEM_TYPES } from "@mth/shared";
import { sql, type Db, type Expression, type SqlBool } from "@mth/db";
import { readScopeFor, type Principal, type ReadScopeColumns } from "../access/index.ts";
import { HttpProblem, decodeCursor, encodeCursor, filterHash, iso, problems } from "../platform/index.ts";

/** The closed set of indexed record types (0108 `p6_search_record_type_valid`), in the ADR-0057 §1 order. */
export const SEARCH_RECORD_TYPES = [
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
] as const;
export type SearchRecordType = (typeof SEARCH_RECORD_TYPES)[number];

/** The read permission of every one of the 12 record views (ADR-0057 §3; proven by search-parity.test.ts). */
export const SEARCH_READ_PERMISSION = "transformation.read" as const;

/** ADR-0057 §2: the index is stale when it is more than this far behind. */
export const SEARCH_STALE_AFTER_MS = 120_000;

/** ADR-0057 §3: `q` is 2-200 characters after trimming. */
export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 200;

/** ADR-0057 §10, verbatim. */
export const searchRefusals = {
  queryTooShort: () =>
    new HttpProblem({
      status: 400,
      type: PROBLEM_TYPES.validation,
      code: "search.query_too_short",
      title: "Validation failed",
      detail: "Enter at least 2 characters to search.",
      errors: [
        { pointer: "/query/q", code: "search.query_too_short", message: "Enter at least 2 characters to search." },
      ],
    }),
  indexUnavailable: () =>
    new HttpProblem({
      status: 503,
      type: PROBLEM_TYPES.unavailable,
      code: "search.index_unavailable",
      title: "Service unavailable",
      detail: "Search is not available right now. Try again later.",
    }),
};

/**
 * The trimmed query, or 400 search.query_too_short. Length is counted in code points (as zod counts `maxLength`), so
 * one astral character is one character. A query with no visible content is refused by the route's free-text rule.
 */
export function normalizedQuery(q: string): string {
  // Trimming removes whitespace AND invisible format characters (U+200F RLM, U+2060 ...) at both ends, so an
  // invisible mark never counts as one of the 2 characters.
  const trimmed = q.replace(/^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu, "");
  if (!hasText(trimmed) || Array.from(trimmed).length < SEARCH_QUERY_MIN) throw searchRefusals.queryTooShort();
  return trimmed;
}

export interface SearchQuery {
  /** Trimmed, 2-200 characters (normalizedQuery). */
  readonly q: string;
  /** Distinct, non-empty; the 12 when the caller names none. */
  readonly recordTypes: readonly SearchRecordType[];
  readonly transformationId: string | null;
  readonly includeArchived: boolean;
  readonly cursor: string | undefined;
  readonly limit: number;
}

export interface SearchHit {
  readonly recordType: SearchRecordType;
  readonly recordId: string;
  readonly recordVersion: number;
  readonly transformationId: string;
  readonly transformationCode: string;
  readonly transformationName: string;
  readonly code: string | null;
  readonly title: string;
  readonly summary: string | null;
  readonly recordStatus: string | null;
  readonly isArchived: boolean;
}

export interface SearchResultPage {
  readonly items: SearchHit[];
  readonly nextCursor: string | null;
  readonly indexedThrough: string | null;
  readonly stale: boolean;
}

/** The freshness of the requested types (ADR-0057 §2), or 503 when every requested type's index failed. */
export async function indexFreshness(
  db: Db,
  types: readonly SearchRecordType[],
  now: Date,
): Promise<{ indexedThrough: string | null; stale: boolean }> {
  const states = await db
    .selectFrom("search_index_state")
    .select(["record_type", "status", "last_incremental_at"])
    .where("record_type", "in", [...types])
    .execute();
  // A requested type without a state row is Unknown (0108 seeds all 12; never assume it is fresh).
  const complete = states.length === types.length;
  if (complete && states.every((s) => s.status === "failed")) throw searchRefusals.indexUnavailable();
  let oldest: Date | null = null;
  let unknown = !complete;
  for (const s of states) {
    if (s.last_incremental_at === null) unknown = true;
    else if (oldest === null || s.last_incremental_at < oldest) oldest = s.last_incremental_at;
  }
  const indexedThrough = unknown || oldest === null ? null : oldest;
  const stale =
    states.some((s) => s.status !== "idle") ||
    indexedThrough === null ||
    now.getTime() - indexedThrough.getTime() > SEARCH_STALE_AFTER_MS;
  return { indexedThrough: indexedThrough === null ? null : iso(indexedThrough), stale };
}

/** The cursor binding (ADR-0007): q and every filter, never the cursor or the limit. */
export function searchFilterHash(query: Omit<SearchQuery, "cursor" | "limit">): string {
  return filterHash({
    op: "searchRecords",
    q: query.q,
    recordTypes: [...query.recordTypes].sort(),
    transformationId: query.transformationId,
    includeArchived: query.includeArchived,
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANK = /^[0-9]{1,18}$/;

/** The decoded keyset [rank, recordType, recordId], or 400 validation.cursor. */
function keysetOf(cursor: string | undefined, hash: string): [string, SearchRecordType, string] | null {
  const keys = decodeCursor(cursor, hash, 3);
  if (keys === null) return null;
  const [rank, type, id] = keys;
  if (
    typeof rank !== "string" ||
    !RANK.test(rank) ||
    typeof type !== "string" ||
    !(SEARCH_RECORD_TYPES as readonly string[]).includes(type) ||
    typeof id !== "string" ||
    !UUID.test(id)
  )
    throw problems.badRequest(
      "validation.cursor",
      "The cursor is invalid or belongs to other filters.",
      "/query/cursor",
    );
  return [rank, type as SearchRecordType, id];
}

const SENSITIVE: readonly SearchRecordType[] = ["benefit", "business_case", "evidence"];

/**
 * Runs the search for `principal`. The caller has already checked that the principal holds the read permission
 * somewhere (403 otherwise) and normalized `q`.
 */
export async function searchRecords(
  db: Db,
  principal: Principal,
  query: SearchQuery,
  now: Date = new Date(),
): Promise<SearchResultPage> {
  const hash = searchFilterHash(query);
  const after = keysetOf(query.cursor, hash);
  const freshness = await indexFreshness(db, query.recordTypes, now);
  const scope = await readScopeFor(db, principal, SEARCH_READ_PERMISSION);

  const q = query.q;
  const en = sql`websearch_to_tsquery('english', ${q})`;
  const ar = sql`websearch_to_tsquery('arabic', ${q})`;
  const simple = sql`websearch_to_tsquery('simple', ${q})`;
  const match = sql<SqlBool>`(d.search_en @@ ${en} OR d.search_ar @@ ${ar} OR d.search_simple @@ ${simple})`;
  const rank = sql<string>`floor(greatest(ts_rank_cd(d.search_en, ${en}), ts_rank_cd(d.search_ar, ${ar}), ts_rank_cd(d.search_simple, ${simple}))::numeric * 1000000)::bigint`;

  const ref = (c: string) => sql.ref(c) as Expression<string | null>;
  const base: Omit<ReadScopeColumns, "recordType" | "partyUserIds"> = {
    recordId: sql.ref("d.record_id"),
    organizationId: sql.ref("d.organization_id"),
    businessUnitId: sql.ref("t.business_unit_id"),
    transformationId: sql.ref("d.transformation_id"),
  };
  const types = query.recordTypes;
  const plain = types.filter((t) => !SENSITIVE.includes(t));
  const allowed: Expression<SqlBool>[] = [];
  if (plain.length > 0)
    allowed.push(
      sql<SqlBool>`(d.record_type IN (${sql.join(plain)}) AND ${scope.predicate({ ...base, recordType: null })})`,
    );
  if (types.includes("benefit"))
    allowed.push(
      sql<SqlBool>`(d.record_type = 'benefit' AND ${scope.predicate({
        ...base,
        recordType: "benefit",
        partyUserIds: [ref("sb.owner_user_id"), ref("sb.finance_validator_user_id"), ref("sb.created_by")],
      })})`,
    );
  if (types.includes("business_case"))
    allowed.push(
      sql<SqlBool>`(d.record_type = 'business_case' AND ${scope.predicate({
        ...base,
        recordType: "business_case",
        partyUserIds: [
          ref("sc.benefit_owner_user_id"),
          ref("sc.initiative_owner_user_id"),
          ref("sc.finance_validator_user_id"),
          ref("sc.created_by"),
        ],
      })})`,
    );
  if (types.includes("evidence"))
    allowed.push(
      sql<SqlBool>`(d.record_type = 'evidence' AND ${scope.predicate({
        ...base,
        recordType: "evidence",
        partyUserIds: [ref("se.owner_user_id"), ref("se.created_by")],
      })})`,
    );

  let builder = db
    .selectFrom("search_document as d")
    .innerJoin("transformation as t", "t.id", "d.transformation_id")
    .leftJoin("benefit as sb", (j) => j.onRef("sb.id", "=", "d.record_id").on("d.record_type", "=", "benefit"))
    .leftJoin("business_case as sc", (j) =>
      j.onRef("sc.id", "=", "d.record_id").on("d.record_type", "=", "business_case"),
    )
    .leftJoin("evidence as se", (j) => j.onRef("se.id", "=", "d.record_id").on("d.record_type", "=", "evidence"))
    .select([
      "d.record_type",
      "d.record_id",
      "d.record_version",
      "d.transformation_id",
      "t.code as transformation_code",
      "t.name as transformation_name",
      "d.code",
      "d.title",
      "d.summary",
      "d.record_status",
      "d.is_archived",
      rank.as("rank"),
    ])
    .where("d.record_type", "in", [...types])
    .where(match)
    .where(sql<SqlBool>`(${sql.join(allowed, sql` OR `)})`);
  if (query.transformationId !== null) builder = builder.where("d.transformation_id", "=", query.transformationId);
  if (!query.includeArchived) builder = builder.where("d.is_archived", "=", false);
  if (after !== null) {
    const [r, t, id] = after;
    builder = builder.where(
      sql<SqlBool>`(${rank} < ${r}::bigint OR (${rank} = ${r}::bigint AND (d.record_type, d.record_id) > (${t}::text, ${id}::uuid)))`,
    );
  }
  const rows = await builder
    .orderBy(sql`rank`, "desc")
    .orderBy("d.record_type")
    .orderBy("d.record_id")
    .limit(query.limit + 1)
    .execute();

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      recordType: r.record_type as SearchRecordType,
      recordId: r.record_id,
      recordVersion: r.record_version,
      transformationId: r.transformation_id,
      transformationCode: r.transformation_code,
      transformationName: r.transformation_name,
      code: r.code,
      title: r.title,
      summary: r.summary,
      recordStatus: r.record_status,
      isArchived: r.is_archived,
    })),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeCursor([String(last.rank), last.record_type, last.record_id], hash)
        : null,
    ...freshness,
  };
}

/** One row of getSearchIndexStatus (ADR-0057 §2; no record data). */
export interface SearchIndexTypeStatus {
  readonly recordType: SearchRecordType;
  readonly status: "idle" | "reindexing" | "failed";
  readonly lastAuditSeq: string;
  readonly lastIncrementalAt: string | null;
  readonly reindexStartedAt: string | null;
  readonly reindexFinishedAt: string | null;
  /** null = Unknown, never 0 by default (ADR-0057 §11). */
  readonly documentsCount: number | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorAt: string | null;
  readonly version: number;
}

/** The 12 index states, in the ADR-0057 §1 order. */
export async function readSearchIndexStatus(db: Db): Promise<{ types: SearchIndexTypeStatus[] }> {
  const rows = await db.selectFrom("search_index_state").selectAll().execute();
  const order = (t: string) => (SEARCH_RECORD_TYPES as readonly string[]).indexOf(t);
  const isoN = (d: Date | null) => (d === null ? null : iso(d));
  return {
    types: rows
      .filter((r) => order(r.record_type) >= 0)
      .sort((a, b) => order(a.record_type) - order(b.record_type))
      .map((r) => ({
        recordType: r.record_type as SearchRecordType,
        status: r.status as SearchIndexTypeStatus["status"],
        lastAuditSeq: String(r.last_audit_seq),
        lastIncrementalAt: isoN(r.last_incremental_at),
        reindexStartedAt: isoN(r.reindex_started_at),
        reindexFinishedAt: isoN(r.reindex_finished_at),
        documentsCount: r.documents_count,
        lastErrorCode: r.last_error_code,
        lastErrorAt: isoN(r.last_error_at),
        version: r.version,
      })),
  };
}
