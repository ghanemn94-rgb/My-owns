// A minimal, local OpenID Provider for integration tests (no network beyond 127.0.0.1). It implements exactly what
// the API's confidential-client code flow needs: discovery, JWKS, a token endpoint that checks client
// authentication, redirect_uri and PKCE (S256), RS256-signed ID tokens, and an end_session_endpoint. The real
// openid-client library validates everything it returns. Keycloak remains the portable test IdP for e2e (ADR-0005).
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface IdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  /** Override the nonce (to test nonce mismatch). */
  nonce?: string;
}

interface PendingCode {
  claims: IdTokenClaims;
  nonce: string;
  challenge: string;
  redirectUri: string;
}

export class FakeIdp {
  readonly clientId = "mth-test-client";
  readonly clientSecret = "synthetic-test-secret-not-real";
  private server!: Server;
  private readonly keys: { privateKey: KeyObject; publicKey: KeyObject };
  private readonly kid = randomBytes(6).toString("hex");
  private readonly codes = new Map<string, PendingCode>();
  issuer = "";
  tokenRequests = 0;

  constructor() {
    this.keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.issuer = `http://127.0.0.1:${port}/realms/mth-test`;
    return this;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /** Simulate the user authenticating at the IdP: returns an authorization code bound to the request's PKCE/nonce. */
  issueCode(
    authorizationUrl: string,
    claims: IdTokenClaims,
    opts: { challengeOverride?: string } = {},
  ): { code: string; state: string } {
    const u = new URL(authorizationUrl);
    const code = randomBytes(16).toString("base64url");
    this.codes.set(code, {
      claims,
      nonce: u.searchParams.get("nonce")!,
      challenge: opts.challengeOverride ?? u.searchParams.get("code_challenge")!,
      redirectUri: u.searchParams.get("redirect_uri")!,
    });
    return { code, state: u.searchParams.get("state")! };
  }

  private idToken(p: PendingCode): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT", kid: this.kid };
    const { nonce: nonceOverride, ...claims } = p.claims;
    const payload = {
      iss: this.issuer,
      aud: this.clientId,
      iat: now,
      exp: now + 300,
      nonce: nonceOverride ?? p.nonce,
      ...claims,
    };
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const input = `${enc(header)}.${enc(payload)}`;
    return `${input}.${sign("RSA-SHA256", Buffer.from(input), this.keys.privateKey).toString("base64url")}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const base = new URL(this.issuer).pathname;
    if (url.pathname === `${base}/.well-known/openid-configuration`) {
      return json(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${this.issuer}/protocol/openid-connect/token`,
        jwks_uri: `${this.issuer}/protocol/openid-connect/certs`,
        end_session_endpoint: `${this.issuer}/protocol/openid-connect/logout`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      });
    }
    if (url.pathname === `${base}/protocol/openid-connect/certs`) {
      return json(200, {
        keys: [{ ...this.keys.publicKey.export({ format: "jwk" }), kid: this.kid, alg: "RS256", use: "sig" }],
      });
    }
    if (url.pathname === `${base}/protocol/openid-connect/token` && req.method === "POST") {
      this.tokenRequests += 1;
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const basic = req.headers.authorization?.startsWith("Basic ")
        ? Buffer.from(req.headers.authorization.slice(6), "base64").toString("utf8").split(":").map(decodeURIComponent)
        : null;
      const [id, secret] = basic ?? [form.get("client_id"), form.get("client_secret")];
      if (id !== this.clientId || secret !== this.clientSecret) return json(401, { error: "invalid_client" });
      const pending = this.codes.get(form.get("code") ?? "");
      this.codes.delete(form.get("code") ?? "");
      if (
        !pending ||
        form.get("grant_type") !== "authorization_code" ||
        form.get("redirect_uri") !== pending.redirectUri
      ) {
        return json(400, { error: "invalid_grant" });
      }
      const verifier = form.get("code_verifier") ?? "";
      if (createHash("sha256").update(verifier).digest("base64url") !== pending.challenge)
        return json(400, { error: "invalid_grant", error_description: "PKCE" });
      return json(200, {
        access_token: randomBytes(16).toString("hex"),
        token_type: "Bearer",
        expires_in: 300,
        id_token: this.idToken(pending),
      });
    }
    json(404, { error: "not_found" });
  }
}
