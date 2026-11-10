// Retrieval (ADR-0059 §4; REQ-S17-007 "The assistant retrieves only records the user may read"; REQ-S17-011 "no
// out-of-scope retrieval"; T-DG6-BE-U). For ONE message, once, before the model call, from the user's prompt only:
//   1. Records: one call of the scoped search query (search/query.ts, ADR-0057 §3, through search/index.ts) AS THE
//      CALLER'S PRINCIPAL, with the prompt's terms (the prompt reduced to at most 200 characters by truncateText), the
//      conversation's focus transformation when set, and limit = max_context_records. Every hit passed ReadScope for
//      `transformation.read` (the read permission of every record view) with the ADR-0051 §2 sensitivity clause, at
//      query time. An item's text is the hit's code, title, summary and status: search documents hold no money, rate,
//      KPI or FTE value (ADR-0057 §1).
//   2. Uploaded document text: for an `evidence` hit, the injected EvidenceTextPort (evidence/text-excerpt.ts) re-applies
//      the ADR-0051 §4 download authorization and returns at most the first 8,000 characters of a text/plain or
//      text/csv file of at most 256 KiB decoded as strict UTF-8. Other file types are not read in P6 (no extraction);
//      the answer then says so. `assistant` may not import `evidence` (architecture.test.ts), hence the port.
//   3. Playbook passages: at most 3 blocks through the injected PlaybookPassagePort (methodology/playbook-passages.ts);
//      the playbook is not record data and needs no scope. Fewer when records already fill the 20 citations a reply
//      can hold (0111 `p6_assistant_citations_valid`), so "every item given is cited" always fits.
//   4. No second pass: nothing in a record, a document or the model's output can request a retrieval; there is no
//      tool interface (§7). Text inside a document cannot widen what is read.
// No transaction is open here, and nothing is written. Nothing here logs record or document text (§9).
import { truncateText } from "@mth/shared/schemas";
import { holdsAnywhere, type Principal } from "../access/index.ts";
import { HttpProblem } from "../platform/index.ts";
import { SEARCH_RECORD_TYPES, searchRecords, type SearchHit } from "../search/index.ts";
import type { AnswerInput } from "./answer.ts";
import type { QuotedItem } from "./provider.ts";

// ------------------------------------------------------------------------------------------------ the injected ports

/** What the evidence port returns for one item: its text excerpt, or why it was not read. */
export type EvidenceExcerpt =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "not_read";
      /** file_type: not text/plain or text/csv (P6 reads no other type); the rest: nothing to read or not admitted. */
      readonly reason: "file_type" | "too_large" | "decoding" | "no_content" | "not_admitted";
    };

/**
 * ADR-0059 §4 item 2: read-only access to an evidence item's text, implemented by the evidence module
 * (evidence/text-excerpt.ts) and registered by the composition root (the D-197 injected-port precedent).
 */
export interface EvidenceTextPort {
  excerpt(principal: Principal, evidenceId: string): Promise<EvidenceExcerpt>;
}

/** One playbook block found for a prompt. */
export interface PlaybookPassage {
  readonly blockRef: string;
  readonly title: string;
  readonly text: string;
}

/**
 * ADR-0059 §4 item 3: the playbook blocks whose search vector (`search_en`, or `search_ar` for `ar`) matches the
 * terms, implemented by the methodology module (methodology/playbook-passages.ts) and registered by the composition
 * root. `terms` is a websearch query of the prompt's words joined by `or`.
 */
export interface PlaybookPassagePort {
  find(terms: string, locale: "en" | "ar", limit: number): Promise<readonly PlaybookPassage[]>;
}

let evidenceTextPort: EvidenceTextPort | null = null;
let playbookPassagePort: PlaybookPassagePort | null = null;

/** The composition line registers the evidence port here; returns the previous one (tests restore it). */
export function registerAssistantEvidenceTextPort(port: EvidenceTextPort | null): EvidenceTextPort | null {
  const previous = evidenceTextPort;
  evidenceTextPort = port;
  return previous;
}

/** The composition line registers the playbook port here; returns the previous one (tests restore it). */
export function registerAssistantPlaybookPassagePort(port: PlaybookPassagePort | null): PlaybookPassagePort | null {
  const previous = playbookPassagePort;
  playbookPassagePort = port;
  return previous;
}

// ------------------------------------------------------------------------------------------------ the query terms

/** ADR-0059 §4 item 1: the prompt is reduced to at most this many characters before its terms are taken. */
export const PROMPT_QUERY_MAX = 200;
/** At most this many distinct terms are searched. */
export const MAX_TERMS = 24;
/** ADR-0059 §4 item 3: at most 3 playbook passages. */
export const MAX_PASSAGES = 3;
/** 0111: a reply holds at most 20 citations; retrieval never gives more items than that. */
export const MAX_ITEMS = 20;
/** The playbook text given per passage (a block is at most 20,000 characters). */
export const PASSAGE_TEXT_MAX = 2000;

/**
 * Words that carry no subject in a question (English and Arabic; normalized forms). Without them, a question's
 * terms are its subject words, so `or` between them finds the records that share any of them, ranked by relevance.
 */
const STOP_WORDS = new Set(
  [
    ...["a", "an", "the", "of", "to", "in", "on", "for", "with", "about", "and", "or", "not", "no", "is", "are"],
    ...["was", "were", "be", "been", "do", "does", "did", "what", "which", "who", "whom", "when", "where", "why"],
    ...["how", "i", "me", "my", "we", "our", "you", "your", "it", "its", "this", "that", "these", "those", "there"],
    ...["any", "all", "from", "by", "as", "at", "can", "could", "would", "should", "will", "please", "tell", "show"],
    ...["give", "has", "have", "had", "summarize", "summarise", "explain", "list", "describe", "status"],
    ...["ما", "ماذا", "هل", "في", "من", "علي", "على", "الي", "إلى", "عن", "هو", "هي", "كيف", "لماذا", "متي", "متى"],
    ...["اين", "أين", "هذا", "هذه", "ذلك", "تلك", "مع", "او", "أو", "ثم", "كل", "اي", "أي", "لي", "ان", "أن", "إن"],
  ].map((w) => w.toLowerCase()),
);

/**
 * The search terms of a prompt: its words (letters and digits only, so no websearch operator or quote survives),
 * lower-cased, without stop words, at least 2 characters, distinct, joined by ` or `. Null when none is left.
 */
export function queryTerms(prompt: string): string | null {
  const words =
    truncateText(prompt, PROMPT_QUERY_MAX)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms: string[] = [];
  for (const w of words) {
    if (Array.from(w).length < 2 || STOP_WORDS.has(w) || terms.includes(w)) continue;
    terms.push(w);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms.length === 0 ? null : terms.join(" or ");
}

// ------------------------------------------------------------------------------------------------ retrieval

export interface RetrievalResult {
  /** The data block, refs 1..n, at most 20 items. */
  readonly items: QuotedItem[];
  /** True when an evidence file of another type was given by title only (the answer then says so, §4 item 2). */
  readonly unreadEvidenceFiles: boolean;
}

/** The text of a record item: the search document's columns, and for evidence the quoted excerpt. */
function recordText(hit: SearchHit, excerpt: string | null): string {
  const lines = [
    hit.code === null ? null : `code: ${hit.code}`,
    `title: ${hit.title}`,
    hit.recordStatus === null ? null : `status: ${hit.recordStatus}`,
    hit.summary === null ? null : `summary: ${hit.summary}`,
    excerpt === null ? null : `document text (quoted): ${excerpt}`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/** The records the caller may read that match the terms (one search call), or none. */
async function searchHits(input: AnswerInput, terms: string): Promise<SearchHit[]> {
  // The search's own rule: a caller without the read permission anywhere reads nothing.
  if (!holdsAnywhere(input.principal, "transformation.read")) return [];
  try {
    const page = await searchRecords(input.db, input.principal, {
      q: terms,
      recordTypes: SEARCH_RECORD_TYPES,
      transformationId: input.conversation.transformationId,
      includeArchived: false,
      cursor: undefined,
      limit: Math.min(input.setting.max_context_records, MAX_ITEMS),
    });
    return page.items;
  } catch (err) {
    // Every index type failed (503 search.index_unavailable): no record is given; the playbook still may be.
    if (err instanceof HttpProblem && err.status === 503) return [];
    throw err;
  }
}

/** ADR-0059 §4: one retrieval pass for one prompt, as the caller. */
export async function retrieve(input: AnswerInput): Promise<RetrievalResult> {
  const terms = queryTerms(input.prompt);
  if (terms === null) return { items: [], unreadEvidenceFiles: false };
  const hits = await searchHits(input, terms);
  const items: QuotedItem[] = [];
  let unreadEvidenceFiles = false;
  for (const hit of hits) {
    let excerpt: string | null = null;
    if (hit.recordType === "evidence") {
      const read = evidenceTextPort === null ? null : await evidenceTextPort.excerpt(input.principal, hit.recordId);
      if (read?.kind === "text") excerpt = read.text;
      else if (read?.kind === "not_read" && read.reason === "file_type") unreadEvidenceFiles = true;
    }
    items.push({
      ref: items.length + 1,
      citation: {
        source: "record",
        recordType: hit.recordType,
        recordId: hit.recordId,
        recordVersion: hit.recordVersion,
      },
      title: hit.title,
      text: recordText(hit, excerpt),
    });
  }
  const room = Math.min(MAX_PASSAGES, MAX_ITEMS - items.length);
  const passages =
    room > 0 && playbookPassagePort !== null ? await playbookPassagePort.find(terms, input.locale, room) : [];
  for (const p of passages.slice(0, room)) {
    items.push({
      ref: items.length + 1,
      citation: { source: "playbook", blockRef: p.blockRef, playbookVersion: "1.0" },
      title: p.title,
      text: truncateText(p.text, PASSAGE_TEXT_MAX),
    });
  }
  return { items, unreadEvidenceFiles };
}
