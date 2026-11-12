// Administration > Configuration transfer: configuration bundles exported and imported AS DRAFTS through the existing
// review and publish pipeline (P7 slice D; ADR-0065; REQ-S19-008). Route file created as a stub by T-DG7-BE-A; filled by
// T-DG7-BE-F (p7-work-split §D.1):
//   GET  /admin/config-bundles/exports                                   listConfigBundleExports     (config_bundle.export)
//   POST /admin/config-bundles/exports                                   createConfigBundleExport    (config_bundle.export)
//   GET  /admin/config-bundles/exports/:configBundleExportId             getConfigBundleExport       (config_bundle.export)
//   GET  /admin/config-bundles/exports/:configBundleExportId/download    downloadConfigBundleExport  (config_bundle.export)
//   GET  /admin/config-bundles/imports                                   listConfigBundleImports     (config_bundle.import)
//   POST /admin/config-bundles/imports                                   uploadConfigBundleImport    (config_bundle.import)
//   GET  /admin/config-bundles/imports/:configBundleImportId             getConfigBundleImport       (config_bundle.import)
//   POST /admin/config-bundles/imports/:configBundleImportId/validate    validateConfigBundleImport  (If-Match)
//   POST /admin/config-bundles/imports/:configBundleImportId/commit      commitConfigBundleImport    (If-Match)
// The commit also needs each written kind's OWN configure right, checked by that kind's adapter (ADR-0065 §8):
// config_bundle.import alone never lets a user write a kind they could not write by hand. An import never publishes and
// approves nothing (no G1-G6, Finance or IT approval); nothing here reads or writes DG0-DG7.
import { BUNDLE_MAX_BYTES, configBundleEnvelope } from "@mth/shared/transfer";
import { freeText } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { principalOf } from "../../access/index.ts";
import {
  keysetPage,
  pageQueryFields,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
  type SortKey,
} from "../../platform/index.ts";
import type { P7RouteGuard } from "../guards.ts";
import { configBundleAdapters, type ConfigBundleAdapterRegistry } from "./registry.ts";
import {
  checkBundle,
  commitImport,
  configBundleExportCreate,
  configBundleExportPage,
  configBundleImportPage,
  configBundleRefusals,
  CONFIG_BUNDLE_EXPORT,
  CONFIG_BUNDLE_IMPORT,
  createExport,
  filesystemBundleStore,
  findExport,
  findImport,
  presentExport,
  presentImport,
  readExportBytes,
  readImportItems,
  requireRightAt,
  requireSomeRight,
  uploadImport,
  validateImport,
  type BundleStore,
} from "./service.ts";

/** The route guard of every configuration-bundle operation (docs/api/openapi.yaml, tag `transfer`; ADR-0065 §8). */
export const CONFIG_BUNDLE_ROUTE_GUARDS = {
  listConfigBundleExports: {
    method: "GET",
    path: "/api/v1/admin/config-bundles/exports",
    permission: "config_bundle.export",
  },
  createConfigBundleExport: {
    method: "POST",
    path: "/api/v1/admin/config-bundles/exports",
    permission: "config_bundle.export",
  },
  getConfigBundleExport: {
    method: "GET",
    path: "/api/v1/admin/config-bundles/exports/:configBundleExportId",
    permission: "config_bundle.export",
  },
  downloadConfigBundleExport: {
    method: "GET",
    path: "/api/v1/admin/config-bundles/exports/:configBundleExportId/download",
    permission: "config_bundle.export",
  },
  listConfigBundleImports: {
    method: "GET",
    path: "/api/v1/admin/config-bundles/imports",
    permission: "config_bundle.import",
  },
  uploadConfigBundleImport: {
    method: "POST",
    path: "/api/v1/admin/config-bundles/imports",
    permission: "config_bundle.import",
  },
  getConfigBundleImport: {
    method: "GET",
    path: "/api/v1/admin/config-bundles/imports/:configBundleImportId",
    permission: "config_bundle.import",
  },
  validateConfigBundleImport: {
    method: "POST",
    path: "/api/v1/admin/config-bundles/imports/:configBundleImportId/validate",
    permission: "config_bundle.import",
  },
  commitConfigBundleImport: {
    method: "POST",
    path: "/api/v1/admin/config-bundles/imports/:configBundleImportId/commit",
    permission: "config_bundle.import",
  },
} as const satisfies Record<string, P7RouteGuard>;

const G = CONFIG_BUNDLE_ROUTE_GUARDS;
const JSON_BODY = ["application/json"] as const;
const orgQuery = z.strictObject({ organizationId: z.uuid() });
const listQuery = z.strictObject({ organizationId: z.uuid(), ...pageQueryFields });
const noQuery = z.strictObject({});
const exportParams = z.strictObject({ configBundleExportId: z.uuid() });
const importParams = z.strictObject({ configBundleImportId: z.uuid() });
const fileNameHeader = z.object({ "x-file-name": freeText(1, 255) }).passthrough();
const NEWEST_FIRST: readonly SortKey[] = [
  { name: "created_at", type: "timestamptz", desc: true },
  { name: "id", type: "uuid", desc: true },
];

export interface ConfigBundleRouteOptions {
  readonly store?: BundleStore;
  readonly registry?: () => ConfigBundleAdapterRegistry;
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerConfigBundleRoutes(
  app: FastifyInstance,
  deps: ModuleDeps,
  options: ConfigBundleRouteOptions = {},
): string[] {
  // Lazy: the module test registers with empty deps.
  const store = options.store ?? filesystemBundleStore(() => deps.config.evidenceStorage.path);
  const registry = options.registry ?? configBundleAdapters;
  const exportAccess = { access: { permission: CONFIG_BUNDLE_EXPORT } };
  const importAccess = { access: { permission: CONFIG_BUNDLE_IMPORT } };

  // ---------------------------------------------------------------------------------------------- exports
  app.get(G.listConfigBundleExports.path, { config: exportAccess }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    requireSomeRight(principal, CONFIG_BUNDLE_EXPORT);
    await requireRightAt(deps.db, principal, CONFIG_BUNDLE_EXPORT, query.organizationId);
    const page = await keysetPage(
      deps.db.selectFrom("config_bundle_export").selectAll().where("organization_id", "=", query.organizationId),
      NEWEST_FIRST,
      query,
      { list: "config-bundle-exports", organizationId: query.organizationId },
    );
    return configBundleExportPage.parse({ items: page.items.map(presentExport), nextCursor: page.nextCursor });
  });

  app.post(
    G.createConfigBundleExport.path,
    { config: { ...exportAccess, consumes: JSON_BODY } },
    async (request, reply) => {
      const { organizationId } = parseQuery(orgQuery, request.query);
      const principal = principalOf(request);
      requireSomeRight(principal, CONFIG_BUNDLE_EXPORT);
      await requireRightAt(deps.db, principal, CONFIG_BUNDLE_EXPORT, organizationId);
      const body = parseBody(configBundleExportCreate, request.body);
      const row = await createExport(deps.db, registry(), store, request, organizationId, body);
      return reply
        .code(201)
        .header("Location", `${G.createConfigBundleExport.path}/${row.id}`)
        .send(presentExport(row));
    },
  );

  app.get(G.getConfigBundleExport.path, { config: exportAccess }, async (request) => {
    parseQuery(noQuery, request.query);
    const { configBundleExportId } = parse(exportParams, request.params, "params");
    const principal = principalOf(request);
    requireSomeRight(principal, CONFIG_BUNDLE_EXPORT);
    const row = await findExport(deps.db, configBundleExportId);
    if (row === undefined) throw problems.notFound();
    await requireRightAt(deps.db, principal, CONFIG_BUNDLE_EXPORT, row.organization_id);
    return presentExport(row);
  });

  app.get(G.downloadConfigBundleExport.path, { config: exportAccess }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    const { configBundleExportId } = parse(exportParams, request.params, "params");
    const principal = principalOf(request);
    requireSomeRight(principal, CONFIG_BUNDLE_EXPORT);
    const row = await findExport(deps.db, configBundleExportId);
    if (row === undefined) throw problems.notFound();
    await requireRightAt(deps.db, principal, CONFIG_BUNDLE_EXPORT, row.organization_id);
    const bytes = await readExportBytes(store, row);
    return reply
      .code(200)
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="config-bundle-${row.id}.json"`)
      .header("ETag", `"${row.sha256}"`)
      .header("Cache-Control", "no-store")
      .send(Buffer.from(bytes));
  });

  // ---------------------------------------------------------------------------------------------- imports
  app.get(G.listConfigBundleImports.path, { config: importAccess }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    requireSomeRight(principal, CONFIG_BUNDLE_IMPORT);
    await requireRightAt(deps.db, principal, CONFIG_BUNDLE_IMPORT, query.organizationId);
    const page = await keysetPage(
      deps.db.selectFrom("config_bundle_import").selectAll().where("organization_id", "=", query.organizationId),
      NEWEST_FIRST,
      query,
      { list: "config-bundle-imports", organizationId: query.organizationId },
    );
    const items = [];
    for (const r of page.items) items.push(await presentImport(deps.db, r));
    return configBundleImportPage.parse({ items, nextCursor: page.nextCursor });
  });

  app.post(
    G.uploadConfigBundleImport.path,
    {
      config: { ...importAccess, consumes: JSON_BODY },
      // 5 MiB: a declared larger body is refused before it is read, and a streamed one that passes the limit is mapped
      // from Fastify's generic body-too-large error, so both are 413 config_bundle.too_large (never a generic 400).
      bodyLimit: BUNDLE_MAX_BYTES,
      preParsing: (request, _reply, payload, done) => {
        const declared = Number(request.headers["content-length"] ?? "0");
        if (Number.isFinite(declared) && declared > BUNDLE_MAX_BYTES) done(configBundleRefusals.tooLarge());
        else done(null, payload);
      },
      errorHandler: (error) => {
        throw (error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE"
          ? configBundleRefusals.tooLarge()
          : error;
      },
    },
    async (request, reply) => {
      const { organizationId } = parseQuery(orgQuery, request.query);
      const principal = principalOf(request);
      requireSomeRight(principal, CONFIG_BUNDLE_IMPORT);
      await requireRightAt(deps.db, principal, CONFIG_BUNDLE_IMPORT, organizationId);
      const fileName = parse(fileNameHeader, request.headers, "header")["x-file-name"];
      const { bundle, bytes } = checkBundle(registry(), request.body, (b) => parseBody(configBundleEnvelope, b));
      const row = await uploadImport(deps.db, store, request, organizationId, fileName, bytes, bundle);
      return sendVersioned(
        reply,
        201,
        await presentImport(deps.db, row),
        `${G.uploadConfigBundleImport.path}/${row.id}`,
      );
    },
  );

  app.get(G.getConfigBundleImport.path, { config: importAccess }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    const { configBundleImportId } = parse(importParams, request.params, "params");
    const principal = principalOf(request);
    requireSomeRight(principal, CONFIG_BUNDLE_IMPORT);
    const row = await findImport(deps.db, configBundleImportId);
    if (row === undefined) throw problems.notFound();
    await requireRightAt(deps.db, principal, CONFIG_BUNDLE_IMPORT, row.organization_id);
    return sendVersioned(reply, 200, await presentImport(deps.db, row));
  });

  const step = (kind: "validate" | "commit") => async (request: FastifyRequest) => {
    parseQuery(noQuery, request.query);
    const { configBundleImportId } = parse(importParams, request.params, "params");
    const principal = principalOf(request);
    requireSomeRight(principal, CONFIG_BUNDLE_IMPORT);
    const probe = await findImport(deps.db, configBundleImportId);
    if (probe === undefined) throw problems.notFound();
    await requireRightAt(deps.db, principal, CONFIG_BUNDLE_IMPORT, probe.organization_id);
    const expected = requireIfMatch(request);
    if (kind === "validate" && probe.status !== "uploaded" && probe.status !== "validated")
      throw configBundleRefusals.notValidatable();
    if (kind === "commit" && probe.status !== "validated") throw configBundleRefusals.notCommittable();
    // The stored object is read before the transaction (no I/O inside it); its SHA-256 is checked against the row.
    const items = await readImportItems(store, probe);
    const row = await deps.db
      .transaction()
      .execute((tx) =>
        kind === "validate"
          ? validateImport(tx, registry(), request, probe, items, expected)
          : commitImport(tx, registry(), request, probe, items, expected),
      );
    return presentImport(deps.db, row);
  };
  app.post(G.validateConfigBundleImport.path, { config: importAccess }, async (request, reply) =>
    sendVersioned(reply, 200, await step("validate")(request)),
  );
  app.post(G.commitConfigBundleImport.path, { config: importAccess }, async (request, reply) =>
    sendVersioned(reply, 200, await step("commit")(request)),
  );

  return Object.values(G).map((g) => `${g.method} ${g.path}`);
}
