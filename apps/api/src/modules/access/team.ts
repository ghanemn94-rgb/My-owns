// P2 access routes (ADR-0020 §5-6; REQ-PB-012, REQ-S10-008):
//   GET  /role-accountabilities                          accountability text per role (any signed-in user)
//   GET  /transformations/{id}/scoped-assignments         the transformation team (transformation.read)
//   POST /transformations/{id}/scoped-assignments         assign a NON-approver team role (team.assign)
// The team view writes the canonical scoped_assignment rows (no second assignment table). team.assign allows only the
// roles WL, KDS, TD, CM and SEC at THIS transformation: none holds an approval permission or assignment rights, so a
// TL/TO can staff the team without being able to create approvers (SP/BO/FIN/TL/TO/AUD/admin need access.assign).
import { sql, type Db, type DbOrTx } from "@mth/db";
import { teamAssignmentCreate, type RoleAccountability } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  idempotencyKeySchema,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requestHash,
  sendVersioned,
  withIdempotency,
  type ModuleDeps,
} from "../platform/index.ts";
import { selectAssignment, toRoleAssignment } from "./assignments.ts";
import { requireAction, requireRead } from "./policy.ts";
import { auditContextOf, principalOf } from "./request.ts";

const TEAM = "/api/v1/transformations/:transformationId/scoped-assignments";
const ACCOUNTABILITIES = "/api/v1/role-accountabilities";

async function accountabilities(db: DbOrTx): Promise<Map<string, RoleAccountability>> {
  const rows = await db
    .selectFrom("role_accountability as ra")
    .innerJoin("role as r", "r.id", "ra.role_id")
    .selectAll("ra")
    .select("r.code")
    .orderBy("r.code")
    .execute();
  return new Map(
    rows.map((r) => [
      r.code,
      {
        roleId: r.role_id,
        accountabilityEn: r.accountability_en,
        accountabilityAr: r.accountability_ar,
        isSourceText: r.is_source_text,
        sourceRef: r.source_ref,
        version: r.version,
        createdAt: iso(r.created_at),
        createdBy: r.created_by,
        updatedAt: iso(r.updated_at),
        updatedBy: r.updated_by,
        roleCode: r.code as RoleAccountability["roleCode"],
      },
    ]),
  );
}

export function registerAccessP2Routes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  registerAccountabilities(app, db);
  registerTeam(app, db);
  return [`GET ${ACCOUNTABILITIES}`, `GET ${TEAM}`, `POST ${TEAM}`];
}

function registerAccountabilities(app: FastifyInstance, db: Db): void {
  // Catalogue text (B0018 verbatim for the six source roles); readable by every signed-in user.
  app.get(ACCOUNTABILITIES, { config: { access: { permission: "authenticated" } } }, async (request) => {
    principalOf(request);
    return { items: [...(await accountabilities(db)).values()] };
  });
}

function registerTeam(app: FastifyInstance, db: Db): void {
  const params = z.strictObject({ transformationId: z.uuid() });
  const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

  app.get(TEAM, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(params, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    const target = await requireRead(db, principalOf(request), "transformation.read", {
      type: "transformation",
      id: transformationId,
    });
    const hash = filterHash({ transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    // At this transformation, plus assignments inherited from above (roles that inherit downward, at the
    // organization or an ancestor business unit).
    let q = selectAssignment(db)
      .select(["r.inherits_downward"])
      .where("a.revoked_at", "is", null)
      .where("a.effective_from", "<=", sql<Date>`now()`)
      .where((eb) => eb.or([eb("a.effective_to", "is", null), eb("a.effective_to", ">", sql<Date>`now()`)]))
      .where((eb) =>
        eb.or([
          eb.and([eb("a.scope_type", "=", "transformation"), eb("a.scope_id", "=", transformationId)]),
          eb.and([
            eb("r.inherits_downward", "=", true),
            eb.or([
              eb.and([eb("a.scope_type", "=", "organization"), eb("a.scope_id", "=", target.organizationId)]),
              ...(target.businessUnitAncestry.length > 0
                ? [
                    eb.and([
                      eb("a.scope_type", "=", "business_unit"),
                      eb("a.scope_id", "in", [...target.businessUnitAncestry]),
                    ]),
                  ]
                : []),
            ]),
          ]),
        ]),
      );
    if (after) q = q.where("a.id", ">", String(after[0]));
    const rows = await q
      .orderBy("a.id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    const texts = await accountabilities(db);
    return {
      items: page.items.map(({ inherits_downward: _i, ...r }) => ({
        assignment: toRoleAssignment(r),
        accountability: texts.get(r.role_code) ?? null,
        inherited: r.scope_type !== "transformation",
      })),
      nextCursor: page.nextCursor,
    };
  });

  app.post(TEAM, { config: { access: { permission: "team.assign" } } }, async (request, reply) => {
    const { transformationId } = parse(params, request.params, "params");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const rawKey = request.headers["idempotency-key"];
    const key = rawKey === undefined ? undefined : parse(idempotencyKeySchema, rawKey, "header");
    const result = await db.transaction().execute(async (tx) => {
      const target = await requireRead(tx, principal, "transformation.read", {
        type: "transformation",
        id: transformationId,
      });
      // team.assign applies only at the caller's transformation (no inheritance of a business-record permission).
      await requireAction(tx, principal, "team.assign", target);
      const body = parseBody(teamAssignmentCreate, request.body);
      const run = async () => {
        if (body.userId === principal.userId)
          throw problems.businessRule("access.self_grant", "You cannot assign a team role to yourself.");
        const t = await tx
          .selectFrom("transformation")
          .select(["archived_at"])
          .where("id", "=", transformationId)
          .executeTakeFirstOrThrow();
        if (t.archived_at !== null)
          throw problems.businessRule("transformation.archived", "Archived transformations are read-only.");
        const user = await tx
          .selectFrom("app_user")
          .select(["id", "status", "organization_id"])
          .where("id", "=", body.userId)
          .executeTakeFirst();
        if (!user || user.organization_id !== target.organizationId)
          throw problems.businessRule("access.user_not_found", "The user is not a member of this organization.");
        if (user.status !== "active") throw problems.businessRule("access.user_disabled", "The user is disabled.");
        const role = await tx
          .selectFrom("role")
          .select(["id", "code"])
          .where("code", "=", body.roleCode)
          .executeTakeFirstOrThrow();
        // Defence in depth: a team role never carries an approval or assignment permission (ADR-0020 §3).
        const forbidden = await tx
          .selectFrom("role_permission as rp")
          .innerJoin("permission as p", "p.code", "rp.permission_code")
          .select("p.code")
          .where("rp.role_id", "=", role.id)
          .where((eb) =>
            eb.or([
              eb("p.category", "in", ["business_approval", "finance_validation"]),
              eb("p.code", "in", ["access.assign", "team.assign"]),
            ]),
          )
          .executeTakeFirst();
        if (forbidden)
          throw problems.businessRule(
            "team.role_not_assignable",
            "This role cannot be assigned through the team view.",
          );
        const id = uuidv7();
        try {
          await tx
            .insertInto("scoped_assignment")
            .values({
              id,
              organization_id: target.organizationId,
              user_id: body.userId,
              role_id: role.id,
              scope_type: "transformation",
              scope_id: transformationId,
              ...(body.effectiveFrom !== undefined ? { effective_from: body.effectiveFrom } : {}),
              effective_to: body.effectiveTo ?? null,
              reason: body.reason,
              granted_by: principal.userId!,
              created_by: principal.userId,
              updated_by: principal.userId,
            })
            .execute();
        } catch (e) {
          const err = e as { code?: string; constraint?: string };
          if (err.code === "23505")
            throw problems.duplicate("access.duplicate_assignment", "The user already holds this role here.");
          if (err.code === "23514" && err.constraint === "scoped_assignment_effective_range")
            throw problems.businessRule("validation.effective_range", "effectiveTo must be after effectiveFrom.");
          throw e;
        }
        await record(tx, audit, {
          action: "scoped_assignment.create",
          recordType: "scoped_assignment",
          recordId: id,
          organizationId: target.organizationId,
          transformationId,
          newVersion: 1,
          reason: body.reason,
          changes: {
            userId: { from: null, to: body.userId },
            roleCode: { from: null, to: role.code },
            scope: { from: null, to: { type: "transformation", id: transformationId } },
            via: { from: null, to: "team.assign" },
          },
        });
        const created = await selectAssignment(tx).where("a.id", "=", id).executeTakeFirstOrThrow();
        return { status: 201, body: toRoleAssignment(created) };
      };
      if (key === undefined) return { ...(await run()), replayed: false };
      return withIdempotency(
        tx,
        { userId: principal.userId!, key, requestHash: requestHash("POST", request.url.split("?")[0]!, body) },
        run,
      );
    });
    if (result.replayed) {
      request.authz.decisions += 1;
      reply.header("Idempotent-Replayed", "true");
    }
    return sendVersioned(reply, result.status, result.body, `/api/v1/role-assignments/${result.body.id}`);
  });
}
