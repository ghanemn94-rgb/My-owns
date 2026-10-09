// Governance parties and per-transformation role mapping (OpenAPI tag "role-mappings"; ADR-0026 §2, §8; REQ-S10-008;
// T-DG4-BE-B):
//   GET  /governance-parties                                     the 18 T11/T12 parties (seeded, read-only; signed in)
//   GET  /transformations/{id}/role-mappings                     who each party is (transformation.read)
//   POST /transformations/{id}/role-mappings                     map a party to a person or a group (role_mapping.assign;
//                                                                TL, TO). 409 role_mapping.already_mapped
//   POST /transformations/{id}/role-mappings/{mappingId}/end     end with a reason (If-Match). Final
//   GET  /transformations/{id}/role-mappings/resolve?party=BO    routing preview: `unmapped` is data here
//
// Routing (`resolveParty`): the active mapping's person or group, and NOTHING else. There is no fallback (not to holders
// of the role, not to the creator): an unmapped party is the visible error 422 routing.role_unmapped, and the refused
// request writes nothing. `requireApprover` adds ADR-0026 §8: a mapped person must hold approval.decide in the
// transformation's scope, a mapped group must have at least one current member who does (422
// routing.assignee_not_approver). Group membership grants nothing; the right comes only from scoped_assignment.
import { sql, type DbOrTx, type RoleMappingRow, type Tx } from "@mth/db";
import {
  partyCode,
  reasonRequest,
  roleMappingCreate,
  uuid,
  type GovernanceParty,
  type PartyResolution,
  type RoleMapping,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { currentGroupMemberIds } from "./groups.ts";
import { loadGrants, requireAction, type Principal } from "./policy.ts";
import { requireTransformationRead } from "./records.ts";
import { auditContextOf, commitTimeDenial, principalOf, refreshPrincipal } from "./request.ts";
import { decide, type ResolvedTarget } from "./rules.ts";

const JSON_BODY = ["application/json"] as const;
const ASSIGN = "role_mapping.assign" as const;
const READ = "transformation.read" as const;

const transformationParams = z.strictObject({ transformationId: uuid });
const mappingParams = z.strictObject({ transformationId: uuid, mappingId: uuid });
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  status: z.enum(["active", "ended"]).optional(),
});
const resolveQuery = z.strictObject({ party: partyCode });

// ------------------------------------------------------------------------------------------------ refusals

const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

/** ADR-0026 §2/§8 routing refusals (exact codes and English texts, S-11). */
export const routingRefusals = {
  roleUnmapped: (party: string) =>
    problems.businessRule(
      "routing.role_unmapped",
      `No person or group is mapped to ${party} in this transformation. Map the role in the transformation team before routing.`,
    ),
  assigneeNotApprover: (target: string, party: string) =>
    problems.businessRule(
      "routing.assignee_not_approver",
      `${target} is mapped to ${party} but holds no business-approver role in this transformation. Map an approver or grant the role first.`,
    ),
} as const;

export const roleMappingRefusals = {
  alreadyMapped: () =>
    problems.duplicate(
      "role_mapping.already_mapped",
      "This party is already mapped in this transformation. End the current mapping first.",
    ),
  partyUnknown: (party: string) =>
    rule("role_mapping.party_unknown", `${party} is not a known governance role.`, "/partyCode"),
  targetInvalid: (pointer: string) =>
    rule(
      "role_mapping.target_invalid",
      "Map the party to an active user, or an active group, of this transformation's organization.",
      pointer,
    ),
  ended: () => rule("role_mapping.ended", "This mapping has already ended. Create a new mapping instead.", ""),
} as const;

// ------------------------------------------------------------------------------------------------ routing service

export type PartyTarget =
  | { readonly status: "mapped"; readonly mappingId: string; readonly kind: "user"; readonly userId: string }
  | { readonly status: "mapped"; readonly mappingId: string; readonly kind: "group"; readonly groupId: string }
  | { readonly status: "unmapped" };

/** The party's English label (source wording), or its code when the catalogue has none. */
export async function partyLabel(db: DbOrTx, code: string): Promise<string> {
  const p = await db.selectFrom("governance_party").select("label_en").where("code", "=", code).executeTakeFirst();
  return p?.label_en ?? code;
}

/** Who `partyCode` is in the transformation: the active mapping's user or group, or `unmapped`. Never a fallback. */
export async function resolveParty(db: DbOrTx, transformationId: string, partyCodeValue: string): Promise<PartyTarget> {
  const m = await db
    .selectFrom("role_mapping")
    .select(["id", "target_kind", "user_id", "group_id"])
    .where("transformation_id", "=", transformationId)
    .where("party_code", "=", partyCodeValue)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!m) return { status: "unmapped" };
  return m.target_kind === "group"
    ? { status: "mapped", mappingId: m.id, kind: "group", groupId: m.group_id! }
    : { status: "mapped", mappingId: m.id, kind: "user", userId: m.user_id! };
}

/** True when `userId` currently holds `approval.decide` in the target's scope (grants from scoped_assignment only). */
export async function userHoldsApprovalDecide(db: DbOrTx, userId: string, target: ResolvedTarget): Promise<boolean> {
  const user = await db.selectFrom("app_user").select("status").where("id", "=", userId).executeTakeFirst();
  if (!user || user.status !== "active") return false;
  const grants = await loadGrants(db, userId);
  return decide({ kind: "user", userId, grants }, "approval.decide", target).allowed;
}

/** The users of a party target who can decide: the person, or the group's current members holding approval.decide. */
export async function approversOf(
  db: DbOrTx,
  target: Exclude<PartyTarget, { status: "unmapped" }>,
  scope: ResolvedTarget,
): Promise<string[]> {
  const candidates = target.kind === "user" ? [target.userId] : await currentGroupMemberIds(db, target.groupId);
  const out: string[] = [];
  for (const id of candidates) if (await userHoldsApprovalDecide(db, id, scope)) out.push(id);
  return out;
}

export interface RoutedParty {
  readonly partyCode: string;
  readonly target: Exclude<PartyTarget, { status: "unmapped" }>;
  /** The users who receive the approval task (the person, or the group's approver members). Never empty. */
  readonly approverUserIds: readonly string[];
}

/**
 * Routes a business approval to `partyCode` in the transformation (ADR-0026 §2, §8): 422 routing.role_unmapped when the
 * party is unmapped, 422 routing.assignee_not_approver when the mapped person (or every member of the mapped group)
 * holds no approval.decide in the transformation's scope. Writes nothing.
 */
export async function routeToParty(
  db: DbOrTx,
  scope: ResolvedTarget & { transformationId: string },
  partyCodeValue: string,
): Promise<RoutedParty> {
  const target = await resolveParty(db, scope.transformationId, partyCodeValue);
  if (target.status === "unmapped") throw routingRefusals.roleUnmapped(await partyLabel(db, partyCodeValue));
  const approverUserIds = await approversOf(db, target, scope);
  if (approverUserIds.length === 0) {
    const name =
      target.kind === "user"
        ? ((await db.selectFrom("app_user").select("display_name").where("id", "=", target.userId).executeTakeFirst())
            ?.display_name ?? "The mapped person")
        : ((await db.selectFrom("access_group").select("name_en").where("id", "=", target.groupId).executeTakeFirst())
            ?.name_en ?? "The mapped group");
    throw routingRefusals.assigneeNotApprover(name, await partyLabel(db, partyCodeValue));
  }
  return { partyCode: partyCodeValue, target, approverUserIds };
}

// ------------------------------------------------------------------------------------------------ mapping

async function displayNames(db: DbOrTx, rows: readonly RoleMappingRow[]): Promise<Map<string, string>> {
  const userIds = rows.flatMap((r) => (r.user_id ? [r.user_id] : []));
  const groupIds = rows.flatMap((r) => (r.group_id ? [r.group_id] : []));
  const out = new Map<string, string>();
  if (userIds.length > 0)
    for (const u of await db.selectFrom("app_user").select(["id", "display_name"]).where("id", "in", userIds).execute())
      out.set(u.id, u.display_name);
  if (groupIds.length > 0)
    for (const g of await db.selectFrom("access_group").select(["id", "name_en"]).where("id", "in", groupIds).execute())
      out.set(g.id, g.name_en);
  return out;
}

export const toRoleMapping = (r: RoleMappingRow, names: ReadonlyMap<string, string>): RoleMapping => ({
  id: r.id,
  transformationId: r.transformation_id,
  partyCode: r.party_code,
  targetKind: r.target_kind as RoleMapping["targetKind"],
  userId: r.user_id,
  groupId: r.group_id,
  targetDisplayName: names.get(r.user_id ?? r.group_id ?? "") ?? "",
  status: r.status as RoleMapping["status"],
  endedAt: isoOrNull(r.ended_at),
  endedBy: r.ended_by,
  endReason: r.end_reason,
  version: r.version,
  createdAt: iso(r.created_at),
});

// ------------------------------------------------------------------------------------------------ access

/** Read gate (404), then role_mapping.assign decided on grants reloaded in `tx` (commit-time; 403 audited). */
async function requireAssign(tx: Tx, request: FastifyRequest, transformationId: string) {
  const target = await requireTransformationRead(tx, principalOf(request), transformationId);
  const fresh: Principal = await refreshPrincipal(tx, request);
  try {
    await requireTransformationRead(tx, fresh, transformationId);
    await requireAction(tx, fresh, ASSIGN, target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  return { userId: fresh.userId!, target };
}

// ------------------------------------------------------------------------------------------------ routes

export function registerRoleMappingRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const PARTIES = "/api/v1/governance-parties";
  const MAPPINGS = "/api/v1/transformations/:transformationId/role-mappings";
  const END = `${MAPPINGS}/:mappingId/end`;
  const RESOLVE = `${MAPPINGS}/resolve`;

  app.get(PARTIES, { config: { access: { permission: "authenticated" } } }, async (request) => {
    principalOf(request);
    parseQuery(z.strictObject({}), request.query);
    const rows = await db.selectFrom("governance_party").selectAll().orderBy("ordinal").execute();
    const items: GovernanceParty[] = rows.map((p) => ({
      code: p.code,
      ordinal: p.ordinal,
      kind: p.kind as GovernanceParty["kind"],
      roleCode: p.role_code,
      labelEn: p.label_en,
      labelAr: p.label_ar,
      sourceRef: p.source_ref,
    }));
    return { items };
  });

  app.get(MAPPINGS, { config: { access: { permission: READ } } }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId, status: query.status });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("role_mapping").selectAll().where("transformation_id", "=", transformationId);
    if (query.status) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    const names = await displayNames(db, page.items);
    return { items: page.items.map((r) => toRoleMapping(r, names)), nextCursor: page.nextCursor };
  });

  app.post(MAPPINGS, { config: { access: { permission: ASSIGN }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const body = parseBody(roleMappingCreate, request.body);
    const row = await db
      .transaction()
      .execute(async (tx) => {
        const { userId, target } = await requireAssign(tx, request, transformationId);
        const party = await tx
          .selectFrom("governance_party")
          .select("code")
          .where("code", "=", body.partyCode)
          .executeTakeFirst();
        if (!party) throw roleMappingRefusals.partyUnknown(body.partyCode);
        // Exactly one target, matching targetKind (role_mapping_one_target).
        if (body.targetKind === "user") {
          if (body.userId === undefined || body.groupId !== undefined)
            throw roleMappingRefusals.targetInvalid("/userId");
          const u = await tx
            .selectFrom("app_user")
            .select("id")
            .where("id", "=", body.userId)
            .where("organization_id", "=", target.organizationId)
            .where("status", "=", "active")
            .executeTakeFirst();
          if (!u) throw roleMappingRefusals.targetInvalid("/userId");
        } else {
          if (body.groupId === undefined || body.userId !== undefined)
            throw roleMappingRefusals.targetInvalid("/groupId");
          const g = await tx
            .selectFrom("access_group")
            .select("id")
            .where("id", "=", body.groupId)
            .where("organization_id", "=", target.organizationId)
            .where("status", "=", "active")
            .executeTakeFirst();
          if (!g) throw roleMappingRefusals.targetInvalid("/groupId");
        }
        const active = await tx
          .selectFrom("role_mapping")
          .select("id")
          .where("transformation_id", "=", transformationId)
          .where("party_code", "=", body.partyCode)
          .where("status", "=", "active")
          .executeTakeFirst();
        if (active) throw roleMappingRefusals.alreadyMapped();
        const id = uuidv7();
        const created = await tx
          .insertInto("role_mapping")
          .values({
            id,
            organization_id: target.organizationId,
            transformation_id: transformationId,
            party_code: body.partyCode,
            target_kind: body.targetKind,
            user_id: body.targetKind === "user" ? body.userId! : null,
            group_id: body.targetKind === "group" ? body.groupId! : null,
            created_by: userId,
            updated_by: userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, auditContextOf(request), {
          action: "role_mapping.create",
          recordType: "role_mapping",
          recordId: id,
          organizationId: target.organizationId,
          transformationId,
          newVersion: 1,
          changes: {
            party_code: { from: null, to: created.party_code },
            target_kind: { from: null, to: created.target_kind },
            user_id: { from: null, to: created.user_id },
            group_id: { from: null, to: created.group_id },
          },
        });
        return created;
      })
      .catch((err: unknown) => {
        if ((err as { constraint?: string } | null)?.constraint === "role_mapping_active_key")
          throw roleMappingRefusals.alreadyMapped();
        throw err;
      });
    const names = await displayNames(db, [row]);
    return sendVersioned(
      reply,
      201,
      toRoleMapping(row, names),
      `/api/v1/transformations/${transformationId}/role-mappings/${row.id}`,
    );
  });

  app.post(END, { config: { access: { permission: ASSIGN }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, mappingId } = parse(mappingParams, request.params, "params");
    const body = parseBody(reasonRequest, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireAssign(tx, request, transformationId);
      const expected = requireIfMatch(request);
      const current = await tx
        .selectFrom("role_mapping")
        .selectAll()
        .where("id", "=", mappingId)
        .where("transformation_id", "=", transformationId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status !== "active") throw roleMappingRefusals.ended();
      const updated = await tx
        .updateTable("role_mapping")
        .set({
          status: "ended",
          ended_at: sql<Date>`now()`,
          ended_by: userId,
          end_reason: body.reason,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", mappingId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "role_mapping.end",
        recordType: "role_mapping",
        recordId: mappingId,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        reason: body.reason,
        changes: { status: { from: "active", to: "ended" } },
      });
      return updated;
    });
    const names = await displayNames(db, [row]);
    return sendVersioned(reply, 200, toRoleMapping(row, names));
  });

  app.get(RESOLVE, { config: { access: { permission: READ } } }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(resolveQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const known = await db
      .selectFrom("governance_party")
      .select("code")
      .where("code", "=", query.party)
      .executeTakeFirst();
    if (!known)
      throw problems.badRequest(
        "validation.party_unknown",
        `${query.party} is not a known governance role.`,
        "/query/party",
      );
    const t = await resolveParty(db, transformationId, query.party);
    const out: PartyResolution =
      t.status === "unmapped"
        ? { partyCode: query.party, status: "unmapped", mappingId: null, targetKind: null, userId: null, groupId: null }
        : {
            partyCode: query.party,
            status: "mapped",
            mappingId: t.mappingId,
            targetKind: t.kind,
            userId: t.kind === "user" ? t.userId : null,
            groupId: t.kind === "group" ? t.groupId : null,
          };
    return out;
  });

  return [`GET ${PARTIES}`, `GET ${MAPPINGS}`, `POST ${MAPPINGS}`, `POST ${END}`, `GET ${RESOLVE}`];
}
