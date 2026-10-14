// The resolved elements of a Studio version (OpenAPI tag "studio"; ADR-0039 §2-§3; REQ-S06-004; T-DG5-BE-A):
//   GET /admin/methodology-versions/{versionId}/elements   listConfigElements (methodology.read)
// Each element is the catalogue value (the DG2-DG4 stable-identity registry) overridden by the version's own row,
// resolved through the ConfigResolver (config-resolver.ts). `playbook` v1 has no rows, so its elements are exactly the
// catalogue. Filtered by element type (default: every type of the version's kind, in the ADR-0039 §2 order); removed
// elements only with includeRemoved=true. Read-only: nothing here writes.
import { CONFIG_ELEMENT_TYPES, configElementType, configKind, type ConfigElementType } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  encodeCursor,
  filterHash,
  limitSchema,
  parse,
  parseQuery,
  type ModuleDeps,
} from "../platform/index.ts";
import type { ConfigResolver } from "./config-resolver.ts";
import { loadVersion, requireStudioPermission, versionParams, VERSIONS } from "./drafts.ts";
import { configKindProvider } from "./kinds.ts";

const ELEMENTS = `${VERSIONS}/:versionId/elements`;
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  elementType: configElementType.optional(),
  includeRemoved: z.stringbool().default(false),
});

export function registerConfigElementReadRoutes(
  app: FastifyInstance,
  { db }: ModuleDeps,
  resolver: ConfigResolver,
): string[] {
  app.get(ELEMENTS, { config: { access: { permission: "methodology.read" } } }, async (request) => {
    const { versionId } = parse(versionParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    requireStudioPermission(principalOf(request), "methodology.read");
    const version = await loadVersion(db, versionId);
    const accepted = configKindProvider(configKind.parse(version.config_kind)).elementTypes;
    const types: readonly ConfigElementType[] =
      query.elementType !== undefined
        ? accepted.includes(query.elementType)
          ? [query.elementType]
          : []
        : CONFIG_ELEMENT_TYPES.filter((t) => accepted.includes(t));
    const hash = filterHash({ versionId, elementType: query.elementType, includeRemoved: query.includeRemoved });
    const after = decodeCursor(query.cursor, hash, 1);
    const all = [];
    for (const t of types)
      all.push(...(await resolver.elements(db, versionId, t, { includeRemoved: query.includeRemoved })));
    // The resolved list is computed (catalogue + rows), so the cursor is the position in it, bound to the filters.
    const start = after === null ? 0 : Number(after[0]);
    if (!Number.isSafeInteger(start) || start < 0) return { items: [], nextCursor: null };
    const items = all.slice(start, start + query.limit);
    const next = start + query.limit;
    return { items, nextCursor: next < all.length ? encodeCursor([next], hash) : null };
  });
  return [`GET ${ELEMENTS}`];
}
