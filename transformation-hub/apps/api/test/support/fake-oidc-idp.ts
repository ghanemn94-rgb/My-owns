import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Minimal in-process OpenID Provider for integration tests (NOT for any other use): discovery, JWKS, authorization
 * endpoint (auto-consents as `nextUser`), token endpoint with client authentication and PKCE S256 verification, and an
 * RS256-signed ID token carrying the nonce. It exercises the real openid-client code paths of the API.
 */
export interface FakeIdpUser {
  sub: string;
  email?: string;
  /** Defaults to true when an email is present. */
  emailVerified?: boolean;
  /** Authentication methods / context the IdP asserts (REQ-SEC-008), e.g. amr ['pwd','mfa'], acr 'urn:mfa'. */
  amr?: string[];
  acr?: string;
}

export class FakeOidcIdp {
  issuer = '';
  nextUser: FakeIdpUser | null = null;
  /** Negative testing: corrupt the next ID token in one specific way. */
  tamperNextToken: 'nonce' | 'signature' | 'audience' | 'issuer' | 'expired' | null = null;
  /** Number of token requests rejected (for assertions). */
  rejectedTokenRequests = 0;
  /** The `acr_values` the last authorization request asked for (REQ-SEC-008). */
  lastAcrValues: string | null = null;
  private server: Server | null = null;
  private readonly privateKey: KeyObject;
  private readonly jwk: Record<string, unknown>;
  private readonly kid = randomBytes(6).toString('hex');
  private readonly codes = new Map<string, { clientId: string; redirectUri: string; challenge: string; nonce: string; user: FakeIdpUser }>();

  constructor(
    readonly clientId: string,
    readonly clientSecret: string,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = privateKey;
    this.jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: this.kid, alg: 'RS256', use: 'sig' };
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      this.handle(req)
        .then((r) => {
          res.writeHead(r.status, r.headers);
          res.end(r.body ?? '');
        })
        .catch((e: Error) => {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(e.message);
        });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.issuer;
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private json(status: number, body: unknown) {
    return { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) };
  }

  private async handle(req: IncomingMessage): Promise<{ status: number; headers: Record<string, string>; body?: string }> {
    const url = new URL(req.url ?? '/', this.issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
      return this.json(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        scopes_supported: ['openid', 'email', 'profile'],
      });
    }
    if (url.pathname === '/jwks') return this.json(200, { keys: [this.jwk] });
    if (url.pathname === '/authorize') {
      const q = url.searchParams;
      if (q.get('client_id') !== this.clientId || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) {
        return this.json(400, { error: 'invalid_request' });
      }
      if (!this.nextUser) return this.json(400, { error: 'no test user selected' });
      this.lastAcrValues = q.get('acr_values');
      const code = randomBytes(16).toString('base64url');
      this.codes.set(code, { clientId: this.clientId, redirectUri: q.get('redirect_uri')!, challenge: q.get('code_challenge')!, nonce: q.get('nonce') ?? '', user: this.nextUser });
      const back = new URL(q.get('redirect_uri')!);
      back.searchParams.set('code', code);
      if (q.get('state')) back.searchParams.set('state', q.get('state')!);
      return { status: 302, headers: { location: back.href } };
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const raw = await new Promise<string>((resolve) => {
        let b = '';
        req.on('data', (c: Buffer) => (b += c.toString()));
        req.on('end', () => resolve(b));
      });
      const form = new URLSearchParams(raw);
      let id = form.get('client_id');
      let secret = form.get('client_secret');
      const auth = req.headers.authorization;
      if (auth?.startsWith('Basic ')) {
        const [u, p] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
        id = decodeURIComponent(u ?? '');
        secret = decodeURIComponent(p ?? '');
      }
      const entry = this.codes.get(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const challengeOk = entry && createHash('sha256').update(verifier).digest('base64url') === entry.challenge;
      if (id !== this.clientId || secret !== this.clientSecret || form.get('grant_type') !== 'authorization_code' || !entry || entry.redirectUri !== form.get('redirect_uri') || !challengeOk) {
        this.rejectedTokenRequests++;
        return this.json(400, { error: 'invalid_grant' });
      }
      this.codes.delete(form.get('code')!); // single use
      const now = Math.floor(Date.now() / 1000);
      const claims: Record<string, unknown> = { iss: this.issuer, sub: entry.user.sub, aud: this.clientId, iat: now, exp: now + 300, nonce: entry.nonce, ...(entry.user.email ? { email: entry.user.email, email_verified: entry.user.emailVerified ?? true } : {}), ...(entry.user.amr ? { amr: entry.user.amr } : {}), ...(entry.user.acr ? { acr: entry.user.acr } : {}) };
      const t = this.tamperNextToken;
      this.tamperNextToken = null;
      if (t === 'nonce') claims.nonce = 'attacker-nonce';
      if (t === 'audience') claims.aud = 'another-client';
      if (t === 'issuer') claims.iss = 'http://evil.invalid';
      if (t === 'expired') Object.assign(claims, { iat: now - 7200, exp: now - 3600 });
      let idToken = this.signJwt(claims);
      if (t === 'signature') idToken = `${idToken.slice(0, idToken.lastIndexOf('.'))}.${Buffer.from('forged').toString('base64url')}`;
      return this.json(200, { access_token: randomBytes(16).toString('base64url'), token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    return this.json(404, { error: 'not_found' });
  }

  private signJwt(claims: Record<string, unknown>): string {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${enc({ alg: 'RS256', typ: 'JWT', kid: this.kid })}.${enc(claims)}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), this.privateKey).toString('base64url')}`;
  }
}
