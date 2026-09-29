# Secrets

Rules (spec §15, threat model C-34/C-38):

- **Nothing secret in Git**: no secrets in values files, images, CI logs or test reports. Values files carry only Secret *names*. `.env` files are gitignored, and `.dockerignore` excludes `.env*`, `*.pem` and `*.key`.
- **Nothing secret in images.** All configuration is runtime environment. The API image contains no credentials, and build arguments carry none. For private npm registry authentication use a BuildKit secret mount or a build-host `.npmrc` that is not part of the context. Never use `--build-arg`.
- **Least exposure.** The owner credential (`hub-db-migration`) is mounted **only** into the migration and bootstrap Jobs; `scripts/ops/validate-deploy.sh` fails if it appears in a Deployment. Pods do not mount a service-account token.
- **No secret in logs.** The entrypoint redacts connection URLs (`postgres://user:***@…`). The API never logs SQL parameters or tokens (ADR-0016). Backups contain **no** secrets: `backup.sh` refuses `--config` files that contain private keys, password URLs or cloud access keys, and the manifest records `"secretsIncluded": false`.

## Inventory

| Secret (default name) | Keys | Consumers | Rotation (proposal; Mobily sets periods — MQ-17) | Rotation effect |
|---|---|---|---|---|
| `hub-db-runtime` | `DATABASE_URL` (role `hub_app`) | api, worker | 90 days, or on suspicion | Rolling restart of api and worker |
| `hub-db-migration` | `DATABASE_MIGRATION_URL` (role `hub_owner`) | migration and bootstrap Jobs | 90 days; before and after vendor support sessions | None at runtime |
| `hub-oidc` | `HUB_OIDC_CLIENT_SECRET` | api | Per IdP policy | Sign-ins fail until the app and the IdP match — coordinate with IAM |
| `hub-oidc` | `HUB_COOKIE_SECRET` (≥ 32 chars) | api | 180 days, or on suspicion | In-flight OIDC logins (signed state cookies) must restart. Sessions are unaffected (server-side, hashed tokens) |
| `hub-object-storage` | `HUB_S3_ACCESS_KEY_ID`, `HUB_S3_SECRET_ACCESS_KEY` (proposed names) | api, worker | 90 days | Rolling restart |
| `hub-tls` | `tls.crt`, `tls.key` | ingress | Per PKI policy (cert-manager or manual) | Ingress reload |
| `hub-ai-gateway` (optional) | `HUB_AI_API_KEY` (proposed) | worker | Per gateway policy. Activate the AI kill switch first if it leaked | AI unavailable until updated; the core keeps working (AT-21) |
| registry pull secret (optional) | `.dockerconfigjson` | all pods | Per registry policy | New pulls only |

Session tokens are random 256-bit values stored only as SHA-256 hashes (ADR-0005). There is no session-signing key
to rotate. Revoking all sessions (for example after a restore; `restore.sh` does this) forces re-authentication at
the IdP.

## Procedure: rotate a database password (zero-downtime pattern)

1. The DBA sets a new password on the role. For zero downtime, use a second login role, or rely on the DB's support for two valid passwords during the window.
2. Update the Secret (`hub-db-runtime` or `hub-db-migration`) through the secret process (for example Vault + External Secrets Operator).
3. `kubectl rollout restart deploy/hub-api deploy/hub-worker` (runtime role only). Watch readiness (`/readyz`).
4. Revoke the old password. Record the change (who, when, ticket).

## Creating Secrets (example — run by an authorised operator, values from the secret store)

```bash
kubectl -n <ns> create secret generic hub-db-runtime   --from-literal=DATABASE_URL="$RUNTIME_URL"
kubectl -n <ns> create secret generic hub-db-migration --from-literal=DATABASE_MIGRATION_URL="$OWNER_URL"
kubectl -n <ns> create secret generic hub-oidc --from-literal=HUB_OIDC_CLIENT_SECRET="$OIDC_SECRET" \
  --from-literal=HUB_COOKIE_SECRET="$(openssl rand -base64 48)"
```

Prefer an External Secrets / Vault integration so that values never pass through shell history. None of these
commands were executed in the build environment.

## Development

`deploy/compose/.env.example` contains only `CHANGE_ME` placeholders. The local dev password `hub_dev_only` exists
solely for local and CI databases, and production configuration rejects it (`DATABASE_URL uses the development
password`).
