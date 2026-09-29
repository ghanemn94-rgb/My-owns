# Deployment documentation

This is the engineering package for installing, operating and recovering the Transformation & Transactions Hub
inside an environment chosen by Mobily's teams. No provider, registry, identity system or network path is assumed.
**Engineering verification is not production approval** (master prompt §22).

| Topic | Document |
|---|---|
| Install (prerequisites, secrets, Helm, production bootstrap, checks) | [installation.md](installation.md) |
| Every configuration variable and its production requirement | [configuration.md](configuration.md) |
| Network flows (AI, backups and support access as separate flows) | [network-flows.md](network-flows.md) |
| Secrets inventory and rotation | [secrets.md](secrets.md) |
| Backup/restore, RPO/RTO proposals, reconciliation | [backup-restore.md](backup-restore.md) · drill evidence [restore-drill-results.md](restore-drill-results.md) |
| Upgrades, forward-only migrations, rollback | [upgrade-and-rollback.md](upgrade-and-rollback.md) |
| Monitoring, queue/dead letters, audit export | [operations.md](operations.md) |
| Joiner/mover/leaver, IdP groups | [user-provisioning.md](user-provisioning.md) |
| Sizing assumptions and load-test plan | [sizing-and-load-test.md](sizing-and-load-test.md) |
| dev/test/staging/prod separation | [environments.md](environments.md) |
| Private/offline mode (AT-22) | [private-mode.md](private-mode.md) |
| Registry, SBOM, vulnerabilities, licences, updates | [supply-chain.md](supply-chain.md) |
| Enterprise inputs needed from Mobily | [handover-checklist.md](handover-checklist.md) |
| Incident response | [../security/incident-response-runbook.md](../security/incident-response-runbook.md) |

## Assets

| Path | What |
|---|---|
| `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.dockerignore`, `deploy/docker/api-entrypoint.cjs` | Images (api/worker/migrate/bootstrap in one image; optional `api-chromium`; web standalone) |
| `deploy/compose/` | Development/evaluation stack only (not HA) |
| `deploy/helm/transformation-hub/` | Helm chart for Kubernetes/OpenShift + `values-private-{ai-off,local-ai,ai-gateway}.yaml` |
| `scripts/ops/` | `backup.sh`, `restore.sh`, `restore-drill.sh`, `egress-check.sh`, `licence-check.mjs` (+ policy), `db-init-roles.sh`, `validate-deploy.sh` |
| `../.github/workflows/transformation-hub-ci.yml` | CI (repository root) |

## Verification status (build environment, 2026-09-29)

| Item | Status | Evidence / operator command |
|---|---|---|
| Backup → restore drill against PostgreSQL 16 | **Executed — PASS** (2.85 s and 8.26 s to verified) | [restore-drill-results.md](restore-drill-results.md) |
| Helm lint, template (5 variants), 8 refusal cases, security invariants, kubeconform | **Executed — PASS** (Helm v3.19.0 and kubeconform v0.7.0 built from their official sources) | `bash scripts/ops/validate-deploy.sh` |
| Compose file | **Validated** with `docker compose config` | `up` NOT EXECUTED |
| Dockerfile RUN steps and runtime layouts | **Executed without Docker** (same commands; runtime booted) | `docker build …` NOT EXECUTED ([supply-chain.md](supply-chain.md)) |
| Egress check, licence check, source SBOM | **Executed** | [private-mode.md](private-mode.md), [supply-chain.md](supply-chain.md) |
| CI workflow | actionlint **PASS** (with shellcheck) | Pipeline NOT EXECUTED |
| shellcheck `-S warning` on ops scripts | **PASS** | |
| Cluster install, image push, OpenShift run, NetworkPolicy enforcement, S3 path | **NOT EXECUTED** | Requires Mobily infrastructure |
