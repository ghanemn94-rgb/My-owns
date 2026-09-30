// OIDC authorization code + PKCE (S256) + state + nonce, as a confidential client (ADR-0005 §1-2).
// Tokens never reach the browser and are not stored: after the ID token is validated, only a server-side session
// remains. Discovery is lazy (first login) and retried after a failure, so an IdP outage never blocks API startup.
import { randomBytes } from "node:crypto";
import type { AppConfig } from "@mth/config";
import { sql, type Tx } from "@mth/db";
import * as client from "openid-client";
import { v7 as uuidv7 } from "uuid";
import { record } from "../audit/index.ts";
import { sha256 } from "./sessions.ts";

export const LOGIN_STATE_TTL_MINUTES = 10;

export class OidcService {
  private configuration: Promise<client.Configuration> | null = null;
  private readonly oidc: NonNullable<AppConfig["oidc"]>;
  readonly redirectUri: string;
  readonly appOrigin: string;
  private readonly allowHttp: boolean;
  private readonly discoveryTimeoutSeconds: number;

  constructor(config: AppConfig, options: { discoveryTimeoutSeconds?: number } = {}) {
    this.discoveryTimeoutSeconds = options.discoveryTimeoutSeconds ?? 10;
    if (!config.oidc || !config.appBaseUrl) throw new Error("OidcService needs OIDC settings and APP_BASE_URL");
    this.oidc = config.oidc;
    this.appOrigin = config.appBaseUrl.origin;
    this.redirectUri = `${this.appOrigin}/api/v1/auth/callback`;
    // Plain-http issuers exist only for local/test IdPs; the config loader refuses them in production.
    this.allowHttp = config.nodeEnv !== "production" && this.oidc.issuerUrl.protocol === "http:";
  }

  get issuer(): string {
    return this.oidc.issuerUrl.href;
  }

  async configuration_(): Promise<client.Configuration> {
    if (!this.configuration) {
      this.configuration = client
        .discovery(this.oidc.issuerUrl, this.oidc.clientId, this.oidc.clientSecret, undefined, {
          ...(this.allowHttp ? { execute: [client.allowInsecureRequests] } : {}),
          timeout: this.discoveryTimeoutSeconds,
        })
        .catch((err: unknown) => {
          this.configuration = null; // retry on the next login
          throw err;
        });
    }
    return this.configuration;
  }

  /** Persist a single-use login state and return the IdP authorization URL. */
  async startLogin(tx: Tx, returnTo: string): Promise<URL> {
    const config = await this.configuration_();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const codeVerifier = client.randomPKCECodeVerifier();
    await tx
      .insertInto("oidc_login_state")
      .values({
        state_hash: sha256(state),
        code_verifier: codeVerifier,
        nonce,
        return_to: returnTo,
        expires_at: sql<Date>`now() + make_interval(mins => ${LOGIN_STATE_TTL_MINUTES})`,
      })
      .execute();
    return client.buildAuthorizationUrl(config, {
      redirect_uri: this.redirectUri,
      scope: this.oidc.scopes,
      response_type: "code",
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
  }

  /** Consume the login state (DELETE ... RETURNING: single use; expired rows are ignored). */
  async consumeState(tx: Tx, state: string) {
    return tx
      .deleteFrom("oidc_login_state")
      .where("state_hash", "=", sha256(state))
      .where("expires_at", ">", sql<Date>`now()`)
      .returning(["code_verifier", "nonce", "return_to"])
      .executeTakeFirst();
  }

  /** Exchange the code and validate the ID token (issuer, audience, nonce, expiry, PKCE). Returns its claims. */
  async exchange(callbackUrl: URL, checks: { state: string; nonce: string; codeVerifier: string }) {
    const config = await this.configuration_();
    const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error("no ID token claims");
    return claims;
  }

  async endSessionUrl(): Promise<string | null> {
    try {
      const config = await this.configuration_();
      if (!config.serverMetadata().end_session_endpoint) return null;
      return client
        .buildEndSessionUrl(config, {
          client_id: this.oidc.clientId,
          post_logout_redirect_uri: `${this.appOrigin}/login`,
        })
        .toString();
    } catch {
      return null;
    }
  }
}

export type ResolvedLogin =
  | { ok: true; userId: string; organizationId: string; outcome: "existing" | "bound" | "created" }
  | { ok: false; error: "account_disabled" | "not_provisioned"; userId: string | null; organizationId: string | null };

interface Claims {
  iss: string;
  sub: string;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  preferred_username?: unknown;
}

function displayNameOf(c: Claims): string {
  for (const v of [c.name, c.preferred_username, c.email]) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim().slice(0, 200);
  }
  return `User ${randomBytes(3).toString("hex")}`;
}

/**
 * Subject binding (ADR-0005 §2): (issuer, subject) identifies the user, never the e-mail alone.
 *  1. an existing (iss, sub) signs in that user (refused when disabled);
 *  2. else ONE pre-provisioned active user with the same e-mail and no identity for this issuer is bound, only when
 *     the IdP asserts email_verified = true (audited);
 *  3. else a user is created just in time, WITHOUT role assignments, in the installation's only active organization
 *     (with several organizations, users must be pre-provisioned).
 */
export async function resolveOidcUser(tx: Tx, claims: Claims, requestId: string): Promise<ResolvedLogin> {
  const existing = await tx
    .selectFrom("user_identity as i")
    .innerJoin("app_user as u", "u.id", "i.user_id")
    .select(["i.id as identity_id", "u.id", "u.organization_id", "u.status"])
    .where("i.issuer", "=", claims.iss)
    .where("i.subject", "=", claims.sub)
    .executeTakeFirst();
  if (existing) {
    if (existing.status !== "active")
      return { ok: false, error: "account_disabled", userId: existing.id, organizationId: existing.organization_id };
    await tx
      .updateTable("user_identity")
      .set({ last_login_at: sql<Date>`now()` })
      .where("id", "=", existing.identity_id)
      .execute();
    return { ok: true, userId: existing.id, organizationId: existing.organization_id, outcome: "existing" };
  }

  const email = typeof claims.email === "string" && claims.email.length <= 320 ? claims.email : null;
  const verified = claims.email_verified === true;
  if (email && verified) {
    const candidates = await tx
      .selectFrom("app_user as u")
      .select(["u.id", "u.organization_id"])
      .where(sql<boolean>`lower(u.email) = lower(${email})`)
      .where("u.status", "=", "active")
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("user_identity as i")
              .select("i.id")
              .whereRef("i.user_id", "=", "u.id")
              .where("i.issuer", "=", claims.iss),
          ),
        ),
      )
      .limit(2)
      .execute();
    if (candidates.length === 1) {
      const u = candidates[0]!;
      await tx
        .insertInto("user_identity")
        .values({
          id: uuidv7(),
          user_id: u.id,
          issuer: claims.iss,
          subject: claims.sub,
          email_at_binding: email,
          last_login_at: sql<Date>`now()`,
        })
        .execute();
      await record(
        tx,
        { actorUserId: null, actorType: "system", requestId },
        {
          action: "user_identity.bind",
          recordType: "app_user",
          recordId: u.id,
          organizationId: u.organization_id,
          reason: "First OIDC sign-in of a pre-provisioned user with a verified e-mail",
          changes: { identity: { from: null, to: { issuer: claims.iss, subject: claims.sub } } },
        },
      );
      return { ok: true, userId: u.id, organizationId: u.organization_id, outcome: "bound" };
    }
  }

  const orgs = await tx.selectFrom("organization").select("id").where("status", "=", "active").limit(2).execute();
  if (orgs.length !== 1) return { ok: false, error: "not_provisioned", userId: null, organizationId: null };
  const organizationId = orgs[0]!.id;
  const emailFree =
    email && verified
      ? !(await tx
          .selectFrom("app_user")
          .select("id")
          .where("organization_id", "=", organizationId)
          .where(sql<boolean>`lower(email) = lower(${email})`)
          .executeTakeFirst())
      : false;
  const userId = uuidv7();
  await tx
    .insertInto("app_user")
    .values({
      id: userId,
      organization_id: organizationId,
      display_name: displayNameOf(claims),
      email: emailFree ? email : null,
      created_by: null,
      updated_by: null,
    })
    .execute();
  await tx
    .insertInto("user_identity")
    .values({
      id: uuidv7(),
      user_id: userId,
      issuer: claims.iss,
      subject: claims.sub,
      email_at_binding: email,
      last_login_at: sql<Date>`now()`,
    })
    .execute();
  await record(
    tx,
    { actorUserId: null, actorType: "system", requestId },
    {
      action: "app_user.create",
      recordType: "app_user",
      recordId: userId,
      organizationId,
      newVersion: 1,
      reason: "Just-in-time provisioning at first OIDC sign-in (no role assignments)",
      changes: { identity: { from: null, to: { issuer: claims.iss, subject: claims.sub } } },
    },
  );
  return { ok: true, userId, organizationId, outcome: "created" };
}
