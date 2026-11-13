# Production deployment guide

This guide is for Mobily IT. It covers the seven topics of handover item 8 (REQ-S19-011): domains and TLS, corporate
SSO mapping, service accounts, secrets, network boundaries, logging and monitoring. It also maps every key of the
environment template to the section that explains it. The Arabic summary is
[deployment.ar-summary.md](deployment.ar-summary.md). This English guide is the complete text.

Accepting this handover is a decision of Mobily IT, made outside the platform. This package is engineering evidence,
not that acceptance.

Compose is a reproducible install and test configuration, not evidence of high-availability readiness.

Product gates G1–G6 are business approvals inside the product. They are unrelated to the engineering delivery gates
DG0–DG7, and nothing in this guide grants or records an approval of either kind.

## Before you start {#before-you-start}

- **What runs.** One PostgreSQL database, the `api` process (HTTP, serves the web application and the API on one
  origin), the `worker` process (background jobs) and the one-shot `migrate` step. The same image runs all three
  (`mth api`, `mth worker`, `mth migrate`). Images and their digests are listed in `deploy/images.lock.json`; the
  services in `deploy/service-list.json`.
- **What IT supplies.** A host or platform that runs containers (or Node 24 for the container-free layout of
  [clean-start.md](../operations/clean-start.md)), a PostgreSQL 18 database, a DNS name and its TLS certificate, the
  corporate identity provider, a private volume or an S3-compatible bucket for evidence, a secret store, log shipping
  and monitoring. Each is listed below with the setting that names it.
- **The environment template.** `.env.example` at the repository root lists every application variable by name, with
  no values. It is generated from `packages/config/src/index.ts` (`node deploy/scripts/generate-env-example.mjs`).
  [configuration.md](../operations/configuration.md) explains each variable. The
  [configuration key index](#configuration-keys) below names the section of this guide for each key.
- **Invalid configuration stops the process.** `mth api` and `mth worker` exit 78 and name the variable, never its
  value.

## 1. Domains and TLS {#domains-and-tls}

- **The origin.** `APP_BASE_URL` is the public origin of the hub, for example `https://hub.example.internal`. It is
  used for the session cookie, the CSRF `Origin` check, the OIDC redirect URI and the deep links in notifications. In
  production it must be https; plain http is accepted only for a loopback host
  (`packages/config/src/load.test.ts`).
- **Root path only.** The hub is served from the root of its origin. Serving it under a sub-path (for example
  https://host/hub/) is not supported in this release. If `APP_BASE_URL` has a path, the API logs one warning at
  start and still serves from the origin root:
  `config: APP_BASE_URL has the path '<path>'; serving under a sub-path is not supported, so the hub is served from the origin root (see the deployment guide)`.
- **TLS termination** happens at Mobily IT's reverse proxy or load balancer, with a certificate from Mobily's
  certificate authority (security-controls HR-01). The API listens on plain HTTP on `PORT` inside the network
  boundary. Under https the session cookie is `Secure` with the `__Host-` prefix
  (`apps/api/test/integration/identity.test.ts`).
- **The proxy.** `TRUST_PROXY` lists the reverse-proxy addresses whose `X-Forwarded-*` headers are trusted. Leave it
  empty when no proxy sits in front of the API. Set it to the proxy's address only, never to a wide range.
- **Database TLS** (security-controls HR-02). `DATABASE_URL` and `DATABASE_OWNER_URL` carry the server's TLS
  parameters, for example `sslmode=verify-full` with `sslrootcert=<CA file>`. A corporate CA can also be given
  through `MTH_EXTRA_CA_CERTS_FILE` (Compose passes it as `NODE_EXTRA_CA_CERTS`). No product code sets TLS on its own:
  the URL is handed to the PostgreSQL driver as given (`packages/db/test/integration/db-tls.test.ts`;
  [configuration.md](../operations/configuration.md)).
- **TLS to other services** (HR-03): the OIDC issuer and the assistant endpoint must be https in production; SMTP has
  per-channel TLS settings; the object-store endpoint is a URL IT gives ([storage.md](../operations/storage.md)).
- **Moving to another address.** After a move to another address, register the new sign-in redirect address with the
  identity provider: <origin>/api/v1/auth/callback. See [Moving to another address](#origin-change).

## 2. Corporate SSO mapping {#corporate-sso-mapping}

- **Protocol.** OIDC authorization code with PKCE; the API is a confidential client. `AUTH_MODE` must be `oidc` in
  production (`dev` is refused when `NODE_ENV=production`).
- **The client IT registers** with the corporate identity provider:
  - redirect URI `<origin>/api/v1/auth/callback` (from `APP_BASE_URL`);
  - post-logout redirect `<origin>/*`;
  - scopes `openid profile email` (`OIDC_SCOPES`);
  - the `email` and `email_verified` claims, used only to bind a pre-provisioned user.
- **The settings.** `OIDC_ISSUER_URL` (https in production), `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` (as
  `OIDC_CLIENT_SECRET_FILE`, see [Secrets](#secrets)). Session lifetimes: `SESSION_IDLE_MINUTES` (default 30) and
  `SESSION_ABSOLUTE_HOURS` (default 10).
- **Who a user is.** A user is identified by the pair (issuer, subject), never by e-mail alone. A pre-provisioned user
  with no identity for the issuer yet is bound on first sign-in through a verified e-mail address. A SAML-only
  identity provider needs an OIDC broker that IT runs ([identity-saml-broker.md](../operations/identity-saml-broker.md)).
- **Groups and roles.** The hub does not read `groups` or `roles` claims. Roles are explicit scoped assignments made
  by an access administrator in Administration > Access, and each is audited (ADR-0006). A `groups` claim from the
  identity provider is input for IT's access reviews only. The roles and permissions in
  [role-matrix.md](role-matrix.md) are the platform's configurable starting point, not a Mobily-approved access
  policy.
- **The first administrator.** At least one administrator must be mapped before anyone signs in. `mth db bootstrap`
  creates the first organization and the first technical and access administrator, bound to the issuer and subject IT
  gives (`--admin-issuer`, `--admin-subject`). It is refused when an organization already exists.
- **After a transfer.** Imported users are held until IT confirms each identity. `mth-db rebind-identity --mapping FILE
  --operator NAME` applies IT's mapping file, all or nothing (ADR-0064 §8).
- **External dependency.** Sign-in has been tested only with a synthetic identity provider. Connecting the corporate
  identity provider is an external dependency. Not verified in this release. Mobily IT must supply and test it.
  The Keycloak realm `mth-test` (`deploy/keycloak/realm-mth-test.json`) is a test realm with synthetic users only.

## 3. Service accounts {#service-accounts}

- **Database roles** (ADR-0003; created by IT's DBA in production, by `deploy/compose/db-init/10-mth-roles.sh` in
  Compose):
  - `mth_owner` owns the database and the schema. It is used only by `mth migrate` and the `mth db` commands, through
    `DATABASE_OWNER_URL`.
  - `mth_app` is used by both `api` and `worker`, through `DATABASE_URL`. It has data access only: no DDL, and on
    `audit_event` insert and read only.
  - There is no separate database role for the worker: the worker connects as `mth_app`. Its narrower rights are
    application-level service identities (next item).
- **Worker service identities** (ADR-0053). Every job runs as `job:<queue>` with the narrowest set of read
  permissions it needs. The database refuses a configure, business approval or Finance validation permission for a
  service identity. See [automation-operations.md](automation-operations.md).
- **Evidence store account.** With the filesystem driver, the container user needs read and write access to
  `EVIDENCE_STORAGE_PATH` (a private volume, never web-served). With the S3-compatible driver, IT supplies a
  least-privilege access key pair for one private bucket, given as secret references
  ([storage.md](../operations/storage.md)).
- **Demo only.** `MTH_DEMO_ADMIN_DATABASE_URL` names a role with `CREATEDB` for the demo reset. Never set it in
  production.

## 4. Secrets {#secrets}

- **Runtime configuration only.** No secret is in the repository, an image, a backup set or a migration package.
  Each secret variable can be given as a file named by `<NAME>_FILE`; setting both `NAME` and `NAME_FILE` is refused
  at start. The secret variables of `.env.example` are:
  - `DATABASE_URL_FILE` (the `mth_app` URL, with its password);
  - `DATABASE_OWNER_URL_FILE` (the `mth_owner` URL, with its password);
  - `OIDC_CLIENT_SECRET_FILE` (the OIDC client secret);
  - `MTH_DEMO_ADMIN_DATABASE_URL_FILE` (demo installations only).
- **Connector, mail, storage and assistant credentials** are `SecretProvider` references: a setting stores the
  reference name, never the value, and no screen or API response shows the value. `SECRETS_DIR` is the directory of
  the built-in file provider. `SECRET_BINDINGS_FILE` is IT's manifest that binds each reference to one consumer, one
  scope and the hosts it may be sent to ([configuration.md](../operations/configuration.md), "Secret providers").
- **Rotation** (security-controls HR-06): replace the file, then restart the process that reads it. For a database
  password, change the role's password first, then the file.
- **Checks.** `node tools/release/secret-scan.mjs --scope payload` and `--scope history` scan the repository, and the
  environment template check refuses any value in `.env.example` (ADR-0063). Logs censor every resolved secret
  ([Logging](#logging)).
- **Local Compose only.** `deploy/scripts/init-secrets.sh` generates random values outside the repository and points
  `MTH_SECRETS_DIR` at them.

## 5. Network boundaries {#network-boundaries}

- **Inbound.** Only the API port (`PORT`, default 3000), and only behind IT's TLS proxy. The database is reached by
  `api`, `worker` and `migrate` only. Compose publishes the API on `127.0.0.1` by default (`MTH_API_BIND`,
  `MTH_API_PORT`).
- **Public endpoints.** `/healthz`, `/readyz`, the sign-in routes and `POST /api/v1/webhooks/{endpointKey}` (signed
  by the sender IT authorizes). Everything else needs a session.
- **Outbound: none required.** The application uses no telemetry, analytics, CDN, remote fonts or update checks
  ([restricted-network.md](../operations/restricted-network.md)). `deploy/compose/compose.no-egress.yaml` runs the
  stack on an internal-only network.
- **Optional outbound destinations**, each off by default and opened only when an administrator configures it with
  values IT supplies: the SMTP relay, a connector's source endpoint, the S3-compatible object store and the assistant
  model endpoint. Enterprise messaging has no adapter in this release. Where a secret may be sent is limited by the
  hosts of its binding in `SECRET_BINDINGS_FILE`.
- **Rate limits** per session or address: `RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE`,
  `UPLOAD_RATE_LIMIT_PER_MINUTE`, `SEARCH_RATE_LIMIT_PER_MINUTE`, `ASSISTANT_RATE_LIMIT_PER_MINUTE`,
  `WEBHOOK_RATE_LIMIT_PER_MINUTE` and `EXPORT_RATE_LIMIT_PER_MINUTE` ([configuration.md](../operations/configuration.md),
  "Rate-limit classes").

## 6. Logging {#logging}

- **Format.** Every API and worker log line is one JSON object on stdout, with `time`, `level` and `msg`, and where
  known `requestId`, `jobId`, `queue`, `serviceIdentity`, `organizationId` and `errorCode`. Request and response bodies
  are never logged. `LOG_LEVEL` sets the level (default `info`).
- **Redaction.** One redaction set is applied to every line before it is written: resolved secrets, the secret
  variables, storage keys, URLs and paths, header and URL tokens ([monitoring.md](../operations/monitoring.md) §4).
- **The audit trail is in the database, not in the logs.** `audit_event` is append-only (ADR-0004). Logs are
  operational only.
- **Alert lines.** A new operational exception writes an `error` line with `"alert": true`. IT routes these to its
  monitoring.
- **Retention and shipping** of logs are IT's. Compose keeps container logs with the `json-file` driver, rotated at
  10 MB × 5 files per container.

## 7. Monitoring {#monitoring}

- **`/healthz`** answers when the process runs. **`/readyz`** reports `database`, `migrations`, `storage` and
  `worker`. Readiness needs the database, the migrations and the evidence storage. The worker status is shown but
  does not stop the service from being ready. Details: [health-readiness.md](../operations/health-readiness.md).
- **Worker heartbeat.** The worker writes a beat every `WORKER_HEARTBEAT_SECONDS` (default 30). The status is `alive`
  within 90 s, `stale` when older and `unknown` when there is none; `stale` and `unknown` are never shown as healthy.
- **Operational exceptions** are listed in Administration > Operations, and each new one writes an alert line
  ([monitoring.md](../operations/monitoring.md) §2, §3).
- **Deployment status.** `GET /api/v1/admin/deployment` (`getDeploymentStatus`, permission `operations.read`) returns
  the origin, the application and contract versions, the schema level, the readiness checks and the environment kind.
  No screen shows it in this release: the web client has the call, but no page uses it.
- **Container healthcheck.** `mth health /readyz` exits 0 only on a 2xx. The image has no curl.
- **Production monitoring** (dashboards, paging, log shipping) is IT's, and is not part of this release
  ([monitoring.md](../operations/monitoring.md) §6).

## Database and migrations {#database}

- PostgreSQL with UTF8 encoding (`mth-db` refuses any other). The database time zone is UTC; the business default is
  `DEFAULT_TIMEZONE`.
- `mth migrate` applies pending migrations under an advisory lock and refuses a changed migration. `mth db status`
  exits 0 only when the schema is up to date. Before an upgrade, run the dry run of [upgrades.md](upgrades.md).
- **Encryption at rest** of the database volume, its backups and the evidence volume is a hosting function (disk,
  volume or managed-service encryption) that IT provides; the product has no function for it (security-controls
  HR-04, HR-05). For the S3-compatible store, server-side encryption is a bucket setting IT controls.
- Backup and restore: [backup-restore.md](backup-restore.md). Recovery objectives are to be agreed with Mobily IT.

## Evidence storage {#evidence-storage}

- `EVIDENCE_STORAGE_DRIVER` is `filesystem` (default) or `s3`. `EVIDENCE_STORAGE_PATH` is the private directory of the
  filesystem driver (default `/var/lib/mth/evidence`). The S3-compatible store is configured in Administration >
  Storage with values IT supplies ([storage.md](../operations/storage.md)).
- Evidence storage gates readiness: an API that cannot store or serve evidence reports `storage: fail` and is not
  ready.

## Worker settings {#worker-settings}

`WORKER_SUPERVISE_INTERVAL_SECONDS` (default 60), `WORKER_HEARTBEAT_SECONDS` (default 30), `WORKER_JOB_BATCH_SIZE`
(default 8) and `WORKER_JOB_CONCURRENCY` (default 4). Several worker processes can run against one database; every
job is idempotent ([automation-operations.md](automation-operations.md)).

## Application settings {#application-settings}

- `NODE_ENV` is `production` in every deployment IT runs. `MTH_ENV` defaults to `production` then; `demo` is set only
  on a demonstration installation.
- `PRODUCT_NAME` (default "Mobily Transformation Hub"), `DEFAULT_TIMEZONE` (default `Asia/Riyadh`) and
  `DEFAULT_CURRENCY` (default `SAR`) apply to new organizations and can be changed.
- `#0078FF` is a provisional brand colour token, not a verified Mobily colour.

## Compose service → role map {#compose-service-roles}

| Compose service | Generic role | Needed in production |
| --- | --- | --- |
| `db` | PostgreSQL database | yes (IT's database platform may replace it) |
| `migrate` | one-shot schema migration, run before `api` and `worker` start | yes, at every install and upgrade |
| `api` | HTTP application server (web application and API on one origin) | yes |
| `worker` | background job processor | yes |
| `keycloak` (profile `test-idp`) | synthetic test identity provider | no: test only |
| `smoke` (profile `smoke`) | post-install smoke test | no: test only |
| `load-generate`, `load-sessions` (profile `load`) | synthetic load dataset and sessions | no: test only |
| `backup` (profile `backup`) | backup set on the pinned PostgreSQL image | as IT decides ([backup-restore.md](backup-restore.md)) |

## High availability {#high-availability}

Compose is a reproducible install and test configuration, not evidence of high-availability readiness. This release
runs one database with no replication. Several worker processes can run against one database
([automation-operations.md](automation-operations.md)). No multi-instance or failover configuration has been tested. Availability and recovery objectives are to be agreed with
Mobily IT.

## Orchestration target {#orchestration-target}

Deployment configuration for Mobily's orchestration platform is to be written when IT names the target. This release
ships no such configuration. It is an external dependency (see [known-limitations.md](known-limitations.md)).

## Moving to another address {#origin-change}

After a move to another address, register the new sign-in redirect address with the identity provider:
<origin>/api/v1/auth/callback. Then set `APP_BASE_URL` to the new origin and restart `api`. Deep links in messages
that were already sent keep the old origin. The transfer itself (export, import, reconciliation, identity rebind) is
described in ADR-0064 and in Administration > Data export and Data import.

## First deployment, in order {#first-deployment}

1. IT creates the database, the roles `mth_owner` and `mth_app`, and the secret files ([Service accounts](#service-accounts), [Secrets](#secrets)).
2. IT registers the OIDC client ([Corporate SSO mapping](#corporate-sso-mapping)) and the DNS name and certificate ([Domains and TLS](#domains-and-tls)).
3. Fill the variables of `.env.example` from the [configuration key index](#configuration-keys).
4. Run `mth migrate`, then `mth db status` (exit 0).
5. Run `mth db bootstrap` with the first administrator's issuer and subject.
6. Start `api` and `worker`; wait for `mth health /readyz` to exit 0 ([Monitoring](#monitoring)).
7. Sign in as the first administrator; check the deployment status ([Monitoring](#monitoring)).

## Configuration key index {#configuration-keys}

Every key of `.env.example`, with the section of this guide that explains it.

| Key | Section |
| --- | --- |
| `NODE_ENV` | [Application settings](#application-settings) |
| `APP_BASE_URL` | [1. Domains and TLS](#domains-and-tls) |
| `PORT` | [5. Network boundaries](#network-boundaries) |
| `DATABASE_URL` | [3. Service accounts](#service-accounts) |
| `DATABASE_OWNER_URL` | [3. Service accounts](#service-accounts) |
| `AUTH_MODE` | [2. Corporate SSO mapping](#corporate-sso-mapping) |
| `OIDC_ISSUER_URL` | [2. Corporate SSO mapping](#corporate-sso-mapping) |
| `OIDC_CLIENT_ID` | [2. Corporate SSO mapping](#corporate-sso-mapping) |
| `OIDC_CLIENT_SECRET` | [4. Secrets](#secrets) |
| `OIDC_SCOPES` | [2. Corporate SSO mapping](#corporate-sso-mapping) |
| `SESSION_IDLE_MINUTES` | [2. Corporate SSO mapping](#corporate-sso-mapping) |
| `SESSION_ABSOLUTE_HOURS` | [2. Corporate SSO mapping](#corporate-sso-mapping) |
| `EVIDENCE_STORAGE_DRIVER` | [Evidence storage](#evidence-storage) |
| `EVIDENCE_STORAGE_PATH` | [Evidence storage](#evidence-storage) |
| `PRODUCT_NAME` | [Application settings](#application-settings) |
| `DEFAULT_TIMEZONE` | [Application settings](#application-settings) |
| `DEFAULT_CURRENCY` | [Application settings](#application-settings) |
| `RATE_LIMIT_PER_MINUTE` | [5. Network boundaries](#network-boundaries) |
| `AUTH_RATE_LIMIT_PER_MINUTE` | [5. Network boundaries](#network-boundaries) |
| `UPLOAD_RATE_LIMIT_PER_MINUTE` | [5. Network boundaries](#network-boundaries) |
| `SEARCH_RATE_LIMIT_PER_MINUTE` | [5. Network boundaries](#network-boundaries) |
| `ASSISTANT_RATE_LIMIT_PER_MINUTE` | [5. Network boundaries](#network-boundaries) |
| `WEBHOOK_RATE_LIMIT_PER_MINUTE` | [5. Network boundaries](#network-boundaries) |
| `EXPORT_RATE_LIMIT_PER_MINUTE` | [5. Network boundaries](#network-boundaries) |
| `SECRETS_DIR` | [4. Secrets](#secrets) |
| `SECRET_BINDINGS_FILE` | [4. Secrets](#secrets) |
| `LOG_LEVEL` | [6. Logging](#logging) |
| `WORKER_SUPERVISE_INTERVAL_SECONDS` | [Worker settings](#worker-settings) |
| `WORKER_HEARTBEAT_SECONDS` | [7. Monitoring](#monitoring) |
| `WORKER_JOB_BATCH_SIZE` | [Worker settings](#worker-settings) |
| `WORKER_JOB_CONCURRENCY` | [Worker settings](#worker-settings) |
| `MTH_ENV` | [Application settings](#application-settings) |
| `MTH_DEMO_ADMIN_DATABASE_URL` | [3. Service accounts](#service-accounts) |
| `TRUST_PROXY` | [1. Domains and TLS](#domains-and-tls) |

Compose-level interpolation variables (`MTH_SECRETS_DIR`, `MTH_APP_IMAGE`, `MTH_APP_PULL_POLICY`, `MTH_APP_BASE_URL`,
`MTH_OIDC_ISSUER_URL`, `MTH_OIDC_CLIENT_ID`, `MTH_EXTRA_CA_CERTS_FILE`, `MTH_API_BIND`, `MTH_API_PORT` and the
`MTH_*` pass-throughs) are listed in [configuration.md](../operations/configuration.md), "Compose-level settings".

## Sources {#sources}

`.env.example`; `packages/config/src/index.ts`; `deploy/compose/compose.yaml`; `deploy/compose/compose.no-egress.yaml`;
`deploy/compose/db-init/10-mth-roles.sh`; `docs/operations/configuration.md`, `identity-saml-broker.md`, `storage.md`,
`restricted-network.md`, `health-readiness.md` and `monitoring.md`; [security-controls.md](security-controls.md);
ADR-0003, ADR-0004, ADR-0006, ADR-0053, ADR-0063, ADR-0064, ADR-0069 and ADR-0072.
