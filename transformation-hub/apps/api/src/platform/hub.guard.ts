import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { forbidden, notFound, isKnownPermission } from '@hub/domain';
import type { RouteDef } from '@hub/contracts';
import { ROUTE_META, HubRequest } from './contracts';
import { SessionService } from './auth/session.service';
import { ScopeService } from './auth/scope.service';
import { PolicyService } from './policy.service';
import { OrgService } from './org.service';
import { APP_CONFIG, AppConfig } from './config';
import { RequestContext, withDbScope } from './context';
import { RateLimiter } from './rate-limiter';
import { AuditService } from './audit.service';
import { Logger } from '@nestjs/common';
import type { Classification } from '@hub/domain';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard implementing the first half of the mandatory flow:
 *   authenticate (session) → CSRF (non-GET) → resolve fresh scope → project in scope? (else 404)
 *   → route-level RBAC (else 403) → contract validation of params/query/body (else 400).
 * Services then apply resource-level ABAC via PolicyService.assert().
 */
@Injectable()
export class HubGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly scopes: ScopeService,
    private readonly policy: PolicyService,
    private readonly orgs: OrgService,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private readonly log = new Logger('guard');

  private sessionOnlyCtx(session: { sessionId: string; userId: string; orgId: string; displayName: string; email: string; clearance: string; isDemo: boolean }, correlationId: string, ip: string | null, locale: 'en' | 'ar'): RequestContext {
    return withDbScope({
      principal: { kind: 'user', userId: session.userId, orgId: session.orgId, displayName: session.displayName, email: session.email, clearance: session.clearance as Classification, isDemo: session.isDemo, orgRoles: new Set(), projects: new Map() },
      correlationId,
      sessionId: session.sessionId,
      ip,
      authMethod: null,
      projectIds: [],
      locale,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<HubRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    if (this.reflector.get<boolean>('hub:infra', context.getClass())) return true;
    const route = this.reflector.get<RouteDef | undefined>(ROUTE_META, context.getHandler());
    if (!route) throw new HttpException({ message: 'Route has no contract', code: 'contract.missing' }, 500);
    req.hubRouteId = route.id;

    const correlationId = (typeof req.headers['x-correlation-id'] === 'string' && /^[\w-]{8,64}$/.test(req.headers['x-correlation-id'])
      ? req.headers['x-correlation-id']
      : randomUUID()) as string;
    res.setHeader('x-correlation-id', correlationId);
    req.headers['x-correlation-id'] = correlationId; // problem bodies of early denials carry it too (SEC-P1-11)
    const ip = req.ip ?? null;
    const locale: 'en' | 'ar' = req.cookies?.hub_locale === 'ar' ? 'ar' : 'en';

    if (route.access === 'public') {
      if (!this.limiter.hit(ip ?? 'unknown', 'public')) throw new HttpException({ message: 'Too many requests', code: 'rate_limited' }, 429);
      const orgId = await this.orgs.defaultOrgId();
      req.hubCtx = {
        principal: {
          kind: 'user',
          userId: null,
          orgId,
          displayName: 'anonymous',
          email: null,
          clearance: 'public',
          isDemo: false,
          orgRoles: new Set(),
          projects: new Map(),
        },
        correlationId,
        sessionId: null,
        ip,
        authMethod: null,
        projectIds: [],
        fullProjectIds: [],
        roomIds: [],
        locale,
      };
      this.validate(route, req);
      return true;
    }

    const session = await this.sessions.resolve(req.cookies?.[SessionService.COOKIE]);
    if (!session) throw new HttpException({ message: 'Authentication required', code: 'auth.required' }, 401);
    if (!SAFE_METHODS.has(req.method) && !this.sessions.verifyCsrf(session, req.headers[SessionService.CSRF_HEADER] as string | undefined)) {
      // Security event: audited for the session user (SEC-P1-11). No project context is attached (none resolved yet).
      await this.audit.recordDetached(this.sessionOnlyCtx(session, correlationId, ip, locale), {
        action: 'auth.csrf',
        outcome: 'denied',
        entityType: 'request',
        reason: `CSRF token missing or invalid on ${req.method} ${route.id}`,
      });
      throw new HttpException({ message: 'CSRF token missing or invalid', code: 'auth.csrf' }, 403);
    }
    if (!this.limiter.hit(session.sessionId, SAFE_METHODS.has(req.method) ? 'read' : 'mutation')) {
      // Not audited per request (would let a client flood the audit chain); logged with the session for SIEM correlation.
      this.log.warn(`rate limit exceeded: session=${session.sessionId} route=${route.id} correlation=${correlationId}`);
      throw new HttpException({ message: 'Too many requests', code: 'rate_limited' }, 429);
    }
    this.sessions.touch(session.sessionId).catch((e: unknown) => this.log.warn(`session touch failed: ${(e as Error).message}`));

    const principal = await this.scopes.resolveUser({
      userId: session.userId,
      orgId: session.orgId,
      displayName: session.displayName,
      email: session.email,
      clearance: session.clearance as Classification,
      isDemo: session.isDemo,
    });
    const ctx: RequestContext = withDbScope({
      principal,
      correlationId,
      sessionId: session.sessionId,
      ip,
      authMethod: session.authMethod,
      projectIds: [],
      locale: session.locale === 'ar' ? 'ar' : locale,
    });
    req.hubCtx = ctx;

    const projectId = (req.params as Record<string, string>)?.projectId;
    if (projectId !== undefined) {
      // Out-of-scope (or malformed) project ids are indistinguishable from non-existent ones.
      if (!/^[0-9a-f-]{36}$/i.test(projectId) || !principal.projects.has(projectId)) throw notFound();
    }

    if (typeof route.access === 'object') {
      this.policy.assertOrg(ctx, route.access.org);
    } else if (route.access !== 'authenticated') {
      if (!isKnownPermission(route.access)) throw new Error(`Route ${route.id} references unknown permission ${route.access}`);
      if (!projectId) throw new Error(`Route ${route.id} requires :projectId for project permission ${route.access}`);
      if (!this.policy.canInProject(ctx, route.access, projectId)) {
        throw forbidden('policy.forbidden', `Missing permission ${route.access}`);
      }
    }

    this.validate(route, req);
    return true;
  }

  private validate(route: RouteDef, req: HubRequest) {
    const params = route.params.parse(req.params ?? {});
    const query = route.query.parse(req.query ?? {});
    let body: unknown;
    if (route.upload) {
      if (!Buffer.isBuffer(req.body)) throw new HttpException({ message: 'Expected application/octet-stream body', code: 'upload.content_type' }, 415);
      (req as HubRequest).hubRaw = req.body as Buffer;
      body = {};
    } else {
      body = route.method === 'GET' ? route.body.parse({}) : route.body.parse(req.body ?? {});
    }
    req.hubInput = { params, query, body } as HubRequest['hubInput'];
  }
}
