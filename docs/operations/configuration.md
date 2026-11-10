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

### Secret providers (P6; ADR-0052 §5)

Settings that need a secret (connector credentials, webhook signing secrets, the email channel, the object store, the assistant endpoint) store a **reference** to it,
`{ provider, name }`, never the value. The reference is resolved at use through a `SecretProvider`. A resolved value
prints as `[secret]` in `String()`, `JSON.stringify` and log lines.

| Provider | Reads | Configuration |
|---|---|---|
| `env` (default) | only a variable named `MTH_SECRET_<NAME>`: the variable, or the file named by `MTH_SECRET_<NAME>_FILE`, exactly as the secrets rule above (both set is refused, naming the variable only) | none |
| `file` | the file `NAME` directly inside `SECRETS_DIR`, a directory **dedicated** to these secrets (for example `/run/secrets/mth-settings`, never `/run/secrets` itself); one trailing newline is removed, as for `NAME_FILE` | `SECRETS_DIR` |

**The namespace (F-DG6-120).** A reference can name only a secret IT provisioned for a setting, never one of the
platform's own variables (`DATABASE_URL`, `DATABASE_OWNER_URL`, `OIDC_CLIENT_SECRET`, `MTH_DEMO_ADMIN_DATABASE_URL`
or any other):

- `env` names are `MTH_SECRET_` followed by `A–Z 0–9 _` (first character a letter or digit, 128 characters in all at
  most), and do not end in `_FILE`. For example `{ "provider": "env", "name": "MTH_SECRET_SMTP_PASSWORD" }` reads
  `MTH_SECRET_SMTP_PASSWORD`, or the file named by `MTH_SECRET_SMTP_PASSWORD_FILE`.
- `file` names are plain file names (below). The provider also refuses a file whose real path leaves `SECRETS_DIR`
  (a symbolic link out), and a `SECRETS_DIR` that holds a platform secret file (the target of any `<VARIABLE>_FILE`
  of the process other than `MTH_SECRET_*_FILE`): resolving then fails with a configuration error naming the
  variable, never a value.
- Every setting that stores a reference (connector credentials, webhook signing secrets, the email channel, the
  object store, the assistant endpoint) refuses a reference outside the namespace when it is saved or tested:
  `400 validation` with the field error `validation.secret_ref_namespace` at the field. The answer depends on the
  name only, never on whether the variable or file exists.
- A stored reference outside the namespace, or not bound to its setting, resolves as "not set": nothing is sent.
  Re-point it to an `MTH_SECRET_*` name and bind it.

**The binding (F-DG6-181).** A reference in the namespace is still not enough: IT also **binds** each secret to the
one setting it was provisioned for, in a JSON manifest named by `SECRET_BINDINGS_FILE` (mounted read-only into the API
and the worker, for example `/run/mth-config/secret-bindings.json`). The manifest holds names, scopes and hosts, never
a value; no screen or API can change it. Each entry is `{ "provider", "name", "consumer", "organization", "hosts" }`:

- `consumer`: `connector`, `webhook_signing`, `smtp` (the email channel), `storage` (the S3 object store) or
  `assistant`.
- `organization`: the organization's **code** for `connector`, `webhook_signing` and `smtp`; `null` for `storage` and
  `assistant`, which are installation-wide. An installation secret can never be used by an organization's setting,
  and the reverse.
- `hosts`: for every kind except `webhook_signing`, the 1–16 hosts (`host` or `host:port`, lower case, no scheme or
  path, no wildcard) the secret may be sent to. A connector, email channel, object store or assistant pointed at
  another host does not receive the secret.
- Each `(provider, name)` appears once: provision a separate secret for each organization and each use.

```json
{
  "version": 1,
  "bindings": [
    { "provider": "env", "name": "MTH_SECRET_ORGB_ERP_TOKEN", "consumer": "connector", "organization": "ORGB", "hosts": ["erp.orgb.example"] },
    { "provider": "env", "name": "MTH_SECRET_ORGB_WEBHOOK_SIGNING", "consumer": "webhook_signing", "organization": "ORGB" },
    { "provider": "env", "name": "MTH_SECRET_ORGB_SMTP_PASSWORD", "consumer": "smtp", "organization": "ORGB", "hosts": ["smtp.orgb.example:587"] },
    { "provider": "file", "name": "s3_secret_access_key", "consumer": "storage", "organization": null, "hosts": ["objects.it.example"] },
    { "provider": "env", "name": "MTH_SECRET_ASSISTANT_KEY", "consumer": "assistant", "organization": null, "hosts": ["llm.it.example"] }
  ]
}
```

The example is synthetic. Rules: `version` is `1`; at most 1,000 bindings in a file of at most 1 MiB; the name is
inside its provider's namespace (so a binding can never name a platform variable); an organization code that matches
no organization binds nothing; a port of 1–65535, and an entry without a port allows any port of that host; host names
match exactly (no suffix match).

Unset `SECRET_BINDINGS_FILE` means **no reference is bound**: every setting that names a secret is refused. An
invalid file stops the API and the worker at start (exit 78, naming the entry and field, never the content). The file
is read at start; restart both after a change.

A setting that names a secret not bound to it is refused when it is saved or tested: `400 validation` with the field
error `validation.secret_ref_not_bound` (the same answer whether the secret exists or belongs to another
organization), or `validation.secret_ref_host_not_bound` at the host field when the host is not listed. Each refusal
is audited (`secret_ref.refused`). A stored reference that is no longer bound (a binding removed) resolves as "not
set": nothing is sent, and the connector shows the reference as not resolvable.

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_BINDINGS_FILE` | unset (nothing bound) | Path of the IT-maintained JSON manifest that binds each SecretRef to one setting kind, one organization code (or the installation) and the hosts it may be sent to. Holds no values. |

- `SECRETS_DIR` is **optional** (no default). Unset means the `file` provider is not configured: resolving a
  `file` reference then fails with a configuration error that names the secret, never a value. A missing file under
  a configured `SECRETS_DIR` resolves as "not set".
- The `file` provider accepts only a plain file name (`A–Z a–z 0–9 _ . -`, first character alphanumeric, at most 128
  characters): no path separators, no `..`, no leading dot.
- With no P6 variable set, the installation behaves as in DG5.
- **Current wiring:** the API (`apps/api/src/server.ts`) and the worker (`apps/worker/src/main.ts`, D-198) both
  register the two built-in providers at start. Every value a provider resolves joins the log redaction set
  (ADR-0053 §4; [monitoring.md](monitoring.md) §4.1).
- **Another store** (for example Mobily IT's vault) is plugged in by registering an IT-supplied adapter at
  composition (`server.ts`, `apps/worker/src/main.ts`). The product ships no vault adapter and claims no vault
  integration.

### Rate-limit classes (P6; ADR-0052 §4)

Every API operation is subject to the global limit. A few operations are in a **class** with its own budget,
applied **in addition to** the global limit: whichever is reached first answers `429 rate_limited` with
`Retry-After`. Each budget is a positive integer per minute (range 1–1,000,000). An invalid value stops the API at
start with exit 78 and names the variable. The API read model `GET /api/v1/admin/security/rate-limits`
(`security.read`) returns the effective budgets and the operations in each class, with no counters, client IPs or
user ids. The **Administration > Security** page (`/admin/security`, `apps/web/src/pages/admin/security/SecurityPage.tsx`;
shown to holders of `security.read` or `upload_policy.configure`, `apps/web/src/app/nav.ts`) displays that read model
read-only: the values come from the server configuration and cannot be changed in the page.

| Class | Variable | Default per minute | Keyed by | Operations wired at this release |
|---|---|---|---|---|
| global | `RATE_LIMIT_PER_MINUTE` | 300 | user, else client IP | every operation without a class |
| auth | `AUTH_RATE_LIMIT_PER_MINUTE` | 20 | client IP | `startOidcLogin`, `completeOidcLogin`, `devLogin` |
| upload | `UPLOAD_RATE_LIMIT_PER_MINUTE` | 30 | user, else client IP | `uploadEvidenceContent`, `createImport` (the import upload) |
| search | `SEARCH_RATE_LIMIT_PER_MINUTE` | 120 | user, else client IP | `searchRecords` (`GET /api/v1/search`, global search; `apps/api/src/modules/search/routes.ts`) |
| assistant | `ASSISTANT_RATE_LIMIT_PER_MINUTE` | 20 | user, else client IP | `postAssistantMessage` (`POST /api/v1/assistant/conversations/{conversationId}/messages`; `apps/api/src/modules/assistant/conversations.ts`) |
| webhook | `WEBHOOK_RATE_LIMIT_PER_MINUTE` | 600 | webhook endpoint key | `receiveWebhook` (`POST /api/v1/webhooks/{endpointKey}`; `apps/api/src/modules/integrations/routes.ts`) |
| export | `EXPORT_RATE_LIMIT_PER_MINUTE` | 10 | user, else client IP | `createExport` (export start) |

The "operations wired" column describes this tree. The authoritative list is the running API's
`getSecurityRateLimits` response, which a test pins to the routes that declare each class
(`apps/api/test/integration/admin/security.test.ts`). Behind a reverse proxy, set `TRUST_PROXY` so that "client IP"
means the real client and not the proxy.

The class matrix in code is `RATE_LIMIT_CLASSES` (`apps/api/src/modules/platform/hooks.ts`); a route joins a class
with `rateLimitClass` in its route config (upload: `apps/api/src/modules/evidence/routes.ts` and
`apps/api/src/modules/integrations/routes.ts`; export: `apps/api/src/modules/reporting/exports/routes.ts`). The
variable names are `RATE_LIMIT_CLASS_VARIABLES` (`packages/config/src/load.ts`).

**Load stacks only.** A synthetic load run (ADR-0058; `deploy/load/README.md`) raises the five class budgets to
100,000 per minute with `deploy/load/rate-limits.mjs` (or the Compose overlay `deploy/compose/compose.load.yaml`), so
that the measurement reflects the product and not the limiter. Never apply that to a production or demo stack: it
removes the abuse protection of those classes.

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
web-served. P6 adds the optional S3-compatible adapter, off unless IT configures it: see `storage.md` (its secrets are bound as `storage` in `SECRET_BINDINGS_FILE`, "The binding" above).
