# ADR-0005: Identity, sessions, CSRF and dev login

- **Status:** Proposed for DG1. **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S16-007, REQ-S16-030, REQ-S16-031, REQ-S19-007, REQ-S19-009, REQ-S10-002.

## Decision

1. **OIDC authorization code flow with PKCE (S256) plus `state` and `nonce`**, using **`openid-client` 6.8.1** (MIT) [UNVERIFIED].
   - The API is a **confidential client** (backend-for-frontend). Access, ID and refresh tokens never reach the browser.
   - Discovery runs against `OIDC_ISSUER_URL`. Login state (`state`, `nonce`, `code_verifier`, `return_to`) lives in the `oidc_login_state` table: single use, with a 10-minute expiry.
   - `returnTo` must be a same-origin relative path.
   - SAML-only IdPs are handled by a broker (for example the corporate IdP or Keycloak brokering SAML to OIDC), documented for P6 (§16).
2. **Subject binding (§19 rebinding):**
   - A user's identity is the pair **(issuer, subject)** in `user_identity`, which is unique. It is not the email address and not the username.
   - Resolution on callback:
     1. An existing (iss, sub) signs in that user.
     2. Otherwise, a **pre-provisioned** user in the configured organization with the same `email` and **no identity for this issuer**, where the IdP asserts `email_verified=true`, is bound and audited.
     3. Otherwise, the user is created just in time, with **no role assignments**, so they can sign in but see nothing until an access admin assigns scoped roles.
   - Disabled users are refused.
   - Rebinding to a new IdP after migration is an audited admin operation that replaces or adds the (iss, sub) row (P7 tooling).
3. **Server-side sessions in PostgreSQL** (`session` table):
   - The ID is 32 random bytes (base64url) in the cookie; **only its SHA-256 is stored**.
   - Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`, with the `__Host-` prefix in HTTPS deployments.
   - Idle timeout 30 minutes and absolute lifetime 10 hours, both configurable.
   - The ID is rotated on login. Logout, user disable and assignment changes revoke sessions (`revoked_at`).
   - Expired rows are purged by a worker job; they are not business records.
4. **CSRF:**
   - A synchronizer token per session (a random value; its hash is stored in the session), returned by `GET /api/v1/me` and required in `X-CSRF-Token` on every unsafe method.
   - In addition, `Origin` (or `Referer`, when Origin is absent) must match `APP_BASE_URL`.
   - SameSite=Lax is defence in depth, not the only control. The dev-login route has no session yet and is protected by the Origin check.
5. **Dev-only local login:**
   - `POST /api/v1/auth/dev-login` exists only when **`AUTH_MODE=dev`**.
   - The config loader **exits at startup if `AUTH_MODE=dev` and `NODE_ENV=production`**.
   - Routes are registered conditionally, so in every other mode the path is a 404.
   - It signs in only existing **synthetic** users bound to issuer `urn:mth:dev-local`, seeded by a dev-only seed script that is never part of production initialization (REQ-S18-001). It never creates users or grants roles.
   - Production images set `AUTH_MODE=oidc` and a test asserts that.
6. **Keycloak as the portable test IdP.**
   - A realm export (clients, synthetic test users, no real credentials) lives in `deploy/keycloak/` (devops-engineer).
   - Image `quay.io/keycloak/keycloak` 26.x, pinned by digest (Apache-2.0) [UNVERIFIED version; see discovery doc].
   - Keycloak is a **test and integration dependency only**. Production uses Mobily's corporate IdP.
7. **Secrets** (`OIDC_CLIENT_SECRET`, DB URLs) come only from the environment or `*_FILE` mounts (ADR-0011). They are never logged; the logger redacts `authorization`, `cookie` and `set-cookie`.

## Alternatives

- **Browser-side OIDC (public client, tokens in the SPA).** Tokens are exposed to XSS, and refresh handling gets complex. Rejected.
- **JWT stateless sessions.** They cannot be revoked immediately when assignments change or a user is disabled. Rejected.
- **passport / @fastify/passport.** Extra abstraction. `openid-client` is the certified low-level RP library by the same author as `jose` [UNVERIFIED certification status; not a claim about this product].

## Consequences

- One extra table each for sessions and login state.
- Horizontal scaling works out of the box because sessions live in PostgreSQL.

## Verification evidence

| Item | Pinned | Licence | Evidence |
|---|---|---|---|
| openid-client | 6.8.1 | MIT | [UNVERIFIED] |
| @fastify/cookie | 11.0.2 | MIT | [UNVERIFIED] |
| Keycloak | 26.x image digest (devops pins it) | Apache-2.0 | [UNVERIFIED]; https://www.keycloak.org/downloads |
