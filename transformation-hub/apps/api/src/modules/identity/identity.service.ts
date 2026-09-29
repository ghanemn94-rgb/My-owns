import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { notFound, ruleViolation, invalid } from '@hub/domain';
import type { Me } from '@hub/contracts';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { SessionService } from '../../platform/auth/session.service';
import { APP_CONFIG, AppConfig } from '../../platform/config';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { OutboxService } from '../../platform/outbox.service';
import { likeContains } from '../../platform/helpers';

@Injectable()
export class IdentityService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async me(ctx: RequestContext, csrfToken: string): Promise<Me> {
    const tx = this.db.tx();
    const p = ctx.principal;
    const [org] = await tx.select().from(schema.organization).where(eq(schema.organization.id, p.orgId));
    const [user] = await tx.select().from(schema.appUser).where(eq(schema.appUser.id, p.userId!));
    if (!org || !user) throw notFound();
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName, locale: user.locale, clearance: user.clearance, isDemo: user.isDemo },
      org: { id: org.id, name: org.name, slug: org.slug },
      orgRoles: [...p.orgRoles],
      orgPermissions: [...this.policy.orgPermissions(p)].sort(),
      projects: [...p.projects.values()].map((s) => ({
        projectId: s.projectId,
        roles: [...s.roles],
        workstreamRoles: s.workstreamRoles,
        permissions: this.policy.effectivePermissions(p, s.projectId),
        roomIds: [...s.roomIds],
      })),
      mode: { demo: this.config.demoMode, authMethod: ctx.authMethod ?? 'unknown' },
      csrfToken,
    };
  }

  async setLocale(ctx: RequestContext, locale: 'en' | 'ar') {
    await this.db.tx().update(schema.appUser).set({ locale, updatedAt: new Date() }).where(eq(schema.appUser.id, ctx.principal.userId!));
  }

  // ------------------------------------------------------------------------------------------------------------
  // Demo identities (HUB_MODE=demo only). Never available in standard/production mode (ADR-0005).

  assertDemoMode() {
    if (!this.config.demoMode) throw notFound();
  }

  async demoUsers() {
    this.assertDemoMode();
    const tx = this.db.tx();
    const users = await tx
      .select({ id: schema.appUser.id, displayName: schema.appUser.displayName, email: schema.appUser.email, title: schema.appUser.title })
      .from(schema.appUser)
      .where(and(eq(schema.appUser.isDemo, true), eq(schema.appUser.isActive, true), eq(schema.appUser.isServiceAccount, false)))
      .orderBy(asc(schema.appUser.displayName));
    const roleRows = await this.db.query<{ user_id: string; roles: string }>(
      `select uid as user_id, string_agg(distinct s.role, ', ') as roles
         from unnest($1::uuid[]) as uid cross join lateral hub_auth_user_scope(uid) s
        where s.role is not null group by uid`,
      [users.map((u) => u.id)],
    );
    const rm = new Map(roleRows.rows.map((r) => [r.user_id, r.roles]));
    return {
      items: users.map((u) => ({ ...u, roleSummary: rm.get(u.id) ?? 'no roles' })),
      notice: 'DEMO MODE — synthetic users and data only. Not for real Mobily information.',
    };
  }

  async demoLogin(ctx: RequestContext, userId: string, ip: string | null, userAgent: string | null) {
    this.assertDemoMode();
    const [u] = await this.db.tx().select().from(schema.appUser).where(eq(schema.appUser.id, userId));
    if (!u || !u.isDemo || !u.isActive || u.isServiceAccount) throw notFound();
    const s = await this.sessions.create({ userId: u.id, orgId: u.orgId, authMethod: 'dev', ip, userAgent });
    await this.db.tx().update(schema.appUser).set({ lastLoginAt: new Date() }).where(eq(schema.appUser.id, u.id));
    await this.audit.record({ action: 'identity.login', entityType: 'app_user', entityId: u.id, reason: 'demo login (synthetic user)' });
    return { ...s, locale: u.locale };
  }

  async logout(ctx: RequestContext) {
    if (ctx.sessionId) await this.sessions.revoke(ctx.sessionId, 'logout');
    await this.audit.record({ action: 'identity.logout', entityType: 'session', entityId: ctx.sessionId });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Account administration (no transaction content)

  async listUsers(ctx: RequestContext, q: { page: number; pageSize: number; q?: string }) {
    this.policy.assertOrg(ctx, 'admin.users.read');
    const tx = this.db.tx();
    const where = q.q ? or(ilike(schema.appUser.displayName, likeContains(q.q)), ilike(schema.appUser.email, likeContains(q.q))) : undefined;
    const [{ total }] = (await tx.select({ total: count() }).from(schema.appUser).where(where)) as [{ total: number }];
    const rows = await tx
      .select()
      .from(schema.appUser)
      .where(where)
      .orderBy(asc(schema.appUser.displayName))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return {
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        title: u.title,
        clearance: u.clearance,
        isActive: u.isActive,
        isDemo: u.isDemo,
        accountType: u.accountType as 'internal' | 'external',
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(total),
    };
  }

  async createUser(ctx: RequestContext, body: { email: string; displayName: string; title?: string; clearance: 'public' | 'internal' | 'confidential' | 'restricted' | 'strictly_confidential'; accountType: 'internal' | 'external' }) {
    this.policy.assertOrg(ctx, 'admin.users.manage');
    const email = body.email.trim().toLowerCase();
    // Clearance above "internal" must be granted through admin.clearance.grant (separate, audited, not_self).
    if (!['public', 'internal'].includes(body.clearance)) {
      throw ruleViolation('identity.clearance_requires_grant', 'Clearance above "internal" must be granted separately (admin.clearance.grant)');
    }
    const tx = this.db.tx();
    const exists = await tx.select({ id: schema.appUser.id }).from(schema.appUser).where(sql`lower(${schema.appUser.email}) = ${email}`);
    if (exists.length) throw invalid('identity.email_exists', 'A user with this email already exists');
    const id = newId();
    const [u] = await tx
      .insert(schema.appUser)
      .values({ id, orgId: ctx.principal.orgId, email, displayName: body.displayName, title: body.title ?? null, clearance: body.clearance, isDemo: false, accountType: body.accountType })
      .returning();
    await this.audit.record({ action: 'admin.users.create', entityType: 'app_user', entityId: id, after: { email, displayName: body.displayName, clearance: body.clearance, accountType: body.accountType } });
    return {
      id: u!.id,
      email: u!.email,
      displayName: u!.displayName,
      title: u!.title,
      clearance: u!.clearance,
      isActive: u!.isActive,
      isDemo: u!.isDemo,
      accountType: u!.accountType as 'internal' | 'external',
      lastLoginAt: null,
    };
  }

  async deactivateUser(ctx: RequestContext, userId: string, reason: string) {
    this.policy.assertOrg(ctx, 'admin.users.manage');
    if (userId === ctx.principal.userId) throw ruleViolation('identity.self_deactivation', 'You cannot deactivate your own account');
    const tx = this.db.tx();
    const [u] = await tx.select().from(schema.appUser).where(eq(schema.appUser.id, userId));
    if (!u) throw notFound();
    // Idempotent: deactivating an inactive account changes nothing (no expectedVersion needed for a one-way switch).
    if (!u.isActive) return;
    await tx.update(schema.appUser).set({ isActive: false, deactivatedAt: new Date(), updatedAt: new Date(), version: sql`${schema.appUser.version} + 1` }).where(eq(schema.appUser.id, userId));
    // Same transaction: sessions revoked, audit row and permission.changed event commit (or roll back) together.
    await this.sessions.revokeAllForUser(userId, `deactivated: ${reason}`);
    await this.audit.record({ action: 'admin.users.deactivate', entityType: 'app_user', entityId: userId, reason, before: { isActive: true }, after: { isActive: false } });
    await this.outbox.emit({ type: 'permission.changed', projectId: null, aggregateType: 'app_user', aggregateId: userId, payload: { userId, change: 'deactivated' } });
  }
}
