// Administration > Migration status: the read-only migration import, reconciliation and identity rebind views (P7 slice
// C; ADR-0064 §6, §8, §9; REQ-S19-014, REQ-S19-016). Route file created as a stub by T-DG7-BE-A; filled by T-DG7-BE-D
// (p7-work-split §C.2):
//   GET /admin/migration-imports                                                    listMigrationImports
//   GET /admin/migration-imports/:migrationImportId                                 getMigrationImport
//   GET /admin/migration-imports/:migrationImportId/reconciliations                 listMigrationReconciliations
//   GET /admin/migration-imports/:migrationImportId/reconciliations/:reconciliationId getMigrationReconciliation
//   GET /admin/identity-rebinds                                                     listIdentityRebinds
// Every operation needs migration_import.read (ADM_TECH, ADM_ACCESS, AUD) at organization scope (service.ts). There is
// no write: the import and the rebind are CLI-only and IT-run (mth-db), never an API operation. Reading them approves
// nothing (no G1-G6, Finance or IT approval) and never touches DG0-DG7.
import { sql } from "@mth/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../../access/index.ts";
import {
  keysetPage,
  pageQueryFields,
  parse,
  parseQuery,
  problems,
  type ModuleDeps,
  type SortKey,
} from "../../platform/index.ts";
import type { P7RouteGuard } from "../guards.ts";
import {
  findImport,
  findReconciliation,
  identityRebindPage,
  migrationImportPage,
  migrationImportView,
  presentHolds,
  presentImport,
  presentReconciliationSummary,
  reconciliationPage,
  requireImportReadRight,
  type HoldRow,
} from "./service.ts";

/** The route guard of every migration-import operation (docs/api/openapi.yaml, tag `transfer`; ADR-0064 §9). */
export const MIGRATION_IMPORT_ROUTE_GUARDS = {
  listMigrationImports: {
    method: "GET",
    path: "/api/v1/admin/migration-imports",
    permission: "migration_import.read",
  },
  getMigrationImport: {
    method: "GET",
    path: "/api/v1/admin/migration-imports/:migrationImportId",
    permission: "migration_import.read",
  },
  listMigrationReconciliations: {
    method: "GET",
    path: "/api/v1/admin/migration-imports/:migrationImportId/reconciliations",
    permission: "migration_import.read",
  },
  getMigrationReconciliation: {
    method: "GET",
    path: "/api/v1/admin/migration-imports/:migrationImportId/reconciliations/:migrationReconciliationId",
    permission: "migration_import.read",
  },
  listIdentityRebinds: { method: "GET", path: "/api/v1/admin/identity-rebinds", permission: "migration_import.read" },
} as const satisfies Record<string, P7RouteGuard>;

const G = MIGRATION_IMPORT_ROUTE_GUARDS;
const importParams = z.strictObject({ migrationImportId: z.uuid() });
const reconciliationParams = z.strictObject({ migrationImportId: z.uuid(), migrationReconciliationId: z.uuid() });
const listQuery = z.strictObject({ ...pageQueryFields });
const rebindQuery = z.strictObject({
  ...pageQueryFields,
  state: z.enum(["unbound", "rebound", "retained"]).optional(),
});
const noQuery = z.strictObject({});
/** Newest first, id as the tiebreak (the contract's order). */
const IMPORT_SORT: readonly SortKey[] = [
  { name: "imported_at", type: "timestamptz", desc: true },
  { name: "id", type: "uuid", desc: true },
];
const RECONCILIATION_SORT: readonly SortKey[] = [
  { name: "run_at", type: "timestamptz", desc: true },
  { name: "id", type: "uuid", desc: true },
];
/** Holds in creation order (uuid v7 ids). */
const HOLD_SORT: readonly SortKey[] = [{ name: "hold_id", type: "uuid", expr: sql`h.id` }];

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerMigrationImportRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const access = { access: { permission: "migration_import.read" as const } };

  app.get(G.listMigrationImports.path, { config: access }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireImportReadRight(deps.db, principalOf(request));
    const page = await keysetPage(deps.db.selectFrom("migration_import").selectAll(), IMPORT_SORT, query, {
      list: "migration-imports",
    });
    const items = [];
    for (const row of page.items) items.push(await presentImport(deps.db, row));
    return migrationImportPage.parse({ items, nextCursor: page.nextCursor });
  });

  app.get(G.getMigrationImport.path, { config: access }, async (request) => {
    parseQuery(noQuery, request.query);
    const { migrationImportId } = parse(importParams, request.params, "params");
    await requireImportReadRight(deps.db, principalOf(request));
    const row = await findImport(deps.db, migrationImportId);
    if (row === undefined) throw problems.notFound();
    return migrationImportView.parse(await presentImport(deps.db, row));
  });

  app.get(G.listMigrationReconciliations.path, { config: access }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const { migrationImportId } = parse(importParams, request.params, "params");
    await requireImportReadRight(deps.db, principalOf(request));
    if ((await findImport(deps.db, migrationImportId)) === undefined) throw problems.notFound();
    const page = await keysetPage(
      deps.db.selectFrom("migration_reconciliation").selectAll().where("migration_import_id", "=", migrationImportId),
      RECONCILIATION_SORT,
      query,
      { list: "migration-reconciliations", migrationImportId },
    );
    return reconciliationPage.parse({
      items: page.items.map(presentReconciliationSummary),
      nextCursor: page.nextCursor,
    });
  });

  app.get(G.getMigrationReconciliation.path, { config: access }, async (request) => {
    parseQuery(noQuery, request.query);
    const { migrationImportId, migrationReconciliationId } = parse(reconciliationParams, request.params, "params");
    await requireImportReadRight(deps.db, principalOf(request));
    const report = await findReconciliation(deps.db, migrationImportId, migrationReconciliationId);
    if (report === undefined) throw problems.notFound();
    return report;
  });

  app.get(G.listIdentityRebinds.path, { config: access }, async (request) => {
    const query = parseQuery(rebindQuery, request.query);
    await requireImportReadRight(deps.db, principalOf(request));
    let q = deps.db
      .selectFrom("identity_binding_hold as h")
      .innerJoin("app_user as u", "u.id", "h.user_id")
      .leftJoin("identity_rebind_event as e", "e.identity_binding_hold_id", "h.id")
      .select([
        "h.id",
        "h.user_id",
        "u.display_name",
        "h.migration_import_id",
        "h.state",
        "h.operator_name",
        "h.resolved_at",
        "h.version",
        "e.old_issuer",
        "e.old_subject",
        "e.new_issuer",
        "e.new_subject",
      ]);
    if (query.state !== undefined) q = q.where("h.state", "=", query.state);
    const page = await keysetPage(q, HOLD_SORT, query, { list: "identity-rebinds", state: query.state ?? null });
    return identityRebindPage.parse({
      items: await presentHolds(deps.db, page.items as HoldRow[]),
      nextCursor: page.nextCursor,
    });
  });

  return Object.values(G).map((g) => `${g.method} ${g.path}`);
}
