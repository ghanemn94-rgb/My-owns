// OIDC authorization code + PKCE (S256) + state + nonce, as a confidential client (ADR-0005 §1-2).
// Tokens never reach the browser and are not stored: after the ID token is validated, only a server-side session
// remains. Discovery is lazy (first login) and retried after a failure, so an IdP outage never blocks API startup.
import { randomBytes } from "node:crypto";
import type { AppConfig } from "@mth/config";
import { sql, type Tx } from "@mth/db";
import * as client from "openid-client";
import { hasInvalidCharacter, hasText } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { record } from "../audit/index.ts";
import { sha256 } from "./sessions.ts";

export const LOGIN_STATE_TTL_MINUTES = 10;

/** A login prepared outside any transaction (`prepareLogin`); `saveLoginState` persists it. */
export interface PreparedLogin {
  readonly url: URL;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly browserBinding: string;
}

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

  /**
   * Starts a login in two steps, so no database transaction is open while the IdP is contacted (T-DG2-BE18,
   * F-DG2-441). Step 1, `prepareLogin`, runs OUTSIDE any transaction: OIDC discovery (a remote call, up to the
   * discovery timeout while the IdP is slow or down, retried on the next login after a failure), the random state,
   * nonce and PKCE verifier, and the authorization URL. Step 2, `saveLoginState`, inserts the single-use login state in
   * a short transaction that only touches the database.
   * `browserBinding` is the random value the caller puts in the HttpOnly pre-session login cookie; only its SHA-256
   * is stored (F-DG1-103). The PKCE verifier and nonce stay server-side and are released only to that browser.
   */
  async prepareLogin(returnTo: string, browserBinding: string): Promise<PreparedLogin> {
    if (browserBinding.length < 32) throw new Error("OIDC login: the browser binding must be a high-entropy value");
    const config = await this.configuration_();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const codeVerifier = client.randomPKCECodeVerifier();
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: this.redirectUri,
      scope: this.oidc.scopes,
      response_type: "code",
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    return { url, state, nonce, codeVerifier, returnTo, browserBinding };
  }

  /** Step 2 of a login: persist the prepared login state (database only; call it in its own short transaction). */
  async saveLoginState(tx: Tx, login: PreparedLogin): Promise<void> {
    await tx
      .insertInto("oidc_login_state")
      .values({
        state_hash: sha256(login.state),
        code_verifier: login.codeVerifier,
        nonce: login.nonce,
        return_to: login.returnTo,
        browser_binding_hash: sha256(login.browserBinding),
        expires_at: sql<Date>`now() + make_interval(mins => ${LOGIN_STATE_TTL_MINUTES})`,
      })
      .execute();
  }

  /**
   * Consume the login state (DELETE ... RETURNING: single use; expired rows are ignored) - but ONLY for the browser
   * it is bound to (F-DG1-103; RFC 6749 §10.12). A valid state presented by another browser (no login cookie, or a
   * different one) is refused as `browser_mismatch` and is NOT consumed, so a leaked callback URL can neither sign
   * the presenting browser in nor burn the legitimate user's login.
   */
  async consumeState(tx: Tx, state: string, browserBinding: string | undefined): Promise<ConsumedLoginState> {
    const stateHash = sha256(state);
    if (browserBinding) {
      const row = await tx
        .deleteFrom("oidc_login_state")
        .where("state_hash", "=", stateHash)
        .where("browser_binding_hash", "=", sha256(browserBinding))
        .where("expires_at", ">", sql<Date>`now()`)
        .returning(["code_verifier", "nonce", "return_to"])
        .executeTakeFirst();
      if (row) return { ok: true, ...row };
    }
    const pending = await tx
      .selectFrom("oidc_login_state")
      .select("state_hash")
      .where("state_hash", "=", stateHash)
      .where("expires_at", ">", sql<Date>`now()`)
      .executeTakeFirst();
    return { ok: false, reason: pending ? "browser_mismatch" : "state_invalid" };
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

export type ConsumedLoginState =
  | { ok: true; code_verifier: string; nonce: string; return_to: string }
  | { ok: false; reason: "state_invalid" | "browser_mismatch" };

/** Pre-session login cookie (F-DG1-103): `__Host-` prefixed on https, like the session cookie (ADR-0005 §3). */
export function loginCookieName(appBaseUrl: URL): string {
  return appBaseUrl.protocol === "https:" ? "__Host-mth_login" : "mth_login";
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

/** Longest stored display name, in code points (`app_user.display_name`: char_length 1..200). */
export const DISPLAY_NAME_MAX = 200;

/**
 * F-DG2-181: the display name candidate a claim yields, or null. The claim is trimmed and truncated FIRST, by code
 * points (`Array.from`), so a surrogate pair is never split; only then is the visible-content predicate applied to the
 * value that would be stored. A claim whose first 200 code points are invisible is therefore absent, even when visible
 * text follows them.
 */
export function displayNameCandidate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const truncated = Array.from(v.trim()).slice(0, DISPLAY_NAME_MAX).join("").trim();
  // F-DG2-160 / F-DG2-180: a value with no visible content (spaces, U+200F, U+2060, VS16, controls, ...) is absent.
  // F-DG2-231 / F-DG2-260: so is a value with U+0000 or a lone UTF-16 surrogate (`hasInvalidCharacter`), which cannot
  // be stored faithfully (a lone surrogate would silently become U+FFFD); the next claim is used instead.
  return hasText(truncated) && !hasInvalidCharacter(truncated) ? truncated : null;
}

/** Display name from the claims: `name`, then `preferred_username`, then `email`, then a generated name. */
function displayNameOf(c: Claims): string {
  for (const v of [c.name, c.preferred_username, c.email]) {
    const candidate = displayNameCandidate(v);
    if (candidate !== null) return candidate;
  }
  return `User ${randomBytes(3).toString("hex")}`;
}

/** `user_identity` column limits, in code points (`char_length`): issuer 1..512, subject 1..255. */
const ISSUER_MAX = 512;
const SUBJECT_MAX = 255;

/** True when `value` holds 1..`max` code points and no invalid character (U+0000, lone surrogate). */
function storableIdentifier(value: unknown, max: number): boolean {
  if (typeof value !== "string" || value.length === 0 || hasInvalidCharacter(value)) return false;
  return Array.from(value).length <= max;
}

/**
 * F-DG2-231 / F-DG2-260: true when the identifying claims can be stored, looked up and audited faithfully. An ID token
 * whose `iss` or `sub` contains U+0000 (PostgreSQL text cannot hold it) or a lone UTF-16 surrogate (text would store
 * U+FFFD, and the audit row's jsonb refuses it with 22P02), or that is empty or longer than its `user_identity` column
 * allows (a CHECK violation), is refused as `token_invalid` and audited as a failed sign-in, instead of failing in the
 * database with an answer the callback's contract does not declare (302 and 429 only).
 */
export function identityClaimsStorable(claims: { iss: string; sub: string }): boolean {
  return storableIdentifier(claims.iss, ISSUER_MAX) && storableIdentifier(claims.sub, SUBJECT_MAX);
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

  // F-DG2-231 / F-DG2-260: an e-mail claim with U+0000 or a lone surrogate cannot be stored or matched faithfully, so
  // it is treated as absent.
  const email =
    typeof claims.email === "string" && claims.email.length <= 320 && !hasInvalidCharacter(claims.email)
      ? claims.email
      : null;
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
