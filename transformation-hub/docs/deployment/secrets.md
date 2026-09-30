# Secrets

Rules (spec §15, threat model C-34/C-38):

- **Nothing secret in Git**: no secrets in values files, images, CI logs or test reports. Values files carry only Secret *names*. `.env` files are gitignored, and `.dockerignore` excludes `.env*`, `*.pem` and `*.key`.
- **Nothing secret in images.** All configuration is runtime environment. The API image contains no credentials, and build arguments carry none. For private npm registry authentication use a BuildKit secret mount or a build-host `.npmrc` that is not part of the context. Never use `--build-arg`.
- **Least exposure.** The owner credential (`hub-db-migration`) is mounted **only** into the migration and bootstrap Jobs; `scripts/ops/validate-deploy.sh` fails if it appears in a Deployment. Pods do not mount a service-account token.
- **No secret in logs.** The entrypoint redacts connection URLs (`postgres://user:***@…`). The API never logs SQL parameters or tokens (ADR-0016). Backups contain **no** secrets: `backup.sh` refuses `--config` files that contain private keys, password URLs or cloud access keys, and the manifest records `"secretsIncluded": false`.
- **Checked in CI.** Every CI run scans the repository history and tree, the built web client bundle, and the test reports and logs for secrets. See [Secret scanning](#secret-scanning-ci) below.

## Where secrets live

| Environment | Where the values are kept | How they reach the application | Never in |
|---|---|---|---|
| Staging / production | Mobily's secret store: Vault or another external secret manager, synchronised into **Kubernetes Secrets** by the External Secrets Operator, sealed secrets, or an authorised operator (`kubectl`/`oc create secret`) | Pod environment through `secretKeyRef`. The chart references Secrets by **name** only (`values.yaml`), and the owner credential is mounted only into the migration and bootstrap Jobs | Git, Helm values files, container images, build arguments, the web bundle, CI variables, logs, test reports, backups |
| Development / evaluation (Compose) | `deploy/compose/.env`, generated locally by `scripts/ops/compose-env-init.sh` with random `local_only_…` values. The file has mode 600, is gitignored (`.env`) and is excluded from the image build context (`.dockerignore`) | Compose `environment:` | Git and images |
| Local development / CI databases | The fixed dev password `hub_dev_only` (local cluster, CI service containers) and the CI container superuser password `ci_only_postgres`. Both are synthetic and exist only in throwaway databases. Production configuration refuses `hub_dev_only` | Environment of the dev/CI process | Any shared or production system |
| CI (GitHub Actions) | No production or Mobily credentials. The workflow references no repository or organisation secrets; only the automatic read-only `GITHUB_TOKEN` (`permissions: contents: read`) is available to actions. The `compose` job generates per-run random throwaway values (masked in the log) | — | Artifacts (checked by the secret scan) |

The browser never receives a secret. It holds only the session cookie (`hub_session`, httpOnly) and the CSRF
double-submit cookie. Database credentials exist only in the api, worker and Job pods, and model-provider
credentials only in the worker (REQ-ARC-015).

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

**Rotation drill: NOT EXERCISED.** The procedures below are documented only; no rotation has been run against a live
deployment. A rotation drill (database runtime and owner passwords, cookie secret, object-storage keys) is planned
for **P7 Enterprise Readiness**, with the partial re-phase of REQ-SEC-012 recorded in
`docs/phases/P1-must-disposition.md`. Mobily sets the rotation periods (MQ-17).

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

`deploy/compose/.env.example` contains only `CHANGE_ME` placeholders. `scripts/ops/compose-env-init.sh` replaces
them with random local-only values and never prints them. The local dev password `hub_dev_only` exists solely for
local and CI databases, and production configuration rejects it (`DATABASE_URL uses the development password`).

## Secret scanning (CI)

The CI job `secret-scan` in `.github/workflows/transformation-hub-ci.yml` implements REQ-SEC-012, REQ-ARC-015 and
REQ-SET-008. It fails on any finding.

| Scope | What is scanned | Command |
|---|---|---|
| (a) Repository history | Every commit reachable from the checked-out revision, across the whole repository. The checkout is a full clone (`fetch-depth: 0`). Other branches are not part of the revision and are not scanned | `bash scripts/ops/secret-scan.sh history` |
| (a) Repository tree | The committed tree of that revision (`git archive HEAD`) | `bash scripts/ops/secret-scan.sh tree` |
| (b) Web client bundle | The `apps/web/.next/static` output of the `web` job's production build, which is what browsers download. It is also checked to contain no database or queue connection URL at all | `bash scripts/ops/secret-scan.sh bundle <dir>` |
| (c) CI test reports and logs | The artifacts of this workflow run: Playwright HTML report and traces (`e2e-report`, including the api/worker/web logs), `restore-drill` logs and manifest, `compose-smoke` container logs, and `egress-report`. The committed `docs/test-evidence/` is also scanned. Archives such as Playwright traces are opened, and the data embedded in the Playwright HTML report is unpacked before scanning | `bash scripts/ops/secret-scan.sh reports <path>…` |

- **Tool.** gitleaks 8.30.1 (MIT licence), downloaded from the GitHub release and verified against a SHA-256 pinned in the workflow. It runs with gitleaks' default rules plus one project rule, `hub-url-embedded-password`, which catches a password inside a connection URL (`postgres://user:<password>@host`, and also `amqp://`, `redis://`, `mongodb://`, `http(s)://`). The default rules do not detect this, and it is the application's main secret type. Configuration: `scripts/ops/gitleaks.toml`.
- **Allow-list policy.** The allow-list covers only known synthetic development and test values. Each entry matches the exact value, is limited to the one file where the value is a one-off, and has a comment explaining why it is not a secret:
  - `hub_dev_only` and `ci_only_postgres`;
  - the AWS documentation example key pair used by the S3 adapter contract test;
  - the made-up cookie secrets and password in `oidc-sso.spec.ts` and `storage-contract.spec.ts`;
  - the `user:secret` example in a comment of `api-entrypoint.cjs`.

  Inline `gitleaks:allow` comments are ignored (`--ignore-gitleaks-allow`). A new entry needs a security reviewer's approval in the pull request.
- **Output.** Findings are printed redacted (rule, file, line, commit). The redacted JSON reports are uploaded as the `secret-scan-report` artifact.
- **Validated in the build environment (2026-09-30), not in CI yet:**
  - history (111 commits reachable from `049cf54`), tree (679 files) and web bundle: no findings;
  - the project rule and the allow-list: without the allow-list the history scan reports 19 findings (18 URL passwords, 1 generic key), and with it, none;
  - a local Playwright run (24 tests): report, embedded report data, traces and api/worker/web logs have no findings;
  - planted, randomly generated secret-shaped values are detected in a log, inside the data embedded in a Playwright report and in a bundle chunk, and are not printed;
  - a password-less `postgres://` URL in a bundle chunk fails the bundle check.

**Limits.** The scan matches patterns and entropy, so a secret with an unusual format can still be missed. Session
cookies and CSRF tokens in Playwright traces (kept only for failed tests) are not matched; they belong to throwaway
CI sessions and databases. The container images are not scanned for secrets. The `images` job produces an SBOM and a
vulnerability report only. Adding an image filesystem scan is a follow-up for Mobily's release pipeline.

**Known item: Next.js build-generated keys in the web image (server side).** `next build` writes randomly generated
keys into the **server** output:

- the Draft Mode (preview) keys `previewModeId`, `previewModeSigningKey` and `previewModeEncryptionKey` in `.next/prerender-manifest.json`;
- the Server Actions `encryptionKey` in `.next/server/server-reference-manifest.json` (and `.js`).

gitleaks flags them when `.next/server` is scanned. They are not in `.next/static`, and they are not served to
browsers. The application uses neither Draft Mode nor Server Actions: `apps/web/src` has no `'use server'` and no
`draftMode()` at `049cf54`. The keys are nevertheless secrets baked into the web image. **Decision pending**
(ux-frontend-engineer + security reviewer): either record the acceptance and rationale in the threat model, or change
the build so the keys are not shipped. The CI scan covers the client bundle (b); it does not cover `.next/server`.
