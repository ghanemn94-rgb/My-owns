# SAML identity providers through a broker (REQ-S16-007; ADR-0054 §1)

The hub signs users in with **OpenID Connect only**: authorization code with PKCE S256, as a confidential client
(ADR-0005). **It contains no SAML code.** When Mobily's corporate identity provider offers only SAML 2.0, an OIDC
broker sits between the two. The SAML IdP authenticates the user, and the broker issues the OIDC tokens the hub
validates. The master prompt asks for this: "Where SAML is required, provide a documented compatible broker/adapter"
(M0312).

This document describes **Keycloak** as that broker, using SAML 2.0 identity brokering. Any OIDC provider that brokers
SAML can play the same role if it meets the hub-side contract in §2.

> **Not exercised live.** No SAML IdP exists in this repository or its build environment. The brokered SAML path
> described here has **not** been run end to end, against Mobily's IdP or any other. It is a documented residual
> (p6-plan R3; `docs/delivery/environment.md`), and it is never described as "integrated with Mobily" or "tested
> against production".
>
> What does run is the hub side of the contract. The OIDC issuer and audience checks are covered by
> `apps/api/test/integration/identity/other-realm.test.ts`, and the Keycloak test realm sign-in by
> `e2e/identity/keycloak-login.spec.ts`. The e2e needs a container runtime, so it is BLOCKED wherever there is none.
> Mobily IT configures and approves the broker and the IdP trust. No engineering agent grants that approval.

Keycloak console labels below are quoted from the Keycloak Server Administration Guide, version 26.8.1, fetched on
2026-10-30 (`docs/delivery/handbacks/DG6/T-DG6-DO-B-evidence/keycloak-docs-saml-brokering.txt`). The test image is
pinned to `quay.io/keycloak/keycloak:26.8.1` by digest (`deploy/images.lock.json`). Mapper type names marked _(console
list)_ are not spelled out in the guide's text. Check them in the console's **Mapper Type** list for your version.

## 1. Topology

```text
browser ──► hub /api/v1/auth/login ──► broker realm (OIDC authorize) ──► corporate SAML IdP (AuthnRequest)
        ◄── hub /api/v1/auth/callback ◄── broker (OIDC code; ID token on exchange) ◄── SAML Response (assertion)
```

- The hub trusts **one issuer**: the broker realm, `OIDC_ISSUER_URL=https://<broker-host>/realms/<realm>`. It never
  sees a SAML assertion.
- The hub keeps every check it already has: discovery, its JWKS signature check, `iss` equal to the configured issuer
  exactly, `aud` containing the client id (with `azp` when `aud` has several values), nonce, expiry and PKCE. A token
  from any other issuer or realm is refused (`/login?error=token_invalid`, one `session.login_failed` audit event, no
  session).
- In production the broker is a service that Mobily IT operates, with high availability, TLS, backups and patching
  under IT's own standards. **The Compose `test-idp` profile is a single-node test IdP**, not a production broker and
  not highly available.

## 2. Hub-side contract (what the broker must deliver)

| Item                          | Required value                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol                      | OIDC authorization code flow; PKCE S256 required on the client; implicit flow and direct access grants **off**                                     |
| Client                        | Confidential; id = `OIDC_CLIENT_ID`; secret delivered to the hub as `OIDC_CLIENT_SECRET_FILE` (never in the repository)                            |
| Redirect URI                  | `<APP_BASE_URL>/api/v1/auth/callback` (exact)                                                                                                      |
| Post-logout redirect          | `<APP_BASE_URL>/*`                                                                                                                                 |
| Scopes                        | `openid profile email` (`OIDC_SCOPES`)                                                                                                             |
| Issuer                        | Stable, https in production; equals `OIDC_ISSUER_URL` character for character                                                                      |
| `sub`                         | **Stable for the person for ever.** The hub identifies a user by `(iss, sub)`, never by e-mail alone                                              |
| `email`, `email_verified`     | E-mail address; `email_verified = true` only when the corporate IdP vouches for it (it is used once, to bind a pre-provisioned user)               |
| `name`                        | Display name (`name`, then `preferred_username`, then `email`)                                                                                     |
| Roles and groups              | **Not read by the hub** (see §3.5)                                                                                                                 |

Administration > Identity (`getIdentitySettings`, read-only, `identity.read`) shows the issuer, client id, whether a
client secret is configured (yes or no only, never the value), the scopes, the expected audience, PKCE `S256`, the
fixed claim mapping `sub`/`email`/`name`, and the path of this document. Identity settings are runtime configuration
(ADR-0011). There is no in-product edit.

## 3. Keycloak as the broker

### 3.1 The broker realm and the hub client

1. Create a realm for the hub, for example `mobily-hub`. Do not reuse `mth-test` or `mth-other`: those are SYNTHETIC
   test realms.
2. Add an OIDC client that matches §2. `deploy/keycloak/realm-mth-test.json` is a working template for the client
   block: confidential, `standardFlowEnabled`, `pkce.code.challenge.method = S256`, `directAccessGrantsEnabled` and
   `implicitFlowEnabled` off, and exact redirect and post-logout URIs. Replace its `${...}` placeholders with IT's
   values through the broker's own secret handling.
3. Set the hub's runtime configuration: `AUTH_MODE=oidc`, `OIDC_ISSUER_URL=https://<broker-host>/realms/mobily-hub`,
   `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET_FILE`. If the broker's TLS chain is not in the base image's trust store, also
   set `NODE_EXTRA_CA_CERTS` to IT's CA bundle (`docs/operations/configuration.md`).

### 3.2 The corporate SAML IdP as a Keycloak identity provider

In the broker realm, go to **Identity Providers** and add **SAML v2.0**. The settings that matter:

| Setting                                         | Recommendation                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Metadata descriptor URL                         | The corporate IdP's published `IDPSSODescriptor` metadata, if it has one. It fills the SSO, logout and certificate fields                                                                                                                                                                                |
| **Use metadata descriptor URL**                 | **ON** if IT allows the broker to fetch metadata. "When ON, the certificates to validate signatures are automatically downloaded from the Metadata descriptor URL and cached in Keycloak". This is the basis for certificate rotation (§3.4)                                                            |
| Single Sign-On service URL, Single Logout Service URL | From the metadata, or entered by hand                                                                                                                                                                                                                                                             |
| **NameID Policy Format**                        | `urn:oasis:names:tc:SAML:2.0:nameid-format:persistent` (Keycloak's default). **Never `transient`**: the identity would change at every sign-in                                                                                                                                                           |
| **Principal Type**                              | `Subject NameID` with the persistent format, or a SAML attribute that IT guarantees never changes or gets reused (for example an immutable employee object id). Never an e-mail address or a display name                                                                                             |
| Want AuthnRequests signed; Validate Signatures  | ON. Use a SHA-256 signature algorithm: "SHA1 based algorithms are deprecated"                                                                                                                                                                                                                         |
| Want Assertions signed / encrypted              | As IT's SAML IdP requires. Signed assertions are recommended                                                                                                                                                                                                                                           |
| Trust Email                                     | ON **only** if the corporate IdP asserts verified corporate addresses. It makes `email_verified = true` reach the hub, which binds a pre-provisioned user by e-mail once                                                                                                                                |
| Sync mode                                       | `force` for the profile attributes (e-mail, names), so changes at the corporate IdP reach the hub at the next sign-in                                                                                                                                                                                 |
| Hide on Login Page                              | ON, together with the redirector in §3.3, so users never see a Keycloak password form                                                                                                                                                                                                                  |

Give the corporate IdP the broker's SP metadata, which Keycloak publishes for the identity provider. Then agree the
attribute release with IT (§3.5).

### 3.3 Send users straight to the corporate IdP

Go to **Authentication**, open the **Browser** flow, and on the **Identity Provider Redirector** row (the gear icon) set
**Default Identity Provider** to the SAML provider's alias. Keycloak then "can redirect to an identity provider rather
than displaying the login form". The hub needs no change: it never sends `kc_idp_hint`. Disable local Keycloak
passwords in the broker realm, so that the corporate IdP is the only way in.

### 3.4 Signing-certificate rotation

- **With "Use metadata descriptor URL" ON:** when the corporate IdP publishes its next certificate in its metadata
  (ideally both certificates during an overlap window), Keycloak downloads and caches the certificates it finds there.
  After IT's rollover, sign in once through the broker. **Reload keys** forces a refresh.
- **Without metadata:** add the new certificate to the provider's validating certificates **before** the corporate IdP
  switches, keep both during the overlap, and remove the old one afterwards.
- The broker's **own** realm keys, which sign the OIDC tokens the hub validates, rotate independently. Add a new active
  key, keep the old one passive until every issued token has expired (`accessTokenLifespan` 300 s in the test realms;
  the hub's sessions are its own and are not tied to token lifetime), then disable it. The hub reads the broker's JWKS
  through discovery and needs no configuration change.
- **Test after every rotation:** one interactive sign-in, plus `/login?error=token_invalid` for nobody else. A failed
  rotation shows up as `session.login_failed` events (Administration > Audit) and `token_invalid` on the sign-in page.

### 3.5 Attributes, claims, groups and roles

| SAML attribute (IT to confirm the names)       | Keycloak user attribute      | OIDC claim to the hub            | Mapper type                                                    |
| ---------------------------------------------- | ---------------------------- | -------------------------------- | -------------------------------------------------------------- |
| NameID (persistent) or the agreed immutable id | broker link (federated user) | `sub` = Keycloak user id, stable | Built in. Not a mapper                                         |
| mail / `emailaddress` claim URI                | `email`                      | `email`, `email_verified`        | _Attribute Importer_ (console list); `email` scope mapper      |
| given name, surname                            | `firstName`, `lastName`      | `name`, `given_name`, `family_name` | _Attribute Importer_ (console list); `profile` scope mappers |
| group memberships                              | Keycloak groups              | (optional) `groups`              | _Advanced Attribute to Group_ (console list); group membership |

- **`sub` stays fixed.** In a brokered setup, `sub` is the Keycloak user id of the federated user, not the SAML NameID.
  It stays the same as long as that Keycloak user exists. **Never delete and re-create federated users, and never
  rebuild the broker realm from scratch in production.** Either would give everyone a new `sub`, and the hub would
  treat them as new people. A new `sub` from the same issuer is **not** re-bound to the existing user, because the
  e-mail binding applies only to a pre-provisioned user with no identity for that issuer yet. The person would get a
  new user without roles. Back up the broker's database under IT's backup policy (the hub's own backup and restore
  drill is a later-stage item: `docs/operations/README.md`). The hub has no in-product re-bind operation, so a broker
  rebuild needs a planned identity migration by IT.
- **Groups → roles: input only.** "Grants are never inferred from job titles or IdP attributes" (ADR-0006). The hub
  **does not read** `groups` or `roles` claims. Roles are explicit scoped assignments in Administration > Access,
  granted by an access administrator and audited. A broker may still map corporate groups into Keycloak groups and
  emit a `groups` claim. That is useful as input for IT's access reviews and for a future, explicit, IT-controlled
  group → assignment mapping (ADR-0006: "IdP group → assignment mappings are explicit, IT-controlled configuration (later)"). It never grants anything in the hub by
  itself.
- Release only the attributes in this table. The hub stores the display name and e-mail address. It does not want
  other personal data.

### 3.6 Logout

- Hub sign-out (`POST /api/v1/auth/logout`) revokes the hub session, then returns the broker's `end_session_endpoint`.
  The browser follows it with `post_logout_redirect_uri = <APP_BASE_URL>/login`.
- To end the SAML session at the corporate IdP too, configure its **Single Logout Service URL** on the identity
  provider. Turn **Backchannel Logout** on only "if your SAML IDP supports back channel logout".
- A session ended only at the corporate IdP does **not** end an existing hub session: the hub has no back-channel
  logout receiver. Hub sessions end at their idle and absolute limits (`SESSION_IDLE_MINUTES`,
  `SESSION_ABSOLUTE_HOURS`) or when an access administrator revokes them. Set those limits to IT's policy.

## 4. Acceptance on Mobily's infrastructure (IT; not done here)

1. One synthetic or test account at the corporate IdP signs in to the hub through the broker. Administration >
   Identity shows the broker issuer. `GET /api/v1/me` returns the user with the expected display name and e-mail.
2. The same person signs in again on another day: the same hub user, with no new `app_user.create` audit event.
3. A token from any other realm or issuer is refused: run `e2e/identity/keycloak-login.spec.ts` against the broker's
   test copy, or check `session.login_failed` after a deliberate wrong-issuer attempt.
4. Certificate rotation (§3.4) rehearsed once before go-live.
5. The approval of the IdP trust, the attribute release and the broker's operation is Mobily IT's. It is recorded
   outside this repository. **No engineering gate (DG0–DG7) and no product gate (G1–G6) stands for it.**

## 5. Test realms shipped in this repository (SYNTHETIC)

| File                                  | Realm       | Purpose                                                                                                                                           |
| ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/keycloak/realm-mth-test.json`  | `mth-test`  | The realm the hub is configured for in Compose (`test-idp` profile): synthetic users, client `mth-hub`                                             |
| `deploy/keycloak/realm-mth-other.json` | `mth-other` | A foreign issuer on the same server, with the same client id and a user with the same user name and e-mail. Its responses and tokens must be refused |

Neither file contains a credential: the `${...}` placeholders are filled at import from the container's secret files.
Neither realm contains a SAML provider, and neither is a production configuration.
