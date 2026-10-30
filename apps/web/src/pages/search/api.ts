// Global search (T-DG6-FE-D; ADR-0057 §3; REQ-S15-010 "Search returns only records the user may read"): the client of
// `searchRecords` GET /api/v1/search. The server filters every hit through ReadScope at query time; the client never
// filters, caches a scope or guesses a hit. `stale` and `indexedThrough` drive the stale state (ADR-0057 §2).
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { shouldRetry } from "../../api/queries.ts";

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

/** `SearchHit` of the contract. */
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

/** `SearchResultPage` of the contract. */
export interface SearchResultPage {
  readonly items: readonly SearchHit[];
  readonly nextCursor: string | null;
  readonly indexedThrough: string | null;
  readonly stale: boolean;
}

export interface SearchParams {
  readonly q: string;
  readonly recordType: readonly SearchRecordType[];
  readonly transformationId: string | null;
  readonly includeArchived: boolean;
  readonly cursor: string | null;
  readonly limit: number;
}

/** The query's minimum length after trimming (ADR-0057 §3; 400 `search.query_too_short` otherwise). */
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 200;

export function useSearch(params: SearchParams) {
  const q = params.q.trim();
  return useQuery({
    queryKey: ["search", { ...params, q }],
    queryFn: ({ signal }) =>
      api.get<SearchResultPage>(
        "/api/v1/search",
        {
          q,
          recordType: params.recordType,
          transformationId: params.transformationId,
          includeArchived: params.includeArchived ? "true" : null,
          cursor: params.cursor,
          limit: params.limit,
        },
        signal,
      ),
    enabled: q.length >= SEARCH_MIN_LENGTH,
    retry: shouldRetry,
    placeholderData: keepPreviousData,
  });
}

/** Where a hit opens: the record's own page where it has one, otherwise its register in the transformation. */
export function hitPath(hit: SearchHit): string {
  const base = `/transformations/${hit.transformationId}`;
  switch (hit.recordType) {
    case "transformation":
      return base;
    case "initiative":
      return `${base}/initiatives/${hit.recordId}`;
    case "kpi_definition":
      return `${base}/kpis/${hit.recordId}`;
    case "benefit":
      return `${base}/benefits/${hit.recordId}`;
    case "business_case":
      return `${base}/business-cases/${hit.recordId}`;
    case "change_request":
      return `${base}/change-requests/${hit.recordId}`;
    case "raid_entry":
      return `${base}/raid`;
    case "dependency":
      return `${base}/dependencies`;
    case "decision":
      return `${base}/decisions`;
    case "deliverable":
      return `${base}/portfolio`;
    case "evidence":
      return `${base}/evidence`;
    case "lesson":
      return `${base}/lessons`;
  }
}
