import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { notFound, invalid, forbidden } from '@hub/domain';
import { APP_CONFIG, AppConfig } from '../../platform/config';
import { DbService } from '../../platform/db.service';
import { SessionService } from '../../platform/auth/session.service';
import { OrgService } from '../../platform/org.service';
import { randomToken } from '../../platform/ids';

type OidcClient = typeof import('openid-client');

interface PendingLogin {
  state: string;
  verifier: string;
  nonce: string;
  exp: number;
}

/**
 * Enterprise login via OIDC Authorization Code + PKCE (ADR-0005). MFA is enforced by the IdP. SAML-only IdPs are
 * supported through an OIDC-capable broker. Users are NOT auto-provisioned: the IdP identity must map to an active,
 * pre-provisioned user (by issuer+subject, or by email on first login when HUB_OIDC_LINK_BY_EMAIL=true).
 */
@Injectable()
export class OidcService {
  private readonly log = new Logger('oidc');
  private configPromise: Promise<import('openid-client').Configuration> | null = null;
  private lib: OidcClient | null = null;
  /** Honest connection state for the admin/login screens. */
  status: 'configured_unverified' | 'verified' | 'failed' = 'configured_unverified';

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly sessions: SessionService,
    private readonly orgs: OrgService,
  ) {}

  get enabled(): boolean {
    return !!(this.config.oidc.issuer && this.config.oidc.clientId && this.config.oidc.redirectUri);
  }

  private async client(): Promise<{ lib: OidcClient; cfg: import('openid-client').Configuration }> {
    if (!this.enabled) throw notFound();
    // openid-client v6 is ESM-only; Node >= 22.12 supports require(esm).
    this.lib ??= (await import('openid-client')) as OidcClient;
    const lib = this.lib;
    this.configPromise ??= lib.discovery(
      new URL(this.config.oidc.issuer!),
      this.config.oidc.clientId!,
      this.config.oidc.clientSecret ?? undefined,
      undefined,
      // Always verify ID-token signatures against the IdP's JWKS (defence in depth beyond TLS — OIDC Core §3.1.3.7
      // would allow skipping it for tokens from the token endpoint). Plain-HTTP issuers only outside production (test IdP).
      { execute: this.config.nodeEnv === 'production' ? [lib.enableNonRepudiationChecks] : [lib.enableNonRepudiationChecks, lib.allowInsecureRequests] },
    );
    try {
      const cfg = await this.configPromise;
      this.status = 'verified';
      return { lib, cfg };
    } catch (e) {
      this.configPromise = null;
      this.status = 'failed';
      throw e;
    }
  }

  private secret(): string {
    const s = this.config.cookieSecret;
    if (!s) throw new Error('HUB_COOKIE_SECRET is required when OIDC is enabled');
    return s;
  }

  private seal(p: PendingLogin): string {
    const body = Buffer.from(JSON.stringify(p)).toString('base64url');
    const mac = createHmac('sha256', this.secret()).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  private unseal(v: string | undefined): PendingLogin {
    if (!v) throw invalid('oidc.missing_state', 'Login state missing or expired — start again');
    const [body, mac] = v.split('.');
    if (!body || !mac) throw invalid('oidc.bad_state', 'Invalid login state');
    const expected = createHmac('sha256', this.secret()).update(body).digest();
    const got = Buffer.from(mac, 'base64url');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw invalid('oidc.bad_state', 'Invalid login state');
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as PendingLogin;
    if (p.exp < Date.now()) throw invalid('oidc.state_expired', 'Login state expired — start again');
    return p;
  }

  /** Returns the IdP authorization URL and the sealed pending-login cookie value. */
  async begin(): Promise<{ url: string; cookie: string }> {
    const { lib, cfg } = await this.client();
    const verifier = lib.randomPKCECodeVerifier();
    const challenge = await lib.calculatePKCECodeChallenge(verifier);
    const state = lib.randomState();
    const nonce = lib.randomNonce();
    const url = lib.buildAuthorizationUrl(cfg, {
      redirect_uri: this.config.oidc.redirectUri!,
      scope: 'openid email profile',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      nonce,
      // REQ-SEC-008: ask the IdP for the required authentication context (the ID token is still checked on return).
      ...(this.config.mfa.requiredAcr.length ? { acr_values: this.config.mfa.requiredAcr.join(' ') } : {}),
    });
    return { url: url.href, cookie: this.seal({ state, verifier, nonce, exp: Date.now() + 10 * 60_000 }) };
  }

  /** Completes the login: validates state/PKCE/nonce, maps the identity to a pre-provisioned active user, creates a session. */
  async complete(currentUrl: URL, sealed: string | undefined, meta: { ip: string | null; userAgent: string | null }) {
    const { lib, cfg } = await this.client();
    const pending = this.unseal(sealed);
    const tokens = await lib.authorizationCodeGrant(cfg, currentUrl, {
      pkceCodeVerifier: pending.verifier,
      expectedState: pending.state,
      expectedNonce: pending.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub || !claims.iss) throw forbidden('oidc.no_subject', 'The identity provider did not return a subject');
    this.assertMfa(claims);
    const orgId = await this.orgs.defaultOrgId();
    type UserRow = { id: string; org_id: string; is_active: boolean; is_demo: boolean; is_service_account: boolean; locale: string };
    let user: UserRow | undefined = (await this.db.pool.query<UserRow>(`select * from hub_auth_user_by_subject($1, $2)`, [claims.iss, claims.sub])).rows[0];
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
    // Link-by-email is a FIRST-login binding only (SEC-P1-01): the IdP must assert a verified email, and the pre-provisioned
    // user must not be bound to any identity yet. An already-bound account is never reachable through another subject.
    if (!user && email && this.config.oidc.linkByEmail && claims.email_verified === true) {
      const byEmail: UserRow | undefined = (await this.db.pool.query<UserRow>(`select * from hub_auth_user_by_email($1, $2)`, [orgId, email])).rows[0];
      if (byEmail && !byEmail.is_demo && !byEmail.is_service_account && (await this.linkSubject(byEmail.id, claims.iss, claims.sub))) user = byEmail;
    }
    // Service / non-person accounts never sign in interactively (I-R5): refused even when an IdP subject maps to one.
    if (user?.is_service_account) {
      this.log.warn(`OIDC login refused for subject at ${claims.iss} (service account)`);
      throw forbidden('oidc.service_account', 'Service accounts cannot sign in interactively');
    }
    if (!user || !user.is_active || user.is_demo) {
      this.log.warn(`OIDC login refused for subject at ${claims.iss} (not provisioned or inactive)`);
      throw forbidden('oidc.not_provisioned', 'Your account is not provisioned in this application — contact the administrator');
    }
    const s = await this.sessions.create({ userId: user.id, orgId: user.org_id, authMethod: 'oidc', ip: meta.ip, userAgent: meta.userAgent });
    await this.db.query(`update app_user set last_login_at = now() where id = $1`, [user.id]);
    return { ...s, userId: user.id, orgId: user.org_id, locale: user.locale };
  }

  /**
   * REQ-SEC-008: MFA is performed by the IdP; when the deployment requires evidence of it (HUB_OIDC_REQUIRED_AMR — any of
   * the listed `amr` methods, e.g. `mfa,otp,hwk`; HUB_OIDC_REQUIRED_ACR — one of the listed `acr` values), a sign-in whose
   * ID token carries none of them is refused (403 `oidc.mfa_required`, audited as a denied login). Either list suffices
   * when both are set. Without configuration the IdP policy alone applies (a startup warning says so in production).
   */
  private assertMfa(claims: Record<string, unknown>) {
    const { requiredAmr, requiredAcr } = this.config.mfa;
    if (!requiredAmr.length && !requiredAcr.length) return;
    const amr = Array.isArray(claims.amr) ? claims.amr.map(String) : [];
    const acr = typeof claims.acr === 'string' ? claims.acr : null;
    const ok = (requiredAmr.length > 0 && amr.some((m) => requiredAmr.includes(m))) || (requiredAcr.length > 0 && acr !== null && requiredAcr.includes(acr));
    if (!ok) {
      this.log.warn(`OIDC login refused at ${String(claims.iss)}: no required MFA claim (amr=${amr.join('+') || '-'} acr=${acr ?? '-'})`);
      throw forbidden('oidc.mfa_required', 'The identity provider did not confirm multi-factor authentication for this sign-in');
    }
  }

  /**
   * Binds the IdP identity to a pre-provisioned user that has NO identity yet. Returns false (and changes nothing, audits
   * nothing) when the user is already bound — the caller must then refuse the login.
   */
  private async linkSubject(userId: string, issuer: string, subject: string): Promise<boolean> {
    const client = await this.db.pool.connect();
    try {
      await client.query('begin');
      const org = await this.orgs.defaultOrgId();
      await client.query(`select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)`, [org, userId]);
      const r = await client.query(
        `update app_user set oidc_issuer = $2, oidc_subject = $3, updated_at = now() where id = $1 and oidc_subject is null and oidc_issuer is null and is_active and not is_demo and not is_service_account`,
        [userId, issuer, subject],
      );
      if (r.rowCount !== 1) {
        await client.query('rollback');
        return false;
      }
      await client.query(
        `insert into audit_event (org_id, actor_user_id, actor_kind, action, entity_type, entity_id, reason) values ($1, $2, 'user', 'identity.oidc.link_subject', 'app_user', $2, 'first OIDC login bound the IdP subject')`,
        [org, userId],
      );
      await client.query('commit');
      return true;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  static readonly STATE_COOKIE = 'hub_oidc';
  static newCorrelation() {
    return randomToken(8);
  }
}
