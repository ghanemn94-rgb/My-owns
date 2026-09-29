import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@hub/db';
import { APP_CONFIG, AppConfig } from '../config';
import { DbService } from '../db.service';
import { Clock } from '../clock';
import { newId, randomToken, sha256Hex } from '../ids';

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  orgId: string;
  csrfHash: string;
  authMethod: string;
  userActive: boolean;
  clearance: string;
  locale: string;
  displayName: string;
  email: string;
  isDemo: boolean;
}

/**
 * Server-side sessions (ADR-0005). The cookie holds a random 256-bit token; the DB stores only SHA-256(token).
 * Lookups go through the narrow SECURITY DEFINER function `hub_auth_session` (no RLS context exists yet).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async resolve(token: string | undefined): Promise<ResolvedSession | null> {
    if (!token || token.length < 20 || token.length > 200) return null;
    const { rows } = await this.db.pool.query(`select * from hub_auth_session($1)`, [sha256Hex(token)]);
    const r = rows[0];
    if (!r) return null;
    const now = this.clock.now();
    if (r.revoked_at || !r.user_active) return null;
    if (new Date(r.idle_expires_at) <= now || new Date(r.absolute_expires_at) <= now) return null;
    return {
      sessionId: r.session_id,
      userId: r.user_id,
      orgId: r.org_id,
      csrfHash: r.csrf_hash,
      authMethod: r.auth_method,
      userActive: r.user_active,
      clearance: r.user_clearance,
      locale: r.user_locale,
      displayName: r.user_display_name,
      email: r.user_email,
      isDemo: r.user_is_demo,
    };
  }

  /** Slide the idle expiry (bounded by absolute expiry). `session` is not under RLS (ADR-0003). */
  async touch(sessionId: string): Promise<void> {
    const idle = new Date(this.clock.now().getTime() + this.config.sessionIdleMinutes * 60_000);
    await this.db.pool.query(
      `update session set last_seen_at = now(), idle_expires_at = least($2::timestamptz, absolute_expires_at)
        where id = $1 and revoked_at is null and last_seen_at < now() - interval '30 seconds'`,
      [sessionId, idle.toISOString()],
    );
  }

  async create(input: { userId: string; orgId: string; authMethod: 'dev' | 'oidc'; ip: string | null; userAgent: string | null }) {
    const token = randomToken(32);
    const csrf = randomToken(24);
    const now = this.clock.now();
    await this.db.query(
      `insert into session (id, token_hash, csrf_hash, user_id, org_id, auth_method, idle_expires_at, absolute_expires_at, ip, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        newId(),
        sha256Hex(token),
        sha256Hex(csrf),
        input.userId,
        input.orgId,
        input.authMethod,
        new Date(now.getTime() + this.config.sessionIdleMinutes * 60_000).toISOString(),
        new Date(now.getTime() + this.config.sessionAbsoluteHours * 3_600_000).toISOString(),
        input.ip,
        input.userAgent?.slice(0, 400) ?? null,
      ],
    );
    return { token, csrf };
  }

  /** Issue a fresh CSRF token for an existing session (e.g. after page reload). */
  async rotateCsrf(sessionId: string): Promise<string> {
    const csrf = randomToken(24);
    await this.db.query(`update session set csrf_hash = $2 where id = $1`, [sessionId, sha256Hex(csrf)]);
    return csrf;
  }

  async revoke(sessionId: string, reason: string) {
    await this.db.query(`update session set revoked_at = now(), revoked_reason = $2 where id = $1 and revoked_at is null`, [sessionId, reason]);
  }

  async revokeAllForUser(userId: string, reason: string) {
    await this.db.query(`update session set revoked_at = now(), revoked_reason = $2 where user_id = $1 and revoked_at is null`, [userId, reason]);
  }

  static readonly COOKIE = 'hub_session';
  static readonly CSRF_COOKIE = 'hub_csrf';
  static readonly CSRF_HEADER = 'x-csrf-token';

  verifyCsrf(session: ResolvedSession, headerValue: string | undefined): boolean {
    if (!headerValue || headerValue.length > 200) return false;
    return sha256Hex(headerValue) === session.csrfHash;
  }

  // Exposed for tests that need a direct lookup.
  async findUserOrg(userId: string) {
    return this.db.tx().select({ orgId: schema.appUser.orgId }).from(schema.appUser).where(eq(schema.appUser.id, userId));
  }
}
