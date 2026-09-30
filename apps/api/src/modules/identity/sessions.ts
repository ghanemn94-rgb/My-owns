// Server-side sessions in PostgreSQL (ADR-0005 §3) and the per-session CSRF synchronizer token (§4).
//  - The cookie carries 32 random bytes (base64url). Only SHA-256(token) is stored; raw tokens are never stored or logged.
//  - The CSRF token is HMAC-SHA256(key = session token, "mth-csrf-v1"): only the holder of the cookie can compute it,
//    GET /me returns it, and only SHA-256(csrf) is stored (session.csrf_token_hash) for constant-time verification.
//  - Idle timeout and absolute lifetime come from configuration; activity slides the idle expiry (never past the
//    absolute expiry). A session is valid only if not revoked, not expired and its user is active.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql, type DbOrTx, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";

export const sha256 = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

export function sessionCookieName(appBaseUrl: URL): string {
  return appBaseUrl.protocol === "https:" ? "__Host-mth_session" : "mth_session";
}

export function csrfTokenFor(sessionToken: string): string {
  return createHmac("sha256", sessionToken).update("mth-csrf-v1").digest("base64url");
}

export function csrfMatches(header: string | undefined, storedHash: Buffer): boolean {
  if (!header || header.length > 256) return false;
  const h = sha256(header);
  return h.length === storedHash.length && timingSafeEqual(h, storedHash);
}

export interface NewSession {
  readonly userId: string;
  readonly authMode: "oidc" | "dev";
  readonly idpIssuer: string | null;
  readonly idpSessionId: string | null;
  readonly userAgent: string | null;
  readonly idleMinutes: number;
  readonly absoluteHours: number;
}

export async function createSession(tx: Tx, s: NewSession): Promise<{ sessionId: string; token: string }> {
  const token = randomBytes(32).toString("base64url");
  const sessionId = uuidv7();
  await tx
    .insertInto("session")
    .values({
      id: sessionId,
      token_hash: sha256(token),
      user_id: s.userId,
      auth_mode: s.authMode,
      idp_issuer: s.idpIssuer,
      idp_session_id: s.idpSessionId,
      csrf_token_hash: sha256(csrfTokenFor(token)),
      idle_expires_at: sql<Date>`now() + make_interval(mins => ${s.idleMinutes})`,
      absolute_expires_at: sql<Date>`now() + make_interval(hours => ${s.absoluteHours})`,
      user_agent: s.userAgent ? s.userAgent.slice(0, 512) : null,
    })
    .execute();
  await tx
    .updateTable("app_user")
    .set({ last_login_at: sql<Date>`now()` })
    .where("id", "=", s.userId)
    .execute();
  return { sessionId, token };
}

export interface ActiveSession {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly authMode: "oidc" | "dev";
  readonly idpIssuer: string | null;
  readonly csrfTokenHash: Buffer;
  readonly lastSeenAt: Date;
  readonly token: string;
}

export async function resolveSession(db: DbOrTx, token: string): Promise<ActiveSession | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await db
    .selectFrom("session as s")
    .innerJoin("app_user as u", "u.id", "s.user_id")
    .select([
      "s.id",
      "s.user_id",
      "u.organization_id",
      "s.auth_mode",
      "s.idp_issuer",
      "s.csrf_token_hash",
      "s.last_seen_at",
    ])
    .where("s.token_hash", "=", sha256(token))
    .where("s.revoked_at", "is", null)
    .where("s.idle_expires_at", ">", sql<Date>`now()`)
    .where("s.absolute_expires_at", ">", sql<Date>`now()`)
    .where("u.status", "=", "active")
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    authMode: row.auth_mode as "oidc" | "dev",
    idpIssuer: row.idp_issuer,
    csrfTokenHash: row.csrf_token_hash,
    lastSeenAt: row.last_seen_at,
    token,
  };
}

/** Slide the idle expiry at most once a minute per session (keeps writes cheap). */
export async function touchSession(db: DbOrTx, session: ActiveSession, idleMinutes: number): Promise<void> {
  if (Date.now() - session.lastSeenAt.getTime() < 60_000) return;
  await db
    .updateTable("session")
    .set({
      last_seen_at: sql<Date>`now()`,
      idle_expires_at: sql<Date>`least(now() + make_interval(mins => ${idleMinutes}), absolute_expires_at)`,
    })
    .where("id", "=", session.id)
    .where("revoked_at", "is", null)
    .execute();
}

export async function revokeSession(tx: Tx, sessionId: string): Promise<boolean> {
  const r = await tx
    .updateTable("session")
    .set({ revoked_at: sql<Date>`now()` })
    .where("id", "=", sessionId)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  return Number(r.numUpdatedRows) > 0;
}

/** Revoke every live session of a user (user disabled, assignment revoked). Returns how many were revoked. */
export async function revokeUserSessions(tx: Tx, userId: string): Promise<number> {
  const r = await tx
    .updateTable("session")
    .set({ revoked_at: sql<Date>`now()` })
    .where("user_id", "=", userId)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  return Number(r.numUpdatedRows);
}
