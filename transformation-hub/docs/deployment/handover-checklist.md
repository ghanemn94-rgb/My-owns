# Handover checklist — enterprise inputs required from Mobily

Owners are functions (**Role — To be confirmed**). Nothing in this list has been provided or confirmed yet. Items
map to the threat model's open questions (MQ-xx).

| # | Area | Input needed | Where it goes | Owner (TBC) | Status |
|---|---|---|---|---|---|
| H-01 | Identity | IdP product and location; OIDC client (id, secret, redirect `https://<host>/api/v1/auth/oidc/callback`); MFA policy; SAML broker if needed; external-partner realm | `oidc.*`, `hub-oidc` Secret | IAM (MQ-02) | Open |
| H-02 | Identity | Group names for authentication and org-level roles; first administrator's identity (e-mail, iss/sub) | [user-provisioning.md](user-provisioning.md), `bootstrap.*` | IAM | Open |
| H-03 | Hosting | Kubernetes or OpenShift version; namespaces per environment; Pod Security / SCC; node sizing; ingress controller or router | `openshift`, `ingress.*`/`route.*`, `KUBE_VERSION` | IT Infrastructure (MQ-03) | Open |
| H-04 | Networking | Host name and DNS; CIDRs/selectors for DB, object storage, IdP, OTEL, proxy; ingress controller namespace label; egress proxy and `NO_PROXY`; WAF and ingress rate limits | `networkPolicy.*`, `proxy.*`, `ingress.annotations` | Network (MQ-04) | Open |
| H-05 | Certificates | TLS certificate or issuer for the host; private CA bundle for internal endpoints | `hub-tls`, `customCA.*` | PKI | Open |
| H-06 | Registry and supply chain | Private registry and pull secret; npm mirror; base-image mirror policy; scanner; signing | `image.*`, build args | IT Infrastructure / DevSecOps | Open |
| H-07 | Database | PostgreSQL 16 service or operator, HA level, TLS, roles `hub_owner`/`hub_app` created per `scripts/ops/db-init-roles.sh`, connection limits, PITR | `hub-db-*` Secrets | DBA | Open |
| H-08 | Storage | S3-compatible endpoint, bucket per environment, credentials, versioning/object lock, encryption, malware-scanning engine | `storage.s3.*`, `hub-object-storage` | Storage / Cybersecurity (MQ-11) | Open — **the S3 adapter is not implemented yet** |
| H-09 | Backup | Backup target and location (in-Kingdom?), operator, keys, retention, immutability; approval of the RPO/RTO proposals | [backup-restore.md](backup-restore.md) | IT Operations / Cybersecurity (MQ-09, MQ-17) | Open |
| H-10 | SIEM and logging | Log collection; SIEM destination for the audit export; retention; SOC detection rules (IR runbook §3) | [operations.md](operations.md) | SOC (MQ-10) | Open |
| H-11 | Observability | Internal OTEL collector endpoint, dashboards, alert routing | `otel.*` | Operations | Open |
| H-12 | Classification | Mobily classification scheme mapped to the five levels; handling rules | App configuration | Data Governance (MQ-01) | Open |
| H-13 | Approved models | AI mode per environment; approved providers and gateway; processing locations; retention; ceilings per destination | `values-private-*.yaml`, `ai.*` | Cybersecurity / Privacy / Procurement (MQ-06, MQ-07) | Open — default **AI Off** |
| H-14 | Notifications | SMTP relay or Teams tenant, allowed destinations | `networkPolicy.egress.extra` | Collaboration (MQ-12) | Open |
| H-15 | Support model | Who supports production, from where, PAM/JIT, session recording | [network-flows.md](network-flows.md) S-2 | IT Operations / Cybersecurity (MQ-08) | Open |
| H-16 | Change authorities | CAB and change process; who approves releases, migrations, restores, secret rotation, AI-mode changes; emergency change | This runbook set | IT Service Management | Open |
| H-17 | Security acceptance | Penetration test and security sign-off before production | — | Cybersecurity (MQ-18) | Open |
| H-18 | Records | Retention and legal-hold periods for minutes, evidence, DD material and audit | App configuration, backup retention | Legal / Records (MQ-20) | Open |
| H-19 | Sessions | Idle/absolute session lifetimes (internal and external) | `app.session.*` | Cybersecurity (MQ-15) | Open (defaults 60 min / 12 h proposed) |
| H-20 | Licences | Approval or rejection of review-required licences (LGPL `@img/sharp-libvips-*` via Next.js image optimisation; `buffers@0.1.1` with no declared licence) | `scripts/ops/licence-policy.json` `approvals` | Legal / OSS office | Open |

## Delivered by engineering (for verification during handover)

| Artefact | Location | Verification status in the build environment |
|---|---|---|
| API image (api, worker, migrate, bootstrap) | `apps/api/Dockerfile`, `deploy/docker/api-entrypoint.cjs` | Build steps exercised without Docker; the runtime layout booted locally. **Image build NOT EXECUTED** |
| Web image | `apps/web/Dockerfile` | Build steps exercised without Docker; the standalone server booted. **Image build NOT EXECUTED** |
| Helm chart + 3 mode overlays | `deploy/helm/transformation-hub` | `helm lint` + `template` + kubeconform + security invariants: **PASS**. **Install NOT EXECUTED** |
| Compose (dev/eval; not HA) | `deploy/compose`, `scripts/ops/compose-env-init.sh`, `scripts/ops/compose-smoke.sh` | `docker compose config` **PASS**. The documented `up --build --wait` → Demo seed → smoke → `down -v` sequence runs in the CI job `compose`. **Not executed in the build environment** (no Docker daemon) |
| Secret scan | `scripts/ops/secret-scan.sh`, `scripts/ops/gitleaks.toml` | **Executed** locally (history, tree, web bundle, Playwright report/traces/logs: 0 findings; planted values detected). CI job `secret-scan` |
| Backup/restore + drill | `scripts/ops/backup.sh`, `restore.sh`, `restore-drill.sh` | **Executed**, PASS ([results](restore-drill-results.md)) |
| Egress check | `scripts/ops/egress-check.sh` | **Executed** (API dist: 0 findings; web build: 0 FAIL / 26 WARN; positive control: 4 FAIL detected) |
| Licence check, SBOM | `scripts/ops/licence-check.mjs`; syft in CI | **Executed** locally (0 FAIL / 2 WARN; CycloneDX SBOM with 539 components) |
| CI workflow | `.github/workflows/transformation-hub-ci.yml` | actionlint **PASS**. **Pipeline NOT EXECUTED** |
