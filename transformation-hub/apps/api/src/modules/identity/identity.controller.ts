import { Controller, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { identityRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { IdentityService } from './identity.service';
import { SessionService } from '../../platform/auth/session.service';
import { APP_CONFIG, AppConfig } from '../../platform/config';
import { OidcService } from './oidc.service';
import { AuditService } from '../../platform/audit.service';

@Controller()
export class IdentityController {
  constructor(
    private readonly svc: IdentityService,
    private readonly sessions: SessionService,
    private readonly oidc: OidcService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private setCookies(res: Response, token: string | null, csrf: string) {
    const base = { sameSite: 'lax' as const, secure: this.config.cookieSecure, path: '/' };
    if (token) res.cookie(SessionService.COOKIE, token, { ...base, httpOnly: true, maxAge: this.config.sessionAbsoluteHours * 3_600_000 });
    // CSRF cookie is readable by the SPA (double-submit pattern); it is useless without the httpOnly session cookie.
    res.cookie(SessionService.CSRF_COOKIE, csrf, { ...base, httpOnly: false, maxAge: this.config.sessionAbsoluteHours * 3_600_000 });
  }

  @ApiRoute(R.me)
  async me(@Ctx() ctx: RequestContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let csrf = req.cookies?.[SessionService.CSRF_COOKIE] as string | undefined;
    if (!csrf) {
      csrf = await this.sessions.rotateCsrf(ctx.sessionId!);
      this.setCookies(res, null, csrf);
    }
    return this.svc.me(ctx, csrf);
  }

  @ApiRoute(R.setLocale)
  async setLocale(@Ctx() ctx: RequestContext, @Input() input: RouteInput<typeof R.setLocale>, @Res({ passthrough: true }) res: Response) {
    await this.svc.setLocale(ctx, input.body.locale);
    res.cookie('hub_locale', input.body.locale, { sameSite: 'lax', secure: this.config.cookieSecure, path: '/', httpOnly: false });
    return { ok: true as const };
  }

  @ApiRoute(R.authConfig)
  authConfig() {
    return {
      demoLogin: this.config.demoMode,
      // Honest status: "verified" only after a successful discovery against the IdP in this process.
      oidc: this.oidc.enabled ? { status: this.oidc.status, loginUrl: '/api/v1/auth/oidc/login' } : { status: 'not_configured', loginUrl: null },
    };
  }

  @ApiRoute(R.oidcLogin)
  async oidcLogin(@Res() res: Response) {
    const { url, cookie } = await this.oidc.begin();
    res.cookie(OidcService.STATE_COOKIE, cookie, { httpOnly: true, sameSite: 'lax', secure: this.config.cookieSecure, path: '/api/v1/auth/oidc', maxAge: 10 * 60_000 });
    res.redirect(302, url);
  }

  @ApiRoute(R.oidcCallback)
  async oidcCallback(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.oidcCallback>, @Req() req: Request, @Res() res: Response) {
    if (i.query.error) {
      res.clearCookie(OidcService.STATE_COOKIE, { path: '/api/v1/auth/oidc' });
      res.redirect(302, `/login?sso_error=${encodeURIComponent(i.query.error)}`);
      return;
    }
    const current = new URL(`${this.config.oidc.redirectUri}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`);
    try {
      const s = await this.oidc.complete(current, req.cookies?.[OidcService.STATE_COOKIE], { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
      res.clearCookie(OidcService.STATE_COOKIE, { path: '/api/v1/auth/oidc' });
      this.setCookies(res, s.token, s.csrf);
      res.cookie('hub_locale', s.locale, { sameSite: 'lax', secure: this.config.cookieSecure, path: '/' });
      await this.audit.recordDetached({ ...ctx, principal: { ...ctx.principal, userId: s.userId, orgId: s.orgId } }, { action: 'identity.login', entityType: 'app_user', entityId: s.userId, reason: 'OIDC login' });
      res.redirect(302, '/');
    } catch (e) {
      res.clearCookie(OidcService.STATE_COOKIE, { path: '/api/v1/auth/oidc' });
      const code = (e as { code?: string }).code ?? 'oidc.failed';
      await this.audit.recordDetached(ctx, { action: 'identity.login', outcome: 'denied', entityType: 'request', reason: `OIDC login failed: ${code}` });
      res.redirect(302, `/login?sso_error=${encodeURIComponent(code)}`);
    }
  }

  @ApiRoute(R.demoUsers)
  demoUsers() {
    return this.svc.demoUsers();
  }

  @ApiRoute(R.demoLogin)
  async demoLogin(@Ctx() ctx: RequestContext, @Input() input: RouteInput<typeof R.demoLogin>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const s = await this.svc.demoLogin(ctx, input.body.userId, req.ip ?? null, req.headers['user-agent'] ?? null);
    this.setCookies(res, s.token, s.csrf);
    res.cookie('hub_locale', s.locale, { sameSite: 'lax', secure: this.config.cookieSecure, path: '/' });
    return { ok: true as const, csrfToken: s.csrf };
  }

  @ApiRoute(R.logout)
  async logout(@Ctx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    await this.svc.logout(ctx);
    res.clearCookie(SessionService.COOKIE, { path: '/' });
    res.clearCookie(SessionService.CSRF_COOKIE, { path: '/' });
    return { ok: true as const };
  }

  @ApiRoute(R.listUsers)
  listUsers(@Ctx() ctx: RequestContext, @Input() input: RouteInput<typeof R.listUsers>) {
    return this.svc.listUsers(ctx, input.query);
  }

  @ApiRoute(R.createUser)
  createUser(@Ctx() ctx: RequestContext, @Input() input: RouteInput<typeof R.createUser>) {
    return this.svc.createUser(ctx, input.body);
  }

  @ApiRoute(R.deactivateUser)
  async deactivateUser(@Ctx() ctx: RequestContext, @Input() input: RouteInput<typeof R.deactivateUser>) {
    await this.svc.deactivateUser(ctx, input.params.userId, input.body.reason);
    return { ok: true as const };
  }
}
