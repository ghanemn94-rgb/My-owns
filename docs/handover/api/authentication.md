# Authentication setup: sign-in, sessions, CSRF and service identities

For Mobily IT. It describes how the hub authenticates people and its own background work, and what IT registers at its identity provider. The sources are the contract (`docs/api/openapi.yaml`, its description and `securitySchemes`), `apps/api/src/modules/identity/` and the ADRs named below. No credential value appears here: credentials are named only.

## 1. Sign-in (OIDC)

- **Mode.** `AUTH_MODE=oidc` (the default). `AUTH_MODE=dev` enables a local development login (`POST /api/v1/auth/dev-login`, 404 otherwise) and is refused at startup when `NODE_ENV=production` (ADR-0005).
- **Flow.** The OIDC authorization code flow with PKCE (`S256`). `GET /api/v1/auth/login` redirects to the IdP. `GET /api/v1/auth/callback` completes the sign-in and creates the session. `POST /api/v1/auth/logout` ends it.
- **Configuration** (`.env.example`; see `docs/operations/configuration.md`):

  | Key | Meaning |
  | --- | --- |
  | `OIDC_ISSUER_URL` | The issuer URL (https). The hub reads the IdP's discovery document from it. |
  | `OIDC_CLIENT_ID` | The client ID registered for the hub. |
  | `OIDC_CLIENT_SECRET_FILE` | A mounted file that holds the client secret (`OIDC_CLIENT_SECRET` is accepted too, but the file form is preferred; setting both is refused). |
  | `OIDC_SCOPES` | Default `openid profile email`. |
  | `APP_BASE_URL` | The hub's origin. Every absolute URL below is built from it at use time. |

## 2. What IT registers at the identity provider

| Item | Value |
| --- | --- |
| Client type | Confidential client, authorization code flow with PKCE |
| Redirect URI | `<origin>/api/v1/auth/callback`, where `<origin>` is the origin of `APP_BASE_URL` |
| Post-logout redirect URI | `<origin>/login`. It is used only when the IdP publishes an `end_session_endpoint`. |
| Scopes | `openid profile email` (or the value of `OIDC_SCOPES`) |
| Claims used | `iss` and `sub` identify the person (the pair is the stored identity). `email` (with `email_verified`) is stored when present. The display name comes from `name`, then `preferred_username`, then `email`. |

**Changing the origin** (a new host name, or a transfer to another environment): register the new redirect and post-logout URIs at the IdP client. The hub stores no absolute URL of itself. It serves from the origin root, and an `APP_BASE_URL` with a path produces a start-time warning (ADR-0069 §1).

**Brokered SAML.** The hub speaks OIDC only. A corporate SAML IdP is connected through a broker such as Keycloak. See `docs/operations/identity-saml-broker.md`.

**First sign-in.** The hub looks for the person in this order (`identity/oidc.ts`):

1. A known `iss` + `sub` pair signs in that user.
2. Otherwise, a pre-provisioned active user with the same **verified** e-mail is bound to the pair, and the binding is audited (`user_identity.bind`). A user carried over by a data transfer whose identity is still unbound is refused (`identity_unbound`) until IT confirms it with `mth-db rebind-identity` (ADR-0064 §8).
3. Otherwise, a new user is created when exactly one active organization exists. If there is none, or more than one, the sign-in is refused (`not_provisioned`).

Roles are assigned inside the product (Administration). They are not read from IdP claims.

## 3. Sessions and CSRF (every API call)

- **Session cookie.** An opaque server-side session ID (256-bit random; only its SHA-256 is stored), HttpOnly, Secure, SameSite=Lax, Path=/. Over https it is named `__Host-mth_session`. It is named `mth_session` only for an `http://localhost` base URL in development.
- **Timeouts.** Idle `SESSION_IDLE_MINUTES` (default 30) and absolute `SESSION_ABSOLUTE_HOURS` (default 10).
- **CSRF.** Every unsafe method (POST, PUT, PATCH, DELETE) needs the session's CSRF token in the `X-CSRF-Token` header, from `GET /api/v1/me` (`csrfToken`). It also needs an `Origin` header equal to the origin of `APP_BASE_URL`.
- **Inbound webhooks** are the exception: a source system calls a webhook endpoint with a signed request instead of a session (see `connectors.md`).

## 4. Service identities of jobs and connectors (ADR-0053 §1)

Background work never runs as a person. Each worker job queue has a service identity `job:<queue name>`, and each connector has a service identity `connector:<connector id>` (table `service_identity`). Each identity has the following:

- a declared permission ceiling and an effective grant. Only `read` and `write` permissions are allowed. `configure`, `business_approval` and `finance_validation` are refused by a database trigger;
- a scope: the platform, or one organization;
- a sensitive-data access level: `none` or `aggregate_only`.

Every change to an identity is recorded in the append-only `service_identity_change` history. A service identity never grants a business approval or a Finance validation.

## 5. Credentials of integrations

The credentials of the object store, the SMTP relay, a corporate data source and an optional model endpoint are **SecretRefs**: a `{provider, name}` reference stored in the setting, resolved at use time from `SECRETS_DIR` and bound by `SECRET_BINDINGS_FILE` to one setting, one organization and the hosts it may be sent to. The full list, by name, is in `connectors.md`.
