// A minimal, local OpenID Provider for integration tests (no network beyond 127.0.0.1). It implements exactly what
// the API's confidential-client code flow needs: discovery, JWKS, a token endpoint that checks client
// authentication, redirect_uri and PKCE (S256), RS256-signed ID tokens, and an end_session_endpoint. The real
// openid-client library validates everything it returns. Keycloak remains the portable test IdP for e2e (ADR-0005).
// P6 (T-DG6-BE-G; ADR-0054 §1, REQ-S16-007): the same server also hosts a SECOND issuer, realm `mth-other`, with its own
// signing key, discovery document and JWKS, so a test can present an ID token from another issuer or realm, or one
// signed by another realm's key, and prove the API refuses it. Every value is synthetic.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface IdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  /** Override the nonce (to test nonce mismatch). */
  nonce?: string;
  /** Override the issuer claim (F-DG2-260: an `iss` with a lone surrogate). */
  iss?: string;
  /** Override the audience claim (ADR-0054 §1: a token for another client, or several audiences). */
  aud?: string | string[];
  /** The authorized party claim (ADR-0054 §1: required to equal the client id when `aud` has several values). */
  azp?: string;
}

/** The two realms this fake hosts: `mth-test` (the one the API is configured with) and `mth-other` (ADR-0054 §1). */
export type FakeRealm = "mth-test" | "mth-other";

/** How a code's ID token is minted: by which realm (its `iss`), and signed with which realm's key. */
export interface IssueOptions {
  challengeOverride?: string;
  /** The realm whose issuer goes in `iss` (default `mth-test`). */
  issuedBy?: FakeRealm;
  /** The realm whose private key signs the token (default: the issuing realm). */
  signedBy?: FakeRealm;
  /** The `kid` header: the signing realm's own key id (default), or the other realm's (a relabelled key). */
  kidOf?: FakeRealm;
}

interface RealmKeys {
  privateKey: KeyObject;
  publicKey: KeyObject;
  kid: string;
}

interface PendingCode {
  claims: IdTokenClaims;
  nonce: string;
  challenge: string;
  redirectUri: string;
  issuedBy: FakeRealm;
  signedBy: FakeRealm;
  kidOf: FakeRealm;
}

export class FakeIdp {
  readonly clientId = "mth-test-client";
  readonly clientSecret = "synthetic-test-secret-not-real";
  private server!: Server;
  private readonly realmKeys: Record<FakeRealm, RealmKeys>;
  private readonly codes = new Map<string, PendingCode>();
  private origin = "";
  /** The `mth-test` issuer, the one the API under test is configured with. */
  issuer = "";
  /** The `mth-other` issuer: another realm with its own signing key (ADR-0054 §1). */
  otherIssuer = "";
  tokenRequests = 0;
  /** The last ID token the token endpoint returned (a test asserts it never reaches a log line). */
  lastIdToken: string | null = null;

  constructor() {
    const realm = (): RealmKeys => ({
      ...generateKeyPairSync("rsa", { modulusLength: 2048 }),
      kid: randomBytes(6).toString("hex"),
    });
    this.realmKeys = { "mth-test": realm(), "mth-other": realm() };
  }

  /** The issuer identifier of a realm. */
  issuerOf(realm: FakeRealm): string {
    return `${this.origin}/realms/${realm}`;
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.origin = `http://127.0.0.1:${port}`;
    this.issuer = this.issuerOf("mth-test");
    this.otherIssuer = this.issuerOf("mth-other");
    return this;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /** Simulate the user authenticating at the IdP: returns an authorization code bound to the request's PKCE/nonce. */
  issueCode(authorizationUrl: string, claims: IdTokenClaims, opts: IssueOptions = {}): { code: string; state: string } {
    const u = new URL(authorizationUrl);
    const code = randomBytes(16).toString("base64url");
    this.codes.set(code, {
      claims,
      nonce: u.searchParams.get("nonce")!,
      challenge: opts.challengeOverride ?? u.searchParams.get("code_challenge")!,
      redirectUri: u.searchParams.get("redirect_uri")!,
      issuedBy: opts.issuedBy ?? "mth-test",
      signedBy: opts.signedBy ?? opts.issuedBy ?? "mth-test",
      kidOf: opts.kidOf ?? opts.signedBy ?? opts.issuedBy ?? "mth-test",
    });
    return { code, state: u.searchParams.get("state")! };
  }

  private idToken(p: PendingCode): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT", kid: this.realmKeys[p.kidOf].kid };
    const { nonce: nonceOverride, ...claims } = p.claims;
    const payload = {
      iss: this.issuerOf(p.issuedBy),
      aud: this.clientId,
      iat: now,
      exp: now + 300,
      nonce: nonceOverride ?? p.nonce,
      ...claims,
    };
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const input = `${enc(header)}.${enc(payload)}`;
    return `${input}.${sign("RSA-SHA256", Buffer.from(input), this.realmKeys[p.signedBy].privateKey).toString("base64url")}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.origin);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const realm = (["mth-test", "mth-other"] as const).find((r) => url.pathname.startsWith(`/realms/${r}/`));
    if (!realm) return json(404, { error: "not_found" });
    const issuer = this.issuerOf(realm);
    const base = `/realms/${realm}`;
    if (url.pathname === `${base}/.well-known/openid-configuration`) {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      });
    }
    if (url.pathname === `${base}/protocol/openid-connect/certs`) {
      // Each realm publishes ONLY its own key.
      const own = this.realmKeys[realm];
      return json(200, {
        keys: [{ ...own.publicKey.export({ format: "jwk" }), kid: own.kid, alg: "RS256", use: "sig" }],
      });
    }
    // The API under test is a client of `mth-test` only: its token endpoint mints whatever the test asked for.
    if (realm === "mth-test" && url.pathname === `${base}/protocol/openid-connect/token` && req.method === "POST") {
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
      this.lastIdToken = this.idToken(pending);
      return json(200, {
        access_token: randomBytes(16).toString("hex"),
        token_type: "Bearer",
        expires_in: 300,
        id_token: this.lastIdToken,
      });
    }
    json(404, { error: "not_found" });
  }
}
