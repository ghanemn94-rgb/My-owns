// Governed groups and their members (OpenAPI tag "groups"; ADR-0026 §1; REQ-S16-011, REQ-S10-008; T-DG4-BE-B):
//   GET  /organizations/{organizationId}/groups            list (organization.read), by code
//   POST /organizations/{organizationId}/groups            create (group.manage; TO). 409 group.code_taken
//   GET  /groups/{groupId}                                 read (organization.read)
//   PATCH /groups/{groupId}                                rename, change owner, archive (group.manage; If-Match)
//   GET  /groups/{groupId}/members                         members, current first (organization.read)
//   POST /groups/{groupId}/members                         add a member of the same organization (group.manage).
//                                                          409 group.member_exists; 422 group.member_other_organization
//   POST /groups/{groupId}/members/{memberId}/remove       remove with a reason (group.manage; If-Match); the row stays
//
// A group is a ROUTING target (who receives an approval or a task). It grants NO permission: scoped_assignment stays the
// only source of access (ADR-0006), so a technical administrator added to a group still cannot decide an approval
// (REQ-S10-003). A member "acts as the group" only while not removed and effective_from <= now < effective_to
// (`effectiveGroupIds`).
//
// Every mutation: the organization read gate (404 when the caller cannot read it), then group.manage decided again on
// grants reloaded inside the write transaction (commit-time authorisation; a revoked right is 403, audited), zod
// validation (S-1 free-text rules), If-Match on updates and removals (428/409; creates are version 1), and one audit
// event per written row in the same transaction. The 0029 guards (version step, audit at COMMIT, same organization,
// one active membership) are the database's last line.
import { diffFields, sql, type AccessGroupMemberRow, type AccessGroupRow, type DbOrTx, type Tx } from "@mth/db";
import {
  groupCreate,
  groupMemberCreate,
  groupUpdate,
  reasonRequest,
  uuid,
  type Group,
  type GroupMember,
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
import { requireAction, requireRead, targetFor } from "./policy.ts";
import { auditContextOf, commitTimeDenial, principalOf, refreshPrincipal } from "./request.ts";

const JSON_BODY = ["application/json"] as const;
const MANAGE = "group.manage" as const;
const READ = "organization.read" as const;

const orgParams = z.strictObject({ organizationId: uuid });
const groupParams = z.strictObject({ groupId: uuid });
const memberParams = z.strictObject({ groupId: uuid, memberId: uuid });
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

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

export const groupRefusals = {
  codeTaken: (code: string) =>
    problems.duplicate("group.code_taken", `A group with the code ${code} already exists in this organization.`),
  memberExists: () =>
    problems.duplicate("group.member_exists", "This person is already a current member of the group."),
  memberOtherOrganization: () =>
    rule(
      "group.member_other_organization",
      "Only an active user of the group's organization can be a member.",
      "/userId",
    ),
  ownerInvalid: () =>
    rule("group.owner_invalid", "The owner must be an active user of the group's organization.", "/ownerUserId"),
  archived: () => rule("group.archived", "This group is archived. Reactivate it before adding members.", ""),
  memberRemoved: () => rule("group.member_removed", "This member has already been removed.", ""),
  memberWindowInvalid: () =>
    rule("group.member_window_invalid", "A membership must end after it starts.", "/effectiveTo"),
} as const;

// ------------------------------------------------------------------------------------------------ mapping

const GROUP_AUDIT_FIELDS = ["code", "name_en", "name_ar", "description", "owner_user_id", "status"] as const;

export const toGroup = (r: AccessGroupRow, memberCount: number): Group => ({
  id: r.id,
  organizationId: r.organization_id,
  code: r.code,
  nameEn: r.name_en,
  nameAr: r.name_ar,
  description: r.description,
  ownerUserId: r.owner_user_id,
  status: r.status as Group["status"],
  memberCount,
  version: r.version,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export const toGroupMember = (r: AccessGroupMemberRow, displayName: string): GroupMember => ({
  id: r.id,
  groupId: r.group_id,
  userId: r.user_id,
  displayName,
  effectiveFrom: iso(r.effective_from),
  effectiveTo: isoOrNull(r.effective_to),
  removedAt: isoOrNull(r.removed_at),
  removedBy: r.removed_by,
  removeReason: r.remove_reason,
  version: r.version,
});

function changesOf(before: Partial<AccessGroupRow>, after: AccessGroupRow) {
  return diffFields(before, after as Partial<AccessGroupRow>, [...GROUP_AUDIT_FIELDS]);
}

// ------------------------------------------------------------------------------------------------ queries

/** SQL predicate: the membership row is current (not removed, inside its effective window, now()). */
export const CURRENT_MEMBER = sql<boolean>`(removed_at IS NULL AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now()))`;

/** Ids of the active groups in which `userId` is a current member (ADR-0026 §1 "acts as the group"). */
export async function effectiveGroupIds(db: DbOrTx, userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("access_group_member as m")
    .innerJoin("access_group as g", "g.id", "m.group_id")
    .select("m.group_id")
    .where("m.user_id", "=", userId)
    .where("g.status", "=", "active")
    .where(
      sql<boolean>`(m.removed_at IS NULL AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now()))`,
    )
    .execute();
  return rows.map((r) => r.group_id);
}

/** User ids of the current members of a group (empty when the group is archived). */
export async function currentGroupMemberIds(db: DbOrTx, groupId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("access_group_member as m")
    .innerJoin("access_group as g", "g.id", "m.group_id")
    .innerJoin("app_user as u", "u.id", "m.user_id")
    .select("m.user_id")
    .where("m.group_id", "=", groupId)
    .where("g.status", "=", "active")
    .where("u.status", "=", "active")
    .where(
      sql<boolean>`(m.removed_at IS NULL AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now()))`,
    )
    .orderBy("m.user_id")
    .execute();
  return rows.map((r) => r.user_id);
}

async function memberCounts(db: DbOrTx, groupIds: readonly string[]): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("access_group_member")
    .select(["group_id", (eb) => eb.fn.countAll<string>().as("n")])
    .where("group_id", "in", [...groupIds])
    .where(CURRENT_MEMBER)
    .groupBy("group_id")
    .execute();
  return new Map(rows.map((r) => [r.group_id, Number(r.n)]));
}

async function activeUserOf(
  db: DbOrTx,
  organizationId: string,
  userId: string,
): Promise<{ display_name: string } | null> {
  const u = await db
    .selectFrom("app_user")
    .select(["display_name"])
    .where("id", "=", userId)
    .where("organization_id", "=", organizationId)
    .where("status", "=", "active")
    .executeTakeFirst();
  return u ?? null;
}

// ------------------------------------------------------------------------------------------------ access

/**
 * Write gate of a group mutation: read the organization (else 404), then group.manage on it, decided on grants reloaded
 * inside `tx` (commit-time authorisation; 403 with the denial attached so the failed-mutation audit records it).
 */
async function requireManage(tx: Tx, request: FastifyRequest, organizationId: string): Promise<string> {
  const target = await requireRead(tx, principalOf(request), READ, { type: "organization", id: organizationId });
  const fresh = await refreshPrincipal(tx, request);
  try {
    await requireAction(tx, fresh, MANAGE, target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  return fresh.userId!;
}

/** The group, readable by the caller (organization.read on its organization), or 404. */
async function readableGroup(db: DbOrTx, request: FastifyRequest, groupId: string, lock = false) {
  let q = db.selectFrom("access_group").selectAll().where("id", "=", groupId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  await requireRead(
    db,
    principalOf(request),
    READ,
    await targetFor(db, "organization", { organizationId: row.organization_id }),
  );
  return row;
}

/** Maps the two 0029 unique keys a concurrent request can still hit after the service's own check. */
function mapRace(err: unknown, code: string): unknown {
  const c = (err as { constraint?: string } | null)?.constraint;
  if (c === "access_group_org_code_key") return groupRefusals.codeTaken(code);
  if (c === "access_group_member_active_key") return groupRefusals.memberExists();
  return err;
}

// ------------------------------------------------------------------------------------------------ routes

export function registerGroupRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const ORG_GROUPS = "/api/v1/organizations/:organizationId/groups";
  const GROUP = "/api/v1/groups/:groupId";
  const MEMBERS = `${GROUP}/members`;
  const REMOVE = `${MEMBERS}/:memberId/remove`;

  app.get(ORG_GROUPS, { config: { access: { permission: READ } } }, async (request) => {
    const { organizationId } = parse(orgParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await requireRead(db, principalOf(request), READ, { type: "organization", id: organizationId });
    const hash = filterHash({ organizationId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("access_group").selectAll().where("organization_id", "=", organizationId);
    if (after) q = q.where(sql<boolean>`(code, id) > (${String(after[0])}, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("code")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.code, r.id], hash);
    const counts = await memberCounts(
      db,
      page.items.map((r) => r.id),
    );
    return { items: page.items.map((r) => toGroup(r, counts.get(r.id) ?? 0)), nextCursor: page.nextCursor };
  });

  app.post(ORG_GROUPS, { config: { access: { permission: MANAGE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { organizationId } = parse(orgParams, request.params, "params");
    const body = parseBody(groupCreate, request.body);
    const row = await db
      .transaction()
      .execute(async (tx) => {
        const userId = await requireManage(tx, request, organizationId);
        if (!(await activeUserOf(tx, organizationId, body.ownerUserId))) throw groupRefusals.ownerInvalid();
        const taken = await tx
          .selectFrom("access_group")
          .select("id")
          .where("organization_id", "=", organizationId)
          .where("code", "=", body.code)
          .executeTakeFirst();
        if (taken) throw groupRefusals.codeTaken(body.code);
        const id = uuidv7();
        const created = await tx
          .insertInto("access_group")
          .values({
            id,
            organization_id: organizationId,
            code: body.code,
            name_en: body.nameEn,
            name_ar: body.nameAr,
            description: body.description ?? null,
            owner_user_id: body.ownerUserId,
            created_by: userId,
            updated_by: userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, auditContextOf(request), {
          action: "access_group.create",
          recordType: "access_group",
          recordId: id,
          organizationId,
          newVersion: 1,
          changes: changesOf({}, created),
        });
        return created;
      })
      .catch((err: unknown) => {
        throw mapRace(err, body.code);
      });
    return sendVersioned(reply, 201, toGroup(row, 0), `/api/v1/groups/${row.id}`);
  });

  app.get(GROUP, { config: { access: { permission: READ } } }, async (request, reply) => {
    const { groupId } = parse(groupParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    const row = await readableGroup(db, request, groupId);
    const counts = await memberCounts(db, [row.id]);
    return sendVersioned(reply, 200, toGroup(row, counts.get(row.id) ?? 0));
  });

  app.patch(GROUP, { config: { access: { permission: MANAGE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { groupId } = parse(groupParams, request.params, "params");
    const body = parseBody(groupUpdate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const located = await readableGroup(tx, request, groupId);
      const userId = await requireManage(tx, request, located.organization_id);
      const expected = requireIfMatch(request);
      const current = await readableGroup(tx, request, groupId, true);
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (body.ownerUserId !== undefined && !(await activeUserOf(tx, current.organization_id, body.ownerUserId)))
        throw groupRefusals.ownerInvalid();
      const updated = await tx
        .updateTable("access_group")
        .set({
          ...(body.nameEn !== undefined ? { name_en: body.nameEn } : {}),
          ...(body.nameAr !== undefined ? { name_ar: body.nameAr } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", groupId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "access_group.update",
        recordType: "access_group",
        recordId: groupId,
        organizationId: current.organization_id,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: changesOf(current, updated),
      });
      return updated;
    });
    const counts = await memberCounts(db, [row.id]);
    return sendVersioned(reply, 200, toGroup(row, counts.get(row.id) ?? 0));
  });

  app.get(MEMBERS, { config: { access: { permission: READ } } }, async (request) => {
    const { groupId } = parse(groupParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await readableGroup(db, request, groupId);
    const hash = filterHash({ groupId });
    const after = decodeCursor(query.cursor, hash, 2);
    const RANK = sql<number>`(CASE WHEN m.removed_at IS NULL THEN 0 ELSE 1 END)`;
    let q = db
      .selectFrom("access_group_member as m")
      .innerJoin("app_user as u", "u.id", "m.user_id")
      .selectAll("m")
      .select(["u.display_name", RANK.as("rank")])
      .where("m.group_id", "=", groupId);
    if (after) q = q.where(sql<boolean>`(${RANK}, m.id) > (${Number(after[0])}::integer, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy(RANK)
      .orderBy("m.id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [Number(r.rank), r.id], hash);
    return { items: page.items.map((r) => toGroupMember(r, r.display_name)), nextCursor: page.nextCursor };
  });

  app.post(MEMBERS, { config: { access: { permission: MANAGE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { groupId } = parse(groupParams, request.params, "params");
    const body = parseBody(groupMemberCreate, request.body);
    const result = await db
      .transaction()
      .execute(async (tx) => {
        const located = await readableGroup(tx, request, groupId);
        const userId = await requireManage(tx, request, located.organization_id);
        const group = await readableGroup(tx, request, groupId, true);
        if (group.status !== "active") throw groupRefusals.archived();
        const user = await activeUserOf(tx, group.organization_id, body.userId);
        if (!user) throw groupRefusals.memberOtherOrganization();
        if (body.effectiveTo !== undefined) {
          const from = body.effectiveFrom === undefined ? Date.now() : Date.parse(body.effectiveFrom);
          if (Date.parse(body.effectiveTo) <= from) throw groupRefusals.memberWindowInvalid();
        }
        const existing = await tx
          .selectFrom("access_group_member")
          .select("id")
          .where("group_id", "=", groupId)
          .where("user_id", "=", body.userId)
          .where("removed_at", "is", null)
          .executeTakeFirst();
        if (existing) throw groupRefusals.memberExists();
        const id = uuidv7();
        const created = await tx
          .insertInto("access_group_member")
          .values({
            id,
            organization_id: group.organization_id,
            group_id: groupId,
            user_id: body.userId,
            ...(body.effectiveFrom !== undefined ? { effective_from: new Date(body.effectiveFrom) } : {}),
            effective_to: body.effectiveTo === undefined ? null : new Date(body.effectiveTo),
            created_by: userId,
            updated_by: userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, auditContextOf(request), {
          action: "access_group_member.create",
          recordType: "access_group_member",
          recordId: id,
          organizationId: group.organization_id,
          newVersion: 1,
          changes: {
            group_id: { from: null, to: groupId },
            user_id: { from: null, to: body.userId },
            effective_from: { from: null, to: iso(created.effective_from) },
            effective_to: { from: null, to: isoOrNull(created.effective_to) },
          },
        });
        return { row: created, displayName: user.display_name };
      })
      .catch((err: unknown) => {
        throw mapRace(err, "");
      });
    return sendVersioned(
      reply,
      201,
      toGroupMember(result.row, result.displayName),
      `/api/v1/groups/${groupId}/members/${result.row.id}`,
    );
  });

  app.post(REMOVE, { config: { access: { permission: MANAGE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { groupId, memberId } = parse(memberParams, request.params, "params");
    const body = parseBody(reasonRequest, request.body);
    const result = await db.transaction().execute(async (tx) => {
      const located = await readableGroup(tx, request, groupId);
      const userId = await requireManage(tx, request, located.organization_id);
      const expected = requireIfMatch(request);
      const current = await tx
        .selectFrom("access_group_member")
        .selectAll()
        .where("id", "=", memberId)
        .where("group_id", "=", groupId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.removed_at !== null) throw groupRefusals.memberRemoved();
      const updated = await tx
        .updateTable("access_group_member")
        .set({
          removed_at: sql<Date>`now()`,
          removed_by: userId,
          remove_reason: body.reason,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", memberId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "access_group_member.remove",
        recordType: "access_group_member",
        recordId: memberId,
        organizationId: current.organization_id,
        priorVersion: current.version,
        newVersion: updated.version,
        reason: body.reason,
        changes: { removed_at: { from: null, to: isoOrNull(updated.removed_at) } },
      });
      const user = await tx
        .selectFrom("app_user")
        .select("display_name")
        .where("id", "=", current.user_id)
        .executeTakeFirstOrThrow();
      return { row: updated, displayName: user.display_name };
    });
    return sendVersioned(reply, 200, toGroupMember(result.row, result.displayName));
  });

  return [
    `GET ${ORG_GROUPS}`,
    `POST ${ORG_GROUPS}`,
    `GET ${GROUP}`,
    `PATCH ${GROUP}`,
    `GET ${MEMBERS}`,
    `POST ${MEMBERS}`,
    `POST ${REMOVE}`,
  ];
}
