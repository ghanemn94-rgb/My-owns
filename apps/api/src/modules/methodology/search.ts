// Full-text search of the playbook (OpenAPI tag "methodology-reader"; ADR-0049 §3, §10-§11; REQ-S03-010;
// p5-work-split §I.2; T-DG5-BE-Q2):
//   GET /methodology/search?q=&lang=en|ar&phase=&transformationId=&cursor=&limit=   searchMethodology (session)
//
// - `q` is 2-200 characters after the free-text rules (no U+0000 or lone surrogate, visible content; counted in code
//   points after trimming); anything else is 400 validation.search_query, "Enter a search term of 2 to 200 characters."
// - `lang` picks the column: `search_en` (to_tsvector('english', text_en)) or `search_ar` (to_tsvector('arabic',
//   text_ar)), the stored generated tsvectors of 0089, each with its GIN index. Default: the caller's interface
//   language (app_user.preferred_locale; a service principal reads English).
// - The query is websearch_to_tsquery('<config>', q): quoted phrases, OR and -term work; no operator syntax can fail.
// - Results are ordered by ts_rank, then block_ref. The rank is not returned (it is not a business value); the cursor
//   carries its integer bucket (floor(rank * 1e6)) and the block_ref, so pages are stable and never overlap.
// - The snippet is ts_headline's plain-text excerpt with PRIVATE sentinel markers (U+E000/U+E001, never in the
//   source text: checked here, and the 165 blocks contain none) that this file turns into `highlights[{offset,
//   length}]` (UTF-16 code units) and strips. No HTML is ever produced; the web renders the marks.
// - With `transformationId` the caller needs transformation.read there (else 404, never disclosed), and the response
//   names that transformation's pinned methodology version; the verbatim text searched is the same for every version.
// Read-only: nothing here writes, launches or approves anything.
import { sql, type DbOrTx } from "@mth/db";
import { hasInvalidCharacter, hasText } from "@mth/shared/schemas";
import { uuid } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf, type Principal } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  limitSchema,
  paginate,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";
import type { ConfigResolver } from "./config-resolver.ts";
import { methodologyVersionRef, PHASE_CODES, readerContext } from "./reader.ts";

// ------------------------------------------------------------------------------------------------ zod mirrors

/** OpenAPI `SearchHighlight`: a match inside the snippet, in UTF-16 code units. */
export const searchHighlight = z.strictObject({
  offset: z.number().int().min(0),
  length: z.number().int().min(1),
});
/** OpenAPI `MethodologySearchHit` (plain text only, never HTML). */
export const methodologySearchHit = z.strictObject({
  blockRef: z.string().regex(/^B0[0-9]{3}$/),
  phaseCode: z.enum(PHASE_CODES).nullable(),
  sectionBlockRef: z.string().nullable(),
  lang: z.enum(["en", "ar"]),
  snippet: z.string(),
  highlights: z.array(searchHighlight).max(50),
});
/** OpenAPI `MethodologySearchPage`. */
export const methodologySearchPage = z.strictObject({
  items: z.array(methodologySearchHit),
  nextCursor: z.string().nullable(),
  methodologyVersion: methodologyVersionRef,
});

export type SearchHit = z.infer<typeof methodologySearchHit>;

// ------------------------------------------------------------------------------------------------ the query term

export const SEARCH_QUERY_DETAIL = "Enter a search term of 2 to 200 characters.";
const searchQueryInvalid = () => problems.badRequest("validation.search_query", SEARCH_QUERY_DETAIL, "/query/q");

/** The private sentinels around a match in ts_headline's output (Unicode private use area). */
export const START_SEL = "\uE000";
export const STOP_SEL = "\uE001";
const SENTINELS = /[\uE000\uE001]/;

/**
 * The search term after the free-text rules (ADR-0049 §3): a single string, no U+0000 or lone surrogate, visible
 * content, no private sentinel, and 2-200 code points once trimmed. Anything else is 400 validation.search_query.
 */
export function searchTerm(q: unknown): string {
  if (typeof q !== "string" || hasInvalidCharacter(q) || !hasText(q) || SENTINELS.test(q)) throw searchQueryInvalid();
  const term = q.trim();
  const length = [...term].length;
  if (length < 2 || length > 200) throw searchQueryInvalid();
  return term;
}

/**
 * Turns ts_headline output with the sentinels into a plain snippet and its highlights (UTF-16 offsets into the
 * snippet). Unbalanced or nested markers never produce a highlight; at most 50 are kept (the contract's maxItems).
 */
export function decodeHeadline(marked: string): { snippet: string; highlights: { offset: number; length: number }[] } {
  let snippet = "";
  const highlights: { offset: number; length: number }[] = [];
  let open: number | null = null;
  for (const ch of marked) {
    if (ch === START_SEL) {
      open = snippet.length;
    } else if (ch === STOP_SEL) {
      if (open !== null && snippet.length > open && highlights.length < 50)
        highlights.push({ offset: open, length: snippet.length - open });
      open = null;
    } else {
      snippet += ch;
    }
  }
  return { snippet, highlights };
}

// ------------------------------------------------------------------------------------------------ language

/** The caller's interface language: app_user.preferred_locale ('ar' | 'en'); English for a service principal. */
async function interfaceLanguage(db: DbOrTx, principal: Principal): Promise<"en" | "ar"> {
  if (principal.userId === null) return "en";
  const row = await db
    .selectFrom("app_user")
    .select("preferred_locale")
    .where("id", "=", principal.userId)
    .executeTakeFirst();
  return row?.preferred_locale === "en" ? "en" : "ar";
}

// ------------------------------------------------------------------------------------------------ route

const SEARCH = "/api/v1/methodology/search";
const searchQuery = z.strictObject({
  // q is checked by searchTerm (the §11 code), not by zod: a missing, repeated or out-of-range q is one refusal.
  q: z.unknown(),
  lang: z.enum(["en", "ar"]).optional(),
  phase: z.enum(PHASE_CODES).optional(),
  transformationId: uuid.optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});

/** ts_headline options: up to two fragments of up to 35 words, with the private sentinels (never HTML). */
const HEADLINE_OPTIONS = `StartSel=${START_SEL}, StopSel=${STOP_SEL}, MaxWords=35, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "`;

interface HitRow {
  readonly block_ref: string;
  readonly phase_code: string | null;
  readonly section_block_ref: string | null;
  /** The rank bucket as text (bigint); ordering and the cursor comparison use the bigint itself. */
  readonly bucket_text: string;
  readonly headline: string;
}

export function registerMethodologySearchRoutes(
  app: FastifyInstance,
  { db }: ModuleDeps,
  resolver: ConfigResolver,
): string[] {
  app.get(SEARCH, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const query = parseQuery(searchQuery, request.query);
    const term = searchTerm(query.q);
    const principal = principalOf(request);
    const ctx = await readerContext(db, principal, resolver, query.transformationId);
    const lang = query.lang ?? (await interfaceLanguage(db, principal));
    const hash = filterHash({
      q: term,
      lang,
      phase: query.phase,
      transformationId: query.transformationId,
      versionId: ctx.version.versionId,
    });
    const after = decodeCursor(query.cursor, hash, 2);
    const afterBucket = after === null ? null : String(after[0]);
    const afterRef = after === null ? null : String(after[1]);
    if (after !== null && (!/^[0-9]{1,19}$/.test(afterBucket ?? "") || !/^B0[0-9]{3}$/.test(afterRef ?? "")))
      throw problems.badRequest(
        "validation.cursor",
        "The cursor is invalid or belongs to other filters.",
        "/query/cursor",
      );

    // The config, column and text are chosen from two fixed literals by `lang` (never from input text).
    const config = lang === "ar" ? sql.lit("arabic") : sql.lit("english");
    const vector = lang === "ar" ? sql.ref("b.search_ar") : sql.ref("b.search_en");
    const text = lang === "ar" ? sql.ref("b.text_ar") : sql.ref("b.text_en");
    const rows = await sql<HitRow>`
      WITH q AS (SELECT websearch_to_tsquery(${config}::regconfig, ${term}) AS query),
      hits AS (
        SELECT b.block_ref, b.phase_code, b.section_block_ref, ${text} AS body,
               floor(ts_rank(${vector}, q.query) * 1000000)::bigint AS bucket, q.query
          FROM playbook_block b, q
         WHERE ${vector} @@ q.query
           AND (${query.phase ?? null}::text IS NULL OR b.phase_code = ${query.phase ?? null}::text)
      )
      SELECT h.block_ref, h.phase_code, h.section_block_ref, h.bucket::text AS bucket_text,
             ts_headline(${config}::regconfig, h.body, h.query, ${HEADLINE_OPTIONS}) AS headline
        FROM hits h
       WHERE ${afterBucket}::bigint IS NULL
          OR h.bucket < ${afterBucket}::bigint
          OR (h.bucket = ${afterBucket}::bigint AND h.block_ref > ${afterRef}::text)
       ORDER BY h.bucket DESC, h.block_ref
       LIMIT ${query.limit + 1}`.execute(db);
    const page = paginate(rows.rows, query.limit, (r) => [r.bucket_text, r.block_ref], hash);
    return {
      items: page.items.map((r): SearchHit => {
        const { snippet, highlights } = decodeHeadline(r.headline);
        return {
          blockRef: r.block_ref,
          phaseCode: PHASE_CODES.find((p) => p === r.phase_code) ?? null,
          sectionBlockRef: r.section_block_ref,
          lang,
          snippet,
          highlights,
        };
      }),
      nextCursor: page.nextCursor,
      methodologyVersion: ctx.version,
    };
  });
  return [`GET ${SEARCH}`];
}
