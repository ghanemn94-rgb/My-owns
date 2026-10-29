// Global scoped search and the index status (P6 slice H; ADR-0057 §2, §3, §10; REQ-S15-010; T-DG6-BE-P2). Route file
// created as a stub by T-DG6-BE-A with its registration line; the query is query.ts.
//   GET /api/v1/search               searchRecords         (per hit: transformation.read through ReadScope; class search)
//   GET /api/v1/admin/search/index   getSearchIndexStatus  (operations.read, ADR-0053; no record data)
// Both are reads: no audit event, no write. A reindex is started through the P5 runJobNow (job code search.reindex,
// job.repair); no operation here starts one. Searching approves nothing (G1-G6) and never touches DG0-DG7.
import { freeText, uuid } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authorize, holdsAnywhere, organizationsWith, principalOf } from "../access/index.ts";
import { cursorSchema, limitSchema, parseQuery, problems, rateLimitClass, type ModuleDeps } from "../platform/index.ts";
import {
  normalizedQuery,
  readSearchIndexStatus,
  SEARCH_QUERY_MAX,
  SEARCH_READ_PERMISSION,
  SEARCH_RECORD_TYPES,
  searchRecords,
} from "./query.ts";

const SEARCH = "/api/v1/search";
const INDEX_STATUS = "/api/v1/admin/search/index";
const OPERATIONS_READ = "operations.read" as const;

const recordTypeList = z
  .union([z.enum(SEARCH_RECORD_TYPES), z.array(z.enum(SEARCH_RECORD_TYPES)).min(1).max(12)])
  .transform((v) => (Array.isArray(v) ? [...new Set(v)] : [v]));
// ADR-0052 §2: the query string is decoded as strict UTF-8 by the platform; `q` follows the shared free-text rules
// (U+0000 and lone surrogates refused, blank refused), then 2-200 characters after trimming (query.ts).
const searchQuery = z.strictObject({
  q: freeText(1, SEARCH_QUERY_MAX),
  recordType: recordTypeList.optional(),
  transformationId: uuid.optional(),
  includeArchived: z.stringbool().default(false),
  cursor: cursorSchema,
  limit: limitSchema,
});
const noQuery = z.strictObject({});

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerSearchRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // searchRecords: 400 (query, cursor) before 403 (no transformation.read anywhere); then 503 when every requested
  // type's index failed; otherwise the caller's admitted hits only.
  app.get(
    SEARCH,
    { config: { access: { permission: SEARCH_READ_PERMISSION }, ...rateLimitClass("search") } },
    async (request) => {
      const query = parseQuery(searchQuery, request.query);
      const q = normalizedQuery(query.q);
      const principal = principalOf(request);
      if (!holdsAnywhere(principal, SEARCH_READ_PERMISSION)) throw problems.forbidden();
      return searchRecords(db, principal, {
        q,
        recordTypes: query.recordType ?? [...SEARCH_RECORD_TYPES],
        transformationId: query.transformationId ?? null,
        includeArchived: query.includeArchived,
        cursor: query.cursor,
        limit: query.limit,
      });
    },
  );

  // getSearchIndexStatus: an organization-level operations.read holder in some organization (platform telemetry, as
  // getWorkerHeartbeat; the state holds no record data).
  app.get(INDEX_STATUS, { config: { access: { permission: OPERATIONS_READ } } }, async (request) => {
    parseQuery(noQuery, request.query);
    const principal = principalOf(request);
    let allowed = false;
    for (const organizationId of organizationsWith(principal, OPERATIONS_READ))
      if ((await authorize(db, principal, OPERATIONS_READ, { type: "organization", id: organizationId })).allowed) {
        allowed = true;
        break;
      }
    if (!allowed) throw problems.forbidden();
    return readSearchIndexStatus(db);
  });

  return [`GET ${SEARCH}`, `GET ${INDEX_STATUS}`];
}
