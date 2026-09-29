# Network flows

Default posture: **deny all ingress and egress** for every pod of the release (NetworkPolicy `hub-default-deny`),
plus explicit allow rules. Kubernetes NetworkPolicies match IPs, namespaces and pods, not host names. External
dependencies are therefore allowed by CIDR (`networkPolicy.egress.*.to`). In addition, the application checks host
names against `HUB_EGRESS_ALLOWLIST` (in-app guard, C-18). A dependency without a configured `to` renders **no**
rule and stays blocked (fail closed).

Flow IDs refer to `docs/security/threat-model.md` §4. As §15 of the master prompt requires, hosting (DF-13),
AI processing (DF-07), backups (DF-11) and technical-support access (DF-12) are **separate flows** with separate
approvals.

## Runtime flows

| # | From | To | Port / protocol | Allowed by | Data | Leaves Mobily? | Approval / owner |
|---|---|---|---|---|---|---|---|
| N-01 | Users' browsers | Ingress / Route → web (`/`) and api (`/api`) | 443/TLS → 3000, 4000 | ingress controller namespace selector | Everything the user may see | To the user's device | Network / Cybersecurity |
| N-02 | web | api (`hub-api:4000`) | 4000/HTTP in-cluster | policy `hub-web` egress | `/api` rewrite fallback only | No | — |
| N-03 | api, worker | PostgreSQL 16 | 5432/TLS | `egress.database` | All business data | No, if the DB is internal | DBA |
| N-04 | api, worker | S3-compatible object storage | 443/TLS | `egress.objectStorage` | Documents and exports | No, if the storage is internal | Storage team |
| N-05 | Browser ↔ IdP; api → IdP | IdP (discovery, token, JWKS) | 443/TLS | `egress.idp` (api only) | Identity claims | **Yes if the IdP is cloud-hosted** (DF-02) | IAM (MQ-02) |
| N-06 | api, worker, web | OTEL collector | 4317/4318 | `egress.otelCollector` | Traces/metrics; no content by design | No, if the collector is internal | Observability (MQ-10) |
| N-07 | api, worker | Corporate egress proxy | 3128 (example) | `egress.proxy` | Whatever is sent through it | Depends on the proxy rules | Network |
| N-08 | **worker** | **AI endpoint**: local model (Local-AI) or policy gateway (AI-Gateway) | 443/TLS | `egress.aiGateway` (disabled by default) | Prompt context within the classification ceilings | **Local AI: no (verify). AI Gateway: yes, to the provider** (DF-07) | Cybersecurity, Privacy, Procurement (MQ-06/07) |
| N-09 | worker | SMTP relay / Teams (future notifications) | per relay | `egress.extra` (none by default) | Title-level notification text | Possibly (tenant region, DF-08) | Collaboration (MQ-12) |
| N-10 | Container stdout | Log collector → SIEM | node-level | cluster logging (not a pod flow) | JSON logs without secrets or content | Depends on SIEM location | SOC (MQ-10) |
| N-11 | migration / bootstrap Jobs | PostgreSQL | 5432/TLS | policy `hub-migrate` (hook) | Schema and bootstrap rows (owner role) | No | DBA |
| N-12 | all pods | Cluster DNS | 53 (+5353 on OpenShift) | policy `hub-dns` | Names | No | Platform |
| N-13 | kubelet | Pod probes | 3000/4000, exec | node-level | Health only (`/healthz`, `/readyz` are **not** exposed via ingress) | No | Platform |

## Separate flows that need their own approval

| # | Flow | Path | Data | Leaves Mobily? | Control | Decision |
|---|---|---|---|---|---|---|
| S-1 (DF-11) | **Backups and restore** | PostgreSQL (`pg_dump -Fc` / PITR) + object copy → backup store; restore back | **Everything**, including audit and documents | Possibly (off-site, cloud or out-of-Kingdom targets) | Encryption with Mobily-managed keys, separate credentials, restore drill ([backup-restore.md](backup-restore.md)) | IT Operations / Cybersecurity (MQ-09) |
| S-2 (DF-12) | **Technical support and operations access** | Operators/vendor → PAM → `kubectl exec`, DB console, logs | Potentially everything (the owner role and superusers bypass RLS) | Possibly (remote vendors) | No standing vendor access; JIT, recorded sessions; support bundles exclude content; never copy production data to dev/test | IT Operations / Cybersecurity (MQ-08) |
| S-3 (DF-13) | **Hosting / platform operation** | Cluster, nodes, storage, registry pulls, platform telemetry | Everything at rest and in memory | Possibly (third-party-operated private cloud) | Private registry; platform telemetry settings | IT Infrastructure (MQ-03/04) |
| S-4 (DF-07) | **AI processing** | See N-08 | Prompt context | Mode-dependent | AI **off** by default; approved-destination allowlist; kill switch | MQ-06/07 |
| S-5 | **Build and supply chain** | CI → package mirror / registry | Source and dependency metadata (no business data) | Depends on CI location | [supply-chain.md](supply-chain.md) | IT Infrastructure |

## Per deployment mode (egress beyond N-03/N-04/N-05/N-06/N-12)

| Mode | Values overlay | AI egress | Other |
|---|---|---|---|
| Local development | `deploy/compose/compose.dev.yml` | none (mock labelled Simulated) | Compose `backend` network is `internal: true`: db, worker and migrations have no outbound route |
| Private — AI Off | `values-private-ai-off.yaml` | **none** (validated: no AI rule rendered, no AI env set) | — |
| Private — Local AI | `values-private-local-ai.yaml` | worker → local endpoint CIDR only | Verify the endpoint is internal |
| Private — Approved AI Gateway | `values-private-ai-gateway.yaml` | worker → gateway CIDR only; the gateway reaches the provider | Processing location, retention and cost approved by Mobily |
