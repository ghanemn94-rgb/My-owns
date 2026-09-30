# Configuration and identity provider (§19 item 6, REQ-S19-009; P1 increment)

## Environment template

`.env.example` at the repository root is **generated** from the frozen catalogue `ENV_VARS` in
`packages/config/src/index.ts`:

```bash
node deploy/scripts/generate-env-example.mjs          # regenerate
node deploy/scripts/generate-env-example.mjs --check  # CI: exact names, no values, no drift
```

It lists every variable name with its description, whether it is required, its default and which process reads it.
Every line is `NAME=` with **no value**. Unset or empty variables take their defaults. The services validate their
configuration at startup and exit 78 with a message that names the variable, never its value.

## Secrets

- Secrets are runtime configuration and are never in the repository. Pass them in the environment, or preferably as
  files named by `<NAME>_FILE` (for example `DATABASE_URL_FILE=/run/secrets/database_url`). Setting both `NAME` and
  `NAME_FILE` is refused.
- The secret variables are `DATABASE_URL` and `DATABASE_OWNER_URL`, both of which contain passwords, and
  `OIDC_CLIENT_SECRET`.
- For local Compose, `deploy/scripts/init-secrets.sh` generates random values **outside** the repository (default
  `~/.config/mth-compose/secrets`, directory mode 0700). It refuses a directory inside the repository and writes
  `deploy/compose/.env` (git-ignored) containing only `MTH_SECRETS_DIR`. Compose mounts the files under
  `/run/secrets`, so no secret value appears in `docker inspect` environment output.
- The two database roles (ADR-0003): `mth_owner` owns the schema and is used only by `mth migrate` / `mth db`.
  `mth_app` is used by `api` and `worker` and has DML only: it can only insert and read `audit_event` and cannot run
  DDL. Deployment creates both roles and the database (`db-init/10-mth-roles.sh` for Compose; IT's DBA in production).

## Compose-level settings (`deploy/compose/compose.yaml`)

These are interpolation variables, not application variables:

| Variable | Default | Purpose |
|---|---|---|
| `MTH_SECRETS_DIR` | none (required) | Directory with the secret files |
| `MTH_APP_IMAGE` / `MTH_APP_PULL_POLICY` | `mth-app:local` / `never` | Use IT's registry image with `missing` |
| `MTH_APP_BASE_URL` | `http://localhost:3000` | Public origin (cookies, CSRF Origin check, OIDC redirect URI) |
| `MTH_OIDC_ISSUER_URL`, `MTH_OIDC_CLIENT_ID` | test realm, `mth-hub` | Corporate IdP settings |
| `MTH_EXTRA_CA_CERTS_FILE` | the test IdP's throwaway CA | Trust anchor for an IdP certificate that is not publicly trusted |
| `MTH_API_BIND`, `MTH_API_PORT` | `127.0.0.1`, `3000` | Published API address |
| `MTH_DEFAULT_TIMEZONE`, `MTH_DEFAULT_CURRENCY`, `MTH_LOG_LEVEL`, `MTH_TRUST_PROXY` | `Asia/Riyadh`, `SAR`, `info`, empty | Passed to the application variables |

## Identity provider

**Production uses Mobily's corporate IdP over OIDC** (authorization code + PKCE; the API is a confidential client).
Register a client with:

- redirect URI `<APP_BASE_URL>/api/v1/auth/callback`;
- post-logout redirect `<APP_BASE_URL>/*`;
- scopes `openid profile email`;
- the `email_verified` claim, which is used only to bind pre-provisioned users.

Then set `OIDC_ISSUER_URL` (https is required in production), `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET[_FILE]`.
Users are identified by `(issuer, subject)`, never by e-mail alone. SAML-only IdPs need an OIDC broker; this is
documented for P6.

**Keycloak is a TEST dependency only** (Compose profile `test-idp`):

- The realm is `deploy/keycloak/realm-mth-test.json` (`mth-test`, client `mth-hub`, PKCE S256 required, direct
  grants off).
- Its users are **synthetic** (`smoke.admin`, `smoke.office`, `test.lead`, `test.sponsor`, `test.unverified`, all
  `@example.invalid`) with fixed IDs, so a test administrator can be bootstrapped by subject. `test.unverified` has
  `emailVerified: false`, for binding tests.
- The file contains **no credentials**. The client secret, the users' password and the redirect origin are
  `${MTH_TEST_OIDC_CLIENT_SECRET}`, `${MTH_TEST_USER_PASSWORD}` and `${MTH_APP_BASE_URL}` placeholders. Keycloak
  substitutes them at import from values the container reads from its secret files at start.
  [UNVERIFIED in this sandbox: placeholder substitution at realm import was not exercised because no container
  runtime was available; `verify-stack.sh` exercises it.]
- The realm is served over HTTPS at `https://keycloak:8443` with a throwaway CA from `init-secrets.sh`. That CA's
  private key is discarded after signing. HTTPS lets the API keep `NODE_ENV=production`, which requires an https
  issuer.
- To sign in interactively from a browser on the host, make `keycloak` resolve to `127.0.0.1` (a hosts-file entry)
  and trust `test-idp-ca.pem`, or use the smoke service.
- The Keycloak admin console user is `mth-test-admin`. Its password is in `test_idp_admin_password`.

## Evidence storage

P1 uses the private filesystem adapter (`EVIDENCE_STORAGE_DRIVER=filesystem`, `EVIDENCE_STORAGE_PATH`, default
`/var/lib/mth/evidence`). In Compose this is the `evidence` named volume, owned by uid 10001, mode 0700, and never
web-served. The optional S3-compatible adapter is a later-stage item (P6).
