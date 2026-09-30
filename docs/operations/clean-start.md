# Clean start (§19 item 7, REQ-S19-010; A18 first case)

Two supported paths. **A** is the target for IT: containers only, no Node.js needed on the host. **B** needs no container
runtime and exercises the same image layout, entrypoint, database initialization and smoke test. B is also the path used
for the evidence in environments without a Docker daemon.

> Compose is for reproducible install and test, **not** a high-availability production topology (see
> [README](README.md)).

## Prerequisites

| | A: Compose | B: container-free |
|---|---|---|
| Host | Docker Engine 23+ with the Compose v2 plugin (tested syntax: Compose v5.1.1); `bash`, `openssl`; Node.js ≥ 22.18 only for the helper scripts | Node.js ≥ 22.18, pnpm 10.33.0 (Corepack), PostgreSQL ≥ 16 server binaries and `psql`, `bash`, `openssl`, `curl` |
| Network | Pulling images and the build's package install need a registry: public, or IT's mirror ([restricted-network.md](restricted-network.md)). **Runtime needs none.** | Dependency install needs the npm registry or a populated pnpm store (`MTH_PNPM_OFFLINE=1`). Runtime needs none. |
| Resources measured | Not measured (Docker unavailable in the build sandbox; see the handback) | 4 vCPU / 15 GiB host: see timings below |

## A. Docker Compose

From a fresh checkout, at the repository root:

```bash
deploy/scripts/init-secrets.sh             # random local secrets OUTSIDE the repo (~/.config/mth-compose/secrets, 0700)
deploy/scripts/build-image.sh              # builds and verifies mth-app:local (non-root, commands, no npm at runtime)
docker compose -f deploy/compose/compose.yaml --profile test-idp up -d
docker compose -f deploy/compose/compose.yaml ps  # api "healthy"; migrate "exited (0)"; db "healthy"
curl -fsS http://127.0.0.1:3000/readyz     # {"status":"ready","checks":{"database":"ok","migrations":"ok"}}
```

What happens, in order:

1. `db` (PostgreSQL 18) initializes an empty volume. `db-init/10-mth-roles.sh` creates the `mth_owner` and `mth_app`
   login roles (passwords from secret files) and the database `mth` owned by `mth_owner`. The health check turns
   healthy only after this has finished.
2. `migrate` runs once as `mth_owner` (`mth migrate`). It applies the forward-only migrations under an advisory lock
   and exits 0. On an up-to-date database it prints `database is up to date`.
3. `api` and `worker` start only after `migrate` has **completed successfully**. Both run as `mth_app`. The API's
   health check calls `/readyz`.
4. With `--profile test-idp`, `keycloak` starts the **test** realm `mth-test` over HTTPS (`https://keycloak:8443`)
   with a throwaway certificate created by `init-secrets.sh`.

**First organization and administrator.** A production database starts empty: no demo data, no default admin. The
first organization and its access/technical administrator are created once, bound to an IdP identity
`(issuer, subject)`:

```bash
docker compose -f deploy/compose/compose.yaml run --rm migrate db bootstrap \
  --org-code MOBILY --org-name-en "…" --org-name-ar "…" --admin-name "…" --admin-email admin@corp.example \
  --admin-issuer https://<corporate-idp>/… --admin-subject <subject of that person at the IdP>
```

It refuses to run a second time. The administrator gets `ADM_ACCESS` and `ADM_TECH` only: **no business role and no
business approval**. Business roles are granted afterwards through the application, and every grant is audited.

**Smoke test (login, create, read).** With the test realm, bootstrap against the synthetic `smoke.admin` subject, then
run the in-network smoke service:

```bash
docker compose -f deploy/compose/compose.yaml run --rm migrate db bootstrap --org-code MTH-TEST \
  --org-name-en "Test org (synthetic)" --org-name-ar "مؤسسة اختبار (اصطناعية)" --admin-name "Synthetic Access Admin" \
  --admin-issuer https://keycloak:8443/realms/mth-test --admin-subject 5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0001
docker compose -f deploy/compose/compose.yaml --profile test-idp --profile smoke run --rm smoke
```

The smoke test signs in `smoke.admin` and `smoke.office` through the Keycloak login form (authorization code + PKCE).
The admin creates a business unit and grants the office user `TO`. The office user creates a transformation and reads
it back (detail, list, audit). The test then confirms that the technical admin cannot see that record, and both users
sign out. It ends with `{"smoke":"PASS",…}`.

**Everything at once, including the no-egress variant:** `deploy/scripts/verify-stack.sh` builds the image, runs the
default and the `internal: true` variants in a private project with throwaway secrets, runs bootstrap and the smoke
test in each, checks that the worker consumed the `transformation.created` event, prints record counts and tears
everything down. Exit 0 means PASS, exit 3 means BLOCKED (no Docker daemon).

**Stop / reset:** `docker compose -f deploy/compose/compose.yaml --profile test-idp down` keeps the data;
`… down -v` deletes the database and evidence volumes.

## B. Container-free (same layout, same entrypoint)

```bash
deploy/scripts/clean-start-local.sh            # clones HEAD into a temp dir, installs, builds, assembles, runs A1–B5
# options: --include-worktree (overlay uncommitted files), --keep, --work DIR, --log FILE
# environment: PGBIN, MTH_PNPM_STORE, MTH_PNPM_OFFLINE=1, MTH_LOCAL_PG_PORT, MTH_LOCAL_PORT
```

It runs `deploy/scripts/assemble-runtime.sh`, which is the same script as the image build, so the runtime tree
matches the image. It then runs the image's `entrypoint.sh` with `MTH_APP_ROOT` pointing at that tree. The steps are:

| Step | Checks |
|---|---|
| A1–A2 | `mth db status` = 3 (pending) on an empty DB. `mth migrate` applies 6 migrations, a re-run is a no-op, then status = 0 |
| A3 | `mth db seed-dev` is refused (64): dev seeds are not in the image. `AUTH_MODE=dev` with `NODE_ENV=production` exits 78 |
| A4–A5 | api + worker in production mode (OIDC). `/healthz` and `/readyz` are ready. `GET /` serves the SPA. The dev login is 404. An unreachable IdP makes login redirect to `/login?error=idp_unavailable` without crashing. `/me` without a session is 401 |
| A6 | `mth db bootstrap` creates the first organization and admin. A second bootstrap is refused |
| B1–B3 | On a second fresh database: SYNTHETIC dev users (source tree only), then `smoke.mjs` in dev mode: 11 steps |
| B4–B5 | The worker relays and consumes `transformation.created` (outbox published, ledger row). Record counts |

## Measured timings (container-free path B)

Recorded 2026-09-30 in the build sandbox: 4 vCPU, 15 GiB RAM, Node 22.22.2, pnpm 10.33.0, PostgreSQL 16.13 (local
floor version; Compose uses 18). Offline install from a pre-populated store. Workload: one fresh clone, 6 migrations,
1 organization, 4 business units, 6 users, 1 transformation.

| Step | Seconds |
|---|---|
| fresh clone | 2.1 |
| install (frozen lockfile, offline store) | 1.2 |
| `pnpm -r build` | 14.1 |
| assemble runtime tree (notices, prod prune, copy, verify: 129 packages, 100 MB) | 1.9 |
| PostgreSQL cluster + roles | 0.8 |
| migrate + production checks + bootstrap (A1–A6) | 2.4 |
| first-case journey + worker consumption (B1–B5) | 3.2 |
| **total** (incl. environment facts and teardown) | **27.0** |

Source: `docs/delivery/handbacks/DG1/T-DG1-DEVOPS-evidence/clean-start-local.log` (an earlier identical run took
30.7 s; build time dominates).

The Compose timings (image build, `up` to healthy, Keycloak start) have **not** been measured: the build sandbox has no
Docker daemon. `verify-stack.sh` prints them when run on a Docker host.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `required variable MTH_SECRETS_DIR is missing a value` | Run `deploy/scripts/init-secrets.sh` (it writes `deploy/compose/.env`, which is git-ignored, with only that path) |
| `pull access denied for mth-app` | Build the image first (`deploy/scripts/build-image.sh`), or set `MTH_APP_IMAGE` to IT's registry image and `MTH_APP_PULL_POLICY=missing` |
| `migrate` exited 1 with `checksum` | An applied migration file differs from this build. Never edit applied migrations; restore from backup and add a corrective migration (ADR-0003) |
| api exits 78 | Invalid configuration: the message names the variable (never its value) |
| `/readyz` 503 `migrations: pending` | `migrate` has not run against this database |
| Login redirects to `/login?error=idp_unavailable` | The API cannot reach `OIDC_ISSUER_URL` (discovery is lazy and retried; the API keeps running) |
