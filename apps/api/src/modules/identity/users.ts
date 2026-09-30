// app_user and user_identity (ADR-0005): the only writer of both tables. Admin routes call these; /me uses them.
// Users are never deleted: disabling sets status = disabled and revokes the user's sessions in the same transaction.
import { diffFields, sql, type AppUserRow, type DbOrTx, type Tx } from "@mth/db";
import type { User, UserCreate, UserUpdate } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { record, type AuditContext } from "../audit/index.ts";
import { PROBLEM_TYPES } from "@mth/shared";
import { decodeCursor, filterHash, HttpProblem, iso, isoOrNull, paginate, problems } from "../platform/index.ts";
import { revokeUserSessions } from "./sessions.ts";

export const USER_AUDIT_FIELDS = ["display_name", "email", "preferred_locale", "timezone", "status"] as const;

export async function identitiesOf(db: DbOrTx, userIds: readonly string[]) {
  if (userIds.length === 0) return new Map<string, User["identities"]>();
  const rows = await db
    .selectFrom("user_identity")
    .select(["user_id", "issuer", "subject", "created_at", "last_login_at"])
    .where("user_id", "in", [...userIds])
    .orderBy("created_at")
    .execute();
  const map = new Map<string, User["identities"]>();
  for (const r of rows) {
    const list = map.get(r.user_id) ?? [];
    list.push({
      issuer: r.issuer,
      subject: r.subject,
      createdAt: iso(r.created_at),
      lastLoginAt: isoOrNull(r.last_login_at),
    });
    map.set(r.user_id, list);
  }
  return map;
}

export function toUser(r: AppUserRow, identities: User["identities"]): User {
  return {
    id: r.id,
    organizationId: r.organization_id,
    displayName: r.display_name,
    email: r.email,
    preferredLocale: r.preferred_locale as "ar" | "en",
    timezone: r.timezone,
    status: r.status as "active" | "disabled",
    identities,
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function findUserRow(db: DbOrTx, id: string, forUpdate = false): Promise<AppUserRow | undefined> {
  let q = db.selectFrom("app_user").selectAll().where("id", "=", id);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

export async function loadUser(db: DbOrTx, id: string): Promise<User | null> {
  const row = await findUserRow(db, id);
  if (!row) return null;
  return toUser(row, (await identitiesOf(db, [id])).get(id) ?? []);
}

function mapUserUniqueViolation(e: unknown): never {
  const err = e as { code?: string; constraint?: string };
  if (err.code === "23505" && err.constraint === "app_user_org_email_key") {
    throw problems.duplicate("duplicate.email", "A user with this e-mail already exists in the organization.");
  }
  if (err.code === "23505" && err.constraint === "user_identity_issuer_subject_key") {
    throw problems.duplicate("duplicate.identity", "This identity (issuer, subject) is already bound to a user.");
  }
  throw e;
}

export async function createUser(tx: Tx, audit: AuditContext, input: UserCreate): Promise<User> {
  const id = uuidv7();
  const row = await tx
    .insertInto("app_user")
    .values({
      id,
      organization_id: input.organizationId,
      display_name: input.displayName,
      email: input.email ?? null,
      preferred_locale: input.preferredLocale ?? "ar",
      created_by: audit.actorUserId,
      updated_by: audit.actorUserId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
    .catch(mapUserUniqueViolation);
  if (input.identity) {
    await tx
      .insertInto("user_identity")
      .values({
        id: uuidv7(),
        user_id: id,
        issuer: input.identity.issuer,
        subject: input.identity.subject,
        email_at_binding: input.email ?? null,
      })
      .execute()
      .catch(mapUserUniqueViolation);
  }
  await record(tx, audit, {
    action: "app_user.create",
    recordType: "app_user",
    recordId: id,
    organizationId: input.organizationId,
    newVersion: 1,
    changes: {
      ...diffFields({} as Record<string, unknown>, row as unknown as Record<string, unknown>, [...USER_AUDIT_FIELDS]),
      ...(input.identity ? { identity: { from: null, to: input.identity } } : {}),
    },
  });
  return (await loadUser(tx, id))!;
}

/** Update display data or status. Disabling revokes every session of the user in the same transaction. */
export async function updateUser(
  tx: Tx,
  audit: AuditContext,
  current: AppUserRow,
  expectedVersion: number,
  input: UserUpdate,
): Promise<User> {
  if (current.version !== expectedVersion) throw problems.versionConflict(current.version);
  if (input.status === "disabled" && current.id === audit.actorUserId) {
    // updateUser declares no 422 in the contract: refusing to disable yourself is a 403 with a specific code.
    throw new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "user.cannot_disable_self",
      title: "Forbidden",
      detail: "You cannot disable your own account.",
    });
  }
  const updated = await tx
    .updateTable("app_user")
    .set({
      ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.preferredLocale !== undefined ? { preferred_locale: input.preferredLocale } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: audit.actorUserId,
    })
    .where("id", "=", current.id)
    .where("version", "=", expectedVersion)
    .returningAll()
    .executeTakeFirstOrThrow()
    .catch(mapUserUniqueViolation);
  let revoked = 0;
  if (current.status === "active" && updated.status === "disabled") revoked = await revokeUserSessions(tx, current.id);
  await record(tx, audit, {
    action:
      updated.status !== current.status
        ? updated.status === "disabled"
          ? "app_user.disable"
          : "app_user.enable"
        : "app_user.update",
    recordType: "app_user",
    recordId: current.id,
    organizationId: current.organization_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      ...diffFields(current, updated, [...USER_AUDIT_FIELDS]),
      ...(revoked > 0 ? { sessionsRevoked: { from: null, to: revoked } } : {}),
    },
  });
  return (await loadUser(tx, current.id))!;
}

export async function updatePreferences(
  tx: Tx,
  audit: AuditContext,
  userId: string,
  expectedVersion: number,
  input: { preferredLocale?: "ar" | "en" | undefined; timezone?: string | null | undefined },
): Promise<User> {
  const current = await findUserRow(tx, userId, true);
  if (!current) throw problems.notFound();
  if (current.version !== expectedVersion) throw problems.versionConflict(current.version);
  const updated = await tx
    .updateTable("app_user")
    .set({
      ...(input.preferredLocale !== undefined ? { preferred_locale: input.preferredLocale } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", userId)
    .where("version", "=", expectedVersion)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "app_user.update_preferences",
    recordType: "app_user",
    recordId: userId,
    organizationId: current.organization_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, ["preferred_locale", "timezone"]),
  });
  return (await loadUser(tx, userId))!;
}

export interface UserListQuery {
  organizationId: string;
  q?: string | undefined;
  status?: "active" | "disabled" | undefined;
  cursor?: string | undefined;
  limit: number;
}

export async function listUsers(
  db: DbOrTx,
  query: UserListQuery,
): Promise<{ items: User[]; nextCursor: string | null }> {
  const hash = filterHash({ ...query });
  const after = decodeCursor(query.cursor, hash, 2);
  let q = db
    .selectFrom("app_user")
    .selectAll()
    .select(sql<string>`lower(display_name)`.as("sort_name"))
    .where("organization_id", "=", query.organizationId);
  if (query.status) q = q.where("status", "=", query.status);
  if (query.q) {
    const like = `%${query.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    q = q.where((eb) =>
      eb.or([eb(eb.fn("lower", ["display_name"]), "like", like), eb(eb.fn("lower", ["email"]), "like", like)]),
    );
  }
  if (after) q = q.where(sql<boolean>`(lower(display_name), id) > (${String(after[0])}, ${String(after[1])}::uuid)`);
  const rows = await q
    .orderBy(sql`lower(display_name)`)
    .orderBy("id")
    .limit(query.limit + 1)
    .execute();
  const page = paginate(rows, query.limit, (r) => [r.sort_name, r.id], hash);
  const ids = await identitiesOf(
    db,
    page.items.map((r) => r.id),
  );
  return {
    items: page.items.map(({ sort_name: _s, ...r }) => toUser(r, ids.get(r.id) ?? [])),
    nextCursor: page.nextCursor,
  };
}
