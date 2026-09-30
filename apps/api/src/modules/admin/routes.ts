// Administration endpoints (ADR-0002 "admin"): users (identity), roles/permissions and scoped role assignments
// (access). Composition only: each write is delegated to the owning module's function, inside one transaction.
import {
  roleAssignmentCreate,
  reasonRequest,
  scopeType,
  userCreate,
  userStatus,
  userUpdate,
  uuid,
} from "@mth/shared/schemas";
import type { DbOrTx } from "@mth/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { record } from "../audit/index.ts";
import {
  auditContextOf,
  authorize,
  createAssignment,
  getAssignment,
  holdsAnywhere,
  listAssignments,
  listPermissions,
  listRoles,
  principalOf,
  requireAction,
  resolveTarget,
  revokeAssignment,
  targetFor,
  toRoleAssignment,
  type Principal,
} from "../access/index.ts";
import {
  createUser,
  findUserRow,
  identitiesOf,
  listUsers,
  revokeUserSessions,
  toUser,
  updateUser,
} from "../identity/index.ts";
import {
  cursorSchema,
  limitSchema,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";

const userParams = z.strictObject({ userId: uuid });
const assignmentParams = z.strictObject({ assignmentId: uuid });
const userListQuery = z.strictObject({
  organizationId: uuid,
  q: z.string().min(1).max(200).optional(),
  status: userStatus.optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});
const assignmentListQuery = z.strictObject({
  organizationId: uuid,
  userId: uuid.optional(),
  scopeType: scopeType.optional(),
  scopeId: uuid.optional(),
  includeRevoked: z.stringbool().default(false),
  cursor: cursorSchema,
  limit: limitSchema,
});

/** Organization-level gate for user administration: 403 (with an audited denial for writes) when not permitted. */
async function requireOrgPermission(
  db: ModuleDeps["db"],
  principal: Principal,
  permission: "user.read" | "user.manage",
  organizationId: string,
) {
  const target = await resolveTarget(db, { type: "organization", id: organizationId });
  if (!target) {
    principal.tracker.decisions += 1;
    throw problems.forbidden();
  }
  await requireAction(db, principal, permission, target);
}

export function registerAdminRoutes(app: FastifyInstance, { db }: ModuleDeps): void {
  // ---------------------------------------------------------------- users
  app.get("/api/v1/users", { config: { access: { permission: "user.read" } } }, async (request) => {
    const principal = principalOf(request);
    const query = parseQuery(userListQuery, request.query);
    await requireOrgPermission(db, principal, "user.read", query.organizationId);
    return listUsers(db, query);
  });

  app.post("/api/v1/users", { config: { access: { permission: "user.manage" } } }, async (request, reply) => {
    const principal = principalOf(request);
    const body = parseBody(userCreate, request.body);
    // The contract allows an empty issuer string, the database does not (and createUser declares no 422): reject
    // it here as a validation error rather than surfacing a constraint violation.
    if (body.identity && body.identity.issuer.trim() === "") {
      throw problems.badRequest("validation.too_small", "identity.issuer must not be empty.", "/identity/issuer");
    }
    await requireOrgPermission(db, principal, "user.manage", body.organizationId);
    const user = await db.transaction().execute((tx) => createUser(tx, auditContextOf(request), body));
    return sendVersioned(reply, 201, user, `/api/v1/users/${user.id}`);
  });

  /** Read gate for one user: the user themself, or user.read on the user's home organization; otherwise 404. */
  async function readableUser(request: FastifyRequest, userId: string, forUpdate = false, tx: DbOrTx = db) {
    const principal = principalOf(request);
    const row = await findUserRow(tx, userId, forUpdate);
    if (!row) {
      principal.tracker.decisions += 1;
      throw problems.notFound();
    }
    if (row.id === principal.userId) {
      principal.tracker.decisions += 1;
      return row;
    }
    const d = await authorize(tx, principal, "user.read", { type: "organization", id: row.organization_id });
    if (!d.allowed) throw problems.notFound();
    return row;
  }

  app.get("/api/v1/users/:userId", { config: { access: { permission: "user.read" } } }, async (request, reply) => {
    const { userId } = parse(userParams, request.params, "params");
    const row = await readableUser(request, userId);
    const identities = (await identitiesOf(db, [row.id])).get(row.id) ?? [];
    return sendVersioned(reply, 200, toUser(row, identities));
  });

  app.patch("/api/v1/users/:userId", { config: { access: { permission: "user.manage" } } }, async (request, reply) => {
    const { userId } = parse(userParams, request.params, "params");
    const body = parseBody(userUpdate, request.body);
    const principal = principalOf(request);
    const user = await db.transaction().execute(async (tx) => {
      const current = await readableUser(request, userId, true, tx);
      await requireAction(
        tx,
        principal,
        "user.manage",
        await targetFor(tx, "organization", { organizationId: current.organization_id }),
      );
      const expected = requireIfMatch(request);
      return updateUser(tx, auditContextOf(request), current, expected, body);
    });
    return sendVersioned(reply, 200, user);
  });

  // ---------------------------------------------------------------- role and permission catalogue
  app.get("/api/v1/roles", { config: { access: { permission: "role.read" } } }, async (request) => {
    if (!holdsAnywhere(principalOf(request), "role.read")) throw problems.forbidden();
    return { items: await listRoles(db) };
  });

  app.get("/api/v1/permissions", { config: { access: { permission: "role.read" } } }, async (request) => {
    if (!holdsAnywhere(principalOf(request), "role.read")) throw problems.forbidden();
    return { items: await listPermissions(db) };
  });

  // ---------------------------------------------------------------- scoped role assignments
  app.get("/api/v1/role-assignments", { config: { access: { permission: "access.read" } } }, async (request) => {
    const query = parseQuery(assignmentListQuery, request.query);
    return listAssignments(db, principalOf(request), query);
  });

  app.post(
    "/api/v1/role-assignments",
    { config: { access: { permission: "access.assign" } } },
    async (request, reply) => {
      const principal = principalOf(request);
      const body = parseBody(roleAssignmentCreate, request.body);
      const assignment = await db
        .transaction()
        .execute((tx) => createAssignment(tx, principal, auditContextOf(request), body));
      return sendVersioned(reply, 201, assignment, `/api/v1/role-assignments/${assignment.id}`);
    },
  );

  app.get(
    "/api/v1/role-assignments/:assignmentId",
    { config: { access: { permission: "access.read" } } },
    async (request, reply) => {
      const { assignmentId } = parse(assignmentParams, request.params, "params");
      const { row } = await getAssignment(db, principalOf(request), assignmentId);
      return sendVersioned(reply, 200, toRoleAssignment(row));
    },
  );

  app.post(
    "/api/v1/role-assignments/:assignmentId/revoke",
    { config: { access: { permission: "access.assign" } } },
    async (request, reply) => {
      const { assignmentId } = parse(assignmentParams, request.params, "params");
      const { reason } = parseBody(reasonRequest, request.body);
      const principal = principalOf(request);
      const assignment = await db.transaction().execute(async (tx) => {
        const revoked = await revokeAssignment(
          tx,
          principal,
          auditContextOf(request),
          assignmentId,
          () => requireIfMatch(request),
          reason,
        );
        // Defence in depth (ADR-0005 §3): the affected user's sessions end too. Grants are re-read on every request,
        // so the revocation is already effective for the next request either way.
        const ended = await revokeUserSessions(tx, revoked.userId);
        if (ended > 0) {
          // Session revocation is a security event (ADR-0004 §3).
          await record(tx, auditContextOf(request), {
            action: "session.revoke",
            recordType: "app_user",
            recordId: revoked.userId,
            organizationId: revoked.organizationId,
            reason: `${ended} session(s) ended because role assignment ${revoked.id} was revoked`,
          });
        }
        return revoked;
      });
      return sendVersioned(reply, 200, assignment);
    },
  );
}
