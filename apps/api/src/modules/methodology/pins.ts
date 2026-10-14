// Configuration pins of a transformation (OpenAPI tag "config-pins"; ADR-0039 §3, ADR-0040 §1; REQ-S06-008
// groundwork; T-DG5-BE-A):
//   GET /transformations/{transformationId}/config-pins           listTransformationConfigPins (methodology.read)
//   GET /transformations/{transformationId}/config-pins/history   listConfigPinHistory         (methodology.read)
// Scope is per transformation: methodology.read on the transformation (SP, TL, TO, AUD), or an organization-level
// methodology.read grant in its organization (ADM_METHOD, whose grant does not inherit downward; D-143 point 6); 404
// outside scope (existence never disclosed). A kind without a pin is shown as version 1 of its default key with
// `pinned: false` (never "the latest"); a kind that has no resolvable version yet (its ARCH task has seeded no
// version 1) is not listed. A pin moves only through an approved methodology migration (ADR-0040, BE-C); every move is
// one history row. Read-only: nothing here writes.
import { CONFIG_KINDS, type ConfigPin, type ConfigPinHistoryEntry } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authorize, denialOf, principalOf, type Principal } from "../access/index.ts";
import type { DbOrTx } from "@mth/db";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  problems,
  paginate,
  parse,
  parseQuery,
  type ModuleDeps,
} from "../platform/index.ts";
import { defaultVersionOf, loadPin } from "./config-resolver.ts";

const PINS = "/api/v1/transformations/:transformationId/config-pins";
const HISTORY = `${PINS}/history`;
const params = z.strictObject({ transformationId: z.uuid() });
const historyQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/**
 * Read gate of a transformation's pins: methodology.read on the transformation (SP, TL, TO, AUD through their scoped
 * grants), or an ORGANIZATION-level methodology.read grant in the transformation's organization. The second branch is
 * ADM_METHOD's (D-143 point 6): its grant does not inherit downward, and pins are configuration it administers. Denied
 * or missing -> 404 (existence never disclosed).
 */
async function requirePinRead(db: DbOrTx, principal: Principal, transformationId: string): Promise<void> {
  const d = await authorize(db, principal, "methodology.read", { type: "transformation", id: transformationId });
  if (d.target === null) throw problems.notFound();
  if (d.allowed) return;
  const orgId = d.target.organizationId;
  const orgLevel = principal.grants.some(
    (g) =>
      g.permissions.has("methodology.read") &&
      g.scopeType === "organization" &&
      g.scopeId === orgId &&
      g.organizationId === orgId,
  );
  if (!orgLevel) throw problems.notFound().withDenial(denialOf("methodology.read", d.target));
}

export function registerConfigPinRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "methodology.read" as const } };

  app.get(PINS, { config: read }, async (request) => {
    const { transformationId } = parse(params, request.params, "params");
    await requirePinRead(db, principalOf(request), transformationId);
    const items: ConfigPin[] = [];
    for (const kind of CONFIG_KINDS) {
      const pin = await loadPin(db, transformationId, kind);
      if (pin !== undefined) {
        items.push({
          kind,
          versionId: pin.versionId,
          key: pin.key,
          versionNo: pin.versionNo,
          pinned: true,
          lastMigrationId: pin.lastMigrationId,
          pinnedAt: iso(pin.pinnedAt),
          version: pin.version,
        });
        continue;
      }
      const fallback = await defaultVersionOf(db, kind);
      if (fallback === null) continue;
      items.push({
        kind,
        versionId: fallback.versionId,
        key: fallback.key,
        versionNo: fallback.versionNo,
        pinned: false,
        lastMigrationId: null,
        pinnedAt: null,
        version: null,
      });
    }
    return { items };
  });

  app.get(HISTORY, { config: read }, async (request) => {
    const { transformationId } = parse(params, request.params, "params");
    const query = parseQuery(historyQuery, request.query);
    await requirePinRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    // Newest first; ids are UUIDv7 (time-ordered).
    let q = db
      .selectFrom("transformation_config_pin_history")
      .selectAll()
      .where("transformation_id", "=", transformationId);
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    const items: ConfigPinHistoryEntry[] = page.items.map((r) => ({
      id: r.id,
      kind: r.kind,
      fromVersionId: r.from_version_id,
      toVersionId: r.to_version_id,
      migrationId: r.migration_id,
      pinVersion: r.pin_version,
      createdAt: iso(r.created_at),
      createdBy: r.created_by,
    }));
    return { items, nextCursor: page.nextCursor };
  });

  return [`GET ${PINS}`, `GET ${HISTORY}`];
}
