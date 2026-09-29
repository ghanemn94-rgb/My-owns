import type { INestApplicationContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Classification } from '@hub/domain';
import { DbService } from '../platform/db.service';
import { ScopeService } from '../platform/auth/scope.service';
import { projectIdsOf, RequestContext } from '../platform/context';
import { OrgService } from '../platform/org.service';

/**
 * Builds a real RequestContext for a (demo) user so seed data goes through the same services, permission checks,
 * audit and outbox as interactive use.
 */
export async function contextForUser(app: INestApplicationContext, email: string): Promise<RequestContext> {
  const db = app.get(DbService);
  const scopes = app.get(ScopeService);
  const orgId = await app.get(OrgService).defaultOrgId();
  const { rows } = await db.pool.query<{ id: string; org_id: string; display_name: string; clearance: Classification; is_demo: boolean; is_active: boolean }>(
    `select * from hub_auth_user_by_email($1, $2)`,
    [orgId, email],
  );
  const u = rows[0];
  if (!u || !u.is_active) throw new Error(`seed user ${email} not found or inactive`);
  const principal = await scopes.resolveUser({ userId: u.id, orgId: u.org_id, displayName: u.display_name, email, clearance: u.clearance, isDemo: u.is_demo });
  return { principal, correlationId: `seed-${randomUUID()}`, sessionId: null, ip: null, authMethod: 'seed', projectIds: projectIdsOf(principal), locale: 'en' };
}

/** Run `fn` as a user inside one transaction (fresh scope each call). */
export async function asUser<T>(app: INestApplicationContext, email: string, fn: (ctx: RequestContext) => Promise<T>): Promise<T> {
  const ctx = await contextForUser(app, email);
  return app.get(DbService).run(ctx, () => fn(ctx));
}
