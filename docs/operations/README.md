# Operations: Mobily Transformation Hub (P1 increment)

These guides are the P1 increments of the IT handover package (master prompt §19, items 6 and 7). They cover
packaging, clean start, health and readiness, configuration, the test identity provider, and restricted-network
preparation. They are written for Mobily IT and for the delivery team's reviewers.

> **Scope and honesty.** The Compose stack is for **reproducible install and test**. It is **not** proof of
> high-availability production readiness: one PostgreSQL instance on one host, no replication, failover or backup
> schedule, and no TLS termination in front of the app. The production deployment guide (domains/TLS, corporate SSO
> mapping, network boundaries, monitoring), backup/restore drills, upgrades and data migration are later-stage items
> (§19 items 8–11; P6/P7). Nothing here is a Mobily IT approval, and product gate G6 never implies engineering gate
> DG7 (or the reverse).

| Guide | Contents |
|---|---|
| [clean-start.md](clean-start.md) | One-command clean start with Docker Compose (A); container-free clean start (B); first organization bootstrap; smoke test; measured timings |
| [health-readiness.md](health-readiness.md) | `/healthz`, `/readyz`, container health checks, `mth health`, exit codes, logs, shutdown and connection limits |
| [configuration.md](configuration.md) | Environment template (`.env.example`), secrets as `<NAME>_FILE`, corporate IdP vs the Keycloak **test** realm, storage |
| [restricted-network.md](restricted-network.md) | Building and running with no outbound internet: mirrors, image list, build-time CA, the no-egress Compose variant |

Where things live:

| Path | What |
|---|---|
| `deploy/docker/Dockerfile`, `deploy/docker/entrypoint.sh` | The single application image `mth-app` (non-root uid 10001) with commands `api`, `worker`, `migrate` (`mth db …`, `mth health`) |
| `deploy/compose/compose.yaml`, `compose.no-egress.yaml` | Compose stack (`db`, `migrate`, `api`, `worker`; profile `test-idp` = Keycloak; profile `smoke`) and the internal-network variant |
| `deploy/compose/db-init/10-mth-roles.sh` | First-start creation of roles `mth_owner`/`mth_app` and database `mth` (ADR-0003) |
| `deploy/keycloak/realm-mth-test.json` | Keycloak **test** realm: synthetic users, placeholders instead of credentials |
| `deploy/images.lock.json`, `deploy/scripts/pin-images.mjs` | Container images and their digest pins |
| `deploy/scripts/` | `init-secrets.sh`, `build-image.sh`, `verify-stack.sh`, `clean-start-local.sh`, `smoke.mjs`, `assemble-runtime.sh`, `ensure-docker.sh`, `generate-env-example.mjs`, `check-ci-needs.mjs`, `ci-e2e-stack.mjs` |
| `.env.example` | Generated from `packages/config/src/index.ts` `ENV_VARS`: names only, no values |
| `licenses/` | SBOM (CycloneDX 1.6) and licence inventory generated from `pnpm-lock.yaml`; third-party notice collection |
| `deploy/ci/ci.yml` | The product CI workflow (to be installed as `.github/workflows/ci.yml`; see the T-DG1-DEVOPS handback) |

All demonstration and test users referenced here are **synthetic** (`*.example.invalid`). This product is not an
official PMI standard or certified product. `#0078FF` is a provisional brand token, not a verified Mobily colour.
