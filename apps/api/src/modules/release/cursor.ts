// The opaque cursor of listRequirements (ADR-0071 §3; p7-work-split §I.1; the contract's Cursor parameter rule):
// base64url of `{ after, filtersHash }`. `after` is the last reqId of the previous page; `filtersHash` binds the cursor
// to the filters it was issued for, so reusing it with other filters (or a cursor that does not decode) is a 400
// `validation.cursor`, never a silently different page.
import { filterHash, problems } from "../platform/index.ts";

export interface RequirementFilters {
  readonly class?: string | undefined;
  readonly status?: string | undefined;
  readonly area?: string | undefined;
  readonly finalGate?: string | undefined;
}

/** The hash of the filters that define the result set (cursor and limit excluded). */
export function requirementFiltersHash(filters: RequirementFilters): string {
  return filterHash({
    class: filters.class,
    status: filters.status,
    area: filters.area,
    finalGate: filters.finalGate,
  });
}

export function encodeRequirementCursor(after: string, filtersHash: string): string {
  return Buffer.from(JSON.stringify({ after, filtersHash }), "utf8").toString("base64url");
}

const invalid = () =>
  problems.badRequest("validation.cursor", "The cursor is invalid or belongs to other filters.", "/query/cursor");

/** Decodes a cursor issued for `filtersHash`; returns the reqId to continue after, or null without a cursor. */
export function decodeRequirementCursor(cursor: string | undefined, filtersHash: string): string | null {
  if (cursor === undefined) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid();
  const { after, filtersHash: hash, ...rest } = parsed as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof after !== "string" || after.length > 16 || hash !== filtersHash)
    throw invalid();
  return after;
}
