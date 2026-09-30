# Configuration reference

The api and worker read their configuration from environment variables, validated at startup by
`apps/api/src/platform/config.ts`. With `NODE_ENV=production` the process **refuses to start** on unsafe
combinations. The Helm chart repeats the most important of those checks at render time
(`scripts/ops/validate-deploy.sh` exercises 8 refusal cases). Secrets are injected only through `secretKeyRef`;
see [secrets.md](secrets.md).

Legend: **Req-prod** = production requirement enforced by config.ts (E) or by the chart (C), or recommended (R).

## Variables read by config.ts

| Variable | Default | Production requirement | Helm value |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` (enables the guard) | `app.nodeEnv` |
| `HUB_MODE` | `standard` | `standard`; `demo` refused (E, C) | `app.mode` |
| `HUB_ORG_SLUG` | `mobily` | Must match the bootstrapped organization | `app.orgSlug` |
| `HUB_APP_NAME` | Mobily Transformation & Transactions Hub | Free text | `app.appName` |
| `PORT` | `4000` | Chart sets 4000 (api only) | fixed |
| `DATABASE_URL` | dev URL | **Secret**. Runtime role `hub_app`. Dev password refused (E); owner role refused (E); superuser, BYPASSRLS or table owner refused at startup (DB self-check). Use `sslmode=verify-full` with the DB CA | `database.runtimeSecret` |
| `DATABASE_POOL_MAX` | `20` | Size so that api replicas × pool + worker replicas × pool < the DB `max_connections` budget | `app.database.poolMax` |
| `HUB_COOKIE_SECURE` | `false` | `true` (E, C) | `app.cookieSecure` |
| `HUB_SESSION_IDLE_MINUTES` | `60` | Proposal pending Mobily Cybersecurity (MQ-15) | `app.session.idleMinutes` |
| `HUB_SESSION_ABSOLUTE_HOURS` | `12` | Same as above | `app.session.absoluteHours` |
| `HUB_TRUST_PROXY` | `false` | `true` (= 1 hop) behind an ingress/route, a hop count, or the proxy addresses/CIDRs (ADR-0017). The proxy must **overwrite** `X-Forwarded-For`. Catch-all ranges (`0.0.0.0/0`, `::/0`, IPv4 wider than /8, IPv6 wider than /16, `::ffff:0:0/96`) are refused (E, I-R2) | `app.trustProxy` |
| `HUB_STORAGE_DRIVER` | `local` | `s3` (E, C). The S3-compatible adapter is implemented; connecting it to Mobily storage is *Not configured* | `storage.driver` |
| `HUB_S3_ENDPOINT`, `HUB_S3_BUCKET`, `HUB_S3_REGION` | — | Required with `s3` (E). `https://` and host on `HUB_EGRESS_ALLOWLIST` (E) | `storage.s3.*` |
| `HUB_S3_ACCESS_KEY_ID`, `HUB_S3_SECRET_ACCESS_KEY` | — | **Secret**. Default/example credentials (`minioadmin`, AWS documentation keys …) and secrets shorter than 16 characters are refused (E, I-R2) | `storage.s3.credentialsSecret` |
| `HUB_S3_SSE`, `HUB_S3_KMS_KEY_ID` | `none` | `AES256` or `aws:kms` (+ key id) — required (E, I-R4); the chart default is `AES256` | `storage.s3.sse`, `storage.s3.kmsKeyId` |
| `HUB_S3_BUCKET_DEFAULT_ENCRYPTION` | — | `assured` only with `HUB_S3_SSE=none` after verifying the bucket's default encryption (explicit risk acceptance, logged at startup) | `storage.s3.bucketDefaultEncryptionAssured` |
| `HUB_STORAGE_LOCAL_DIR` | `.data/objects` | Development only. The image default is `/data/objects` | `storage.local.mountPath` |
| `HUB_MAX_UPLOAD_MB` | `25` | Align with the ingress body-size limit | `app.maxUploadMb` |
| `HUB_OIDC_ISSUER` | — | Required (E, C). Must be `https://` (E, C) | `oidc.issuer` |
| `HUB_OIDC_CLIENT_ID` | — | Required with OIDC | `oidc.clientId` |
| `HUB_OIDC_CLIENT_SECRET` | — | **Secret** | `oidc.clientSecret` |
| `HUB_OIDC_REDIRECT_URI` | — | `https://<host>/api/v1/auth/oidc/callback` (chart default derived from `app.publicUrl`) | `oidc.redirectUri` |
| `HUB_OIDC_LINK_BY_EMAIL` | `false` | Keep `false` unless the IdP e-mail claim is verified and unique (links a pre-provisioned, not yet bound user to their first OIDC subject; `email_verified` must be `true`). In production it also needs `HUB_OIDC_LINK_BY_EMAIL_ACK` (E, I-R2) and is logged at startup | `oidc.linkByEmail` |
| `HUB_OIDC_LINK_BY_EMAIL_ACK` | — | Exactly `accept-idp-verified-email-first-login-binding` to accept the IdP-email trust in production | `oidc.linkByEmailAck` |
| `HUB_COOKIE_SECRET` | — | **Secret**, ≥ 32 characters, required with OIDC (E). Refused when it has < 8 distinct characters, a placeholder word, or an estimated entropy < 64 bits (repetition / sequences; `openssl rand -base64 48` and `openssl rand -hex 16` pass) (E, I-R2) | `oidc.cookieSecret` |
| `HUB_AI_ALLOW_MOCK` | `true` | `false` (E, C) | `ai.allowMock` |
| `HUB_PRIVATE_MODE` | `true` | `true` | `app.privateMode` |
| `HUB_EGRESS_ALLOWLIST` | empty | Host names the app may call (in-app guard). Keep in sync with the NetworkPolicies | `app.egressAllowlist` |
| `HUB_WORKER_ID` | `worker-<pid>` | Chart sets the pod name (unique per replica; used for job leases) | automatic |
| `HUB_WORKER_POLL_MS` | `1000` | Tune from load tests | `app.workerPollMs` |
| `HUB_LOG_LEVEL` | `info` | `info` (never `debug`/`trace` in production without a change record) | `app.logLevel` |
| `HUB_CHROMIUM_PATH` | — | Set only with the `api-chromium` image (`/usr/local/bin/hub-chromium`) | `chromium.*` |
| `HUB_DB_STATEMENT_TIMEOUT_MS` | `30000` | Proposal | `app.database.statementTimeoutMs` |
| `HUB_DB_LOCK_TIMEOUT_MS` | `10000` | Proposal | `app.database.lockTimeoutMs` |
| `HUB_DB_IDLE_TX_TIMEOUT_MS` | `60000` | Proposal | `app.database.idleTxTimeoutMs` |
| `HUB_RATE_LIMIT_PER_MINUTE` | `600` | Per replica. Add an ingress/gateway limiter (ADR-0017) | `app.rateLimits.perMinute` |
| `HUB_RATE_LIMIT_MUTATIONS_PER_MINUTE` | `120` | Per replica | `app.rateLimits.mutationsPerMinute` |
| `HUB_RATE_LIMIT_PUBLIC_PER_MINUTE` | `60` | Per replica, keyed on the client IP (needs `HUB_TRUST_PROXY=true`) | `app.rateLimits.publicPerMinute` |

## Variables used by Jobs, CLIs and the entrypoint

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_MIGRATION_URL` | `migrate`, `bootstrap`, `seed-demo` | **Secret**, owner role `hub_owner`. Never mounted into long-running pods (checked by `validate-deploy.sh`) |
| `HUB_DB_RUNTIME_ROLE` | `migrate` | Default `hub_app`. The entrypoint verifies the role exists and is `NOSUPERUSER NOBYPASSRLS` before migrating |
| `HUB_ORG_NAME`, `HUB_BOOTSTRAP_ADMIN_EMAIL`, `HUB_BOOTSTRAP_ADMIN_NAME`, `HUB_BOOTSTRAP_ADMIN_OIDC_ISSUER`, `HUB_BOOTSTRAP_ADMIN_OIDC_SUBJECT` | `bootstrap` | See [installation.md](installation.md) §5 |
| `HUB_APP_ROOT` | entrypoint | Override the application root (tests only) |
| `HUB_WORKER_HEARTBEAT_FILE`, `HUB_WORKER_HEARTBEAT_MAX_AGE_MS` | worker, `healthcheck worker` | When set, the worker writes the file after every successful loop iteration and the probe fails if it is older than the maximum age (default 120000 ms). Compose sets `/tmp/hub-worker.heartbeat`; the chart does not yet. When unset, the probe falls back to a DB ping ([operations.md](operations.md)) |
| any `HUB_*` set to an empty string | entrypoint | Treated as **unset** (the entrypoint removes empty `HUB_*` values before starting). Compose passes optional settings such as `HUB_OIDC_ISSUER` as empty strings when they are not configured |

## Platform variables (set by the chart)

| Variable | Purpose |
|---|---|
| `NODE_EXTRA_CA_CERTS` | Custom CA bundle mounted at `/etc/hub/ca/<key>` (`customCA.*`). Used by `fetch`/`openid-client`, `pg` TLS and the S3 client |
| `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` (and lower case) + `NODE_USE_ENV_PROXY=1` | Outbound proxy. **Verified in the build environment:** Node 22.22.2 ignores `HTTPS_PROXY` for `fetch` unless `NODE_USE_ENV_PROXY=1` (without it the request resolved DNS directly — `ENOTFOUND`; with it, it went to the proxy — `ECONNREFUSED` on the test proxy port). Include cluster-internal names in `NO_PROXY`. The entrypoint health check never uses the proxy |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` / `OTEL_SDK_DISABLED=true` | OpenTelemetry to an internal collector. **The SDK is not wired into the app yet** (ADR-0016), so these are prepared but inert |
| `NEXT_TELEMETRY_DISABLED=1` | Next.js telemetry off (web image, build and runtime) |
| `HOSTNAME=0.0.0.0` (web) | Kubernetes sets `HOSTNAME` to the pod name and Next.js binds to it. The chart forces all interfaces |

## Proposed variables (NOT yet read by config.ts)

The chart renders these so that operators can prepare the values. The application ignores them until the
corresponding adapter is implemented. They are marked *proposed* in `values.yaml`.

| Variable | For | Owner |
|---|---|---|
| `HUB_AI_MODE`, `HUB_AI_BASE_URL`, `HUB_AI_MODEL`, `HUB_AI_API_KEY` (secret) | AI provider adapters (ADR-0009; P5) | ai-runtime |

## Web image build arguments

| Build arg | Default | Note |
|---|---|---|
| `HUB_API_URL` | `http://hub-api:4000` | Target of the `/api/*` rewrite. **Fixed at build time.** Verified: a standalone build with `HUB_API_URL=http://hub-api:4000` started with runtime `HUB_API_URL=http://127.0.0.1:4999` still proxied to `hub-api:4000` (0 hits on the runtime address). In Kubernetes the ingress/route sends `/api` to the API service directly, so the rewrite is only a fallback. The chart's `fullnameOverride: hub` makes the service `hub-api`, which matches |
| `NODE_BASE` | digest placeholder | Mirrored base image **by digest** ([supply-chain.md](supply-chain.md)) |
