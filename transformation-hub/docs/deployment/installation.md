# Installation runbook

Status: **engineering template**. The chart was linted and rendered in the build environment, and the manifests were
schema-validated with kubeconform. It has **never been installed on a cluster**, and no image has been built there,
because no Docker daemon was available. Production approval requires Mobily's infrastructure, security and business
owners (master prompt §22).

Related runbooks: [configuration](configuration.md) · [secrets](secrets.md) · [network flows](network-flows.md) ·
[private mode](private-mode.md) · [environments](environments.md) · [handover checklist](handover-checklist.md)

## 1. What Mobily must provide (prerequisites)

| # | Input | Requirement | Notes |
|---|---|---|---|
| P-1 | Kubernetes ≥ 1.27 **or** OpenShift 4.x | A namespace per environment. Pod Security `restricted` or the OpenShift `restricted-v2` SCC is sufficient | The chart needs no cluster-scoped objects, no RBAC and no privileged pods |
| P-2 | Private container registry | Pull access from the namespace (`imagePullSecrets`). Mobily's pipeline pushes the images | [supply-chain.md](supply-chain.md) |
| P-3 | PostgreSQL 16 (managed service or operator) | One database per environment and two roles: **`hub_owner`** (owns the schema; used only by the migration and bootstrap Jobs) and **`hub_app`** (`LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`; runtime). Extensions `pgcrypto` and `citext`. `REVOKE ALL ON DATABASE … FROM PUBLIC; GRANT CONNECT … TO hub_app` | Reference implementation: `scripts/ops/db-init-roles.sh`. The API refuses to start in production if its role is superuser, has BYPASSRLS or owns tables |
| P-4 | S3-compatible object storage | A private bucket, versioning or object lock where available, server-side encryption, and credentials limited to the bucket | **The S3 adapter is *Not configured* at this application version.** Uploads fail closed until it is implemented |
| P-5 | Identity provider | OIDC (Authorization Code + PKCE), MFA enforced at the IdP. SAML-only IdPs through an OIDC-capable broker. A confidential client with redirect URI `https://<host>/api/v1/auth/oidc/callback` | [user-provisioning.md](user-provisioning.md) |
| P-6 | TLS certificate and custom CA | A certificate for the public host name from Mobily PKI. A CA bundle (PEM) for any internal endpoints with private certificates | Ingress `tls.secretName`, OpenShift Route, `customCA.*` |
| P-7 | DNS | An internal record for the host name (for example `hub.<internal-domain>`) | |
| P-8 | Outbound proxy (if used) | Proxy URL and a `NO_PROXY` list | Node honours it only with `NODE_USE_ENV_PROXY=1`, which the chart sets |
| P-9 | Network | CIDRs or selectors for PostgreSQL, object storage, IdP, OTEL collector and the proxy. The ingress controller namespace label | NetworkPolicies are default-deny |
| P-10 | SIEM / log platform | Collection of container stdout (JSON logs) and a future audit-export destination | [operations.md](operations.md) |
| P-11 | OpenTelemetry collector (optional) | An internal OTLP endpoint | OTel SDK wiring is pending (ADR-0016) |
| P-12 | Approved model endpoint (optional) | Only for the Local-AI or AI-Gateway modes, after approval (MQ-06/MQ-07) | Default is AI **off** |
| P-13 | Backup platform | Encrypted backup target, retention, operators, immutability | [backup-restore.md](backup-restore.md) |

## 2. Prepare secrets (no secrets in Git or in values files)

Create these Secrets through Mobily's secret process (Vault/ESO, sealed secrets, or `oc create secret` by an
authorised operator). Names are the chart defaults.

| Secret | Keys | Used by |
|---|---|---|
| `hub-db-runtime` | `DATABASE_URL` = `postgres://hub_app:<pw>@<host>:5432/<db>?sslmode=verify-full` | api, worker |
| `hub-db-migration` | `DATABASE_MIGRATION_URL` = `postgres://hub_owner:<pw>@…` | migration and bootstrap Jobs **only** |
| `hub-oidc` | `HUB_OIDC_CLIENT_SECRET`, `HUB_COOKIE_SECRET` (≥ 32 random characters) | api, worker |
| `hub-object-storage` | `HUB_S3_ACCESS_KEY_ID`, `HUB_S3_SECRET_ACCESS_KEY` | api, worker |
| `hub-tls` | `tls.crt`, `tls.key` | ingress (Kubernetes) |
| `hub-ai-gateway` (optional) | `HUB_AI_API_KEY` | worker (AI modes only) |

The rules for each secret are in [secrets.md](secrets.md).

## 3. Values for the environment

Keep a values file per environment in Mobily's configuration repository, for example `values-prod-inputs.yaml`.
Replace every `REPLACE` item in `deploy/helm/transformation-hub/values.yaml`:

- **Images:** `image.registry`, `image.*.digest`.
- **Application:** `app.publicUrl`, `app.orgSlug`, `oidc.issuer`, `oidc.clientId`.
- **Storage:** `storage.s3.*`.
- **Exposure:** `ingress.host` / `route.host`, `ingress.className`.
- **Network:** `networkPolicy.ingressController`, `networkPolicy.egress.*.to`.
- **Platform:** `proxy.*`, `customCA.*`, `otel.*`.

Add one mode overlay: `values-private-ai-off.yaml` (the default), `values-private-local-ai.yaml` or
`values-private-ai-gateway.yaml`.

Validate before installing. This is the same command the build environment ran:

```bash
KUBE_VERSION=<cluster version> bash scripts/ops/validate-deploy.sh
helm template hub deploy/helm/transformation-hub -n <ns> -f values-prod-inputs.yaml -f deploy/helm/transformation-hub/values-private-ai-off.yaml --kube-version <cluster version> > rendered.yaml
```

## 4. Install

```bash
helm upgrade --install hub deploy/helm/transformation-hub -n <ns> \
  -f values-prod-inputs.yaml -f deploy/helm/transformation-hub/values-private-ai-off.yaml \
  --wait --timeout 15m
```

The chart installs the following, in order:

1. Pre-install hooks: the NetworkPolicy for the Jobs (PostgreSQL + DNS only), the injected CA ConfigMap (OpenShift, if enabled), and the **migration Job** (`migrate` command, owner role). The migration Job refuses to run as the runtime role and verifies that `hub_app` exists and is `NOSUPERUSER NOBYPASSRLS`.
2. The api and worker Deployments (same image, commands `api` and `worker`), the web Deployment, Services, the Ingress (or two Routes on OpenShift, `/api` and `/`), NetworkPolicies, PodDisruptionBudgets, and optional HPAs.

OpenShift: add `--set openshift=true`. This omits the fixed UID/GID/fsGroup, renders Routes instead of an Ingress,
and uses the OpenShift DNS/router selectors.

**NOT EXECUTED** in the build environment: `helm install` / `helm upgrade` and `oc`/`kubectl apply`.

## 5. Production bootstrap (first installation only)

`apps/api/src/cli/bootstrap.ts` ("Production bootstrap", spec §21) does the following:

- applies migrations;
- creates the organization (`HUB_ORG_NAME`, `HUB_ORG_SLUG`);
- publishes the project **templates** (`loadTemplates`, definitions only);
- creates the platform maintenance schedules (audit checkpoint every 15 minutes, delivery reconciliation every 10 minutes);
- optionally creates the **first administrator** as a user record bound to an IdP identity (e-mail and/or OIDC issuer and subject), with `platform_admin` and `portfolio_admin` roles.

There is **no password and no default account**. The administrator authenticates at the IdP, and MFA is enforced
there. The bootstrap refuses `HUB_MODE=demo` and refuses to run over a database that contains demo users.

You can run it in either of two ways:

- **Helm:** `--set bootstrap.enabled=true --set bootstrap.orgName="<approved organization name>" --set bootstrap.adminEmail=<first.admin@corp> [--set bootstrap.adminOidcIssuer=… --set bootstrap.adminOidcSubject=…]`. This creates a post-install hook Job that uses the owner Secret.
- **One-off Job** (same image): `args: ["bootstrap"]` with `DATABASE_MIGRATION_URL` from the owner Secret plus the variables above.

Everything else is configured in the application by the administrator, with audit. This covers users, role
assignments, committees and delegation, perimeter, sources, and AI mode (per project; default **off**). Never load
the Demo seed (`seed-demo`) in staging or production. The seed itself refuses `NODE_ENV=production`.

## 6. Post-installation checks

| Check | How | Expected |
|---|---|---|
| Pods healthy | `kubectl get pods -l app.kubernetes.io/instance=hub` | api/web Ready; worker Running |
| API liveness/readiness | `kubectl exec deploy/hub-api -- node /app/hub-entrypoint.cjs healthcheck api` | exit 0 |
| Production guard active | api logs show `env=production`, `mode=standard` | no "Unsafe configuration rejected" |
| Runtime role | api starts (the self-check refuses superuser, BYPASSRLS or table owner) | started |
| TLS and same origin | `https://<host>/login` loads; `https://<host>/api/v1/…` answers with problem+json | the certificate chain is Mobily PKI |
| Egress blocked | From an api pod, reach a non-allowlisted host | timeout or refused (NetworkPolicy) |
| No public assets | Browser HAR while using the app | same-origin requests only ([private-mode.md](private-mode.md)) |
| Sign-in | First administrator signs in through the IdP | session created; an unprovisioned user is refused |
| Backup | Run `scripts/ops/backup.sh` against the new database, then a restore drill into a scratch database | [backup-restore.md](backup-restore.md) |

## 7. Development and evaluation (not production)

`deploy/compose/compose.dev.yml` runs PostgreSQL 16 (with the role init script), the migration Job, api, worker and
web, with optional `demo` and `s3` (MinIO) profiles. It is a single host with no high availability, no backups and
local passwords. The file was validated with `docker compose config`. **NOT EXECUTED** (no Docker daemon):

```bash
cp deploy/compose/.env.example deploy/compose/.env   # replace CHANGE_ME values
docker compose -f deploy/compose/compose.dev.yml --env-file deploy/compose/.env up -d --build
docker compose -f deploy/compose/compose.dev.yml --env-file deploy/compose/.env --profile demo run --rm seed-demo
```
