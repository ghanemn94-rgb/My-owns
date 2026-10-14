// Critical dependency slips (OpenAPI tag `dependency-slips`; ADR-0044 §7, §9; REQ-S12-012; p5-work-split §E.1;
// T-DG5-BE-J):
//   GET /transformations/{transformationId}/dependency-slips   listDependencySlips (transformation.read in scope)
//
// Read-only, newest first, cursor-paginated. Each slip names its dependency, the predecessor finish before and after,
// the slip in calendar days, its needed-by date, why it is critical, and each affected initiative with its owner and
// its forecast finish before and after, computed by the DG4 scheduling logic at detection (null = Unknown, never 0).
// The rows are written by the milestone writes (slip-events.ts); nothing here changes anything. A transformation
// outside the reader's scope is 404 (existence not disclosed); AUD reads.
import { sql } from "@mth/db";
import type { DependencySlip, DependencySlipAffected } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parse,
  parseQuery,
  type ModuleDeps,
} from "../platform/index.ts";

export const DEPENDENCY_SLIPS = "/api/v1/transformations/:transformationId/dependency-slips";
const params = z.strictObject({ transformationId: z.uuid() });
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

const nullableText = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The stored `affected` entries, re-shaped field by field (unknown keys dropped; a missing value is null). */
function presentAffected(raw: unknown): DependencySlipAffected[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown) => {
    if (entry === null || typeof entry !== "object") return [];
    const m = new Map(Object.entries(entry as Record<string, unknown>));
    const initiativeId = m.get("initiativeId");
    const initiativeCode = m.get("initiativeCode");
    if (typeof initiativeId !== "string" || typeof initiativeCode !== "string") return [];
    return [
      {
        initiativeId,
        initiativeCode,
        ownerUserId: nullableText(m.get("ownerUserId")),
        forecastFinishBefore: nullableText(m.get("forecastFinishBefore")),
        forecastFinishAfter: nullableText(m.get("forecastFinishAfter")),
      },
    ];
  });
}

/** Registers the route and returns it as "METHOD /path" (portfolio/index.ts). */
export function registerDependencySlipRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  app.get(DEPENDENCY_SLIPS, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(params, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db
      .selectFrom("dependency_slip as s")
      .innerJoin("dependency as d", "d.id", "s.dependency_id")
      .select([
        "s.id",
        "s.dependency_id",
        "d.code as dependency_code",
        sql<string>`s.predecessor_finish_before::text`.as("before"),
        sql<string>`s.predecessor_finish_after::text`.as("after"),
        "s.slip_days",
        sql<string | null>`s.needed_by::text`.as("needed_by"),
        "s.critical_reason",
        "s.affected",
        "s.created_at",
        sql<string>`to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("created_key"),
      ])
      .where("s.transformation_id", "=", transformationId);
    if (after)
      q = q.where(sql<boolean>`(s.created_at, s.id) < (${String(after[0])}::timestamptz, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("s.created_at", "desc")
      .orderBy("s.id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.created_key, r.id], hash);
    return {
      items: page.items.map(
        (r): DependencySlip => ({
          id: r.id,
          dependencyId: r.dependency_id,
          dependencyCode: r.dependency_code,
          predecessorFinishBefore: r.before,
          predecessorFinishAfter: r.after,
          slipDays: r.slip_days,
          neededBy: r.needed_by,
          criticalReason: r.critical_reason as DependencySlip["criticalReason"],
          affected: presentAffected(r.affected),
          createdAt: iso(r.created_at),
        }),
      ),
      nextCursor: page.nextCursor,
    };
  });
  return [`GET ${DEPENDENCY_SLIPS}`];
}
