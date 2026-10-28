// Administration > Service identities (P6 slice J; ADR-0053 §1, §9; REQ-S16-029; T-DG6-BE-J). Route file created as
// a stub by T-DG6-BE-A with its server.ts registration line; the service is access/service-identities.ts.
//   GET /api/v1/admin/service-identities                         listServiceIdentities  (operations.read)
//   GET /api/v1/admin/service-identities/{serviceIdentityId}     getServiceIdentity     (operations.read)
//   PUT /api/v1/admin/service-identities/{serviceIdentityId}     putServiceIdentity     (service_identity.configure)
// The PUT narrows or restores the grant within the declaration, with a reason; it never widens the grant or changes
// the declaration (422 service_identity.grant_exceeds_declaration; 0101 column privileges). AUD reads and gets 403 on
// the PUT. A service identity never holds a business-approval or Finance-validation right; nothing here touches DG0-DG7.
import { PERMISSION_CODES } from "@mth/shared";
import { uuid } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  checkedServiceIdentityReason,
  grantWithinDeclaration,
  listServiceIdentities,
  principalOf,
  putServiceIdentity,
  requireServiceIdentityChange,
  SERVICE_IDENTITY_CONFIGURE,
  SERVICE_IDENTITY_READ,
  toServiceIdentity,
  visibleServiceIdentity,
} from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";

const LIST = "/api/v1/admin/service-identities";
const ONE = "/api/v1/admin/service-identities/:serviceIdentityId";
const JSON_BODY = ["application/json"] as const;

const listQuery = z.strictObject({
  organizationId: uuid,
  subjectKind: z.enum(["job", "connector"]).optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});
const params = z.strictObject({ serviceIdentityId: uuid });
const noQuery = z.strictObject({});
const updateBody = z.strictObject({
  grantedPermissionCodes: z
    .array(z.enum(PERMISSION_CODES as [string, ...string[]]))
    .max(40)
    .refine((codes) => new Set(codes).size === codes.length, { message: "Each permission code may appear once." }),
  reason: z.string().min(3).max(1000),
});

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerServiceIdentityRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // listServiceIdentities: the platform identities and the organization's own, by code (cursor over code, id).
  app.get(LIST, { config: { access: { permission: SERVICE_IDENTITY_READ } } }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    const { cursor, limit, ...filters } = query;
    const hash = filterHash(filters);
    const after = decodeCursor(cursor, hash, 2);
    const rows = await listServiceIdentities(db, principal, {
      organizationId: query.organizationId,
      ...(query.subjectKind ? { subjectKind: query.subjectKind } : {}),
      after: after ? [String(after[0]), String(after[1])] : null,
      limit,
    });
    const page = paginate(rows, limit, (r) => [r.code, r.id], hash);
    return { items: page.items.map(toServiceIdentity), nextCursor: page.nextCursor };
  });

  // getServiceIdentity: 404 when missing or unreadable.
  app.get(ONE, { config: { access: { permission: SERVICE_IDENTITY_READ } } }, async (request, reply) => {
    const { serviceIdentityId } = parse(params, request.params, "params");
    parseQuery(noQuery, request.query);
    const row = await visibleServiceIdentity(db, principalOf(request), serviceIdentityId);
    return sendVersioned(reply, 200, toServiceIdentity(row));
  });

  // putServiceIdentity: 400 body, 404 read gate, 403 configure gate, 422 reason / declaration, 428, then the
  // transaction (row lock, re-authorization at commit, 409 version, the update and its audit event).
  app.put(
    ONE,
    { config: { access: { permission: SERVICE_IDENTITY_CONFIGURE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { serviceIdentityId } = parse(params, request.params, "params");
      parseQuery(noQuery, request.query);
      const body = parseBody(updateBody, request.body);
      const principal = principalOf(request);
      const current = await requireServiceIdentityChange(db, principal, serviceIdentityId);
      const reason = checkedServiceIdentityReason(body.reason);
      grantWithinDeclaration(current.declared_permission_codes, body.grantedPermissionCodes);
      const expected = requireIfMatch(request);
      const row = await db.transaction().execute((tx) =>
        putServiceIdentity(tx, request, serviceIdentityId, expected, {
          grantedPermissionCodes: body.grantedPermissionCodes,
          reason,
        }),
      );
      return sendVersioned(reply, 200, toServiceIdentity(row));
    },
  );

  return [`GET ${LIST}`, `GET ${ONE}`, `PUT ${ONE}`];
}
