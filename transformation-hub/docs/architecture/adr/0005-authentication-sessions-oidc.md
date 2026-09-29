# ADR-0005 — Authentication: server-side sessions, OIDC, isolated dev identities

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §13 (OIDC, SAML via gateway, isolated development identities), §15 (MFA at IdP, session expiry/revocation), §21 (no default passwords/backdoors)

## Decision
- No passwords are stored. Production login is OIDC Authorization Code + PKCE (`openid-client`) against Mobily's IdP;
  MFA is enforced by the IdP. SAML-only IdPs are supported through an IdP broker/gateway that speaks OIDC.
- Sessions are server-side (`session` table). The cookie `hub_session` holds a 256-bit random token; only its SHA-256
  is stored. Idle and absolute expiry; revocation on logout, user deactivation, and admin action.
- CSRF: double-submit token (`hub_csrf` cookie + `x-csrf-token` header), SameSite=Lax, Secure in production.
- Dev identity: when `HUB_MODE=demo`, a "choose demo user" login exists for synthetic `is_demo` users only.
  Configuration validation refuses to start with `HUB_MODE=demo` and `NODE_ENV=production`, and the endpoint does not
  exist in non-demo mode.
