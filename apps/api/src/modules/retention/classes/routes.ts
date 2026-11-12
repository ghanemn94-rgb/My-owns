// Administration > Retention: the retention classes (P7 slice E; ADR-0067 §1, §2, §8; REQ-S16-024). Route file created
// as a stub by T-DG7-BE-A; filled by T-DG7-BE-G (p7-work-split §E.1):
//   GET /admin/retention/classes                       listRetentionClasses   (retention.read; ADM_TECH, ADM_ACCESS, AUD)
//   GET /admin/retention/classes/:retentionClassCode   getRetentionClass      (retention.read)
//   PUT /admin/retention/classes/:retentionClassCode   updateRetentionClass   (retention.configure; ADM_TECH; If-Match)
// Every class ships `retain` with no period (null: "not set (IT to agree)", never 0). The IT approval reference is text
// recording an approval given outside the platform, never an approval by the platform or an agent (service.ts).
import type { FastifyInstance } from "fastify";
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
import {
  findClass,
  presentClass,
  requireRetentionRight,
  retentionClassCode,
  retentionClassPage,
  retentionClassUpdate,
  tablesOf,
  updateClass,
} from "./service.ts";

/** The route guard of every retention-class operation (docs/api/openapi.yaml, tag `retention`; ADR-0067 §8). */
export const RETENTION_CLASS_ROUTE_GUARDS = {
  listRetentionClasses: { method: "GET", path: "/api/v1/admin/retention/classes", permission: "retention.read" },
  getRetentionClass: {
    method: "GET",
    path: "/api/v1/admin/retention/classes/:retentionClassCode",
    permission: "retention.read",
  },
  updateRetentionClass: {
    method: "PUT",
    path: "/api/v1/admin/retention/classes/:retentionClassCode",
    permission: "retention.configure",
  },
} as const satisfies Record<string, P7RouteGuard>;

const G = RETENTION_CLASS_ROUTE_GUARDS;
const JSON_BODY = ["application/json"] as const;
const codeParams = z.strictObject({ retentionClassCode });
const listQuery = z.strictObject({ ...pageQueryFields });
const noQuery = z.strictObject({});
/** Ordered by code (the contract's order). */
const CLASS_SORT: readonly SortKey[] = [{ name: "code", type: "text" }];

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerRetentionClassRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const read = { access: { permission: "retention.read" as const } };

  app.get(G.listRetentionClasses.path, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireRetentionRight(deps.db, principalOf(request), "retention.read");
    const page = await keysetPage(deps.db.selectFrom("retention_class").selectAll(), CLASS_SORT, query, {
      list: "retention-classes",
    });
    const tables = await tablesOf(
      deps.db,
      page.items.map((c) => c.id),
    );
    return retentionClassPage.parse({
      items: page.items.map((c) => presentClass(c, tables)),
      nextCursor: page.nextCursor,
    });
  });

  app.get(G.getRetentionClass.path, { config: read }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    const { retentionClassCode: code } = parse(codeParams, request.params, "params");
    await requireRetentionRight(deps.db, principalOf(request), "retention.read");
    const row = await findClass(deps.db, code);
    if (row === undefined) throw problems.notFound();
    return sendVersioned(reply, 200, presentClass(row, await tablesOf(deps.db, [row.id])));
  });

  app.put(
    G.updateRetentionClass.path,
    { config: { access: { permission: "retention.configure" as const }, consumes: JSON_BODY } },
    async (request, reply) => {
      parseQuery(noQuery, request.query);
      const { retentionClassCode: code } = parse(codeParams, request.params, "params");
      // The right is decided first (403 for every role but ADM_TECH, AUD and ADM_ACCESS included), then the body and
      // the If-Match; the transaction re-checks the right on reloaded grants.
      await requireRetentionRight(deps.db, principalOf(request), "retention.configure");
      const body = parseBody(retentionClassUpdate, request.body);
      const expected = requireIfMatch(request);
      const view = await deps.db.transaction().execute((tx) => updateClass(tx, request, code, expected, body));
      return sendVersioned(reply, 200, view);
    },
  );

  return Object.values(G).map((g) => `${g.method} ${g.path}`);
}
