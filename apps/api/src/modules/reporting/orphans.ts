// Orphan report (P4 slice K; ADR-0038 §5; T-DG4-BE-M; REQ-PB-044 "an initiative without a TOM gap appears in the
// orphan report"):
//   GET /transformations/{t}/orphans[?recordType&missing&cursor&limit]   (transformation.read)
//
// Every active record of the chain that misses an upstream or downstream link is listed with `missing` (upstream,
// downstream or both) and `expected`, the missing step(s) (e.g. "tom_gap → initiative"). Drafts are work in progress
// and never orphans. The report reads `traceability_edge` and the record tables only, in one read-only transaction,
// and stores nothing (JK.10 item 2). Filters: `recordType`; `missing=upstream` lists records missing an upstream link
// (including those missing both), `missing=downstream` likewise, `missing=both` only those missing both.
import { traceDirection, traceNodeType, type OrphanItem } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  limitSchema,
  paginate,
  parse,
  parseQuery,
  type ModuleDeps,
} from "../platform/index.ts";
import { hrefOf, indexEdges, loadChainRecords, loadEdges, nodeOrder, orphanFlagsOf, readOnly } from "./traceability.ts";

const PATH = "/api/v1/transformations/:transformationId/orphans";
const tParams = z.strictObject({ transformationId: z.uuid() });
const orphanQuery = z.strictObject({
  recordType: traceNodeType.optional(),
  missing: traceDirection.optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});

/** Every orphan of one transformation, in chain order then id (pure over the loaded records and edges). */
export async function loadOrphans(
  db: Parameters<typeof loadChainRecords>[0],
  transformationId: string,
): Promise<(OrphanItem & { order: number })[]> {
  const records = await loadChainRecords(db, transformationId);
  const index = indexEdges(await loadEdges(db, transformationId));
  const items: (OrphanItem & { order: number })[] = [];
  for (const rec of records.values()) {
    const flags = orphanFlagsOf(rec, index.incoming.get(rec.id) ?? [], index.outgoing.get(rec.id) ?? []);
    if (!flags.upstream && !flags.downstream) continue;
    items.push({
      recordType: rec.type,
      recordId: rec.id,
      code: rec.code,
      label: rec.label,
      href: hrefOf(rec.type, transformationId, rec.id),
      missing: flags.upstream && flags.downstream ? "both" : flags.upstream ? "upstream" : "downstream",
      expected: [...flags.expected],
      order: nodeOrder(rec.type),
    });
  }
  return items.sort((a, b) => a.order - b.order || (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0));
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerOrphanRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(PATH, { config: { access: { permission: "transformation.read" as const } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(orphanQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      report: "orphans",
      transformationId,
      recordType: query.recordType,
      missing: query.missing,
    });
    const after = decodeCursor(query.cursor, hash, 2);
    const all = await readOnly(db, (tx) => loadOrphans(tx, transformationId));
    const filtered = all.filter(
      (i) =>
        (query.recordType === undefined || i.recordType === query.recordType) &&
        (query.missing === undefined ||
          i.missing === "both" ||
          (query.missing !== "both" && i.missing === query.missing)),
    );
    const rest =
      after === null
        ? filtered
        : filtered.filter(
            (i) => i.order > Number(after[0]) || (i.order === Number(after[0]) && i.recordId > String(after[1])),
          );
    const page = paginate(rest.slice(0, query.limit + 1), query.limit, (i) => [i.order, i.recordId], hash);
    return { items: page.items.map(({ order: _order, ...item }) => item), nextCursor: page.nextCursor };
  });
  return [`GET ${PATH}`];
}
